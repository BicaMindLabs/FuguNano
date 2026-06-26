# Task: provider profile "read docs → learn → rebuild" model sync

You are the model-maintenance agent for the provider-backed CC profile fleet. Goal: go read each LLM vendor's **official latest docs/releases**, learn its current model lineup and access methods, then **rebuild** the shared `~/bin/cc-model-launcher.mjs` runtime + `~/bin/cc-model-registry.tsv` so they stay current.

## Hard rules (must follow)

- **Gemini disabled**: do not use gemini at any step (skip the cc-gemini row — do not research it, do not change it).
- **Back up before changing**: first `mkdir -p ~/bin/.cc-launchers-bak.$(date +%Y%m%d-%H%M%S)` and `cp ~/bin/*-code ~/bin/cc-model-registry.tsv` into it.
- **Verification gate**: for any model/endpoint change you intend to write, first `curl`-validate it live against that provider's Anthropic endpoint (only HTTP 200 counts). **Do not write anything that fails verification.**
- **How to get keys**: `zsh -lic "printf %s \"\$XXX_API_KEY\""` (keys live in interactive login shell files: ~/.config/cc-model-secrets.env / .zshrc etc., with the secrets file taking highest priority). Never print keys in plaintext.
- **Test outside the CC session**: validate with curl directly; do not rely on `cc-* -p` (in-session OAuth leakage causes a false 401).

## What to do for each provider

For every provider in `~/bin/cc-model-registry.tsv` except cc-gemini/cc-grok/cc-local:

1. **Read the official docs**: use WebFetch/WebSearch to read the URL in that row's `primary_source` column + search "<provider> latest coding models 2026 / Claude Code integration". Extract:
   - all **currently available coding/text model** IDs (exclude pure TTS/ASR/image/video/embedding)
   - which one is the **flagship / recommended coding model**
   - the correct **Anthropic-compatible base_url** (did the endpoint change)
   - **retired/deprecated** models
   - changes to officially recommended key parameters (max_output, thinking toggle, special header, etc.)

2. **Live check**: curl each candidate model individually at `<base_url>/v1/messages` (Anthropic protocol) and verify 200.

3. **Rebuild** (only write what passed verification):
   - The provider model list in `~/bin/cc-model-launcher.mjs`: add new ones, remove the ones that actually return 404/are retired.
   - If the endpoint changed: update that provider's base URL in `cc-model-launcher.mjs` + registry.
   - You may directly change the **model list, endpoint, and clearly dead entries** (already backed up + verified).

4. **Propose only, do not auto-change** (write into the report, wait for a human call):
   - Upgrades to the **default profile / Opus·Sonnet·Haiku tier mapping** — whether a new flagship should be the default and which tier it goes in needs human judgment on fit/cost. Give a recommendation + reasons.

## Structure

- After changing each provider, run `node --check ~/bin/cc-model-launcher.mjs` and `node --check ~/bin/<provider>-code` to confirm syntax.
- After all changes, run `cc-sync cli` (keep the version current).

## Report (write to stdout, goes into ~/Library/Logs/cc-model-research.log)

Per provider, list: the latest model lineup found / live-test results / changes already auto-applied / **recommended default-profile upgrades for a human to decide** (with reasons) / skip reason. End with a one-line summary: which providers have substantive updates, which await a human decision.

Stay conservative: for anything you are unsure of, cannot read the docs for, or that fails verification, **leave it as-is and report it** — do not change blindly.
