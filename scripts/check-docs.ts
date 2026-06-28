#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const root = resolve(dirname(process.argv[1] ?? "scripts/check-docs.ts"), "..");
const path = (...parts) => join(root, ...parts);

const fuguectl = path("orchestration", "fuguectl", "fuguectl");
const readmeEn = path("README.md");
const readmeZh = path("README.zh-CN.md");
const overviewEn = path("docs", "readme-overview-en.svg");
const overviewZh = path("docs", "readme-overview-zh.svg");
const agentsDoc = path("AGENTS.md");
const agentTeamDoc = path("docs", "AGENT_TEAM.md");
const changelog = path("CHANGELOG.md");
const workflowDoc = path("docs", "WORKFLOW.md");
const agentRuntimeDoc = path("docs", "AGENT_RUNTIME.md");
const pullRequestTemplate = path(".github", "PULL_REQUEST_TEMPLATE.md");
const engineCommandDir = path("engine", "src", "cli", "commands");
const fugueDir = path("orchestration", "fuguectl");
const planWrapper = path("orchestration", "fuguectl", "fuguectl-plan");
const preflightWrapper = path(
  "orchestration",
  "fuguectl",
  "fuguectl-preflight",
);
const workflowSkill = path("orchestration", "fuguectl", "SKILL.md");
const harnessPort = path("engine", "src", "domain", "ports", "harness.ts");
const selfDoc = path("docs", "SELF_HARNESS.md");
const selfDomain = path("engine", "src", "domain", "self-harness.ts");
const selfCli = path("engine", "src", "cli", "commands", "self-harness.ts");
const fugueFiles = readdirSync(fugueDir);

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
requireFile(readmeEn, `check-docs: cannot find ${readmeEn}`);
requireFile(
  readmeZh,
  `check-docs: cannot find ${readmeZh} (the repo is bilingual; keep README.zh-CN.md)`,
);
requireFile(overviewEn, `check-docs: cannot find ${overviewEn}`);
requireFile(overviewZh, `check-docs: cannot find ${overviewZh}`);
requireFile(agentsDoc, `check-docs: cannot find ${agentsDoc}`);
requireFile(agentTeamDoc, `check-docs: cannot find ${agentTeamDoc}`);
requireFile(changelog, `check-docs: cannot find ${changelog}`);
requireFile(workflowDoc, `check-docs: cannot find ${workflowDoc}`);
requireFile(agentRuntimeDoc, `check-docs: cannot find ${agentRuntimeDoc}`);
requireFile(
  pullRequestTemplate,
  `check-docs: cannot find ${pullRequestTemplate}`,
);
requireFile(engineCommandDir, `check-docs: cannot find ${engineCommandDir}`);
requireFile(planWrapper, `check-docs: cannot find ${planWrapper}`);
requireFile(preflightWrapper, `check-docs: cannot find ${preflightWrapper}`);
requireFile(workflowSkill, `check-docs: cannot find ${workflowSkill}`);
requireFile(harnessPort, `check-docs: cannot find ${harnessPort}`);
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

const routedCommandEntries = [
  ...driver.matchAll(/\["([a-z][a-z0-9_-]*)",\s*"([a-z][a-z0-9_-]*)"\]/gu),
].map((match) => [match[1] ?? "", match[2] ?? ""]);

const nodeSubcommands = routedCommandEntries
  .map(([command]) => command)
  .filter((command) => command.length > 0 && command !== "round-summary");

const publicInlineSubcommands = driver.includes('subcommand === "selftest"')
  ? ["selftest"]
  : [];
const subcommands = [
  ...new Set([
    ...(bashSubcommands.length > 0 ? bashSubcommands : nodeSubcommands),
    ...publicInlineSubcommands,
  ]),
].sort();

if (subcommands.length === 0)
  die("check-docs: parsed no subcommands from the driver");

const routedSubcommands = nodeSubcommands;
const wrapperExemptCommands = new Set(["self-harness"]);
const supportTestFiles = new Set(["e2e", "node-bridge"]);
const commandWrappers = new Set(
  fugueFiles
    .map((file) => /^fuguectl-([a-z][a-z0-9-]*)$/u.exec(file)?.[1] ?? "")
    .filter((command) => command.length > 0),
);
const commandTests = new Set(
  fugueFiles
    .map(
      (file) =>
        /^fuguectl-([a-z][a-z0-9-]*)\.test\.mjs$/u.exec(file)?.[1] ?? "",
    )
    .filter((command) => command.length > 0),
);
const engineCommandRoots = [
  ...new Set(
    readdirSync(engineCommandDir)
      .filter((file) => file.endsWith(".ts"))
      .flatMap((file) =>
        [
          ...text(join(engineCommandDir, file)).matchAll(
            /static\s+override\s+paths\s*=\s*\[\s*\[\s*'([^']+)'/gu,
          ),
        ].map((match) => match[1] ?? ""),
      )
      .filter((command) => command.length > 0),
  ),
].sort();
const routedEngineCommands = [
  ...new Set(
    routedCommandEntries
      .map(([, engineCommand]) => engineCommand)
      .filter((command) => command.length > 0),
  ),
].sort();
const unroutedEngineCommands = engineCommandRoots.filter(
  (command) => !routedEngineCommands.includes(command),
);
const unknownRoutedEngineCommands = routedEngineCommands.filter(
  (command) => !engineCommandRoots.includes(command),
);

if (unroutedEngineCommands.length === 0)
  ok(
    `fuguectl commandMap exposes ${String(engineCommandRoots.length)} engine command roots`,
  );
else
  no(
    `engine command root(s) missing from fuguectl commandMap: ${unroutedEngineCommands.join(", ")}`,
  );

if (unknownRoutedEngineCommands.length === 0)
  ok("fuguectl commandMap has no unknown engine command targets");
else
  no(
    `fuguectl commandMap target(s) missing engine command root: ${unknownRoutedEngineCommands.join(", ")}`,
  );
const wrapperRequiredSubcommands = routedSubcommands.filter(
  (command) => !wrapperExemptCommands.has(command),
);
const missingWrappers = wrapperRequiredSubcommands.filter(
  (command) => !commandWrappers.has(command),
);
const orphanWrappers = [...commandWrappers].filter(
  (command) => !wrapperRequiredSubcommands.includes(command),
);
const missingTests = routedSubcommands.filter(
  (command) => !commandTests.has(command),
);
const orphanTests = [...commandTests].filter(
  (command) =>
    !routedSubcommands.includes(command) && !supportTestFiles.has(command),
);

if (missingWrappers.length === 0)
  ok(
    `fuguectl wrappers cover ${String(wrapperRequiredSubcommands.length)} routed subcommands`,
  );
else
  no(
    `missing fuguectl wrapper(s): ${missingWrappers.map((command) => `fuguectl-${command}`).join(", ")}`,
  );

if (orphanWrappers.length === 0)
  ok("fuguectl wrappers have no orphan command bridges");
else
  no(
    `orphan fuguectl wrapper(s): ${orphanWrappers.map((command) => `fuguectl-${command}`).join(", ")}`,
  );

if (missingTests.length === 0)
  ok(
    `fuguectl command tests cover ${String(routedSubcommands.length)} routed subcommands`,
  );
else
  no(
    `missing fuguectl command test(s): ${missingTests.map((command) => `fuguectl-${command}.test.mjs`).join(", ")}`,
  );

if (orphanTests.length === 0)
  ok("fuguectl command tests have no orphan command suites");
else
  no(
    `orphan fuguectl command test(s): ${orphanTests.map((command) => `fuguectl-${command}.test.mjs`).join(", ")}`,
  );

const en = text(readmeEn);
const zh = text(readmeZh);
const overviewEnText = text(overviewEn);
const overviewZhText = text(overviewZh);
const agentsText = text(agentsDoc);
const agentTeamText = text(agentTeamDoc);
const changelogText = text(changelog);
const workflowText = text(workflowDoc);
const agentRuntimeText = text(agentRuntimeDoc);
const pullRequestTemplateText = text(pullRequestTemplate);
const planWrapperText = text(planWrapper);
const preflightWrapperText = text(preflightWrapper);
const workflowSkillText = text(workflowSkill);
const harnessPortText = text(harnessPort);
for (const command of subcommands) {
  const missing = [];
  if (!en.includes(`fuguectl ${command}`)) missing.push("README.md");
  if (!zh.includes(`fuguectl ${command}`)) missing.push("README.zh-CN.md");
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
    `${basename(readmeZh)}: did not find '${String(subcommands.length)} 个子命令' (actual ${String(subcommands.length)}; fix README.zh-CN's subcommand count)`,
  );

const testSuites = fugueFiles.filter((file) =>
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
    `${basename(readmeZh)}: did not find '${String(testSuites)} 套测试' (actual ${String(testSuites)}; fix README.zh-CN's test-suite count)`,
  );

const testFiles = fugueFiles.filter((file) => file.endsWith(".test.mjs"));
const countSuiteAssertions = (source) => {
  const staticAssertions = [...source.matchAll(/suite\.ok\s*\(/gu)].length;
  const loopExpansion = [
    ...source.matchAll(
      /for\s*\(\s*const\s+\w+\s+of\s+\[([\s\S]*?)\]\s*\)\s*\{([\s\S]*?)\}/gu,
    ),
  ]
    .map((match) => {
      const items = [...(match[1] ?? "").matchAll(/["'`][\s\S]*?["'`]/gu)]
        .length;
      const loopAssertions = [...(match[2] ?? "").matchAll(/suite\.ok\s*\(/gu)]
        .length;
      return Math.max(0, items - 1) * loopAssertions;
    })
    .reduce((sum, count) => sum + count, 0);
  return staticAssertions + loopExpansion;
};
const fugueAssertions = testFiles
  .map((file) => countSuiteAssertions(text(join(fugueDir, file))))
  .reduce((sum, count) => sum + count, 0);
const assertionCount = String(fugueAssertions);
if (en.includes(`assertions-${assertionCount}`))
  ok(`${basename(readmeEn)}: assertion-count badge = ${assertionCount}`);
else
  no(
    `${basename(readmeEn)}: did not find 'assertions-${assertionCount}' (actual ${assertionCount}; fix the README's assertion badge)`,
  );

if (zh.includes(`assertions-${assertionCount}`))
  ok(`${basename(readmeZh)}: assertion-count badge = ${assertionCount}`);
else
  no(
    `${basename(readmeZh)}: did not find 'assertions-${assertionCount}' (actual ${assertionCount}; fix README.zh-CN's assertion badge)`,
  );

if (overviewEnText.includes(`${assertionCount} assertions`))
  ok(`${basename(overviewEn)}: assertion-count claim = ${assertionCount}`);
else
  no(
    `${basename(overviewEn)}: did not find '${assertionCount} assertions' (actual ${assertionCount}; fix the overview SVG)`,
  );

if (overviewZhText.includes(`${assertionCount} 个断言`))
  ok(`${basename(overviewZh)}: assertion-count claim = ${assertionCount}`);
else
  no(
    `${basename(overviewZh)}: did not find '${assertionCount} 个断言' (actual ${assertionCount}; fix the overview SVG)`,
  );

const harnessBlock =
  /export const HARNESS_NAMES\s*=\s*\[([\s\S]*?)\]\s*as const/u.exec(
    harnessPortText,
  )?.[1] ?? "";
const harnesses = [...harnessBlock.matchAll(/'([^']+)'/gu)].map(
  (match) => match[1] ?? "",
);
if (harnesses.length === 0)
  die(`check-docs: parsed no harness names from ${harnessPort}`);

const harnessList = harnesses.join("|");
for (const [file, content] of [
  [fuguectl, driver],
  [planWrapper, planWrapperText],
  [readmeEn, en],
  [readmeZh, zh],
  [agentsDoc, agentsText],
  [workflowDoc, workflowText],
]) {
  if (content.includes(harnessList))
    ok(`${basename(file)}: documents harness list ${harnessList}`);
  else no(`${basename(file)}: missing canonical harness list '${harnessList}'`);
}

const planningTokens = [
  "--models",
  "--out",
  "--timeout-ms",
  "--allow-partial",
  "--codex-clean",
  "--harness-arg",
  "--codex-arg",
  "--opencode-arg",
  "--agy-arg",
  "--task",
];
const planningSurface = (content) =>
  content
    .split(/\r?\n/u)
    .filter(
      (line) =>
        line.includes("fuguectl plan") ||
        line.includes("fugue plan") ||
        line.includes('"$FO" plan') ||
        line.includes("fuguectl-plan"),
    )
    .join("\n");

const documentsSmokeSummaryAggregateFields = (content) =>
  content
    .split(/\n\s*\n/u)
    .some(
      (paragraph) =>
        paragraph.includes("summary.json") &&
        paragraph.includes("`status`/`passed`/`failed`/`exitCode`"),
    );

for (const [file, content] of [
  [fuguectl, driver],
  [planWrapper, planWrapperText],
  [readmeEn, en],
  [readmeZh, zh],
  [agentsDoc, agentsText],
  [agentTeamDoc, agentTeamText],
  [workflowDoc, workflowText],
  [workflowSkill, workflowSkillText],
]) {
  const surface = planningSurface(content);
  const missing = planningTokens.filter((token) => !surface.includes(token));
  if (missing.length === 0)
    ok(
      `${basename(file)}: documents planning options ${planningTokens.join(" ")}`,
    );
  else
    no(
      `${basename(file)}: planning docs missing ${missing.join(", ")} (keep fuguectl plan option surface in sync)`,
    );
}

for (const [file, content] of [
  [readmeEn, en],
  [readmeZh, zh],
  [agentsDoc, agentsText],
  [workflowDoc, workflowText],
  [agentRuntimeDoc, agentRuntimeText],
  [workflowSkill, workflowSkillText],
  [changelog, changelogText],
]) {
  if (!content.includes("agy --print"))
    ok(`${basename(file)}: no stale 'agy --print' guidance`);
  else no(`${basename(file)}: replace stale 'agy --print' with 'agy --prompt'`);
}

for (const [file, content] of [
  [readmeEn, en],
  [readmeZh, zh],
  [agentsDoc, agentsText],
  [workflowDoc, workflowText],
  [agentRuntimeDoc, agentRuntimeText],
  [workflowSkill, workflowSkillText],
  [changelog, changelogText],
]) {
  if (content.includes("agy --prompt"))
    ok(`${basename(file)}: documents 'agy --prompt'`);
  else no(`${basename(file)}: missing 'agy --prompt'`);
}

if (!pullRequestTemplateText.includes("No Gemini dependency introduced"))
  ok(`${basename(pullRequestTemplate)}: no blanket Gemini dependency ban`);
else
  no(
    `${basename(pullRequestTemplate)}: replace blanket Gemini dependency ban with a retired Gemini CLI entrypoint check`,
  );

if (pullRequestTemplateText.includes("retired Gemini CLI entrypoint"))
  ok(
    `${basename(pullRequestTemplate)}: scopes Gemini guard to retired CLI entrypoints`,
  );
else
  no(
    `${basename(pullRequestTemplate)}: missing retired Gemini CLI entrypoint wording`,
  );

for (const [file, content] of [
  [fuguectl, driver],
  [preflightWrapper, preflightWrapperText],
  [readmeEn, en],
  [readmeZh, zh],
  [agentsDoc, agentsText],
  [workflowDoc, workflowText],
  [workflowSkill, workflowSkillText],
]) {
  if (content.includes("preflight --harness lite"))
    ok(`${basename(file)}: documents lite preflight`);
  else no(`${basename(file)}: missing 'preflight --harness lite'`);
}

for (const [file, content] of [
  [fuguectl, driver],
  [readmeEn, en],
  [readmeZh, zh],
  [agentsDoc, agentsText],
  [workflowDoc, workflowText],
  [workflowSkill, workflowSkillText],
]) {
  if (content.includes("summary.json"))
    ok(`${basename(file)}: documents smoke summary.json`);
  else no(`${basename(file)}: missing smoke summary.json guidance`);
}

for (const [file, content] of [
  [readmeEn, en],
  [readmeZh, zh],
  [workflowDoc, workflowText],
  [workflowSkill, workflowSkillText],
]) {
  if (documentsSmokeSummaryAggregateFields(content))
    ok(`${basename(file)}: documents smoke summary aggregate fields`);
  else no(`${basename(file)}: missing smoke summary aggregate field guidance`);
}

for (const [file, content] of [
  [fuguectl, driver],
  [planWrapper, planWrapperText],
  [readmeEn, en],
  [readmeZh, zh],
  [agentsDoc, agentsText],
  [agentTeamDoc, agentTeamText],
  [workflowDoc, workflowText],
  [workflowSkill, workflowSkillText],
]) {
  const surface = planningSurface(content);
  if (surface.includes("--harness lite") || surface.includes("|lite"))
    ok(`${basename(file)}: documents lite planning`);
  else no(`${basename(file)}: missing 'plan --harness lite'`);
}

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

for (const command of selfCommands) {
  const fuguectlCommand = `fuguectl ${command}`;
  if (selfDocText.includes(fuguectlCommand))
    ok(`${basename(selfDoc)}: documents '${fuguectlCommand}'`);
  else no(`${basename(selfDoc)}: missing '${fuguectlCommand}'`);
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
    `✓ check-docs: docs and code are consistent (${String(subcommands.length)} fuguectl subcommands · ${String(testSuites)} fuguectl test suites · ${assertionCount} fuguectl assertions · ${String(harnesses.length)} harnesses · ${String(selfCommands.length)} self-harness commands · ${String(surfaces.length)} self-harness surfaces)`,
  );
  process.exit(0);
}

console.log("✗ check-docs: docs drift (✗ above) — fix the README and re-run");
process.exit(1);
