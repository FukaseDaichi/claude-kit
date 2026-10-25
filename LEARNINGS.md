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

## Mistakes to Avoid
（失敗と再発防止）

- 2026-10-24: claude plugin test で turn.start をスタブするときは、on('turn.start', (_, e) => ({ turnId: e.turnId })) のように { turnId } を返す。({}) を返すと HooksError でテストが落ちる

## Domain Knowledge
（業務・仕様・環境の知識）

- 2026-10-24: Mod の prompt.compose フックは、先に動く別プラグイン（例: cc-plugin-sec-default）が next を通さないと飛ばされるので、システムプロンプトへの注入だけで Claude に大事な前提を伝える設計は当てにならない
- 2026-10-24: Mod の tool.call フック（tool: 'Bash'）では、next(e) の結果 r.result.gitOperation?.push?.branch で Claude の git push の成功を検知できる。commit・pr も同じ場所に入るので、stdout を解析しなくてよい
- 2026-10-25: claude plugin test では $.plugin.root が実際のプラグインフォルダの絶対パスになるので、テストの fs.read スタブを '/plugin/templates/...' のような固定パスで引くと当たらない。末尾一致（endsWith('/templates/LEARNINGS.md')）で答えると通る

## Open Questions
（未解決の疑問）

## Consolidated Principles
（統合パスで抽出した原則。常時10個以内）
