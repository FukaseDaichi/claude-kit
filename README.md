# claude-kit

Claude Code に足せるプラグイン集です。使いたいものだけを選んで入れられます。

## プラグイン一覧

| プラグイン | 種類 | 内容 |
| --- | --- | --- |
| [git-band](plugins/git-band/) | Mod | 入力欄の上に git の状態（ブランチ／未コミット／未 push／追加の worktree）を出し、pull をボタン1つで実行、コミットと push は Claude に依頼する |
| [learnings-loop](plugins/learnings-loop/) | Mod＋スキル | リポジトリの `LEARNINGS.md` に作業中の学びを裏で自動追記し、git commit に同梱する。取り消し・統合の案内つき。スキル `learnings-loop:update-learnings` / `learnings-loop:consolidate-learnings` を同梱 |

各プラグインの詳しい使い方と注意点は、表のリンク先の README を見てください。

## 必要なもの

- Claude Code v2.1.287 以降
- Mod（入力欄の上の帯など）は、ターミナルの Claude Code と Desktop アプリの Code タブで表示されます

## インストール

### いちばん簡単: Claude に頼む

Claude Code に次の文をそのまま貼り付けます。`git-band` の部分は入れたいプラグイン名に変えてください。

```text
https://github.com/FukaseDaichi/claude-kit のプラグインマーケットプレイスを追加して、git-band をユーザースコープでインストールして。claude-kit の自動更新もオンにして。終わったら /reload-plugins が必要かどうか教えて。
```

### 自分でコマンドを打つ

ターミナルで:

```bash
claude plugin marketplace add FukaseDaichi/claude-kit
```

```bash
claude plugin install git-band@claude-kit --scope user
```

Claude Code の中なら `/plugin marketplace add FukaseDaichi/claude-kit` のあと `/plugin install git-band@claude-kit` でも入ります。

### Desktop アプリ

プロンプト欄の横の **+** → **Plugins** → **Add marketplace** で `FukaseDaichi/claude-kit` を追加し、**Add plugin** から入れたいプラグインを選びます。

入れたあと、開いているセッションでは `/reload-plugins` で反映されます（新しいセッションでは自動）。

## 更新

自動更新をオンにしておくと、新しい版が自動で入ります。`/plugin` → **Marketplaces** → **claude-kit** → **Enable auto-update** を選びます。

すぐに最新にしたいときは、同じ画面の **Update marketplace** を選びます。

## アンインストール

```bash
claude plugin uninstall git-band@claude-kit
```

## ライセンス

MIT
