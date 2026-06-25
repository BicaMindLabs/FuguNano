# Contributing

PRs welcome. This is a workflow repo that stitches together Chinese-model backends + multi-Agent parallel dispatch orchestration + a review loop + auto-sync.

## Dev Environment

```bash
git clone https://github.com/BicaMindLabs/fugue
cd fugue

# Tools (for running the gates locally)
brew install gitleaks        # or apt
pipx install pre-commit && pre-commit install   # scans automatically on commit
```

## Three Gates (must pass before commit)

| Gate    | Command     | What it checks                                                                 |
| ------- | ----------- | ------------------------------------------------------------------------------ |
| Secrets | `make scan` | Plaintext key fingerprints + `provider.config*`'s `key=` must be a placeholder |
| Scripts | `make lint` | Node launcher syntax + no checked-in `.sh` scripts                             |
| Tests   | `make test` | cn-plugin's node tests                                                         |
| All     | `make ci`   | The three above run in sequence (= CI equivalent)                              |

`make help` lists all targets. CI (`.github/workflows/ci.yml`) runs exactly these three, so if `make ci` is green locally, CI is basically green too.

## Hard Rules

- **Real keys never enter the repo.** See [SECURITY.md](SECURITY.md). When editing `provider.config.example`, `key=` may only use `<...>` placeholders.
- **Launcher changes**: `backends/bin/*-code` stay as thin Node heads; shared logic goes into `cc-model-launcher.mjs`, don't copy it into each head. `make lint` must pass after editing.
- **Model upgrades**: edit `provider.config.example` + `cc-model-registry.tsv`, don't just change a string in the docs. Default/flagship profile changes must justify their reasoning in the PR (fit/cost need human judgment).
- **launcher runtime**: provider model tables and per-provider quirks live in `cc-model-launcher.mjs`; keep the entrypoint files tiny and executable.
- **Don't introduce Gemini**: second opinion/review goes through Codex or a Chinese-model clone (an established workflow convention).

## Commit Conventions

- Use imperative + a type prefix: `feat:` / `fix:` / `chore:` / `docs:` / `perf:`.
- One thing per PR. For changes to `backends/` launcher logic, attach evidence that `make ci` passes.
- Add a line under the `Unreleased` section of [CHANGELOG.md](CHANGELOG.md) for user-facing changes.
