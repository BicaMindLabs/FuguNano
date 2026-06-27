#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createSuite, here, makeTempDir, run } from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-doctor");
const doctor = join(here, "fuguectl-doctor");
const fuguectl = join(here, "fuguectl");
const tmp = makeTempDir();
const calls = join(tmp, "doctor-calls.txt");

process.env.FUGUE_ENGINE_CLI = join(tmp, "fugue-engine");
process.env.FUGUE_DOCTOR_CALLS = calls;

writeFileSync(
  process.env.FUGUE_ENGINE_CLI,
  [
    "const fs = require('node:fs');",
    "fs.appendFileSync(process.env.FUGUE_DOCTOR_CALLS, `${process.argv.slice(2).join(' ')}\\n`);",
    "const [root, ...args] = process.argv.slice(2);",
    "if (root !== 'doctor') {",
    "  console.error('expected doctor');",
    "  process.exit(9);",
    "}",
    "if (args.includes('--quiet')) {",
    "  process.stdout.write('agents=4 backends_ready=2/9 fugue-cc=1 codex=1 agy=0 opencode=1\\n');",
    "} else {",
    "  process.stdout.write('roles:\\n  ✓ codex\\nbackends:\\n  ✓ cc-deepseek (ready)\\n\\nrecommended:\\n  • full fleet workflow\\n');",
    "}",
    "",
  ].join("\n"),
);

const out = run(doctor, []).stdout;
suite.ok("doctor reports roles", () => out.includes("roles:\n"));
suite.ok("doctor reports recommendation", () => out.includes("recommended:"));

const quiet = run(doctor, ["--quiet"]).stdout;
suite.ok("quiet summary survives", () =>
  quiet.startsWith("agents=4 backends_ready=2/9"),
);
suite.ok("quiet summary includes opencode readiness", () => quiet.includes("opencode=1"));

const top = run(fuguectl, ["doctor", "--quiet"]).stdout;
suite.ok("top-level doctor entrypoint works", () => top.includes("fugue-cc=1"));
suite.ok("wrapper delegates to engine CLI", () =>
  readFileSync(calls, "utf8").includes("doctor --quiet\n"),
);

suite.done();
