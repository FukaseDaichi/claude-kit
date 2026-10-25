import { expect, test } from 'claude-code/testing'

import { canPull, canShip, countWorktrees, describe, isNetworkError, isShipPrompt, parseStatus, pullPrompt, shipPrompt } from '../hooks/git'

const STATUS = `# branch.oid 0123
# branch.head main
# branch.upstream origin/main
# branch.ab +2 -1
1 .M N... 100644 100644 100644 aaa bbb src/a.ts
2 R. N... 100644 100644 100644 ccc ddd R100 src/new.ts\tsrc/old.ts
u UU N... 100644 100644 100644 100644 e f g src/c.ts
? notes.txt
`

test('parseStatus reads branch, upstream, ahead/behind and counts changes', () => {
  expect(parseStatus(STATUS)).toEqual({ branch: 'main', upstream: 'origin/main', ahead: 2, behind: 1, changes: 4 })
})

test('parseStatus: detached HEAD and no upstream', () => {
  const s = parseStatus('# branch.oid 0123\n# branch.head (detached)\n')
  expect(s).toEqual({ branch: null, upstream: null, ahead: 0, behind: 0, changes: 0 })
})

test('countWorktrees counts the main one too', () => {
  const text = 'worktree /repo\nHEAD 1\nbranch refs/heads/main\n\nworktree /repo/.claude/worktrees/x\nHEAD 2\nbranch refs/heads/x\n'
  expect(countWorktrees(text)).toBe(2)
})

test('buttons follow the status', () => {
  const base = { branch: 'main', upstream: 'origin/main', ahead: 0, behind: 0, changes: 0, worktrees: 1 }
  expect(canShip(base)).toBe(false)
  expect(canShip({ ...base, changes: 1 })).toBe(true)
  expect(canShip({ ...base, ahead: 1 })).toBe(true)
  expect(canShip({ ...base, upstream: null })).toBe(true)
  expect(canShip({ ...base, branch: null, changes: 3 })).toBe(false)
  expect(canPull(base)).toBe(true)
  expect(canPull({ ...base, upstream: null })).toBe(false)
  expect(describe({ ...base, changes: 3, ahead: 1, worktrees: 2 })).toBe('未コミット 3 · 未push 1 · worktree +1')
  expect(describe({ ...base, upstream: null, behind: 0 })).toBe('upstream なし')
  expect(describe({ ...base, behind: 4 })).toBe('未pull 4')
  expect(describe({ ...base, changes: 0, ahead: 0, behind: 0, worktrees: 1 })).toBe('変更なし')
})

test('network errors are told apart from conflicts', () => {
  expect(isNetworkError("fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com")).toBe(true)
  expect(isNetworkError('hint: Diverging branches can\'t be fast-forwarded\nfatal: Not possible to fast-forward, aborting.')).toBe(false)
  expect(isNetworkError('error: Your local changes to the following files would be overwritten by merge')).toBe(false)
})

test('pullPrompt carries the output and the policy', () => {
  const s = { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 2, changes: 0, worktrees: 1 }
  const text = pullPrompt('/repo', s, 'fatal: Not possible to fast-forward, aborting.')
  expect(text).toContain('/repo（ブランチ main ← origin/main）')
  expect(text).toContain('fatal: Not possible to fast-forward')
  expect(text).toContain('--rebase --autostash')
  expect(text).toContain('AskUserQuestion')
  expect(text).toContain('push はしない')
})

test('isShipPrompt finds the ship request, and nothing else', () => {
  const s = { branch: 'main', upstream: 'origin/main', ahead: 1, behind: 0, changes: 2, worktrees: 1 }
  expect(isShipPrompt(shipPrompt('/repo', s))).toBe(true)
  expect(isShipPrompt(pullPrompt('/repo', s, 'fatal'))).toBe(false)
  expect(isShipPrompt('コミットして push して')).toBe(false)
})
