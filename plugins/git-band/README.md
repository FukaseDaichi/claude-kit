# git-band

入力欄の上の帯に git の状態を出す Claude Code Mod。

```
⎇ main ・ 未コミット 2 ・ 未push 1 ・ worktree +1  [⬇ pull] [⬆ コミットして push]
```

- **表示**: ブランチ／未コミット数（未追跡を含む）／未 push 数／追加の worktree 数（本体を除く。追加がなければ出さない）。最後の fetch 時点で取り込み待ちがあれば「未pull N」も出る。更新はセッション開始・ターン終了・ボタン操作の後・30秒ごと。git リポジトリでなければ帯を出さない
- **⬇ pull**（`p`）: Mod が `git pull --ff-only` を直接実行し、結果を通知する。早送りできないとき（未コミットの変更とぶつかる・履歴が分かれている）は、git の出力を添えて Claude に pull を依頼する（`--rebase --autostash`、自明なコンフリクトは確認なしで解消、判断が要るときだけ質問、push はしない）。通信・認証のエラーは通知だけ
- **⬆ コミットして push**（`s`）: Claude に「差分を見てコミットし push して」と依頼する。未コミットも未 push もなければ出ない

## 注意

- Mod から実行する git はリポジトリのフック（pre-commit / pre-push など）が無効になる（Mods の仕様）。Claude に依頼した操作は通常どおりフックが動く
- 帯は Mod 全体で1本しかない。ほかに帯を描く Mod を入れると、先に動く方だけが表示される
- 帯が出るのはターミナルと Desktop アプリの Code タブ。`claude -p`・Agent SDK（Obsidian の Claudian など）では描画されない

## 導入

```bash
claude plugin marketplace add FukaseDaichi/claude-kit
claude plugin install git-band@claude-kit --scope user -y
```

入れ方と更新のしかたはリポジトリ直下の [README](../../README.md) を参照。

## 開発

```bash
claude plugin validate plugins/git-band
claude plugin test plugins/git-band
```
