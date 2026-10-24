# claude-kit 開発ルール

このリポジトリ全体が Claude Code のプラグインマーケットプレイス `claude-kit`。`plugins/<name>/` の各フォルダが1つのプラグインで、GitHub（`FukaseDaichi/claude-kit`）に push すると自動更新で利用者に届く。README.md は利用者向け、このファイルは開発ルール。

## プラグインの分け方

- **Mod は1つで1プラグイン**にする。帯は全体で1本しか出ないので、Mod ごとに入れる・入れないを選べるようにする
- **スキルはテーマごとに1プラグイン**にまとめる（例: `dev-skills`）。1スキル1プラグインにはしない。全部を1つにもしない（入れた分だけスキルの説明が常に文脈を使う）
- 既存のテーマに合うスキルはそのプラグインに足す。合わなければ新しいプラグインを作る
- スキルの呼び出し名は `<プラグイン名>:<スキル名>` になるので、プラグイン名は短い kebab-case にする

## プラグインを足すとき

1. `plugins/<name>/.claude-plugin/plugin.json` を作る（`name`・`description`・`author: { "name": "FukaseDaichi" }`）。`version` は書かない（commit ごとに新しい版として扱わせるため。validate の version 警告は無視してよい）
2. `plugins/<name>/README.md` を書く（何をするか・注意点・導入コマンド・開発コマンド）。git-band の README が見本
3. `.claude-plugin/marketplace.json` の `plugins` に `{ "name", "description", "author", "source": "./plugins/<name>" }` を足す。`name` と `description` は plugin.json と揃える
4. README.md の「プラグイン一覧」の表に1行足す（リンクは `[<name>](plugins/<name>/)` の形。check.sh がこの形で探す）
5. `scripts/check.sh` を通す

スキルを足すだけのときは 3〜4 は不要（プラグインの README のスキル一覧は更新する）。

## 置き場所

- スキル: `plugins/<name>/skills/<skill>/SKILL.md`。補助資料は同じフォルダの `references/`、スクリプトは `scripts/`
- Mod: `plugins/<name>/hooks/hooks.json` と `hooks/*.tsx|ts`、`$.state` の型は `types/index.d.ts`、テストは `tests/`
- **プラグインの外のファイルを参照しない**（`../../shared` など）。入れたプラグインはそれぞれ別々にキャッシュへコピーされるので、外を参照すると入れた先で動かない。共通にしたい処理は各プラグインに持たせる
- エンジンが生成する `.claude-plugin/types/` は commit しない（.gitignore 済み）

## 確認

```bash
scripts/check.sh              # 全プラグイン
scripts/check.sh <name>       # 1つだけ（登録の食い違いチェックは常に全体）
claude --plugin-dir plugins/<name>   # 手元の版で起動して試す
```

check.sh は、plugins/ のフォルダ・marketplace.json・README の一覧表の食い違い、`claude plugin validate`、`tests/` があれば `claude plugin test` を見る。commit 前に必ず通す。

## 公開リポジトリなので

- 秘密情報・会社の情報（社内の手順・ツール名・URL）・個人のパス（`/Users/...`）を入れない
- 仕事用のスキルは別の private リポジトリのマーケットプレイスに置く
