#!/usr/bin/env bash
# Minimal real-SWE-bench driver: Codex solver, gold FAIL_TO_PASS as the executable gate.
# I (Claude) never judge. Gold test is protected: after Codex, we reset and re-prepare
# (base + gold test_patch) then reapply only Codex's NON-test changes, so the gate is pristine.
#   run_swe.sh <instance_id> <repo_dir> <venv_python>
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
INST="$1"; REPO="$2"; VP="$3"
DS="$HERE/work/dataset.jsonl"
PYA="$HERE/.venv-swe/bin/python"   # has pyarrow, reads dataset

BASE=$("$PYA" -c "import json;print(next(x for x in map(json.loads,open('$DS')) if x['instance_id']=='$INST')['base_commit'])")
PROB=$("$PYA" -c "import json;print(next(x for x in map(json.loads,open('$DS')) if x['instance_id']=='$INST')['problem_statement'])")

# 1. clean + prepare (base commit + gold test_patch)
( cd "$REPO" && git checkout -q -- . 2>/dev/null; git clean -fdq 2>/dev/null; git checkout -q "$BASE" )
"$PYA" prepare_instance.py "$DS" "$INST" "$REPO" >/dev/null 2>&1 || { echo "$INST PREPARE_FAIL"; exit 1; }

# 2. baseline sanity: F2P must FAIL before the fix
F2P=$("$PYA" -c "import json;print(json.loads(next(x for x in map(json.loads,open('$DS')) if x['instance_id']=='$INST')['FAIL_TO_PASS'])[0])")
( cd "$REPO" && TEST_CMD="$VP -m pytest -x -q" $VP -m pytest -x -q "$F2P" >/dev/null 2>&1 ) && { echo "$INST BASE_ALREADY_PASSES(skip)"; exit 2; }

# 3. Codex solves — edit source only, never tests
PROMPT="You are fixing a real bug in the repository at the current directory.

## Problem statement
$PROB

Edit the actual SOURCE files to fix the issue. Do NOT modify anything under test/ or tests/. When done, print DONE."
timeout 450 codex exec --skip-git-repo-check -c 'mcp_servers={}' -s workspace-write -C "$REPO" "$PROMPT" > "$HERE/work/codex-$INST.log" 2>&1
CX=$?

# 4. protect gold test: capture Codex's non-test diff, reset, re-prepare, reapply
( cd "$REPO" && git --no-pager diff -- . ':(exclude)test' ':(exclude)tests' > "$HERE/work/cand-$INST.diff" )
CHANGED=$( cd "$REPO" && git --no-pager diff --name-only )
( cd "$REPO" && git checkout -q -- . 2>/dev/null; git clean -fdq 2>/dev/null; git checkout -q "$BASE" )
"$PYA" prepare_instance.py "$DS" "$INST" "$REPO" >/dev/null 2>&1
( cd "$REPO" && git apply --whitespace=nowarn "$HERE/work/cand-$INST.diff" 2>/dev/null )

# 5. eval by the gold executable gate
V=$( cd "$HERE" && TEST_CMD="$VP -m pytest -x -q" "$PYA" eval_instance.py "$DS" "$INST" "$REPO" 2>/dev/null )
echo "$INST | codex_exit=$CX | changed=[$(echo $CHANGED|tr '\n' ' ')] | $V"
