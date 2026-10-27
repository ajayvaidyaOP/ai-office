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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
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
}

main()
  .catch((error) => fail('Unexpected error', error.message))
  .finally(() => {
    server.kill('SIGTERM');
    setTimeout(() => server.kill('SIGKILL'), 800);

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
