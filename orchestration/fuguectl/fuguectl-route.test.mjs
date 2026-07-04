#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
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

suite.done();
