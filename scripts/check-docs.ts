#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(dirname(process.argv[1] ?? "scripts/check-docs.ts"), "..");
const path = (...parts) => join(root, ...parts);

const fuguectl = path("orchestration", "fuguectl", "fuguectl");
const readmeEn = path("README.md");
const readmeZh = path("README_ZH.md");
const fugueDir = path("orchestration", "fuguectl");
const selfDoc = path("docs", "SELF_HARNESS.md");
const selfDomain = path("engine", "src", "domain", "self-harness.ts");
const selfCli = path("engine", "src", "cli", "commands", "self-harness.ts");

let failed = false;
const ok = (message) => console.log(`  ✓ ${message}`);
const no = (message) => {
  console.log(`  ✗ ${message}`);
  failed = true;
};
const die = (message) => {
  console.error(message);
  process.exit(2);
};
const requireFile = (file, message) => {
  if (!existsSync(file)) die(message);
};

requireFile(fuguectl, `check-docs: cannot find ${fuguectl}`);
requireFile(
  readmeZh,
  `check-docs: cannot find ${readmeZh} (the repo is bilingual; keep README_ZH.md)`,
);
requireFile(selfDoc, `check-docs: cannot find ${selfDoc}`);
requireFile(selfDomain, `check-docs: cannot find ${selfDomain}`);
requireFile(selfCli, `check-docs: cannot find ${selfCli}`);

console.log("── check-docs: docs vs code ──");

const text = (file) => readFileSync(file, "utf8");
const driver = text(fuguectl);
const bashSubcommands = [...driver.matchAll(/^[ \t]+([a-z][a-z0-9|_-]*)\)/gmu)]
  .map((match) => (match[1] ?? "").replace(/\|.*$/u, ""))
  .filter(
    (command) =>
      command.length > 0 && command !== "help" && command !== "selftest",
  );

const nodeSubcommands = [
  ...driver.matchAll(/\["([a-z][a-z0-9_-]*)",\s*"[^"]+"\]/gu),
]
  .map((match) => match[1] ?? "")
  .filter((command) => command.length > 0 && command !== "round-summary");

const subcommands = [
  ...new Set(bashSubcommands.length > 0 ? bashSubcommands : nodeSubcommands),
];

if (subcommands.length === 0)
  die("check-docs: parsed no subcommands from the driver");

const en = text(readmeEn);
const zh = text(readmeZh);
for (const command of subcommands) {
  const missing = [];
  if (!en.includes(`fuguectl ${command}`)) missing.push("README.md");
  if (!zh.includes(`fuguectl ${command}`)) missing.push("README_ZH.md");
  if (missing.length === 0) ok(`subcommand '${command}' documented`);
  else
    no(
      `subcommand '${command}' not found in:${missing.map((item) => ` ${item}`).join("")} (add a CLI table row)`,
    );
}

if (en.includes(`${String(subcommands.length)} subcommands`))
  ok(
    `${basename(readmeEn)}: subcommand-count claim = ${String(subcommands.length)}`,
  );
else
  no(
    `${basename(readmeEn)}: did not find '${String(subcommands.length)} subcommands' (actual ${String(subcommands.length)}; fix the README's subcommand count)`,
  );

if (zh.includes(`${String(subcommands.length)} 个子命令`))
  ok(
    `${basename(readmeZh)}: subcommand-count claim = ${String(subcommands.length)}`,
  );
else
  no(
    `${basename(readmeZh)}: did not find '${String(subcommands.length)} 个子命令' (actual ${String(subcommands.length)}; fix README_ZH's subcommand count)`,
  );

const testSuites = readdirSync(fugueDir).filter((file) =>
  file.endsWith(".test.mjs"),
).length;
if (en.includes(`${String(testSuites)} test suites`))
  ok(`${basename(readmeEn)}: test-suite-count claim = ${String(testSuites)}`);
else
  no(
    `${basename(readmeEn)}: did not find '${String(testSuites)} test suites' (actual ${String(testSuites)}; fix the README's test-suite count)`,
  );

if (zh.includes(`${String(testSuites)} 套测试`))
  ok(`${basename(readmeZh)}: test-suite-count claim = ${String(testSuites)}`);
else
  no(
    `${basename(readmeZh)}: did not find '${String(testSuites)} 套测试' (actual ${String(testSuites)}; fix README_ZH's test-suite count)`,
  );

const selfCliText = text(selfCli);
const selfCommands = [
  ...selfCliText.matchAll(/\[\['self-harness',[ \t]*'([^']+)'\]\]/gu),
].map((match) => `self-harness ${match[1] ?? ""}`);
if (selfCommands.length === 0)
  die(`check-docs: parsed no Self-Harness CLI commands from ${selfCli}`);

const selfDocText = text(selfDoc);
for (const command of selfCommands) {
  if (selfDocText.includes(command))
    ok(`${basename(selfDoc)}: documents '${command}'`);
  else no(`${basename(selfDoc)}: missing '${command}'`);
}

const selfDomainText = text(selfDomain);
const surfacesBlock =
  /export const EDITABLE_SURFACES[\s\S]*?\];/u.exec(selfDomainText)?.[0] ?? "";
const surfaces = [...surfacesBlock.matchAll(/'([^']+)'/gu)].map(
  (match) => match[1] ?? "",
);
if (surfaces.length === 0)
  die(`check-docs: parsed no Self-Harness surfaces from ${selfDomain}`);

for (const surface of surfaces) {
  if (selfDocText.includes(`"${surface}"`))
    ok(`${basename(selfDoc)}: documents surface '${surface}'`);
  else no(`${basename(selfDoc)}: missing editable surface '${surface}'`);
}

console.log("");
if (!failed) {
  console.log(
    `✓ check-docs: docs and code are consistent (${String(subcommands.length)} fuguectl subcommands · ${String(testSuites)} fuguectl test suites · ${String(selfCommands.length)} self-harness commands · ${String(surfaces.length)} self-harness surfaces)`,
  );
  process.exit(0);
}

console.log("✗ check-docs: docs drift (✗ above) — fix the README and re-run");
process.exit(1);
