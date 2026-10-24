// $.store に置く永続データ。リポジトリキーごとに分ける。

import type { EngineInterface } from 'claude-code'

import type { Candidate, DropReason } from './candidates'
import { normalize } from './candidates'


export type PendingCandidate = Candidate & {
  /** 発生日時（ms） */
  createdAt: number
  /** 元ブランチ */
  branch?: string
  sessionId: string
  /** 保留に入った理由 */
  why: 'branch' | 'cap' | 'write-failed'
}

export type DiscardedCandidate = {
  /** 正規化したテキスト（機密はハッシュ） */
  key: string
  /** 元の本文（機密のときは空） */
  text: string
  section: string
  reason: DropReason
  detail?: string
  at: number
}

export type AppendedRecord = {
  id: string
  section: string
  line: string
  text: string
  evidence: string
  evidenceKind: string
  at: number
  sessionId: string
  branch?: string
  fromPending: boolean
  isUndone?: true
}

export const DISCARDED_CAP = 300
export const APPENDED_CAP = 200
export const PENDING_TTL_MS = 30 * 86_400_000

const k = (repoKey: string, name: string) => `repo:${repoKey}:${name}`

async function readList<T>($: EngineInterface, key: string): Promise<T[]> {
  const v = await $.store.get(key)
  return Array.isArray(v) ? (v as T[]) : []
}

export async function getPending($: EngineInterface, repoKey: string): Promise<PendingCandidate[]> {
  return readList<PendingCandidate>($, k(repoKey, 'pending'))
}

export async function setPending($: EngineInterface, repoKey: string, list: PendingCandidate[]): Promise<void> {
  await $.store.set(k(repoKey, 'pending'), list)
}

export async function getDiscarded($: EngineInterface, repoKey: string): Promise<DiscardedCandidate[]> {
  return readList<DiscardedCandidate>($, k(repoKey, 'discarded'))
}

export async function addDiscarded(
  $: EngineInterface,
  repoKey: string,
  items: readonly { text: string; section: string; reason: DropReason; detail?: string }[],
  now: number,
): Promise<void> {
  if (items.length === 0) return
  const list = await getDiscarded($, repoKey)
  for (const item of items) {
    const isSecret = item.reason === 'secret'
    const key = isSecret ? `h:${fnv(normalize(item.text))}` : normalize(item.text)
    const existing = list.findIndex(d => d.key === key)
    const entry: DiscardedCandidate = {
      key,
      text: isSecret ? '' : item.text,
      section: item.section,
      reason: item.reason,
      detail: item.detail,
      at: now,
    }
    if (existing >= 0) list.splice(existing, 1)
    list.push(entry)
  }
  while (list.length > DISCARDED_CAP) list.shift()
  await $.store.set(k(repoKey, 'discarded'), list)
}

export async function removeDiscarded($: EngineInterface, repoKey: string, key: string): Promise<DiscardedCandidate | undefined> {
  const list = await getDiscarded($, repoKey)
  const i = list.findIndex(d => d.key === key)
  if (i < 0) return undefined
  const [removed] = list.splice(i, 1)
  await $.store.set(k(repoKey, 'discarded'), list)
  return removed
}

export async function getAppended($: EngineInterface, repoKey: string): Promise<AppendedRecord[]> {
  return readList<AppendedRecord>($, k(repoKey, 'appended'))
}

export async function addAppended($: EngineInterface, repoKey: string, record: AppendedRecord): Promise<void> {
  const list = await getAppended($, repoKey)
  list.push(record)
  while (list.length > APPENDED_CAP) list.shift()
  await $.store.set(k(repoKey, 'appended'), list)
}

export async function markUndone($: EngineInterface, repoKey: string, id: string): Promise<AppendedRecord | undefined> {
  const list = await getAppended($, repoKey)
  const rec = list.find(r => r.id === id)
  if (rec === undefined) return undefined
  rec.isUndone = true
  await $.store.set(k(repoKey, 'appended'), list)
  return rec
}

/** 2段目に渡す「捨てた候補」の本文一覧（機密は除く）。 */
export function discardedTexts(list: readonly DiscardedCandidate[]): string[] {
  return list.filter(d => d.text !== '').map(d => d.text)
}

function fnv(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(16).padStart(8, '0')
}
