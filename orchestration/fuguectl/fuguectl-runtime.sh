#!/usr/bin/env bash
# fuguectl-runtime.sh — fugue-cc runtime provider sync
#
# Adaptations to do after a fugue-cc provider upgrade:
#   1. is the grafting dependency (api_shortcuts.py) still there —— claude+url grafting relies entirely on it
#   2. provider daemon must restart —— runtime updates do not restart a running daemon
#   3. re-run preflight (provider.config still sound under the new version + no-Gemini)
#   4. record the new version, for next comparison
#
#   check            print current/last provider version + whether drifted + grafting soundness
#   adapt [--apply]  if drifted, adapt: verify grafting → (--apply stops daemon) → preflight → record version
#                    without --apply = dry-run (report only, does not touch daemon / does not write stamp)
#   env: FUGUE_CC_BIN(default fugue-cc) / FUGUE_CC_WORK / FUGUE_CC_CLAUDE / FUGUE_STATE(default ~/.config/fugue) / FUGUE_CC_INSTALL(override install path)
set -uo pipefail
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/fuguectl-lib.sh"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLI_NAME="${FUGUE_DRIVER_NAME:-fuguectl}"
FUGUE_CC="${FUGUE_CC_BIN:-fugue-cc}"
STATE="${FUGUE_STATE:-$HOME/.config/fugue}"
STAMP="$STATE/runtime-version"
WORK_ROOT="${FUGUE_CC_WORK:-}"
CLAUDE_ROOT="${FUGUE_CC_CLAUDE:-}"

provider_ver(){ "$FUGUE_CC" version 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | head -1; }
provider_install(){
  if [ -n "${FUGUE_CC_INSTALL:-}" ]; then printf '%s' "$FUGUE_CC_INSTALL"; return; fi
  local p; p="$("$FUGUE_CC" version 2>/dev/null | sed -n 's/.*Install path:[[:space:]]*//p' | head -1)"
  [ -n "$p" ] && printf '%s' "$p" || printf '%s' "$HOME/.local/share/codex-dual"
}
grafting_ok(){ local ins; ins="$(provider_install)"; [ -n "$ins" ] && [ -f "$ins/lib/provider_profiles/api_shortcuts.py" ]; }

cmd_check(){
  local cur last; cur="$(provider_ver)"; last="$(cat "$STAMP" 2>/dev/null || echo '(none)')"
  echo "fugue-cc provider current: ${cur:-unknown}   last recorded: $last"
  [ -n "$cur" ] || { echo "  ⚠ cannot get fugue-cc provider version (fugue-cc not installed?)"; return 0; }
  if [ "$cur" != "$last" ]; then echo "  → version drift ($last → $cur): run '$CLI_NAME runtime adapt --apply' to adapt"
  else echo "  ✓ no drift"; fi
  if grafting_ok; then echo "  ✓ grafting api_shortcuts.py present ($(provider_install))"
  else echo "  ✗ grafting api_shortcuts.py is gone — claude+url grafting may break, check the new fugue-cc version manually"; fi
}

cmd_adapt(){
  local apply=0; [ "${1:-}" = "--apply" ] && apply=1
  local cur last; cur="$(provider_ver)"; last="$(cat "$STAMP" 2>/dev/null || echo '')"
  [ -n "$cur" ] || die "cannot get fugue-cc provider version"
  if [ "$apply" -eq 1 ]; then echo "── fugue-cc runtime adapt (${last:-none} → $cur) ──"; else echo "── fugue-cc runtime adapt (${last:-none} → $cur) [dry-run] ──"; fi

  # 1) grafting dependency
  if grafting_ok; then echo "  ✓ grafting api_shortcuts.py present"
  else echo "  ✗ grafting dependency lost — new fugue-cc may have changed provider_profiles, grafting scheme needs manual adaptation"; fi

  # 2) daemon restart (runtime updates do not restart a running daemon)
  local proj
  for proj in "$WORK_ROOT" "$CLAUDE_ROOT"; do
    [ -n "$proj" ] || continue
    if [ "$apply" -eq 1 ]; then
      (cd "$proj" 2>/dev/null && "$FUGUE_CC" kill >/dev/null 2>&1) && \
        echo "  ✓ stopped provider daemon @ $proj — next 'cd $proj && fugue-cc' starts it and loads new code (claude-only uses env CLAUDE_START_CMD=claude)"
    else
      echo "  [dry] need to restart provider daemon @ $proj (provider update does not auto-restart, old code keeps running)"
    fi
  done
  [ -z "${WORK_ROOT}${CLAUDE_ROOT}" ] && echo "  ⚠ FUGUE_CC_WORK/FUGUE_CC_CLAUDE unset — skip provider restart (set them and re-run)"

  # 3) config validation (--config-only: does not depend on daemon being alive, since we may have just killed it above)
  if [ "$apply" -eq 1 ] && [ -n "$WORK_ROOT" ] && [ -f "$WORK_ROOT/.fugue-cc/provider.config" ]; then
    echo "  config validation (no-Gemini + sound):"
    bash "$HERE/fuguectl-preflight.sh" --config-only "$WORK_ROOT/.fugue-cc/provider.config" 2>&1 | sed 's/^/    /' || true
  fi

  # 4) record version
  if [ "$apply" -eq 1 ]; then mkdir -p "$STATE"; printf '%s\n' "$cur" > "$STAMP"; echo "  ✓ recorded $cur → $STAMP"
  else echo "  [dry] stamp not written; add --apply to commit"; fi
}

sub="${1:-}"; shift || true
case "$sub" in
  check) cmd_check "$@";;
  adapt) cmd_adapt "$@";;
  ''|-h|--help) sed -n '2,14p' "$0";;
  *) die "unknown subcommand '$sub' (check|adapt)";;
esac
