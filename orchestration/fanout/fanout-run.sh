#!/usr/bin/env bash
# fanout-run.sh — 跨阶段 run 状态门面 (axi-inspired: 结构化、机器可解析的只读视图)
#
# fanout 的 TASK / cache(barrier) / loop 状态本来分散在多处、由 operator 心里记着。
# 本工具引入一个轻量 'current run' 上下文 (.fanout-cache/run.meta 记 active TASK + round),
# 把跨阶段状态聚合成**一个 JSON 对象**输出 —— 让一次 fan-out run 可被结构化查询/恢复/驱动
# (借鉴 no-mistakes 的 axi 思路, 但不改 fanout 'operator 即编排者' 的模型, 只做只读门面)。
#
#   set --task <file> [--round N]   声明/更新当前 run (active TASK + round, round 默认 1)
#   round <N>                       只更新 round (每轮 bump)
#   status [--human]                聚合状态 → 默认 JSON (机器面); --human = 人读一行摘要
#   next                            只打印 next-action 提示 (一行)
#   clear                           清当前 run 上下文
#
# 退出码: 0 ok / 1 无 active run(status/next 时) / 2 用法错
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE_ROOT="${FANOUT_CACHE:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)/.fanout-cache}"
RUN="$CACHE_ROOT/run.meta"
CACHE_SH="$HERE/fanout-cache.sh"
LOOP_SH="$HERE/fanout-loop.sh"
LOOP_DIR="$CACHE_ROOT/loop"
die(){ echo "fanout-run: $*" >&2; exit 2; }
esc(){ printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
rget(){ sed -n "s/^$1=//p" "$RUN" 2>/dev/null | head -1; }

cmd_set(){
  local task="" round=1
  while [ "$#" -gt 0 ]; do case "$1" in
    --task)  task="${2:-}"; shift 2;;
    --round) round="${2:-}"; shift 2;;
    *) die "未知参数 '$1'";; esac
  done
  [ -n "$task" ] || die "用法: set --task <file> [--round N]"
  [ -f "$task" ] || die "无 TASK 文件: $task"
  [ "$round" -ge 1 ] 2>/dev/null || die "--round 须 ≥1"
  mkdir -p "$CACHE_ROOT"
  { printf 'task=%s\n' "$task"; printf 'round=%s\n' "$round"; } > "$RUN"
  echo "✓ active run: task=$task round=$round"
}

cmd_round(){
  local n="${1:-}"; [ -n "$n" ] && [ "$n" -ge 1 ] 2>/dev/null || die "用法: round <N≥1>"
  [ -f "$RUN" ] || die "无 active run (先 fanout run set --task ...)"
  local t; t="$(rget task)"
  { printf 'task=%s\n' "$t"; printf 'round=%s\n' "$n"; } > "$RUN"
  echo "✓ round → $n"
}

# 聚合 → 设全局: TASK_STATUS / C_* (cache) / L_* (loop) / NEXT
_gather(){
  [ -f "$RUN" ] || return 1
  TASK="$(rget task)"; ROUND="$(rget round)"; ROUND="${ROUND:-1}"
  TASK_STATUS="$(sed -n 's/^Status:[[:space:]]*//p' "$TASK" 2>/dev/null | head -1)"

  # cache(barrier) 状态 — 解析 fanout-cache status 的稳定输出
  C_INIT=false; C_TOTAL=0; C_DONE=0; C_FAIL=0; C_PEND=0; C_BARRIER=null
  local cs; cs="$(bash "$CACHE_SH" status "$ROUND" 2>/dev/null)"
  if [ -n "$cs" ]; then
    C_INIT=true
    C_TOTAL="$(printf '%s' "$cs" | sed -n 's/.*total=\([0-9]*\).*/\1/p')"
    C_DONE="$(printf '%s' "$cs"  | sed -n 's/.*done=\([0-9]*\).*/\1/p')"
    C_FAIL="$(printf '%s' "$cs"  | sed -n 's/.*fail=\([0-9]*\).*/\1/p')"
    C_PEND="$(printf '%s' "$cs"  | sed -n 's/.*pending=\([0-9]*\).*/\1/p')"
    [ "${C_PEND:-1}" -eq 0 ] 2>/dev/null && C_BARRIER='"passed"' || C_BARRIER='"open"'
  fi

  # loop 状态 — meta 直读 + decide 取决策 token
  L_INIT=false; L_MAX=null; L_ROUNDS=0; L_BEST_N=null; L_BEST_SHA=null; L_DEC=null
  if [ -f "$LOOP_DIR/meta" ]; then
    L_INIT=true
    L_MAX="$(sed -n 's/^max_rounds=//p' "$LOOP_DIR/meta" | head -1)"; L_MAX="${L_MAX:-null}"
    L_BEST_N="$(sed -n 's/^best_n=//p' "$LOOP_DIR/meta" | head -1)"; L_BEST_N="${L_BEST_N:-null}"
    local bs; bs="$(sed -n 's/^best_sha=//p' "$LOOP_DIR/meta" | head -1)"
    [ -n "$bs" ] && L_BEST_SHA="\"$(esc "$bs")\""
    [ -f "$LOOP_DIR/rounds.tsv" ] && L_ROUNDS="$(grep -c . "$LOOP_DIR/rounds.tsv" 2>/dev/null || echo 0)"
    local d; d="$(bash "$LOOP_SH" decide 2>/dev/null | head -1)"
    [ -n "$d" ] && L_DEC="\"$d\""
  fi

  # next-action 提示
  if [ "$C_INIT" = true ] && [ "${C_PEND:-0}" -gt 0 ] 2>/dev/null; then
    NEXT="cache barrier: 等待 $C_DONE+$C_FAIL/$C_TOTAL 返回 (还差 $C_PEND) — 别进 Integrate"
  elif [ "$L_DEC" != null ]; then
    NEXT="loop: ${L_DEC//\"/} — 见 fanout loop decide"
  elif [ "$C_INIT" = true ]; then
    NEXT="cache barrier passed ($C_TOTAL/$C_TOTAL) — 可 Integrate"
  else
    NEXT="run 已声明; 尚无 cache/loop 状态 — 起 round / dispatch"
  fi
}

cmd_status(){
  local human=0; [ "${1:-}" = "--human" ] && human=1
  _gather || die "无 active run (先 fanout run set --task ...)"
  if [ "$human" -eq 1 ]; then
    echo "── run: $(basename "$TASK") · round $ROUND · ${TASK_STATUS:-?} ──"
    echo "  cache:  init=$C_INIT total=$C_TOTAL done=$C_DONE fail=$C_FAIL pending=$C_PEND barrier=${C_BARRIER//\"/}"
    echo "  loop:   init=$L_INIT max=$L_MAX rounds=$L_ROUNDS best_n=$L_BEST_N decision=${L_DEC//\"/}"
    echo "  next:   $NEXT"
    return 0
  fi
  cat <<JSON
{
  "task": "$(esc "$TASK")",
  "task_status": $( [ -n "$TASK_STATUS" ] && printf '"%s"' "$(esc "$TASK_STATUS")" || printf null ),
  "round": $ROUND,
  "cache": { "initialized": $C_INIT, "total": $C_TOTAL, "done": $C_DONE, "fail": $C_FAIL, "pending": $C_PEND, "barrier": $C_BARRIER },
  "loop": { "initialized": $L_INIT, "max": $L_MAX, "rounds": $L_ROUNDS, "best_n": $L_BEST_N, "best_sha": $L_BEST_SHA, "decision": $L_DEC },
  "next": "$(esc "$NEXT")"
}
JSON
}

cmd_next(){ _gather || die "无 active run (先 fanout run set --task ...)"; echo "$NEXT"; }

cmd_clear(){ rm -f "$RUN" && echo "✓ 已清当前 run 上下文"; }

sub="${1:-}"; shift || true
case "$sub" in
  set)    cmd_set    "$@";;
  round)  cmd_round  "$@";;
  status) cmd_status "$@";;
  next)   cmd_next   "$@";;
  clear)  cmd_clear  "$@";;
  ''|-h|--help) sed -n '2,20p' "$0";;
  *) die "未知子命令 '$sub' (set|round|status|next|clear)";;
esac
