# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "httpx>=0.27",
#     "python-dotenv>=1.0",
# ]
# ///
"""Generate narration audio (WAV) from text with the Gemini TTS API.

Usage:
  uv run tts.py script.txt [-o out_dir]          # one WAV per scene block
  uv run tts.py --text "こんにちは" [-o out.wav]  # single utterance
  uv run tts.py --text "..." --audition Zephyr,Leda,Autonoe   # compare voices
  uv run tts.py --list-voices                    # prebuilt voices for Japanese

Scene script format (script.txt): blocks separated by blank lines.
A first line starting with '#' names the block (used in the file name).

  # intro
  こんにちは。このシステムの紹介を始めます。

  # feature-1
  まず、ダッシュボードの使い方です。

API key lookup order: GEMINI_API_KEY env var -> ./.env -> ~/.claude/narration/.env
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
import wave
from pathlib import Path

import httpx
from dotenv import dotenv_values

# Windows consoles default to cp932; keep Japanese output readable everywhere.
for _stream in (sys.stdout, sys.stderr):
    if hasattr(_stream, "reconfigure"):
        _stream.reconfigure(encoding="utf-8", errors="replace")

API_BASE = "https://generativelanguage.googleapis.com/v1beta"
DEFAULT_MODEL = "gemini-3.8-flash-tts"
MODEL_ALIASES = {
    "flash": "gemini-3.8-flash-tts",
    "flash-lite": "gemini-3.8-flash-lite-tts",
    "lite": "gemini-3.8-flash-lite-tts",
}
DEFAULT_VOICE = "Zephyr"
DEFAULT_STYLE = "明るく、はきはきとした、親しみやすいナレーション"
USER_ENV = Path.home() / ".claude" / "narration" / ".env"


# ---------------------------------------------------------------- API key ---
def resolve_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY")
    if key:
        return key
    candidates = [Path.cwd() / ".env", USER_ENV]
    for env_path in candidates:
        if env_path.is_file():
            key = dotenv_values(env_path).get("GEMINI_API_KEY")
            if key:
                return key
    sys.exit(
        "GEMINI_API_KEY が見つかりません。次のいずれかに設定してください:\n"
        "  - 環境変数 GEMINI_API_KEY\n"
        f"  - {candidates[0]}  (GEMINI_API_KEY=...)\n"
        f"  - {candidates[1]}  (GEMINI_API_KEY=...)"
    )


# --------------------------------------------------------------- parsing ---
def parse_script(path: Path) -> list[tuple[str | None, str]]:
    """Return [(name_or_None, text), ...] from a blank-line separated script."""
    raw = path.read_text(encoding="utf-8-sig")
    blocks = re.split(r"\n\s*\n", raw.strip())
    scenes: list[tuple[str | None, str]] = []
    for block in blocks:
        lines = [ln.rstrip() for ln in block.strip().splitlines()]
        name = None
        if lines and lines[0].lstrip().startswith("#"):
            name = lines[0].lstrip("#").strip() or None
            lines = lines[1:]
        text = "\n".join(ln for ln in lines if ln.strip())
        if text:
            scenes.append((name, text))
    return scenes


def safe_name(name: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\s]+', "-", name.strip())
    return name.strip("-") or "scene"


# ------------------------------------------------------------------- API ---
def synthesize(client: httpx.Client, api_key: str, *, model: str, text: str,
               voice: str, style: str | None) -> bytes:
    annotation: dict = {"type": "speech_metadata"}
    if style:
        annotation["style"] = style
    body = {
        "model": model,
        "input": [{
            "type": "user_input",
            "content": [{"type": "text", "text": text, "annotations": [annotation]}],
        }],
        "response_format": {"type": "audio"},  # WAV, 24 kHz, 16-bit mono
        "generation_config": {"speech_config": [{"voice": voice}]},
    }
    headers = {"x-goog-api-key": api_key, "Content-Type": "application/json"}

    last_err = ""
    for attempt in range(1, 4):
        resp = client.post(f"{API_BASE}/interactions", json=body, headers=headers)
        if resp.status_code == 200:
            data = resp.json()
            audio = [
                c["data"]
                for step in data.get("steps", []) if step.get("type") == "model_output"
                for c in step.get("content", []) if c.get("type") == "audio"
            ]
            if not audio:
                sys.exit("音声が返ってきませんでした。レスポンス:\n"
                         + json.dumps(data, ensure_ascii=False)[:2000])
            return base64.b64decode(audio[-1])
        last_err = f"HTTP {resp.status_code}: {resp.text[:1000]}"
        if resp.status_code in (429, 500, 502, 503, 504) and attempt < 3:
            time.sleep(2 * attempt)
            continue
        break
    sys.exit(f"Gemini API エラー: {last_err}")


def wav_duration(path: Path) -> float:
    with wave.open(str(path), "rb") as w:
        return w.getnframes() / w.getframerate()


def list_voices(client: httpx.Client, api_key: str) -> None:
    resp = client.get(
        f"{API_BASE}/voices",
        params=[("language_code", "ja-JP"), ("type", "prebuilt"), ("page_size", "100")],
        headers={"x-goog-api-key": api_key},
    )
    if resp.status_code != 200:
        sys.exit(f"Gemini API エラー: HTTP {resp.status_code}: {resp.text[:1000]}")
    for v in resp.json().get("voices", []):
        vid = v.get("id") or v.get("name") or ""
        print(f"{vid:<16} {v.get('gender', ''):<8} pitch={v.get('pitch', ''):<7} {v.get('description', '')}")


# ------------------------------------------------------------------ main ---
def main() -> None:
    p = argparse.ArgumentParser(description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("script", nargs="?", type=Path,
                   help="scene script file (blank-line separated blocks)")
    p.add_argument("--text", "-t", help="single text to synthesize instead of a script file")
    p.add_argument("-o", "--out", type=Path,
                   help="output dir (script mode) or .wav path (--text mode)")
    p.add_argument("--voice", default=DEFAULT_VOICE,
                   help=f"prebuilt voice name (default: {DEFAULT_VOICE})")
    p.add_argument("--style", default=DEFAULT_STYLE, help="delivery instruction; '' to disable")
    p.add_argument("--model", default=DEFAULT_MODEL,
                   help=f"model id or alias flash|flash-lite (default: {DEFAULT_MODEL})")
    p.add_argument("--audition", metavar="VOICES",
                   help="comma-separated voices; with --text, writes one WAV per voice")
    p.add_argument("--list-voices", action="store_true",
                   help="list prebuilt voices for ja-JP and exit")
    p.add_argument("--dry-run", action="store_true",
                   help="show planned scenes/files without calling the API")
    args = p.parse_args()

    model = MODEL_ALIASES.get(args.model, args.model)
    style = args.style or None

    if args.list_voices:
        with httpx.Client(timeout=60) as client:
            list_voices(client, resolve_api_key())
        return

    # Build job list: (output_path, text, voice)
    jobs: list[tuple[Path, str, str]] = []
    if args.text:
        if args.audition:
            out_dir = args.out or Path("audition")
            for v in [x.strip() for x in args.audition.split(",") if x.strip()]:
                jobs.append((out_dir / f"{v}.wav", args.text, v))
        else:
            jobs.append((args.out or Path("out.wav"), args.text, args.voice))
    elif args.script:
        if not args.script.is_file():
            sys.exit(f"原稿ファイルがありません: {args.script}")
        scenes = parse_script(args.script)
        if not scenes:
            sys.exit("原稿にシーンが見つかりません（空行区切りでブロックを書いてください）")
        out_dir = args.out or Path(args.script.stem)
        width = max(2, len(str(len(scenes))))
        for i, (name, text) in enumerate(scenes, 1):
            fname = f"{i:0{width}d}-{safe_name(name)}.wav" if name else f"{i:0{width}d}.wav"
            jobs.append((out_dir / fname, text, args.voice))
    else:
        p.error("script file or --text is required")

    print(f"model={model} style={style!r}")
    if args.dry_run:
        for path, text, voice in jobs:
            print(f"[dry-run] {path}  voice={voice}  {text[:40]!r}")
        return

    api_key = resolve_api_key()
    manifest = []
    with httpx.Client(timeout=120) as client:
        for path, text, voice in jobs:
            path.parent.mkdir(parents=True, exist_ok=True)
            audio = synthesize(client, api_key, model=model, text=text, voice=voice, style=style)
            path.write_bytes(audio)
            dur = wav_duration(path)
            print(f"{path}  {dur:6.2f}s  voice={voice}")
            manifest.append({"file": path.name, "voice": voice,
                             "duration_sec": round(dur, 3), "text": text})

    if len(jobs) > 1:
        mpath = jobs[0][0].parent / "manifest.json"
        mpath.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"manifest: {mpath}")


if __name__ == "__main__":
    main()
