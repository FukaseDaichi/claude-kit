import { describe, expect, test } from 'claude-code/testing'

import { buildConsolidatePrompt } from '../hooks/prompts'

describe('buildConsolidatePrompt', () => {
  test('with a digest it names the skill, the file and the counts', async () => {
    const p = buildConsolidatePrompt({ kind: 'digest', path: '/repo/.git/learnings-loop/history.md', sessions: 3, prompts: 12, dropped: 0, unread: 0 })
    expect(p).toContain('learnings-loop:consolidate-learnings')
    expect(p).toContain('/repo/.git/learnings-loop/history.md')
    expect(p).toContain('3 セッション・12 件')
  })

  test('with a digest it mentions dropped and unread sessions only when there are some', async () => {
    const p = buildConsolidatePrompt({ kind: 'digest', path: '/h.md', sessions: 1, prompts: 1, dropped: 2, unread: 1 })
    expect(p).toContain('2 件')
    expect(p).toContain('未読')
    expect(buildConsolidatePrompt({ kind: 'digest', path: '/h.md', sessions: 1, prompts: 1, dropped: 0, unread: 0 })).not.toContain('未読')
  })

  test('with a folder it asks Claude to grep the human prompts since the date', async () => {
    const p = buildConsolidatePrompt({ kind: 'folder', dir: '/home/u/.claude/projects/-repo', since: '2026-10-01', reason: 'EACCES' })
    expect(p).toContain('learnings-loop:consolidate-learnings')
    expect(p).toContain('/home/u/.claude/projects/-repo')
    expect(p).toContain('2026-10-01')
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
