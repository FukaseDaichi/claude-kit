# learnings-loop

Claude Code の Mod（function hooks）。リポジトリの `LEARNINGS.md` に、作業中の学びを**裏で自動追記**します。
あなたは何もしなくてよく、気になったときに `/learnings` で見て、要らなければ取り消すだけです。

> 5見出しの `LEARNINGS.md` があるリポジトリでは、確認なしで自動追記します（自分で作ったものでなくても）。追記は未 commit のまま残り、`/learnings undo` で取り消せます。書かせたくないときは下の「止め方」を見てください。

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

その後、`LEARNINGS.md` のない Git リポジトリでセッションを始めると、帯に `📚 このリポジトリに LEARNINGS.md がありません` と出ます。
**作って学びを記録する** を押すと作られ、そのセッションから記録が始まります。**このリポジトリでは聞かない** を押したリポジトリでは、次から出ません。
帯は最初のプロンプトを送ると消えます。あとから作るときは `/learnings init` を打ちます。

**条件**: Claude Code 2.1.287 以上。リポジトリに5見出し（`## Patterns That Work` / `## Mistakes to Avoid` /
`## Domain Knowledge` / `## Open Questions` / `## Consolidated Principles`）の `LEARNINGS.md` があること。
なければ追記はせず、上の案内を出すだけです。

## 何が起きるか

1. セッション開始時に `LEARNINGS.md` を見つけ、`## Consolidated Principles` をシステムプロンプトに注入する（セッション中は固定）
2. **編集ツール（Edit / Write / NotebookEdit / MultiEdit）が成功した、またはツールがエラーになったターン**の直後に、裏で抽出が走る。次のプロンプトは待たされない
   - 1段目: 今の会話をフォークして（`$.model.fork`。プロンプトキャッシュが効く）学びの候補を最大3件、根拠付きで出させる
   - コードで検証: セクション名・1行・200字以内・根拠あり・機密情報なし。根拠が「推測」「直したが未確認」の候補は捨てる
   - 2段目: 小さいモデル（既定 `haiku`）が、既存の `LEARNINGS.md` と「捨てた候補」に照らして **auto / drop** に振り分ける
3. `auto` の候補は、**今いるブランチ（worktree ならその worktree）の** `LEARNINGS.md` の該当セクションの末尾に `- YYYY-MM-DD: 本文` を1行足す。件数の上限はない
4. 帯（入力欄の上）に `📚 観察 12件 ・ 今セッション +2  [📖 追記内容を見る] [✨ 学びを反映]` と出る（Claude が作業中は隠れる）
   - **📖 追記内容を見る**: `/learnings` と同じ内容（追記した行と根拠など）が会話に出る（Claude には送られない）
   - **✨ 学びを反映**: Claude に `learnings-loop:consolidate-learnings` を頼み、生の観察を原則にまとめ、恒常的なルールは指示ファイルやスキルへ移す。押すと音が鳴り、終わるまで帯が「✨ 学びを反映しています…」になり、終わるとチャイムと通知で知らせる（音は macOS だけ）
5. 追記は未 commit のまま作業ツリーに残る。commit したいときに `/learnings commit` を打つと、`LEARNINGS.md` だけを別の commit にする

## 何が起きないか

- `## Consolidated Principles` と冒頭コメントには書かない
- `LEARNINGS.md` が5見出しでなければ何もしない。競合マーカーがあれば書かずに保留し、次のセッション開始時に再判定して書く
- Claude の `git commit` には手を出さない（`git add` も commit もしない）。commit するのは `/learnings commit` を打ったときだけ
- `AGENTS.md` / `CLAUDE.md` / スキルは触らない
- 人に仕分けを求めない。自動の条件を満たさない候補は捨てる（`/learnings` の一覧から採用し直せる）
- 調査だけ・ユーザーの訂正だけで終わったターンは自動では拾わない（`/learnings now` で手動）
- Claude が自分で `LEARNINGS.md` を編集したターン（`update-learnings` を回したときなど）は抽出しない。そのターンまでを処理済みにする

## commit との関係

- 学びは作業中のブランチの `LEARNINGS.md` に書かれ、未 commit のまま残る。Claude には「作業の commit に入れない」と伝えてある
- `/learnings commit` で `LEARNINGS.md` だけの commit（メッセージ「LEARNINGS.md を更新（learnings-loop）」）を作る。手で直した分も含めて、そのファイルの変更すべてが入る。他にステージしていたファイルはステージしたまま残る
- PR に入れたいときは、push の前に `/learnings commit` を打つ
- 以前は Claude の `git commit` の直前に自動で `git add` していたが、やめた。Claude が見た diff と commit の中身がずれて、Claude が「勝手に入った」と判断して commit を作り直すことがあったため

## 取り消し方

- `/learnings undo [番号]`（番号は `/learnings` の一覧）
- 取り消しは「同じ行がそのセクションに残っているときだけ」その1行を消す。手で直した後なら触らない

## コマンド

| コマンド | 動き |
|---|---|
| `/learnings` | 状況: 件数・最終統合日・今セッションの抽出回数と使用量・直近の追記（根拠付き）・保留・捨てた候補。見るだけで閉じてよい |
| `/learnings now` | 今すぐ抽出（きっかけの条件に関係なく、未処理の範囲すべて） |
| `/learnings undo [n]` | n 番目の追記を取り消す（省略で直近） |
| `/learnings adopt <n>` | 捨てた候補の n 番目を採用して書く |
| `/learnings commit` | `LEARNINGS.md` だけを1つの commit にする（他のステージ済みファイルは巻き込まない） |
| `/learnings init` | 5見出しの `LEARNINGS.md` をテンプレートから作る。見出しが足りないときは `--fix` で末尾に足す |

同梱スキル: `learnings-loop:update-learnings`（手動追記）・`learnings-loop:consolidate-learnings`（統合）。
生の観察が80件以上、または最終統合から7日超のときは、帯に「そろそろ反映どき」と出て **✨ 学びを反映** が強調されます。

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
| 統合の案内: 件数 / 日数（「学びを反映」を強調するしきい値） | 80 / 7 |
| 原則の注入 | on |
| init の案内 | on（off = `LEARNINGS.md` のないリポジトリでも帯に出さない） |
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
