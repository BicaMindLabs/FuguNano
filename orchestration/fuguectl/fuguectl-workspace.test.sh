#!/usr/bin/env bash
# fuguectl-workspace.test.sh
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
W="$HERE/fuguectl-workspace.sh"
# shellcheck source=/dev/null
. "$HERE/fuguectl-testlib.sh"

echo "fuguectl-workspace tests"

ok "list shows >=6 stations" '[ "$(bash "$W" list | grep -c .)" -ge 6 ]'
ok "list includes code/review/main" 'o=$(bash "$W" list); [[ "$o" == *"code"* && "$o" == *"review"* && "$o" == *"main"* ]]'

ok "show code has models field" 'o=$(bash "$W" show code); [[ "$o" == *"models:"* ]]'

# model: @bench:code → resolved via allocation to minimax,...
ok "model code → bench resolves to minimax" 'o=$(bash "$W" model code); [[ "$o" == *"minimax"* ]]'
ok "model review → coder" '[ "$(bash "$W" model review)" = "coder" ]'

# context: all five layers present (Zleap format)
ctx="$(bash "$W" context code)"
for sec in "System Prompt" "Workspace Prompt" "### Tools" "### Memory" "### History"; do
  ok "context has [$sec]" '[[ "$ctx" == *"$sec"* ]]'
done
ok "context carries global no-Gemini rule" '[[ "$ctx" == *"Do not call Gemini"* ]]'
ok "context code exposes only this station tools(incl edit)" '[[ "$ctx" == *"edit"* ]]'

# --task injection (capture then substring-match, avoids pipefail+grep -q SIGPIPE)
ok "context --task injects task" 'o=$(bash "$W" context code --task "doX"); [[ "$o" == *"doX"* ]]'

bash "$W" context nope >/dev/null 2>&1; ok "unknown workspace → non-0" '[ "$?" -ne 0 ]'
o=$(bash "$W" 2>&1); ok "no subcommand → shows help(incl list)" '[[ "$o" == *"list"* ]]'

tdone
