#!/usr/bin/env bash
# fuguectl-plan.test.sh — stub fugue-cc to test planning-panel dispatch
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
P="$HERE/fuguectl-plan.sh"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
export FUGUE_CACHE="$TMP/cache"
export FUGUE_ENGINE_CLI="$TMP/fugue-engine"
export FUGUE_PLAN_CALLS="$TMP/plan-calls.txt"
# shellcheck source=/dev/null
. "$HERE/fuguectl-testlib.sh"

cat > "$FUGUE_ENGINE_CLI" <<'EOF'
const cp = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

fs.appendFileSync(process.env.FUGUE_PLAN_CALLS, `${process.argv.slice(2).join(' ')}\n`);

const args = process.argv.slice(2);
const die = (message) => {
  console.error(message);
  process.exit(2);
};
const opt = (name, fallback = '') => {
  const index = args.indexOf(name);
  return index === -1 ? fallback : args[index + 1] || fallback;
};
const [root, goal] = args;
if (root !== 'plan' || !goal) die('usage: plan <goal>');
const models = opt('--models', 'cc-deepseek,cc-kimi,coder').split(',').filter(Boolean);
const out = opt('--out');
const bin = opt('--bin', 'fugue-cc');
fs.mkdirSync(out, { recursive: true });
process.stdout.write(`── planning panel: goal decomposition → ${models.join(' ')} ──\n`);
const files = [];
for (const model of models) {
  const file = path.join(out, `${model}.plan.md`);
  files.push(file);
  try {
    cp.execFileSync(bin, ['ask', model, '--compact'], {
      input: `Goal: ${goal}\nOutput: write to ${file}\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    process.stdout.write(`  → dispatched to ${model}, plan will be written to ${file}\n`);
  } catch {
    process.stdout.write(`  ✗ ${model} dispatch failed\n`);
  }
}
process.stdout.write('\ncollect: after each model finishes writing, the planner reads these plans and synthesizes the final plan:\n');
for (const file of files) process.stdout.write(`  ${file}\n`);
EOF

# stub fugue-cc: record the agent called($2), consume stdin
printf '#!/usr/bin/env bash\necho "$2" >> "%s"\ncat >/dev/null\n' "$TMP/calls" > "$TMP/fugue-cc"
chmod +x "$TMP/fugue-cc"; export FUGUE_CC_BIN="$TMP/fugue-cc"

echo "fuguectl-plan tests"

out="$(bash "$P" "build a login feature" --models cc-a,cc-b)"
ok "dispatched to 2 specified models" '[ "$(grep -c . "$TMP/calls")" -eq 2 ]'
ok "calls include cc-a and cc-b" 'grep -q cc-a "$TMP/calls" && grep -q cc-b "$TMP/calls"'
ok "output lists plan file paths" '[[ "$out" == *"cc-a.plan.md"* ]]'

: > "$TMP/calls"
bash "$P" "default models test" >/dev/null 2>&1
ok "default models = 3 families" '[ "$(grep -c . "$TMP/calls")" -eq 3 ]'

bash "$P" >/dev/null 2>&1; ok "no goal → non-0" '[ "$?" -ne 0 ]'
ok "shell delegates to engine CLI" 'grep -q "^plan build a login feature --models cc-a,cc-b --out " "$FUGUE_PLAN_CALLS"'

tdone
