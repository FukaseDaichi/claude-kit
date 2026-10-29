// learnings-loop: LEARNINGS.md の「読む → 学びを拾う → 追記する → ときどき統合する」ループを
// Claude Code の function hooks で回す。設計書は作者のノート（非公開）にある。
//
// 注: `$` を受け取る関数はすべてこのファイルの最上位の関数宣言にする（エンジンの検証の規則）。

import { atom, read, update } from 'claude-code'
import type { EngineInterface, ModelUsage, PluginOptions, Register, RenderElement, RenderInput } from 'claude-code'

import type { Candidate, DropReason } from './candidates'
import { makeJudge, runExtraction, type ExtractOptions } from './extract'
import { commitOnly, commonDir, hasChanges, worktreeRoots } from './git'
import {
  buildDigest,
  DEFAULT_WINDOW_MS,
  DIGEST_CHARS,
  encodeProjectDir,
  isInside,
  MAX_READ_BYTES,
  parseTranscript,
  type TranscriptExcerpt,
  type Unread,
} from './history'
import {
  countObservations,
  daysBetween,
  hasLine,
  isLearningsPath,
  isSection,
  lastConsolidated,
  localDate,
  parse,
  principles,
  removeLine,
} from './learnings-file'
import { buildConsolidatePrompt, type HistoryHandoff } from './prompts'
import { formatStatus } from './status'
import {
  addDiscarded,
  declineInit,
  getAppended,
  getDiscarded,
  getHistoryCursor,
  getPending,
  isInitDeclined,
  markUndone,
  PENDING_TTL_MS,
  removeDiscarded,
  setHistoryCursor,
  setPending,
  type AppendedRecord,
  type PendingCandidate,
} from './store'
import { writeCandidates } from './writer'

import type { LearningsAppended, LearningsExtraction, LearningsNotice, LearningsSession } from '../types'

const PLUGIN = 'learnings-loop'
const SECTION_ID = 'learnings-loop:principles'
const EDIT_TOOLS = new Set(['Edit', 'Write', 'NotebookEdit', 'MultiEdit'])
const FILE_NAME = 'LEARNINGS.md'
const COMMIT_MESSAGE = 'LEARNINGS.md を更新（learnings-loop）'

const sessionAtom = atom({ plugin: 'learnings-loop', key: 'session' } as const, {
  file: null,
  repoKey: null,
  initOfferFor: null,
  hasPrompted: false,
} as LearningsSession)
const appendedAtom = atom({ plugin: 'learnings-loop', key: 'appended' } as const, { count: 0, fromPending: 0 } as LearningsAppended)
const noticeAtom = atom({ plugin: 'learnings-loop', key: 'notice' } as const, {
  isDue: false,
  observations: 0,
  isReflecting: false,
} as LearningsNotice)
const extractionAtom = atom({ plugin: 'learnings-loop', key: 'extraction' } as const, {
  processedUpTo: 0,
  isPending: false,
  isRunning: false,
  runs: 0,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
} as LearningsExtraction)

type Options = {
  extraction: 'auto' | 'manual'
  maxCandidates: number
  minInterval: number
  noticeCount: number
  noticeDays: number
  injectPrinciples: boolean
  offerInit: boolean
  maxChars: number
  judgeModel: string
}

function readOptions(o: PluginOptions): Options {
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d)
  const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d)
  const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d)
  return {
    extraction: str(o.extraction, 'auto') === 'manual' ? 'manual' : 'auto',
    maxCandidates: num(o.maxCandidates, 3),
    minInterval: num(o.minInterval, 0),
    noticeCount: num(o.noticeCount, 80),
    noticeDays: num(o.noticeDays, 7),
    injectPrinciples: bool(o.injectPrinciples, true),
    offerInit: bool(o.offerInit, true),
    maxChars: num(o.maxChars, 200),
    judgeModel: str(o.judgeModel, 'haiku'),
  }
}

// ---- モジュールの状態（リロードで消えてよいもの） -----------------------------

let options: Options = readOptions({})
/** セッション開始時点で固定する原則の本文（プロンプトキャッシュを壊さないため） */
let principlesText = ''
let observationsAtStart = 0
let criteriaText = ''
/** ターンごとの観察 */
let turn = { edits: 0, errors: 0, editedLearnings: false }
/** 前回の主会話の turn.start で見た `$.session.turns()`。会話圧縮の検知に使う */
let lastTurns = 0
/** prompt.compose が自分まで届いたか（組織の管理設定がある環境では cc-plugin-sec-default が飛ばす） */
let composeSeen = false
/** 原則を発言の添付（context）で渡したか。会話圧縮のあとは渡し直す */
let promptInjected = false
let poller: { cancel: () => void } | undefined
/** 今のセッションの jsonl の場所（classic.UserPromptSubmit が届いたときだけ分かる） */
let transcriptPath: string | undefined
/** 反映に渡した抜粋の最後の発言の日時。反映のターンが中断されずに終わったら「どこまで読んだか」に書く */
let pendingCursor: number | undefined

const ZERO_USAGE: ModelUsage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

/** 親ディレクトリ。区切りは `/` と `\` の両方を受ける（Windows の cwd でも壊れないように）。 */
function dirOf(path: string): string {
  return path.replace(/[\\/][^\\/]*$/, '') || '/'
}

/**
 * 会話圧縮を turn.start で検知し、処理済み位置を今のターンの手前にそろえる（session.compact が飛ばされる環境のため）。
 * 根拠: 2.1.309 で /compact の次の turn.start では $.session.turns() が前回より小さくなる（実測 5 → 4、messages は 12 → 5）。
 */
async function noteCompaction($: EngineInterface): Promise<void> {
  const turns = await $.session.turns().catch(() => undefined)
  if (turns === undefined) return
  if (turns < lastTurns) {
    // turns には今のターンのプロンプトも入っているので、処理済みはその手前まで
    await update($, extractionAtom, x => ({ ...x, processedUpTo: Math.max(0, turns - 1) }))
    $.ui.log(`compaction detected (turns ${lastTurns} -> ${turns}); processedUpTo reset`, { to: 'debug' })
  }
  lastTurns = turns
}

/** システムプロンプトにも発言の添付にも同じ文で渡す原則の本文（セッション開始時点の内容で固定） */
function principlesBlock(file: string): string {
  return [
    '# Project learnings (learnings-loop)',
    principlesText !== '' ? `## Consolidated Principles\n${principlesText}` : '（まだ原則はありません）',
    '',
    `生の観察 ${observationsAtStart} 件が \`${file}\` にある。関係しそうな作業の前に grep して参照せよ。`,
    '学びの記録は learnings-loop が自動で行う。明示的に頼まれない限り、自分で LEARNINGS.md に追記しない。',
    'LEARNINGS.md の未 commit の変更は learnings-loop の追記。作業の commit に含めてよい（戻したり除いたりしない）。',
  ].join('\n')
}

/** 原則がどの経路で Claude に届いているか（/learnings の表示用） */
function principlesVia(): 'off' | 'system' | 'prompt' | 'none' {
  if (!options.injectPrinciples) return 'off'
  if (composeSeen) return 'system'
  if (promptInjected) return 'prompt'
  return 'none'
}

function extractOptions(): ExtractOptions {
  return {
    maxCandidates: options.maxCandidates,
    maxChars: options.maxChars,
    judgeModel: options.judgeModel,
    judgeTimeoutMs: 60_000,
  }
}

// ---- 検出 -------------------------------------------------------------------

async function findLearnings($: EngineInterface, cwd: string): Promise<string | null> {
  const dirs: string[] = []
  let dir = cwd.replace(/\/+$/, '')
  for (let i = 0; i < 16 && dir !== ''; i++) {
    dirs.push(dir)
    const parent = dirOf(dir)
    if (parent === dir) break
    if (parent === '/') {
      dirs.push('/')
      break
    }
    dir = parent
  }
  const repo = await $.session.repo().catch(() => null)
  if (repo !== null && !dirs.includes(repo.root)) dirs.push(repo.root)
  for (const d of dirs) {
    const path = d === '/' ? `/${FILE_NAME}` : `${d}/${FILE_NAME}`
    if (await $.fs.exists(path).catch(() => false)) return path
  }
  return null
}

async function readFile($: EngineInterface, file: string): Promise<string | undefined> {
  try {
    return await $.fs.read(file)
  } catch {
    return undefined
  }
}

async function refreshNotice($: EngineInterface, text: string): Promise<void> {
  const observations = countObservations(text)
  const last = lastConsolidated(text)
  const daysSince = last !== undefined ? daysBetween(localDate(await $.clock.now()), last) : undefined
  const isDue = observations >= options.noticeCount || (daysSince !== undefined && daysSince > options.noticeDays)
  await update($, noticeAtom, n => ({ ...n, isDue, observations, daysSince }))
}

/** LEARNINGS.md のない Git リポジトリなら、init を案内してよいリポジトリの識別キーを返す。 */
async function initOfferKey($: EngineInterface): Promise<string | null> {
  if (!options.offerInit) return null
  const repo = await $.session.repo().catch(() => null)
  if (repo === null) return null
  const key = await commonDir((argv, init) => $.process.run(argv, init), repo.root)
  if (key === undefined || (await isInitDeclined($, key))) return null
  return key
}

async function detect($: EngineInterface, cwd: string): Promise<void> {
  const file = await findLearnings($, cwd)
  if (file === null) {
    const initOfferFor = await initOfferKey($)
    await update($, sessionAtom, s => ({ ...s, file: null, repoKey: null, initOfferFor }))
    return
  }
  const text = await readFile($, file)
  const parsed = text !== undefined ? parse(text) : undefined
  if (text === undefined || parsed === undefined || !parsed.ok) {
    $.ui.log(`${file}: ${parsed?.ok === false ? parsed.reason : 'unreadable'}; doing nothing`, { to: 'debug' })
    await update($, sessionAtom, s => ({ ...s, file: null, repoKey: null, initOfferFor: null }))
    return
  }
  const key = (await commonDir((argv, init) => $.process.run(argv, init), dirOf(file))) ?? file
  await update($, sessionAtom, s => ({ ...s, file, repoKey: key, initOfferFor: null }))
  principlesText = principles(text)
  observationsAtStart = countObservations(text)
  await refreshNotice($, text)
}

// ---- 書き込みの共通部分 -------------------------------------------------------

async function bumpUsage($: EngineInterface, u: ModelUsage, runs = 0): Promise<void> {
  await update($, extractionAtom, x => ({
    ...x,
    runs: x.runs + runs,
    usage: {
      input: x.usage.input + u.input_tokens,
      output: x.usage.output + u.output_tokens,
      cacheRead: x.usage.cacheRead + u.cache_read_input_tokens,
      cacheWrite: x.usage.cacheWrite + u.cache_creation_input_tokens,
    },
  }))
}

async function noteWritten($: EngineInterface, written: readonly AppendedRecord[], fromPending: boolean): Promise<void> {
  if (written.length === 0) return
  await update($, appendedAtom, a => ({
    count: a.count + (fromPending ? 0 : written.length),
    fromPending: a.fromPending + (fromPending ? written.length : 0),
  }))
  const s = await read($, sessionAtom)
  if (s.file !== null) {
    const text = await readFile($, s.file)
    if (text !== undefined) await refreshNotice($, text)
  }
  $.ui.toast(`📚 ${fromPending ? '保留していた' : ''}${written.length}件を LEARNINGS.md に追記（u で取り消し）`)
  for (const r of written) $.ui.log(`appended [${r.section}] ${r.text}`, { to: 'debug' })
}

async function consumePending($: EngineInterface): Promise<void> {
  const s = await read($, sessionAtom)
  if (s.file === null || s.repoKey === null) return
  const list = await getPending($, s.repoKey)
  if (list.length === 0) return
  const now = await $.clock.now()
  const fresh = list.filter(p => p.createdAt + PENDING_TTL_MS > now)
  const expired = list.filter(p => p.createdAt + PENDING_TTL_MS <= now)
  await addDiscarded($, s.repoKey, expired.map(p => ({ text: p.text, section: p.section, reason: 'expired' as DropReason })), now)
  const usage = { total: ZERO_USAGE }
  const result = await writeCandidates(
    $,
    {
      file: s.file,
      dir: dirOf(s.file),
      repoKey: s.repoKey,
      sessionId: await $.session.id(),
      rejudge: makeJudge($, { repoKey: s.repoKey, options: extractOptions() }, usage),
      fromPending: true,
    },
    fresh,
  )
  // 保留のまま残るもの（まだ競合マーカーがある、など）は元の発生日時を保つ
  const stillPending: PendingCandidate[] = result.pending.map(p => {
    const orig = fresh.find(f => f.text === p.text)
    return orig !== undefined ? { ...p, createdAt: orig.createdAt, branch: orig.branch ?? p.branch } : p
  })
  await setPending($, s.repoKey, stillPending)
  await bumpUsage($, usage.total)
  await noteWritten($, result.written, true)
  if (result.note !== undefined) $.ui.log(`pending: ${result.note}`, { to: 'debug' })
}

// ---- 抽出 ---------------------------------------------------------------------

async function extractNow($: EngineInterface, force: boolean): Promise<string> {
  const s = await read($, sessionAtom)
  if (s.file === null || s.repoKey === null) return 'LEARNINGS.md がないので抽出しません。'
  const ex = await read($, extractionAtom)
  if (ex.isRunning) return '抽出が走っています。'
  const turns = await $.session.turns()
  const since = turns - ex.processedUpTo
  if (!force) {
    if (!ex.isPending) return ''
    if (since < Math.max(1, options.minInterval)) return ''
  }
  await update($, extractionAtom, x => ({ ...x, isPending: false, isRunning: true }))
  try {
    const outcome = await runExtraction($, {
      file: s.file,
      dir: dirOf(s.file),
      repoKey: s.repoKey,
      sessionId: await $.session.id(),
      criteria: criteriaText,
      turnsSince: since,
      options: extractOptions(),
    })
    await bumpUsage($, outcome.usage, 1)
    if (outcome.status === 'done' && outcome.result !== undefined) {
      const r = outcome.result
      if (r.pending.length > 0) {
        await setPending($, s.repoKey, [...(await getPending($, s.repoKey)), ...r.pending])
      }
      await update($, extractionAtom, x => ({ ...x, processedUpTo: turns }))
      await noteWritten($, r.written, false)
      const parts = [`追記 ${r.written.length}`, `保留 ${r.pending.length}`, `捨て ${r.dropped.length}`]
      if (r.note !== undefined) parts.push(r.note)
      $.ui.log(`extraction: ${parts.join(' / ')}`, { to: 'debug' })
      return `抽出しました: ${parts.join(' / ')}`
    }
    if (outcome.status === 'no-candidates' || outcome.status === 'nothing-to-fork') {
      await update($, extractionAtom, x => ({ ...x, processedUpTo: turns }))
      $.ui.log(`extraction: ${outcome.status} ${outcome.detail ?? ''}`, { to: 'debug' })
      return outcome.status === 'nothing-to-fork'
        ? 'まだ会話がないので抽出できません。'
        : `候補はありませんでした。${outcome.detail ? `（${outcome.detail}）` : ''}`
    }
    // fork-failed / parse-failed: 処理済み位置は進めない（次回に同じ範囲がもう一度対象になる）
    $.ui.log(`extraction failed: ${outcome.status} ${outcome.detail ?? ''}`, { to: 'debug' })
    return `抽出に失敗しました（${outcome.status}${outcome.detail ? `: ${outcome.detail}` : ''}）。次回にまとめて再試行します。`
  } finally {
    await update($, extractionAtom, x => ({ ...x, isRunning: false }))
  }
}

// ---- 取り消し・採用・作成 -----------------------------------------------------

async function undoRecord($: EngineInterface, rec: AppendedRecord): Promise<string> {
  const s = await read($, sessionAtom)
  if (s.file === null || s.repoKey === null) return 'LEARNINGS.md がありません。'
  if (rec.isUndone) return 'すでに取り消し済みです。'
  const text = await readFile($, s.file)
  if (text === undefined) return 'LEARNINGS.md を読めませんでした。'
  if (!isSection(rec.section)) return `不明なセクション: ${rec.section}`
  const r = removeLine(text, rec.section, rec.line)
  if (!r.ok) {
    return r.reason === 'not-found' ? '同じ行が残っていないので触りません（手で直した後のようです）。' : `取り消せません（${r.reason}）`
  }
  await $.fs.write(s.file, r.text)
  const after = await readFile($, s.file)
  if (after === undefined || hasLine(after, rec.section, rec.line)) return '書き込み後の確認に失敗しました。'
  await markUndone($, s.repoKey, rec.id)
  await addDiscarded($, s.repoKey, [{ text: rec.text, section: rec.section, reason: 'undone' }], await $.clock.now())
  await refreshNotice($, after)
  return `取り消しました: [${rec.section}] ${rec.text}`
}

async function adoptDiscarded($: EngineInterface, index: number): Promise<string> {
  const s = await read($, sessionAtom)
  if (s.file === null || s.repoKey === null) return 'LEARNINGS.md がありません。'
  const list = [...(await getDiscarded($, s.repoKey))].reverse().filter(x => x.text !== '')
  const item = list[index - 1]
  if (item === undefined) return `捨てた候補 ${index} 番はありません。`
  const section = isSection(item.section) ? item.section : 'Domain Knowledge'
  const candidate: Candidate = {
    id: 'adopt',
    section,
    text: item.text,
    evidence: `（捨てた候補から人が採用: ${item.reason}）`,
    evidenceKind: 'user-correction',
  }
  const result = await writeCandidates(
    $,
    {
      file: s.file,
      dir: dirOf(s.file),
      repoKey: s.repoKey,
      sessionId: await $.session.id(),
      // 人の採用なので判定は通さない。同じ行の重複だけ writer が落とす
      rejudge: async cands => new Map(cands.map(c => [c.id, { verdict: 'auto' as const, reason: 'adopted' }])),
      fromPending: false,
    },
    [candidate],
  )
  if (result.written.length > 0) {
    await removeDiscarded($, s.repoKey, item.key)
    await noteWritten($, result.written, false)
    return `採用しました: [${section}] ${item.text}`
  }
  if (result.pending.length > 0) {
    await setPending($, s.repoKey, [...(await getPending($, s.repoKey)), ...result.pending])
    return `保留にしました（${result.note ?? ''}）`
  }
  return `採用できませんでした（${result.dropped.map(d => d.detail ?? d.reason).join(', ')}）`
}

async function initFile($: EngineInterface, cwd: string, fix: boolean): Promise<string> {
  const repo = await $.session.repo().catch(() => null)
  const root = repo?.root ?? cwd
  const path = `${root}/${FILE_NAME}`
  const exists = await $.fs.exists(path).catch(() => false)
  if (exists) {
    const text = (await readFile($, path)) ?? ''
    const parsed = parse(text)
    if (parsed.ok) return `${path} はすでにあります（5見出し揃っています）。`
    if (parsed.reason === 'conflict-markers') return `${path} に競合マーカーがあります。解消してから実行してください。`
    const missing = parsed.missing ?? []
    if (!fix) {
      return [
        `${path} はありますが、見出しが足りません: ${missing.join(', ')}`,
        '末尾に足してよければ `/learnings init --fix` を実行してください。',
      ].join('\n')
    }
    const extra = missing.map(h => `\n## ${h}\n`).join('')
    await $.fs.write(path, text.replace(/\s*$/, '\n') + extra)
  } else {
    const template = await readFile($, `${$.plugin.root}/templates/${FILE_NAME}`)
    if (template === undefined) return 'テンプレートを読めませんでした。'
    await $.fs.write(path, template)
  }
  await detect($, cwd)
  return `${path} を${exists ? '補修' : '作成'}しました。このセッションから学びを記録します。`
}

async function statusText($: EngineInterface): Promise<string> {
  const s = await read($, sessionAtom)
  const text = s.file !== null ? await readFile($, s.file) : undefined
  const ex = await read($, extractionAtom)
  const last = text !== undefined ? lastConsolidated(text) : undefined
  const usage = await $.session.usage().catch(() => undefined)
  return formatStatus({
    file: s.file,
    observations: text !== undefined ? countObservations(text) : 0,
    lastConsolidated: last,
    daysSince: last !== undefined ? daysBetween(localDate(await $.clock.now()), last) : undefined,
    extraction: { runs: ex.runs, usage: ex.usage, isPending: ex.isPending, isRunning: ex.isRunning },
    rateLimits: usage?.rateLimits ?? [],
    appended: s.repoKey !== null ? await getAppended($, s.repoKey) : [],
    pending: s.repoKey !== null ? await getPending($, s.repoKey) : [],
    discarded: s.repoKey !== null ? await getDiscarded($, s.repoKey) : [],
    thresholds: { count: options.noticeCount, days: options.noticeDays },
    principlesVia: principlesVia(),
  })
}

async function runCommand($: EngineInterface, args: string): Promise<string> {
  const [verb = '', arg = ''] = args.trim().split(/\s+/)
  const s = await read($, sessionAtom)

  if (verb === 'init') return initFile($, await $.session.cwd(), arg === '--fix')

  if (verb === 'now') {
    if (s.file === null) return 'LEARNINGS.md がありません。`/learnings init` で作れます。'
    return extractNow($, true)
  }

  if (verb === 'undo') {
    if (s.repoKey === null) return 'LEARNINGS.md がありません。'
    const n = arg === '' ? 1 : Number.parseInt(arg, 10)
    const list = [...(await getAppended($, s.repoKey))].reverse()
    const rec = list[n - 1]
    if (!Number.isInteger(n) || n < 1 || rec === undefined) {
      return `取り消す追記 ${arg || 1} 番はありません。\`/learnings\` で番号を確認してください。`
    }
    return undoRecord($, rec)
  }

  if (verb === 'adopt') {
    const n = Number.parseInt(arg, 10)
    if (!Number.isInteger(n) || n < 1) return '`/learnings adopt <番号>` の形で指定してください。番号は `/learnings` の「捨てた候補」の一覧。'
    return adoptDiscarded($, n)
  }

  if (verb === 'commit') return commitLearnings($)

  if (verb !== '') return `不明な引数: ${verb}。使えるのは now / undo [n] / adopt <n> / commit / init`
  return statusText($)
}

// ---- commit ---------------------------------------------------------------------

// Claude の `git commit` には手を出さない（裏で index を変えると、Claude が見た diff と commit の中身がずれる）。
// LEARNINGS.md は人が `/learnings commit` を打ったときだけ、それ単独の commit にする。
async function commitLearnings($: EngineInterface): Promise<string> {
  const s = await read($, sessionAtom)
  if (s.file === null) return 'LEARNINGS.md がありません。`/learnings init` で作れます。'
  const run = (argv: readonly string[], init?: { cwd?: string; timeoutMs?: number }) => $.process.run(argv, init)
  const dir = dirOf(s.file)
  if (!(await hasChanges(run, dir, s.file))) return `${s.file} に未 commit の変更はありません。`
  if (!(await commitOnly(run, dir, s.file, COMMIT_MESSAGE))) {
    return `commit できませんでした。\`git -C ${dir} status\` で状態を確認してください。`
  }
  return `${s.file} だけを commit しました（「${COMMIT_MESSAGE}」）。他にステージしていたファイルはそのままです。`
}

// ---- 学びの反映（統合） -------------------------------------------------------

async function reflect($: EngineInterface): Promise<void> {
  if ((await read($, noticeAtom)).isReflecting) return
  await update($, noticeAtom, n => ({ ...n, isReflecting: true }))
  playSound($, 'sounds/press.wav')
  try {
    pendingCursor = undefined
    const history = await collectHistory($).catch((err): HistoryHandoff => ({ kind: 'none', reason: String(err) }))
    await $.prompt.submit({ text: buildConsolidatePrompt(history) })
  } catch (err) {
    await update($, noticeAtom, n => ({ ...n, isReflecting: false }))
    throw err
  }
}

/** ~/.claude/projects（CLAUDE_CONFIG_DIR があればその下）。jsonl の場所が分かっていればそこから取る */
async function projectsRoot($: EngineInterface): Promise<string | undefined> {
  if (transcriptPath !== undefined) return dirOf(dirOf(transcriptPath))
  const config = await $.env.get('CLAUDE_CONFIG_DIR').catch(() => undefined)
  if (config !== undefined && config !== '') return `${config.replace(/[\\/]+$/, '')}/projects`
  const home = (await $.env.get('HOME').catch(() => undefined)) || (await $.env.get('USERPROFILE').catch(() => undefined))
  return home !== undefined && home !== '' ? `${home.replace(/[\\/]+$/, '')}/.claude/projects` : undefined
}

/**
 * 前回の反映以降の、このリポジトリのセッションの会話履歴を抜粋にして .git の中に書く。
 * 読めなければ、Claude に自分で読ませるためにフォルダの場所を返す。
 */
async function collectHistory($: EngineInterface): Promise<HistoryHandoff> {
  const s = await read($, sessionAtom)
  const common = s.repoKey?.replace(/[\\/]+$/, '')
  if (common === undefined || !/[\\/]\.git$/.test(common)) return { kind: 'none', reason: 'Git の作業フォルダが分からない' }
  const mainRoot = dirOf(common)
  const now = await $.clock.now()
  const since = (await getHistoryCursor($, common)) ?? now - DEFAULT_WINDOW_MS
  const root = await projectsRoot($)
  if (root === undefined) return { kind: 'none', reason: 'ホームフォルダが分からない' }
  const prefix = encodeProjectDir(mainRoot)
  const folder = (reason: string): HistoryHandoff => ({ kind: 'folder', dir: `${root}/${prefix}`, since: localDate(since), reason })

  let dirs: string[]
  try {
    dirs = (await $.fs.list(root)).filter(e => e.kind === 'dir' && e.name.startsWith(prefix)).map(e => `${root}/${e.name}`)
  } catch (err) {
    return folder(`履歴のフォルダを読めない: ${String(err)}`)
  }
  const roots = [mainRoot, ...(await worktreeRoots((argv, init) => $.process.run(argv, init), mainRoot))]

  const excerpts: TranscriptExcerpt[] = []
  const unread: Unread[] = []
  for (const dir of dirs) {
    const entries = await $.fs.list(dir).catch(() => [])
    for (const f of entries) {
      if (f.kind !== 'file' || !f.name.endsWith('.jsonl') || f.mtimeMs <= since) continue
      const path = `${dir}/${f.name}`
      if (f.size > MAX_READ_BYTES) {
        unread.push({ path, size: f.size })
        continue
      }
      const text = await readFile($, path)
      if (text === undefined) continue
      const x = parseTranscript(text, since)
      if (x.cwd !== undefined && isInside(x.cwd, roots)) excerpts.push(x)
    }
  }

  const digest = buildDigest(excerpts, unread, DIGEST_CHARS)
  if (digest.prompts === 0 && unread.length === 0) return { kind: 'none', reason: '前回以降の発言なし' }
  const path = `${common}/learnings-loop/history.md`
  try {
    await $.fs.write(path, digest.text)
  } catch (err) {
    return folder(`抜粋を書けない: ${String(err)}`)
  }
  pendingCursor = digest.lastAt
  return { kind: 'digest', path, sessions: digest.sessions, prompts: digest.prompts, dropped: digest.dropped, unread: unread.length }
}

/** 反映のターンが終わったら、件数を読み直して音と通知で知らせる。 */
async function reflected($: EngineInterface, isAborted: boolean): Promise<void> {
  await update($, noticeAtom, n => ({ ...n, isReflecting: false }))
  const s = await read($, sessionAtom)
  const cursor = pendingCursor
  pendingCursor = undefined
  if (!isAborted && cursor !== undefined && s.repoKey !== null) await setHistoryCursor($, s.repoKey.replace(/[\\/]+$/, ''), cursor)
  const text = s.file !== null ? await readFile($, s.file) : undefined
  if (text !== undefined) await refreshNotice($, text)
  if (isAborted) return
  playSound($, 'sounds/done.wav')
  $.ui.toast('✨ 学びを反映しました')
}

function playSound($: EngineInterface, asset: string): void {
  void $.audio.play({ asset }).catch(err => $.ui.log(`sound: ${String(err)}`, { to: 'debug' }))
}

/** 帯の行の形（git-band と揃える）: 左に 📚・名前・薄い詳細、右端にボタン */
function bandRow($: EngineInterface, e: RenderInput, details: string, actions: RenderElement): RenderElement {
  const { Box, Text } = $.ui.resolve(e)
  return (
    <Box width="100%" flexWrap="wrap" justifyContent="space-between" alignItems="center" columnGap="md">
      <Box columnGap="xs">
        <Text>📚</Text>
        <Text bold>学び</Text>
        <Text dimColor>· {details}</Text>
      </Box>
      {actions}
    </Box>
  )
}

/** 帯は全 Mod で1本。下の Mod が描いた行（below）があれば消さずに、少し間を空けて自分の行の下へ積む */
function stack($: EngineInterface, e: RenderInput, below: RenderElement, mine: RenderElement): RenderElement {
  if (below.type === 'engine') return mine
  const { Box } = $.ui.resolve(e)
  return (
    <Box flexDirection="column" rowGap="sm">
      {mine}
      {below}
    </Box>
  )
}

// ---- 配線 ---------------------------------------------------------------------

export const register: Register = (on, rawOptions) => {
  options = readOptions(rawOptions)

  on('session.start', async ($, e, next) => {
    turn = { edits: 0, errors: 0, editedLearnings: false }
    criteriaText = (await readFile($, `${$.plugin.root}/criteria/CRITERIA.md`)) ?? ''

    await $.command.register({
      name: 'learnings',
      description: 'learnings-loop の状況・取り消し・今すぐ抽出・LEARNINGS.md の作成',
      argumentHint: '[now|undo [n]|adopt <n>|commit|init]',
    })

    await detect($, e.cwd)

    // 作業ブランチで保留していた分を、最新のファイルに対して再判定して書く
    await consumePending($).catch(err => $.ui.log(`consumePending: ${String(err)}`, { to: 'debug' }))

    // 抽出は turn.complete の中でなく、session.start 由来のタイマーから走らせる（V5）
    poller?.cancel()
    poller = $.clock.every(1500, () => {
      void extractNow($, false).catch(err => $.ui.log(`extract: ${String(err)}`, { to: 'debug' }))
    })

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear') {
      await update($, extractionAtom, x => ({ ...x, processedUpTo: 0, isPending: false }))
      await update($, appendedAtom, () => ({ count: 0, fromPending: 0 }))
      await update($, sessionAtom, s => ({ ...s, hasPrompted: false }))
      turn = { edits: 0, errors: 0, editedLearnings: false }
      lastTurns = 0
      composeSeen = false
      promptInjected = false
    }
    return next(e)
  })

  // 会話圧縮の後は、フォークから見える範囲と処理済み位置が一致しないのでリセット。
  // 組織の管理設定がある環境では cc-plugin-sec-default がこの hook を飛ばすので、本命は turn.start の検知（下）
  on('session.compact', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      const turns = await $.session.turns().catch(() => 0)
      await update($, extractionAtom, x => ({ ...x, processedUpTo: turns }))
    }
    return r
  })

  // 原則の注入（本線）: システムプロンプトに足す
  on('prompt.compose', async ($, e, next) => {
    composeSeen = true
    const r = await next(e)
    const s = await read($, sessionAtom)
    if (s.file === null || !options.injectPrinciples) return r
    return { sections: [...r.sections, { id: SECTION_ID, text: principlesBlock(s.file), scope: 'session' as const }] }
  })

  // 観察
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      turn = { edits: 0, errors: 0, editedLearnings: false }
      await noteCompaction($)
    }
    return next(e)
  })

  // 原則の注入（代替）: prompt.compose が届かない環境のために、人の発言に context（モデルだけが読む添付。表示には出ない）で渡す。
  // 最初の発言と、会話圧縮のあとの最初の発言に1回ずつ。prompt.compose が一度でも届いていれば（システムプロンプトにある）渡さない。
  // 最初の発言の時点では compose が届くか分からないので、どちらの環境でも最初の1回は添付する（届く環境では1回だけ重なる）
  on('prompt.submit', async ($, e, next) => {
    if (!e.isMeta) await update($, sessionAtom, s => (s.hasPrompted ? s : { ...s, hasPrompted: true }))
    if (e.isMeta || e.command !== undefined || !options.injectPrinciples || composeSeen) return next(e)
    const s = await read($, sessionAtom)
    if (s.file === null) return next(e)
    if (promptInjected) {
      // turn.start より先に来るので、圧縮の検知（turns が前回より減った）をここでも見る
      const turns = await $.session.turns().catch(() => undefined)
      if (turns === undefined || turns >= lastTurns) return next(e)
    }
    promptInjected = true
    $.ui.log('principles attached to the prompt (prompt.compose has not reached this mod)', { to: 'debug' })
    return next({ ...e, context: [...(e.context ?? []), principlesBlock(s.file)] })
  })

  // 反映で会話履歴を探すために、今のセッションの jsonl の場所を覚える（届かない環境では環境変数から求める）
  on('classic.UserPromptSubmit', async ($, e, next) => {
    if (typeof e.transcript_path === 'string' && e.transcript_path !== '') transcriptPath = e.transcript_path
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (e.agentId !== undefined) return ran
    const tool = String(e.tool)
    const isError = ran.deny === undefined && ran.isError === true
    if (isError) turn.errors++
    else if (EDIT_TOOLS.has(tool) && ran.deny === undefined) {
      turn.edits++
      const path = (e as { file_path?: unknown }).file_path
      if (typeof path === 'string' && isLearningsPath(path)) turn.editedLearnings = true
    }
    return ran
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined && (await read($, noticeAtom)).isReflecting) await reflected($, e.isAborted)
    // Claude が自分で LEARNINGS.md を書いたターンは、そこまでを処理済みにして抽出しない（二重の追記を防ぐ）
    if (e.agentId === undefined && !e.isAborted && turn.editedLearnings) {
      const turns = await $.session.turns()
      await update($, extractionAtom, x => ({ ...x, isPending: false, processedUpTo: turns }))
      $.ui.log('turn edited LEARNINGS.md itself; skipping extraction', { to: 'debug' })
      return next(e)
    }
    if (e.agentId === undefined && !e.isAborted && options.extraction === 'auto') {
      const s = await read($, sessionAtom)
      if (s.file !== null && (turn.edits > 0 || turn.errors > 0)) {
        await update($, extractionAtom, x => ({ ...x, isPending: true }))
      }
    }
    return next(e)
  })

  // 帯: 件数と「追記内容を見る」「学びを反映」。LEARNINGS.md がなければ、最初のプロンプトまで init を案内する
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const s = await read($, sessionAtom)
    if (s.file === null) {
      const repoKey = s.initOfferFor
      if (repoKey === null || s.hasPrompted || e.props.isWorking) return next(e)
      const { Box, Button } = $.ui.resolve(e)
      return stack(
        $,
        e,
        await next(e),
        bandRow(
          $,
          e,
          'このリポジトリに LEARNINGS.md がありません',
          <Box columnGap="sm" alignItems="center">
            <Button
              key="init"
              variant="primary"
              label="📝 作って学びを記録する"
              onPress={() => {
                void $.session
                  .cwd()
                  .then(cwd => initFile($, cwd, false))
                  .then(msg => $.ui.toast(msg))
              }}
            />
            <Button
              key="declineInit"
              variant="secondary"
              label="このリポジトリでは聞かない"
              onPress={() => {
                void declineInit($, repoKey)
                void update($, sessionAtom, x => ({ ...x, initOfferFor: null }))
              }}
            />
          </Box>,
        ),
      )
    }
    const appended = await read($, appendedAtom)
    const notice = await read($, noticeAtom)
    if (e.props.isWorking && !notice.isReflecting) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const n = appended.count + appended.fromPending
    const parts = [`観察 ${notice.observations}件`]
    if (n > 0) parts.push(appended.fromPending > 0 && appended.count === 0 ? `保留していた ${n}件を追記` : `今セッション +${n}`)
    if (notice.isDue && !notice.isReflecting) {
      parts.push(`そろそろ反映どき${notice.daysSince !== undefined ? `（前回から ${notice.daysSince}日）` : ''}`)
    }
    const actions = notice.isReflecting ? (
      <Text dimColor>✨ 学びを反映しています…</Text>
    ) : (
      <Box columnGap="sm" alignItems="center">
        <Button
          key="view"
          variant="secondary"
          label="📖 追記内容を見る"
          onPress={() => {
            void runCommand($, '').then(text => $.ui.log(text))
          }}
        />
        <Button
          key="reflect"
          variant={notice.isDue ? 'primary' : 'secondary'}
          label="✨ 学びを反映"
          onPress={() => {
            void reflect($).catch(err => $.ui.log(`reflect: ${String(err)}`, { to: 'debug' }))
          }}
        />
      </Box>
    )
    return stack($, e, await next(e), bandRow($, e, parts.join(' · '), actions))
  })

  on('command.run', { command: 'learnings' }, async ($, e) => ({ text: await runCommand($, e.args) }))
}
