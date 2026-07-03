# AGENTS.md — FuguNano

Cross-harness entry for any coding agent (**Claude Code / Codex / OpenCode / Antigravity** all read this file). This repo is a multi-agent coding workflow driven by a stable `fuguectl` operator surface and a typed engine registry, so the same loop runs no matter which agent or runtime you are using.

## One entry point

```
orchestration/fuguectl/fuguectl help
```

Unified driver (29 subcommands): `doctor` · `init` · `version` · `fleet` · `preflight` · `smoke` · `task` · `guard` · `review` · `incident` · `template` · `dispatch` · `cache` · `integrate` · `allocate` · `route` · `skills` · `workspace` · `agents` · `experience` · `evolve` · `plan` · `goal` · `loop` · `run` · `summary` · `self-harness` · `runtime` · `selftest`. The production driver remains shell-callable from any harness; new orchestration primitives move into the strict TypeScript engine first, then get thin CLI wrappers.

## The workflow (5 phases)

Plan → Dispatch → Integrate → Review → **bounded Review-Fix Loop**. Full spec: [`orchestration/fuguectl/SKILL.md`](orchestration/fuguectl/SKILL.md) · [`docs/WORKFLOW.md`](docs/WORKFLOW.md). Higher-level entry modes: `goal` (declarative target + gate), `plan` (multi-model planning panel), `workspace` (per-task context isolation).

## Multi-harness dispatch

The implementer backend is selected by `--harness`:

```
fuguectl dispatch <target> --harness fugue-cc|codex|opencode|agy [--timeout-ms n] [--codex-clean] [--harness-arg x] [--out <file>] [--require-output] [--verbose] [--workspace ws [--experience-source manual|task] [--experience-source-ref ref] [--experience-limit n] [--experience-budget-chars n] [--experience-trust trusted|all] [--experience-max-age-days n]] [--template impl --set ... | --prompt-file f | --prompt text]
```

| harness              | runs                                                  | `<target>` is                                |
| -------------------- | ----------------------------------------------------- | -------------------------------------------- |
| `fugue-cc` (default) | provider-backed Claude Code runtime profiles (`cc-*`) | a fugue-cc agent (e.g. `cc-deepseek`)        |
| `codex`              | `codex exec`                                          | a Codex model (e.g. `gpt-5.5`)               |
| `opencode`           | `opencode run`                                        | `provider/model` (e.g. `doubao/doubao-code`) |
| `agy`                | `agy --prompt`                                        | `default` for current settings, or a model   |

Reviewer (`coder`) and planner are likewise harness-agnostic. For Antigravity,
`target=default` omits `--model`; any other target is passed as
`--model <target>`.

## Hard rules (apply to every harness)

- **`main` is the single source of truth** — implementers work in worktree sandboxes; only reviewed changes are cherry-picked back.
- **Generation ≠ review** — implementers and the reviewer must be different model families.
- **Bounded loop** — deterministic gate first, keep-best, meta-reflect on non-convergence; capped then escalate. Never loops forever, never hard-marks DONE.
- **Join barrier** — dispatch N ⇒ N must return before the next round.
- **Keys only in `~/.config/cc-model-secrets.env`** — never in the repo (CI + pre-commit scan blocks leaks).
- **Review stays independent** — review / second opinions go to Codex or another configured reviewer that is not the same generation path. `agy`/Antigravity is supported as an implementer runtime; legacy `gemini` CLI is retired.

## Before dispatching

```
fuguectl preflight --harness codex                         # selected runtime path
fuguectl preflight --harness opencode --target opencode/deepseek-v4-flash-free
fuguectl preflight --harness agy
fuguectl preflight --harness lite                          # all lite runtimes: codex + opencode + agy
fuguectl smoke --harness all --codex-clean --timeout-ms 120000 --task TASK.md --out-dir /tmp/fugunano-smoke  # also writes summary.json
fuguectl preflight --harness fugue-cc                      # full worktree fleet path
fuguectl plan "<goal>" --harness fugue-cc|codex|opencode|agy|lite [--models a,b] [--out <dir>] [--timeout-ms n] [--allow-partial] [--codex-clean] [--harness-arg x] [--codex-arg x] [--opencode-arg x] [--agy-arg x] --task TASK.md
fuguectl fleet status     # is the backend fleet up? (if down → fuguectl fleet up)
```

Never dispatch when preflight is NO-GO.

## Dev

`make ci` (secret scan + launcher lint + tests). See [`CONTRIBUTING.md`](CONTRIBUTING.md) · [`SECURITY.md`](SECURITY.md).
