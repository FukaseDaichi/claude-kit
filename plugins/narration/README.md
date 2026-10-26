# narration

文章からナレーション音声（WAV）を作るスキル集。

| スキル | 内容 |
| --- | --- |
| `narration:gemini-tts` | Google の Gemini TTS API（`gemini-3.8-flash-tts`）で、原稿のシーンごとに WAV を作る。1文だけの読み上げ、声の聴き比べ、ja-JP の声一覧も |

```
動画のナレーションを script.txt から作って。声は落ち着いた女性で。
```

のように頼むと、Claude が同梱のスクリプトを `uv run` で実行し、`01-intro.wav` … と `manifest.json`（ファイル名・声・秒数・本文）を書き出す。秒数は動画のシーン長の決定に使える。

- **原稿の形式**: UTF-8 のテキスト。空行で区切ると1シーン。ブロックの1行目に `# intro` のように書くとファイル名になる（読み上げられない）
- **出力**: WAV 24 kHz / 16-bit / mono
- **声・読み方**: `--voice`（既定 Zephyr）と `--style`（既定「明るく、はきはきとした、親しみやすいナレーション」）。読み方の指示は本文に書かず `--style` に入れる
- **モデル**: 既定 `gemini-3.8-flash-tts`。安く速くしたいときは `--model flash-lite`

## 必要なもの

- [uv](https://docs.astral.sh/uv/)（スクリプトが依存ライブラリを自分で入れる。Python の SDK や GCP プロジェクトは不要）
- Gemini API キー。次のどれかに置く（上から順に探す）
  1. 環境変数 `GEMINI_API_KEY`
  2. 作業フォルダの `./.env`
  3. `~/.claude/narration/.env`（複数プロジェクトで使うならここ）

`.env` の書き方は `skills/gemini-tts/.env.example` を参照。プラグインのフォルダの中には置かない（更新のたびに消える）。

## 注意

- API 呼び出しは有料。`--dry-run` を付けると、キーなしで作られるファイルの一覧だけ確認できる
- 読み間違いは、本文をかな書きにするか（「ＡＰＩ」→「エーピーアイ」）、間や笑いは `<short pause>` のように山括弧で本文に入れる

## 導入

```bash
claude plugin marketplace add FukaseDaichi/claude-kit
claude plugin install narration@claude-kit --scope user -y
```

入れ方と更新のしかたはリポジトリ直下の [README](../../README.md) を参照。

## 開発

```bash
claude plugin validate plugins/narration
```
