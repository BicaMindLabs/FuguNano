#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createSuite, here, makeTempDir, run } from "./fuguectl-testlib.mjs";

const suite = createSuite("fuguectl-preflight");
const preflight = join(here, "fuguectl-preflight");
const tmp = makeTempDir();
const calls = join(tmp, "preflight-calls.txt");

process.env.FUGUE_ENGINE_CLI = join(tmp, "fugue-engine");
process.env.FUGUE_PREFLIGHT_CALLS = calls;

writeFileSync(
  process.env.FUGUE_ENGINE_CLI,
  [
    "const fs = require('node:fs');",
    "const path = require('node:path');",
    "const args = process.argv.slice(2);",
    "fs.appendFileSync(process.env.FUGUE_PREFLIGHT_CALLS, args.join(' ') + '\\n');",
    "const opt = (name, fallback = '') => {",
    "  const index = args.indexOf(name);",
    "  return index === -1 ? fallback : args[index + 1] || fallback;",
    "};",
    "const positional = args.filter((arg, index) => {",
    "  if (arg.startsWith('--')) return false;",
    "  const prev = args[index - 1] || '';",
    "  return !prev.startsWith('--') || prev === '--config-only' || prev === '--probe';",
    "});",
    "const root = positional[0];",
    "const cfg = positional[1] || '';",
    "if (root !== 'preflight') {",
    "  console.error('expected preflight');",
    "  process.exit(2);",
    "}",
    "let failed = false;",
    "let warned = false;",
    "const lines = ['parallel dispatch preflight'];",
    "const ok = (message) => lines.push('  ok ' + message);",
    "const warn = (message) => { warned = true; lines.push('  warn ' + message); };",
    "const fail = (message) => { failed = true; lines.push('  fail ' + message); };",
    "if (cfg && fs.existsSync(cfg)) {",
    "  const text = fs.readFileSync(cfg, 'utf8');",
    "  if (/^[^#]*(model|url)\\s*=.*(gemini|antigravity)/imu.test(text)) {",
    "    fail('provider config model/url contains gemini/antigravity - violates the no-Gemini hard rule');",
    "  } else ok('no-Gemini guard passed');",
    "  const modelCount = text.split(/\\r?\\n/u).filter((line) => /^\\s*model\\s*=/u.test(line)).length;",
    "  if (modelCount > 0) ok('provider config: ' + modelCount + ' agent(s) configured a model');",
    "  else warn('provider config has no model line?');",
    "  if (/^\\s*model\\s*=\\s*\"?\"?\\s*$/imu.test(text)) fail('provider config has an empty model value');",
    "} else {",
    "  warn('provider config not located - skip config checks (pass a path or set FUGUE_CC_WORK)');",
    "}",
    "const work = opt('--work', process.env.FUGUE_CC_WORK || '');",
    "if (work) {",
    "  const gitignore = path.join(work, '.gitignore');",
    "  if (fs.existsSync(gitignore) && fs.readFileSync(gitignore, 'utf8').includes('.fugue-cc/')) {",
    '    ok(".fugue-cc/ gitignored (integrate won\'t be polluted by worktree)");',
    "  } else {",
    "    warn(\".fugue-cc/ not gitignored - on integrate the main repo git may absorb the worktree(embedded repo); fix: echo '.fugue-cc/' >> \" + work + '/.gitignore');",
    "  }",
    "}",
    "lines.push('', failed ? 'preflight NO-GO  (1 hard failure(s))' : 'preflight GO  (warn=' + (warned ? '1' : '0') + ')');",
    "process.stdout.write(lines.join('\\n') + '\\n');",
    "process.exit(failed ? 1 : 0);",
    "",
  ].join("\n"),
);

const clean = join(tmp, "clean.config");
writeFileSync(
  clean,
  [
    "[agents.cc-deepseek]",
    'url = "https://api.deepseek.com/anthropic"',
    'model = "deepseek-v4-pro"',
    "[agents.coder]",
    'model = "gpt-5.5"',
    "",
  ].join("\n"),
);
suite.ok(
  "clean config → GO(exit 0)",
  () => run(preflight, ["--config-only", clean]).status === 0,
);

const gemini = join(tmp, "gemini.config");
writeFileSync(gemini, '[agents.cc-x]\nmodel = "gemini-3.5-flash"\n');
suite.ok(
  "model=gemini → NO-GO(exit 1)",
  () => run(preflight, ["--config-only", gemini]).status !== 0,
);

const agy = join(tmp, "agy.config");
writeFileSync(
  agy,
  '[agents.cc-y]\nurl = "https://antigravity.google/api"\nmodel = "x"\n',
);
suite.ok(
  "url=antigravity → NO-GO",
  () => run(preflight, ["--config-only", agy]).status !== 0,
);

const comment = join(tmp, "comment.config");
writeFileSync(
  comment,
  '# do not use gemini / antigravity\n[agents.cc-z]\nmodel = "glm-5.2"\n',
);
suite.ok(
  "comment mentioning gemini not false-killed → GO",
  () => run(preflight, ["--config-only", comment]).status === 0,
);

const empty = join(tmp, "empty.config");
writeFileSync(empty, '[agents.cc-w]\nmodel = ""\n');
suite.ok(
  "empty model value → NO-GO",
  () => run(preflight, ["--config-only", empty]).status !== 0,
);

const work = join(tmp, "provider-work");
mkdirSync(work, { recursive: true });
run("git", ["-C", work, "init", "-q"], { stdio: "ignore" });

const oldWork = process.env.FUGUE_CC_WORK;
process.env.FUGUE_CC_WORK = work;
const outIgnored = run(preflight, ["--config-only", clean]).stdout;
suite.ok(".fugue-cc/ not gitignored → warn hint", () =>
  outIgnored.includes("not gitignored"),
);
writeFileSync(join(work, ".gitignore"), ".fugue-cc/\n");
const outOk = run(preflight, ["--config-only", clean]).stdout;
suite.ok(".fugue-cc/ gitignored → ok", () => outOk.includes("gitignored"));
suite.ok(
  ".fugue-cc gitignore check is warn level, does not block GO",
  () => run(preflight, ["--config-only", clean]).status === 0,
);
if (oldWork === undefined) delete process.env.FUGUE_CC_WORK;
else process.env.FUGUE_CC_WORK = oldWork;

suite.ok("shell delegates to engine CLI", () =>
  readFileSync(calls, "utf8").includes("preflight --config-only "),
);

suite.done();
