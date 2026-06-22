#!/usr/bin/env bash
# fanout-run.test.sh — run 状态门面: set/round/clear + 聚合 JSON(cache+loop) + JSON 合法性
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
R="$HERE/fanout-run.sh"; CACHE="$HERE/fanout-cache.sh"; LOOP="$HERE/fanout-loop.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export FANOUT_CACHE="$TMP/cache"
cd "$TMP" || exit 1
pass=0; fail=0
ok(){ if eval "$2"; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }
js(){ bash "$R" status; }   # JSON

echo "fanout-run tests"

# 无 active run → status 非0
bash "$R" status >/dev/null 2>&1; ok "无 active run → status 非0" '[ "$?" -ne 0 ]'
# set: 无文件 → 非0
bash "$R" set --task /no/such/file >/dev/null 2>&1; ok "set 无 TASK 文件 → 非0" '[ "$?" -ne 0 ]'

# 建 TASK + set
printf '# TASK-test\nStatus: IN_PROGRESS\n' > "$TMP/TASK.md"
bash "$R" set --task "$TMP/TASK.md" --round 2 >/dev/null
ok "set 写 run.meta" '[ -f "$FANOUT_CACHE/run.meta" ]'
ok "status JSON 含 round 2" 'js | grep -q "\"round\": 2"'
ok "status JSON 含 task_status IN_PROGRESS" 'js | grep -q "IN_PROGRESS"'
ok "无 cache/loop 时 initialized=false" 'js | grep -q "\"initialized\": false"'

# JSON 必须合法 (机器面硬要求)
ok "status 输出是合法 JSON" 'js | python3 -c "import sys,json; json.load(sys.stdin)"'

# 起 cache round 2: 声明 2 任务, put 1 → pending=1, barrier open
echo r1 > "$TMP/a.md"
bash "$CACHE" init 2 t1:cc-deepseek t2:cc-glm >/dev/null
bash "$CACHE" put 2 t1 "$TMP/a.md" >/dev/null
ok "cache 反映: total=2" 'js | grep -q "\"total\": 2"'
ok "cache 反映: pending=1" 'js | grep -q "\"pending\": 1"'
ok "cache 反映: barrier open" 'js | grep -q "\"barrier\": \"open\""'
ok "next 提示等待 barrier" 'bash "$R" next | grep -q barrier'
ok "JSON 仍合法(含 cache)" 'js | python3 -c "import sys,json; json.load(sys.stdin)"'

# 收齐 → barrier passed
bash "$CACHE" fail 2 t2 "x" >/dev/null
ok "全返回 → barrier passed" 'js | grep -q "\"barrier\": \"passed\""'

# loop: init + record NEEDSFIX → decision CONTINUE 进 JSON
bash "$LOOP" init --max 3 >/dev/null
bash "$LOOP" record 1 --gate pass --verdict NEEDSFIX --findings 2 >/dev/null
ok "loop 反映: initialized true" 'js | grep -q "\"initialized\": true"'
ok "loop 反映: decision CONTINUE" 'js | grep -q "\"decision\": \"CONTINUE\""'
ok "JSON 仍合法(含 loop)" 'js | python3 -c "import sys,json; d=json.load(sys.stdin); assert d[\"loop\"][\"decision\"]==\"CONTINUE\""'

# --human 摘要
ok "--human 含 run/cache/loop/next" 'o="$(bash "$R" status --human)"; case "$o" in *run:*cache:*loop:*next:*) true;; *) false;; esac'

# round 命令更新
bash "$R" round 3 >/dev/null
ok "round 3 → JSON round 3" 'js | grep -q "\"round\": 3"'

# clear
bash "$R" clear >/dev/null
ok "clear 后无 run.meta" '[ ! -f "$FANOUT_CACHE/run.meta" ]'
bash "$R" next >/dev/null 2>&1; ok "clear 后 next 非0" '[ "$?" -ne 0 ]'

# 未知子命令
bash "$R" bogus >/dev/null 2>&1; ok "未知子命令 → 非0" '[ "$?" -ne 0 ]'

echo "fanout-run: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
