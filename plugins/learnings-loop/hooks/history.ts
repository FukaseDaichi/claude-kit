// 「学びを反映」に渡す会話履歴の抜粋。~/.claude/projects の jsonl から、利用者の発言と
// その直前の Claude の返答だけを拾う。ここは純粋関数だけ（ファイルの読み書きは register.tsx）。

import { localDate } from './learnings-file'
import { REFLECT_PREFIX } from './prompts'

/** 発言は先頭から、直前の返答は末尾から、この字数で切る */
export const USER_CHARS = 600
export const ASSISTANT_CHARS = 300
/** 抜粋全体の上限。超えたら新しい発言から次の反映に回す */
export const DIGEST_CHARS = 40_000
/** 「どこまで読んだか」の印がないときに読む期間 */
export const DEFAULT_WINDOW_MS = 30 * 86_400_000
/** $.fs.read が読める上限 */
export const MAX_READ_BYTES = 4 * 1024 * 1024

export type Exchange = { at: number; assistant: string; user: string }
export type TranscriptExcerpt = { sessionId: string; cwd?: string; branch?: string; exchanges: Exchange[] }
/** 抜粋に入れられなかったログ。reason がなければ 4 MiB 超 */
export type Unread = { path: string; size: number; reason?: string }
/** deferred は上限のため次の反映に回した発言の数。lastAt はこの日時までの発言をすべて入れた、という印 */
export type Digest = { text: string; sessions: number; prompts: number; deferred: number; lastAt?: number }

type Block = { type?: unknown; text?: unknown; name?: unknown }
type Rec = {
  type?: unknown
  isMeta?: unknown
  origin?: { kind?: unknown }
  timestamp?: unknown
  cwd?: unknown
  gitBranch?: unknown
  sessionId?: unknown
  message?: { content?: unknown }
}

/** 作業フォルダの絶対パスを ~/.claude/projects の下のフォルダ名に変換する（英数字以外を '-' に） */
export function encodeProjectDir(path: string): string {
  return path.replace(/[^A-Za-z0-9]/g, '-')
}

/** jsonl の全文から、since（ms）より後の利用者の発言と、それぞれの直前の返答を拾う */
export function parseTranscript(text: string, since: number): TranscriptExcerpt {
  const out: TranscriptExcerpt = { sessionId: '', exchanges: [] }
  // 最後の発言より後に Claude が書いたテキストと、呼んだツール
  let texts: string[] = []
  let tools: string[] = []
  for (const raw of text.split('\n')) {
    if (raw.trim() === '') continue
    let r: Rec
    try {
      r = JSON.parse(raw) as Rec
    } catch {
      continue
    }
    if (r === null || typeof r !== 'object') continue
    if (out.sessionId === '' && typeof r.sessionId === 'string') out.sessionId = r.sessionId
    if (out.cwd === undefined && typeof r.cwd === 'string') {
      out.cwd = r.cwd
      if (typeof r.gitBranch === 'string') out.branch = r.gitBranch
    }

    const content = r.message?.content
    if (r.type === 'assistant' && Array.isArray(content)) {
      for (const b of content as Block[]) {
        if (b?.type === 'text' && typeof b.text === 'string' && b.text.trim() !== '') texts.push(b.text.trim())
        else if (b?.type === 'tool_use' && typeof b.name === 'string') tools.push(b.name)
      }
      continue
    }

    const user = humanText(r)
    if (user === undefined) continue
    const at = typeof r.timestamp === 'string' ? Date.parse(r.timestamp) : NaN
    const assistant = texts.length > 0 ? tail(texts.join('\n'), ASSISTANT_CHARS) : tools.length > 0 ? `[ツール: ${tools.join(', ')}]` : ''
    texts = []
    tools = []
    if (Number.isNaN(at) || at <= since || user.startsWith(REFLECT_PREFIX)) continue
    out.exchanges.push({ at, assistant, user: head(user, USER_CHARS) })
  }
  return out
}

/** 利用者が打った発言ならその本文。ツールの結果・通知・メタの記録は undefined */
function humanText(r: Rec): string | undefined {
  if (r.type !== 'user' || r.isMeta === true || r.origin?.kind !== 'human') return undefined
  const c = r.message?.content
  if (typeof c === 'string') return c
  if (!Array.isArray(c)) return undefined
  const blocks = c as Block[]
  if (blocks.some(b => b?.type === 'tool_result')) return undefined
  const text = blocks
    .filter(b => b?.type === 'text' && typeof b.text === 'string')
    .map(b => b.text as string)
    .join('\n')
  return text === '' ? undefined : text
}

function head(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n)}…` : s
}

function tail(s: string, n: number): string {
  return s.length > n ? `…${s.slice(-n)}` : s
}

/** path が roots のどれかの中（または同じ）か。区切り・末尾の区切り、Windows のパスの大小を無視する */
export function isInside(path: string, roots: readonly string[]): boolean {
  const p = normPath(path)
  return roots.some(root => {
    const r = normPath(root)
    return p === r || p.startsWith(`${r}/`)
  })
}

function normPath(path: string): string {
  const p = path.replace(/\\/g, '/').replace(/\/+$/, '')
  // ドライブ文字のあるパス（Windows）は大文字小文字を区別しない
  return /^[A-Za-z]:/.test(p) ? p.toLowerCase() : p
}

/**
 * 抜粋の Markdown を作る。maxChars を超えたら、新しい発言から次の反映に回す。
 * 入れるのは「ある日時までの発言すべて」なので、返す lastAt まで読んだとして印を進めても取りこぼさない。
 */
export function buildDigest(excerpts: readonly TranscriptExcerpt[], unread: readonly Unread[], maxChars: number, since?: number): Digest {
  const all = excerpts.flatMap(x => x.exchanges.map(e => e.at))
  const times = [...new Set(all)].sort((a, b) => a - b)
  const upTo = (cutoff: number) => {
    const sessions = excerpts
      .map(x => ({ ...x, exchanges: x.exchanges.filter(e => e.at <= cutoff) }))
      .filter(x => x.exchanges.length > 0)
      .sort((a, b) => firstAt(a) - firstAt(b))
    const prompts = sessions.reduce((n, s) => n + s.exchanges.length, 0)
    const deferred = all.length - prompts
    return { text: render(sessions, unread, deferred, since), sessions: sessions.length, prompts, deferred }
  }
  const last = times[times.length - 1]
  if (last === undefined) return { ...upTo(-Infinity), lastAt: undefined }
  const full = upTo(last)
  if (full.text.length <= maxChars) return { ...full, lastAt: last }
  // 入る範囲でいちばん新しい日時を二分探索で探す。1つも入らなくても、いちばん古い日時の発言は入れる
  let lo = 0
  let hi = times.length - 1
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2)
    if (upTo(times[mid] as number).text.length <= maxChars) lo = mid
    else hi = mid - 1
  }
  const cutoff = times[lo] as number
  return { ...upTo(cutoff), lastAt: cutoff }
}

function firstAt(x: TranscriptExcerpt): number {
  return x.exchanges[0]?.at ?? 0
}

function render(sessions: readonly TranscriptExcerpt[], unread: readonly Unread[], deferred: number, since?: number): string {
  const prompts = sessions.reduce((n, s) => n + s.exchanges.length, 0)
  const lines = ['# 会話履歴の抜粋（learnings-loop）', '']
  const from = since !== undefined ? `${new Date(since).toISOString()} より後の ` : ''
  lines.push(`${from}${sessions.length} セッション・${prompts} 件の発言。${deferred > 0 ? `上限のため、これより後の発言 ${deferred} 件は次の反映に回す。` : ''}`)
  for (const s of sessions) {
    const first = s.exchanges[0]?.at ?? 0
    lines.push('', `## ${[localDate(first), s.branch, s.sessionId.slice(0, 8)].filter(v => v !== undefined && v !== '').join(' · ')}`)
    for (const x of s.exchanges) {
      lines.push('', `### ${localTime(x.at)}`)
      if (x.assistant !== '') lines.push(`- Claude（直前）: ${oneLine(x.assistant)}`)
      lines.push(`- 利用者: ${oneLine(x.user)}`)
    }
  }
  if (unread.length > 0) {
    lines.push('', '## 未読（4 MiB 超・読めなかったもの）')
    for (const u of unread) lines.push(`- ${u.path}（${u.reason ?? `${(u.size / 1024 / 1024).toFixed(1)} MB`}）`)
  }
  return `${lines.join('\n')}\n`
}

function localTime(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function oneLine(s: string): string {
  return s.replace(/\s*\n\s*/g, ' ⏎ ')
}
