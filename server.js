import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, secretStatus, BRAND } from './src/config.js';
import { store, seedDemoData, todayKey } from './src/store.js';
import { dashboard, missionToday, overview } from './src/metrics.js';
import * as office from './src/office.js';
import { AGENT_CATALOG } from './src/agents/prompts.js';
import { testProvider } from './src/agents/index.js';
import { providerStatus } from './src/agents/provider.js';
import { sourcingStatus } from './src/agents/sourcing.js';
import { TABS, tabCsv } from './src/sheets.js';
import { handleTelegramUpdate, startTelegramPolling, telegramStatus } from './src/channels/telegram.js';
import { startScheduler, schedulerStatus, runMorningRoutine } from './src/scheduler.js';

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
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const SECURITY_HEADERS = {
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
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

function authorised(req) {
  const code = config.access.code;
  if (!code) return true;
  const given = String(req.headers['x-office-code'] || '');
  const a = Buffer.from(given);
  const b = Buffer.from(code);
  // Constant-time compare so the code cannot be guessed by timing.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export const statePayload = () => {
  const db = store.snapshot();
  return {
    brand: BRAND,
    meta: {
      version: config.version,
      today: todayKey(),
      timezone: config.timezone,
      settings: db.meta.settings,
      lastReportAt: db.meta.lastReportAt,
      lastBriefAt: db.meta.lastBriefAt,
      lastBrief: db.meta.lastBrief || null,
      lastProviderTest: db.meta.lastProviderTest,
      seeded: db.meta.seeded,
      brand: BRAND,
    },
    counters: db.counters,
    tasks: db.tasks.slice().reverse(),
    drafts: db.drafts.slice().reverse(),
    leads: db.leads.slice().reverse(),
    clients: (db.clients || []).slice().reverse(),
    dailyLog: db.dailyLog.slice().reverse(),
    runs: (db.runs || []).slice(0, 120),
    messages: db.messages.slice(-120),
    audit: db.audit.slice(0, 200),
    usage: db.usage.slice(-14),
    dashboard: dashboard(db),
    provider: providerStatus(),
    telegram: telegramStatus(),
    secrets: secretStatus(),
    followups: office.followUpQueue(),
    scheduler: schedulerStatus(),
    commands: office.COMMANDS,
    agents: AGENT_CATALOG,
    tabs: Object.keys(TABS),
  };
};

const ok = (res, extra = {}) => sendJson(res, 200, { ok: true, ...extra, state: statePayload() });

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
    filePath = path.join(config.publicDir, 'index.html');
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

/** Wrap an action so every route returns {ok, …data, state} or a clean 400. */
const action = (fn) => async (req, res, body, params = {}) => {
  try {
    const data = await fn(body, params);
    return ok(res, data);
  } catch (error) {
    return sendJson(res, 400, { ok: false, error: error.message });
  }
};

async function route(req, res, url) {
  const { pathname, searchParams } = url;
  const method = req.method;

  if (pathname === '/healthz') {
    return sendJson(res, 200, { ok: true, name: BRAND.name, version: config.version, time: new Date().toISOString() });
  }

  if (pathname === '/api/webhook/telegram' && method === 'POST') {
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

  if (pathname === '/api/auth' && method === 'GET') {
    return sendJson(res, 200, { ok: true, required: Boolean(config.access.code) });
  }

  if (pathname === '/api/auth/login' && method === 'POST') {
    const body = await readBody(req);
    const given = String(body.code || '');
    const expected = config.access.code;
    const matched =
      Boolean(expected) &&
      Buffer.byteLength(given) === Buffer.byteLength(expected) &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
    if (!matched) {
      store.audit('auth.failed', { detail: 'wrong access code', level: 'warn' });
      return sendJson(res, 401, { ok: false, error: 'That access code is not right.' });
    }
    store.audit('auth.ok', { detail: 'console unlocked' });
    return sendJson(res, 200, { ok: true });
  }

  if (pathname.startsWith('/api/') && !authorised(req)) {
    return sendJson(res, 401, { ok: false, error: 'Add the x-office-code header', authRequired: true });
  }

  if (pathname === '/api/state' && method === 'GET') return sendJson(res, 200, statePayload());
  if (pathname === '/api/source/status' && method === 'GET') return sendJson(res, 200, sourcingStatus());

  if (pathname === '/api/docs' && method === 'GET') return sendJson(res, 200, { docs: listDocs() });

  const docMatch = pathname.match(/^\/api\/docs\/([a-z0-9._-]+)$/i);
  if (docMatch && method === 'GET') {
    const file = docMatch[1].endsWith('.md') ? docMatch[1] : `${docMatch[1]}.md`;
    const filePath = path.join(config.root, 'docs', path.basename(file));
    if (!fs.existsSync(filePath)) return sendJson(res, 404, { ok: false, error: 'Doc not found' });
    return sendJson(res, 200, { ok: true, file, markdown: fs.readFileSync(filePath, 'utf8') });
  }

  /* ── Command console ─────────────────────────────────────── */
  if (pathname === '/api/command' && method === 'POST') {
    return action(async (body) => {
      const raw = String(body.raw || '').slice(0, 4000);
      const result = await office.handleCommand({ raw, actor: body.actor || 'owner', channel: 'web' });
      return result;
    })(req, res, await readBody(req));
  }

  /* ── Tasks ───────────────────────────────────────────────── */
  if (pathname === '/api/tasks' && method === 'POST') {
    return action(async (body) => office.createTasks(body.request, body.actor || 'owner'))(req, res, await readBody(req));
  }
  const taskMatch = pathname.match(/^\/api\/tasks\/(T-\d{4})(?:\/(status))?$/i);
  if (taskMatch) {
    const id = taskMatch[1].toUpperCase();
    if (method === 'DELETE') {
      return action(async () => office.deleteTask(id))(req, res, {});
    }
    if (method === 'POST' && taskMatch[2]) {
      return action(async (body) => office.updateTaskStatus(id, body.status || 'Done', body.reason || ''))(
        req,
        res,
        await readBody(req),
      );
    }
  }

  /* ── Drafts and approvals ────────────────────────────────── */
  if (pathname === '/api/drafts' && method === 'POST') {
    return action(async (body) => office.createDraft(body, body.actor || 'owner'))(req, res, await readBody(req));
  }
  const decisionMatch = pathname.match(/^\/api\/drafts\/(D-\d{4})\/decision$/i);
  if (decisionMatch && method === 'POST') {
    const id = decisionMatch[1].toUpperCase();
    return action(async (body) =>
      office.decideDraft({ id, decision: body.decision, feedback: body.feedback || '' }, body.actor || 'owner'),
    )(req, res, await readBody(req));
  }

  /* ── Leads / client finder ───────────────────────────────── */
  if (pathname === '/api/leads' && method === 'POST') {
    return action(async (body) =>
      office.addLeads(
        { niche: body.niche, location: body.location, sourceUrl: body.sourceUrl, notes: body.notes },
        body.actor || 'owner',
      ),
    )(req, res, await readBody(req));
  }
  const leadMatch = pathname.match(/^\/api\/leads\/(L-\d{4})(?:\/(verify|stage|promote|followup))?$/i);
  if (leadMatch) {
    const id = leadMatch[1].toUpperCase();
    const verb = leadMatch[2];
    if (verb === 'verify' && method === 'POST') {
      return action(async () => office.verifyLead(id))(req, res, {});
    }
    if (verb === 'promote' && method === 'POST') {
      return action(async () => office.promoteLead(id))(req, res, {});
    }
    if (verb === 'stage' && method === 'POST') {
      return action(async (body) => office.setLeadStage(id, body.stage))(req, res, await readBody(req));
    }
    if (verb === 'followup' && method === 'POST') {
      return action(async (body) => office.setFollowUp({ kind: 'lead', id, date: body.date }))(
        req,
        res,
        await readBody(req),
      );
    }
  }
  if (pathname === '/api/source' && method === 'POST') {
    return action(async (body) =>
      office.runSource(
        {
          niche: body.niche,
          location: body.location,
          limit: body.limit,
          provider: body.provider,
        },
        body.actor || 'owner',
      ),
    )(req, res, await readBody(req));
  }

  if (pathname === '/api/source/import' && method === 'POST') {
    return action(async (body) =>
      office.importLeads(
        {
          niche: body.niche,
          location: body.location,
          businesses: body.businesses,
          notes: body.notes,
        },
        body.actor || 'owner',
      ),
    )(req, res, await readBody(req));
  }

  if (pathname === '/api/find' && method === 'POST') {
    return action(async (body) => office.createFindPlan({ niche: body.niche, location: body.location, notes: body.notes }))(
      req,
      res,
      await readBody(req),
    );
  }

  /* ── Website auditor ─────────────────────────────────────── */
  if (pathname === '/api/audit' && method === 'POST') {
    return action(async (body) =>
      body.id
        ? office.auditOneLead(body.id, body.actor || 'owner')
        : office.auditLeads({ ids: body.ids || [], limit: body.limit, onlyUnverified: body.onlyUnverified }, body.actor || 'owner'),
    )(req, res, await readBody(req));
  }

  /* ── Scheduler ───────────────────────────────────────────── */
  if (pathname === '/api/scheduler/run' && method === 'POST') {
    return action(async () => runMorningRoutine({ reason: 'manual' }))(req, res, {});
  }

  /* ── Follow-ups ──────────────────────────────────────────── */
  if (pathname === '/api/followups' && method === 'GET') {
    return sendJson(res, 200, { ok: true, queue: office.followUpQueue() });
  }
  if (pathname === '/api/followups/sent' && method === 'POST') {
    return action(async (body) => office.markFollowUpSent(body, body.actor || 'owner'))(req, res, await readBody(req));
  }
  if (pathname === '/api/leads/sent' && method === 'POST') {
    return action(async (body) => office.markLeadSent(body, body.actor || 'owner'))(req, res, await readBody(req));
  }

  /* ── Clients ─────────────────────────────────────────────── */
  if (pathname === '/api/clients' && method === 'POST') {
    return action(async (body) => office.addClient(body, body.actor || 'owner'))(req, res, await readBody(req));
  }
  const clientMatch = pathname.match(/^\/api\/clients\/(C-\d{4})(?:\/(stage|notes|proposal|followup))?$/i);
  if (clientMatch) {
    const id = clientMatch[1].toUpperCase();
    const verb = clientMatch[2];
    if (verb === 'stage' && method === 'POST') {
      return action(async (body) => office.setClientStage(id, body.stage))(req, res, await readBody(req));
    }
    if (verb === 'notes' && method === 'POST') {
      return action(async (body) => office.upsertClientNotes(id, body.notes))(req, res, await readBody(req));
    }
    if (verb === 'proposal' && method === 'POST') {
      return action(async () => office.createProposal(id))(req, res, {});
    }
    if (verb === 'followup' && method === 'POST') {
      return action(async (body) => office.setFollowUp({ kind: 'client', id, date: body.date }))(
        req,
        res,
        await readBody(req),
      );
    }
  }

  /* ── Agents: brief, report, finder ───────────────────────── */
  if (pathname === '/api/brief' && method === 'POST') {
    return action(async () => office.createBrief())(req, res, {});
  }
  if (pathname === '/api/report' && method === 'POST') {
    return action(async () => office.generateReport())(req, res, {});
  }
  if (pathname === '/api/mission' && method === 'GET') {
    return sendJson(res, 200, { ok: true, mission: missionToday(store.db), overview: overview(store.db) });
  }

  /* ── Settings, provider, data ────────────────────────────── */
  if (pathname === '/api/settings' && method === 'POST') {
    try {
      const body = await readBody(req);
      const settings = store.updateSettings({
        provider: ['auto', 'ollama', 'gemini', 'offline'].includes(body.provider) ? body.provider : undefined,
        ollamaUrl: typeof body.ollamaUrl === 'string' ? body.ollamaUrl.trim().slice(0, 200) : undefined,
        ollamaModel: typeof body.ollamaModel === 'string' ? body.ollamaModel.trim().slice(0, 80) : undefined,
        geminiModel: typeof body.geminiModel === 'string' ? body.geminiModel.trim().slice(0, 80) : undefined,
        maxCallsPerDay: Number(body.maxCallsPerDay) > 0 ? Math.min(Number(body.maxCallsPerDay), 5000) : undefined,
        companyName: typeof body.companyName === 'string' ? body.companyName.trim().slice(0, 80) : undefined,
        ownerName: typeof body.ownerName === 'string' ? body.ownerName.trim().slice(0, 60) : undefined,
        monthlyTarget: Number(body.monthlyTarget) >= 0 ? Number(body.monthlyTarget) : undefined,
      });
      store.audit('settings.updated', { actor: 'owner', detail: JSON.stringify(settings) });
      return ok(res, { settings });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  if (pathname === '/api/provider/test' && method === 'POST') {
    const result = await testProvider();
    store.audit('provider.tested', {
      detail: result.ok ? `${result.provider} ok` : result.error || 'failed',
      level: result.ok ? 'info' : 'warn',
    });
    return ok(res, { ...result, provider: providerStatus() });
  }

  if (pathname === '/api/reset' && method === 'POST') {
    try {
      const body = await readBody(req);
      /*
       * Two explicit intents, never an accident:
       *   { confirm: 'DELETE EVERYTHING' }  → empty office
       *   { confirm: 'DELETE EVERYTHING', seed: true } → reset + demo data
       * A stray click or an empty body used to wipe every lead silently.
       */
      if (body.confirm !== 'DELETE EVERYTHING') {
        return sendJson(res, 400, {
          ok: false,
          error: "Refused: send { \"confirm\": \"DELETE EVERYTHING\" } to wipe the office.",
          counts: {
            leads: store.db.leads.length,
            clients: (store.db.clients || []).length,
            tasks: store.db.tasks.length,
            drafts: store.db.drafts.length,
          },
        });
      }
      const before = {
        leads: store.db.leads.length,
        clients: (store.db.clients || []).length,
      };
      store.reset({ seed: Boolean(body.seed) });
      store.audit('office.reset', {
        detail: `${before.leads} lead(s), ${before.clients} client(s) deleted · ${body.seed ? 'demo data seeded' : 'started empty'}`,
        level: 'warn',
      });
      return ok(res, { deleted: before });
    } catch (error) {
      return sendJson(res, 400, { ok: false, error: error.message });
    }
  }

  /* ── Exports ─────────────────────────────────────────────── */
  if (pathname === '/api/export/all' && method === 'GET') {
    const payload = {};
    for (const tab of Object.keys(TABS)) payload[tab] = tabCsv(tab);
    return sendJson(res, 200, { ok: true, generatedAt: new Date().toISOString(), tabs: payload });
  }

  const exportMatch = pathname.match(/^\/api\/export\/(tasks|drafts|leads|clients|daily-log)$/i);
  if (exportMatch && method === 'GET') {
    const key = exportMatch[1].toLowerCase();
    const tab = key === 'daily-log' ? 'Daily Log' : key.charAt(0).toUpperCase() + key.slice(1);
    if (searchParams.get('format') === 'json') return sendJson(res, 200, { tab, rows: tabCsv(tab).split('\n') });
    const body = tabCsv(tab);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${tab.replace(/\s+/g, '-').toLowerCase()}.csv"`,
      'cache-control': 'no-store',
    });
    return res.end(body);
  }

  if (pathname.startsWith('/api/')) return sendJson(res, 404, { ok: false, error: 'Unknown API route' });
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

if (config.seedDemo && !store.db.meta.seeded) seedDemoData(store);

server.listen(config.port, config.host, () => {
  const base = `http://localhost:${config.port}`;
  console.log(`\n  🛡️  ${BRAND.name} ${config.version}`);
  console.log(`  ➜ Console:  ${base}`);
  console.log(`  ➜ Health:   ${base}/healthz`);
  console.log(`  ➜ Provider: ${providerStatus().configured} (offline rules always available)`);
  const polling = startTelegramPolling();
  if (polling.started) console.log('  ➜ Telegram: polling for commands');
  const scheduler = startScheduler();
  console.log(
    scheduler.started
      ? `  ➜ Scheduler: daily brief + follow-ups at ${String(config.scheduler.hour).padStart(2, '0')}:${String(config.scheduler.minute).padStart(2, '0')} ${config.timezone}`
      : `  ➜ Scheduler: off (${scheduler.reason})`,
  );
  console.log('');
});

const shutdown = () => {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
