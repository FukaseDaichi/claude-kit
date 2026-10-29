# Project Learnings

<!--
記法ルール:
- 1項目1洞察。複数の学びを1行に詰めない
- 各項目の先頭に日付を必ず入れる（例: - 2026-01-01: ...）
- 上4セクションは「生の観察」の置き場。Consolidated Principles には
  統合パスで抽出した原則だけを置く。両者を混ぜない
- 最終統合: （未実施）
-->

## Patterns That Work
（効いたやり方・型）

- 2026-10-25: Mod の型チェックは、tsc がなくても scratchpad に tsconfig（include に plugin-authoring スキルの claude-code.d.ts と plugins/<name>/hooks・types・tests）を置き、npx -y -p typescript@5.6.3 tsc -p <その tsconfig> で、ロード前の Mod でもできる
- 2026-10-26: Mod がシステムプロンプトに文を足せない環境では、prompt.submit で next({ ...e, context: [...(e.context ?? []), 本文] }) を使うと、モデルだけが読み利用者には表示されない添付として渡せる（発言 text の書き換えは不要）
- 2026-10-28: 同梱プラグインや管理設定の説明が手元の資料にないときは、claude 本体のバイナリを grep -a -o ".\{0,200\}<名前>.\{0,300\}" で検索すると説明文が取り出せる。ただし約300MBあり1回に90秒以上かかるので、バックグラウンドで実行する
- 2026-10-29: Windows のパスが同じ場所かどうか判定するときは、区切りを / にそろえ、末尾の / を取り、ドライブ文字のあるパスは全体を小文字にして比べる（ドライブ文字だけ小文字にしても C:\Repo と c:/repo は一致しない）

## Mistakes to Avoid
（失敗と再発防止）

## Domain Knowledge
（業務・仕様・環境の知識）

- 2026-10-24: Mod の tool.call フック（tool: 'Bash'）では、next(e) の結果 r.result.gitOperation?.push?.branch で Claude の git push の成功を検知できる。commit・pr も同じ場所に入るので、stdout を解析しなくてよい
- 2026-10-28: Mod のフックは外側から prepend（管理）→ user（利用者が入れたもの）→ append（管理）→ builtin → core の5層の順に動く。管理プラグインのフックは next.to(e, tier) で下の層まで一気に進められ、あいだの層は丸ごと飛ばされる。この指定は層の単位だけで、プラグインを1つずつ選んで通すことはできない
- 2026-10-29: Claude Code の会話 jsonl で利用者が実際に打った発言は type:"user" かつ origin.kind=="human" で見分ける。デスクトップアプリでは promptSource が "sdk" になり "typed" では拾えない。ツール結果・通知・isMeta も type:"user" で混ざる
- 2026-10-29: Mod の $.fs.read / $.fs.write は 4 MiB を超えるファイルで reject する。会話 jsonl は1本 1〜2.6MB あり超えうるので、Mod で丸ごと読む設計には上限の扱いが要る
- 2026-10-29: ~/.claude/projects/ のフォルダ名は作業フォルダのパスの非 ASCII 文字を - に置き換えるので、別のリポジトリと衝突しうる。jsonl の場所はフック入力の transcript_path から取り、フォルダ名を逆算しない

## Open Questions
（未解決の疑問）

## Consolidated Principles
（統合パスで抽出した原則。常時10個以内）

- Mod で必ず届けたい処理は、prompt.compose・session.compact など、先に動く管理プラグイン（cc-plugin-sec-default）に飛ばされうるフックだけに置かず、prompt.submit の添付（context）や turn.start など別の経路でも動くようにせよ（飛ばされたかはエンジンの「hook was skipped」通知で分かる）
- claude plugin test でフックや $.fs をスタブするときは、本物と同じ形で返せ。turn.start は ({ turnId: e.turnId }) を返す（({}) だと HooksError）。$.plugin.root は実際のフォルダの絶対パスで来るので、fs.read のスタブは固定パスでなく末尾一致（endsWith('/templates/LEARNINGS.md')）で引く
