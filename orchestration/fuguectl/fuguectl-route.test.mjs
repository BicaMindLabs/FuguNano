#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createSuite, here, makeTempDir, run } from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-route");
const fuguectl = join(here, "fuguectl");
const tmp = makeTempDir();

const gated = join(tmp, "gated.json");
writeFileSync(
  gated,
  JSON.stringify([
    { agent: "mimo", verified: false },
    { agent: "doubao", verified: true },
  ]),
);
const trust = run(fuguectl, ["route", gated]);
suite.ok("gate pass routes to TRUST", () => trust.stdout.includes('"outcome":"TRUST"'));
suite.ok("TRUST picks the verified agent", () => trust.stdout.includes('"pick":"doubao"'));
suite.ok("TRUST exits 0", () => trust.status === 0);

const unanimous = join(tmp, "unanimous.json");
writeFileSync(
  unanimous,
  JSON.stringify({
    candidates: ["a", "b", "c", "d", "e"].map((agent) => ({ agent, label: "same" })),
  }),
);
const spot = run(fuguectl, ["route", unanimous]);
suite.ok("unverified consensus is TRUST_SPOT_CHECK", () =>
  spot.stdout.includes('"outcome":"TRUST_SPOT_CHECK"'),
);
suite.ok("TRUST_SPOT_CHECK exits 10", () => spot.status === 10);

const forced = run(fuguectl, ["route", unanimous, "--category", "security"]);
suite.ok("forced category escalates despite unanimity", () =>
  forced.stdout.includes('"reason":"forced-category"'),
);
suite.ok("ESCALATE exits 20", () => forced.status === 20);

const split = join(tmp, "split.json");
writeFileSync(
  split,
  JSON.stringify([
    { agent: "a", label: "X" },
    { agent: "b", label: "Y" },
    { agent: "c", label: "Z" },
  ]),
);
const esc = run(fuguectl, ["route", split]);
suite.ok("a split fleet escalates", () => esc.stdout.includes('"reason":"split"') && esc.status === 20);

const bad = run(fuguectl, ["route", join(tmp, "missing.json")]);
suite.ok("missing input file exits 2", () => bad.status === 2);

const badThreshold = run(fuguectl, ["route", gated, "--threshold", "2"]);
suite.ok("out-of-range threshold exits 2", () => badThreshold.status === 2);

const junkThreshold = run(fuguectl, ["route", gated, "--threshold", "0.5junk"]);
suite.ok("non-numeric threshold suffix exits 2", () => junkThreshold.status === 2);

const badTypes = join(tmp, "bad-types.json");
writeFileSync(badTypes, JSON.stringify([{ agent: "a", label: 1 }]));
const typed = run(fuguectl, ["route", badTypes]);
suite.ok("non-string label is rejected, exits 2", () => typed.status === 2);

const help = run(fuguectl, ["help"]).stdout;
suite.ok("help lists route entrypoint", () => help.includes("fuguectl route"));

const auditTask = join(tmp, "TASK-route.md");
writeFileSync(auditTask, "# TASK-route: demo\nStatus: IN_PROGRESS\n");
run(fuguectl, ["route", gated, "--task", auditTask]);
suite.ok("--task appends a selector-decision line to the TASK audit", () =>
  readFileSync(auditTask, "utf8").includes('selector-decision: {"outcome":"TRUST"'),
);

const noTask = run(fuguectl, ["route", gated, "--task", join(tmp, "missing-task.md")]);
suite.ok("--task with a missing TASK file exits 2", () => noTask.status === 2);

// --round: build candidates straight from a cache fan-out round. Identical
// artifacts cluster by content hash (consensus); --gate runs an executable
// verifier per artifact (the real gate rung, live).
const cacheRoot = join(tmp, "cache");
const roundDir = join(cacheRoot, "round-7");
mkdirSync(roundDir, { recursive: true });
writeFileSync(join(roundDir, "manifest.tsv"),
  "t1\tmimo\nt2\tdoubao\nt3\tstepfun\nt4\tminimax\n");
for (const [id, status, body] of [
  ["t1", "done", "SAME OUTPUT"],
  ["t2", "done", "SAME OUTPUT"],
  ["t3", "done", "SAME OUTPUT"],
  ["t4", "fail", "broken"],
]) {
  writeFileSync(join(roundDir, `${id}.status`), `${status}\n`);
  writeFileSync(join(roundDir, `${id}.result`), body);
}

const consensus = run(fuguectl, ["route", "--round", "7", "--cache", cacheRoot]);
suite.ok("--round clusters identical artifacts into TRUST_SPOT_CHECK", () =>
  consensus.stdout.includes('"outcome":"TRUST_SPOT_CHECK"') && consensus.status === 10,
);

const gateScript = join(tmp, "gate.mjs");
writeFileSync(gateScript, [
  "import { readFileSync } from 'node:fs';",
  "const body = readFileSync(process.argv[2], 'utf8');",
  "process.exit(body.includes('GOOD') ? 0 : 1);",
].join("\n"));
writeFileSync(join(roundDir, "t2.result"), "GOOD OUTPUT");
const gated2 = run(fuguectl, [
  "route", "--round", "7", "--cache", cacheRoot,
  "--gate", process.execPath, "--gate-arg", gateScript,
]);
suite.ok("--gate runs the executable verifier and TRUSTs the passer", () =>
  gated2.stdout.includes('"outcome":"TRUST"') &&
  gated2.stdout.includes('"pick":"doubao"') &&
  gated2.status === 0,
);

const noRound = run(fuguectl, ["route", "--round", "99", "--cache", cacheRoot]);
suite.ok("--round with an uninitialized round exits 2", () => noRound.status === 2);

const badGate = run(fuguectl, [
  "route", "--round", "7", "--cache", cacheRoot,
  "--gate", join(tmp, "no-such-gate-cmd"),
]);
suite.ok("a gate command that cannot run exits 2 (operator error, not verified:false)", () =>
  badGate.status === 2,
);

const malformedDir = join(cacheRoot, "round-8");
mkdirSync(malformedDir, { recursive: true });
writeFileSync(join(malformedDir, "manifest.tsv"), "no-tab-row\nt1\tmimo\n");
writeFileSync(join(malformedDir, "t1.status"), "done\n");
writeFileSync(join(malformedDir, "t1.result"), "only real row");
const malformed = run(fuguectl, ["route", "--round", "8", "--cache", cacheRoot]);
suite.ok("no-tab manifest rows are skipped, never surfaced as picks", () =>
  malformed.stderr.includes("malformed manifest row") &&
  !malformed.stdout.includes("no-tab-row"),
);

const both = run(fuguectl, ["route", gated, "--round", "7", "--cache", cacheRoot]);
suite.ok("file and --round together exit 2", () => both.status === 2);

suite.done();
