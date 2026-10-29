import { describe, expect, test } from 'claude-code/testing'

import { buildConsolidatePrompt, buildJudgePrompt } from '../hooks/prompts'

const SINCE = '2026-10-01T00:00:00.000Z'

describe('buildConsolidatePrompt', () => {
  test('with a digest it names the skill, the file and the counts', async () => {
    const p = buildConsolidatePrompt({ kind: 'digest', path: '/repo/.git/learnings-loop/history.md', since: SINCE, sessions: 3, prompts: 12, deferred: 0, unread: 0 })
    expect(p).toContain('learnings-loop:consolidate-learnings')
    expect(p).toContain('/repo/.git/learnings-loop/history.md')
    expect(p).toContain('3 セッション・12 件')
  })

  test('with a digest it mentions deferred and unread sessions only when there are some', async () => {
    const p = buildConsolidatePrompt({ kind: 'digest', path: '/h.md', since: SINCE, sessions: 1, prompts: 1, deferred: 2, unread: 1 })
    expect(p).toContain('2 件')
    expect(p).toContain('次の反映に回す')
    expect(p).toContain('未読')
    expect(p).toContain('Grep')
    expect(p).toContain(SINCE)
    expect(buildConsolidatePrompt({ kind: 'digest', path: '/h.md', since: SINCE, sessions: 1, prompts: 1, deferred: 0, unread: 0 })).not.toContain('未読')
  })

  test('with a folder it asks Claude to grep the human prompts since the date', async () => {
    const p = buildConsolidatePrompt({ kind: 'folder', dir: '/home/u/.claude/projects', pattern: '-repo*', since: SINCE, reason: 'EACCES' })
    expect(p).toContain('learnings-loop:consolidate-learnings')
    expect(p).toContain('/home/u/.claude/projects')
    expect(p).toContain('-repo*')
    expect(p).toContain(SINCE)
    expect(p).toContain('cwd')
    expect(p).toContain('Grep')
    expect(p).toContain('"kind":"human"')
    expect(p).toContain('EACCES')
  })

  test('with none it says the history is not used, and why', async () => {
    const p = buildConsolidatePrompt({ kind: 'none', reason: '前回以降の発言なし' })
    expect(p).toContain('会話履歴は使わない')
    expect(p).toContain('前回以降の発言なし')
    expect(p).not.toContain('Grep')
  })
})

describe('buildJudgePrompt', () => {
  test('lists raw observations with ids in the cached head and asks for a target on reinforce', async () => {
    const blocks = buildJudgePrompt({
      learnings: '# x',
      observations: [{ id: 'L1', section: 'Patterns That Work', line: '- 2026-10-01: 既存の学び' }],
      discarded: [],
      candidates: [{ id: 'c1', section: 'Patterns That Work', text: '新しい言い方', evidence: 'e', evidenceKind: 'user-correction' }],
    })
    expect(blocks[0]?.cache).toBe(true)
    expect(blocks[0]?.text).toContain('L1 [Patterns That Work] 2026-10-01: 既存の学び')
    expect(blocks[1]?.text).toContain('reinforce')
    expect(blocks[1]?.text).toContain('"target"')
  })
})
