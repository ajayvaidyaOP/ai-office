/**
 * Console smoke test (v2.3.2).
 *
 * This exists because v2.3.1 shipped a broken public/app.js: 1,277 lines were
 * deleted by a bad patch, ten render functions disappeared, and five screens
 * went blank — while `node --check` passed and all 38 self-checks stayed green.
 * A syntax check cannot see a missing function; only executing the render path
 * can. So: boot a throwaway office, load the real app.js into a DOM stand-in,
 * and assert every view actually writes HTML.
 *
 * Run: npm run test:ui
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 3199;
const base = `http://localhost:${PORT}`;

const server = spawn('node', ['server.js'], {
  cwd: root,
  env: { ...process.env, PORT: String(PORT), DATA_DIR: path.join(root, '.ui-smoke-data'), SCHEDULER: 'off' },
  stdio: 'ignore',
});

const waitForServer = async () => {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${base}/healthz`);
      if (res.ok) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

test('every console view renders real HTML', async () => {
  const up = await waitForServer();
  assert.ok(up, 'throwaway office did not start');
  const state = await (await fetch(`${base}/api/state`)).json();
const html = fs.readFileSync(path.join(root, 'public/index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'public/app.js'), 'utf8');
const ids = [...html.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]);

const written = new Map();
class El {
  constructor(id = '') { this.id = id; this._html = ''; this.textContent = ''; this.value = ''; this.dataset = {}; this.hidden = true; this.style = {}; this.title = '';
    this.classList = { add(){}, remove(){}, toggle(){}, contains(){ return false; } };
    this.children = []; this.scrollTop = 0; this.scrollHeight = 0; this.clientHeight = 0; this.offsetWidth = 0; }
  get innerHTML() { return this._html; }
  set innerHTML(v) { this._html = v; if (v) written.set(this.id, String(v).length); }
  addEventListener() {} appendChild(c) { this.children.push(c); return c; }
  querySelector() { return new El(); } querySelectorAll() { return []; }
  closest() { return null; } scrollIntoView() {} remove() {} setAttribute() {} getAttribute() { return null; }
}
const registry = new Map(ids.map((id) => [id, new El(id)]));
globalThis.window = globalThis;
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.document = {
  documentElement: new El('html'),
  querySelector: (sel) => {
    // " #engine-pill .pulse " → resolve the container, hand back a stub child
    const root = sel.startsWith('#') ? registry.get(sel.slice(1).split(/[\s>]/)[0]) : null;
    if (!root) return null;
    return sel.includes(' ') ? new El('child') : root;
  },
  querySelectorAll: () => [], addEventListener() {}, createElement: () => new El(),
  getElementById: (id) => registry.get(id) || null, title: '', hidden: false, activeElement: null,
};
const kv = new Map();
globalThis.localStorage = { getItem: (k) => kv.get(k) ?? null, setItem: (k, v) => kv.set(k, v), removeItem: (k) => kv.delete(k) };
globalThis.location = { reload() {} };
globalThis.EventSource = class { addEventListener() {} close() {} };
globalThis.fetch = async (url) => ({ ok: true, status: 200, json: async () => (String(url).includes('/api/state') ? state : {}) });
globalThis.requestAnimationFrame = (fn) => fn();
globalThis.setInterval = () => 0;
globalThis.matchMedia = () => ({ matches: false, addEventListener() {} });
globalThis.FormData = class { get() { return ''; } };

vm.runInThisContext(app, { filename: 'public/app.js' });

// The app boots async. Give the microtasks a tick, then drive every view.
await new Promise((r) => setTimeout(r, 400));

/**
 * The app is a classic script, so its functions are script-scoped. We append one
 * line that exports them for the test — the file under test is unchanged.
 */
const probe = loadProbe(app);

const views = ['dashboard', 'console', 'approvals', 'work', 'team', 'clients', 'finder', 'calendar', 'reports', 'audit', 'setup'];

for (const view of views) {
  assert.doesNotThrow(() => probe.setView(view), `${view} threw while rendering`);
}

// Each of these is the main container of one screen. If a render function is
// missing (the v2.3.1 bug) the element stays empty.
const required = {
  dashboard: ['mission-list', 'kpi-grid', 'funnel', 'score-legend'],
  approvals: ['approval-list'],
  work: ['task-list'],
  team: ['team-grid'],
  clients: ['client-kanban'],
  finder: ['lead-stages'],
  calendar: ['agenda'],
  reports: ['report-daily'],
  audit: ['audit-list'],
  setup: ['deploy-list'],
};

for (const [view, targets] of Object.entries(required)) {
  for (const id of targets) {
    const size = written.get(id) || 0;
    assert.ok(size > 0, `${view}: #${id} stayed empty — its render function may be missing`);
  }
}

test.after(() => {
  server.kill('SIGTERM');
  // A failed assertion must not leave a listener behind, which is exactly what
  // happened the first time this test was written.
  setTimeout(() => server.kill('SIGKILL'), 500).unref?.();
  fs.rmSync(path.join(root, '.ui-smoke-data'), { recursive: true, force: true });
});

process.on('exit', () => {
  try {
    server.kill('SIGKILL');
  } catch {
    /* already gone */
  }
});

/**
 * Run the app with a probe appended so the test can call its internals.
 * Kept in memory: nothing is written to disk.
 */
function loadProbe(source) {
  // A fresh context per run: the app declares top-level consts ($, ui, PAGES…)
  // which would collide if the file were evaluated twice in this process.
  const probeSource = `${source}\nglobalThis.__probe = { renderAll, setView, showFinderPane, togglePageHelp, ui };`;
  const context = vm.createContext(globalThis);
  vm.runInContext(probeSource, context, { filename: 'public/app.js' });
  return context.__probe ?? globalThis.__probe;
}
});
