#!/usr/bin/env bash
# fuguectl-preflight.sh — pre-run go/no-go gate for parallel dispatch (turns hard rules into code)
#
# One-shot verification before dispatch: dependency CLIs / provider mounted / provider config sound + **no-Gemini guard** / cache tools.
# Hard failure → exit 1 (NO-GO); warn only → exit 0 (GO).
#
#   usage: fuguectl-preflight.sh [provider config path]
#   env:  FUGUE_CC_WORK = provider project root (used to ping daemon + locate .fugue-cc/provider.config)
set -uo pipefail
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/fuguectl-lib.sh"

fail=0; warn=0
ok(){ echo "  ✓ $1"; }
no(){ echo "  ✗ $1"; fail=1; }
wn(){ echo "  ⚠ $1"; warn=1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FUGUE_CC="${FUGUE_CC_BIN:-fugue-cc}"
WORK_ROOT="${FUGUE_CC_WORK:-}"

# --config-only: run only the deterministic provider.config + no-Gemini checks (testable in CI/no-fugue-cc env)
# --probe:       additionally curl each provider endpoint for a liveness probe (needs network + real key; never prints key)
CONFIG_ONLY=0; PROBE=0; args=()
for a in "$@"; do case "$a" in --config-only) CONFIG_ONLY=1;; --probe) PROBE=1;; *) args+=("$a");; esac; done
set -- ${args[@]+"${args[@]}"}

# liveness-probe one agent endpoint (never prints key)
_probe_one(){
  local a="$1" u="$2" k="$3" code
  [ -n "$a" ] && [ -n "$u" ] || return 0
  case "$k" in ''|'<'*'>') wn "probe $a: no real key, skip"; return 0;; esac
  # cache the HTTP code (never the key) for a short window so repeated preflights
  # don't re-hit the network; TTL tunable via FUGUE_PROBE_TTL (0 ≈ always re-probe).
  code="$(fcache_get "probe_$a" "${FUGUE_PROBE_TTL:-20}" 2>/dev/null)"
  if [ -z "$code" ]; then
    code="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 12 "$u/v1/models" \
      -H "x-api-key: $k" -H "authorization: Bearer $k" 2>/dev/null)"
    [ -n "$code" ] && printf '%s' "$code" | fcache_put "probe_$a"
  fi
  if [ "$code" = "200" ]; then ok "probe $a: 200 alive"; else no "probe $a: HTTP ${code:-timeout} (endpoint/key error)"; fi
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

echo "── parallel dispatch preflight ──"

if [ "$CONFIG_ONLY" -eq 0 ]; then
  # 1) dependency CLIs
  command -v "$FUGUE_CC" >/dev/null 2>&1 && ok "$FUGUE_CC" || no "missing $FUGUE_CC"
  command -v git >/dev/null 2>&1 && ok "git" || no "missing git"
  command -v codex >/dev/null 2>&1 && ok "codex (reviewer)" || wn "no codex — review must fall back to a Chinese-model agent (cross-vendor, not Gemini)"
  command -v tmux  >/dev/null 2>&1 && ok "tmux" || wn "no tmux (fugue-cc panes need it)"

  # 2) cache tools
  [ -x "$HERE/fuguectl-cache.sh" ] && ok "fuguectl-cache.sh" || no "missing fuguectl-cache.sh (join barrier depends on it)"

  # 3) provider already mounted (checked only if work root given) — must be mount_state: mounted to dispatch;
  #    old grep 'health|state' would be false-matched by 'mount_state: unmounted' → fake GO → dispatch stuck in empty queue (doctoreel pitfall)
  if [ -n "$WORK_ROOT" ]; then
    if (cd "$WORK_ROOT" 2>/dev/null && "$FUGUE_CC" ping daemon 2>/dev/null | grep -qE '^mount_state:[[:space:]]*mounted'); then
      ok "provider mounted ($WORK_ROOT)"
    else no "provider not mounted/unreachable ($WORK_ROOT) — cd project && fugue-cc to mount (or fuguectl fleet up)"; fi
  else wn "FUGUE_CC_WORK unset — skip provider mount check"; fi
fi

# 4) provider config sound + no-Gemini guard
CFG="${1:-}"
[ -z "$CFG" ] && [ -n "$WORK_ROOT" ] && CFG="$WORK_ROOT/.fugue-cc/provider.config"
if [ -n "$CFG" ] && [ -f "$CFG" ]; then
  # no-Gemini: only look at model=/url= values(ignore comments), match gemini/antigravity = hard fail
  if grep -iE '^[^#]*(model|url)[[:space:]]*=.*(gemini|antigravity)' "$CFG" >/dev/null 2>&1; then
    no "provider config model/url contains gemini/antigravity — violates the no-Gemini hard rule"
  else ok "no-Gemini guard passed"; fi
  # model line existence
  nmodel="$(grep -cE '^[[:space:]]*model[[:space:]]*=' "$CFG" 2>/dev/null || echo 0)"
  [ "$nmodel" -gt 0 ] && ok "provider config: $nmodel agent(s) configured a model" || wn "provider config has no model line?"
  # empty model value check
  if grep -E '^[[:space:]]*model[[:space:]]*=[[:space:]]*"?"?[[:space:]]*$' "$CFG" >/dev/null 2>&1; then
    no "provider config has an empty model value"
  fi
  # 5) --probe: liveness-probe each provider endpoint (needs network, never prints key)
  if [ "$PROBE" -eq 1 ]; then echo "  endpoint liveness probe:"; probe_config "$CFG"; fi
else wn "provider config not located — skip config checks (pass a path or set FUGUE_CC_WORK)"; fi

# 6) .fugue-cc/ gitignore guard — worktree lives in provider-managed .fugue-cc/workspaces/ (inside main repo work tree);
#    if not ignored, the main repo's git treats the worktree as an embedded repo on integrate, polluting status. Relies on git only.
if [ -n "$WORK_ROOT" ] && git -C "$WORK_ROOT" rev-parse --git-dir >/dev/null 2>&1; then
  if git -C "$WORK_ROOT" check-ignore -q .fugue-cc/provider.config 2>/dev/null; then
    ok ".fugue-cc/ gitignored (integrate won't be polluted by worktree)"
  else
    wn ".fugue-cc/ not gitignored — on integrate the main repo git may absorb the worktree(embedded repo); fix: echo '.fugue-cc/' >> $WORK_ROOT/.gitignore"
  fi
fi

echo ""
if [ "$fail" -eq 0 ]; then echo "✓ preflight GO  (warn=$warn)"; exit 0
else echo "✗ preflight NO-GO  ($fail hard failure(s))"; exit 1; fi
