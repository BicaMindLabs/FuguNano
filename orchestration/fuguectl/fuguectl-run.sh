#!/usr/bin/env bash
# fuguectl-run.sh — thin shell bridge to the TypeScript cross-phase run facade.
#
#   set --task <file> [--round N]   declare/update current run
#   round <N>                       update round only
#   status [--human]                aggregate status as JSON or human summary
#   next                            print next-action hint
#   clear                           clear current run context
#   env: FUGUE_CACHE, FUGUE_ENGINE_CLI
set -uo pipefail
# shellcheck source=/dev/null
. "$(dirname "${BASH_SOURCE[0]}")/fuguectl-lib.sh"

case "${1:-}" in
  ''|-h|--help) sed -n '2,9p' "$0";;
  *) fx_run_engine run --cache "$(fx_cache_root)" "$@";;
esac
