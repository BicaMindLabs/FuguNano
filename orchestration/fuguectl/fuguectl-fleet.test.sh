#!/usr/bin/env bash
# fuguectl-fleet.test.sh — test up --dry(command/strip) + status(stub) + down; never really starts the fleet
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
F="$HERE/fuguectl-fleet.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/work/.fugue-cc" "$TMP/claude/.fugue-cc"
export FUGUE_CC_WORK="$TMP/work" FUGUE_CC_CLAUDE="$TMP/claude"
export CLAUDE_CODE_TEST_X=1   # simulate OAuth env that would leak to child cc-*
# shellcheck source=/dev/null
. "$HERE/fuguectl-testlib.sh"

# not-ready stub (ping no output)
notready(){ printf '#!/usr/bin/env bash\nexit 0\n' > "$TMP/fugue-cc"; chmod +x "$TMP/fugue-cc"; }
# ready stub (ping daemon → mount_state: mounted)
ready(){ printf '#!/usr/bin/env bash\ncase "$1 $2" in "ping daemon") printf "mount_state: mounted\\nhealth: alive\\n";; esac\nexit 0\n' > "$TMP/fugue-cc"; chmod +x "$TMP/fugue-cc"; }
# unmounted stub (daemon alive but not mounted → dispatch fails; old grep would falsely report ready, regression test)
unmounted(){ printf '#!/usr/bin/env bash\ncase "$1 $2" in "ping daemon") printf "mount_state: unmounted\\nhealth: unmounted\\n";; esac\nexit 0\n' > "$TMP/fugue-cc"; chmod +x "$TMP/fugue-cc"; }
export FUGUE_CC_BIN="$TMP/fugue-cc"

echo "fuguectl-fleet tests"

notready
out="$(bash "$F" up --dry)"
work_line="$(printf '%s\n' "$out" | sed -n '/\/work /p' | head -1)"
claude_line="$(printf '%s\n' "$out" | sed -n '/\/claude /p' | head -1)"
ok "up --dry strips CLAUDE_CODE_*(incl TEST_X)" '[[ "$out" == *"-u CLAUDE_CODE_TEST_X"* ]]'
ok "up --dry includes fugue-cc -s start" '[[ "$out" == *"fugue-cc -s"* ]]'
ok "up --dry covers both projects" '[[ "$out" == *"work"* && "$out" == *"claude"* ]]'
ok "claude pool carries CLAUDE_START_CMD prefix" '[[ "$claude_line" == *"CLAUDE_START_CMD=claude"* ]]'
ok "work pool has no claude prefix" '[[ "$work_line" != *"CLAUDE_START_CMD"* ]]'

# pty.fork fallback dry
outp="$(bash "$F" up --pty --dry)"
ok "up --pty --dry uses fleet-launch.py" '[[ "$outp" == *"fleet-launch.py"* ]]'
ok "up --pty --dry includes fugue-cc -s" '[[ "$outp" == *"fugue-cc -s"* ]]'

# fleet-launch.py real mechanism(harmless command): strip CLAUDE_CODE_* + run inside project + detach
if command -v python3 >/dev/null 2>&1; then
  # pty.fork-dependent checks: skip (not fail) when the host is out of pty devices — environmental, not a code defect.
  if python3 -c $'import pty,os,sys\ntry:\n p,_=pty.fork()\nexcept OSError:\n sys.exit(1)\nif p==0: os._exit(0)\nos.waitpid(p,0)' 2>/dev/null; then
    rm -f "$TMP/work/launch.out"
    python3 "$HERE/fleet-launch.py" "$TMP/work" sh -c 'env > launch.out'
    sleep 1
    ok "fleet-launch runs inside project(cwd proof)" '[ -f "$TMP/work/launch.out" ]'
    ok "fleet-launch strips CLAUDE_CODE_*" '[ -f "$TMP/work/launch.out" ] && ! grep -q CLAUDE_CODE_TEST_X "$TMP/work/launch.out"'
    # status-pipe contract: caller sees exit 0 once the worker actually launched
    python3 "$HERE/fleet-launch.py" "$TMP/work" sh -c true; ok "fleet-launch returns 0 on successful launch" '[ "$?" -eq 0 ]'
  else
    skip "fleet-launch runs inside project(cwd proof)" "out of ptys"
    skip "fleet-launch strips CLAUDE_CODE_*" "out of ptys"
    skip "fleet-launch returns 0 on successful launch" "out of ptys"
  fi
  python3 "$HERE/fleet-launch.py" >/dev/null 2>&1; ok "fleet-launch no args → nonzero" '[ "$?" -ne 0 ]'
fi

ok "status(not-ready) reports down" 'o=$(bash "$F" status 2>&1); grep -q down <<<"$o"'

ready
ok "status(ready stub=mounted) reports ready" 'o=$(bash "$F" status 2>&1); grep -q ready <<<"$o"'

# regression: daemon alive but unmounted must report down(not falsely ready), else dispatch stuck in empty queue
unmounted
ok "status(unmounted: alive but not mounted) reports down not ready" 'o=$(bash "$F" status 2>&1); grep -q down <<<"$o" && ! grep -q "✓ ready" <<<"$o"'
# regression: fugue-cc ping returns desired_state: running even when stopped(config intent ≠ actual mount), not ready
printf '#!/usr/bin/env bash\necho "desired_state: running"\n' > "$TMP/fugue-cc"; chmod +x "$TMP/fugue-cc"
ok "status(desired_state:running config intent ≠ mount) reports down" 'o=$(bash "$F" status 2>&1); grep -q down <<<"$o"'

bash "$F" down >/dev/null 2>&1; ok "down does not error" '[ "$?" -eq 0 ]'
bash "$F" bogus >/dev/null 2>&1; ok "unknown subcommand → nonzero" '[ "$?" -ne 0 ]'

tdone
