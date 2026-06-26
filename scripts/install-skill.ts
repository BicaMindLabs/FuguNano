#!/usr/bin/env node
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";

const root = resolve(
  dirname(process.argv[1] ?? "scripts/install-skill.ts"),
  "..",
);
const home = process.env.HOME;
if (home === undefined || home.length === 0) {
  console.error("HOME is not set");
  process.exit(2);
}

const src = join(root, "orchestration", "fuguectl");
const skillsDir =
  process.env.CLAUDE_SKILLS_DIR ?? join(home, ".claude", "skills");
const dest = join(skillsDir, "fugunano");

if (!existsSync(join(src, "SKILL.md"))) {
  console.error(`✗ cannot find ${join(src, "SKILL.md")}`);
  process.exit(1);
}

mkdirSync(dirname(dest), { recursive: true });

if (existsSync(dest)) {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\..*$/u, "")
    .replace("T", "-");
  const backup = `${dest}.bak.${stamp}`;
  renameSync(dest, backup);
  console.log(`ℹ backed up the existing skill -> ${backup}`);
}

cpSync(src, dest, { recursive: true });

try {
  chmodSync(join(dest, "fuguectl"), 0o755);
} catch {
  // Best-effort parity with the former shell installer.
}

for (const file of readdirSync(dest)) {
  if (!/^fuguectl-[a-z]+$/u.test(file)) continue;
  try {
    chmodSync(join(dest, file), 0o755);
  } catch {
    // Best-effort parity with the former shell installer.
  }
}

console.log(`✓ fuguectl skill installed to ${dest}`);
console.log(
  '  Next: reopen a Claude Code session -> type /fugunano or say "use fuguectl to do X / multi-agent collaboration"',
);
console.log(`  Self-test: ${join(dest, "fuguectl")} selftest`);
console.log(
  "  Note: the real API key does not travel with the skill, it still lives in ~/.config/cc-model-secrets.env",
);
