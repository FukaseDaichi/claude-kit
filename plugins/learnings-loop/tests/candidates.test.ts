import { describe, expect, test } from 'claude-code/testing'

import { extractJson, findSecret, normalize, parseStage1, parseStage2 } from '../hooks/candidates'

const OPTIONS = { max: 3, maxChars: 200 }

describe('extractJson', () => {
  test('reads a fenced array with prose around it', async () => {
    const raw = 'はい、候補は次のとおりです。\n```json\n[{"a":1}]\n```\n以上です。'
    expect(extractJson(raw)).toEqual([{ a: 1 }])
  })

  test('reads a bare array and ignores brackets inside strings', async () => {
    expect(extractJson('x [{"t":"a]b"}] y')).toEqual([{ t: 'a]b' }])
  })

  test('throws on no json', async () => {
    expect(() => extractJson('nothing here')).toThrow()
  })
})

describe('parseStage1', () => {
  test('keeps a verified candidate and assigns ids', async () => {
    const raw = JSON.stringify([
      { section: 'Mistakes to Avoid', text: 'Xのときは Y を先に確認する', evidence: 'Error: ENOENT ... then fixed, tests passed', evidenceKind: 'error-fixed-verified' },
    ])
    const r = parseStage1(raw, OPTIONS)
    expect(r.candidates.length).toBe(1)
    expect(r.candidates[0]?.id).toBe('c1')
    expect(r.dropped.length).toBe(0)
  })

  test('drops guess, unverified fixes and empty evidence', async () => {
    const raw = JSON.stringify([
      { section: 'Patterns That Work', text: 'たぶんこう', evidence: 'なんとなく', evidenceKind: 'guess' },
      { section: 'Patterns That Work', text: '直したが未確認', evidence: 'edited the file', evidenceKind: 'error-fixed-unverified' },
      { section: 'Patterns That Work', text: '根拠なし', evidence: '', evidenceKind: 'research-confirmed' },
    ])
    const r = parseStage1(raw, OPTIONS)
    expect(r.candidates.length).toBe(0)
    expect(r.dropped.map(d => d.reason)).toEqual(['unverified', 'unverified', 'unverified'])
  })

  test('drops bad sections, multi-line text, list markers and long text', async () => {
    const raw = JSON.stringify([
      { section: 'Consolidated Principles', text: 'x', evidence: 'e', evidenceKind: 'user-correction' },
      { section: 'Domain Knowledge', text: 'a\nb', evidence: 'e', evidenceKind: 'user-correction' },
      { section: 'Domain Knowledge', text: '- a', evidence: 'e', evidenceKind: 'user-correction' },
      { section: 'Domain Knowledge', text: 'x'.repeat(201), evidence: 'e', evidenceKind: 'user-correction' },
    ])
    const r = parseStage1(raw, OPTIONS)
    expect(r.candidates.length).toBe(0)
    expect(r.dropped.every(d => d.reason === 'invalid')).toBe(true)
  })

  test('drops secrets in text or evidence', async () => {
    const raw = JSON.stringify([
      { section: 'Domain Knowledge', text: 'トークンは ghp_abcdefghijklmnopqrstuvwxyz1234 を使う', evidence: 'e', evidenceKind: 'research-confirmed' },
      { section: 'Domain Knowledge', text: '担当に連絡する', evidence: 'mail to someone@example.com', evidenceKind: 'user-correction' },
    ])
    const r = parseStage1(raw, OPTIONS)
    expect(r.candidates.length).toBe(0)
    expect(r.dropped.map(d => d.reason)).toEqual(['secret', 'secret'])
  })

  test('caps the number of candidates', async () => {
    const item = { section: 'Domain Knowledge', text: 'x', evidence: 'e', evidenceKind: 'research-confirmed' }
    const r = parseStage1(JSON.stringify([item, item, item, item, item]), OPTIONS)
    expect(r.candidates.length).toBe(3)
  })

  test('accepts an object wrapper and an empty array', async () => {
    expect(parseStage1('{"candidates": []}', OPTIONS).candidates.length).toBe(0)
    expect(parseStage1('[]', OPTIONS).candidates.length).toBe(0)
  })

  test('throws on no json at all', async () => {
    expect(() => parseStage1('I could not find any learnings.', OPTIONS)).toThrow()
  })
})

describe('parseStage2', () => {
  test('reads verdicts for known ids only, as a two-valued judgment', async () => {
    const raw = '```json\n[{"id":"c1","verdict":"auto","reason":"new"},{"id":"c2","verdict":"maybe"},{"id":"c9","verdict":"drop"}]\n```'
    const v = parseStage2(raw, ['c1', 'c2'])
    expect(v.get('c1')?.verdict).toBe('auto')
    expect(v.has('c2')).toBe(false)
    expect(v.has('c9')).toBe(false)
  })

  test('accepts reinforce only with a known target id', async () => {
    const raw = '[{"id":"c1","verdict":"reinforce","target":"L2","reason":"same"},{"id":"c2","verdict":"reinforce","target":"L9"},{"id":"c3","verdict":"reinforce"}]'
    const v = parseStage2(raw, ['c1', 'c2', 'c3'], ['L1', 'L2'])
    expect(v.get('c1')).toEqual({ verdict: 'reinforce', reason: 'same', target: 'L2' })
    expect(v.has('c2')).toBe(false)
    expect(v.has('c3')).toBe(false)
  })
})

describe('normalize / findSecret', () => {
  test('normalizes spacing, punctuation and case', async () => {
    expect(normalize('Git の  push は、「手動」で！')).toBe(normalize('git の push は手動で'))
    expect(normalize('A  b')).toBe('a b')
  })

  test('finds common token shapes', async () => {
    expect(findSecret('key: sk-ant-api03-abcdefghijklmnop')).toBe('anthropic-key')
    expect(findSecret('AKIAABCDEFGHIJKLMNOP')).toBe('aws-key')
    expect(findSecret('plain text')).toBe(undefined)
  })
})
