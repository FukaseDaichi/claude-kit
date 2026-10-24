// git の読み取り。$.process.run で呼ぶ。失敗はすべて undefined に畳む。

export type Run = (
  argv: readonly string[],
  init?: { cwd?: string; timeoutMs?: number },
) => Promise<{ exitCode: number; stdout: string; stderr: string }>

async function git(run: Run, cwd: string, args: readonly string[]): Promise<string | undefined> {
  try {
    const r = await run(['git', ...args], { cwd, timeoutMs: 10_000 })
    if (r.exitCode !== 0) return undefined
    return r.stdout.trim()
  } catch {
    return undefined
  }
}

/** worktree 間で共通の識別キー。Git 管理外なら undefined。 */
export async function commonDir(run: Run, cwd: string): Promise<string | undefined> {
  return git(run, cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
}

/** 今のブランチ名。detached HEAD なら 'HEAD' が返る。 */
export async function currentBranch(run: Run, cwd: string): Promise<string | undefined> {
  return git(run, cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])
}

/**
 * 既定ブランチ: 明示設定 → origin/HEAD → main → master → 今のブランチ。
 * `configured` が '*' ならどのブランチでも書く（呼び出し側が判断する）。
 */
export async function defaultBranch(
  run: Run,
  cwd: string,
  configured: string | undefined,
): Promise<string | undefined> {
  if (configured !== undefined && configured !== '') return configured
  const head = await git(run, cwd, ['symbolic-ref', '--short', 'refs/remotes/origin/HEAD'])
  if (head !== undefined && head !== '') return head.replace(/^origin\//, '')
  for (const name of ['main', 'master']) {
    const ref = await git(run, cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${name}`])
    if (ref !== undefined) return name
  }
  return currentBranch(run, cwd)
}

export type BranchCheck = { isDefault: boolean; current?: string; expected?: string }

/** 今いるブランチが既定ブランチか。Git 管理外は常に true（ブランチの概念がない）。 */
export async function checkBranch(
  run: Run,
  cwd: string,
  configured: string | undefined,
): Promise<BranchCheck> {
  const current = await currentBranch(run, cwd)
  if (current === undefined) return { isDefault: true }
  if (configured === '*') return { isDefault: true, current, expected: '*' }
  const expected = await defaultBranch(run, cwd, configured)
  if (expected === undefined) return { isDefault: true, current }
  return { isDefault: current === expected, current, expected }
}
