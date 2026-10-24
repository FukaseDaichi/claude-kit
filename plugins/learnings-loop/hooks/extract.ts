// 抽出と判定（設計 §5.5）: フォーク → コードで検証 → 小さいモデルで判定 → 書き込み。

import type { EngineInterface, ModelUsage } from 'claude-code'

import { parseStage1, parseStage2, type Candidate, type Dropped, type Verdict } from './candidates'
import { hash } from './learnings-file'
import { buildForkPrompt, buildJudgePrompt } from './prompts'
import { addDiscarded, discardedTexts, getDiscarded } from './store'
import { writeCandidates, type Rejudge, type WriteResult } from './writer'

export type ExtractOptions = {
  maxCandidates: number
  maxChars: number
  judgeModel: string
  judgeTimeoutMs: number
}

export type ExtractContext = {
  file: string
  dir: string
  repoKey: string
  sessionId: string
  criteria: string
  turnsSince: number
  options: ExtractOptions
}

export type ExtractOutcome = {
  status: 'done' | 'nothing-to-fork' | 'fork-failed' | 'parse-failed' | 'no-candidates'
  usage: ModelUsage
  result?: WriteResult
  detail?: string
}

const ZERO: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

function add(a: ModelUsage, b: ModelUsage): ModelUsage {
  return {
    input_tokens: a.input_tokens + b.input_tokens,
    output_tokens: a.output_tokens + b.output_tokens,
    cache_read_input_tokens: a.cache_read_input_tokens + b.cache_read_input_tokens,
    cache_creation_input_tokens: a.cache_creation_input_tokens + b.cache_creation_input_tokens,
  }
}

/** 2段目: 既存の LEARNINGS.md と捨てた候補に照らして auto / drop に振り分ける。 */
export function makeJudge($: EngineInterface, ctx: Pick<ExtractContext, 'repoKey' | 'options'>, usage: { total: ModelUsage }): Rejudge {
  return async (candidates, learningsText) => {
    const verdicts = new Map<string, { verdict: Verdict; reason: string }>()
    if (candidates.length === 0) return verdicts
    const discarded = discardedTexts(await getDiscarded($, ctx.repoKey))
    const r = await $.model.complete({
      model: ctx.options.judgeModel,
      prompt: buildJudgePrompt({ learnings: learningsText, discarded, candidates }),
      maxTokens: 1024,
      effort: 'low',
      timeoutMs: ctx.options.judgeTimeoutMs,
    })
    usage.total = add(usage.total, r.usage)
    if (!r.isAnswered) {
      $.ui.log(`judge: no answer (${r.reason})`, { to: 'debug' })
      return verdicts
    }
    try {
      const parsed = parseStage2(r.text, candidates.map(c => c.id))
      for (const [id, v] of parsed) verdicts.set(id, v)
    } catch (err) {
      $.ui.log(`judge: bad json (${String(err)})`, { to: 'debug' })
    }
    return verdicts
  }
}

export async function runExtraction($: EngineInterface, ctx: ExtractContext): Promise<ExtractOutcome> {
  const usage = { total: ZERO }
  const now = await $.clock.now()

  // 1段目: フォーク
  const fork = await $.model.fork({
    prompt: buildForkPrompt({
      criteria: ctx.criteria,
      turnsSince: ctx.turnsSince,
      max: ctx.options.maxCandidates,
      maxChars: ctx.options.maxChars,
    }),
  })
  if (!fork.isAnswered) {
    if (fork.reason === 'nothing-to-fork') return { status: 'nothing-to-fork', usage: usage.total }
    const detail = fork.reason === 'api-error' ? `${fork.reason} ${fork.status ?? ''} ${fork.error}` : fork.reason
    return { status: 'fork-failed', usage: add(usage.total, fork.usage), detail }
  }
  usage.total = add(usage.total, fork.usage)

  // コードで検証
  let stage1: { candidates: Candidate[]; dropped: Dropped[] }
  try {
    stage1 = parseStage1(fork.text, { max: ctx.options.maxCandidates, maxChars: ctx.options.maxChars })
  } catch (err) {
    return { status: 'parse-failed', usage: usage.total, detail: String(err) }
  }
  await addDiscarded(
    $,
    ctx.repoKey,
    stage1.dropped.filter(d => d.reason === 'secret').map(d => ({ text: d.text, section: '', reason: d.reason, detail: d.detail })),
    now,
  )
  if (stage1.candidates.length === 0) {
    return { status: 'no-candidates', usage: usage.total, detail: stage1.dropped.map(d => `${d.reason}:${d.text.slice(0, 40)}`).join(' / ') }
  }

  // 2段目: 判定（判定時のファイル内容のハッシュを書き込み処理に渡す）
  const judge = makeJudge($, ctx, usage)
  let text: string
  try {
    text = await $.fs.read(ctx.file)
  } catch {
    text = ''
  }
  const judged = await judge(stage1.candidates, text)
  const auto: Candidate[] = []
  const dropped: Dropped[] = [...stage1.dropped]
  for (const c of stage1.candidates) {
    const v = judged.get(c.id)
    if (v?.verdict === 'auto') auto.push(c)
    else dropped.push({ text: c.text, reason: v === undefined ? 'unjudged' : 'rejected', detail: v?.reason })
  }
  await addDiscarded(
    $,
    ctx.repoKey,
    dropped.filter(d => d.reason === 'rejected').map(d => ({ text: d.text, section: '', reason: d.reason, detail: d.detail })),
    now,
  )

  const result = await writeCandidates(
    $,
    {
      file: ctx.file,
      dir: ctx.dir,
      repoKey: ctx.repoKey,
      sessionId: ctx.sessionId,
      expectedHash: hash(text),
      rejudge: judge,
      fromPending: false,
    },
    auto,
  )
  result.dropped.push(...dropped)
  return { status: 'done', usage: usage.total, result }
}
