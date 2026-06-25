<!-- One thing per PR. For user-facing changes, remember to add a line under Unreleased in CHANGELOG.md. -->

## What does this PR do

<!-- A sentence or two on the motivation + the change -->

## Type

- [ ] feat (new capability)
- [ ] fix (bug fix)
- [ ] chore / docs / perf
- [ ] launcher logic (`backends/`)
- [ ] model upgrade (provider config + `cc-model-registry.tsv`)

## Self-check Checklist

- [ ] `make ci` passes locally (`make ci-clean` on a fresh clone)
- [ ] **No real key entered the repo** (provider config `key=` values are all `<PLACEHOLDER>`)
- [ ] If you touched the launcher, shared logic went into `cc-model-lib.sh`, not copied into a head
- [ ] User-facing changes are recorded in the CHANGELOG
- [ ] No Gemini dependency introduced

## Notes

<!-- For default/flagship profile changes, explain the reasoning; plus anything else the reviewer should note -->
