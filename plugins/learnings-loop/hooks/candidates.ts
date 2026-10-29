// 1段目（フォーク）と2段目（判定）の出力をコードで検証する純粋関数。

import { isSection, type Section } from './learnings-file'

export const EVIDENCE_KINDS = [
  'error-fixed-verified',
  'error-fixed-unverified',
  'user-correction',
  'approach-changed-verified',
  'research-confirmed',
  'guess',
] as const

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number]

/** 自動追記の候補になりうる根拠の種類。それ以外は2段目に渡さず捨てる。 */
export const AUTO_ELIGIBLE: readonly EvidenceKind[] = [
  'error-fixed-verified',
  'user-correction',
  'approach-changed-verified',
  'research-confirmed',
]

export type Candidate = {
  id: string
  section: Section
  text: string
  evidence: string
  evidenceKind: EvidenceKind
}

export type DropReason =
  | 'duplicate'
  | 'rejected'
  | 'undone'
  | 'expired'
  | 'secret'
  | 'invalid'
  | 'unjudged'
  | 'unverified'
  | 'same-session'

export type Dropped = { text: string; reason: DropReason; detail?: string }

/** 機密情報のパターン。最低限。実装者が足してよい。 */
export const SECRET_PATTERNS: readonly { name: string; re: RegExp }[] = [
  { name: 'anthropic-key', re: /sk-ant-[A-Za-z0-9_-]{8,}/ },
  { name: 'openai-key', re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'bearer', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}/ },
  { name: 'private-key', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: 'email', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/ },
  { name: 'url-query', re: /https?:\/\/[^\s]+\?[^\s]*(token|key|secret|password|sig)=/i },
  { name: 'password', re: /(password|passwd|pwd)\s*[:=]\s*\S{4,}/i },
]

export function findSecret(text: string): string | undefined {
  for (const { name, re } of SECRET_PATTERNS) if (re.test(text)) return name
  return undefined
}

/** 重複判定用の正規化: 空白を畳み、句読点と記号を落とし、小文字にする。 */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .replace(/[「」『』()（）\[\]【】.,。、:：;；!！?？'"`*_~\-–—/\\]/g, '')
    .trim()
}

/** 返答から最初の JSON 値（配列かオブジェクト）を取り出す。コードフェンスがあればその中を優先する。 */
export function extractJson(raw: string): unknown {
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(raw)
  const body = fence?.[1] ?? raw
  const start = body.search(/[[{]/)
  if (start < 0) throw new Error('no json')
  // 最初の括弧から、対応する閉じ括弧までを素朴にたどる（文字列の中の括弧は無視する）
  const open = body[start]
  const close = open === '[' ? ']' : '}'
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < body.length; i++) {
    const ch = body[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '[' || ch === '{') depth++
    else if (ch === ']' || ch === '}') {
      depth--
      if (depth === 0) {
        if (ch !== close) throw new Error('unbalanced json')
        return JSON.parse(body.slice(start, i + 1))
      }
    }
  }
  throw new Error('unterminated json')
}

export type Stage1Options = { max: number; maxChars: number }

export type Stage1Result = { candidates: Candidate[]; dropped: Dropped[] }

/**
 * 1段目の返答を検証する。通らなかった候補は理由付きで `dropped` に入る。
 * JSON として読めないときは throw する（その抽出は失敗扱い）。
 */
export function parseStage1(raw: string, options: Stage1Options): Stage1Result {
  const value = extractJson(raw)
  const list: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { candidates?: unknown }).candidates)
      ? ((value as { candidates: unknown[] }).candidates)
      : []
  const candidates: Candidate[] = []
  const dropped: Dropped[] = []
  let n = 0
  for (const item of list) {
    if (candidates.length >= options.max) break
    if (!item || typeof item !== 'object') {
      dropped.push({ text: String(item), reason: 'invalid', detail: 'not an object' })
      continue
    }
    const o = item as Record<string, unknown>
    const text = typeof o.text === 'string' ? o.text.trim() : ''
    const section = typeof o.section === 'string' ? o.section.trim() : ''
    const evidence = typeof o.evidence === 'string' ? o.evidence.trim() : ''
    let evidenceKind = typeof o.evidenceKind === 'string' ? o.evidenceKind.trim() : ''

    if (text === '') {
      dropped.push({ text, reason: 'invalid', detail: 'empty text' })
      continue
    }
    if (/[\r\n]/.test(text)) {
      dropped.push({ text, reason: 'invalid', detail: 'multi-line text' })
      continue
    }
    if (/^(- |#|\* )/.test(text)) {
      dropped.push({ text, reason: 'invalid', detail: 'text starts with a list or heading marker' })
      continue
    }
    if (text.length > options.maxChars) {
      dropped.push({ text, reason: 'invalid', detail: `text over ${options.maxChars} chars` })
      continue
    }
    if (!isSection(section)) {
      dropped.push({ text, reason: 'invalid', detail: `unknown section: ${section}` })
      continue
    }
    const secret = findSecret(text) ?? findSecret(evidence)
    if (secret !== undefined) {
      dropped.push({ text, reason: 'secret', detail: secret })
      continue
    }
    if (evidence === '') evidenceKind = 'guess'
    if (!(EVIDENCE_KINDS as readonly string[]).includes(evidenceKind)) evidenceKind = 'guess'
    const kind = evidenceKind as EvidenceKind
    if (!AUTO_ELIGIBLE.includes(kind)) {
      dropped.push({ text, reason: 'unverified', detail: kind })
      continue
    }
    n++
    candidates.push({ id: `c${n}`, section, text, evidence, evidenceKind: kind })
  }
  return { candidates, dropped }
}

export type Verdict = 'auto' | 'reinforce' | 'drop'

/** 2段目の判定。reinforce のときは target に既存の生の観察の ID（L1, L2, …）が入る */
export type Judged = { verdict: Verdict; reason: string; target?: string }

/**
 * 2段目の返答を検証する。候補IDごとの判定を返す。IDが足りない・判定が3値でない・
 * reinforce なのに targets にない ID を指すものは返さない（呼び出し側が unjudged として扱う）。
 */
export function parseStage2(raw: string, ids: readonly string[], targets: readonly string[] = []): Map<string, Judged> {
  const value = extractJson(raw)
  const list: unknown[] = Array.isArray(value)
    ? value
    : value && typeof value === 'object' && Array.isArray((value as { verdicts?: unknown }).verdicts)
      ? ((value as { verdicts: unknown[] }).verdicts)
      : []
  const out = new Map<string, Judged>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id : ''
    const verdict = typeof o.verdict === 'string' ? o.verdict.trim().toLowerCase() : ''
    const reason = typeof o.reason === 'string' ? o.reason : ''
    const target = typeof o.target === 'string' ? o.target.trim() : ''
    if (!ids.includes(id)) continue
    if (verdict === 'reinforce') {
      if (targets.includes(target)) out.set(id, { verdict, reason, target })
      continue
    }
    if (verdict !== 'auto' && verdict !== 'drop') continue
    out.set(id, { verdict, reason })
  }
  return out
}
