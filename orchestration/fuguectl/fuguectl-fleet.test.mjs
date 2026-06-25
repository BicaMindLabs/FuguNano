#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSuite,
  here,
  makeTempDir,
  run,
  writeExecutable,
} from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-fleet");
const fleet = join(here, "fuguectl-fleet");
const tmp = makeTempDir();
const work = join(tmp, "work");
const claude = join(tmp, "claude");
const provider = join(tmp, "fugue-cc");

mkdirSync(join(work, ".fugue-cc"), { recursive: true });
mkdirSync(join(claude, ".fugue-cc"), { recursive: true });
process.env.FUGUE_CC_WORK = work;
process.env.FUGUE_CC_CLAUDE = claude;
process.env.CLAUDE_CODE_TEST_X = "1";
process.env.FUGUE_CC_BIN = provider;

const writeProvider = (body) =>
  writeExecutable(provider, ["#!/usr/bin/env node", ...body]);

const notReady = () => writeProvider(["process.exit(0);"]);
const ready = () =>
  writeProvider([
    "if (process.argv.slice(2).join(' ') === 'ping daemon') {",
    "  process.stdout.write('mount_state: mounted\\nhealth: alive\\n');",
    "}",
  ]);
const unmounted = () =>
  writeProvider([
    "if (process.argv.slice(2).join(' ') === 'ping daemon') {",
    "  process.stdout.write('mount_state: unmounted\\nhealth: unmounted\\n');",
    "}",
  ]);

notReady();
const up = run(fleet, ["up", "--dry"]).stdout;
const workLine = up.split(/\r?\n/u).find((line) => line.includes("/work "));
const claudeLine = up.split(/\r?\n/u).find((line) => line.includes("/claude "));
suite.ok("up --dry strips CLAUDE_CODE_*(incl TEST_X)", () =>
  up.includes("-u CLAUDE_CODE_TEST_X"),
);
suite.ok("up --dry includes fugue-cc -s start", () =>
  up.includes("fugue-cc -s"),
);
suite.ok(
  "up --dry covers both projects",
  () => up.includes("work") && up.includes("claude"),
);
suite.ok("claude pool carries CLAUDE_START_CMD prefix", () =>
  (claudeLine ?? "").includes("CLAUDE_START_CMD=claude"),
);
suite.ok(
  "work pool has no claude prefix",
  () => !(workLine ?? "").includes("CLAUDE_START_CMD"),
);

const ptyDry = run(fleet, ["up", "--pty", "--dry"]).stdout;
suite.ok("up --pty --dry uses fleet-launch.py", () =>
  ptyDry.includes("fleet-launch.py"),
);
suite.ok("up --pty --dry includes fugue-cc -s", () =>
  ptyDry.includes("fugue-cc -s"),
);

const pythonAvailable = run("python3", ["--version"]).status === 0;
if (pythonAvailable) {
  const ptyAvailable =
    run("python3", [
      "-c",
      [
        "import pty,os,sys",
        "try:",
        " p,_=pty.fork()",
        "except OSError:",
        " sys.exit(1)",
        "if p==0: os._exit(0)",
        "os.waitpid(p,0)",
      ].join("\n"),
    ]).status === 0;

  if (ptyAvailable) {
    const launchOut = join(work, "launch.out");
    run("python3", [
      join(here, "fleet-launch.py"),
      work,
      process.execPath,
      "-e",
      [
        "const fs = require('node:fs');",
        "fs.writeFileSync('launch.out', process.cwd() + '\\n' + Object.keys(process.env).filter((key) => key.startsWith('CLAUDE_CODE')).join('\\n'));",
      ].join(" "),
    ]);
    for (
      let attempt = 0;
      attempt < 20 && !existsSync(launchOut);
      attempt += 1
    ) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
    }
    suite.ok("fleet-launch runs inside project(cwd proof)", () =>
      existsSync(launchOut),
    );
    suite.ok(
      "fleet-launch strips CLAUDE_CODE_*",
      () =>
        existsSync(launchOut) &&
        !readFileSync(launchOut, "utf8").includes("CLAUDE_CODE_TEST_X"),
    );
    suite.ok(
      "fleet-launch returns 0 on successful launch",
      () =>
        run("python3", [
          join(here, "fleet-launch.py"),
          work,
          process.execPath,
          "-e",
          "",
        ]).status === 0,
    );
  } else {
    console.log(
      "  ⊘ fleet-launch runs inside project(cwd proof) — skipped: out of ptys",
    );
    console.log("  ⊘ fleet-launch strips CLAUDE_CODE_* — skipped: out of ptys");
    console.log(
      "  ⊘ fleet-launch returns 0 on successful launch — skipped: out of ptys",
    );
  }

  suite.ok(
    "fleet-launch no args → nonzero",
    () => run("python3", [join(here, "fleet-launch.py")]).status !== 0,
  );
}

suite.ok("status(not-ready) reports down", () =>
  run(fleet, ["status"]).stdout.includes("down"),
);

ready();
suite.ok("status(ready stub=mounted) reports ready", () =>
  run(fleet, ["status"]).stdout.includes("ready"),
);

unmounted();
suite.ok(
  "status(unmounted: alive but not mounted) reports down not ready",
  () => {
    const out = run(fleet, ["status"]).stdout;
    return out.includes("down") && !out.includes("✓ ready");
  },
);

writeProvider(["process.stdout.write('desired_state: running\\n');"]);
suite.ok(
  "status(desired_state:running config intent ≠ mount) reports down",
  () => run(fleet, ["status"]).stdout.includes("down"),
);

suite.ok("down does not error", () => run(fleet, ["down"]).status === 0);
suite.ok(
  "unknown subcommand → nonzero",
  () => run(fleet, ["bogus"]).status !== 0,
);

suite.done();
