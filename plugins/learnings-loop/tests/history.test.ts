import { describe, expect, test } from 'claude-code/testing'

import { buildDigest, encodeProjectDir, isInside, parseTranscript, type TranscriptExcerpt } from '../hooks/history'
import { localDate } from '../hooks/learnings-file'

const BASE = { cwd: '/repo', gitBranch: 'main', sessionId: 's1' }
const T0 = Date.UTC(2026, 9, 20, 3, 0, 0)

function line(o: Record<string, unknown>): string {
  return JSON.stringify({ ...BASE, ...o })
}

function human(text: string | unknown[], at: number): string {
  return line({ type: 'user', origin: { kind: 'human' }, timestamp: new Date(at).toISOString(), message: { role: 'user', content: text } })
}

function assistantText(text: string): string {
  return line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } })
}

function assistantTool(name: string): string {
  return line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't', name, input: {} }] } })
}

function toolResult(): string {
  return line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'ok' }] } })
}

function notice(text: string, kind = 'task-notification'): string {
  return line({ type: 'user', origin: { kind }, timestamp: new Date(T0).toISOString(), message: { role: 'user', content: text } })
}

describe('encodeProjectDir', () => {
  test('turns every non-alphanumeric character into a dash', async () => {
    expect(encodeProjectDir('C:\\Users\\u\\git\\claude-kit')).toBe('C--Users-u-git-claude-kit')
    expect(encodeProjectDir('/repo/.claude/worktrees/x')).toBe('-repo--claude-worktrees-x')
    expect(encodeProjectDir('C:\\git\\日本語')).toBe('C--git----')
  })
})

describe('parseTranscript', () => {
  test('picks only human prompts', async () => {
    const text = [
      human('一つ目', T0 + 1),
      toolResult(),
      notice('通知'),
      line({ type: 'user', isMeta: true, origin: { kind: 'human' }, timestamp: new Date(T0).toISOString(), message: { role: 'user', content: 'meta' } }),
      notice('プラグインの発言', 'plugin'),
      human('二つ目', T0 + 2),
    ].join('\n')
    expect(parseTranscript(text, 0).exchanges.map(x => x.user)).toEqual(['一つ目', '二つ目'])
  })

  test('reads content as a string or as text blocks', async () => {
    const text = [human('直して', T0 + 1), human([{ type: 'text', text: '違う' }], T0 + 2)].join('\n')
    expect(parseTranscript(text, 0).exchanges.map(x => x.user)).toEqual(['直して', '違う'])
  })

  test('joins a reply split over several records', async () => {
    const text = [assistantText('前半'), assistantTool('Bash'), assistantText('後半'), human('ok', T0 + 1)].join('\n')
    expect(parseTranscript(text, 0).exchanges[0]?.assistant).toBe('前半\n後半')
  })

  test('a tool-only reply shows the tool names', async () => {
    const text = [assistantTool('Read'), assistantTool('Bash'), human('ok', T0 + 1)].join('\n')
    expect(parseTranscript(text, 0).exchanges[0]?.assistant).toBe('[ツール: Read, Bash]')
  })

  test('the reply before each prompt starts fresh after a prompt', async () => {
    const text = [assistantText('A'), human('1', T0 + 1), human('2', T0 + 2)].join('\n')
    expect(parseTranscript(text, 0).exchanges.map(x => x.assistant)).toEqual(['A', ''])
  })

  test('truncates long prompts from the end and long replies from the start', async () => {
    const longReply = 'r'.repeat(100) + 's'.repeat(300)
    const text = [assistantText(longReply), human('u'.repeat(700), T0 + 1)].join('\n')
    const x = parseTranscript(text, 0).exchanges[0]
    expect(x?.user.length).toBe(601)
    expect(x?.user.endsWith('…')).toBe(true)
    expect(x?.assistant).toBe('…' + 's'.repeat(300))
  })

  test('skips broken lines and prompts at or before since', async () => {
    const text = [human('古い', T0), '{not json', human('新しい', T0 + 5)].join('\n')
    expect(parseTranscript(text, T0).exchanges.map(x => x.user)).toEqual(['新しい'])
  })

  test('cwd, branch and sessionId come from the records', async () => {
    const r = parseTranscript(human('x', T0 + 1), 0)
    expect(r.cwd).toBe('/repo')
    expect(r.branch).toBe('main')
    expect(r.sessionId).toBe('s1')
    expect(r.exchanges[0]?.at).toBe(T0 + 1)
  })

  test('skips the reflect prompt that learnings-loop itself sends', async () => {
    const text = [human('learnings-loop:consolidate-learnings スキルを実行して、…', T0 + 1), human('本物', T0 + 2)].join('\n')
    expect(parseTranscript(text, 0).exchanges.map(x => x.user)).toEqual(['本物'])
  })
})

describe('isInside', () => {
  test('ignores separators, drive letter case and a trailing separator', async () => {
    expect(isInside('C:\\Repo\\sub', ['c:/repo'])).toBe(true)
    expect(isInside('/repo/', ['/repo'])).toBe(true)
  })

  test('a sibling with a longer name is not inside', async () => {
    expect(isInside('/repository', ['/repo'])).toBe(false)
  })
})

describe('buildDigest', () => {
  const DAY = 86_400_000
  const older: TranscriptExcerpt = { sessionId: 'aaaaaaaa-1111', branch: 'main', exchanges: [{ at: T0, assistant: '前の返答', user: '古い発言' }] }
  const newer: TranscriptExcerpt = { sessionId: 'bbbbbbbb-2222', branch: 'feat', exchanges: [{ at: T0 + DAY, assistant: '', user: '新しい発言' }] }

  test('lists every session with a heading and counts prompts', async () => {
    const d = buildDigest([newer, older], [], 40_000)
    expect(d.sessions).toBe(2)
    expect(d.prompts).toBe(2)
    expect(d.deferred).toBe(0)
    expect(d.lastAt).toBe(T0 + DAY)
    expect(d.text).toContain(`## ${localDate(T0)} · main · aaaaaaaa`)
    expect(d.text).toContain('古い発言')
    expect(d.text).toContain('前の返答')
    expect(d.text.indexOf('古い発言')).toBeLessThan(d.text.indexOf('新しい発言'))
  })

  test('over the limit it defers the newest prompts, and lastAt covers only what was included', async () => {
    const full = buildDigest([older, newer], [], 40_000)
    const d = buildDigest([older, newer], [], full.text.length - 1)
    expect(d.deferred).toBe(1)
    expect(d.sessions).toBe(1)
    expect(d.text).toContain('古い発言')
    expect(d.text).not.toContain('新しい発言')
    expect(d.text).toContain('次の反映に回す')
    // 印をここまで進めても、回した発言は次の反映で読まれる
    expect(d.lastAt).toBe(T0)
  })

  test('lists unread files', async () => {
    const d = buildDigest([older], [{ path: '/h/x.jsonl', size: 5 * 1024 * 1024 }], 40_000)
    expect(d.text).toContain('未読')
    expect(d.text).toContain('/h/x.jsonl')
  })

  test('trims inside a long session too, so one session cannot exceed the limit', async () => {
    const long: TranscriptExcerpt = {
      sessionId: 'cccccccc',
      exchanges: Array.from({ length: 50 }, (_, i) => ({ at: T0 + i * 60_000, assistant: '', user: `発言${i} ${'あ'.repeat(500)}` })),
    }
    const d = buildDigest([long], [], 10_000)
    expect(d.text.length).toBeLessThanOrEqual(10_000)
    expect(d.prompts).toBeGreaterThan(0)
    expect(d.deferred).toBe(50 - d.prompts)
    expect(d.text).toContain('発言0 ')
    expect(d.lastAt).toBe(T0 + (d.prompts - 1) * 60_000)
  })

  test('interleaved sessions are cut at one point in time across all sessions', async () => {
    const a: TranscriptExcerpt = { sessionId: 'a', exchanges: [{ at: T0, assistant: '', user: 'a1' }, { at: T0 + 2 * DAY, assistant: '', user: 'a2' }] }
    const b: TranscriptExcerpt = { sessionId: 'b', exchanges: [{ at: T0 + DAY, assistant: '', user: 'b1' }, { at: T0 + 3 * DAY, assistant: '', user: `b2 ${'x'.repeat(200)}` }] }
    const full = buildDigest([b, a], [], 40_000)
    const d = buildDigest([b, a], [], full.text.length - 1)
    expect(d.deferred).toBe(1)
    expect(d.text).toContain('a2')
    expect(d.text).not.toContain('b2')
    expect(d.lastAt).toBe(T0 + 2 * DAY)
  })

  test('always includes the oldest prompts even when nothing fits', async () => {
    const d = buildDigest([older, newer], [], 10)
    expect(d.prompts).toBe(1)
    expect(d.lastAt).toBe(T0)
  })

  test('the header says from when the prompts were read', async () => {
    const d = buildDigest([older], [], 40_000, T0 - DAY)
    expect(d.text).toContain(new Date(T0 - DAY).toISOString())
  })

  test('a session without prompts is not counted', async () => {
    const d = buildDigest([older, { sessionId: 'c', exchanges: [] }], [], 40_000)
    expect(d.sessions).toBe(1)
  })
})
