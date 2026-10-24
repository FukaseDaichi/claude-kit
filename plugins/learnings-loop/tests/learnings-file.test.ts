import { describe, expect, test } from 'claude-code/testing'

import {
  appendLine,
  countObservations,
  daysBetween,
  hasLine,
  hash,
  lastConsolidated,
  parse,
  principles,
  removeLine,
} from '../hooks/learnings-file'

const SAMPLE = `# Project Learnings

<!--
記法ルール:
- 1項目1洞察
- 最終統合: 2026-10-19（consolidate-learnings）
-->

## Patterns That Work
（効いたやり方・型）

- 2026-10-01: 既存のA

- 2026-10-02: 既存のB

## Mistakes to Avoid
（失敗と再発防止）

- 2026-10-03: 既存のC
- 2026-10-04: 既存のD

## Domain Knowledge
（業務・仕様の知識）

## Open Questions
（未解決の疑問）

- 2026-10-05: 疑問E

## Consolidated Principles

- 原則1
- 原則2
`

describe('parse', () => {
  test('finds all five headings', async () => {
    const p = parse(SAMPLE)
    expect(p.ok).toBe(true)
    if (p.ok) expect(Object.keys(p.headingAt).length).toBe(5)
  })

  test('refuses a file missing a heading', async () => {
    const p = parse(SAMPLE.replace('## Open Questions', '## Questions'))
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.missing).toEqual(['Open Questions'])
  })

  test('refuses conflict markers', async () => {
    const p = parse(SAMPLE + '\n<<<<<<< HEAD\n')
    expect(p.ok).toBe(false)
    if (!p.ok) expect(p.reason).toBe('conflict-markers')
  })
})

describe('reading', () => {
  test('counts raw observations, not the comment rules nor the principles', async () => {
    expect(countObservations(SAMPLE)).toBe(5)
  })

  test('reads the last consolidation date', async () => {
    expect(lastConsolidated(SAMPLE)).toBe('2026-10-19')
    expect(lastConsolidated('# x\n## Patterns That Work')).toBe(undefined)
  })

  test('reads the principles body', async () => {
    expect(principles(SAMPLE)).toBe('- 原則1\n- 原則2')
  })

  test('days between dates', async () => {
    expect(daysBetween('2026-10-22', '2026-10-19')).toBe(3)
    expect(daysBetween('bad', '2026-10-19')).toBe(undefined)
  })
})

describe('appendLine', () => {
  test('appends after the last item, keeping the blank-line style', async () => {
    const r = appendLine(SAMPLE, 'Patterns That Work', '- 2026-10-22: 新しいF')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lines = r.text.split('\n')
    const i = lines.indexOf('- 2026-10-22: 新しいF')
    expect(lines[i - 1]).toBe('')
    expect(lines[i - 2]).toBe('- 2026-10-02: 既存のB')
    expect(countObservations(r.text)).toBe(6)
  })

  test('appends directly after the last item when items are adjacent', async () => {
    const r = appendLine(SAMPLE, 'Mistakes to Avoid', '- 2026-10-22: 新しいG')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lines = r.text.split('\n')
    const i = lines.indexOf('- 2026-10-22: 新しいG')
    expect(lines[i - 1]).toBe('- 2026-10-04: 既存のD')
    expect(lines[i + 1]).toBe('')
    expect(lines[i + 2]).toBe('## Domain Knowledge')
  })

  test('appends after the description line of an empty section', async () => {
    const r = appendLine(SAMPLE, 'Domain Knowledge', '- 2026-10-22: 新しいH')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const lines = r.text.split('\n')
    const i = lines.indexOf('- 2026-10-22: 新しいH')
    expect(lines[i - 2]).toBe('（業務・仕様の知識）')
    expect(lines[i - 1]).toBe('')
    expect(lines[i + 1]).toBe('')
    expect(lines[i + 2]).toBe('## Open Questions')
    expect(parse(r.text).ok).toBe(true)
  })

  test('never writes into Consolidated Principles', async () => {
    const r = appendLine(SAMPLE, 'Open Questions', '- 2026-10-22: 疑問I')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(principles(r.text)).toBe('- 原則1\n- 原則2')
  })
})

describe('removeLine', () => {
  test('removes the exact line only in its section', async () => {
    const added = appendLine(SAMPLE, 'Patterns That Work', '- 2026-10-22: 新しいF')
    if (!added.ok) throw new Error('append failed')
    const r = removeLine(added.text, 'Patterns That Work', '- 2026-10-22: 新しいF')
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.text).toBe(SAMPLE)
      expect(hasLine(r.text, 'Patterns That Work', '- 2026-10-22: 新しいF')).toBe(false)
    }
  })

  test('reports not-found when the line was edited by hand', async () => {
    const r = removeLine(SAMPLE, 'Patterns That Work', '- 2026-10-01: 既存のA（手で直した）')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toBe('not-found')
  })

  test('does not remove a same line from another section', async () => {
    const r = removeLine(SAMPLE, 'Mistakes to Avoid', '- 2026-10-01: 既存のA')
    expect(r.ok).toBe(false)
  })
})

describe('hash', () => {
  test('changes when the text changes', async () => {
    expect(hash(SAMPLE)).toBe(hash(SAMPLE))
    expect(hash(SAMPLE)).not.toBe(hash(SAMPLE + 'x'))
  })
})
