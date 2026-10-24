# claude-kit

FukaseDaichi の Claude Code 用スキル・Mod・エージェント集。リポジトリ全体が1つのプラグインマーケットプレイスになっていて、`plugins/` の下の各フォルダが1つのプラグイン。

## プラグイン一覧

| プラグイン | 種類 | 内容 |
| --- | --- | --- |
| [git-band](plugins/git-band/) | Mod | 入力欄の上に git の状態（ブランチ／未コミット／未 push／追加の worktree）を出し、pull をボタン1つで実行、コミットと push は Claude に依頼する |

## 使う（ほかの人・ほかの PC）

```bash
claude plugin marketplace add FukaseDaichi/claude-kit
claude plugin install git-band@claude-kit --scope user -y
```

Desktop アプリでは、プロンプト欄の横の + → Plugins → Add marketplace で `FukaseDaichi/claude-kit` を追加し、Add plugin から入れる。

- 更新: `claude plugin update git-band@claude-kit`。自動で受け取るには `/plugin` → Marketplaces → claude-kit → **Enable auto-update**（セッション開始後、最大10分ほどで反映）
- `plugin.json` に `version` を書いていないので、commit ごとに新しい版として扱われる
- Mod は Claude Code v2.1.287 以降が必要。帯やペインはターミナルと Desktop アプリの Code タブで描画される（`claude -p`・Agent SDK では描画されない）

## メンテする（自分の PC）

clone したフォルダをそのままマーケットプレイスとして登録する。フォルダから直接読み込まれるので、更新は `git pull` → 開いているセッションで `/reload-plugins` だけでよい（再インストール不要）。

```bash
git clone https://github.com/FukaseDaichi/claude-kit.git ~/git/claude-kit
claude plugin marketplace add ~/git/claude-kit
claude plugin install git-band@claude-kit --scope user -y
```

どの PC で直しても commit → push すれば、もう一方は `git pull` で受け取れる。

## プラグインを足すとき

1. `plugins/<name>/` を作る（`.claude-plugin/plugin.json` に `name` と `description`。`version` は書かない）
2. `.claude-plugin/marketplace.json` の `plugins` に `{ "name", "description", "author", "source": "./plugins/<name>" }` を足す
3. 上の一覧表に1行足す
4. 確認: `claude plugin validate plugins/<name>`（Mod なら `claude plugin test plugins/<name>` も）

- スキルは `plugins/<name>/skills/<skill>/SKILL.md` に置く。呼び出し名は `<name>:<skill>` になる
- テーマごとにプラグインを分ける（入れた分だけスキルの説明が常に文脈を使うので、要るものだけ入れられるようにする）
- public リポジトリなので、秘密情報・会社の情報・個人のパスを入れない

## ライセンス

MIT
