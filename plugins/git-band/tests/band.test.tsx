// 帯とボタンの流れ。テストの `on` はプラグインの下に立ち、エンジン（git・プロンプト送信・通知）の代わりに答える。

import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/repo'

type Reply = { exitCode: number; stdout?: string; stderr?: string }

type World = {
  /** `git <args>` → 返事。関数なら呼ばれるたびに評価する */
  git: Record<string, Reply | (() => Reply)>
  calls: string[]
  prompts: string[]
  toasts: string[]
  /** 鳴らした音（asset のパス） */
  sounds: string[]
}

const CLEAN = `# branch.oid 1
# branch.head main
# branch.upstream origin/main
# branch.ab +0 -0
`
const DIRTY = `# branch.oid 1
# branch.head main
# branch.upstream origin/main
# branch.ab +1 -0
1 .M N... 100644 100644 100644 a b src/a.ts
? new.txt
`
const WORKTREES = 'worktree /repo\nHEAD 1\nbranch refs/heads/main\n'

/** `below` を渡すと、帯の下にほかの Mod がその文字を描いている状態にする */
function world(on: On, git: World['git'], below?: string): World {
  const w: World = { git, calls: [], prompts: [], toasts: [], sounds: [] }
  on('process.run', (_, e) => {
    const key = e.argv.slice(1).join(' ')
    w.calls.push(key)
    const found = w.git[key]
    const r = typeof found === 'function' ? found() : found ?? { exitCode: 128, stderr: `fatal: unexpected ${key}` }
    return {
      value: { exitCode: r.exitCode, stdout: r.stdout ?? '', stderr: r.stderr ?? '', isStdoutTruncated: false, isStderrTruncated: false },
    }
  })
  on('prompt.submit', (_, e) => {
    w.prompts.push(e.text)
    return { text: e.text }
  })
  on('ui.toast', (_, e) => {
    w.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('audio.play', (_, e) => {
    if (e.clip.asset !== undefined) w.sounds.push(e.clip.asset)
    return { value: undefined }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('ui.render', ($, e) => {
    if (below === undefined) return { type: 'engine', ref: 0 } // エンジン自身の帯（アンケートがなければ何も描かない）
    const { Text } = $.ui.resolve(e)
    return <Text>{below}</Text>
  })
  return w
}

const BAND = {
  plugin: 'git-band',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 9 },
    view: {},
  },
} as const

const START = { cwd: ROOT, surface: 'desktop' as const, isInteractive: true }

test('the band shows the status and the buttons, on terminal and desktop', async ($, on) => {
  mock.clock(on)
  world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: DIRTY },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  })
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect((await ui.find({ type: 'Text', text: /main/ }))?.text).toContain('main')
    expect((await ui.find({ type: 'Text', text: /未コミット/ }))?.text).toBe(' ・ 未コミット 2 ・ 未push 1 ')
    expect(await ui.find({ key: 'pull' })).toBeDefined()
    expect(await ui.find({ key: 'ship' })).toBeDefined()
    await ui.unmount()
  }
})

test('outside a git repository the band is left to the engine', async ($, on) => {
  mock.clock(on)
  world(on, { 'status --porcelain=v2 --branch': { exitCode: 128, stderr: 'fatal: not a git repository' } }, 'engine')
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await ui.find({ type: 'Text', text: /engine/ }))?.text).toBe('engine')
  expect(await ui.find({ key: 'pull' })).toBeUndefined()
  await ui.unmount()
})

test("another mod's band row stays, under git-band's row", async ($, on) => {
  mock.clock(on)
  world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: DIRTY },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  }, 'other mod')
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ key: 'pull' })).toBeDefined()
    expect((await ui.find({ type: 'Text', text: /other mod/ }))?.text).toBe('other mod')
    await ui.unmount()
  }
})

test('a clean tree hides the ship button', async ($, on) => {
  mock.clock(on)
  world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: CLEAN },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'pull' })).toBeDefined()
  expect(await ui.find({ key: 'ship' })).toBeUndefined()
  await ui.unmount()
})

test('pull that fast-forwards runs git itself and toasts the count, no prompt', async ($, on) => {
  mock.clock(on)
  let pulled = false
  const w = world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: CLEAN },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
    'rev-parse HEAD': () => ({ exitCode: 0, stdout: pulled ? 'bbb\n' : 'aaa\n' }),
    'pull --ff-only': () => {
      pulled = true
      return { exitCode: 0, stdout: 'Fast-forward\n' }
    },
    'rev-list --count aaa..bbb': { exitCode: 0, stdout: '3\n' },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'pull' })
  expect(w.calls).toContain('pull --ff-only')
  expect(w.toasts).toContain('git pull: 3件のコミットを取り込みました')
  expect(w.prompts.length).toBe(0)
  await ui.unmount()
})

test('pull that cannot fast-forward hands the work to Claude with the output', async ($, on) => {
  mock.clock(on)
  const w = world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: DIRTY },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
    'rev-parse HEAD': { exitCode: 0, stdout: 'aaa\n' },
    'pull --ff-only': { exitCode: 128, stderr: "hint: Diverging branches can't be fast-forwarded\nfatal: Not possible to fast-forward, aborting.\n" },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'pull' })
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('Not possible to fast-forward')
  expect(w.prompts[0]).toContain('--rebase --autostash')
  expect(w.toasts.some(t => t.includes('Claude に pull を依頼'))).toBe(true)
  await ui.unmount()
})

test('a network failure is only toasted, not sent to Claude', async ($, on) => {
  mock.clock(on)
  const w = world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: CLEAN },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
    'rev-parse HEAD': { exitCode: 0, stdout: 'aaa\n' },
    'pull --ff-only': { exitCode: 128, stderr: "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com\n" },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'pull' })
  expect(w.prompts.length).toBe(0)
  expect(w.toasts[0]).toContain('git pull に失敗')
  await ui.unmount()
})

test('ship asks Claude to commit and push', async ($, on) => {
  mock.clock(on)
  const w = world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: DIRTY },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'ship' })
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('コミットして push')
  expect(w.prompts[0]).toContain('/repo（ブランチ main）')
  expect(w.calls).not.toContain('push')
  await ui.unmount()
})

test('the status refreshes on the timer and after a turn', async ($, on) => {
  const clock = mock.clock(on)
  let dirty = false
  const w = world(on, {
    'status --porcelain=v2 --branch': () => ({ exitCode: 0, stdout: dirty ? DIRTY : CLEAN }),
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await ui.find({ key: 'ship' })).toBeUndefined()

  dirty = true
  await clock.advance(30_000)
  expect(await ui.find({ key: 'ship' })).toBeDefined()

  const before = w.calls.filter(c => c.startsWith('status')).length
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
  await clock.advance(0)
  expect(w.calls.filter(c => c.startsWith('status')).length).toBeGreaterThan(before)
  await ui.unmount()
})

const PUSH_OK = { stdout: '', stderr: '', interrupted: false, gitOperation: { push: { branch: 'main' } } }

test('ship turns the button into a pending line with a sound, until the ship turn ends', async ($, on) => {
  mock.clock(on)
  const w = world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: DIRTY },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  })
  await $.session.start(START)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    w.sounds.length = 0
    await ui.press({ key: 'ship' })
    expect(w.sounds).toEqual(['sounds/press.wav'])
    expect(await ui.find({ key: 'ship' })).toBeUndefined()
    expect((await ui.find({ type: 'Text', text: /依頼中/ }))?.text).toBe(' ⬆ コミット・push を依頼中…')

    const turnId = `ship-${surface}`
    await $.turn.start({ text: w.prompts.at(-1) ?? '', turnId })
    // ほかのターンが終わっても依頼中のまま
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'other', reason: 'answer' })
    expect(await ui.find({ key: 'ship' })).toBeUndefined()

    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
    expect(await ui.find({ key: 'ship' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /依頼中/ })).toBeUndefined()
    await ui.unmount()
  }
})

test('a git push that went through shows a done line with a sound for a few seconds', async ($, on) => {
  const clock = mock.clock(on)
  let isPushed = false
  const w = world(on, {
    'status --porcelain=v2 --branch': () => ({ exitCode: 0, stdout: isPushed ? CLEAN : DIRTY }),
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  })
  on('tool.call', () => {
    isPushed = true
    return { result: PUSH_OK }
  })
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })
  await ui.press({ key: 'ship' })

  await $.tool.call({ tool: 'Bash', command: 'git push' })
  // 演出は Bash の結果を待たせずに走るので、それが終わるのを待つ
  await clock.advance(0)
  expect(w.sounds).toEqual(['sounds/press.wav', 'sounds/pushed.wav'])
  expect((await ui.find({ type: 'Text', text: /push しました/ }))?.text).toBe(' ✓ main に push しました')
  expect(await ui.find({ type: 'Text', text: /依頼中/ })).toBeUndefined()

  await clock.advance(4_000)
  expect(await ui.find({ type: 'Text', text: /push しました/ })).toBeUndefined()
  // push 済みできれいなので、ボタンも出ない
  expect(await ui.find({ key: 'ship' })).toBeUndefined()
  await ui.unmount()
})

test('a failed push, or a push of another branch, shows no done line', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(on, {
    'status --porcelain=v2 --branch': { exitCode: 0, stdout: DIRTY },
    'worktree list --porcelain': { exitCode: 0, stdout: WORKTREES },
  })
  let answer: object = {}
  on('tool.call', () => answer as never)
  await $.session.start(START)
  const ui = await $.ui.mount({ ...BAND, surface: 'desktop' })

  answer = { result: { ...PUSH_OK, gitOperation: { push: { branch: 'feature' } } } }
  await $.tool.call({ tool: 'Bash', command: 'git push origin feature' })
  answer = { result: PUSH_OK, isError: true, text: 'rejected' }
  await $.tool.call({ tool: 'Bash', command: 'git push' })
  answer = { result: { stdout: '', stderr: '', interrupted: false } }
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(0)

  expect(w.sounds).toEqual([])
  expect(await ui.find({ type: 'Text', text: /push しました/ })).toBeUndefined()
  expect(await ui.find({ key: 'ship' })).toBeDefined()
  await ui.unmount()
})
