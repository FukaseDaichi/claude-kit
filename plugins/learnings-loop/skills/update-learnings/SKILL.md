---
name: update-learnings
description: セッション終盤、または学びの更新を求められたときに、再利用価値のある新しい洞察を LEARNINGS.md へ追記する（learnings-loop 同梱。通常は Mod が自動で行うので、手動で頼まれたときだけ使う）。
---

# LEARNINGS.md の更新（手動）

通常の学びの記録は learnings-loop の Mod が自動で行う。このスキルは、ユーザーが明示的に
「学びを更新して」「この学びを直して追記して」と頼んだときだけ使う。

## 手順

1. 判定基準を読む: `${CLAUDE_PLUGIN_ROOT}/criteria/CRITERIA.md`
2. このセッションの作業を振り返り、基準に当てはまる新しい学びを洗い出す
3. リポジトリのルート（なければ作業ディレクトリから上へたどる）の `LEARNINGS.md` を開く。
   見出し5つ（Patterns That Work / Mistakes to Avoid / Domain Knowledge / Open Questions /
   Consolidated Principles）が揃っていなければ、何も書かずにその旨を報告する
4. 既存項目と重複しない、今後も再利用できる洞察だけを該当セクションへ
   `- YYYY-MM-DD: 洞察` の形式で追記する。1項目1洞察。セクションの最後の `- ` 項目の直後に足す
5. `Consolidated Principles` は統合専用のため変更しない
6. 新しい学びがなければファイルを変更せず「学びなし」と報告する

日付は実行環境のシステムコマンド（`date +%F`）で取得し、推測しない。

## 追記後

生の観察の件数を数える（冒頭コメントの記法ルール行や Consolidated Principles を数えないこと）:

```bash
awk '/^## Patterns That Work/{on=1} /^## Consolidated Principles/{on=0} on && /^- /{c++} END{print c+0}' LEARNINGS.md
```

80件に達していたら、`learnings-loop:consolidate-learnings` の実行をユーザーに提案する（勝手に始めない）。
