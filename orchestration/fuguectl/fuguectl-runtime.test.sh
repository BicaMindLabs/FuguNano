#!/usr/bin/env bash
# fuguectl-runtime.test.sh — use a stub fugue-cc to test version drift + grafting + stamp (never touches real fugue-cc)
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
S="$HERE/fuguectl-runtime.sh"
FG="$HERE/fuguectl"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
# shellcheck source=/dev/null
. "$HERE/fuguectl-testlib.sh"

# stub fugue-cc: version → fake version + Install path; others(kill) → no-op
cat > "$TMP/fugue-cc" <<EOF
#!/usr/bin/env bash
case "\$1" in
  version) echo "fugue-cc runtime v9.9.9 abc 2026-01-01"; echo "Install path: $TMP/install";;
  *) exit 0;;
esac
EOF
chmod +x "$TMP/fugue-cc"
export FUGUE_CC_BIN="$TMP/fugue-cc" FUGUE_STATE="$TMP/state" FUGUE_CC_INSTALL="$TMP/install"
unset FUGUE_CC_WORK FUGUE_CC_CLAUDE 2>/dev/null || true

mkdir -p "$TMP/install/lib/provider_profiles"
touch "$TMP/install/lib/provider_profiles/api_shortcuts.py"

echo "fuguectl-runtime tests"

out="$(bash "$S" check)"
ok "check reports version drift (none → v9.9.9)" 'echo "$out" | grep -q "version drift"'
ok "check: grafting api_shortcuts.py present" 'echo "$out" | grep -q "grafting api_shortcuts.py present"'
out_runtime="$(bash "$FG" runtime check)"
ok "runtime entrypoint suggests fuguectl runtime adapt" 'echo "$out_runtime" | grep -q "fuguectl runtime adapt --apply"'

bash "$S" adapt >/dev/null 2>&1
ok "dry-run does not write stamp" '[ ! -f "$FUGUE_STATE/runtime-version" ]'

bash "$S" adapt --apply >/dev/null 2>&1
ok "apply writes stamp=current version" 'grep -q "v9.9.9" "$FUGUE_STATE/runtime-version" 2>/dev/null'

out2="$(bash "$S" check)"
ok "after apply check shows no drift" 'echo "$out2" | grep -q "no drift"'

rm "$TMP/install/lib/provider_profiles/api_shortcuts.py"
out3="$(bash "$S" check)"
ok "missing grafting is detected" 'echo "$out3" | grep -q "api_shortcuts.py is gone"'

# adapt with FUGUE_CC_WORK + clean config → run --config-only validation (stub fugue-cc, never touches real daemon)
touch "$TMP/install/lib/provider_profiles/api_shortcuts.py"   # restore grafting
mkdir -p "$TMP/work/.fugue-cc"
printf '[agents.cc-deepseek]\nmodel = "deepseek-v4-pro"\n' > "$TMP/work/.fugue-cc/provider.config"
OUT4="$TMP/adapt-with-work.out"
FUGUE_CC_WORK="$TMP/work" bash "$S" adapt --apply >"$OUT4" 2>&1
ok "adapt with FUGUE_CC_WORK runs config validation" 'grep -q "config validation" "$OUT4"'
ok "adapt with FUGUE_CC_WORK still records stamp" 'grep -q "v9.9.9" "$FUGUE_STATE/runtime-version"'

bash "$S" nope >/dev/null 2>&1; ok "unknown subcommand → nonzero" '[ "$?" -ne 0 ]'

tdone
