#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSuite,
  here,
  makeTempDir,
  run,
  runGit,
} from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-integrate");
const integrate = join(here, "fuguectl-integrate");
const tmp = makeTempDir();
const work = join(tmp, "work");
const workspace = (agent) => join(work, ".fugue-cc", "workspaces", agent);
const git = (args, options = {}) => runGit(["-C", work, ...args], options);
const gitText = (args) => git(args).stdout.trim();
const mkwt = (agent) =>
  git(["worktree", "add", "-q", "-b", `br-${agent}`, workspace(agent), "main"]);

mkdirSync(work, { recursive: true });
git(["init", "-q"]);
writeFileSync(join(work, "shared.txt"), "base\n");
writeFileSync(join(work, ".gitignore"), ".fugue-cc/\n");
git(["add", "-A"]);
git(["commit", "-qm", "init"]);
git(["branch", "-M", "main"]);

for (const agent of [
  "cc-deepseek",
  "cc-glm",
  "cc-idle",
  "cc-conflict",
  "cc-conflict2",
  "cc-late",
]) {
  mkwt(agent);
}

writeFileSync(join(workspace("cc-deepseek"), "a.py"), "print('a')\n");
writeFileSync(join(workspace("cc-glm"), "b.py"), "print('b')\n");
writeFileSync(join(workspace("cc-deepseek"), "shared.txt"), "DEEPSEEK-wins\n");
writeFileSync(join(workspace("cc-conflict"), "shared.txt"), "CONFLICT-wins\n");
writeFileSync(join(workspace("cc-conflict2"), "shared.txt"), "OTHER-wins\n");
writeFileSync(join(workspace("cc-late"), "late.py"), "print('late')\n");

const head0 = gitText(["rev-parse", "HEAD"]);
const dry = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-deepseek cc-glm",
  "--dry",
]).stdout;
suite.ok("dry outputs would-pick", () => dry.includes("would-pick"));
suite.ok(
  "dry produces no new commit",
  () => gitText(["rev-parse", "HEAD"]) === head0,
);

const clean = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-deepseek cc-glm cc-idle",
]);
suite.ok("no conflict → exit 0", () => clean.status === 0);
suite.ok("a.py reached main", () => existsSync(join(work, "a.py")));
suite.ok("b.py reached main", () => existsSync(join(work, "b.py")));
suite.ok("deepseek's shared.txt reached main", () =>
  readFileSync(join(work, "shared.txt"), "utf8").includes("DEEPSEEK-wins"),
);
suite.ok("idle no change → no-change", () =>
  clean.stdout.includes("no-change cc-idle"),
);
suite.ok("report has 2 picked", () => clean.stdout.includes("2 picked"));

const mainBefore = gitText(["rev-parse", "HEAD"]);
const conflict = run(integrate, ["--work", work, "--agents", "cc-conflict"]);
suite.ok("has conflict → exit 1", () => conflict.status === 1);
suite.ok("conflict report marks conflict", () =>
  conflict.stdout.includes("conflict  cc-conflict"),
);
suite.ok(
  "conflict abort → main stays clean (HEAD unchanged)",
  () => gitText(["rev-parse", "HEAD"]) === mainBefore,
);
suite.ok(
  "conflict abort → no leftover merge state",
  () => git(["status", "--porcelain"]).stdout.trim() === "",
);

const mixed = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-conflict2 cc-late",
]);
suite.ok("conflict present but late still integrated (late.py to main)", () =>
  existsSync(join(work, "late.py")),
);
suite.ok(
  "mixed result report 1 picked | ... | 1 conflict",
  () =>
    mixed.stdout.includes("1 picked") && mixed.stdout.includes("1 conflict"),
);

const missing = run(integrate, ["--work", work, "--agents", "cc-ghost"]);
suite.ok("nonexistent worktree → missing", () =>
  missing.stdout.includes("missing   cc-ghost"),
);

const taskFile = join(tmp, "task.md");
writeFileSync(taskFile, "# task\n");
mkwt("cc-tasklog");
writeFileSync(join(workspace("cc-tasklog"), "t.txt"), "x\n");
run(integrate, ["--work", work, "--agents", "cc-tasklog", "--task", taskFile]);
suite.ok("integrate summary written to TASK file", () =>
  readFileSync(taskFile, "utf8").includes("### Integrate"),
);

mkwt("cc-owner");
writeFileSync(join(workspace("cc-owner"), "owned1.py"), "1\n");
mkwt("cc-stray");
writeFileSync(join(workspace("cc-stray"), "owned2.py"), "1\n");
writeFileSync(join(workspace("cc-stray"), "sneaky.py"), "1\n");
mkwt("cc-forbid");
writeFileSync(join(workspace("cc-forbid"), "secret.env"), "k\n");
mkwt("cc-nested-forbid");
mkdirSync(join(workspace("cc-nested-forbid"), "src", "nested"), {
  recursive: true,
});
writeFileSync(
  join(workspace("cc-nested-forbid"), "src", "nested", "secret.env"),
  "k\n",
);
const ownership = join(tmp, "ownership.tsv");
writeFileSync(
  ownership,
  [
    "cc-owner\towned1.py\t",
    "cc-stray\towned2.py\t",
    "cc-forbid\t*\t*.env",
    "cc-nested-forbid\tsrc/*\t*.env",
    "",
  ].join("\n"),
);

const owner = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-owner",
  "--ownership",
  ownership,
]);
suite.ok(
  "ownership: compliant agent integrates normally",
  () => owner.status === 0 && existsSync(join(work, "owned1.py")),
);

const stray = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-stray",
  "--ownership",
  ownership,
]);
suite.ok(
  "ownership: out-of-bounds agent → exit non-0",
  () => stray.status !== 0,
);
suite.ok(
  "ownership: report marks violation + out-of-bounds file",
  () =>
    stray.stdout.includes("violation cc-stray") &&
    stray.stdout.includes("sneaky.py"),
);
suite.ok(
  "ownership: out-of-bounds → sneaky.py did not reach main",
  () => !existsSync(join(work, "sneaky.py")),
);
suite.ok(
  "ownership: out-of-bounds → owned2.py also not integrated (whole batch held back)",
  () => !existsSync(join(work, "owned2.py")),
);

const forbid = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-forbid",
  "--ownership",
  ownership,
]);
suite.ok(
  "ownership: forbidden glob(*.env) hit → violation",
  () =>
    forbid.stdout.includes("violation cc-forbid") &&
    forbid.stdout.includes("secret.env"),
);

const nestedForbid = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-nested-forbid",
  "--ownership",
  ownership,
]);
suite.ok(
  "ownership: forbidden glob catches file inside untracked dir",
  () =>
    nestedForbid.status !== 0 &&
    nestedForbid.stdout.includes("violation cc-nested-forbid") &&
    nestedForbid.stdout.includes("src/nested/secret.env"),
);
suite.ok(
  "ownership: nested forbidden file did not reach main",
  () => !existsSync(join(work, "src", "nested", "secret.env")),
);

mkwt("cc-clean2");
writeFileSync(join(workspace("cc-clean2"), "owned3.py"), "1\n");
const violationMixed = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-stray cc-clean2",
  "--ownership",
  ownership,
]);
suite.ok("violation does not block: cc-clean2 still integrated", () =>
  existsSync(join(work, "owned3.py")),
);
suite.ok("mixed summary has 1 violation", () =>
  violationMixed.stdout.includes("1 violation"),
);

mkwt("cc-free");
writeFileSync(join(workspace("cc-free"), "anything.py"), "1\n");
const free = run(integrate, [
  "--work",
  work,
  "--agents",
  "cc-free",
  "--ownership",
  ownership,
]);
suite.ok(
  "not in ownership list → unrestricted, integrates normally",
  () => free.status === 0 && existsSync(join(work, "anything.py")),
);

suite.ok(
  "ownership file not found → non-0",
  () =>
    run(integrate, [
      "--work",
      work,
      "--agents",
      "x",
      "--ownership",
      "/no/such/file",
    ]).status !== 0,
);
suite.ok(
  "missing --work → non-0",
  () => run(integrate, ["--agents", "x"]).status !== 0,
);
suite.ok(
  "missing --agents → non-0",
  () => run(integrate, ["--work", work]).status !== 0,
);
suite.ok(
  "invalid onconflict → non-0",
  () =>
    run(integrate, ["--work", work, "--agents", "x", "--onconflict", "bogus"])
      .status !== 0,
);

suite.done();
