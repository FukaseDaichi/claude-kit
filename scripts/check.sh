#!/usr/bin/env bash
# マーケットプレイスと全プラグインをまとめて確認する。
#   1. plugins/ のフォルダ・marketplace.json・README の一覧表が食い違っていないか
#   2. claude plugin validate（マーケットプレイスと各プラグイン）
#   3. tests/ があるプラグインは claude plugin test
# 使い方: scripts/check.sh            全部
#         scripts/check.sh git-band   指定したプラグインだけ（1 はいつも全体を見る）

set -uo pipefail

cd "$(dirname "$0")/.."

failed=0
fail() {
  echo "✘ $*" >&2
  failed=1
}

# 1. 登録の食い違い
dirs=$(find plugins -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | sort)
registered=$(jq -r '.plugins[].source' .claude-plugin/marketplace.json | sed 's|^\./plugins/||' | sort)
names=$(jq -r '.plugins[].name' .claude-plugin/marketplace.json | sort)

for d in $dirs; do
  grep -qx "$d" <<<"$registered" || fail "plugins/$d が marketplace.json に登録されていない"
  [ -f "plugins/$d/.claude-plugin/plugin.json" ] || fail "plugins/$d/.claude-plugin/plugin.json がない"
  [ -f "plugins/$d/README.md" ] || fail "plugins/$d/README.md がない"
  grep -q "](plugins/$d/)" README.md || fail "plugins/$d が README の一覧表にない"
done
for r in $registered; do
  grep -qx "$r" <<<"$dirs" || fail "marketplace.json の ./plugins/$r が存在しない"
done
for n in $names; do
  [ -f "plugins/$n/.claude-plugin/plugin.json" ] || continue
  actual=$(jq -r '.name' "plugins/$n/.claude-plugin/plugin.json")
  [ "$actual" = "$n" ] || fail "marketplace.json の name \"$n\" と plugin.json の name \"$actual\" が違う"
done

# 2-3. validate / test
targets=${*:-$dirs}

claude plugin validate . >/dev/null || fail "marketplace.json の validate に失敗"

for t in $targets; do
  echo "== $t"
  claude plugin validate "plugins/$t" >/dev/null || fail "$t: validate に失敗（claude plugin validate plugins/$t で詳細）"
  if [ -d "plugins/$t/tests" ]; then
    claude plugin test "plugins/$t" >/dev/null 2>&1 || fail "$t: テストに失敗（claude plugin test plugins/$t で詳細）"
  fi
done

if [ "$failed" -eq 0 ]; then
  echo "✔ すべて OK"
fi
exit "$failed"
