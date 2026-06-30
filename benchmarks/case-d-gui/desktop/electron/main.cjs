// Electron main process: window + exec fuguectl via execFile (no shell, no separate server).
const { app, BrowserWindow, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
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

let win = null;
const createWindow = () => {
  win = new BrowserWindow({
    width: 1100,
    height: 760,
    title: 'FuguNano',
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
ipcMain.handle('fugue:agents', () => [
  { name: 'codex (gpt-5.5)', role: 'Implementer / Reviewer', healthy: true },
]);

app.whenReady().then(createWindow);
app.on('window-all-closed', () => process.platform !== 'darwin' && app.quit());
app.on('activate', () => win === null && app.isReady() && createWindow());
