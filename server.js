import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { config, secretStatus } from './src/config.js';
import { store, seedDemoData, todayKey } from './src/store.js';
import { handleCommand, COMMANDS } from './src/office.js';
import { AGENT_CATALOG } from './src/agents/prompts.js';
import { testProvider } from './src/agents/index.js';
import { providerStatus } from './src/agents/provider.js';
import { TABS, tabCsv } from './src/sheets.js';
import { handleTelegramUpdate, startTelegramPolling, telegramStatus } from './src/channels/telegram.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // The preview host embeds this app in an iframe, so framing must be allowed
  // for same-origin ancestors while scripts stay restricted to this origin.
  'content-security-policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; frame-ancestors 'self' https:; base-uri 'self'; form-action 'self'",
};

const sendJson = (res, status, payload) => {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(body),
  });
  res.end(body);
};

const readBody = (req, limit = 1_000_000) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error('Payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });

/** Optional access code: set OFFICE_ACCESS_CODE to require the x-office-code header. */
function authorised(req) {
  const code = process.env.OFFICE_ACCESS_CODE;
  if (!code) return true;
  return req.headers['x-office-code'] === code;
}

const statePayload = () => {
  const db = store.snapshot();
  return {
    meta: {
      version: config.version,
      today: todayKey(),
      timezone: config.timezone,
      settings: db.meta.settings,
      lastReportAt: db.meta.lastReportAt,
      lastProviderTest: db.meta.lastProviderTest,
      seeded: db.meta.seeded,
    },
    counters: db.counters,
    tasks: db.tasks.slice().reverse(),
    drafts: db.drafts.slice().reverse(),
    leads: db.leads.slice().reverse(),
    dailyLog: db.dailyLog.slice().reverse(),
    messages: db.messages.slice(-120),
    audit: db.audit.slice(0, 200),
    usage: db.usage.slice(-14),
    provider: providerStatus(),
    telegram: telegramStatus(),
    secrets: secretStatus(),
    commands: COMMANDS,
    agents: AGENT_CATALOG,
    tabs: Object.keys(TABS),
  };
};

function listDocs() {
  const dir = path.join(config.root, 'docs');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => ({
      file,
      slug: file.replace(/\.md$/, ''),
      title: (fs.readFileSync(path.join(dir, file), 'utf8').match(/^#\s+(.+)$/m) || [, file.replace(/\.md$/, '')])[1],
    }));
}

function serveStatic(req, res, pathname) {
  const safePath = path.normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
  let filePath = path.join(config.publicDir, safePath === '/' ? 'index.html' : safePath);
  if (!filePath.startsWith(config.publicDir)) {
    res.writeHead(403, SECURITY_HEADERS);
    return res.end('Forbidden');
  }
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(config.publicDir, 'index.html'); // SPA fallback
  }
  const ext = path.extname(filePath).toLowerCase();
  const stream = fs.createReadStream(filePath);
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    'content-type': MIME[ext] || 'application/octet-stream',
    'cache-control': ext === '.html' ? 'no-store' : 'public, max-age=300',
  });
  stream.pipe(res);
  stream.on('error', () => res.end());
}

async function route(req, res, url) {
  const { pathname, searchParams } = url;

  if (pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, version: config.version, time: new Date().toISOString() });
  }

  // Telegram calls this without our access code, so it is checked separately.
  if (pathname === '/api/webhook/telegram' && req.method === 'POST') {
    const secret = config.telegram.webhookSecret;
    if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
      return sendJson(res, 401, { ok: false, error: 'Bad webhook secret' });
    }
    try {
      const update = await readBody(req);
      const result = await handleTelegramUpdate(update);
      return sendJson(res, 200, { ok: true, handled: Boolean(result?.ok) });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (pathname.startsWith('/api/') && !authorised(req)) {
    return sendJson(res, 401, { ok: false, error: 'Add the x-office-code header' });
  }

  if (pathname === '/api/state' && req.method === 'GET') {
    return sendJson(res, 200, statePayload());
  }

  if (pathname === '/api/docs' && req.method === 'GET') {
    return sendJson(res, 200, { docs: listDocs() });
  }

  const docMatch = pathname.match(/^\/api\/docs\/([a-z0-9._-]+)$/i);
  if (docMatch && req.method === 'GET') {
    const file = docMatch[1].endsWith('.md') ? docMatch[1] : `${docMatch[1]}.md`;
    const filePath = path.join(config.root, 'docs', path.basename(file));
    if (!fs.existsSync(filePath)) return sendJson(res, 404, { ok: false, error: 'Doc not found' });
    return sendJson(res, 200, { ok: true, file, markdown: fs.readFileSync(filePath, 'utf8') });
  }

  if (pathname === '/api/command' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const raw = String(body.raw || '').slice(0, 4000);
      const result = await handleCommand({ raw, actor: body.actor || 'owner', channel: 'web' });
      return sendJson(res, 200, { ...result, state: statePayload() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/settings' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      const settings = store.updateSettings({
        provider: ['auto', 'ollama', 'gemini', 'offline'].includes(body.provider) ? body.provider : undefined,
        ollamaUrl: typeof body.ollamaUrl === 'string' ? body.ollamaUrl.trim().slice(0, 200) : undefined,
        ollamaModel: typeof body.ollamaModel === 'string' ? body.ollamaModel.trim().slice(0, 80) : undefined,
        geminiModel: typeof body.geminiModel === 'string' ? body.geminiModel.trim().slice(0, 80) : undefined,
        maxCallsPerDay: Number(body.maxCallsPerDay) > 0 ? Math.min(Number(body.maxCallsPerDay), 5000) : undefined,
      });
      store.audit('settings.updated', { actor: 'owner', detail: JSON.stringify(settings) });
      return sendJson(res, 200, { ok: true, settings, state: statePayload() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/provider/test' && req.method === 'POST') {
    const result = await testProvider();
    store.audit('provider.tested', { detail: result.ok ? `${result.provider} ok` : result.error || 'failed', level: result.ok ? 'info' : 'warn' });
    return sendJson(res, 200, { ...result, provider: providerStatus(), state: statePayload() });
  }

  if (pathname === '/api/reset' && req.method === 'POST') {
    try {
      const body = await readBody(req);
      store.reset({ seed: Boolean(body.seed) });
      store.audit('office.reset', { detail: body.seed ? 'reset + demo data' : 'reset to empty' });
      if (body.seed) seedDemoData(store);
      return sendJson(res, 200, { ok: true, state: statePayload() });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/export/all' && req.method === 'GET') {
    const payload = {};
    for (const tab of Object.keys(TABS)) payload[tab] = tabCsv(tab);
    return sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), tabs: payload });
  }

  const exportMatch = pathname.match(/^\/api\/export\/(tasks|drafts|leads|daily-log|daily%20log)$/i);
  if (exportMatch && req.method === 'GET') {
    const key = decodeURIComponent(exportMatch[1]).toLowerCase();
    const tab = key.startsWith('daily') ? 'Daily Log' : key.charAt(0).toUpperCase() + key.slice(1);
    const json = searchParams.get('format') === 'json';
    if (json) return sendJson(res, 200, { tab, rows: tabCsv(tab).split('\n') });
    const body = tabCsv(tab);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${tab.replace(/\s+/g, '-').toLowerCase()}.csv"`,
      'cache-control': 'no-store',
    });
    return res.end(body);
  }

  if (pathname.startsWith('/api/')) {
    return sendJson(res, 404, { ok: false, error: 'Unknown API route' });
  }

  return serveStatic(req, res, pathname);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  route(req, res, url).catch((error) => {
    console.error('[server]', error);
    if (!res.headersSent) sendJson(res, 500, { ok: false, error: 'Internal error' });
    else res.end();
  });
});

if (config.seedDemo && !store.db.meta.seeded && store.db.tasks.length === 0) {
  seedDemoData(store);
}

server.listen(config.port, config.host, () => {
  const base = `http://localhost:${config.port}`;
  console.log(`\n  🏢 AI Digital Office ${config.version}`);
  console.log(`  ➜ Console:  ${base}`);
  console.log(`  ➜ Health:   ${base}/healthz`);
  console.log(`  ➜ Provider: ${providerStatus().configured} (offline rules always available)`);
  const polling = startTelegramPolling();
  if (polling.started) console.log('  ➜ Telegram: polling for commands');
  console.log('');
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
