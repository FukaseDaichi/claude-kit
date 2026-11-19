import { describe, expect, test } from 'claude-code/testing'

import {
  appendLine,
  consolidatedCount,
  countObservations,
  daysBetween,
  hasLine,
  hash,
  isLearningsPath,
  lastConsolidated,
  lastSeen,
  parse,
  observationDigest,
  observations,
  principles,
  removeLine,
  reobserve,
  referenceKeywords,
  reobserved,
  replaceLine,
  staleObservations,
  withoutReobserved,
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

describe('reobservation', () => {
  test('numbers raw observations across the four sections, not the principles', async () => {
    const obs = observations(SAMPLE)
    expect(obs.map(o => o.id)).toEqual(['L1', 'L2', 'L3', 'L4', 'L5'])
    expect(obs[2]).toEqual({ id: 'L3', section: 'Mistakes to Avoid', line: '- 2026-10-03: 既存のC' })
    expect(obs.some(o => o.line.includes('原則'))).toBe(false)
  })

  test('adds and counts up a mark at the end of the line', async () => {
    const once = reobserve('- 2026-10-01: 既存のA', '2026-10-20')
    expect(once).toBe('- 2026-10-01: 既存のA（再観測 1回・最終 2026-10-20）')
    const twice = reobserve(once, '2026-10-25')
    expect(twice).toBe('- 2026-10-01: 既存のA（再観測 2回・最終 2026-10-25）')
    expect(reobserved(twice)).toEqual({ count: 2, last: '2026-10-25' })
    expect(withoutReobserved(twice)).toBe('- 2026-10-01: 既存のA')
    expect(reobserved('- 2026-10-01: 既存のA')).toBe(undefined)
  })

  test('replaceLine swaps the exact line only in its section', async () => {
    const r = replaceLine(SAMPLE, 'Patterns That Work', '- 2026-10-01: 既存のA', '- 2026-10-01: 既存のA（再観測 1回・最終 2026-10-20）')
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.text).toContain('- 2026-10-01: 既存のA（再観測 1回・最終 2026-10-20）')
    expect(r.text.split('\n').length).toBe(SAMPLE.split('\n').length)
    expect(replaceLine(SAMPLE, 'Mistakes to Avoid', '- 2026-10-01: 既存のA', 'x').ok).toBe(false)
  })
})

describe('observationDigest', () => {
  test('lists every raw observation by section when they fit, leaving out open questions', async () => {
    const d = observationDigest(SAMPLE, 3000)
    expect(d.shown).toBe(4)
    expect(d.text).toBe(
      [
        '### Patterns That Work',
        '- 2026-10-01: 既存のA',
        '- 2026-10-02: 既存のB',
        '### Mistakes to Avoid',
        '- 2026-10-03: 既存のC',
        '- 2026-10-04: 既存のD',
      ].join('\n'),
    )
    expect(d.text).not.toContain('疑問E')
    expect(d.text).not.toContain('原則')
  })

  test('over the limit it keeps the most re-observed, then the newest', async () => {
    const marked = SAMPLE.replace('- 2026-10-01: 既存のA', '- 2026-10-01: 既存のA（再観測 2回・最終 2026-10-20）')
    // 見出し1行と項目1行がやっと入る長さ
    const one = observationDigest(marked, 70)
    expect(one.shown).toBe(1)
    expect(one.text).toBe(['### Patterns That Work', '- 2026-10-01: 既存のA（再観測 2回・最終 2026-10-20）'].join('\n'))

    // 印がなければ新しいものから
    const newest = observationDigest(SAMPLE, 50)
    expect(newest.shown).toBe(1)
    expect(newest.text).toBe(['### Mistakes to Avoid', '- 2026-10-04: 既存のD'].join('\n'))
  })

  test('the text never exceeds the limit, and a limit of 0 lists nothing', async () => {
    for (const max of [0, 10, 50, 80, 120, 3000]) {
      const d = observationDigest(SAMPLE, max)
      expect(d.text.length <= max).toBe(true)
    }
    expect(observationDigest(SAMPLE, 0)).toEqual({ text: '', shown: 0 })
    expect(observationDigest('not a learnings file', 3000)).toEqual({ text: '', shown: 0 })
  })
})

describe('hash', () => {
  test('changes when the text changes', async () => {
    expect(hash(SAMPLE)).toBe(hash(SAMPLE))
    expect(hash(SAMPLE)).not.toBe(hash(SAMPLE + 'x'))
  })
})

describe('isLearningsPath', () => {
  test('sees the file name after either separator', async () => {
    expect(isLearningsPath('C:\\x\\LEARNINGS.md')).toBe(true)
    expect(isLearningsPath('/x/LEARNINGS.md')).toBe(true)
    expect(isLearningsPath('LEARNINGS.md')).toBe(true)
    expect(isLearningsPath('/x/NOT_LEARNINGS.md')).toBe(false)
  })
})

describe('lastSeen / staleObservations', () => {
  test('the last sighting is the re-observation date, else the date at the head of the line', async () => {
    expect(lastSeen('- 2026-09-01: A（再観測 2回・最終 2026-11-01）')).toBe('2026-11-01')
    expect(lastSeen('- 2026-09-01: A')).toBe('2026-09-01')
    expect(lastSeen('- 日付なし')).toBeUndefined()
  })

  test('lists observations not seen for more than the given days, in every section, but never principles', async () => {
    const text = [
      '## Patterns That Work',
      '- 2026-09-01: 古いA',
      '- 2026-09-01: 古いが再観測されたB（再観測 1回・最終 2026-11-10）',
      '- 日付のないC',
      '## Mistakes to Avoid',
      '- 2026-10-20: ちょうど30日のD',
      '## Domain Knowledge',
      '## Open Questions',
      '- 2026-08-01: 古い疑問E',
      '## Consolidated Principles',
      '- 2026-01-01: 原則F',
    ].join('\n')
    const stale = staleObservations(text, '2026-11-19', 30)
    expect(stale.map(o => o.line)).toEqual(['- 2026-09-01: 古いA', '- 2026-08-01: 古い疑問E'])
    expect(stale[0]?.age).toBe(79)
    expect(stale[0]?.lastSeen).toBe('2026-09-01')
    expect(stale[1]?.section).toBe('Open Questions')
    expect(staleObservations(text, '2026-11-19', 365)).toEqual([])
  })
})

describe('consolidatedCount', () => {
  test('reads the count left by the last consolidation, next to its date', async () => {
    expect(consolidatedCount('<!--\n- 最終統合: 2026-11-19（統合後の観察 21件）\n-->')).toBe(21)
    expect(consolidatedCount('- 最終統合：2026-11-19 (統合後の観察 3 件)')).toBe(3)
    expect(lastConsolidated('- 最終統合: 2026-11-19（統合後の観察 21件）')).toBe('2026-11-19')
  })

  test('without a count (older files, or never consolidated) it is undefined', async () => {
    expect(consolidatedCount('- 最終統合: 2026-11-19')).toBeUndefined()
    expect(consolidatedCount('- 最終統合: （未実施）')).toBeUndefined()
    expect(consolidatedCount(SAMPLE)).toBeUndefined()
  })
})

describe('referenceKeywords', () => {
  test('takes back-quoted words of four characters or more, once each, outside the date and the mark', async () => {
    const line = '- 2026-11-01: `git grep` で `principlesBlock` を探す。`ls` は短い。`principlesBlock` は1回（再観測 1回・最終 2026-11-02）'
    expect(referenceKeywords(line)).toEqual(['git grep', 'principlesBlock'])
    expect(referenceKeywords('- 2026-11-01: 手がかりのない観察')).toEqual([])
  })
})
