#!/usr/bin/env bash
# fanout-preflight.sh — fan-out 运行前 go/no-go 门 (把硬规矩变成代码)
#
# 在派活前一次性验证: 依赖 CLI / ccbd 存活 / ccb.config 健全 + **no-Gemini 守卫** / 缓存工具。
# 硬失败 → exit 1 (NO-GO); 仅 warn → exit 0 (GO)。
#
#   用法: fanout-preflight.sh [ccb.config 路径]
#   env:  CCB_WORK = ccb 项目根 (用于 ping ccbd + 定位 .ccb/ccb.config)
set -uo pipefail

fail=0; warn=0
ok(){ echo "  ✓ $1"; }
no(){ echo "  ✗ $1"; fail=1; }
wn(){ echo "  ⚠ $1"; warn=1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# --config-only: 只跑确定性的 ccb.config + no-Gemini 检查 (CI/无 ccb 环境可测)
# --probe:       额外 curl 每个 provider 端点活体探测 (需网络 + 真 key; 不打印 key)
CONFIG_ONLY=0; PROBE=0; args=()
for a in "$@"; do case "$a" in --config-only) CONFIG_ONLY=1;; --probe) PROBE=1;; *) args+=("$a");; esac; done
set -- ${args[@]+"${args[@]}"}

# 活体探测一个 agent 端点 (不打印 key)
_probe_one(){
  local a="$1" u="$2" k="$3" code
  [ -n "$a" ] && [ -n "$u" ] || return 0
  case "$k" in ''|'<'*'>') wn "probe $a: 无真 key, 跳过"; return 0;; esac
  code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "$u/v1/models" \
    -H "x-api-key: $k" -H "authorization: Bearer $k" 2>/dev/null)"
  if [ "$code" = "200" ]; then ok "probe $a: 200 活"; else no "probe $a: HTTP ${code:-timeout} (端点/ key 异常)"; fi
}
probe_config(){
  local cfg="$1" agent="" url="" key="" line
  while IFS= read -r line; do
    if [[ "$line" =~ ^\[agents\.(.+)\] ]]; then
      _probe_one "$agent" "$url" "$key"
      agent="${BASH_REMATCH[1]}"; url=""; key=""
    elif [[ "$line" =~ ^[[:space:]]*url[[:space:]]*= ]]; then
      url="$(printf '%s' "$line" | sed -E 's/^[[:space:]]*url[[:space:]]*=[[:space:]]*"?([^"]*)"?.*/\1/')"
    elif [[ "$line" =~ ^[[:space:]]*key[[:space:]]*= ]]; then
      key="$(printf '%s' "$line" | sed -E 's/^[[:space:]]*key[[:space:]]*=[[:space:]]*"?([^"]*)"?.*/\1/')"
    fi
  done < "$cfg"
  _probe_one "$agent" "$url" "$key"
}

echo "── fan-out preflight ──"

if [ "$CONFIG_ONLY" -eq 0 ]; then
  # 1) 依赖 CLI
  for c in ccb git; do command -v "$c" >/dev/null 2>&1 && ok "$c" || no "缺 $c"; done
  command -v codex >/dev/null 2>&1 && ok "codex (reviewer)" || wn "无 codex — review 需用国产分身兜底(跨家, 非 Gemini)"
  command -v tmux  >/dev/null 2>&1 && ok "tmux" || wn "无 tmux (ccb panes 需要)"

  # 2) 缓存工具
  [ -x "$HERE/fanout-cache.sh" ] && ok "fanout-cache.sh" || no "缺 fanout-cache.sh (fan-in barrier 依赖)"

  # 3) ccbd 已 mounted (CCB_WORK 给了才查) — 必须 mount_state: mounted 才能派活;
  #    旧版 grep 'health|state' 会被 'mount_state: unmounted' 假命中 → 假 GO → 派活卡空队列(doctoreel 坑)
  if [ -n "${CCB_WORK:-}" ]; then
    if (cd "$CCB_WORK" 2>/dev/null && ccb ping ccbd 2>/dev/null | grep -qE '^mount_state:[[:space:]]*mounted'); then
      ok "ccbd mounted ($CCB_WORK)"
    else no "ccbd 未 mounted/不可达 ($CCB_WORK) — cd 项目 && ccb 挂载 (或 fanout fleet up)"; fi
  else wn "未设 CCB_WORK — 跳过 ccbd 检查"; fi
fi

# 4) ccb.config 健全 + no-Gemini 守卫
CFG="${1:-}"
[ -z "$CFG" ] && [ -n "${CCB_WORK:-}" ] && CFG="$CCB_WORK/.ccb/ccb.config"
if [ -n "$CFG" ] && [ -f "$CFG" ]; then
  # no-Gemini: 只看 model=/url= 的值(忽略注释), 命中 gemini/antigravity 即硬失败
  if grep -iE '^[^#]*(model|url)[[:space:]]*=.*(gemini|antigravity)' "$CFG" >/dev/null 2>&1; then
    no "ccb.config 的 model/url 含 gemini/antigravity — 违反 no-Gemini 硬规矩"
  else ok "no-Gemini 守卫通过"; fi
  # model 行存在性
  nmodel="$(grep -cE '^[[:space:]]*model[[:space:]]*=' "$CFG" 2>/dev/null || echo 0)"
  [ "$nmodel" -gt 0 ] && ok "ccb.config: $nmodel 个 agent 配了 model" || wn "ccb.config 无 model 行?"
  # 空 model 值检查
  if grep -E '^[[:space:]]*model[[:space:]]*=[[:space:]]*"?"?[[:space:]]*$' "$CFG" >/dev/null 2>&1; then
    no "ccb.config 有空 model 值"
  fi
  # 5) --probe: 活体探测每个 provider 端点 (需网络, 不打印 key)
  if [ "$PROBE" -eq 1 ]; then echo "  端点活体探测:"; probe_config "$CFG"; fi
else wn "未定位 ccb.config — 跳过配置检查 (传路径 或 设 CCB_WORK)"; fi

# 6) .ccb/ gitignore 守卫 — worktree 在 $CCB_WORK/.ccb/workspaces/ (主 repo 工作树内);
#    不忽略则 integrate 时主 repo 的 git 会把 worktree 当嵌入仓库, 污染 status。只依赖 git。
if [ -n "${CCB_WORK:-}" ] && git -C "$CCB_WORK" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$CCB_WORK" check-ignore -q .ccb/ccb.config 2>/dev/null; then
    ok ".ccb/ 已 gitignore (integrate 不会被 worktree 污染)"
  else
    wn ".ccb/ 未 gitignore — integrate 时主 repo git 可能吸入 worktree(嵌入仓库); 修: echo '.ccb/' >> $CCB_WORK/.gitignore"
  fi
fi

echo ""
if [ "$fail" -eq 0 ]; then echo "✓ preflight GO  (warn=$warn)"; exit 0
else echo "✗ preflight NO-GO  ($fail 项硬失败)"; exit 1; fi
