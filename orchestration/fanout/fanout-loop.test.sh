#!/usr/bin/env bash
# fanout-loop.test.sh — fanout-loop.sh 状态机自测 (退出态判定 + keep-best)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOOP="$HERE/fanout-loop.sh"

TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export FANOUT_CACHE="$TMP/cache"
cd "$TMP" || exit 1

pass=0; fail=0
ok(){ if eval "$2"; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }
# decide 第一行 token; 单独函数避免 pipefail 吃掉 exit code
tok(){ bash "$LOOP" decide 2>/dev/null | head -1; }
ec(){ bash "$LOOP" decide >/dev/null 2>&1; echo $?; }

echo "fanout-loop tests"

# 未 init → record/decide 报错
bash "$LOOP" decide >/dev/null 2>&1; ok "未 init decide → 非0" '[ "$?" -ne 0 ]'
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 1 >/dev/null 2>&1; ok "未 init record → 非0" '[ "$?" -ne 0 ]'

# init
bash "$LOOP" init --max 3 --best-sha sha0 >/dev/null
ok "init 写 meta max=3" 'grep -q "max_rounds=3" "$FANOUT_CACHE/loop/meta"'
ok "init best_n=-1 (未设)" 'grep -q "best_n=-1" "$FANOUT_CACHE/loop/meta"'
bash "$LOOP" decide >/dev/null 2>&1; ok "init 后无 round → decide 非0" '[ "$?" -ne 0 ]'

# round1 NEEDS FIX, findings=3 → CONTINUE (未到顶, 单轮无从判发散)
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 3 --sha sha1 >/dev/null
ok "round1 NEEDSFIX → CONTINUE" '[ "$(tok)" = CONTINUE ]'
ok "CONTINUE exit=10" '[ "$(ec)" -eq 10 ]'
# keep-best: 首记 → best_n=3, best_sha=sha1
ok "首记更新 best_n=3" 'grep -q "best_n=3" "$FANOUT_CACHE/loop/meta"'
ok "首记更新 best_sha=sha1" 'grep -q "best_sha=sha1" "$FANOUT_CACHE/loop/meta"'

# round2 findings=2 (下降) → keep-best 更新, 且未发散 → CONTINUE
bash "$LOOP" record 2 --gate pass --verdict NEEDSFIX --findings 2 --sha sha2 >/dev/null
ok "round2 findings 下降 → best 更新 n=2" 'grep -q "best_n=2" "$FANOUT_CACHE/loop/meta"'
ok "round2 findings 下降 → CONTINUE" '[ "$(tok)" = CONTINUE ]'

# round3 到 max=3 仍 NEEDS FIX → ESCALATE_MAX
bash "$LOOP" record 3 --gate fail --verdict NEEDSFIX --findings 2 --sha sha3 >/dev/null
ok "round3 到 max → ESCALATE_MAX" '[ "$(tok)" = ESCALATE_MAX ]'
ok "ESCALATE_MAX exit=20" '[ "$(ec)" -eq 20 ]'
# keep-best: findings 2 不小于 best 2 → 不更新 best_sha (仍 sha2)
ok "未改善 → best_sha 保持 sha2" 'grep -q "best_sha=sha2" "$FANOUT_CACHE/loop/meta"'

# 非收敛: 连续两轮 findings 未下降 (3 → 3)
bash "$LOOP" init --max 5 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 3 >/dev/null
bash "$LOOP" record 2 --gate pass --verdict NEEDSFIX --findings 3 >/dev/null
ok "findings 未下降两轮 → ESCALATE_NONCONV" '[ "$(tok)" = ESCALATE_NONCONV ]'

# 非收敛: 显式 --same-class (即便 findings 下降)
bash "$LOOP" init --max 5 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 5 >/dev/null
bash "$LOOP" record 2 --gate pass --verdict NEEDSFIX --findings 2 --same-class >/dev/null
ok "显式 same-class → ESCALATE_NONCONV" '[ "$(tok)" = ESCALATE_NONCONV ]'

# 第一次 ACCEPTED → CONFIRM (需二次确认)
bash "$LOOP" init --max 5 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 1 >/dev/null
bash "$LOOP" record 2 --gate pass --verdict ACCEPTED --findings 0 >/dev/null
ok "第一次 ACCEPTED → CONFIRM" '[ "$(tok)" = CONFIRM ]'
ok "CONFIRM exit=10" '[ "$(ec)" -eq 10 ]'

# 第二次 ACCEPTED → DONE (二次独立确认)
bash "$LOOP" record 3 --gate pass --verdict ACCEPTED --findings 0 >/dev/null
ok "第二次 ACCEPTED → DONE" '[ "$(tok)" = DONE ]'
ok "DONE exit=0" '[ "$(ec)" -eq 0 ]'

# verdict 大小写/别名归一
bash "$LOOP" init --max 3 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict "needs fix" --findings 1 >/dev/null 2>&1
ok "verdict 'needs fix' 归一为 NEEDSFIX" '[ "$(cut -f3 "$FANOUT_CACHE/loop/rounds.tsv" | tail -1)" = NEEDSFIX ]'

# 非法参数
bash "$LOOP" record 1 --gate bogus --verdict ACCEPTED --findings 0 >/dev/null 2>&1; ok "非法 gate → 非0" '[ "$?" -ne 0 ]'
bash "$LOOP" record 1 --gate pass --verdict ACCEPTED --findings -1 >/dev/null 2>&1; ok "负 findings → 非0" '[ "$?" -ne 0 ]'

# status 含轮次表头 (命令替换捕获, 避开 pipefail+grep -q 的 SIGPIPE)
ok "status 含 round 表头" 'case "$(bash "$LOOP" status)" in *round*) true;; *) false;; esac'

# ── auto-fix / ask-user finding 二分 (借鉴 no-mistakes) ──
# 本轮有碰意图 finding → ASK_USER (exit 11), 别让 Claude 自动 patch
bash "$LOOP" init --max 5 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 3 --ask-user 1 >/dev/null
ok "有 ask-user finding → ASK_USER" '[ "$(tok)" = ASK_USER ]'
ok "ASK_USER exit=11" '[ "$(ec)" -eq 11 ]'
# 全机械 (ask-user 0) → 仍 CONTINUE (向后兼容)
bash "$LOOP" init --max 5 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 3 --ask-user 0 >/dev/null
ok "ask-user=0(全机械) → CONTINUE" '[ "$(tok)" = CONTINUE ]'
# 优先级: 到顶仍 NEEDS FIX 即便有 ask-user → ESCALATE_MAX 压过 ASK_USER
bash "$LOOP" init --max 1 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 2 --ask-user 1 >/dev/null
ok "到顶 + ask-user → ESCALATE_MAX(压过 ASK_USER)" '[ "$(tok)" = ESCALATE_MAX ]'
# 优先级: 非收敛 + ask-user → ESCALATE_NONCONV 压过 ASK_USER
bash "$LOOP" init --max 5 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 3 >/dev/null
bash "$LOOP" record 2 --gate pass --verdict NEEDSFIX --findings 3 --ask-user 1 >/dev/null
ok "非收敛 + ask-user → ESCALATE_NONCONV(压过)" '[ "$(tok)" = ESCALATE_NONCONV ]'
# ACCEPTED 时 ask-user 不影响 (findings 0 ask 0)
# 校验: --ask-user > --findings → 非0
bash "$LOOP" init --max 5 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 1 --ask-user 2 >/dev/null 2>&1; ok "ask-user > findings → 非0" '[ "$?" -ne 0 ]'
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 2 --ask-user -1 >/dev/null 2>&1; ok "负 ask-user → 非0" '[ "$?" -ne 0 ]'
# status 含 ask-user 列
bash "$LOOP" init --max 3 >/dev/null; bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 2 --ask-user 1 >/dev/null
ok "status 含 ask-user 列" 'case "$(bash "$LOOP" status)" in *ask-user*) true;; *) false;; esac'

echo "fanout-loop: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
