#!/usr/bin/env bash
# fanout-dispatch.test.sh — 用 FANOUT_CCB stub 测 dispatch (不碰真 ccb)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
D="$HERE/fanout-dispatch.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0
ok(){ if eval "$2"; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }

# stub ccb: 记录 argv + stdin 到文件
cat > "$TMP/ccb" <<EOF
#!/usr/bin/env bash
echo "ARGV: \$*" > "$TMP/called"
cat >> "$TMP/called"
EOF
chmod +x "$TMP/ccb"
export FANOUT_CCB="$TMP/ccb"
export FANOUT_ALLOCATION_LEDGER="$TMP/ledger.tsv"

echo "fanout-dispatch tests"

# 模板派活: stub 应被调用, agent + prompt 正确
bash "$D" cc-deepseek --template impl --set ROLE=后端 --set SCOPE=任务X --set FILES=a.py >/dev/null 2>&1
ok "ccb 被调用" '[ -f "$TMP/called" ]'
ok "argv 含 agent + --compact + ask" 'grep -q "ARGV: ask cc-deepseek --compact" "$TMP/called"'
ok "prompt(渲染后)经 stdin 传入" 'grep -q "你的角色：后端" "$TMP/called" && grep -q "任务X" "$TMP/called"'

# --prompt-file
echo "自定义 prompt 内容" > "$TMP/p.md"
bash "$D" cc-glm --prompt-file "$TMP/p.md" >/dev/null 2>&1
ok "prompt-file 内容经 stdin" 'grep -q "自定义 prompt 内容" "$TMP/called"'

# --task 日志
TASKF="$TMP/task.md"; printf '## 执行日志\n' > "$TASKF"
bash "$D" cc-kimi --prompt-file "$TMP/p.md" --task "$TASKF" >/dev/null 2>&1
ok "--task 追加 dispatch 日志" 'grep -q "dispatch → cc-kimi" "$TASKF"'

# --harness codex (stub codex; target=model)
printf '#!/usr/bin/env bash\necho "ARGV: $*" > "%s"\n' "$TMP/codex.called" > "$TMP/codex"
chmod +x "$TMP/codex"; export FANOUT_CODEX="$TMP/codex"
bash "$D" gpt-5.5 --harness codex --prompt-file "$TMP/p.md" >/dev/null 2>&1
ok "codex harness → codex exec --model <model>" 'grep -q "ARGV: exec --model gpt-5.5" "$TMP/codex.called"'
ok "codex harness: prompt 作 arg 传入" 'grep -q "自定义 prompt 内容" "$TMP/codex.called"'

# --harness opencode (stub opencode; target=provider/model)
printf '#!/usr/bin/env bash\necho "ARGV: $*" > "%s"\n' "$TMP/oc.called" > "$TMP/opencode"
chmod +x "$TMP/opencode"; export FANOUT_OPENCODE="$TMP/opencode"
bash "$D" doubao/doubao-code --harness opencode --prompt-file "$TMP/p.md" >/dev/null 2>&1
ok "opencode harness → opencode run -m <provider/model>" 'grep -q "ARGV: run -m doubao/doubao-code" "$TMP/oc.called"'

# --task-type 写 alloc ledger (数据飞轮捕获)
rm -f "$FANOUT_ALLOCATION_LEDGER"
bash "$D" cc-doubao --prompt-file "$TMP/p.md" --task-type code >/dev/null 2>&1
ok "--task-type 追加 (type,agent) 进 ledger" 'grep -qF "$(printf "code\tcc-doubao")" "$FANOUT_ALLOCATION_LEDGER"'
bash "$D" cc-glm --prompt-file "$TMP/p.md" >/dev/null 2>&1
ok "无 --task-type 不写 ledger (行数不增)" '[ "$(grep -c . "$FANOUT_ALLOCATION_LEDGER")" -eq 1 ]'

# 未知 harness
bash "$D" x --harness bogus --prompt-file "$TMP/p.md" >/dev/null 2>&1; ok "未知 harness → 非0" '[ "$?" -ne 0 ]'

# 错误用法
bash "$D" >/dev/null 2>&1; ok "无 agent → 非0" '[ "$?" -ne 0 ]'
bash "$D" cc-x >/dev/null 2>&1; ok "无 prompt 源 → 非0" '[ "$?" -ne 0 ]'

echo "fanout-dispatch: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
