# Case SWE — SWE-bench-lite: orchestrated vs single-model (batch)

This generalises Case A from one hand-written feature to a **batch of real
GitHub issues** with objective pass/fail: SWE-bench-lite (300 instances, each a
real merged PR with a gold patch + a `FAIL_TO_PASS` test set). The "gate" stops
being a custom `gate.sh` and becomes **"do the issue's tests now pass?"** — the
cleanest possible signal.

## What it measures

For each instance, two solvers try to produce a patch:
- **orchestrated** — FuguNano: plan → parallel file-level dispatch → integrate →
  codex review → bounded fix-loop. (Or, for a quick local demo, the live variant:
  claude writes + codex reviews + gate + loop — see `run-live-instance.sh`.)
- **single** — one writer does the whole patch in one pass, no review, no loop.

Resolved = the repo's `FAIL_TO_PASS` tests pass (and `PASS_TO_PASS` still pass)
after applying the produced patch. Reported per-instance + aggregate.

## Files

| File | Role |
|------|------|
| `fetch_dataset.sh` | download SWE-bench-lite (dev split) to `work/dataset.jsonl` |
| `prepare_instance.py` | for one instance: checkout base commit, apply test patch, capture FAIL_TO_PASS status |
| `solve-instance.sh` | run one solver (orchestrated | single) on one instance → candidate patch |
| `eval_instance.py` | apply candidate patch, run FAIL_TO_PASS + PASS_TO_PASS, emit resolved=1/0 |
| `run_batch.sh` | loop over N instances × 2 solvers, append rows to `results.csv` |
| `run_swe.sh` | ONE instance, single-shot Codex solver → gold `FAIL_TO_PASS` gate (no LLM judges; gold test protected from the solver) |
| `loop_swe.sh` | ONE instance, bounded fix loop on LEGITIMATE signals (bug-report repro + `PASS_TO_PASS` regression) — never the hidden gold test, which stays out of the tree until the final verdict |
| `README.md` | this file |

## Run

```bash
cd <FuguNano>/benchmarks/case-swebench
./fetch_dataset.sh                                   # one-time
N=20 ./run_batch.sh                                   # first 20 instances, both solvers

# minimal per-instance drivers (venv python = the instance repo's env):
./run_swe.sh  sqlfluff__sqlfluff-2419 work/repos/sqlfluff "$PWD/work/venv-sqlfluff/bin/python"
./loop_swe.sh sqlfluff__sqlfluff-1517 work/repos/sqlfluff "$PWD/work/venv-sqlfluff/bin/python" \
  'from sqlfluff.core import Linter; Linter().parse_string("select id from tbl;;")' 3
# → results.csv : instance_id, solver, resolved, wallclock_s, tokens, cost_usd
```

## Headline metric

`% resolved` per solver, with cost. Plot resolved-rate vs $ — that Pareto front
over real issues is the publishable number. (Public leaderboard reference:
frontier single agents ~20–45% on lite; the question this answers is whether
orchestration lifts a *given* model pool, and at what cost.)

## Honest scope notes

- SWE-bench evaluation is **heavy** (per-instance env build + test run, often
  Docker/conda). This harness assumes you have the repo's environment available
  locally; for full fidelity use the official `swebench` harness to build envs.
  `prepare_instance.py` / `eval_instance.py` do the lightweight, harness-free
  core (git checkout + apply patch + run the named tests) so you can see the loop
  end-to-end; swap in the official evaluator for publishable numbers.
- Dataset is licensed CC-BY-4.0 (SWE-bench); keep attribution if you redistribute.
