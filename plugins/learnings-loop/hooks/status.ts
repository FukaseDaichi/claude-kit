// `/learnings` の表示文（モデルを通さない）。純粋関数。

import type { AppendedRecord, DiscardedCandidate, PendingCandidate } from './store'

export type StatusData = {
  file: string | null
  observations: number
  lastConsolidated?: string
  daysSince?: number
  extraction: { runs: number; usage: { input: number; output: number; cacheRead: number; cacheWrite: number }; isPending: boolean; isRunning: boolean }
  rateLimits: readonly { kind: string; percentUsed: number; resetsAt?: string }[]
  appended: readonly AppendedRecord[]
  pending: readonly PendingCandidate[]
  discarded: readonly DiscardedCandidate[]
  thresholds: { count: number; days: number }
}

const REASON_JA: Record<string, string> = {
  duplicate: '重複',
  rejected: '判定で不採用',
  undone: '取り消し',
  expired: '期限切れ',
  secret: '機密',
  invalid: '形式不正',
  unjudged: '判定不能',
  unverified: '根拠が未確認',
}

export function formatStatus(d: StatusData): string {
  if (d.file === null) {
    return [
      '📚 learnings-loop: このリポジトリに LEARNINGS.md がありません。',
      '`/learnings init` で5見出しのテンプレートを作れます。',
    ].join('\n')
  }
  const lines: string[] = []
  lines.push(`📚 learnings-loop — ${d.file}`)
  const since = d.lastConsolidated !== undefined ? `最終統合 ${d.lastConsolidated}（${d.daysSince ?? '?'}日前）` : '最終統合: 記録なし'
  const due = d.observations >= d.thresholds.count || (d.daysSince ?? 0) > d.thresholds.days
  lines.push(`生の観察 ${d.observations} 件 ・ ${since}${due ? ' ・ 統合の時期です（/learnings-loop:consolidate-learnings）' : ''}`)

  const u = d.extraction.usage
  const state = d.extraction.isRunning ? '抽出中' : d.extraction.isPending ? '抽出待ち' : '待機'
  lines.push(`今セッションの抽出: ${d.extraction.runs} 回（${state}）・ 新規 ${u.input} / 出力 ${u.output} / キャッシュ読込 ${u.cacheRead} / 書込 ${u.cacheWrite} tok`)
  const five = d.rateLimits.find(r => r.kind === 'five_hour')
  const week = d.rateLimits.find(r => r.kind === 'seven_day')
  if (five !== undefined || week !== undefined) {
    const parts: string[] = []
    if (five !== undefined) parts.push(`5時間枠 ${five.percentUsed}% 使用`)
    if (week !== undefined) parts.push(`7日枠 ${week.percentUsed}% 使用`)
    lines.push(`レート制限: ${parts.join(' ・ ')}`)
  }

  const recent = [...d.appended].reverse().slice(0, 10)
  lines.push('')
  lines.push(`直近の自動追記（${recent.length} 件表示 / 取り消しは \`/learnings undo <番号>\`）`)
  if (recent.length === 0) lines.push('  （なし）')
  recent.forEach((r, i) => {
    const flag = r.isUndone ? ' [取り消し済み]' : r.fromPending ? ' [保留分]' : ''
    lines.push(`  ${i + 1}. [${r.section}] ${r.text}${flag}`)
    if (r.evidence !== '') lines.push(`     根拠(${r.evidenceKind}): ${r.evidence.slice(0, 120)}`)
  })

  if (d.pending.length > 0) {
    lines.push('')
    lines.push(`保留中（${d.pending.length} 件。既定ブランチで次にセッションを始めたときに再判定して書きます）`)
    d.pending.slice(0, 10).forEach(p => {
      const why = p.why === 'branch' ? `ブランチ ${p.branch ?? '?'}` : p.why === 'cap' ? 'セッション上限' : '書き込み失敗'
      lines.push(`  - [${p.section}] ${p.text}（${why}）`)
    })
  }

  const dropped = [...d.discarded].reverse().filter(x => x.text !== '').slice(0, 10)
  lines.push('')
  lines.push(`捨てた候補（直近 ${dropped.length} 件 / 採用は \`/learnings adopt <番号>\`）`)
  if (dropped.length === 0) lines.push('  （なし）')
  dropped.forEach((x, i) => {
    lines.push(`  ${i + 1}. ${x.text}（${REASON_JA[x.reason] ?? x.reason}${x.detail ? `: ${x.detail.slice(0, 60)}` : ''}）`)
  })

  lines.push('')
  lines.push('コマンド: `/learnings now`（今すぐ抽出）・`/learnings undo [番号]`・`/learnings adopt <番号>`・`/learnings init`')
  return lines.join('\n')
}
