// LEARNINGS.md の読み書きに関する純粋関数。I/O は持たない。

export const SECTIONS = [
  'Patterns That Work',
  'Mistakes to Avoid',
  'Domain Knowledge',
  'Open Questions',
] as const

export type Section = (typeof SECTIONS)[number]

export const CONSOLIDATED = 'Consolidated Principles'

export const ALL_HEADINGS: readonly string[] = [...SECTIONS, CONSOLIDATED]

export const FILE_NAME = 'LEARNINGS.md'

/** そのパスが LEARNINGS.md か（`/` と `\` のどちらの区切りでも、末尾のファイル名で見る）。 */
export function isLearningsPath(path: string): boolean {
  const name = path.split(/[\\/]/).pop()
  return name === FILE_NAME
}

const CONFLICT = /^(<{7}|={7}|>{7})( |$)/m

export type Parsed =
  | { ok: true; lines: string[]; headingAt: Record<string, number> }
  | { ok: false; reason: 'missing-headings' | 'conflict-markers'; missing?: string[] }

/** 見出し5つが揃い、競合マーカーがないことを確かめて行配列にする。 */
export function parse(text: string): Parsed {
  if (CONFLICT.test(text)) return { ok: false, reason: 'conflict-markers' }
  const lines = text.split('\n')
  const headingAt: Record<string, number> = {}
  lines.forEach((line, i) => {
    const m = /^## (.+?)\s*$/.exec(line)
    if (m && m[1] !== undefined && ALL_HEADINGS.includes(m[1]) && headingAt[m[1]] === undefined) {
      headingAt[m[1]] = i
    }
  })
  const missing = ALL_HEADINGS.filter(h => headingAt[h] === undefined)
  if (missing.length > 0) return { ok: false, reason: 'missing-headings', missing }
  return { ok: true, lines, headingAt }
}

export function isSection(name: string): name is Section {
  return (SECTIONS as readonly string[]).includes(name)
}

/** セクションの範囲 [見出しの次の行, 次の `## ` 見出しの手前) を返す。 */
function sectionRange(lines: string[], start: number): { from: number; to: number } {
  let to = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^## /.test(lines[i] ?? '')) {
      to = i
      break
    }
  }
  return { from: start + 1, to }
}

/** 生の観察の件数: Patterns That Work から Consolidated Principles の手前までの `- ` 行。 */
export function countObservations(text: string): number {
  const parsed = parse(text)
  if (!parsed.ok) return 0
  const from = parsed.headingAt[SECTIONS[0]] ?? 0
  const to = parsed.headingAt[CONSOLIDATED] ?? parsed.lines.length
  let count = 0
  for (let i = from; i < to; i++) if (/^- /.test(parsed.lines[i] ?? '')) count++
  return count
}

/** 冒頭コメントの `最終統合: YYYY-MM-DD` を返す。なければ undefined。 */
export function lastConsolidated(text: string): string | undefined {
  const m = /最終統合[:：]\s*(\d{4}-\d{2}-\d{2})/.exec(text)
  return m?.[1]
}

/** `## Consolidated Principles` の本文（見出しを除く、末尾の空行を落としたもの）。 */
export function principles(text: string): string {
  const parsed = parse(text)
  if (!parsed.ok) return ''
  const start = parsed.headingAt[CONSOLIDATED]
  if (start === undefined) return ''
  const { from, to } = sectionRange(parsed.lines, start)
  return parsed.lines.slice(from, to).join('\n').trim()
}

export function formatLine(date: string, body: string): string {
  return `- ${date}: ${body}`
}

/** 再観測の印。同じ学びが別のセッションで改めて起きた回数（最初の1回は数えない）と最後の日付 */
const REOBSERVED = /\s*（再観測 (\d+)回・最終 (\d{4}-\d{2}-\d{2})）$/

export function reobserved(line: string): { count: number; last: string } | undefined {
  const m = REOBSERVED.exec(line)
  return m?.[1] !== undefined && m[2] !== undefined ? { count: Number(m[1]), last: m[2] } : undefined
}

/** 再観測の印を除いた行（同じ項目かどうかを見るのに使う） */
export function withoutReobserved(line: string): string {
  return line.replace(REOBSERVED, '')
}

/** 再観測を1回足した行 */
export function reobserve(line: string, date: string): string {
  const n = (reobserved(line)?.count ?? 0) + 1
  return `${withoutReobserved(line)}（再観測 ${n}回・最終 ${date}）`
}

export type Observation = { id: string; section: Section; line: string }

/** 生の観察（上4セクションの `- ` 行）に、上から L1, L2, … の ID を振る */
export function observations(text: string): Observation[] {
  const parsed = parse(text)
  if (!parsed.ok) return []
  const out: Observation[] = []
  for (const section of SECTIONS) {
    const start = parsed.headingAt[section]
    if (start === undefined) continue
    const { from, to } = sectionRange(parsed.lines, start)
    for (let i = from; i < to; i++) {
      const line = parsed.lines[i] ?? ''
      if (/^- /.test(line)) out.push({ id: `L${out.length + 1}`, section, line })
    }
  }
  return out
}

export type AppendResult =
  | { ok: true; text: string; lineIndex: number }
  | { ok: false; reason: 'missing-headings' | 'conflict-markers' | 'unknown-section' }

/**
 * セクションの最後の `- ` 項目の直後に1行足す。項目がなければ見出し直後の説明行
 * （`（…）`）の後に足す。前後の空行はそのセクションの既存項目の並びに合わせる。
 */
export function appendLine(text: string, section: Section, line: string): AppendResult {
  const parsed = parse(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  const start = parsed.headingAt[section]
  if (start === undefined) return { ok: false, reason: 'unknown-section' }
  const lines = [...parsed.lines]
  const { from, to } = sectionRange(lines, start)

  let lastItem = -1
  let prevItem = -1
  for (let i = from; i < to; i++) {
    if (/^- /.test(lines[i] ?? '')) {
      prevItem = lastItem
      lastItem = i
    }
  }

  if (lastItem >= 0) {
    // 既存項目の間に空行があるなら空行を挟む
    const blankBetween = prevItem >= 0 && lines.slice(prevItem + 1, lastItem).some(l => l.trim() === '')
    // 複数行に続く項目（インデントされた続き行）の末尾まで進める
    let insertAt = lastItem + 1
    while (insertAt < to && /^\s+\S/.test(lines[insertAt] ?? '')) insertAt++
    const inserted = blankBetween ? ['', line] : [line]
    lines.splice(insertAt, 0, ...inserted)
    return { ok: true, text: lines.join('\n'), lineIndex: insertAt + inserted.length - 1 }
  }

  // 項目がない: 見出し直後の説明行（（…）で始まる行）の後に、空行を挟んで足す
  let insertAt = from
  while (insertAt < to && (lines[insertAt] ?? '').trim() === '') insertAt++
  if (insertAt < to && /^[（(]/.test(lines[insertAt] ?? '')) insertAt++
  const inserted = ['', line]
  // 次の見出し（またはファイル末尾）との間に空行が1つ残るようにする
  const after = lines[insertAt]
  if (insertAt >= to || (after !== undefined && after.trim() !== '')) inserted.push('')
  lines.splice(insertAt, 0, ...inserted)
  return { ok: true, text: lines.join('\n'), lineIndex: insertAt + 1 }
}

export type RemoveResult =
  | { ok: true; text: string }
  | { ok: false; reason: 'not-found' | 'missing-headings' | 'conflict-markers' | 'unknown-section' }

/** そのセクションに同じ文字列の行が残っているときだけ、その1行を消す。 */
export function removeLine(text: string, section: Section, line: string): RemoveResult {
  const parsed = parse(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  const start = parsed.headingAt[section]
  if (start === undefined) return { ok: false, reason: 'unknown-section' }
  const lines = [...parsed.lines]
  const { from, to } = sectionRange(lines, start)
  for (let i = from; i < to; i++) {
    if (lines[i] === line) {
      lines.splice(i, 1)
      // 消した結果、空行が2つ続くなら1つに畳む
      if ((lines[i - 1] ?? 'x').trim() === '' && (lines[i] ?? 'x').trim() === '') lines.splice(i, 1)
      return { ok: true, text: lines.join('\n') }
    }
  }
  return { ok: false, reason: 'not-found' }
}

/** そのセクションに同じ文字列の行が残っているときだけ、その1行を置き換える。 */
export function replaceLine(text: string, section: Section, line: string, replacement: string): RemoveResult {
  const parsed = parse(text)
  if (!parsed.ok) return { ok: false, reason: parsed.reason }
  const start = parsed.headingAt[section]
  if (start === undefined) return { ok: false, reason: 'unknown-section' }
  const lines = [...parsed.lines]
  const { from, to } = sectionRange(lines, start)
  for (let i = from; i < to; i++) {
    if (lines[i] === line) {
      lines[i] = replacement
      return { ok: true, text: lines.join('\n') }
    }
  }
  return { ok: false, reason: 'not-found' }
}

/** そのセクションにその行があるか。 */
export function hasLine(text: string, section: Section, line: string): boolean {
  const parsed = parse(text)
  if (!parsed.ok) return false
  const start = parsed.headingAt[section]
  if (start === undefined) return false
  const { from, to } = sectionRange(parsed.lines, start)
  return parsed.lines.slice(from, to).includes(line)
}

/** FNV-1a 32bit。変化の検出にだけ使う（暗号用途ではない）。 */
export function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}

/** その端末の現地日付を YYYY-MM-DD で。 */
export function localDate(nowMs: number): string {
  const d = new Date(nowMs)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** 2つの YYYY-MM-DD の差を日数で（a - b）。どちらかが不正なら undefined。 */
export function daysBetween(a: string, b: string): number | undefined {
  const ta = Date.parse(`${a}T00:00:00Z`)
  const tb = Date.parse(`${b}T00:00:00Z`)
  if (Number.isNaN(ta) || Number.isNaN(tb)) return undefined
  return Math.floor((ta - tb) / 86_400_000)
}
