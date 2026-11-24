#!/usr/bin/env node
/**
 * Deployment self-check — Chapter 22 of the guide, automated.
 *
 * Starts a throwaway instance of the office on a random port with an empty
 * database, then walks the full Invincible flow:
 *   health → /task → /draft → approval gate → /approve → /report
 *   → /brief → /find → /lead → /verify → /promote → /proposal → clients → export
 *
 * Run: npm run check
 * Exit code 0 means every gate behaved as designed.
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import http from 'node:http';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * A tiny stand-in for Nominatim + Overpass so the live-search assertions can
 * run on a machine with no internet. The shapes match the real services.
 */
async function startMockUpstream() {
  const mock = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (body) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (url.pathname === '/search') {
      return send([
        {
          lat: '18.5204',
          lon: '73.8567',
          display_name: 'Pune, Maharashtra, India',
          boundingbox: ['18.4126', '18.6288', '73.7383', '73.9660'],
        },
      ]);
    }
    if (url.pathname === '/api/interpreter') {
      let raw = '';
      req.on('data', (chunk) => (raw += chunk));
      return req.on('end', () =>
        send({
          elements: [
            {
              type: 'node',
              id: 9001,
              lat: 18.53,
              lon: 73.84,
              tags: {
                amenity: 'cafe',
                name: 'Check Cafe',
                'addr:street': 'FC Road',
                'addr:city': 'Pune',
                website: 'https://check-cafe.example',
                phone: '+91 20 1111 2222',
              },
            },
            {
              type: 'node',
              id: 9002,
              lat: 18.52,
              lon: 73.85,
              tags: {
                amenity: 'cafe',
                name: 'Check Diner',
                'addr:street': 'MG Road',
                'addr:city': 'Pune',
                phone: '+91 20 3333 4444',
              },
            },
            {
              type: 'node',
              id: 9003,
              lat: 18.51,
              lon: 73.86,
              tags: { amenity: 'cafe', 'addr:city': 'Pune' }, // unnamed → must be dropped
            },
          ],
        }),
      );
    }
    res.writeHead(404);
    res.end('{}');
  });
  await new Promise((resolve) => mock.listen(0, '127.0.0.1', resolve));
  return { port: mock.address().port, close: () => mock.close() };
}

const mockUpstream = await startMockUpstream();
const port = 3400 + Math.floor(Math.random() * 200);
const dataDir = path.join(root, '.check-data');

fs.rmSync(dataDir, { recursive: true, force: true });

const results = [];
const pass = (label, extra = '') => results.push({ ok: true, label, extra });
const fail = (label, extra = '') => results.push({ ok: false, label, extra });

const server = spawn(process.execPath, ['server.js'], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    DATA_DIR: dataDir,
    SEED_DEMO: 'false',
    AI_PROVIDER: 'offline',
    TELEGRAM_MODE: 'off',
    TELEGRAM_BOT_TOKEN: '',
    NOMINATIM_URL: `http://127.0.0.1:${mockUpstream.port}`,
    OVERPASS_URL: `http://127.0.0.1:${mockUpstream.port}/api/interpreter`,
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

let serverLog = '';
server.stdout.on('data', (chunk) => {
  serverLog += chunk;
});
server.stderr.on('data', (chunk) => {
  serverLog += chunk;
});

const base = `http://127.0.0.1:${port}`;

async function waitForServer(timeoutMs = 12_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(`${base}/healthz`);
      if (response.ok) return true;
    } catch {
      /* not ready yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

async function command(raw) {
  const response = await fetch(`${base}/api/command`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw }),
  });
  if (!response.ok) throw new Error(`command failed: ${response.status}`);
  return response.json();
}

async function main() {
  if (!(await waitForServer())) {
    console.error('Server did not start.\n', serverLog);
    process.exit(1);
  }
  pass('Server boots and /healthz responds');

  const state = await (await fetch(`${base}/api/state`)).json();
  if (Array.isArray(state.tasks) && Array.isArray(state.drafts) && state.provider) {
    pass('State endpoint returns the office shape', `provider=${state.provider.configured}`);
  } else {
    fail('State endpoint shape is wrong');
  }

  const task = await command('/task Plan a beginner-friendly Instagram Reel about free AI tools for small businesses');
  const taskIds = [...task.reply.matchAll(/T-\d{4}/g)].map((match) => match[0]);
  taskIds.length ? pass('AI Manager creates tasks', taskIds.join(', ')) : fail('AI Manager created no tasks', task.reply.slice(0, 120));

  const draft = await command('/draft Write a friendly Instagram caption for that Reel');
  const draftId = (draft.reply.match(/D-\d{4}/) || [])[0];
  if (draftId && /Awaiting approval/.test(draft.reply)) {
    pass('Draft is created and gated', draftId);
  } else {
    fail('Draft was not gated', draft.reply.slice(0, 160));
  }

  const approve = await command(`/approve ${draftId}`);
  if (/approved/i.test(approve.reply) && /manually|never posts|publish it yourself/i.test(approve.reply)) {
    pass('Approval records the decision without publishing');
  } else {
    fail('Approval reply did not confirm a manual publish', approve.reply.slice(0, 160));
  }

  const revise = await command('/draft Make a LinkedIn post about client follow-ups');
  const reviseId = (revise.reply.match(/D-\d{4}/) || [])[0];
  const revised = await command(`/revise ${reviseId} Make it shorter`);
  const newId = (revised.reply.match(/D-\d{4}/g) || []).pop();
  if (newId && newId !== reviseId && /Awaiting approval/.test(revised.reply)) {
    pass('Revision creates a new gated version', `${reviseId} → ${newId}`);
  } else {
    fail('Revision flow did not produce a new gated draft');
  }

  const report = await command('/report');
  /DAILY OFFICE REPORT/.test(report.reply) ? pass('Daily report is generated') : fail('Daily report failed');

  const leadRefused = await command('/lead design agencies in Pune');
  /No lead rows were created/.test(leadRefused.reply)
    ? pass('Lead agent refuses without a public source URL')
    : fail('Lead agent accepted a request without a source URL');

  const lead = await command('/lead design agencies | Pune | https://example.com/directory | Example Studio — no visible content plan');
  const leadId = (lead.reply.match(/L-\d{4}/) || [])[0];
  leadId && /Needs human verification/.test(lead.reply)
    ? pass('Lead rows carry source URL + verification flag', leadId)
    : fail('Lead row missing verification flag');

  if (leadId) {
    const verify = await command(`/verify ${leadId}`);
    /Verified by human/.test(verify.reply) ? pass('Human verification is recorded') : fail('Verify command failed');
    const outreach = await command(`/outreach ${leadId}`);
    /APPROVAL NEEDED/.test(outreach.reply) && /Outreach/i.test(outreach.reply)
      ? pass('Outreach becomes a gated draft (never auto-sent)')
      : fail('Outreach was not gated', outreach.reply.slice(0, 140));
  }

  /* ── Invincible modules ─────────────────────────────────── */
  const brief = await command('/brief');
  /INVINCIBLE BRIEF/i.test(brief.reply) && brief.reply.includes('Focus:')
    ? pass('Morning brief is generated from stored data')
    : fail('Morning brief missing', brief.reply.slice(0, 120));

  const find = await command('/find cafés in Pune');
  /CLIENT FINDER PLAN/i.test(find.reply) && (find.reply.match(/^\s+\d+\./gm) || []).length >= 4
    ? pass('Client Finder returns a research plan')
    : fail('Client Finder plan looks wrong', find.reply.slice(0, 140));

  const sourcing = await fetch(`${base}/api/source`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ niche: 'cafes', location: 'Pune', limit: 10 }),
  }).then((res) => res.json());

  sourcing.engine && sourcing.count === 2 && sourcing.results[0].sourceUrl.startsWith('http')
    ? pass('Live search returns real rows with source URLs', `${sourcing.engine} · ${sourcing.count}`)
    : fail('Live search failed', JSON.stringify(sourcing).slice(0, 140));

  sourcing.results?.every((row) => row.businessName)
    ? pass('Rows without a business name are dropped')
    : fail('Unnamed listing slipped through');

  sourcing.results?.[0]?.businessName === 'Check Diner' &&
  sourcing.results[0].score > sourcing.results[1].score
    ? pass('A reachable no-website business outranks a website-only one', `${sourcing.results[0].score} > ${sourcing.results[1].score}`)
    : fail('Prospect scoring order wrong', JSON.stringify(sourcing.results?.map((r) => [r.businessName, r.score])));

  const imported = await fetch(`${base}/api/source/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ niche: 'cafes', location: 'Pune', businesses: sourcing.results || [] }),
  }).then((res) => res.json());

  imported.imported === 2 && imported.leads?.[0]?.reviewStatus === 'Needs human verification'
    ? pass('Imported leads still need human verification')
    : fail('Import did not gate the row', JSON.stringify(imported).slice(0, 140));

  const reimport = await fetch(`${base}/api/source/import`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ niche: 'cafes', location: 'Pune', businesses: sourcing.results || [] }),
  }).then((res) => res.json());

  reimport.imported === 0 && reimport.skipped?.length === 2
    ? pass('Re-importing the same business is refused', reimport.skipped[0].reason)
    : fail('Duplicate guard did not fire');

  const promote = await command(`/promote ${leadId}`);
  const clientId = (promote.reply.match(/C-\d{4}/) || [])[0];
  clientId ? pass('Lead promotes into a client record', clientId) : fail('Promotion failed', promote.reply.slice(0, 140));

  if (clientId) {
    const stage = await command(`/stage ${clientId} Negotiation`);
    /Negotiation/.test(stage.reply) ? pass('Client stage moves through the pipeline') : fail('Stage change failed');

    const proposal = await command(`/proposal ${clientId}`);
    const proposalId = (proposal.reply.match(/D-\d{4}/) || [])[0];
    proposalId && /APPROVAL NEEDED/.test(proposal.reply) && /Proposal/i.test(proposal.reply)
      ? pass('Proposal is created as a gated draft', proposalId)
      : fail('Proposal was not gated', proposal.reply.slice(0, 160));
  }

  const clientRow = await fetch(`${base}/api/clients`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ company: 'Check Co', contact: 'Asha', niche: 'retail', stage: 'Won', value: 60000 }),
  }).then((res) => res.json());
  clientRow.ok && clientRow.client?.stage === 'Won'
    ? pass('Clients API creates a won deal (pipeline maths)')
    : fail('Client API failed', JSON.stringify(clientRow).slice(0, 120));

  const stateInvincible = await (await fetch(`${base}/api/state`)).json();
  stateInvincible.brand?.name === 'AI Invincible Office'
    ? pass('Brand is AI Invincible Office')
    : fail('Brand name is wrong', stateInvincible.brand?.name || 'missing');

  const dash = stateInvincible.dashboard;
  dash?.overview?.pipeline?.wonValue > 0 && Array.isArray(dash?.mission)
    ? pass('Dashboard metrics compute pipeline + mission', `won ₹${dash.overview.pipeline.wonValue}`)
    : fail('Dashboard metrics missing');

  dash?.agents?.length ? pass('Agent health is tracked', `${dash.agents.length} agents`) : fail('No agent runs recorded');

  const clientsCsv = await fetch(`${base}/api/export/clients`).then((res) => res.text());
  clientsCsv.startsWith('Client ID,')
    ? pass('Clients CSV export matches the sheet headers')
    : fail('Clients CSV header wrong');

  const csv = await fetch(`${base}/api/export/tasks`);
  const csvText = await csv.text();
  csv.headers.get('content-type')?.includes('text/csv') && csvText.startsWith('Task ID,')
    ? pass('Sheets CSV export matches the Chapter 14 columns')
    : fail('CSV export headers are wrong');

  const stateAfter = await (await fetch(`${base}/api/state`)).json();
  stateAfter.audit?.length >= 5 ? pass('Audit trail is being written', `${stateAfter.audit.length} events`) : fail('Audit trail is empty');
  stateAfter.provider?.callsToday === 0
    ? pass('Offline engine made zero model calls')
    : fail('Offline engine unexpectedly called a model');

  const index = await fetch(`${base}/`);
  const html = await index.text();
  html.includes('AI Invincible Office') && index.ok ? pass('Console page is served') : fail('Console page missing');

  /* ── v2.3: live state, the team view, and honest agent accounting ── */

  const team = stateAfter.team;
  team?.rows?.length === 8 && team.summary
    ? pass('Every agent reports what it is doing and holding', `${team.summary.activeToday}/${team.summary.total} active today`)
    : fail('Team view payload missing');

  const unused = (team?.rows || []).filter((row) => row.runs === 0);
  unused.every((row) => row.okRate === null)
    ? pass('An unused agent reports no success rate, not a fake 100%')
    : fail('Unused agents are reporting a success rate');

  // Open the live stream, trigger a write, and prove the push arrives.
  const streamed = await readLiveStream(`${base}/api/stream`, async () => {
    await command('/task Prove the live stream works');
  });
  streamed.sawHello && streamed.sawState
    ? pass('Live stream pushes state after a write', `${streamed.events} events`)
    : fail('Live stream did not push state', JSON.stringify(streamed));

  html.includes('id="live-pill"') && html.includes('data-view="team"') && html.includes('id="btn-help"')
    ? pass('Console ships the live pill, the team view and page help')
    : fail('Console is missing the v2.3 affordances');

  /* ── v2.3.1: keep the console from getting cluttered again ── */

  // No page may open with more than three panels on screen; extra detail is
  // allowed only inside a collapsed <details> block.
  const dense = pages(html).filter((page) => page.visiblePanels > 3);
  dense.length === 0
    ? pass('No page opens with more than three panels')
    : fail('Too many panels on first paint', dense.map((page) => `${page.view}:${page.visiblePanels}`).join(' '));

  pages(html).every((page) => page.foldedPanels >= 0 && page.buttons <= 8)
    ? pass('No page shows more than eight buttons at once')
    : fail('A page is showing more than eight buttons', pages(html).map((page) => `${page.view}:${page.buttons}`).join(' '));

  const navCount = (html.match(/class="nav-item/g) || []).length;
  navCount <= 12
    ? pass('Sidebar stays at a readable size', `${navCount} items in 4 groups`)
    : fail('Sidebar grew again', `${navCount} items`);

  // The old dashboard repeated approvals, follow-ups and agents in three boxes.
  const duplicatePanels = ['approval-mini', 'agent-grid', 'dash-followup-list'].filter((id) => html.includes(`id="${id}"`));
  duplicatePanels.length === 0
    ? pass('The dashboard no longer repeats the same data in three boxes')
    : fail('Duplicate dashboard panels came back', duplicatePanels.join(', '));
}

/** Per-page density, ignoring anything the user has to open first. */
function pages(html) {
  const out = [];
  const sectionRe = /<section class="view[^"]*" data-view="([a-z]+)">/g;
  const starts = [];
  let match;
  while ((match = sectionRe.exec(html))) starts.push({ view: match[1], start: match.index + match[0].length });
  const count = (text, pattern) => (text.match(pattern) || []).length;
  starts.forEach((entry, index) => {
    const body = html.slice(entry.start, starts[index + 1]?.start ?? html.length);
    const visible = body.replace(/<details[\s\S]*?<\/details>/g, '');

    // Tabbed pages (Client Finder) show one pane at a time, so the honest number
    // is the busiest single pane — not the sum of all four.
    const panes = visible.split(/<div class="finder-grid finder-pane/).slice(1);
    const panePanels = panes.length ? Math.max(...panes.map((pane) => count(pane, /class="card panel/g))) : null;

    out.push({
      view: entry.view,
      visiblePanels: panePanels ?? count(visible, /class="card panel/g),
      foldedPanels: count(body, /class="card panel/g) - count(visible, /class="card panel/g),
      buttons: panes.length ? Math.max(...panes.map((pane) => count(pane, /<button/g))) : count(visible, /<button/g),
    });
  });
  return out;
}

/**
 * Read a few SSE frames while a write happens, then hang up.
 * Resolves with what it saw so the caller can assert on it.
 */
async function readLiveStream(url, trigger) {
  const controller = new AbortController();
  const response = await fetch(url, { signal: controller.signal });
  const seen = { sawHello: false, sawState: false, events: 0 };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const readLoop = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        seen.events += 1;
        const text = decoder.decode(value, { stream: true });
        if (text.includes('event: hello')) seen.sawHello = true;
        if (text.includes('event: state')) seen.sawState = true;
        if (seen.sawState) break;
      }
    } catch {
      /* aborted on purpose */
    }
  })();

  await new Promise((resolve) => setTimeout(resolve, 150));
  await trigger();
  const timeout = new Promise((resolve) => setTimeout(resolve, 4000));
  await Promise.race([readLoop, timeout]);
  controller.abort();
  return seen;
}

main()
  .catch((error) => fail('Unexpected error', error.message))
  .finally(() => {
    server.kill('SIGTERM');
    setTimeout(() => server.kill('SIGKILL'), 800);
    mockUpstream.close();

    const width = Math.max(...results.map((row) => row.label.length)) + 2;
    console.log('\n  AI Invincible Office — deployment self-check\n');
    for (const row of results) {
      console.log(`  ${row.ok ? '✅' : '❌'}  ${row.label.padEnd(width)}${row.extra ? `  ${row.extra}` : ''}`);
    }
    const failed = results.filter((row) => !row.ok).length;
    console.log(`\n  ${results.length - failed}/${results.length} checks passed.\n`);

    fs.rmSync(dataDir, { recursive: true, force: true });
    setTimeout(() => process.exit(failed === 0 ? 0 : 1), 200);
  });
