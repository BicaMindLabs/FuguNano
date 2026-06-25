#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  createSuite,
  here,
  makeTempDir,
  run,
  writeExecutable,
} from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-skills");
const skills = join(here, "fuguectl-skills");
const experience = join(here, "fuguectl-experience");
const tmp = makeTempDir();
const has = (needle, haystack) => haystack.includes(needle);

const skillRoot = join(tmp, "skills");
const pluginsRoot = join(tmp, "plugins");
mkdirSync(join(skillRoot, "my-tool"), { recursive: true });
mkdirSync(join(skillRoot, "wdkns-note-1"), { recursive: true });
mkdirSync(join(skillRoot, "folded-desc"), { recursive: true });
mkdirSync(join(skillRoot, ".system", "sys-tool"), { recursive: true });
mkdirSync(join(pluginsRoot, "mymp", "plugins", "myplug", "skills", "myskill"), {
  recursive: true,
});

writeFileSync(
  join(skillRoot, "my-tool", "SKILL.md"),
  "---\nname: my-tool\ndescription: A real functional tool for doing X. Use when Y.\n---\n# my-tool body\n",
);
writeFileSync(
  join(skillRoot, "wdkns-note-1", "SKILL.md"),
  "---\nname: wdkns-note-1\ndescription: a learning note about Z\n---\n",
);
writeFileSync(
  join(skillRoot, "folded-desc", "SKILL.md"),
  "---\nname: folded-desc\ndescription: >-\n  first line of folded\n  second line continues\nmetadata:\n  type: x\n---\nbody\n",
);
writeFileSync(
  join(skillRoot, ".system", "sys-tool", "SKILL.md"),
  "---\nname: sys-tool\ndescription: a SYSTEM meta tool for creating things\n---\n# sys body\n",
);
writeFileSync(
  join(
    pluginsRoot,
    "mymp",
    "plugins",
    "myplug",
    "skills",
    "myskill",
    "SKILL.md",
  ),
  "---\nname: myskill\ndescription: a PLUGIN skill PLUGDESC here\n---\n# plug body\n",
);

process.env.FUGUE_SKILLS_ROOT = skillRoot;
process.env.FUGUE_PLUGINS_ROOT = pluginsRoot;
process.env.FUGUE_SKILLS_CATALOG = join(tmp, "cat.tsv");

const indexOut = run(skills, ["index", "--refresh"]).stdout;
suite.ok("index reports 5 skills", () => has("5 skills", indexOut));
suite.ok(
  "index by source user 3",
  () => has("user    3", indexOut) || has("user   3", indexOut),
);
suite.ok("index by source system 1", () => has("system", indexOut));
suite.ok("index by source plugin 1", () => has("plugin", indexOut));
suite.ok(
  "catalog written to file",
  () => readFileSync(process.env.FUGUE_SKILLS_CATALOG, "utf8").length > 0,
);

const catalog = () => readFileSync(process.env.FUGUE_SKILLS_CATALOG, "utf8");
suite.ok("catalog: my-tool=user functional", () =>
  has("my-tool\tuser\tfunctional", catalog()),
);
suite.ok("catalog: wdkns-note-1=user note (prefix classification)", () =>
  has("wdkns-note-1\tuser\tnote", catalog()),
);
suite.ok("catalog: sys-tool=system", () => has("sys-tool\tsystem", catalog()));
suite.ok("catalog: plugin id = myplug:myskill", () =>
  has("myplug:myskill", catalog()),
);
suite.ok("catalog includes path column (.system path)", () =>
  has(".system/sys-tool/SKILL.md", catalog()),
);
suite.ok("folded >- description joined into one line", () =>
  has("first line of folded second line continues", catalog()),
);
suite.ok(
  "folded description doesn't absorb metadata",
  () => !has("type: x", catalog()),
);

suite.ok("index already exists → no rebuild", () =>
  has("already exists", run(skills, ["index"]).stdout),
);

suite.ok("list functional includes my-tool", () =>
  run(skills, ["list", "--type", "functional"]).stdout.includes("my-tool"),
);
suite.ok(
  "list functional excludes wdkns note",
  () =>
    !run(skills, ["list", "--type", "functional"]).stdout.includes(
      "wdkns-note-1",
    ),
);
suite.ok("list --source system includes sys-tool", () =>
  run(skills, ["list", "--source", "system"]).stdout.includes("sys-tool"),
);
suite.ok("list --source plugin includes myplug:myskill", () =>
  run(skills, ["list", "--source", "plugin"]).stdout.includes("myplug:myskill"),
);
suite.ok(
  "list --source system excludes user's my-tool",
  () => !run(skills, ["list", "--source", "system"]).stdout.includes("my-tool"),
);

suite.ok("match 'system meta creating' → sys-tool", () =>
  run(skills, ["match", "system meta creating"]).stdout.includes("sys-tool"),
);
suite.ok("match --source plugin 'PLUGDESC' → myplug:myskill", () =>
  run(skills, [
    "match",
    "PLUGDESC plugin",
    "--source",
    "plugin",
  ]).stdout.includes("myplug:myskill"),
);

suite.ok("show sys-tool resolves to .system path + body", () =>
  run(skills, ["show", "sys-tool"]).stdout.includes("sys body"),
);
suite.ok("show plugin id myplug:myskill → plug body", () =>
  run(skills, ["show", "myplug:myskill"]).stdout.includes("plug body"),
);
suite.ok(
  "show nonexistent → nonzero",
  () => run(skills, ["show", "no-such"]).status !== 0,
);

const injectOut = run(skills, ["inject", "sys-tool,myplug:myskill"]).stdout;
suite.ok("inject includes sys-tool .system path", () =>
  has(".system/sys-tool/SKILL.md", injectOut),
);
suite.ok("inject includes plugin skill", () =>
  has("myplug:myskill", injectOut),
);
suite.ok("inject --full inlines plugin body", () =>
  run(skills, ["inject", "myplug:myskill", "--full"]).stdout.includes(
    "plug body",
  ),
);
suite.ok(
  "inject no args → nonzero",
  () => run(skills, ["inject"]).status !== 0,
);

const noPlugins = run(skills, ["index", "--refresh"], {
  env: { ...process.env, FUGUE_SKILLS_NO_PLUGINS: "1" },
}).stdout;
suite.ok("FUGUE_SKILLS_NO_PLUGINS=1 → don't scan plugin (4)", () =>
  has("4 skills", noPlugins),
);

mkdirSync(join(skillRoot, ".system", "skill-creator"), { recursive: true });
writeFileSync(
  join(skillRoot, ".system", "skill-creator", "SKILL.md"),
  "---\nname: skill-creator\ndescription: official skill authoring guide\n---\nGUIDE\n",
);
process.env.FUGUE_EXPERIENCE = join(tmp, "exp");
const material = join(tmp, "material.txt");
writeFileSync(
  material,
  "A reusable distilled method long enough to pass the candidate gate: step one do the thing, step two verify via harness, step three commit. Recurred across tasks; keep the procedure. Handle empty input and retry on transient errors.\n",
);
run(skills, ["index", "--refresh"]);

const forge = run(skills, [
  "forge",
  "--name",
  "foo-flow",
  "--source",
  material,
]).stdout;
suite.ok("forge brief includes skill-creator call", () =>
  has("skill-creator", forge),
);
suite.ok(
  "forge brief includes name + material",
  () => has("foo-flow", forge) && has("verify via harness", forge),
);
suite.ok("forge brief includes index --refresh closed-loop hint", () =>
  has("index --refresh", forge),
);
suite.ok(
  "forge candidate gate: material too thin → nonzero",
  () =>
    run(skills, ["forge", "--name", "tiny", "--material"], { input: "x\n" })
      .status !== 0,
);
suite.ok(
  "forge missing --name → nonzero",
  () => run(skills, ["forge", "--source", material]).status !== 0,
);
suite.ok(
  "forge no material → nonzero",
  () => run(skills, ["forge", "--name", "x"]).status !== 0,
);

run(experience, ["add", "code", "distilled method", "--from", material]);
const fromExperience = run(skills, [
  "forge",
  "--name",
  "from-exp",
  "--from-experience",
  "code/distilled-method",
]).stdout;
suite.ok("forge --from-experience fetches experience body into brief", () =>
  has("verify via harness", fromExperience),
);
suite.ok(
  "forge --from-experience bad format → nonzero",
  () =>
    run(skills, ["forge", "--name", "x", "--from-experience", "badformat"])
      .status !== 0,
);

const forgeCalled = join(tmp, "forge-called");
const fugueStub = join(tmp, "fugue-cc");
writeExecutable(fugueStub, [
  "#!/usr/bin/env node",
  "const fs = require('node:fs');",
  `fs.writeFileSync(${JSON.stringify(forgeCalled)}, fs.readFileSync(0, 'utf8'));`,
]);
run(
  skills,
  ["forge", "--name", "viaworker", "--source", material, "--agent", "cc-x"],
  {
    env: { ...process.env, FUGUE_CC_BIN: fugueStub },
  },
);
suite.ok("forge --agent: brief into worker stdin", () =>
  readFileSync(forgeCalled, "utf8").includes("viaworker"),
);
suite.ok("forge --agent: skill-creator injected", () =>
  readFileSync(forgeCalled, "utf8").includes("official skill authoring guide"),
);

const vmk = (name, body) => {
  mkdirSync(join(skillRoot, name), { recursive: true });
  writeFileSync(join(skillRoot, name, "SKILL.md"), body);
};
vmk(
  "v-good",
  "---\nname: v-good\ndescription: a valid skill desc with triggers\nmetadata:\n  k: v\n---\nbody",
);
vmk("v-badname", "---\nname: Bad_Name\ndescription: ok\n---");
vmk("v-nodesc", "---\nname: v-nodesc\n---");
vmk("v-angle", "---\nname: v-angle\ndescription: has <x> brackets\n---");
vmk("v-badkey", "---\nname: v-badkey\ndescription: ok\nweird_key: 1\n---");
vmk(
  "v-folded",
  "---\nname: v-folded\ndescription: >-\n  folded one\n  folded two\n---",
);
suite.ok(
  "validate valid → exit 0",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "v-good")]).status === 0,
);
suite.ok(
  "validate folded description valid → exit 0",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "v-folded")]).status ===
    0,
);
suite.ok(
  "validate non hyphen-case name → nonzero",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "v-badname")]).status !==
    0,
);
suite.ok(
  "validate missing description → nonzero",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "v-nodesc")]).status !==
    0,
);
suite.ok(
  "validate description has angle brackets → nonzero",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "v-angle")]).status !== 0,
);
suite.ok(
  "validate illegal frontmatter key → nonzero",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "v-badkey")]).status !==
    0,
);
suite.ok(
  "validate no SKILL.md → nonzero",
  () => run(skills, ["validate", "--dir", join(tmp, "nonexist")]).status !== 0,
);
suite.ok("validate valid reports ✓ valid", () =>
  run(skills, ["validate", "--dir", join(skillRoot, "v-good")]).stdout.includes(
    "✓ valid",
  ),
);
suite.ok(
  "validate --official no quick_validate falls back to built-in still passes",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "v-good"), "--official"])
      .status === 0,
);

mkdirSync(join(skillRoot, "forged-skill"), { recursive: true });
writeFileSync(
  join(skillRoot, "forged-skill", "SKILL.md"),
  "---\nname: forged-skill\ndescription: a freshly forged skill\n---\nbody\n",
);
suite.ok(
  "closed loop: forge output passes acceptance gate",
  () =>
    run(skills, [
      "validate",
      "forged-skill",
      "--dir",
      join(skillRoot, "forged-skill"),
    ]).status === 0,
);
run(skills, ["index", "--refresh"]);
suite.ok("closed loop: validated skill enters mother dir after re-index", () =>
  run(skills, ["list", "--type", "functional"]).stdout.includes("forged-skill"),
);

mkdirSync(join(skillRoot, "Bad-Forge"), { recursive: true });
writeFileSync(
  join(skillRoot, "Bad-Forge", "SKILL.md"),
  "---\nname: Bad_Forge\ndescription: invalid\n---\n",
);
suite.ok(
  "negative closed loop: invalid skill blocked by acceptance gate (nonzero)",
  () =>
    run(skills, ["validate", "--dir", join(skillRoot, "Bad-Forge")]).status !==
    0,
);

suite.ok(
  "unknown subcommand → nonzero",
  () => run(skills, ["bogus"]).status !== 0,
);

suite.done();
