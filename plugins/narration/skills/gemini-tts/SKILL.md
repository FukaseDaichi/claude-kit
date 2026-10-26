---
name: gemini-tts
description: Use when the user wants narration, voiceover, or spoken audio generated from text with Google's Gemini TTS API (API key), e.g. Japanese narration WAV files for HyperFrames / motion / product-intro videos, scene-by-scene voice tracks, or auditioning Gemini voices.
---

# Gemini TTS

Generate narration WAV files from text with the Gemini API (`gemini-3.8-flash-tts`), via a
single uv-run script. No SDK install, no GCP project; just a `GEMINI_API_KEY`.

**Do not write ad-hoc Gemini TTS code from memory.** The 2.5/3.1 `generateContent` +
`responseModalities: AUDIO` + raw-PCM flow is legacy. The bundled script already uses the
current Interactions API (`POST /v1beta/interactions`, `x-goog-api-key` header); run it.

## Quick reference

Script: `${CLAUDE_PLUGIN_ROOT}/skills/gemini-tts/scripts/tts.py` (run with `uv run`, never bare).
Below, `tts.py` stands for that full path.

| Task | Command |
|------|---------|
| Scene-by-scene WAVs | `uv run tts.py script.txt -o audio/` |
| One line of speech | `uv run tts.py --text "こんにちは" -o hello.wav` |
| Compare voices | `uv run tts.py --text "試聴用の文" --audition Zephyr,Leda,Autonoe,Sadachbia -o audition/` |
| List ja-JP voices | `uv run tts.py --list-voices` |
| Preview file plan, no API call | add `--dry-run` |
| Cheaper/faster model | `--model flash-lite` |
| Change voice / delivery | `--voice Leda --style "落ち着いて、ゆっくり"` |

Defaults: model `gemini-3.8-flash-tts`, voice `Zephyr` (bright female), style
「明るく、はきはきとした、親しみやすいナレーション」. Output: WAV 24 kHz / 16-bit / mono.
Batch runs also write `manifest.json` (file, voice, duration_sec, text) next to the WAVs;
use `duration_sec` to time video scenes.

## Scene script format

Plain UTF-8 text. Blank line = new scene. Optional `# name` on the first line of a block
becomes part of the file name (`01-name.wav`); otherwise `01.wav`, `02.wav`, ...
Names are for files only and are never spoken; prefer ASCII (`intro`, `feature-1`) so the
WAV paths stay web-safe. Spaces and `\/:*?"<>|` in a name become `-`.

```text
# intro
こんにちは。このシステムの紹介を始めます。

# dashboard
まず、ダッシュボードの使い方です。
画面左のメニューから機能を選択します。
```

## API key

Lookup order: env var `GEMINI_API_KEY` → `./.env` (current dir) → `~/.claude/narration/.env`.
First-time setup: copy `${CLAUDE_PLUGIN_ROOT}/skills/gemini-tts/.env.example` to
`~/.claude/narration/.env` and fill in the key. Do not put `.env` inside the plugin folder;
it is replaced on every plugin update.
Never paste the key into commands or files other than `.env`.
Run from the project folder (so `./.env` and relative `-o` paths resolve there).
`--dry-run` needs no key; `--list-voices` and real runs do.

## Writing text that reads well

- The `text` is spoken **verbatim**. Put tone/pace instructions in `--style`, not in the text.
- Pauses and vocal cues go inline in angle brackets: `<short pause>`, `<laugh>`, `<sigh>`.
- Hard-to-read kanji, product names, numbers: write the reading in kana or add spaces
  (e.g. 「ＡＰＩ」→「エーピーアイ」) when a first render mispronounces it.
- Keep one scene to a few sentences; regenerate only the scenes whose text changed.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Using `gemini-2.5-*-tts` / `gemini-3.1-flash-tts-preview` | Legacy. Script uses `gemini-3.8-flash-tts`; pass `--model` only to switch to `flash-lite`. |
| Expecting raw PCM and wrapping it in a WAV header | 3.8 returns a complete WAV already; the script writes bytes as-is. |
| Prefixing the text with 「明るく読んで：」 | It gets spoken. Use `--style`. |
| Garbled Japanese in console output | Script forces UTF-8 stdout; if you call the API yourself, set `PYTHONUTF8=1`. |
| HTTP 429 / 5xx on long batches | Script retries 3× with backoff; if it still fails, rerun — finished files are overwritten safely. |
