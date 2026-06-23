# Contributing

PRs welcome. This is a workflow repo that stitches together Chinese-model backends + multi-Agent fan-out orchestration + a review loop + auto-sync.

## Dev Environment

```bash
git clone https://github.com/BicaMindLabs/open-sakanafugu
cd open-sakanafugu

# Tools (for running the gates locally)
brew install shellcheck gitleaks        # or apt
pipx install pre-commit && pre-commit install   # scans automatically on commit
```

## Three Gates (must pass before commit)

| Gate | Command | What it checks |
|---|---|---|
| Secrets | `make scan` | Plaintext key fingerprints + `ccb.config*`'s `key=` must be a placeholder |
| Scripts | `make lint` | `bash -n` syntax + shellcheck (via `.shellcheckrc`) |
| Tests | `make test` | cn-plugin's node tests |
| All | `make ci` | The three above run in sequence (= CI equivalent) |

`make help` lists all targets. CI (`.github/workflows/ci.yml`) runs exactly these three, so if `make ci` is green locally, CI is basically green too.

## Hard Rules

- **Real keys never enter the repo.** See [SECURITY.md](SECURITY.md). When editing `ccb.config.example`, `key=` may only be the `<PROVIDER_API_KEY>` placeholder.
- **Launcher changes**: `backends/bin/*-code` follow a "thin head + one line `cc_model_launch`" structure; shared logic goes into `cc-model-lib.sh`, don't copy it into each head. `make lint` must pass after editing.
- **Model upgrades**: edit `ccb.config.example` + `cc-model-registry.tsv`, don't just change a string in the docs. Default/flagship profile changes must justify their reasoning in the PR (fit/cost need human judgment).
- **shellcheck false positives**: `*-code`'s `MODELS`/`CC_OPUS` etc. are consumed by the sourced `cc_model_launch` across files, so SC2034 is already disabled in `.shellcheckrc`; don't delete variables just to silence a warning.
- **Don't introduce Gemini**: second opinion/review goes through Codex or a Chinese-model clone (an established workflow convention).

## Commit Conventions

- Use imperative + a type prefix: `feat:` / `fix:` / `chore:` / `docs:` / `perf:`.
- One thing per PR. For changes to `backends/` launcher logic, attach evidence that `make ci` passes.
- Add a line under the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for user-facing changes.
