# Project Learnings

<!--
記法ルール:
- 1項目1洞察。複数の学びを1行に詰めない
- 各項目の先頭に日付を必ず入れる（例: - 2026-01-01: ...）
- 上4セクションは「生の観察」の置き場。Consolidated Principles には
  統合パスで抽出した原則だけを置く。両者を混ぜない
- 最終統合: 2026-10-29
-->

## Patterns That Work
（効いたやり方・型）

- 2026-10-28: 同梱プラグインや管理設定の説明が手元の資料にないときは、claude 本体のバイナリを grep -a -o ".\{0,200\}<名前>.\{0,300\}" で検索すると説明文が取り出せる。ただし約300MBあり1回に90秒以上かかるので、バックグラウンドで実行する
- 2026-10-29: Windows のパスが同じ場所かどうか判定するときは、区切りを / にそろえ、末尾の / を取り、ドライブ文字のあるパスは全体を小文字にして比べる（ドライブ文字だけ小文字にしても C:\Repo と c:/repo は一致しない）

## Mistakes to Avoid
（失敗と再発防止）

## Domain Knowledge
（業務・仕様・環境の知識）

- 2026-10-30: macOS の zsh には timeout コマンドがない（command not found: timeout）。長いコマンドの時間制限は、timeout で包まずに Bash ツールの timeout 引数で指定する
- 2026-10-30: Claude Code 2.1.309 の型では、claude-code/testing の test の第2引数が TestBody | TestOptions なので、Parameters<Parameters<typeof test>[1]>[0] で $ の型を取ると TS2344 になる（claude plugin test 自体は通る）

## Open Questions
（未解決の疑問）

## Consolidated Principles
（統合パスで抽出した原則。常時10個以内）
