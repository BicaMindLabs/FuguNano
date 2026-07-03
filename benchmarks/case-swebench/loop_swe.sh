#!/usr/bin/env bash
# Orchestrated loop with a LEGITIMATE, non-cheating signal: Codex solves, then the
# loop checks (a) the bug-report repro no longer crashes and (b) the repo's own
# PASS_TO_PASS sample still passes — NEVER the hidden gold FAIL_TO_PASS. The gold
# test is kept OUT of the working tree during solving (base only), so the solver
# cannot see or fit it; it is applied only for the final verdict.
#   loop_swe.sh <instance_id> <repo_dir> <venv_python> <smoke_py> [max_rounds]
# smoke_py: a python snippet that must exit 0 (no crash) on the fixed code.
set -uo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"; cd "$HERE"
INST="$1"; REPO="$2"; VP="$3"; SMOKE="$4"; MAXR="${5:-3}"
DS="$HERE/work/dataset.jsonl"; PYA="$HERE/.venv-swe/bin/python"; NPM="/Users/leo/.npm-global/bin"

BASE=$("$PYA" -c "import json;print(next(x for x in map(json.loads,open('$DS')) if x['instance_id']=='$INST')['base_commit'])")
PROB=$("$PYA" -c "import json;print(next(x for x in map(json.loads,open('$DS')) if x['instance_id']=='$INST')['problem_statement'])")
# PASS_TO_PASS sample -> a file (ids contain spaces/brackets; avoid shell arrays entirely).
P2PFILE="$HERE/work/p2p-$INST.txt"
"$PYA" -c "import json;open('$P2PFILE','w').write('\n'.join(json.loads(next(x for x in map(json.loads,open('$DS')) if x['instance_id']=='$INST')['PASS_TO_PASS'])[:15]))"

# solve phase: base only, NO gold test in tree
( cd "$REPO" && git checkout -q -- . 2>/dev/null; git clean -fdq 2>/dev/null; git checkout -q "$BASE" )

VERDICT="" ; FINDINGS=""
for r in $(seq 1 "$MAXR"); do
  if [ "$r" = 1 ]; then
    P="You are fixing a real bug in the repo at the current directory.

## Problem statement
$PROB

Edit SOURCE files only (never test/). Print DONE."
  else
    P="Your previous fix did not satisfy the checks below. Fix SOURCE only (never test/).

## Problem statement
$PROB

## Failing checks (round $((r-1)))
$FINDINGS

Print DONE."
  fi
  timeout 450 "$NPM/codex" exec --skip-git-repo-check -c 'mcp_servers={}' -s workspace-write -C "$REPO" "$P" > "$HERE/work/loop-$INST-solve$r.log" 2>&1

  # (a) repro smoke: must not crash
  SM=$( cd "$REPO" && "$VP" -c "$SMOKE" 2>&1 ); SMRC=$?
  # (b) regression: PASS_TO_PASS sample must stay green (ids read from file via pytest.main — no shell arrays)
  RG=$( cd "$REPO" && "$VP" -c "import pytest,sys;ids=[i for i in open('$P2PFILE').read().split(chr(10)) if i];sys.exit(pytest.main(['-q']+ids))" 2>&1 | tail -1 ); RGRC=${PIPESTATUS[0]}
  F=""
  [ "$SMRC" != 0 ] && F="$F- repro still crashes: $(echo "$SM" | tail -2 | tr '\n' ' ')\n"
  [ "$RGRC" != 0 ] && F="$F- PASS_TO_PASS regressions (existing tests broke): $RG\n"
  echo "round $r: smoke_rc=$SMRC regress_rc=$RGRC" >> "$HERE/work/loop-$INST-signal.log"
  if [ -z "$F" ]; then VERDICT="CLEAN@$r"; break; fi
  VERDICT="RETRY@$r"; FINDINGS=$(printf "%b" "$F")
done

# final gold gate — protect gold test (reset, apply gold test_patch, reapply non-test diff)
( cd "$REPO" && git --no-pager diff -- . ':(exclude)test' ':(exclude)tests' > "$HERE/work/cand-loop-$INST.diff" )
( cd "$REPO" && git checkout -q -- . 2>/dev/null; git clean -fdq 2>/dev/null; git checkout -q "$BASE" )
"$PYA" prepare_instance.py "$DS" "$INST" "$REPO" >/dev/null 2>&1
( cd "$REPO" && git apply --whitespace=nowarn "$HERE/work/cand-loop-$INST.diff" 2>/dev/null )
V=$( TEST_CMD="$VP -m pytest -x -q" "$PYA" eval_instance.py "$DS" "$INST" "$REPO" 2>/dev/null )
echo "$INST | loop=$VERDICT | GOLD_GATE: $V"
