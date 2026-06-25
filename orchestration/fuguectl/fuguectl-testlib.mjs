import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const here = dirname(fileURLToPath(import.meta.url));

export const makeTempDir = () => {
  const dir = mkdtempSync(join(tmpdir(), "fuguectl-test-"));
  process.on("exit", () => {
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
};

export const run = (command, args, options = {}) =>
  spawnSync(command, args, {
    encoding: "utf8",
    env: process.env,
    ...options,
  });

export const runGit = (args, options = {}) =>
  run(
    "git",
    [
      "-c",
      "user.email=t@t",
      "-c",
      "user.name=t",
      "-c",
      "commit.gpgsign=false",
      "-c",
      "init.defaultBranch=main",
      ...args,
    ],
    options,
  );

export const writeExecutable = (file, lines) =>
  writeFileSync(file, [...lines, ""].join("\n"), { mode: 0o755 });

export const countLines = (text) =>
  text.split(/\r?\n/u).filter((line) => line.length > 0).length;

export const createSuite = (name) => {
  let pass = 0;
  let fail = 0;
  console.log(`${name} tests`);
  return {
    ok(label, condition) {
      let passed = false;
      try {
        passed =
          typeof condition === "function"
            ? Boolean(condition())
            : Boolean(condition);
      } catch {
        passed = false;
      }
      if (passed) {
        console.log(`  ✓ ${label}`);
        pass += 1;
      } else {
        console.log(`  ✗ ${label}`);
        fail += 1;
      }
    },
    done() {
      console.log(`${name}: ${pass} passed, ${fail} failed`);
      if (fail > 0) process.exit(1);
    },
  };
};
