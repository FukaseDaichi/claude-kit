---
name: mod-development
description: claude-kit の Mod（plugins/<name>/hooks の function hooks）を書く・直す・テストするときに使う。帯（AbovePrompt）の描き方の決まり、管理プラグインに飛ばされるフックへの備え、テストのスタブ、型チェックの方法など。
---

# Mod を書く

## 帯（`AbovePrompt`）

- 帯を描く Mod は `await next(e)` で下の Mod の行を受け取り、自分の行の下に積む（帯は全 Mod で1本なので、返すだけだとほかの Mod の帯を消す）。git-band の `ui.render` が見本
- 帯の行は全 Mod で同じ形にする: 左にアイコン・太字の名前・薄い詳細（`·` 区切り、0 の項目は出さない）、右端にボタン。ボタンは `variant="secondary"`、いちばん勧める操作だけ `primary`。キーの印（`hotkey`）や操作方法の説明文は付けない

## 管理プラグインに飛ばされるフック

- 必ず届けたい処理は、`prompt.compose`・`session.compact` など、先に動く管理プラグイン（`cc-plugin-sec-default`）に飛ばされうるフックだけに置かない。`prompt.submit` の添付や `turn.start` など、別の経路でも動くようにする。飛ばされたかは、エンジンの「hook was skipped」通知で分かる
- システムプロンプトに文を足せない環境では、`prompt.submit` で `next({ ...e, context: [...(e.context ?? []), 本文] })` を使う。モデルだけが読み、利用者には表示されない添付として渡せる（発言の `text` は書き換えなくてよい）
- フックは外側から次の5層の順に動く:
  1. prepend（管理）
  2. user（利用者が入れたもの）
  3. append（管理）
  4. builtin
  5. core

  管理プラグインのフックは `next.to(e, tier)` で下の層まで一気に進められ、あいだの層は丸ごと飛ばされる。この指定は層の単位だけで、プラグインを1つずつ選んで通すことはできない

## 使えるフックの値

- `tool.call` フック（`tool: 'Bash'`）では、`next(e)` の結果の `r.result.gitOperation?.push?.branch` で Claude の git push の成功が分かる。commit・pr も同じ場所に入るので、stdout を解析しなくてよい

## テスト（`claude plugin test`）

- フックや `$.fs` をスタブするときは、本物と同じ形で返す
  - `turn.start` は `({ turnId: e.turnId })` を返す（`({})` だと HooksError になる）
  - `$.plugin.root` は実際のフォルダの絶対パスで来る。そのため `fs.read` のスタブは固定パスでなく、末尾一致（`endsWith('/templates/LEARNINGS.md')`）で引く

## 型チェック

tsc がなくても、ロード前の Mod の型チェックはできる。

1. scratchpad に tsconfig を置き、`include` に次を入れる
   - plugin-authoring スキルの `claude-code.d.ts`
   - `plugins/<name>/hooks`・`types`・`tests`
2. `npx -y -p typescript@5.6.3 tsc -p <その tsconfig>` を実行する
