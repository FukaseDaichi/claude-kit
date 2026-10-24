# learnings-loop

Claude Code の Mod（function hooks）。リポジトリの `LEARNINGS.md` に、作業中の学びを**裏で自動追記**します。
あなたは何もしなくてよく、気になったときに `/learnings` で見て、要らなければ取り消すだけです。

> **試験中**: 自動テスト（`claude plugin test`）と型チェックは通っていますが、実機での動作確認（Claudian など画面のないホストでの読み込み、フォークの可否、キャッシュ命中と使用量、圧縮・`/clear` 後の挙動など）は終わっていません。他人のリポジトリの `LEARNINGS.md` に自動で書き込む Mod なので、入れる前に下の「何が起きるか」「止め方」を読んでください。
>
> 入力欄の上の帯は Mod 全体で1本しかないため、同じ claude-kit の git-band と同時に入れると、どちらか一方の帯しか出ないことがあります。

## インストール

ターミナルの Claude Code で:

```
/plugin install learnings-loop --marketplace FukaseDaichi/claude-kit
```

シェルから:

```
claude plugin marketplace add FukaseDaichi/claude-kit
claude plugin install learnings-loop@claude-kit --scope user
```

その後、学びを貯めたいリポジトリで `/learnings init` を実行して `LEARNINGS.md` を作ります。

**条件**: Claude Code 2.1.287 以上。リポジトリに5見出し（`## Patterns That Work` / `## Mistakes to Avoid` /
`## Domain Knowledge` / `## Open Questions` / `## Consolidated Principles`）の `LEARNINGS.md` があること。
なければ Mod は何もしません（`/learnings` を打つと `init` を案内します）。

## 何が起きるか

1. セッション開始時に `LEARNINGS.md` を見つけ、`## Consolidated Principles` をシステムプロンプトに注入する（セッション中は固定）
2. **編集ツール（Edit / Write / NotebookEdit / MultiEdit）が成功した、またはツールがエラーになったターン**の直後に、裏で抽出が走る。次のプロンプトは待たされない
   - 1段目: 今の会話をフォークして（`$.model.fork`。プロンプトキャッシュが効く）学びの候補を最大3件、根拠付きで出させる
   - コードで検証: セクション名・1行・200字以内・根拠あり・機密情報なし。根拠が「推測」「直したが未確認」の候補は捨てる
   - 2段目: 小さいモデル（既定 `haiku`）が、既存の `LEARNINGS.md` と「捨てた候補」に照らして **auto / drop** に振り分ける
3. `auto` の候補は、**今いるブランチ（worktree ならその worktree）の** `LEARNINGS.md` の該当セクションの末尾に `- YYYY-MM-DD: 本文` を1行足す。件数の上限はない
4. 帯（入力欄の上）に `📚 今セッション 2件追記（u 取り消し）` と出る。セッション中ずっと出る
5. Claude が `git commit` を実行する直前に、`LEARNINGS.md` に未 commit の変更があれば `git add` して、作業と同じ commit に入れる

## 何が起きないか

- `## Consolidated Principles` と冒頭コメントには書かない
- `LEARNINGS.md` が5見出しでなければ何もしない。競合マーカーがあれば書かずに保留し、次のセッション開始時に再判定して書く
- 自分で commit はしない。`git add` するのは Claude の `git commit` の直前だけ
- `AGENTS.md` / `CLAUDE.md` / スキルは触らない
- 人に仕分けを求めない。自動の条件を満たさない候補は捨てる（`/learnings` の一覧から採用し直せる）
- 調査だけ・ユーザーの訂正だけで終わったターンは自動では拾わない（`/learnings now` で手動）
- Claude が自分で `LEARNINGS.md` を編集したターン（`update-learnings` を回したときなど）は抽出しない。そのターンまでを処理済みにする

## commit との関係

- 学びは作業中のブランチに書かれ、作業の commit と一緒に PR へ入る
- `git commit` の直前に `LEARNINGS.md` を `git add` するので、手で直した分も含めてそのファイルの変更はすべてその commit に入る
- commit したターンそのものから出た学びは、ターンの後に抽出されるので次の commit に回る。最後の commit の後に出た学びは、未 commit のまま作業ツリーに残る
- `git -C <別のリポジトリ> commit` でも、`git add` するのは今のセッションの `LEARNINGS.md` だけ

## 取り消し方

- 帯の `u`（直近1件）。帯は `ctrl+x tab` で選択してからキーを押す
- `/learnings undo [番号]`（番号は `/learnings` の一覧）
- 取り消しは「同じ行がそのセクションに残っているときだけ」その1行を消す。手で直した後なら触らない

## コマンド

| コマンド | 動き |
|---|---|
| `/learnings` | 状況: 件数・最終統合日・今セッションの抽出回数と使用量・直近の追記（根拠付き）・保留・捨てた候補。見るだけで閉じてよい |
| `/learnings now` | 今すぐ抽出（きっかけの条件に関係なく、未処理の範囲すべて） |
| `/learnings undo [n]` | n 番目の追記を取り消す（省略で直近） |
| `/learnings adopt <n>` | 捨てた候補の n 番目を採用して書く |
| `/learnings init` | 5見出しの `LEARNINGS.md` をテンプレートから作る。見出しが足りないときは `--fix` で末尾に足す |

同梱スキル: `learnings-loop:update-learnings`（手動追記）・`learnings-loop:consolidate-learnings`（統合）。
生の観察が80件以上、または最終統合から7日超のとき、セッション開始直後の帯に `[c 統合する]` が出ます。

## 止め方

- `/config` で `learnings-loop` の「抽出」を `manual` にする（`/learnings now` のときだけ動く）
- `claude plugin disable learnings-loop`、またはアンインストール
- 記録（保留・捨てた候補・追記履歴）は Claude Code の plugin store（`$.store`）に端末ごとに残る。消したいときは `claude plugin uninstall learnings-loop` の後に store を消す

## 使用量

抽出のたびに**セッションと同じ認証**でモデルを呼びます（フォーク1回＋小さいモデル1回）。
サブスクリプション（Max/Pro）ならレート制限枠を消費するだけで別途課金はありません。`ANTHROPIC_API_KEY` が
環境にあればそちらに課金されます（Claude Code 本体と同じ）。`/learnings` に今セッションの消費が出ます。
重ければ `/config` で「抽出の最低間隔」を増やしてください。

## 機密情報

会話中の認証情報・メールアドレス・顧客名などを書かないよう、1段目のプロンプトで除外を指示し、コードでも
正規表現（APIキー・トークン・メール・Bearer・URLのクエリ等）で検査しています。**完全ではありません。**
`LEARNINGS.md` を公開リポジトリに置く場合は、自動追記の内容を見直してください。

## 設定（`/config` → learnings-loop）

| 項目 | 既定 |
|---|---|
| 抽出 | auto（manual = `/learnings now` のときだけ） |
| 1回の抽出の候補上限 | 3 |
| 抽出の最低間隔（ターン） | 0 |
| 統合の案内: 件数 / 日数 | 80 / 7 |
| 原則の注入 | on |
| 本文の文字数上限 | 200 |
| 判定モデル | haiku |

## 対応していないもの

- Codex（Claude Code の Mod なので）
- `LEARNINGS.md` の形式が違うリポジトリ
- 画面のないホスト（`-p`、SDK、Claudian）での帯。抽出と追記は動くので、`/learnings` で確認する

## 開発

```
claude plugin validate plugins/learnings-loop
claude plugin test plugins/learnings-loop
claude --plugin-dir plugins/learnings-loop   # 手元の版で起動して試す（そのセッションだけ入れてある版を置き換える）
```

判定基準の本文は `criteria/CRITERIA.md` の1か所にあり、抽出プロンプトと同梱スキルの両方がそれを使います。
