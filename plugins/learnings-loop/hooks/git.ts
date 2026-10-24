// git の呼び出し。$.process.run で呼ぶ。失敗はすべて undefined（か false）に畳む。

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

/** そのファイルに未 commit の変更（未追跡を含む）があるか。 */
export async function hasChanges(run: Run, cwd: string, path: string): Promise<boolean> {
  const out = await git(run, cwd, ['status', '--porcelain', '--', path])
  return out !== undefined && out !== ''
}

/** そのファイルを index に載せる。成功したら true。 */
export async function stage(run: Run, cwd: string, path: string): Promise<boolean> {
  return (await git(run, cwd, ['add', '--', path])) !== undefined
}
