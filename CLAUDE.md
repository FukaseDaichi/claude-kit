# claude-kit 開発ルール

リポジトリ全体がプラグインマーケットプレイス。`plugins/<name>/` が1プラグインで、main に push すると自動更新で利用者に届く。README.md は利用者向けなので開発の話は書かない。

## プラグインの分け方

- Mod は1つで1プラグイン（Mod ごとに入れる・入れないを選べるようにする）
- スキルはテーマごとに1プラグイン。既存のテーマに合えばそこに足す
- プラグイン名は短い kebab-case（スキルは `<プラグイン名>:<スキル名>` で呼ばれる）

## プラグインを足すとき

- `plugin.json` に `version` を書かない（commit ごとに新しい版として扱わせる。validate の警告は無視）
- `plugin.json` と `.claude-plugin/marketplace.json` の `name`・`description` を揃える
- README.md の一覧表に `[<name>](plugins/<name>/)` の形で1行足す
- プラグインの README は git-band のものを見本にする

## 守ること

- 帯（`AbovePrompt`）を描く Mod は `await next(e)` で下の Mod の行を受け取り、自分の行の下に積む（帯は全 Mod で1本なので、返すだけだとほかの Mod の帯を消す）。git-band の `ui.render` が見本
- プラグインの外のファイルを参照しない（`../../shared` など）。プラグインは別々にキャッシュへコピーされるので、入れた先で動かなくなる
- commit 前に `scripts/check.sh` を通す。手元の版で試すときは `claude --plugin-dir plugins/<name>`
- 公開リポジトリなので、秘密情報・会社の情報・個人のパスを入れない。仕事用のスキルは別の private マーケットプレイスに置く
