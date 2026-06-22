#!/usr/bin/env bash
# fanout-allocate.test.sh — 静态 bench 向后兼容 + 自适应(bench 先验 + 实战后验)混合
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
A="$HERE/fanout-allocate.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# hermetic: 隔离真实统计文件, 让向后兼容断言测的是"冷启动" (空统计 = bench 顺序)
export FANOUT_ALLOCATION_STATS="$TMP/stats.tsv"
export FANOUT_ALLOCATION_LEDGER="$TMP/ledger.tsv"
pass=0; fail=0
ok(){ if eval "$2"; then echo "  ✓ $1"; pass=$((pass+1)); else echo "  ✗ $1"; fail=$((fail+1)); fi; }

echo "fanout-allocate tests"

# ── 向后兼容 (冷启动 == 旧静态行为) ──
ok "code → minimax 首位 (冷启动=bench)" '[ "$(bash "$A" code)" = "minimax,doubao,glm" ]'
ok "logic --top → kimi" '[ "$(bash "$A" logic --top)" = "kimi" ]'
ok "sql 含 doubao" 'bash "$A" sql | grep -q doubao'
ok "review → coder" '[ "$(bash "$A" review --top)" = "coder" ]'
ok "list 输出多行" '[ "$(bash "$A" list | grep -c .)" -ge 8 ]'
out="$(bash "$A" bogusXYZ 2>/dev/null)"; ok "未知类型回退 mimo (stdout)" '[ "$out" = "mimo" ]'
bash "$A" bogusXYZ 2>&1 1>/dev/null | grep -q "回退 fallback"; ok "未知类型 stderr 提示" '[ "$?" -eq 0 ]'
bash "$A" >/dev/null 2>&1; ok "无参 → 非0" '[ "$?" -ne 0 ]'

# ── 自适应: 实战后验改变排序 ──
bash "$A" reset >/dev/null 2>&1
# doubao 连胜 + minimax 连败 → doubao 盖过 bench 首选
for i in 1 2 3 4; do bash "$A" record code doubao ok >/dev/null; bash "$A" record code minimax fail >/dev/null; done
ok "doubao 连胜+minimax 连败 → code --top 变 doubao" '[ "$(bash "$A" code --top)" = "doubao" ]'
ok "探索下限: minimax 4连败仍在排名(没被饿死)" 'bash "$A" code | grep -q minimax'

# reset 单类型 → 回到冷启动
bash "$A" reset code >/dev/null
ok "reset code → 回到 bench 冷启动顺序" '[ "$(bash "$A" code)" = "minimax,doubao,glm" ]'

# 未列入 bench 的 agent 靠实战浮现进排名
bash "$A" reset >/dev/null
for i in 1 2 3 4 5; do bash "$A" record code claude ok >/dev/null; done
ok "未列入 bench 的 claude 靠实战进 code 排名" 'bash "$A" code | grep -q claude'

# stats 子命令: 打印每 agent score/样本
bash "$A" reset >/dev/null
bash "$A" record code doubao ok >/dev/null
out="$(bash "$A" stats code)"
ok "stats 含 score 表头" 'case "$out" in *score*) true;; *) false;; esac'
ok "stats 含 doubao 行" 'case "$out" in *doubao*) true;; *) false;; esac'

# record 结果归一 + 非法值
bash "$A" reset >/dev/null
bash "$A" record logic kimi needsfix >/dev/null
ok "record 'needsfix' 归一为 fail (f=1)" 'case "$(bash "$A" stats logic)" in *0/1*) true;; *) false;; esac'
bash "$A" record logic kimi 1 >/dev/null
ok "record '1' 归一为 ok (s=1)" 'case "$(bash "$A" stats logic)" in *1/1*) true;; *) false;; esac'
bash "$A" record code doubao bogus >/dev/null 2>&1; ok "非法 result → 非0" '[ "$?" -ne 0 ]'
bash "$A" record code >/dev/null 2>&1; ok "record 缺参 → 非0" '[ "$?" -ne 0 ]'
# 自审 finding: 不在 bench 表的 type 记录时警告(仍记录, 仅 stderr 提示孤儿)
bash "$A" record noSuchType someagent ok 2>&1 1>/dev/null | grep -q "不在 bench 表"; ok "record 未知 type → stderr 警告孤儿" '[ "$?" -eq 0 ]'
bash "$A" record codeXYZ a ok >/dev/null 2>&1; ok "record 未知 type 仍 exit 0 (非致命)" '[ "$?" -eq 0 ]'

# 冷启动确定性: 多次调用同结果 (空统计)
bash "$A" reset >/dev/null
ok "冷启动可复现 (两次同样输出)" '[ "$(bash "$A" docs)" = "$(bash "$A" docs)" ]'

# ── feed: 批量喂后验 (数据飞轮) ──
bash "$A" reset >/dev/null
# 显式 tuples (用不撞 bench 子串的名字; cc- 前缀归一掉)
bash "$A" feed code:cc-zeta:ok code:cc-zeta:ok logic:cc-omega:fail >/dev/null
ok "feed tuples: zeta s=2 (cc- 归一)" 'case "$(bash "$A" stats code)" in *"zeta"*"2/0"*) true;; *) false;; esac'
ok "feed tuples: omega f=1" 'case "$(bash "$A" stats logic)" in *"omega"*"0/1"*) true;; *) false;; esac'
ok "feed 非法 tuple → 非0" 'bash "$A" feed badtuple >/dev/null 2>&1; [ "$?" -ne 0 ]'

# 归一闭合飞轮: cc-doubao 的经验喂进 bench 的 doubao(同一 key), 排名不出现 cc-doubao
bash "$A" reset >/dev/null
bash "$A" feed code:cc-doubao:ok >/dev/null
ok "cc-doubao 归一为 bench 的 doubao (有 1/0)" 'case "$(bash "$A" stats code)" in *"doubao"*"1/0"*) true;; *) false;; esac'
ok "排名不出现未归一的 cc-doubao" '! bash "$A" code | grep -q "cc-doubao"'

# ledger 模式: dispatch 写的 ledger → feed --from-ledger
bash "$A" reset >/dev/null
printf 'code\tcc-doubao\nsql\tcc-glm\ncode\tcc-zeta\n' > "$FANOUT_ALLOCATION_LEDGER"
bash "$A" feed --from-ledger --result ok --fail cc-zeta >/dev/null
ok "ledger feed: doubao 默认 ok" 'case "$(bash "$A" stats code)" in *"doubao"*"1/0"*) true;; *) false;; esac'
ok "ledger feed: cc-zeta 被 --fail 覆盖为 fail" 'case "$(bash "$A" stats code)" in *"zeta"*"0/1"*) true;; *) false;; esac'
ok "ledger feed: sql/glm ok" 'case "$(bash "$A" stats sql)" in *"glm"*"1/0"*) true;; *) false;; esac'
ok "ledger feed 后默认清空 ledger" '[ ! -s "$FANOUT_ALLOCATION_LEDGER" ]'
# --keep 保留 ledger
printf 'code\tcc-zeta\n' > "$FANOUT_ALLOCATION_LEDGER"
bash "$A" feed --from-ledger --result ok --keep >/dev/null
ok "feed --keep 保留 ledger" '[ -s "$FANOUT_ALLOCATION_LEDGER" ]'
# --from-ledger 缺 --result → 非0
bash "$A" feed --from-ledger >/dev/null 2>&1; ok "--from-ledger 缺 --result → 非0" '[ "$?" -ne 0 ]'

# ── Thompson Sampling (--sample) —— 平台无关性质 (awk rand 序列跨平台不同, 不断言具体序) ──
bash "$A" reset >/dev/null
ok "默认(无--sample)仍均值 bench 序" '[ "$(bash "$A" code)" = "minimax,doubao,glm" ]'
o1="$(FANOUT_ALLOCATE_SEED=5 bash "$A" code --sample)"; o2="$(FANOUT_ALLOCATE_SEED=5 bash "$A" code --sample)"
ok "TS 同 seed 可复现" '[ "$o1" = "$o2" ]'
ok "TS 输出仍是合法 ranked(含 3 个 bench agent)" 'case ",$o1," in *,minimax,*) [ "$(echo "$o1" | tr "," "\n" | grep -c .)" -ge 3 ];; *) false;; esac'
# TS 会探索: 20 个 seed 的 top-1 不全相同 (greedy 会全相同 = 1 种)
distinct="$(for s in $(seq 1 20); do FANOUT_ALLOCATE_SEED=$s bash "$A" code --sample --top; done | sort -u | grep -c .)"
ok "TS 探索: 20 seed 的 top-1 ≥2 种 (非贪心锁死)" '[ "$distinct" -ge 2 ]'

# ── decay (折扣遗忘, 非平稳 bandit) ──
bash "$A" reset >/dev/null
for i in 1 2 3 4; do bash "$A" record code doubao ok >/dev/null; done   # 4/0
bash "$A" decay --gamma 0.5 >/dev/null
ok "decay ×0.5: 4/0 → 2/0" 'case "$(bash "$A" stats code)" in *"doubao"*"2/0"*) true;; *) false;; esac'
bash "$A" decay --gamma 1.5 >/dev/null 2>&1; ok "decay gamma≥1 → 非0" '[ "$?" -ne 0 ]'
bash "$A" decay --gamma 0 >/dev/null 2>&1; ok "decay gamma=0 → 非0" '[ "$?" -ne 0 ]'
# --type 只衰减一类
bash "$A" reset >/dev/null
bash "$A" record code doubao ok >/dev/null; bash "$A" record code doubao ok >/dev/null   # code 2/0
bash "$A" record sql glm ok >/dev/null;     bash "$A" record sql glm ok >/dev/null        # sql 2/0
bash "$A" decay --gamma 0.5 --type code >/dev/null
ok "decay --type code: code 2→1" 'case "$(bash "$A" stats code)" in *"doubao"*"1/0"*) true;; *) false;; esac'
ok "decay --type code: sql 不变 2/0" 'case "$(bash "$A" stats sql)" in *"glm"*"2/0"*) true;; *) false;; esac'

echo "fanout-allocate: $pass passed, $fail failed"
[ "$fail" -eq 0 ]
