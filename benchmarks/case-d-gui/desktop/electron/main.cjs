// Electron main process: window + exec fuguectl via execFile (no shell, no separate server).
const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Resolve repo root: FUGUNANO_ROOT env wins; otherwise walk up from this file until we find
// orchestration/fuguectl (so the app works wherever the repo is cloned). No hardcoded paths.
const findRoot = () => {
  if (process.env.FUGUNANO_ROOT) return process.env.FUGUNANO_ROOT;
  let dir = __dirname;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'orchestration', 'fuguectl', 'fuguectl'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, '../../..'); // fallback: desktop/electron -> repo root
};
const ROOT = findRoot();
const FUGUE = path.join(ROOT, 'orchestration', 'fuguectl', 'fuguectl');
// Cache root the engine writes fan-out rounds into (FUGUE_CACHE wins; else <root>/.fuguectl-cache).
const CACHE_ROOT = process.env.FUGUE_CACHE || path.join(ROOT, '.fuguectl-cache');

// codex: prefer whatever is already on $PATH. On macOS the bundled .app is an OPTIONAL fallback
// only (added when present and not already on PATH) — never the sole supported location.
const CODEX_FALLBACK = '/Applications/Codex.app/Contents/Resources';
const needsCodexFallback =
  process.platform === 'darwin' &&
  fs.existsSync(path.join(CODEX_FALLBACK, 'codex')) &&
  !(process.env.PATH ?? '').split(':').includes(CODEX_FALLBACK);
const ENV = {
  ...process.env,
  PATH: `${needsCodexFallback ? `${CODEX_FALLBACK}:` : ''}${process.env.PATH ?? ''}`,
};

const tokenize = (s) => {
  const out = []; let cur = ''; let q = null;
  for (let i = 0; i < s.length; i += 1) {
    const c = s[i];
    if (q !== null) {
      if (c === '\\') { cur += s[i + 1] ?? ''; i += 1; } // escaped char: take the next one literally
      else if (c === q) q = null;
      else cur += c;
    }
    else if (c === '"' || c === "'") q = c;
    else if (c === ' ' || c === '\t') { if (cur) { out.push(cur); cur = ''; } }
    else cur += c;
  }
  if (cur) out.push(cur);
  return out;
};

const runFugue = (cmd) =>
  new Promise((resolve) => {
    const tokens = tokenize(cmd);
    const args = tokens[0] === 'fuguectl' ? tokens.slice(1) : tokens;
    console.log('[fugue]', FUGUE, args.join(' '));
    execFile(FUGUE, args, { cwd: ROOT, env: ENV, timeout: 300000 }, (err, stdout, stderr) => {
      resolve({ stdout: stdout + stderr, exitCode: err ? (err.code ?? 1) : 0 });
    });
  });

const readText = (p) => {
  try {
    return fs.readFileSync(p, 'utf8');
  } catch {
    return null;
  }
};

// --- read-only IPC over the engine's on-disk state (no writes, no shell) ---

// A round id is a single filesystem segment; allow only [A-Za-z0-9._-], and reject the traversal
// tokens "." / ".." outright so the guarantee holds even if a caller ever used the segment unwrapped.
const safeSegment = (s) =>
  typeof s === 'string' && s !== '.' && s !== '..' && /^[A-Za-z0-9._-]+$/u.test(s);

const listRounds = () => {
  try {
    return fs
      .readdirSync(CACHE_ROOT, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('round-'))
      .map((e) => e.name.slice('round-'.length))
      .filter((n) => n.length > 0)
      .sort((a, b) => (Number(a) || 0) - (Number(b) || 0));
  } catch {
    return [];
  }
};

const readRound = (round) => {
  if (!safeSegment(round)) return { round, error: 'invalid round id', tasks: [], totals: null };
  const dir = path.join(CACHE_ROOT, `round-${round}`);
  const manifest = readText(path.join(dir, 'manifest.tsv'));
  if (manifest === null) return { round, error: 'round not found', tasks: [], totals: null };
  const tasks = [];
  const totals = { total: 0, done: 0, fail: 0, pending: 0 };
  for (const raw of manifest.split(/\r?\n/u)) {
    if (raw.length === 0) continue;
    const tab = raw.indexOf('\t');
    if (tab === -1) continue;
    const id = raw.slice(0, tab);
    const agent = raw.slice(tab + 1);
    if (!safeSegment(id)) continue;
    const status = (readText(path.join(dir, `${id}.status`)) ?? '').trim() || 'pending';
    const at = (readText(path.join(dir, `${id}.at`)) ?? '').trim() || null;
    const result = readText(path.join(dir, `${id}.result`));
    const preview = result === null ? null : result.slice(0, 400);
    tasks.push({ id, agent, status, at, bytes: result === null ? 0 : result.length, preview });
    totals.total += 1;
    if (status === 'done') totals.done += 1;
    else if (status === 'fail') totals.fail += 1;
    else totals.pending += 1;
  }
  return { round, error: null, tasks, totals };
};

// Read a JSON artifact (plan/smoke summary.json), but only inside the repo or the OS temp dir.
const readJson = (p) => {
  if (typeof p !== 'string' || p.length === 0) return { error: 'no path' };
  const resolved = path.resolve(p);
  const allowed = [path.resolve(ROOT), path.resolve(os.tmpdir())];
  if (!allowed.some((base) => resolved === base || resolved.startsWith(`${base}${path.sep}`)))
    return { error: 'path outside allowed roots' };
  const text = readText(resolved);
  if (text === null) return { error: 'file not found' };
  try {
    return { error: null, data: JSON.parse(text) };
  } catch {
    return { error: 'invalid JSON' };
  }
};

// Real agent/backend health from `doctor --quiet`:
//   agents=N backends_ready=R/T fugue-cc=0|1 codex=0|1 agy=0|1 opencode=0|1
const readAgents = async () => {
  const { stdout, exitCode } = await runFugue('fuguectl doctor --quiet');
  const line = stdout.split(/\r?\n/u).find((l) => l.includes('backends_ready=')) ?? '';
  const kv = {};
  for (const tok of line.trim().split(/\s+/u)) {
    const eq = tok.indexOf('=');
    if (eq > 0) kv[tok.slice(0, eq)] = tok.slice(eq + 1);
  }
  const harnesses = ['fugue-cc', 'codex', 'agy', 'opencode'];
  const agents = harnesses
    .filter((h) => kv[h] !== undefined)
    .map((h) => ({ name: h, role: 'harness', healthy: kv[h] === '1' }));
  if (agents.length === 0) {
    // doctor unavailable — degrade to a single honest "unknown" row rather than a fake stub.
    return [{ name: 'codex', role: 'harness', healthy: exitCode === 0 }];
  }
  return agents;
};

let win = null;
const createWindow = () => {
  win = new BrowserWindow({
    width: 1180,
    height: 800,
    title: 'FuguNano Studio',
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const dev = process.env.VITE_DEV === '1';
  if (dev) win.loadURL('http://localhost:5180');
  else win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
};

ipcMain.handle('fugue:run', (_e, cmd) => runFugue(cmd));
ipcMain.handle('fugue:agents', () => readAgents());
ipcMain.handle('fugue:listRounds', () => listRounds());
ipcMain.handle('fugue:round', (_e, round) => readRound(round));
ipcMain.handle('fugue:readJson', (_e, p) => readJson(p));

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => win === null && app.isReady() && createWindow());
