#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  countLines,
  createSuite,
  here,
  makeTempDir,
  run,
  writeExecutable,
} from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-e2e");
const fuguectl = join(here, "fuguectl");
const cache = join(here, "fuguectl-cache");
const dispatch = join(here, "fuguectl-dispatch");
const summary = join(here, "fuguectl-summary");
const allocate = join(here, "fuguectl-allocate");
const tmp = makeTempDir();

process.env.FUGUE_CACHE = join(tmp, "cache");
writeExecutable(join(tmp, "fugue-cc"), [
  "#!/usr/bin/env node",
  "process.exit(0);",
]);
process.env.FUGUE_CC_BIN = join(tmp, "fugue-cc");

const promptFile = join(tmp, "p.md");
const resultFile = join(tmp, "r.md");
writeFileSync(promptFile, "p\n");
writeFileSync(resultFile, "r\n");

const helpOut = run(fuguectl, ["help"]).stdout;
suite.ok("help lists subcommands", () => helpOut.includes("fuguectl doctor"));
suite.ok("help lists runtime entrypoint", () =>
  helpOut.includes("fuguectl runtime"),
);
suite.ok("help lists agents entrypoint", () =>
  helpOut.includes("fuguectl agents"),
);
suite.ok("help lists inline prompt dispatch", () =>
  helpOut.includes("--prompt <text>"),
);
suite.ok(
  "help does not leak script body",
  () => !helpOut.includes("set -uo pipefail"),
);
const workspaceOut = run(fuguectl, ["workspace", "list"]).stdout;
suite.ok("fuguectl dispatches commands", () => /^  code/mu.test(workspaceOut));

suite.ok(
  "allocate code → minimax",
  () => run(allocate, ["code", "--top"]).stdout.trim() === "minimax",
);

run(cache, ["init", "1", "t1:cc-minimax", "t2:cc-kimi", "t3:cc-glm"]);
suite.ok(
  "init declares 3 tasks",
  () =>
    countLines(
      readFileSync(join(process.env.FUGUE_CACHE, "round-1", "manifest.tsv"), {
        encoding: "utf8",
      }),
    ) === 3,
);

suite.ok(
  "dispatch succeeds via stub",
  () => run(dispatch, ["cc-minimax", "--prompt-file", promptFile]).status === 0,
);

run(cache, ["put", "1", "t1", resultFile]);
run(cache, ["put", "1", "t2", resultFile]);
suite.ok("barrier 2/3 blocks", () => run(cache, ["barrier", "1"]).status !== 0);

const resume = run(cache, ["resume", "1"]).stdout;
suite.ok("resume lists un-returned t3", () => /^t3/mu.test(resume));
suite.ok("resume excludes returned t1/t2", () => !/^t[12]/mu.test(resume));

run(cache, ["put", "1", "t3", resultFile]);
suite.ok("barrier 3/3 passes", () => run(cache, ["barrier", "1"]).status === 0);
suite.ok(
  "resume is now empty",
  () => run(cache, ["resume", "1"]).stdout === "",
);

const summaryOut = run(summary, ["1"]).stdout;
suite.ok("summary has elapsed", () => summaryOut.includes("elapsed"));
suite.ok("summary done=3", () => summaryOut.includes("done=3"));

suite.ok(
  "collect emits 3 results",
  () => countLines(run(cache, ["collect", "1"]).stdout) === 3,
);

suite.done();
