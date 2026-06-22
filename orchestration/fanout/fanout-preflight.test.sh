#!/usr/bin/env bash
# fanout-preflight.test.sh — 测 --config-only 模式 (no-Gemini 守卫 + 配置健全, 不依赖 ccb)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
P="$HERE/fanout-preflight.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

pass=0; fail=0
ok(){ if eval "$2"; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }

echo "fanout-preflight tests"

# 干净配置 → GO
cat > "$TMP/clean.config" <<'EOF'
[agents.cc-deepseek]
url = "https://api.deepseek.com/anthropic"
model = "deepseek-v4-pro"
[agents.coder]
model = "gpt-5.5"
EOF
bash "$P" --config-only "$TMP/clean.config" >/dev/null 2>&1
ok "干净配置 → GO(exit 0)" '[ "$?" -eq 0 ]'

# model 含 gemini → no-Gemini 守卫 NO-GO
cat > "$TMP/gemini.config" <<'EOF'
[agents.cc-x]
model = "gemini-3.5-flash"
EOF
bash "$P" --config-only "$TMP/gemini.config" >/dev/null 2>&1
ok "model=gemini → NO-GO(exit 1)" '[ "$?" -ne 0 ]'

# url 含 antigravity → NO-GO
cat > "$TMP/agy.config" <<'EOF'
[agents.cc-y]
url = "https://antigravity.google/api"
model = "x"
EOF
bash "$P" --config-only "$TMP/agy.config" >/dev/null 2>&1
ok "url=antigravity → NO-GO" '[ "$?" -ne 0 ]'

# 注释里出现 gemini 不应误杀 (只看 model=/url= 值)
cat > "$TMP/comment.config" <<'EOF'
# 不要用 gemini / antigravity
[agents.cc-z]
model = "glm-5.2"
EOF
bash "$P" --config-only "$TMP/comment.config" >/dev/null 2>&1
ok "注释提到 gemini 不误杀 → GO" '[ "$?" -eq 0 ]'

# 空 model 值 → NO-GO
cat > "$TMP/empty.config" <<'EOF'
[agents.cc-w]
model = ""
EOF
bash "$P" --config-only "$TMP/empty.config" >/dev/null 2>&1
ok "空 model 值 → NO-GO" '[ "$?" -ne 0 ]'

# .ccb/ gitignore 守卫 (只依赖 git; 用临时 repo + 干净 config 隔离测)
GW="$TMP/ccbwork"; mkdir -p "$GW"
git -C "$GW" init -q 2>/dev/null
out_ign="$(CCB_WORK="$GW" bash "$P" --config-only "$TMP/clean.config" 2>&1)"
ok ".ccb/ 未 gitignore → warn 提示" 'case "$out_ign" in *"未 gitignore"*) true;; *) false;; esac'
printf '.ccb/\n' > "$GW/.gitignore"
out_ok="$(CCB_WORK="$GW" bash "$P" --config-only "$TMP/clean.config" 2>&1)"
ok ".ccb/ 已 gitignore → ok" 'case "$out_ok" in *"已 gitignore"*) true;; *) false;; esac'
CCB_WORK="$GW" bash "$P" --config-only "$TMP/clean.config" >/dev/null 2>&1
ok ".ccb gitignore 检查是 warn 级, 不阻断 GO" '[ "$?" -eq 0 ]'

echo "fanout-preflight: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
