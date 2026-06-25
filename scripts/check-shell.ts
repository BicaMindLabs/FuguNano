#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const root = resolve(
  dirname(process.argv[1] ?? "scripts/check-shell.ts"),
  "..",
);

const collect = (dir, predicate) => {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collect(abs, predicate));
    else if (entry.isFile() && predicate(abs)) out.push(relative(root, abs));
  }
  return out;
};

const explicit = [
  ...collect(join(root, "backends", "bin"), (file) => /-code$/u.test(file)),
  "backends/bin/cc-models",
  "backends/bin/cc-sync",
  "orchestration/fuguectl/fuguectl",
  ...collect(join(root, "orchestration", "fuguectl"), (file) =>
    /\/fuguectl-[a-z]+$/u.test(file),
  ),
].filter((file) => existsSync(join(root, file)));

const scripts = [
  ...explicit,
  ...collect(join(root, "backends"), (file) => file.endsWith(".sh")),
  ...collect(join(root, "scripts"), (file) => file.endsWith(".sh")),
  ...collect(join(root, "orchestration"), (file) => file.endsWith(".sh")),
].sort();

const uniqueScripts = [...new Set(scripts)];
let failed = false;
const shellScripts = [];
const nodeScripts = [];

for (const script of uniqueScripts) {
  const text = readFileSync(join(root, script), "utf8");
  const firstLine = text.split(/\r?\n/u, 1)[0] ?? "";
  if (firstLine.includes("node")) nodeScripts.push(script);
  else shellScripts.push(script);
}

console.log(`── node syntax (${String(nodeScripts.length)} launchers) ──`);
for (const script of nodeScripts) {
  const result = spawnSync(process.execPath, ["--check", script], {
    cwd: root,
    stdio: "ignore",
  });
  if (result.status !== 0) {
    console.log(`  ✗ node syntax: ${script}`);
    failed = true;
  }
}
if (!failed) console.log("  ✓ all pass");

if (shellScripts.length === 0) {
  console.log("── no shell scripts ──");
  console.log("  ✓ none found");
} else {
  console.log("── no shell scripts ──");
  for (const script of shellScripts)
    console.log(`  ✗ shell script remains: ${script}`);
  failed = true;
}

process.exit(failed ? 1 : 0);
