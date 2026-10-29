---
name: adding-plugin
description: claude-kit に新しいプラグイン（Mod またはスキルのテーマ）を足すときに使う。plugin.json・marketplace.json・README の一覧表・プラグインの README をそろえる手順。
---

# プラグインを足す

- `plugin.json` に `version` を書かない（commit ごとに新しい版として扱わせる。validate の警告は無視）
- `plugin.json` と `.claude-plugin/marketplace.json` の `name`・`description` を揃える
- README.md の一覧表に `[<name>](plugins/<name>/)` の形で1行足す
- プラグインの README は git-band のものを見本にする

最後に `scripts/check.sh` で、フォルダ・marketplace.json・一覧表が食い違っていないことを確かめる。
