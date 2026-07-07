# FuguNano Studio — Desktop GUI

A source-complete Electron + React + Vite desktop app that puts a face on the
FuguNano loop. It is not a separate service: it drives the same
`orchestration/fuguectl/fuguectl` binary the CLI does, so anything the GUI shows
is reproducible from a terminal.

Lives at [`benchmarks/case-d-gui/desktop`](../benchmarks/case-d-gui/desktop).

```bash
make gui-install   # one-time: install the desktop deps (npm install)
make gui           # launch FuguNano Studio (Electron, dev mode)
make gui-build     # typecheck + test + build the renderer (what CI runs)
make gui-package   # build an unsigned local .app + .dmg → desktop/release/
```

## How it talks to the engine

The renderer never runs a shell. The Electron main process
([`electron/main.cjs`](../benchmarks/case-d-gui/desktop/electron/main.cjs))
locates the repo root by walking up to `orchestration/fuguectl`, then exposes a
small, injection-safe IPC surface over `contextBridge`:

| Channel            | Backing call                          | Purpose                                        |
| ------------------ | ------------------------------------- | ---------------------------------------------- |
| `fugue:run`        | `execFile(fuguectl, argv)`            | Run a fuguectl subcommand; returns stdout/exit. |
| `fugue:agents`     | `fuguectl doctor --quiet`             | Parse agent / backend health.                  |
| `fugue:listRounds` | `fs` read of the cache root           | List `round-<n>` directories.                  |
| `fugue:round`      | `fs` read of `round-<n>/`             | Per-agent status grid for one round.           |

Arguments are tokenized and passed as an `argv` array to `execFile` — never
concatenated into a shell string. The read-only `fs` channels validate each
path segment against `^[A-Za-z0-9._-]+$` (and reject `.` / `..`), and use every
segment only wrapped (`round-<n>`, `<id>.status`), so a crafted round name
cannot traverse out of the cache root.

## The four views

### Pipeline — operator console

The plan → dispatch → integrate → review → loop workflow, driven by real
fuguectl calls. Each step gates on the previous one's exit code. The agent panel
reflects live `doctor` health (green = ready, gray = unavailable).

### Rounds — read-only monitor

Pick a `round-<n>` from the on-disk cache and see every agent's status —
`done` / `fail` / `pending` — with byte counts and a result preview. Refresh
re-reads the directory; nothing is mutated. Cache root is `FUGUE_CACHE` or
`<root>/.fuguectl-cache`.

### Selector — routing decision, visualized

This is the thematic centerpiece and mirrors
[Verifier-aware Routing](../README.md#verifier-aware-routing). Build a set of
candidates by hand (toggle a gate result ✓ / ✗, or leave gates unset and cluster
by answer label), and a live preview computes the decision **client-side using a
line-for-line mirror of the engine's `route()`**:

| Outcome            | When                                                     | Exit |
| ------------------ | -------------------------------------------------------- | ---- |
| `TRUST`            | A verifier vouched (`verified === true`) — the only clean trust. | 0 |
| `TRUST_SPOT_CHECK` | No gate, but a dominant answer cluster passed the smoothed threshold. | 10 |
| `ESCALATE`         | Gate failed, forced-category, split, or lone singleton.  | 20 |

The confidence ring shows the Laplace-smoothed posterior `(k+1)/(n+2)`, so a
unanimous 5/5 reads as 0.86, not certainty. Or point it at a real fan-out round
(`Route` runs `fuguectl route --round n [--gate cmd]`) and it renders the
engine's own `SelectorDecision` JSON.

The preview logic is vendored in
[`src/logic/selector.ts`](../benchmarks/case-d-gui/desktop/src/logic/selector.ts)
to avoid a cross-package import of the built engine.
[`selector.test.ts`](../benchmarks/case-d-gui/desktop/src/logic/selector.test.ts)
pins the mirror to the engine's `route()` semantics with golden cases across all
three outcomes and seven reasons, so an accidental edit fails CI.

### Benchmarks — the evidence

A self-contained snapshot of the megabench findings
([`src/data/benchmarks.json`](../benchmarks/case-d-gui/desktop/src/data/benchmarks.json)),
rendered as bars grouped by kind (fan-out / premium / router / weak):

- **B1 (has gate):** fan-out of 5 weak models ties the premium singletons at 100/100.
- **B4 (has gate, no LLM judge):** fan-out 14/14 matches the best premium; weak solo averages ~11/14.
- **B3 (no gate):** the disagreement router (51/60) cannot close the gap to premium — consensus fails correlated on judgment traps.
- **Skeptic playbook (held-out):** 59% → 84% (+25pp), 0 regressions, paired McNemar p ≈ 4e-7.

The numbers are a committed snapshot, not read from a machine at runtime, so the
view is reproducible anywhere the repo is checked out.

## Packaging the app

Two ways to get an **unsigned** macOS build (arm64):

**In the cloud (recommended).** The [`Package Desktop GUI`](../.github/workflows/package-gui.yml)
workflow builds on a GitHub-hosted `macos-14` runner and uploads
`FuguNano Studio.dmg` + `.zip` as a downloadable artifact — free for this public
repo, and it never runs on push/PR (the fast CI stays renderer-only). Trigger it
from the repo's **Actions → Package Desktop GUI → Run workflow**, or push a
`gui-v*` tag; download the `fugunano-studio-macos-arm64` artifact when it's done.

**Locally.** `make gui-package` builds the renderer and runs electron-builder
(fetched via `npx`, so it isn't a committed dependency) to produce the same app
under `benchmarks/case-d-gui/desktop/release/`. First `npx` run is slow while it
downloads electron-builder.

Either way the app is unsigned — first launch needs a right-click → Open (or
`xattr -dr com.apple.quarantine "FuguNano Studio.app"`) to clear Gatekeeper.

**One caveat about the packaged app.** Inside the bundle the app can't walk up to
the repo's `orchestration/fuguectl`, so the two views that shell out to fuguectl
— **Pipeline** and **Rounds** — only work when you point the app at a checkout:

```bash
FUGUNANO_ROOT=/path/to/fugue open "release/mac-arm64/FuguNano Studio.app"
```

Without `FUGUNANO_ROOT`, the app still launches and **Selector** (client-side
preview) and **Benchmarks** (committed snapshot) are fully functional offline —
only the live fuguectl-backed views are inert. The packaged output is
git-ignored; CI never packages (it stays renderer-only).

## Scope

The repo ships the source-complete app, a renderer build in CI, and local
packaging via `make gui-package`. It deliberately does **not** sign/notarize the
app or ship auto-update. CI installs with `npm ci --ignore-scripts` (skipping the
~100 MB Electron runtime binary, which typecheck / tests / Vite build never
touch) and runs `npm run typecheck && npm test && npm run build`
(`make gui-build`); packaging is a local-only step.
