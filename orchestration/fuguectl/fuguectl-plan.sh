#!/usr/bin/env bash
# fuguectl-plan.sh — thin shell bridge to the TypeScript planning panel command.
# multi-model planning panel: send "decompose goal" to N planning models at once, each Writes its plan,
#                  then the planner(Claude) synthesizes. This is the design panel pattern.
#   fuguectl-plan.sh "<goal>" [--models m1,m2,..] [--out <dir>]
#   default models = cc-deepseek,cc-kimi,coder   (cross-family, different perspectives)
#   default out    = <cache_root>/plans
#   env: FUGUE_CC_BIN(stub for tests) / FUGUE_CACHE / FUGUE_ENGINE_CLI
set -uo pipefail
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/fuguectl-lib.sh"

goal="${1:-}"; shift || true
case "$goal" in
  '') die "usage: \"<goal>\" [--models m1,m2,..] [--out <dir>]";;
  -h|--help) sed -n '2,8p' "$0"; exit 0;;
esac
models="cc-deepseek,cc-kimi,coder"
CACHE_ROOT="$(fx_cache_root)"
out="$CACHE_ROOT/plans"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --models) models="${2:-}"; shift 2;;
    --out) out="${2:-}"; shift 2;;
    *) die "unknown arg '$1'";;
  esac
done
fx_run_engine plan "$goal" --models "$models" --out "$out" --bin "${FUGUE_CC_BIN:-fugue-cc}"
