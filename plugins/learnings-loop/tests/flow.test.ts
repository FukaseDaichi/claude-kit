// フック全体の流れ。テストの `on` はプラグインの下に立ち、エンジンの代わりに答える。

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/repo'
const FILE = `${ROOT}/LEARNINGS.md`

const INITIAL = `# Project Learnings

<!--
- 最終統合: 2026-10-01
-->

## Patterns That Work
（効いたやり方・型）

- 2026-10-02: 既存のA

## Mistakes to Avoid
（失敗と再発防止）

## Domain Knowledge
（業務・仕様の知識）

## Open Questions
（未解決の疑問）

## Consolidated Principles

- 原則1
`

const FORK_REPLY = `候補です。
\`\`\`json
[
  {
    "section": "Mistakes to Avoid",
    "text": "zsh では PIPESTATUS でなく pipestatus を使う",
    "evidence": "echo \\"exit: \${PIPESTATUS[0]}\\" が空を出力した後、pipestatus で取れた",
    "evidenceKind": "error-fixed-verified"
  },
  {
    "section": "Patterns That Work",
    "text": "たぶんこうすると速い",
    "evidence": "",
    "evidenceKind": "guess"
  }
]
\`\`\``

const JUDGE_REPLY = '[{"id":"c1","verdict":"auto","reason":"new and reusable"}]'

type World = {
  files: Map<string, string>
  forks: string[]
  completes: { model: string; prompt: string }[]
  git: Record<string, string>
  runs: string[]
}

/** エンジンの代わり: ファイル・git・モデルを答える。 */
function world(on: On, init: Partial<World> & { forkReply?: () => string; judgeReply?: string } = {}): World {
  const w: World = {
    files: init.files ?? new Map([[FILE, INITIAL]]),
    forks: [],
    completes: [],
    git: init.git ?? {},
    runs: [],
  }
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('fs.exists', (_, e) => ({ value: w.files.has(e.path) }))
  on('fs.read', (_, e) => {
    const text = w.files.get(e.path)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    w.files.set(e.path, e.text)
    return { value: undefined }
  })
  on('process.run', (_, e) => {
    const key = e.argv.slice(1).join(' ')
    w.runs.push(key)
    const out = w.git[key]
    return { value: { exitCode: out === undefined ? 1 : 0, stdout: out ?? '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('model.fork', (_, e) => {
    w.forks.push(e.prompt)
    return {
      value: {
        isAnswered: true,
        text: init.forkReply?.() ?? FORK_REPLY,
        usage: { input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 1000, cache_creation_input_tokens: 0 },
      },
    }
  })
  on('model.complete', (_, e) => {
    w.completes.push({ model: e.model, prompt: e.prompt })
    return {
      value: {
        isAnswered: true,
        text: init.judgeReply ?? JUDGE_REPLY,
        usage: { input_tokens: 5, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 500 },
      },
    }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('tool.call', () => ({ result: {} }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'base', scope: 'shared' as const }] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  return w
}

const ON_MAIN = { cwd: ROOT, surface: 'terminal' as const, isInteractive: true }

test('session.start registers /learnings and injects the principles', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const w = world(on)
  on('session.turns', () => ({ value: 0 }))

  await $.session.start(ON_MAIN)

  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  const section = composed.sections.find(s => s.id === 'learnings-loop:principles')
  expect(section?.scope).toBe('session')
  expect(section?.text).toContain('原則1')
  expect(section?.text).toContain('自分で LEARNINGS.md に追記しない')

  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('生の観察 1 件')
  expect(w.forks.length).toBe(0)
})

test('an edit turn triggers a fork, a judge and one appended line', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 3, 0, 0) })
  mock.store(on)
  const w = world(on, { git: { 'rev-parse --abbrev-ref HEAD': 'main', 'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main' } })
  let turns = 0
  on('session.turns', () => ({ value: turns }))

  await $.session.start(ON_MAIN)

  turns = 1
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })

  // 抽出は turn.complete の中では走らず、タイマーから走る
  expect(w.forks.length).toBe(0)
  await clock.advance(2000)

  expect(w.forks.length).toBe(1)
  expect(w.forks[0]).toContain('直近の 1 回分')
  expect(w.completes.length).toBe(1)
  expect(w.completes[0]?.model).toBe('haiku')
  expect(w.completes[0]?.prompt).toContain('<learnings_md>')

  const text = w.files.get(FILE) ?? ''
  expect(text).toContain('- 2026-10-22: zsh では PIPESTATUS でなく pipestatus を使う')
  expect(text).not.toContain('たぶんこうすると速い')
  expect(text).toContain('- 原則1')

  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('生の観察 2 件')
  expect(status.text).toContain('今セッションの抽出: 1 回')
  expect(status.text).toContain('zsh では PIPESTATUS')

  // 同じターンをもう一度は抽出しない
  await clock.advance(2000)
  expect(w.forks.length).toBe(1)
})

test("after an append the band row shows, and another mod's band row stays under it", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  world(on, { git: { 'rev-parse --abbrev-ref HEAD': 'main', 'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main' } })
  let turns = 0
  on('session.turns', () => ({ value: turns }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return Text({ children: 'other mod' })
  })

  await $.session.start(ON_MAIN)
  turns = 1
  await $.turn.start({ text: 'fix it', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(2000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'learnings-loop',
      component: 'AbovePrompt',
      surface,
      props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
    })
    expect(await ui.find({ key: 'undo' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /other mod/ }))?.text).toBe('other mod')
    await ui.unmount()
  }
})

test('a read-only turn does not trigger extraction', async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const w = world(on)
  on('session.turns', () => ({ value: 1 }))

  await $.session.start(ON_MAIN)
  await $.turn.start({ text: 'look', turnId: 't1' })
  await $.tool.call({ tool: 'Read', file_path: `${ROOT}/a.ts` })
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(5000)
  expect(w.forks.length).toBe(0)
})

test('undo removes the appended line only while it is still there', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 3, 0, 0) })
  mock.store(on)
  const w = world(on, { git: { 'rev-parse --abbrev-ref HEAD': 'main', 'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main' } })
  on('session.turns', () => ({ value: 1 }))

  await $.session.start(ON_MAIN)
  await $.turn.start({ text: 'fix', turnId: 't1' })
  await $.tool.call({ tool: 'Write', file_path: `${ROOT}/b.ts`, content: 'x' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(2000)
  expect(w.files.get(FILE)).toContain('pipestatus')

  const undone = await $.command.run({ command: 'learnings', args: 'undo', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(undone.text).toContain('取り消しました')
  expect(w.files.get(FILE)).toBe(INITIAL)

  const again = await $.command.run({ command: 'learnings', args: 'undo', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(again.text).toContain('すでに取り消し済み')

  // 捨てた候補に入り、採用し直せる
  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('取り消し')
  const adopted = await $.command.run({ command: 'learnings', args: 'adopt 1', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(adopted.text).toContain('採用しました')
  expect(w.files.get(FILE)).toContain('pipestatus')
})

test('on a work branch (or a worktree) the line is written right there', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 3, 0, 0) })
  mock.store(on)
  const w = world(on, { git: { 'rev-parse --abbrev-ref HEAD': 'feature/x', 'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main' } })
  on('session.turns', () => ({ value: 1 }))

  await $.session.start(ON_MAIN)
  await $.turn.start({ text: 'fix', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(2000)

  expect(w.files.get(FILE)).toContain('- 2026-10-22: zsh では PIPESTATUS でなく pipestatus を使う')
  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).not.toContain('保留中')
})

test('more than three lines in a session are all written (no session cap)', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 3, 0, 0) })
  mock.store(on)
  let n = 0
  const w = world(on, {
    git: { 'rev-parse --abbrev-ref HEAD': 'main' },
    forkReply: () => {
      n++
      return JSON.stringify(
        [1, 2].map(k => ({ section: 'Domain Knowledge', text: `事実 ${n}-${k}`, evidence: 'ツール出力で確認', evidenceKind: 'research-confirmed' })),
      )
    },
    judgeReply: '[{"id":"c1","verdict":"auto","reason":"ok"},{"id":"c2","verdict":"auto","reason":"ok"}]',
  })
  let turns = 0
  on('session.turns', () => ({ value: turns }))

  await $.session.start(ON_MAIN)
  for (const t of [1, 2]) {
    turns = t
    await $.turn.start({ text: 'edit', turnId: `t${t}` })
    await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: `t${t}`, reason: 'answer' })
    await clock.advance(2000)
  }

  const text = w.files.get(FILE) ?? ''
  for (const line of ['事実 1-1', '事実 1-2', '事実 2-1', '事実 2-2']) expect(text).toContain(line)
})

test('git commit by Claude never stages LEARNINGS.md', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const git: Record<string, string> = {
    'rev-parse --abbrev-ref HEAD': 'feature/x',
    [`status --porcelain -- ${FILE}`]: ' M LEARNINGS.md',
    [`add -- ${FILE}`]: '',
  }
  const w = world(on, { git })
  on('session.turns', () => ({ value: 0 }))
  await $.session.start(ON_MAIN)

  await $.tool.call({ tool: 'Bash', command: 'git add src/a.ts && git commit -m "fix"' })
  expect(w.runs.includes(`add -- ${FILE}`)).toBe(false)

  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.find(s => s.id === 'learnings-loop:principles')?.text).toContain('作業の commit には含めない')
})

test('/learnings commit commits only LEARNINGS.md, and only when it has changes', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const COMMIT = `commit -m LEARNINGS.md を更新（learnings-loop） -- ${FILE}`
  const git: Record<string, string> = { 'rev-parse --abbrev-ref HEAD': 'feature/x', [`add -- ${FILE}`]: '', [COMMIT]: '' }
  const w = world(on, { git })
  on('session.turns', () => ({ value: 0 }))
  await $.session.start(ON_MAIN)
  const run = () => $.command.run({ command: 'learnings', args: 'commit', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })

  // 変更なし: commit しない
  expect((await run()).text).toContain('未 commit の変更はありません')
  expect(w.runs.includes(COMMIT)).toBe(false)

  // 変更あり: add してから、そのファイルだけを commit する
  git[`status --porcelain -- ${FILE}`] = ' M LEARNINGS.md'
  expect((await run()).text).toContain('だけを commit しました')
  const i = w.runs.indexOf(`add -- ${FILE}`)
  expect(i).toBeGreaterThan(-1)
  expect(w.runs.indexOf(COMMIT)).toBeGreaterThan(i)
})

test('a turn where Claude edited LEARNINGS.md itself is not extracted', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 3, 0, 0) })
  mock.store(on)
  const w = world(on, { git: { 'rev-parse --abbrev-ref HEAD': 'main' } })
  let turns = 0
  on('session.turns', () => ({ value: turns }))
  await $.session.start(ON_MAIN)

  turns = 1
  await $.turn.start({ text: 'fix and update learnings', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Edit', file_path: FILE, old_string: 'x', new_string: 'y' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(2000)
  expect(w.forks.length).toBe(0)

  // 次の編集ターンは、そのターンだけが対象になる
  turns = 2
  await $.turn.start({ text: 'more', turnId: 't2' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/b.ts`, old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer' })
  await clock.advance(2000)
  expect(w.forks.length).toBe(1)
  expect(w.forks[0]).toContain('直近の 1 回分')
})

test('without a LEARNINGS.md the mod stays quiet and /learnings points at init', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const w = world(on, { files: new Map([[`/plugin/templates/LEARNINGS.md`, INITIAL]]) })
  on('session.turns', () => ({ value: 1 }))

  await $.session.start(ON_MAIN)
  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.some(s => s.id === 'learnings-loop:principles')).toBe(false)

  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('/learnings init')
  expect(w.forks.length).toBe(0)
})
