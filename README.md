# claude-kit

FukaseDaichi の Claude Code 用スキル・Mod・エージェント集。リポジトリ全体が1つのプラグインマーケットプレイスで、使いたいプラグインだけを選んで入れられる。

## プラグイン一覧

| プラグイン | 種類 | 内容 |
| --- | --- | --- |
| [git-band](plugins/git-band/) | Mod | 入力欄の上に git の状態（ブランチ／未コミット／未 push／追加の worktree）を出し、pull をボタン1つで実行、コミットと push は Claude に依頼する |

## 入れる

```bash
claude plugin marketplace add FukaseDaichi/claude-kit
claude plugin install <プラグイン名>@claude-kit --scope user -y
```

Desktop アプリでは、プロンプト欄の横の + → Plugins → Add marketplace で `FukaseDaichi/claude-kit` を追加し、Add plugin から入れる。

- Mod は Claude Code v2.1.287 以降が必要。帯やペインはターミナルと Desktop アプリの Code タブで描画される（`claude -p`・Agent SDK では描画されない）

## 更新する

自動更新をオンにする（どちらか）:

- `/plugin` → Marketplaces → claude-kit → **Enable auto-update**
- `~/.claude/settings.json` の `extraKnownMarketplaces` に書く:

  ```json
  "claude-kit": {
    "source": { "source": "github", "repo": "FukaseDaichi/claude-kit" },
    "autoUpdate": true
  }
  ```

オンにすると、セッションで最初のメッセージを送ってから最大10分ほどで新しい版が入る（開いているセッションは `/reload-plugins`、次のセッションからは自動で反映）。今すぐ欲しいときは `/plugin` → Marketplaces → claude-kit → **Update marketplace**（claude-kit の全プラグインをまとめて更新）。

## 開発

開発のルールと手順は [CLAUDE.md](CLAUDE.md) にまとめてある。

## ライセンス

MIT
