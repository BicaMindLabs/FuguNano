# Parity tracker — bash `fanout` → TypeScript engine

Tracks the incremental migration (see [ARCHITECTURE.md](ARCHITECTURE.md) §5). The bash `fanout` stays green at every step; a capability only cuts over once its TS slice meets or beats the bash suite's coverage. Until then the engine is opt-in (`FUGUE_ENGINE=1`).

Legend: `bash ✓` shipped in shell · `ts …` engine status (`◐ core` = ports+adapters landed & tested · `+ cli` = a `fugue` CLI command now drives that core) · **cutover** = bash retired/shimmed.

The TS CLI (`fugue`, clipanion) landed in iter13 as a thin shell over the tested engine — `fugue version`, `fugue doctor`, `fugue task new|log|done`, `fugue goal check <spec>`. Build emits `dist/cli/main.js` (shebang preserved → `npx fugue`); 4 CLI tests added (200 total). Remaining subcommands stay engine-only until wired.

| # | Capability (bash subcommand) | Primary port | bash | ts | cutover |
|---|---|---|---|---|---|
| 1 | `allocate` (+ record/feed/stats/decay) | `AllocationStrategy` | ✓ | ◐ core (iter3) | ☐ |
| 2 | `cache` (+ barrier/collect/resume) | `ResultStore` / `Barrier` | ✓ | ◐ core (iter1) | ☐ |
| 3 | `loop` (record/decide/status) | `ReviewLoop` | ✓ | ◐ core (iter2) | ☐ |
| 4 | `preflight` (+ --probe) | `QualityGate` + `Policy` (no-Gemini/gen≠review) | ✓ | ◐ core (iter4, deterministic) | ☐ |
| 5 | `goal` (template/show/check) | `GoalSpec` + acceptance gate | ✓ | ◐ core + cli `check` (iter13) | ☐ |
| 6 | `integrate` (+ --ownership) | `Integrator` + `VcsPort` + ownership | ✓ | ◐ core (iter8) | ☐ |
| 7 | `workspace` (list/show/model/context) | `Workspace` / `ContextAssembler` | ✓ | ◐ core (iter6) | ☐ |
| 8 | `experience` (add/recall/...) | `ExperienceStore` | ✓ | ◐ core (iter7) | ☐ |
| 9 | `skills` (index/match/inject) | `SkillCatalog` | ✓ | ◐ core (iter9) | ☐ |
| 10 | `dispatch` (--harness ...) | `Harness` + `Phase` | ✓ | ◐ core (iter5) | ☐ |
| 11 | `fleet` (status/up/down) | `Harness.health` + launcher | ✓ | ◐ health (iter5) | ☐ |
| 12 | `doctor` | recon + recommend | ✓ | ◐ core + cli (iter13) | ☐ |
| 13 | `plan` (multi-model panel) | planPanel (Harness fan-out) | ✓ | ◐ core (iter11) | ☐ |
| 14 | `run` (set/round/status/next) | `RunState` facade (`RunStore`) | ✓ | ◐ core (iter1) | ☐ |
| 15 | `summary` | observability over `RunState`/`ResultCache` | ✓ | ◐ core (iter10) | ☐ |
| 16 | `task` (new/log/done) | `TaskStore` audit trail | ✓ | ◐ core + cli (iter13) | ☐ |
| 17 | `template` (render) | `ContextAssembler` (template part) | ✓ | ◐ core (iter6) | ☐ |
| 18 | `ccb-sync` (check/adapt) | CcbSync (drift detect) | ✓ | ◐ core (iter11) | ☐ |
| — | `(coordinator)` — wires the ports into the pipeline | `Coordinator` + `wire.ts` | n/a (driver) | ◐ core (iter12) | ☐ |
| — | `(self-harness)` — self-improving harness loop | `SelfHarnessLoop` + `WeaknessMiner`/`HarnessProposer`/`HarnessValidator` | n/a (net-new) | ◐ core (iter14) | ☐ |

Migration order (riskiest-last): pure strategies/state first (`allocate`, `loop`, `cache`, gates), then stores (`workspace`/`experience`/`skills`), then IO-heavy adapters (`harness`/`fleet`/`dispatch`), then the `Coordinator`.

Beyond parity — **net-new capabilities** that abstract a studied reference into the engine ("our own thing", not a bash port). `(self-harness)` (iter14) realizes the Self-Harness paper ([arXiv 2606.09498](https://arxiv.org/abs/2606.09498)): with the model/evaluator/benchmark held fixed, only the harness config evolves — each round mines verifier-grounded weaknesses, proposes bounded single-surface edits, and promotes one only under the non-regression gate `Δin ≥ 0 ∧ Δho ≥ 0 ∧ max > 0`. Core landed (pure gate + 3 ports + `SelfHarnessLoop`, 14 tests); live model-backed miner/proposer + a `Coordinator`-backed validator + a `fugue self-harness` CLI are the next slice. It composes with the bandit `AllocationStrategy` (which picks *who* runs) by learning *how the harness is configured*.
