#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createSuite, here, makeTempDir, run } from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-agents");
const agents = join(here, "fuguectl-agents");
const fuguectl = join(here, "fuguectl");
const tmp = makeTempDir();
const calls = join(tmp, "calls");

process.env.FUGUE_ENGINE_CLI = join(tmp, "fugue-engine");
process.env.FUGUE_AGENT_CALLS = calls;

writeFileSync(
  process.env.FUGUE_ENGINE_CLI,
  [
    "const fs = require('node:fs');",
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(process.env.FUGUE_AGENT_CALLS, args.join(' ') + '\\n');",
    "const root = args[0];",
    "const cmd = args[1];",
    "const file = cmd === 'resolve' && args.length === 3 ? undefined : args[2];",
    "const id = cmd === 'resolve' && args.length === 3 ? args[2] : args[3];",
    "if (root !== 'agent-registry') {",
    "  console.error('expected agent-registry');",
    "  process.exit(9);",
    "}",
    "if (cmd === 'template') {",
    '  process.stdout.write(\'{\\n  "agents": [\\n    {"id": "cc-deepseek", "harness": "fugue-cc"},\\n    {"id": "coder", "harness": "codex", "target": "gpt-5.5"},\\n    {"id": "opencode-kimi", "harness": "opencode"}\\n  ]\\n}\\n\');',
    "} else if (cmd === 'validate') {",
    "  if (!file || !fs.existsSync(file)) {",
    "    console.error('no agent registry at ' + (file || ''));",
    "    process.exit(1);",
    "  }",
    "  const text = fs.readFileSync(file, 'utf8');",
    '  if (/"id":"coder".*"id":"coder"/.test(text)) {',
    "    console.error('registry has duplicate agent \"coder\"');",
    "    process.exit(1);",
    "  }",
    "  if (text.includes('\"claude-code\"')) {",
    "    console.error('agents[0].harness must be one of fugue-cc, codex, opencode, agy');",
    "    process.exit(1);",
    "  }",
    "  process.stdout.write('OK agent registry valid: 3 agents\\n');",
    "} else if (cmd === 'list') {",
    "  process.stdout.write('coder\\tcodex\\tgpt-5.5\\t*\\n');",
    "} else if (cmd === 'resolve') {",
    "  if (id !== 'coder') {",
    "    console.error('agent \"' + (id || '') + '\" not found');",
    "    process.exit(1);",
    "  }",
    "  process.stdout.write('id\\tcoder\\nharness\\tcodex\\ntarget\\tgpt-5.5\\n');",
    "} else {",
    "  console.error('bad command ' + (cmd || ''));",
    "  process.exit(1);",
    "}",
    "",
  ].join("\n"),
);

const registry = join(tmp, "agents.json");
writeFileSync(registry, run(agents, ["template"]).stdout);
suite.ok("template writes agents array", () =>
  readFileSync(registry, "utf8").includes('"agents"'),
);
suite.ok("template includes codex reviewer profile", () => {
  const text = readFileSync(registry, "utf8");
  return text.includes('"harness": "codex"') && text.includes('"id": "coder"');
});

const validateOut = run(agents, ["validate", registry]).stdout;
suite.ok("validate accepts template", () =>
  validateOut.includes("OK agent registry valid: 3 agents"),
);

const list = run(agents, ["list", registry]).stdout;
suite.ok("list includes coder target", () =>
  list.includes("coder\tcodex\tgpt-5.5"),
);
const defaultList = run(agents, ["list"]).stdout;
suite.ok("list without file uses starter registry", () =>
  defaultList.includes("coder\tcodex\tgpt-5.5"),
);

const resolved = run(agents, ["resolve", registry, "coder"]).stdout;
suite.ok("resolve prints harness", () => resolved.includes("harness\tcodex"));
suite.ok("resolve prints target", () => resolved.includes("target\tgpt-5.5"));
const defaultResolved = run(agents, ["resolve", "coder"]).stdout;
suite.ok("resolve without file uses starter registry", () =>
  defaultResolved.includes("harness\tcodex"),
);

const top = run(fuguectl, ["agents", "template"]).stdout;
suite.ok("top-level agents entrypoint works", () => top.includes('"opencode"'));

const dupe = join(tmp, "dupe.json");
writeFileSync(
  dupe,
  '{"agents":[{"id":"coder","harness":"codex"},{"id":"coder","harness":"opencode"}]}\n',
);
suite.ok(
  "duplicate id rejected",
  () => run(agents, ["validate", dupe]).status !== 0,
);

const badHarness = join(tmp, "bad-harness.json");
writeFileSync(
  badHarness,
  '{"agents":[{"id":"bad","harness":"claude-code"}]}\n',
);
suite.ok(
  "invalid harness rejected",
  () => run(agents, ["validate", badHarness]).status !== 0,
);

suite.ok(
  "unknown agent rejected",
  () => run(agents, ["resolve", registry, "missing-agent"]).status !== 0,
);
suite.ok(
  "unknown subcommand rejected",
  () => run(agents, ["nope"]).status !== 0,
);
suite.ok("wrapper delegates to engine CLI", () =>
  /^agent-registry resolve .* coder$/mu.test(readFileSync(calls, "utf8")),
);

suite.done();
