// フック全体の流れ。テストの `on` はプラグインの下に立ち、エンジンの代わりに答える。

import { expect, mock, test } from 'claude-code/testing'
import type { FsEntry, On } from 'claude-code'

const ROOT = '/repo'
const FILE = `${ROOT}/LEARNINGS.md`
const TEMPLATE = '/plugin/templates/LEARNINGS.md'

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
  /** 会話に出した行（$.ui.log） */
  logs: string[]
  toasts: string[]
  /** $.fs.read で読まれたパス */
  reads: string[]
  /** true なら $.fs.list が失敗する */
  listFails: boolean
  /** ファイルごとのサイズ（なければ本文の長さ） */
  sizes: Map<string, number>
  /** ファイルごとの更新日時（なければ 0） */
  mtimes: Map<string, number>
  /** $.fs.read が失敗するパス */
  unreadable: Set<string>
}

/**
 * エンジンが fs に渡すパスを、テストの固定パスに戻す。
 * Windows では `/repo/LEARNINGS.md` が `C:\repo\LEARNINGS.md` に解決されてから stub に届く。
 */
function norm(path: string): string {
  return path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')
}

/** エンジンの代わり: ファイル・git・モデルを答える。 */
function world(on: On, init: Partial<World> & { forkReply?: () => string; judgeReply?: string } = {}): World {
  const w: World = {
    files: init.files ?? new Map([[FILE, INITIAL]]),
    forks: [],
    completes: [],
    git: init.git ?? {},
    runs: [],
    logs: [],
    toasts: [],
    reads: [],
    listFails: false,
    sizes: init.sizes ?? new Map(),
    mtimes: init.mtimes ?? new Map(),
    unreadable: new Set(),
  }
  on('fs.list', (_, e) => {
    if (w.listFails) throw new Error('EACCES')
    const dir = norm(e.path).replace(/\/+$/, '')
    const seen = new Map<string, FsEntry>()
    for (const path of w.files.keys()) {
      if (!path.startsWith(`${dir}/`)) continue
      const [name = '', ...rest] = path.slice(dir.length + 1).split('/')
      if (seen.has(name)) continue
      const isDir = rest.length > 0
      seen.set(name, {
        name,
        kind: isDir ? 'dir' : 'file',
        size: isDir ? 0 : (w.sizes.get(path) ?? (w.files.get(path) ?? '').length),
        mtimeMs: isDir ? 0 : (w.mtimes.get(path) ?? 0),
        isLink: false,
      })
    }
    if (seen.size === 0) throw new Error(`ENOENT ${e.path}`)
    return { value: [...seen.values()] }
  })
  on('env.get', (_, e) => ({ value: e.name === 'HOME' ? '/home/u' : undefined }))
  on('session.repo', () => ({ value: { root: ROOT, remote: null, internal: false, name: null } }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'test-session' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('fs.exists', (_, e) => ({ value: w.files.has(norm(e.path)) }))
  on('fs.read', (_, e) => {
    const path = norm(e.path)
    // プラグイン同梱のファイルは、プラグインがどこに置かれていても固定の答えを返す
    if (path.endsWith('/criteria/CRITERIA.md')) return { value: '' }
    const text = w.files.get(path.endsWith('/templates/LEARNINGS.md') ? TEMPLATE : path)
    w.reads.push(path)
    if (w.unreadable.has(path)) throw new Error(`EACCES ${e.path}`)
    if (text === undefined) throw new Error(`ENOENT ${e.path}`)
    return { value: text }
  })
  on('fs.write', (_, e) => {
    w.files.set(norm(e.path), e.text)
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
  on('ui.log', (_, e) => {
    if (e.to !== 'debug') w.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
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

test("after an append the band row shows a view button, and another mod's band row stays under it", async ($, on) => {
  const clock = mock.clock(on)
  mock.store(on)
  const w = world(on, { git: { 'rev-parse --abbrev-ref HEAD': 'main', 'symbolic-ref --short refs/remotes/origin/HEAD': 'origin/main' } })
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
    expect(await ui.find({ key: 'view' })).toBeDefined()
    expect(await ui.find({ key: 'undo' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /ctrl\+x/ })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /other mod/ }))?.text).toBe('other mod')
    await ui.unmount()
  }

  // 「追記内容を見る」は /learnings と同じ内容を会話に出す
  const ui = await $.ui.mount({
    plugin: 'learnings-loop',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
  })
  await ui.press({ key: 'view' })
  const shown = w.logs.find(l => l.includes('/repo/LEARNINGS.md'))
  expect(shown).toContain('zsh では PIPESTATUS')
  await ui.unmount()
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
  expect(composed.sections.find(s => s.id === 'learnings-loop:principles')?.text).toContain('作業の commit に含めてよい')
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

test('after a compaction the first extraction covers only the turns since it', async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 9, 22, 3, 0, 0) })
  mock.store(on)
  const w = world(on, { git: { 'rev-parse --abbrev-ref HEAD': 'main' } })
  let turns = 0
  on('session.turns', () => ({ value: turns }))
  await $.session.start(ON_MAIN)

  turns = 1
  await $.turn.start({ text: 'fix', turnId: 't1' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/a.ts`, old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(2000)
  expect(w.forks.length).toBe(1)

  // 調査だけのターンが続く（抽出は走らない）
  for (const t of [2, 3, 4]) {
    turns = t
    await $.turn.start({ text: 'look', turnId: `t${t}` })
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t${t}`, reason: 'answer' })
  }

  // 会話圧縮: session.compact は飛ばされることがあるので、turns が前回より減ったことだけが手がかり
  // （数え直さなければ 3 - 1 = 2 回分になる）
  turns = 3
  await $.turn.start({ text: 'fix more', turnId: 't5' })
  await $.tool.call({ tool: 'Edit', file_path: `${ROOT}/b.ts`, old_string: 'a', new_string: 'b' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't5', reason: 'answer' })
  await clock.advance(2000)
  expect(w.forks.length).toBe(2)
  expect(w.forks[1]).toContain('直近の 1 回分')
})

test('without a LEARNINGS.md the mod stays quiet and /learnings points at init', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const w = world(on, { files: new Map([[TEMPLATE, INITIAL]]) })
  on('session.turns', () => ({ value: 1 }))

  await $.session.start(ON_MAIN)
  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.some(s => s.id === 'learnings-loop:principles')).toBe(false)

  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('/learnings init')
  expect(w.forks.length).toBe(0)
})

const BAND = { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} }
const IN_REPO = { 'rev-parse --path-format=absolute --git-common-dir': '/repo/.git' }

test('in a git repository without LEARNINGS.md the band offers init, and pressing it creates the file', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const w = world(on, { files: new Map([[TEMPLATE, INITIAL]]), git: IN_REPO })
  on('session.turns', () => ({ value: 0 }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  await $.session.start(ON_MAIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface, props: BAND })
    expect((await ui.find({ type: 'Text', text: /LEARNINGS.md がありません/ }))?.text).toContain('LEARNINGS.md がありません')
    expect(await ui.find({ key: 'init' })).toBeDefined()
    expect(await ui.find({ key: 'declineInit' })).toBeDefined()
    await ui.unmount()
  }

  const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  await ui.press({ key: 'init' })
  expect(w.files.get(FILE)).toBe(INITIAL)
  expect(await ui.find({ key: 'init' })).toBeUndefined()
  await ui.unmount()

  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('/repo/LEARNINGS.md')
})

test('"do not ask in this repository" is remembered across sessions', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on, { files: new Map(), git: IN_REPO })
  on('session.turns', () => ({ value: 0 }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  await $.session.start(ON_MAIN)
  const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  await ui.press({ key: 'declineInit' })
  expect(await ui.find({ key: 'init' })).toBeUndefined()
  await ui.unmount()

  await $.session.start(ON_MAIN)
  const again = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  expect(await again.find({ key: 'init' })).toBeUndefined()
  await again.unmount()
})

test('no init offer outside a git repository, or with the option off', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on, { files: new Map() })
  on('session.turns', () => ({ value: 0 }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  await $.session.start(ON_MAIN)
  const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  expect(await ui.find({ key: 'init' })).toBeUndefined()
  await ui.unmount()
})

test('the init offer can be switched off in /config', { options: { offerInit: false } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on, { files: new Map(), git: IN_REPO })
  on('session.turns', () => ({ value: 0 }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  await $.session.start(ON_MAIN)
  const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  expect(await ui.find({ key: 'init' })).toBeUndefined()
  await ui.unmount()
})

test('with LEARNINGS.md the band always shows the count and the view and reflect buttons, and hides while working', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on)
  on('session.turns', () => ({ value: 0 }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))

  await $.session.start(ON_MAIN)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface, props: BAND })
    expect((await ui.find({ type: 'Text', text: /観察/ }))?.text).toContain('観察 1件')
    expect(await ui.find({ key: 'view' })).toBeDefined()
    expect(await ui.find({ key: 'reflect' })).toBeDefined()
    await ui.unmount()
  }
  const working = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: { ...BAND, isWorking: true } })
  expect(await working.find({ key: 'reflect' })).toBeUndefined()
  await working.unmount()
})

test('reflect asks Claude to consolidate, shows a pending line while it works, then a sound and a toast', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  const w = world(on)
  on('session.turns', () => ({ value: 0 }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  const prompts: string[] = []
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  const sounds: string[] = []
  on('audio.play', (_, e) => {
    if (e.clip.asset !== undefined) sounds.push(e.clip.asset)
    return { value: undefined }
  })

  await $.session.start(ON_MAIN)
  const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  await ui.press({ key: 'reflect' })
  expect(prompts.length).toBe(1)
  expect(prompts[0]).toContain('consolidate-learnings')
  expect(sounds.some(s => s.endsWith('sounds/press.wav'))).toBe(true)
  await ui.unmount()

  const pending = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: { ...BAND, isWorking: true } })
  expect((await pending.find({ type: 'Text', text: /反映しています/ }))?.text).toContain('学びを反映しています')
  expect(await pending.find({ key: 'reflect' })).toBeUndefined()
  await pending.unmount()

  await $.turn.start({ text: prompts[0] ?? '', turnId: 't1' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  expect(w.toasts).toContain('✨ 学びを反映しました')
  expect(sounds.some(s => s.endsWith('sounds/done.wav'))).toBe(true)
  const after = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
  expect(await after.find({ key: 'reflect' })).toBeDefined()
  await after.unmount()
})

const SUBMIT = { wait: false, origin: { kind: 'composer' as const } }

test('when prompt.compose never reaches the mod, the principles ride on the first prompt as context, and again after a compaction', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on)
  let turns = 0
  on('session.turns', () => ({ value: turns }))
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.session.start(ON_MAIN)

  // 最初の発言: 添付される（表示には出ない context として）
  await $.prompt.submit({ text: 'fix it', ...SUBMIT })
  expect(contexts.length).toBe(1)
  expect(contexts[0]?.length).toBe(1)
  expect(contexts[0]?.[0]).toContain('原則1')
  expect(contexts[0]?.[0]).toContain('自分で LEARNINGS.md に追記しない')
  turns = 1
  await $.turn.start({ text: 'fix it', turnId: 't1' })

  // 2回目以降は添付しない
  await $.prompt.submit({ text: 'more', ...SUBMIT })
  expect(contexts[1]).toBeUndefined()
  turns = 2
  await $.turn.start({ text: 'more', turnId: 't2' })

  // 会話圧縮（turns が前回より減る）のあとの最初の発言: もう一度添付する
  turns = 1
  await $.prompt.submit({ text: 'after compact', ...SUBMIT })
  expect(contexts[2]?.[0]).toContain('原則1')

  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('原則: 発言に添付')
})

test('once prompt.compose has reached the mod, nothing is attached to the prompt', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on)
  on('session.turns', () => ({ value: 1 }))
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.session.start(ON_MAIN)
  await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })

  await $.prompt.submit({ text: 'fix it', ...SUBMIT })
  expect(contexts[0]).toBeUndefined()

  const status = await $.command.run({ command: 'learnings', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 80 } })
  expect(status.text).toContain('原則: システムプロンプトに注入')
})

test('with the injection off, neither route carries the principles', { options: { injectPrinciples: false } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  world(on)
  on('session.turns', () => ({ value: 1 }))
  const contexts: (readonly string[] | undefined)[] = []
  on('prompt.submit', (_, e) => {
    contexts.push(e.context)
    return { text: e.text, context: e.context }
  })
  await $.session.start(ON_MAIN)
  await $.prompt.submit({ text: 'fix it', ...SUBMIT })
  expect(contexts[0]).toBeUndefined()
  const composed = await $.prompt.compose({ model: 'm', promptModel: 'm', surfaces: ['terminal'], tools: [], outputStyle: null, traits: [] })
  expect(composed.sections.some(s => s.id === 'learnings-loop:principles')).toBe(false)
})

// ---- 学びを反映: 会話履歴の抜粋 ----------------------------------------------------

const NOW = Date.UTC(2026, 9, 22, 3, 0, 0)
const PROJECTS = '/home/u/.claude/projects'
const DIGEST = '/repo/.git/learnings-loop/history.md'
const HISTORY_GIT = {
  'rev-parse --path-format=absolute --git-common-dir': '/repo/.git',
  'worktree list --porcelain': 'worktree /repo\nHEAD abc\nbranch refs/heads/main\n',
}

function jsonl(cwd: string, sessionId: string, prompts: readonly [string, number][]): string {
  return prompts
    .flatMap(([text, at]) => [
      JSON.stringify({ type: 'assistant', cwd, sessionId, gitBranch: 'main', message: { content: [{ type: 'text', text: `${text}への前置き` }] } }),
      JSON.stringify({ type: 'user', origin: { kind: 'human' }, cwd, sessionId, gitBranch: 'main', timestamp: new Date(at).toISOString(), message: { content: text } }),
    ])
    .join('\n')
}

/** このリポジトリ（/repo とそのサブフォルダ）と、名前が前方一致する別のリポジトリ（/repository）の履歴 */
function historyWorld(on: On, extra: { sizes?: Map<string, number> } = {}) {
  const at = NOW - 86_400_000
  const files = new Map([
    [FILE, INITIAL],
    [`${PROJECTS}/-repo/s1.jsonl`, jsonl('/repo', 's1', [['ルートでの発言', at]])],
    [`${PROJECTS}/-repo-sub/s2.jsonl`, jsonl('/repo/sub', 's2', [['サブフォルダでの発言', at + 1000]])],
    [`${PROJECTS}/-repository/s3.jsonl`, jsonl('/repository', 's3', [['別リポジトリの発言', at + 2000]])],
  ])
  const mtimes = new Map([...files.keys()].map(k => [k, at + 2000] as [string, number]))
  return world(on, { files, mtimes, sizes: extra.sizes, git: HISTORY_GIT })
}

async function startReflecting($: Parameters<Parameters<typeof test>[1]>[0], on: On) {
  mock.clock(on, { now: NOW })
  mock.store(on)
  on('session.turns', () => ({ value: 0 }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('audio.play', () => ({ value: undefined }))
  const prompts: string[] = []
  on('prompt.submit', (_, e) => {
    prompts.push(e.text)
    return { text: e.text }
  })
  await $.session.start(ON_MAIN)
  const press = async () => {
    const ui = await $.ui.mount({ plugin: 'learnings-loop', component: 'AbovePrompt', surface: 'desktop', props: BAND })
    await ui.press({ key: 'reflect' })
    await ui.unmount()
  }
  let n = 0
  /** 反映のプロンプトで始まるターンを、reason で終える */
  const finish = async (reason: 'answer' | 'aborted' | 'error') => {
    const turnId = `r${++n}`
    await $.turn.start({ text: prompts.at(-1) ?? '', turnId })
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: reason === 'aborted', turnId, reason })
  }
  return { prompts, press, finish }
}

test("reflect writes a digest of this repository's sessions and passes its path", async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  await r.press()

  expect(r.prompts.length).toBe(1)
  expect(r.prompts[0]).toContain(DIGEST)
  expect(r.prompts[0]).toContain('2 セッション')
  const digest = w.files.get(DIGEST) ?? ''
  expect(digest).toContain('ルートでの発言')
  expect(digest).toContain('サブフォルダでの発言')
  expect(digest).toContain('への前置き')
  expect(digest).not.toContain('別リポジトリの発言')
})

test('the history cursor advances only after an unaborted reflect turn', async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  await r.press()
  await r.finish('aborted')
  w.files.delete(DIGEST)
  await r.press()
  expect(w.files.get(DIGEST) ?? '').toContain('ルートでの発言')

  await r.finish('answer')
  await r.press()
  expect(r.prompts[2]).toContain('会話履歴は使わない')
})

test('a jsonl over 4 MiB is listed as unread, not read', async ($, on) => {
  const big = `${PROJECTS}/-repo/s1.jsonl`
  const w = historyWorld(on, { sizes: new Map([[big, 5 * 1024 * 1024]]) })
  const r = await startReflecting($, on)

  await r.press()

  const digest = w.files.get(DIGEST) ?? ''
  expect(digest).toContain('未読')
  expect(digest).toContain('s1.jsonl')
  expect(digest).not.toContain('ルートでの発言')
  expect(w.reads.includes(big)).toBe(false)
  expect(r.prompts[0]).toContain('未読')
})

test('when the history folder cannot be listed, the prompt names the folder and the cursor stays', async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  w.listFails = true
  await r.press()
  expect(r.prompts[0]).toContain(PROJECTS)
  expect(r.prompts[0]).toContain('-repo*')
  expect(r.prompts[0]).toContain('Grep')
  await r.finish('answer')

  w.listFails = false
  await r.press()
  expect(w.files.get(DIGEST) ?? '').toContain('ルートでの発言')
})

test('a user turn that finishes before the queued reflect turn does not advance the cursor or chime', async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  await r.press()
  await $.turn.start({ text: '別の依頼', turnId: 'u1' })
  await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 'u1', reason: 'answer' })
  expect(w.toasts).not.toContain('✨ 学びを反映しました')

  await r.finish('aborted')
  w.files.delete(DIGEST)
  await r.press()
  expect(w.files.get(DIGEST) ?? '').toContain('ルートでの発言')
})

test('a reflect turn that ends in an error does not advance the cursor or chime', async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  await r.press()
  await r.finish('error')
  expect(w.toasts).not.toContain('✨ 学びを反映しました')

  w.files.delete(DIGEST)
  await r.press()
  expect(w.files.get(DIGEST) ?? '').toContain('ルートでの発言')
})

test('when no jsonl can be read, the prompt falls back to the folder instead of saying there was nothing', async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  for (const path of w.files.keys()) if (path.endsWith('.jsonl')) w.unreadable.add(path)
  await r.press()

  expect(r.prompts[0]).toContain('Grep')
  expect(r.prompts[0]).not.toContain('前回以降の発言なし')
})

test('a jsonl that cannot be read is listed as unread when others were read', async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  w.unreadable.add(`${PROJECTS}/-repo-sub/s2.jsonl`)
  await r.press()

  const digest = w.files.get(DIGEST) ?? ''
  expect(digest).toContain('ルートでの発言')
  expect(digest).toContain('s2.jsonl')
  expect(r.prompts[0]).toContain('未読')
})

test('when no history folder matches this repository, the prompt falls back to the folder', async ($, on) => {
  const w = historyWorld(on)
  const r = await startReflecting($, on)

  for (const path of [...w.files.keys()]) if (path.startsWith(`${PROJECTS}/-repo`) && !path.startsWith(`${PROJECTS}/-repository`)) w.files.delete(path)
  await r.press()

  expect(r.prompts[0]).toContain('Grep')
  expect(r.prompts[0]).not.toContain('前回以降の発言なし')
})
