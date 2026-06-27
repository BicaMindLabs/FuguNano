#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  countLines,
  createSuite,
  here,
  makeTempDir,
  run,
} from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-plan");
const plan = join(here, "fuguectl-plan");
const tmp = makeTempDir();
const calls = join(tmp, "calls");

process.env.FUGUE_CACHE = join(tmp, "cache");
process.env.FUGUE_ENGINE_CLI = join(tmp, "fugue-engine");
process.env.FUGUE_PLAN_CALLS = join(tmp, "plan-calls.txt");

writeFileSync(
  process.env.FUGUE_ENGINE_CLI,
  [
    "const cp = require('node:child_process');",
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(process.env.FUGUE_PLAN_CALLS, args.join(' ') + '\\n');",
    "const die = (message) => { console.error(message); process.exit(2); };",
    "const opt = (name, fallback = '') => {",
    "  const index = args.indexOf(name);",
    "  return index === -1 ? fallback : args[index + 1] || fallback;",
    "};",
    "const root = args[0];",
    "const goal = args[1];",
    "if (root !== 'plan' || !goal) die('usage: plan <goal>');",
    "const harness = opt('--harness', 'fugue-cc');",
    "const models = opt('--models', 'cc-deepseek,cc-kimi,coder').split(',').filter(Boolean);",
    "const out = opt('--out', path.join(process.env.FUGUE_CACHE || path.join(process.cwd(), '.fuguectl-cache'), 'plans'));",
    "const bin = opt('--bin', process.env.FUGUE_CC_BIN || 'fugue-cc');",
    "fs.mkdirSync(out, { recursive: true });",
    "process.stdout.write('planning panel: goal decomposition (' + harness + ') -> ' + models.join(' ') + '\\n');",
    "const files = [];",
    "for (const model of models) {",
    "  const file = path.join(out, model + '.plan.md');",
    "  files.push(file);",
    "  try {",
    "    cp.execFileSync(bin, ['ask', model, '--compact'], {",
    "      input: 'Goal: ' + goal + '\\nOutput: write to ' + file + '\\n',",
    "      stdio: ['pipe', 'ignore', 'ignore'],",
    "    });",
    "    process.stdout.write('  -> dispatched to ' + model + ', plan will be written to ' + file + '\\n');",
    "  } catch {",
    "    process.stdout.write('  x ' + model + ' dispatch failed\\n');",
    "  }",
    "}",
    "process.stdout.write('\\ncollect: after each model finishes writing, the planner reads these plans and synthesizes the final plan:\\n');",
    "for (const file of files) process.stdout.write('  ' + file + '\\n');",
    "",
  ].join("\n"),
);

writeFileSync(
  join(tmp, "fugue-cc"),
  `#!/usr/bin/env bash\necho "$2" >> "${calls}"\ncat >/dev/null\n`,
  { mode: 0o755 },
);
process.env.FUGUE_CC_BIN = join(tmp, "fugue-cc");

const out = run(plan, [
  "build a login feature",
  "--models",
  "cc-a,cc-b",
]).stdout;
suite.ok(
  "dispatched to 2 specified models",
  () => countLines(readFileSync(calls, "utf8")) === 2,
);
suite.ok("calls include cc-a and cc-b", () => {
  const text = readFileSync(calls, "utf8");
  return text.includes("cc-a") && text.includes("cc-b");
});
suite.ok("output lists plan file paths", () => out.includes("cc-a.plan.md"));

run(plan, ["lite planning", "--harness", "codex", "--models", "gpt-5.5"]);
suite.ok("wrapper preserves harness option", () =>
  readFileSync(process.env.FUGUE_PLAN_CALLS, "utf8").includes(
    "plan lite planning --harness codex --models gpt-5.5\n",
  ),
);

run(plan, [
  "runtime controlled planning",
  "--harness",
  "codex",
  "--timeout-ms",
  "120000",
  "--harness-arg=-c",
  "--harness-arg=mcp_servers={}",
]);
suite.ok("wrapper preserves planning runtime controls", () =>
  readFileSync(process.env.FUGUE_PLAN_CALLS, "utf8").includes(
    "plan runtime controlled planning --harness codex --timeout-ms 120000 --harness-arg=-c --harness-arg=mcp_servers={}\n",
  ),
);

writeFileSync(calls, "");
run(plan, ["default models test"]);
suite.ok(
  "default models = 3 families",
  () => countLines(readFileSync(calls, "utf8")) === 3,
);

suite.ok("no goal → non-0", () => run(plan, []).status !== 0);
suite.ok("wrapper delegates to engine CLI", () =>
  readFileSync(process.env.FUGUE_PLAN_CALLS, "utf8").includes(
    "plan build a login feature --models cc-a,cc-b\n",
  ),
);

suite.done();
