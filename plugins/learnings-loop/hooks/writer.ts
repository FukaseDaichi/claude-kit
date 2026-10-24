// 単一の書き込み処理（設計 §5.8）。自動追記・採用・保留消化はすべてここを通す。

import type { EngineInterface } from 'claude-code'

import type { Candidate, Dropped, Verdict } from './candidates'
import { currentBranch } from './git'
import { appendLine, formatLine, hasLine, hash, localDate, parse } from './learnings-file'
import { addAppended, addDiscarded, type AppendedRecord, type PendingCandidate } from './store'

export type Rejudge = (
  candidates: readonly Candidate[],
  learningsText: string,
) => Promise<Map<string, { verdict: Verdict; reason: string }>>

export type WriteContext = {
  file: string
  dir: string
  repoKey: string
  sessionId: string
  /** 2段目の判定時に読んだ内容のハッシュ。保留消化のときは undefined（必ず再判定） */
  expectedHash?: string
  rejudge: Rejudge
  fromPending: boolean
}

export type WriteResult = {
  written: AppendedRecord[]
  pending: PendingCandidate[]
  dropped: Dropped[]
  /** 人に見せる理由（保留に回したとき） */
  note?: string
}

export async function writeCandidates(
  $: EngineInterface,
  ctx: WriteContext,
  candidates: readonly Candidate[],
): Promise<WriteResult> {
  const now = await $.clock.now()
  const out: WriteResult = { written: [], pending: [], dropped: [] }
  if (candidates.length === 0) return out

  const toPending = (list: readonly Candidate[], why: PendingCandidate['why'], branch?: string) => {
    for (const c of list) {
      out.pending.push({
        ...c,
        createdAt: now,
        branch,
        sessionId: ctx.sessionId,
        why,
      })
    }
  }

  // 1. 今いるブランチ（worktree を含む）のファイルにそのまま書く。ブランチ名は記録用
  const branch = await currentBranch((argv, init) => $.process.run(argv, init), ctx.dir)

  let remaining = [...candidates]
  for (let attempt = 0; attempt < 2 && remaining.length > 0; attempt++) {
    // 2. 読み直しと検証
    let text: string
    try {
      text = await $.fs.read(ctx.file)
    } catch {
      toPending(remaining, 'write-failed', branch)
      out.note = 'LEARNINGS.md を読めなかったため保留'
      return out
    }
    const parsed = parse(text)
    if (!parsed.ok) {
      toPending(remaining, 'write-failed', branch)
      out.note =
        parsed.reason === 'conflict-markers'
          ? 'LEARNINGS.md に競合マーカーがあるため保留'
          : `LEARNINGS.md の見出しが揃っていないため保留（${(parsed.missing ?? []).join(', ')}）`
      return out
    }

    // 3. 変化の検出（楽観ロック）: 判定時と違う内容なら再判定
    const current = hash(text)
    if (ctx.expectedHash === undefined || ctx.expectedHash !== current || attempt > 0) {
      const verdicts = await ctx.rejudge(remaining, text)
      const kept: Candidate[] = []
      for (const c of remaining) {
        const v = verdicts.get(c.id)
        if (v?.verdict === 'auto') kept.push(c)
        else out.dropped.push({ text: c.text, reason: v === undefined ? 'unjudged' : 'duplicate', detail: v?.reason })
      }
      remaining = kept
      if (remaining.length === 0) break
    }

    // 4. 追記（メモリ上で順に足してから1回で書く）
    const date = localDate(now)
    let next = text
    const lines: { c: Candidate; line: string }[] = []
    for (const c of remaining) {
      const line = formatLine(date, c.text)
      if (hasLine(next, c.section, line)) {
        out.dropped.push({ text: c.text, reason: 'duplicate', detail: 'same line already present' })
        continue
      }
      const r = appendLine(next, c.section, line)
      if (!r.ok) {
        out.dropped.push({ text: c.text, reason: 'invalid', detail: r.reason })
        continue
      }
      next = r.text
      lines.push({ c, line })
    }
    if (lines.length === 0) {
      remaining = []
      break
    }
    await $.fs.write(ctx.file, next)

    // 5. 書いた直後の確認
    let after: string
    try {
      after = await $.fs.read(ctx.file)
    } catch {
      after = ''
    }
    const verified = parse(after).ok && lines.every(({ c, line }) => hasLine(after, c.section, line))
    const expectedLines = after.split('\n').length === next.split('\n').length
    if (!verified || !expectedLines) {
      // 書き込みの間に別プロセスが書いた等。1回だけやり直す
      remaining = lines.map(l => l.c)
      continue
    }

    // 6. 記録
    for (const { c, line } of lines) {
      const record: AppendedRecord = {
        id: `${now.toString(36)}-${c.id}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        section: c.section,
        line,
        text: c.text,
        evidence: c.evidence,
        evidenceKind: c.evidenceKind,
        at: now,
        sessionId: ctx.sessionId,
        branch,
        fromPending: ctx.fromPending,
      }
      await addAppended($, ctx.repoKey, record)
      out.written.push(record)
    }
    remaining = []
  }

  if (remaining.length > 0) {
    toPending(remaining, 'write-failed', branch)
    out.note = '書き込み後の確認に2回失敗したため保留'
  }
  await addDiscarded(
    $,
    ctx.repoKey,
    out.dropped.filter(d => d.reason === 'duplicate').map(d => ({ text: d.text, section: '', reason: d.reason, detail: d.detail })),
    now,
  )
  return out
}
