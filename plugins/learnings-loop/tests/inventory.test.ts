import { describe, expect, test } from 'claude-code/testing'

import { grepArgs, grepFixed, parseGrepHits, type Run } from '../hooks/git'
import { buildInventory, COMMON_WORD_FILES, inventoryKeywords } from '../hooks/inventory'

const TEXT = `# Project Learnings

<!--
- 最終統合: 2026-10-01（統合後の観察 2件）
-->

## Patterns That Work
- 2026-09-01: 古い観察A
- 2026-11-10: \`principlesBlock\` は件数をセッション開始時点で固定する

## Mistakes to Avoid
- 2026-11-12: \`node_modules\` を grep の対象にしない

## Domain Knowledge
- 2026-11-15: \`staleDays\` の既定は30日

## Open Questions

## Consolidated Principles
- 原則
`

const BASE = { text: TEXT, today: '2026-11-19', staleDays: 30, targetCount: 3 }

describe('buildInventory', () => {
  test('counts the observations against the target and the count left by the last consolidation', async () => {
    const inv = buildInventory({ ...BASE, hits: new Map() })
    expect(inv.observations).toBe(4)
    expect(inv.target).toBe(3)
    expect(inv.baseline).toBe(2)
    expect(inv.text).toContain('生の観察: 4 件。目標は 3 件以下（1 件超えている）')
    expect(inv.text).toContain('前回の統合の直後は 2 件（+2 件）')
  })

  test('without a recorded count the growth is reported as unknown', async () => {
    const inv = buildInventory({ ...BASE, text: TEXT.replace('（統合後の観察 2件）', ''), hits: new Map() })
    expect(inv.baseline).toBeUndefined()
    expect(inv.text).toContain('前回の統合の直後の件数は記録なし')
  })

  test('lists observations not seen for more than the given days as stale', async () => {
    const inv = buildInventory({ ...BASE, hits: new Map() })
    expect(inv.stale).toBe(1)
    expect(inv.text).toContain('最後の観測から 30 日を超えた 1 件')
    expect(inv.text).toContain('- 2026-09-01: 古い観察A  ← 79 日前（Patterns That Work）')
    expect(inv.text).not.toContain('principlesBlock` は件数をセッション開始時点で固定する  ←')
  })

  test('an observation whose back-quoted word appears outside LEARNINGS.md is listed with the files', async () => {
    const hits = new Map([
      ['principlesBlock', ['plugins/x/hooks/register.tsx']],
      ['staleDays', ['plugins/x/README.md', 'plugins/x/.claude-plugin/plugin.json']],
    ])
    const inv = buildInventory({ ...BASE, hits })
    expect(inv.referenced).toBe(2)
    expect(inv.text).toContain('`principlesBlock` → plugins/x/hooks/register.tsx')
    expect(inv.text).toContain('`staleDays` → plugins/x/README.md, plugins/x/.claude-plugin/plugin.json')
    expect(inv.text).not.toContain('`node_modules` →')
  })

  test('a word found in too many files is too common to be a lead', async () => {
    const many = Array.from({ length: COMMON_WORD_FILES + 1 }, (_, i) => `f${i}.ts`)
    const inv = buildInventory({ ...BASE, hits: new Map([['node_modules', many]]) })
    expect(inv.referenced).toBe(0)
    expect(inv.text).not.toContain('`node_modules` →')
  })

  test('when git grep could not run, nothing is marked as found and Claude is told to grep itself', async () => {
    const inv = buildInventory({ ...BASE, hits: undefined })
    expect(inv.referenced).toBeUndefined()
    expect(inv.text).toContain('git grep を実行できなかった')
    expect(inv.text).not.toContain('→')
  })

  test('the keywords to grep are the back-quoted words of every observation, once each', async () => {
    expect(inventoryKeywords(TEXT)).toEqual(['principlesBlock', 'node_modules', 'staleDays'])
  })
})

describe('git grep for the keywords', () => {
  test('searches the whole repository but never LEARNINGS.md itself', async () => {
    const args = grepArgs(['a b', 'c'])
    expect(args.slice(0, 2)).toEqual(['grep', '-F'])
    expect(args).toContain('-o')
    expect(args).toContain('-z')
    expect(args.join(' ')).toContain('-e a b -e c')
    expect(args.slice(-3)).toEqual(['--', ':(top)', ':(top,exclude,glob)**/LEARNINGS.md'])
  })

  test('parses path NUL word lines into word -> files', async () => {
    const hits = parseGrepHits('a.ts\0foo\na.ts\0foo\nb.md\0foo\nb.md\0bar\n')
    expect(hits.get('foo')).toEqual(['a.ts', 'b.md'])
    expect(hits.get('bar')).toEqual(['b.md'])
  })

  const runWith = (exitCode: number, stdout: string, stderr = ''): Run => async () => ({ exitCode, stdout, stderr })

  test('exit 1 with no output means no hits; any other failure is "could not grep", not "no hits"', async () => {
    expect((await grepFixed(runWith(0, 'a.ts\0foo\n'), '/r', ['foo']))?.get('foo')).toEqual(['a.ts'])
    expect((await grepFixed(runWith(1, ''), '/r', ['foo']))?.size).toBe(0)
    expect(await grepFixed(runWith(128, '', 'fatal: not a git repository'), '/r', ['foo'])).toBeUndefined()
    expect(await grepFixed(runWith(1, '', 'fatal: bad pathspec'), '/r', ['foo'])).toBeUndefined()
    const throws: Run = async () => {
      throw new Error('spawn failed')
    }
    expect(await grepFixed(throws, '/r', ['foo'])).toBeUndefined()
  })

  test('with no keywords git is not run', async () => {
    let ran = false
    const run: Run = async () => {
      ran = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    expect((await grepFixed(run, '/r', []))?.size).toBe(0)
    expect(ran).toBe(false)
  })
})
