// git-band: 入力欄の上の帯に git の状態を出し、pull をボタン1つで実行する。
// コミットと push はメッセージが要るので Claude に依頼する。

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  canPull,
  canShip,
  countWorktrees,
  describe,
  firstLine,
  isNetworkError,
  parseStatus,
  pullPrompt,
  shipPrompt,
} from './git'

const statusAtom = atom({ plugin: 'git-band', key: 'status' } as const, null)
const pullingAtom = atom({ plugin: 'git-band', key: 'isPulling' } as const, false)

const REFRESH_MS = 30_000
const PULL_TIMEOUT_MS = 120_000

// セッションの作業フォルダ。session.start で入る（再読み込みでも session.start は走り直す）
let cwd: string | null = null
let ticker: { cancel: () => void } | null = null

async function git($: EngineInterface, args: readonly string[], timeoutMs = 10_000) {
  if (cwd === null) return { exitCode: -1, stdout: '', stderr: 'no cwd' }
  try {
    return await $.process.run(['git', ...args], { cwd, timeoutMs })
  } catch (err) {
    return { exitCode: -1, stdout: '', stderr: String(err) }
  }
}

async function refresh($: EngineInterface): Promise<void> {
  const st = await git($, ['status', '--porcelain=v2', '--branch'])
  if (st.exitCode !== 0) {
    await update($, statusAtom, () => null)
    return
  }
  const wt = await git($, ['worktree', 'list', '--porcelain'])
  const worktrees = wt.exitCode === 0 ? Math.max(1, countWorktrees(wt.stdout)) : 1
  const next = { ...parseStatus(st.stdout), worktrees }
  await update($, statusAtom, prev =>
    prev !== null && JSON.stringify(prev) === JSON.stringify(next) ? prev : next,
  )
}

async function pull($: EngineInterface): Promise<void> {
  if (await read($, pullingAtom)) return
  await update($, pullingAtom, () => true)
  try {
    const before = await git($, ['rev-parse', 'HEAD'])
    const r = await git($, ['pull', '--ff-only'], PULL_TIMEOUT_MS)
    if (r.exitCode === 0) {
      const after = await git($, ['rev-parse', 'HEAD'])
      const from = before.stdout.trim()
      const to = after.stdout.trim()
      if (from === '' || from === to) {
        void $.ui.toast('git pull: 最新です')
      } else {
        const count = await git($, ['rev-list', '--count', `${from}..${to}`])
        const n = count.exitCode === 0 ? count.stdout.trim() : '?'
        void $.ui.toast(`git pull: ${n}件のコミットを取り込みました`)
      }
      return
    }
    const output = `${r.stderr}\n${r.stdout}`
    if (isNetworkError(output)) {
      void $.ui.toast(`git pull に失敗: ${firstLine(output)}`)
      return
    }
    const status = await read($, statusAtom)
    await $.prompt.submit({ text: pullPrompt(cwd ?? '', status, output) })
    void $.ui.toast('早送りで取り込めなかったので、Claude に pull を依頼しました')
  } finally {
    await update($, pullingAtom, () => false)
    await refresh($)
  }
}

async function ship($: EngineInterface): Promise<void> {
  const status = await read($, statusAtom)
  if (status === null || cwd === null) return
  await $.prompt.submit({ text: shipPrompt(cwd, status) })
}

function logError($: EngineInterface, where: string, err: unknown): void {
  void $.ui.log(`git-band ${where}: ${String(err)}`, { to: 'debug' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    await refresh($).catch(err => logError($, 'refresh', err))
    ticker?.cancel()
    ticker = $.clock.every(REFRESH_MS, () => {
      void refresh($).catch(err => logError($, 'refresh', err))
    })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) void refresh($).catch(err => logError($, 'refresh', err))
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const status = await read($, statusAtom)
    if (status === null) return next(e)
    const isPulling = await read($, pullingAtom)

    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box>
        <Text bold>⎇ {status.branch ?? '(detached)'}</Text>
        <Text dimColor> ・ {describe(status)} </Text>
        {isPulling ? (
          <Text dimColor> pull 中…</Text>
        ) : (
          canPull(status) && (
            <Button
              key="pull"
              hotkey="p"
              label="⬇ pull"
              onPress={() => {
                void pull($).catch(err => logError($, 'pull', err))
              }}
            />
          )
        )}
        {canShip(status) && (
          <Button
            key="ship"
            hotkey="s"
            variant="primary"
            label="⬆ コミットして push"
            onPress={() => {
              void ship($).catch(err => logError($, 'ship', err))
            }}
          />
        )}
      </Box>
    )
  })
}
