// learnings-loop の $.state 契約。セッション中だけ持つ値。永続は $.store。

export type LearningsAppended = {
  /** 今セッションで自動追記した件数 */
  count: number
  /** 作業ブランチで保留していた分をまとめて書いたときの件数 */
  fromPending: number
}

export type LearningsNotice = {
  /** 統合の案内を出すか（しきい値を超えている） */
  isDue: boolean
  observations: number
  daysSince?: number
  /** 「学びを反映」を押して、そのターンが終わるのを待っている */
  isReflecting: boolean
}

export type LearningsSession = {
  /** 検出した LEARNINGS.md の絶対パス。なければ null */
  file: string | null
  /** リポジトリの識別キー（git-common-dir の実パス、なければファイルの実パス） */
  repoKey: string | null
  /** LEARNINGS.md のない Git リポジトリで init を案内するときの、そのリポジトリの識別キー。案内しないなら null */
  initOfferFor: string | null
  /** 最初のプロンプトがもう送られたか（init の案内は送られる前だけ） */
  hasPrompted: boolean
}

export type LearningsExtraction = {
  /** 処理済みの最後のユーザーターン番号 */
  processedUpTo: number
  /** 抽出待ちか */
  isPending: boolean
  /** 抽出が走っているか */
  isRunning: boolean
  /** 今セッションの抽出回数と使用量 */
  runs: number
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number }
}

declare module 'claude-code' {
  interface PluginState {
    'learnings-loop': {
      session: LearningsSession
      appended: LearningsAppended
      notice: LearningsNotice
      extraction: LearningsExtraction
    }
  }
}
