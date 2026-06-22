#!/usr/bin/env bash
# check-docs.sh — 文档与代码漂移闸门 (借鉴 lavish-axi 的 `build:skill --check`, 但适配本仓双变体 SKILL.md)
#
# 不"生成"SKILL.md (私有/泛化两版故意不同), 只校验 README 的对外清单与实际代码一致:
#   1. `fanout` 驱动里的每个用户子命令, 都出现在 README.md 和 README_ZH.md 的 CLI 表里
#   2. README 宣称的"N subcommands / N 子命令"== 实际子命令数
#   3. README 宣称的"N test suites / N 套测试"== 实际 *.test.sh 文件数
#
# 拦的就是"加了 loop/integrate 但 README 还写 14 子命令 / 13 套测试"这类漂移。
# 退出码: 0 一致 / 1 漂移 (打印 findings)
set -uo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FANOUT="$ROOT/orchestration/fanout/fanout"
RM_EN="$ROOT/README.md"
RM_ZH="$ROOT/README_ZH.md"
FANOUT_DIR="$ROOT/orchestration/fanout"

fail=0
no(){ echo "  ✗ $1"; fail=1; }
ok(){ echo "  ✓ $1"; }

[ -f "$FANOUT" ] || { echo "check-docs: 找不到 $FANOUT" >&2; exit 2; }
echo "── check-docs: 文档 vs 代码 ──"

# 1) 从驱动 case 提取用户子命令 (剥别名取首个; 去掉 help / selftest / *)
mapfile -t SUBS < <(
  grep -oE '^[[:space:]]+[a-z][a-z0-9|_-]*\)' "$FANOUT" \
    | tr -d ' )' | sed 's/|.*//' \
    | grep -vxE 'help|selftest'
)
N_SUBS="${#SUBS[@]}"
[ "$N_SUBS" -ge 1 ] || { echo "check-docs: 没从驱动解析到子命令" >&2; exit 2; }

# 每个子命令必须在两份 README 都被收录 (CLI 表里写作 `fanout <sub>`)
for s in "${SUBS[@]}"; do
  miss=""
  grep -qF "fanout $s" "$RM_EN" || miss="$miss README.md"
  grep -qF "fanout $s" "$RM_ZH" || miss="$miss README_ZH.md"
  [ -z "$miss" ] && ok "子命令 '$s' 已收录" || no "子命令 '$s' 未出现在:$miss (补 CLI 表行)"
done

# 2) 子命令数声明一致
for pair in "$RM_EN:subcommands" "$RM_ZH:子命令"; do
  f="${pair%%:*}"; word="${pair#*:}"
  grep -qF "$N_SUBS $word" "$f" \
    && ok "$(basename "$f"): 子命令数声明 = $N_SUBS" \
    || no "$(basename "$f"): 未见 '$N_SUBS $word' (实际 $N_SUBS 个; 改 README 的子命令数)"
done

# 3) 测试套数声明一致
N_SUITES="$(find "$FANOUT_DIR" -maxdepth 1 -name '*.test.sh' | grep -c .)"
for pair in "$RM_EN:test suites" "$RM_ZH:套测试"; do
  f="${pair%%:*}"; word="${pair#*:}"
  grep -qF "$N_SUITES $word" "$f" \
    && ok "$(basename "$f"): 测试套数声明 = $N_SUITES" \
    || no "$(basename "$f"): 未见 '$N_SUITES $word' (实际 $N_SUITES 套; 改 README 的测试套数)"
done

echo ""
if [ "$fail" -eq 0 ]; then echo "✓ check-docs: 文档与代码一致 ($N_SUBS 子命令 · $N_SUITES 套测试)"; exit 0
else echo "✗ check-docs: 文档漂移 (上面 ✗) — 改 README 后重跑"; exit 1; fi
