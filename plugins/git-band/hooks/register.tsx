// git-band: 入力欄の上の帯に git の状態を出し、pull をボタン1つで実行する。
// コミットと push はメッセージが要るので Claude に依頼する。押した直後と push の完了は表示と音で返す。

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import {
  canPull,
  canShip,
  countWorktrees,
  describe,
  firstLine,
  isNetworkError,
  isShipPrompt,
  parseStatus,
  pullPrompt,
  shipPrompt,
} from './git'

const statusAtom = atom({ plugin: 'git-band', key: 'status' } as const, null)
const pullingAtom = atom({ plugin: 'git-band', key: 'isPulling' } as const, false)
const shippingAtom = atom({ plugin: 'git-band', key: 'isShipping' } as const, false)
const pushedAtom = atom({ plugin: 'git-band', key: 'pushedBranch' } as const, null)

const REFRESH_MS = 30_000
const PULL_TIMEOUT_MS = 120_000
const PUSHED_SHOWN_MS = 4_000

// セッションの作業フォルダ。session.start で入る（再読み込みでも session.start は走り直す）
let cwd: string | null = null
let ticker: { cancel: () => void } | null = null
// コミットして push の依頼で始まったターン。このターンが終わったら「依頼中」を戻す
let shipTurnId: string | null = null
let pushedTimer: { cancel: () => void } | null = null

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
  if (await read($, shippingAtom)) return
  await update($, shippingAtom, () => true)
  playSound($, 'sounds/press.wav')
  try {
    await $.prompt.submit({ text: shipPrompt(cwd, status) })
  } catch (err) {
    await update($, shippingAtom, () => false)
    throw err
  }
}

/** Claude の push が通ったら、帯に数秒「push しました」を出して音を鳴らす。 */
async function pushed($: EngineInterface, branch: string): Promise<void> {
  await update($, shippingAtom, () => false)
  await update($, pushedAtom, () => branch)
  playSound($, 'sounds/pushed.wav')
  pushedTimer?.cancel()
  pushedTimer = $.clock.after(PUSHED_SHOWN_MS, () => {
    pushedTimer = null
    void update($, pushedAtom, () => null)
  })
  await refresh($)
}

function playSound($: EngineInterface, asset: string): void {
  void $.audio.play({ asset }).catch(err => logError($, 'sound', err))
}

function logError($: EngineInterface, where: string, err: unknown): void {
  void $.ui.log(`git-band ${where}: ${String(err)}`, { to: 'debug' })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    cwd = e.cwd
    // 再読み込みでモジュールの変数は消えるので、依頼中の表示が残らないように戻す
    shipTurnId = null
    await update($, shippingAtom, () => false)
    await update($, pushedAtom, () => null)
    await refresh($).catch(err => logError($, 'refresh', err))
    ticker?.cancel()
    ticker = $.clock.every(REFRESH_MS, () => {
      void refresh($).catch(err => logError($, 'refresh', err))
    })
    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined && isShipPrompt(e.text)) shipTurnId = e.turnId
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    if (e.agentId === undefined) {
      if (e.turnId === shipTurnId) {
        shipTurnId = null
        await update($, shippingAtom, () => false)
      }
      void refresh($).catch(err => logError($, 'refresh', err))
    }
    return r
  })

  // Claude が実行した git push が通ったかは、Bash の結果の gitOperation で分かる
  on('tool.call', { tool: 'Bash' }, async ($, e, next) => {
    const r = await next(e)
    const push = r.deny === undefined && r.isError !== true ? r.result.gitOperation?.push : undefined
    if (push !== undefined) {
      const status = await read($, statusAtom)
      if (status?.branch === push.branch) void pushed($, push.branch).catch(err => logError($, 'pushed', err))
    }
    return r
  }).catch(($, e, next) => next(e)) // 演出のための見張りなので、失敗しても Bash の結果はそのまま通す

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const status = await read($, statusAtom)
    if (status === null) return next(e)
    const isPulling = await read($, pullingAtom)
    const isShipping = await read($, shippingAtom)
    const pushedBranch = await read($, pushedAtom)

    const { Box, Button, Text } = $.ui.resolve(e)
    const mine = (
      <Box>
        <Text bold>⎇ {status.branch ?? '(detached)'}</Text>
        <Text dimColor> ・ {describe(status)} </Text>
        {isPulling ? (
          <Text dimColor> pull 中…</Text>
        ) : (
          canPull(status) && (
            <Button
              key="pull"
              label="⬇ pull"
              onPress={() => {
                void pull($).catch(err => logError($, 'pull', err))
              }}
            />
          )
        )}
        {pushedBranch !== null ? (
          <Text color="success"> ✓ {pushedBranch} に push しました</Text>
        ) : isShipping ? (
          <Text dimColor> ⬆ コミット・push を依頼中…</Text>
        ) : (
          canShip(status) && (
            <Button
              key="ship"
              variant="primary"
              label="⬆ コミットして push"
              onPress={() => {
                void ship($).catch(err => logError($, 'ship', err))
              }}
            />
          )
        )}
      </Box>
    )
    // 帯は全 Mod で1本。下の Mod が描いた行があれば消さずに下へ積む
    const below = await next(e)
    return below.type === 'engine' ? mine : (
      <Box flexDirection="column">
        {mine}
        {below}
      </Box>
    )
  })
}
