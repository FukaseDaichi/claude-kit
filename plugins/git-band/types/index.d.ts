// git-band の $.state 契約。セッション中だけ持つ値。

export type GitStatus = {
  /** ブランチ名。detached HEAD なら null */
  branch: string | null
  /** 追跡ブランチ（origin/main など）。なければ null */
  upstream: string | null
  /** 未 push のコミット数（upstream がなければ 0） */
  ahead: number
  /** 手元にまだ取り込んでいないコミット数（最後の fetch 時点） */
  behind: number
  /** 未コミットの変更（未追跡ファイルを含む）の数 */
  changes: number
  /** worktree の数（本体を含む） */
  worktrees: number
}

declare module 'claude-code' {
  interface PluginState {
    'git-band': {
      /** git リポジトリでなければ null */
      status: GitStatus | null
      /** pull 実行中なら true */
      isPulling: boolean
      /** コミットして push を Claude に依頼し、そのターンが終わるまで true */
      isShipping: boolean
      /** push が終わった直後の数秒だけ、push したブランチ名。それ以外は null */
      pushedBranch: string | null
    }
  }
}
