// git の出力の解釈と、Claude へ送る依頼文。$ に触れない純粋な関数だけを置く。

import type { GitStatus } from '../types'

/** `git status --porcelain=v2 --branch` の出力から、worktree 数以外を取り出す。 */
export function parseStatus(text: string): Omit<GitStatus, 'worktrees'> {
  let branch: string | null = null
  let upstream: string | null = null
  let ahead = 0
  let behind = 0
  let changes = 0
  for (const line of text.split('\n')) {
    if (line.startsWith('# branch.head ')) {
      const head = line.slice('# branch.head '.length).trim()
      branch = head === '(detached)' ? null : head
    } else if (line.startsWith('# branch.upstream ')) {
      upstream = line.slice('# branch.upstream '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const m = /\+(\d+) -(\d+)/.exec(line)
      if (m) {
        ahead = Number(m[1])
        behind = Number(m[2])
      }
    } else if (/^[12u?] /.test(line)) {
      changes += 1
    }
  }
  return { branch, upstream, ahead, behind, changes }
}

/** `git worktree list --porcelain` の出力から worktree の数を数える（本体を含む）。 */
export function countWorktrees(text: string): number {
  return text.split('\n').filter(line => line.startsWith('worktree ')).length
}

/** pull の失敗が通信・認証によるものか。これは Claude に渡しても解決しないので通知だけにする。 */
export function isNetworkError(text: string): boolean {
  return /could not resolve host|unable to access|authentication failed|could not read from remote|connection (timed out|refused)|network is unreachable|permission denied \(publickey\)/i.test(
    text,
  )
}

/** git の出力の要点を1行にする（通知用）。 */
export function firstLine(text: string): string {
  const line = text
    .split('\n')
    .map(s => s.trim())
    .find(s => s !== '' && !s.startsWith('hint:'))
  return line ?? '原因不明のエラー'
}

/** 帯に出す状態の文言。 */
export function describe(s: GitStatus): string {
  // 0 の項目は出さない。何もなければ「変更なし」
  const parts: string[] = []
  if (s.changes > 0) parts.push(`未コミット ${s.changes}`)
  if (s.upstream === null) parts.push('upstream なし')
  else if (s.ahead > 0) parts.push(`未push ${s.ahead}`)
  if (s.behind > 0) parts.push(`未pull ${s.behind}`)
  // 本体を除いた追加の worktree の数だけを出す。追加がなければ出さない
  if (s.worktrees > 1) parts.push(`worktree +${s.worktrees - 1}`)
  return parts.length > 0 ? parts.join(' · ') : '変更なし'
}

/** コミットして push ボタンを出すか。 */
export function canShip(s: GitStatus): boolean {
  if (s.branch === null) return false
  return s.changes > 0 || s.ahead > 0 || s.upstream === null
}

/** pull ボタンを出すか（追跡ブランチがないと pull できない）。 */
export function canPull(s: GitStatus): boolean {
  return s.branch !== null && s.upstream !== null
}

const MAX_OUTPUT = 3000

/** `git pull --ff-only` が通らなかったときに Claude へ送る依頼文。 */
export function pullPrompt(cwd: string, s: GitStatus | null, output: string): string {
  const trimmed = output.trim()
  const shown = trimmed.length > MAX_OUTPUT ? `${trimmed.slice(0, MAX_OUTPUT)}\n…（以下省略）` : trimmed
  const where = s?.branch ? `${cwd}（ブランチ ${s.branch}${s.upstream ? ` ← ${s.upstream}` : ''}）` : cwd
  return [
    'git-band の pull ボタンで `git pull --ff-only` を実行しましたが、早送りでは取り込めませんでした。次の方針で pull を完了させてください。',
    '',
    `リポジトリ: ${where}`,
    '',
    '`git pull --ff-only` の出力:',
    '```',
    shown === '' ? '（出力なし）' : shown,
    '```',
    '',
    '方針:',
    '- 基本は `git pull --rebase --autostash`。手元の未コミットの変更は退避して pull の後に戻す',
    '- まだ push していない手元のコミットはリモートの上に積み直す。マージコミットは作らない',
    '- コンフリクトは、両方の変更の意図が読み取れて結果が自明なら、確認せずに解消して続行する',
    '- どちらを採るかで動作や内容が変わり、判断が必要な箇所があるときだけ AskUserQuestion で選択肢を出して確認する',
    '- push はしない',
    '- 終わったら、取り込んだ内容と自分で解消した箇所を短く報告する',
  ].join('\n')
}

const SHIP_HEADLINE = 'git-band のボタンからの依頼です。今の変更をコミットして push してください。'

/** ターンの最初の文が、コミットして push ボタンの依頼文か。 */
export function isShipPrompt(text: string): boolean {
  return text.includes(SHIP_HEADLINE)
}

/** コミットして push ボタンで Claude へ送る依頼文。 */
export function shipPrompt(cwd: string, s: GitStatus): string {
  const where = s.branch ? `${cwd}（ブランチ ${s.branch}）` : cwd
  return [
    SHIP_HEADLINE,
    '',
    `リポジトリ: ${where}`,
    '',
    '- `git status` と差分を確認し、内容に合ったコミットメッセージでコミットする（リポジトリのコミットメッセージの慣習があれば従う）。関係のない変更が混ざっていれば分けてコミットする',
    '- コミットしてはいけなさそうなファイル（秘密情報・ビルド成果物・一時ファイルなど）があれば、コミットせずに確認する',
    '- 未コミットの変更がなく未 push のコミットだけなら、push だけ行う',
    '- 追跡ブランチがなければ `git push -u origin <ブランチ>` で作る',
    '- push が拒否されたら `git pull --rebase --autostash` で取り込んでから push する。コンフリクトは自明なら確認せずに解消し、判断が必要なときだけ AskUserQuestion で確認する',
    '- 終わったら、コミットの一覧と push 先を短く報告する',
  ].join('\n')
}
