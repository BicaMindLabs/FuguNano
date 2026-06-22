#!/usr/bin/env bash
# fanout-fleet.sh — 拉起/查看/停掉 ccb fleet (解决"卡队列没 worker")
#
# 核心解决两件事:
#   1. **剥 CLAUDE_CODE_***: 父会话的 OAuth/session env 会泄漏给子 cc-* → 假 401。
#      up 启动 ccb 前把所有 CLAUDE_CODE_* unset, 让分身只用自己的 provider key。
#   2. **headless tmux**: ccb 的 agent pane 要活在 tmux 里; 没 tmux server 就没 worker。
#      up 在 detached tmux 会话里起 ccb -s。
#
#   status [proj...]        各项目 ccbd 是否就绪 (preflight/派活前必看)
#   up [--dry] [proj...]    剥 CLAUDE_CODE_* + detached tmux 起 ccb -s, 起完自验
#   down [proj...]          ccb kill
#   env: CCB_WORK(默认 ~/Projects/ccb-test) / CCB_CLAUDE(默认 ~/Projects/ccb-claude-only)
#        CCB_CLAUDE_PREFIX(claude 池启动前缀, 默认 "CLAUDE_START_CMD=claude ") / FANOUT_CCB(测试 stub)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CCB="${FANOUT_CCB:-ccb}"
WORK="${CCB_WORK:-$HOME/Projects/ccb-test}"
CLAUDE_PROJ="${CCB_CLAUDE:-$HOME/Projects/ccb-claude-only}"
CLAUDE_PREFIX="${CCB_CLAUDE_PREFIX:-CLAUDE_START_CMD=claude }"
die(){ echo "fanout-fleet: $*" >&2; exit 2; }

# 该项目用什么启动前缀 (claude 池要 CLAUDE_START_CMD)
prefix_for(){ [ "$1" = "$CLAUDE_PROJ" ] && printf '%s' "$CLAUDE_PREFIX" || printf ''; }

# 构造 CLAUDE_CODE_* 的 env -u 剥离参数
strip_args(){
  local v
  for v in $(compgen -v 2>/dev/null | grep '^CLAUDE_CODE' | sort -u); do printf -- '-u %s ' "$v"; done
}

# 就绪 ⟺ mount_state: mounted (实际挂载)。ccbd 活着但 unmounted 时派活会失败 "ccbd is unmounted"。
# 不能 grep health/alive/running: 'health: unmounted' 会假命中; 且 ccb ping 即使停了也回
# 'desired_state: running'(配置意图≠实际态) → 都会假就绪、派活卡进空队列(doctoreel 坑)。
is_ready(){ (cd "$1" 2>/dev/null && "$CCB" ping ccbd 2>/dev/null | grep -qE '^mount_state:[[:space:]]*mounted'); }

cmd_status(){
  local projs=("$@"); [ "$#" -eq 0 ] && projs=("$WORK" "$CLAUDE_PROJ")
  local ready=0 p
  for p in "${projs[@]}"; do
    if [ ! -d "$p/.ccb" ]; then printf '  —  %s (无 .ccb)\n' "$p"; continue; fi
    if is_ready "$p"; then printf '  ✓ ready   %s\n' "$p"; ready=$((ready+1))
    else printf '  ✗ down    %s  → fanout fleet up\n' "$p"; fi
  done
  [ "$ready" -gt 0 ]
}

# up: 默认 detached tmux; --pty 走 pty.fork 兜底(detached tmux 不灵时); --dry 只打印
cmd_up(){
  local dry=0 pty=0; local projs=()
  while [ "$#" -gt 0 ]; do case "$1" in --dry) dry=1;; --pty) pty=1;; *) projs+=("$1");; esac; shift; done
  [ "${#projs[@]}" -eq 0 ] && projs=("$WORK" "$CLAUDE_PROJ")
  local u; u="$(strip_args)"
  local p pre
  for p in "${projs[@]}"; do
    [ -d "$p/.ccb" ] || { echo "  ✗ $p 无 .ccb, 跳过"; continue; }
    if is_ready "$p"; then echo "  ✓ 已在跑: $p"; continue; fi
    pre="$(prefix_for "$p")"
    if [ "$pty" -eq 1 ]; then
      # pty.fork: python 内部剥 CLAUDE_CODE_*; 这里只组目标命令
      local pycmd
      if [ -n "$pre" ]; then pycmd=(python3 "$HERE/fleet-launch.py" "$p" env "${pre% }" "$CCB" -s)
      else pycmd=(python3 "$HERE/fleet-launch.py" "$p" "$CCB" -s); fi
      if [ "$dry" -eq 1 ]; then echo "  [dry-pty] ${pycmd[*]}"; continue; fi
      command -v python3 >/dev/null 2>&1 || die "无 python3"
      "${pycmd[@]}" && echo "  ▸ pty.fork 启动: $p" || echo "  ✗ pty.fork 启动失败: $p"
    else
      local sess cmd; sess="ccb-$(basename "$p")"; cmd="env ${u}${pre}$CCB -s"
      if [ "$dry" -eq 1 ]; then echo "  [dry] tmux new-session -d -s $sess -c $p \"$cmd\""; continue; fi
      command -v tmux >/dev/null 2>&1 || die "无 tmux"
      tmux new-session -d -s "$sess" -c "$p" "$cmd" 2>/dev/null \
        && echo "  ▸ detached tmux '$sess' 启动: $p" || echo "  ✗ tmux 启动失败: $p"
    fi
  done
  [ "$dry" -eq 1 ] && return 0
  echo "  —— 等几秒后自验 ——"; sleep 5
  cmd_status "${projs[@]}" || {
    echo "  ⚠ 仍未就绪。"
    [ "$pty" -eq 0 ] && echo "    detached tmux 没接上 → 试 pty.fork 兜底: fanout fleet up --pty"
    echo "    或真终端手动:"
    for p in "${projs[@]}"; do [ -d "$p/.ccb" ] && echo "      cd $p && $(prefix_for "$p")$CCB -s"; done
  }
}

cmd_down(){
  local projs=("$@"); [ "$#" -eq 0 ] && projs=("$WORK" "$CLAUDE_PROJ")
  local p
  for p in "${projs[@]}"; do
    [ -d "$p/.ccb" ] || continue
    (cd "$p" && "$CCB" kill >/dev/null 2>&1) && echo "  ✓ killed: $p" || echo "  — 无运行态: $p"
  done
}

sub="${1:-}"; shift || true
case "$sub" in
  status) cmd_status "$@";;
  up)     cmd_up "$@";;
  down)   cmd_down "$@";;
  ''|-h|--help) sed -n '2,15p' "$0";;
  *) die "未知子命令 '$sub' (status|up|down)";;
esac
