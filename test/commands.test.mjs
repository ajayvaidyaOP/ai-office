/**
 * Tests for the v2.3.2 honesty pass.
 *
 * Every one of these started as a real bug found by running the commands by
 * hand on a clean database:
 *   - /lead Cakecstacy | bakery | Pune | URL | notes   saved the name as "Cakecstacy"
 *     only by luck; the generic form saved "Test Biz | cafe" or the niche text.
 *   - /audit on a machine with no network stored a "high severity" finding, which
 *     is a lie about the business — it only proves the fetch failed.
 *   - /stage Contacted changed the stage but never recorded a send date, so the
 *     day-3 follow-up never became due.
 *   - /promote marked the lead Won, which inflated win rate and won value the
 *     moment you created a client record.
 *   - /proposal L-0007 printed usage text instead of the one command that fixes it.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { offlineResearch, scoreLead } from '../src/agents/offline.js';

/* ── /lead parsing ──────────────────────────────────────────── */

test('a business name typed first is kept as the name', () => {
  const [lead] = offlineResearch({
    niche: 'bakery',
    location: 'Pune',
    sourceUrl: 'https://cakecstacy.com',
    notes: 'Cakecstacy — Instagram active, no order page',
  });

  assert.equal(lead.businessName, 'Cakecstacy');
  assert.equal(lead.fitReason, 'Instagram active, no order page');
});

test('a note with no separator is treated as the name, not as a reason', () => {
  const [lead] = offlineResearch({
    niche: 'cafe',
    location: 'Pune',
    sourceUrl: 'https://example.com/directory',
    notes: 'GreenLeaf Café',
  });

  assert.equal(lead.businessName, 'GreenLeaf Café');
  assert.doesNotMatch(lead.fitReason, /^https?:\/\//, 'a raw URL is not a fit reason');
  assert.match(lead.fitReason, /GreenLeaf Café|no content plan/i);
});

test('every generated fit reason is a sentence, never a bare URL', () => {
  const leads = offlineResearch({
    niche: 'salon',
    location: 'Baner',
    sourceUrl: 'https://www.example.com/list',
    notes: 'Hair Mocha\nPosh Paws — no pricing anywhere',
  });

  assert.equal(leads.length, 2);
  for (const lead of leads) {
    assert.ok(lead.fitReason.length > 15, `too short: ${lead.fitReason}`);
    assert.doesNotMatch(lead.fitReason, /^https?:\/\//);
  }
});

/* ── the network failure is not a finding ───────────────────── */

test('an audit that never reached the page contributes nothing to the score', () => {
  const base = {
    businessName: 'Cakecstacy',
    niche: 'bakery',
    location: 'Pune',
    sourceUrl: 'https://cakecstacy.com',
    website: 'https://cakecstacy.com',
    reviewStatus: 'Verified by human',
    stage: 'Verified',
  };

  const noAudit = scoreLead(base);
  const failedFetch = scoreLead({
    ...base,
    audit: { reachable: false, severity: 'high', findings: [{ title: 'site did not open' }], checks: { fetched: false } },
  });

  assert.equal(failedFetch.score, noAudit.score, 'a failed fetch must not move the score');
  assert.ok(
    failedFetch.reasons.some((reason) => /could not reach|not counted/.test(reason)),
    'and it must say why it was ignored',
  );
});

test('a real audit still raises the score', () => {
  const base = {
    businessName: 'Hair Mocha',
    niche: 'salon',
    location: 'Pune',
    sourceUrl: 'https://hairmocha.com',
    website: 'https://hairmocha.com',
    reviewStatus: 'Verified by human',
  };
  const real = scoreLead({
    ...base,
    audit: { reachable: true, severity: 'high', findings: [{ title: 'tel: mismatch' }], checks: { fetched: true } },
  });
  const none = scoreLead(base);

  assert.ok(real.score > none.score, 'evidence of a real problem must rank higher');
});

/* ── follow-up clock ────────────────────────────────────────── */

test('moving a lead to Contacted records the send date', async () => {
  const { setLeadStage, addLeads } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const lead = addLeads({ niche: 'bakery', location: 'Pune', sourceUrl: 'https://cakecstacy.com', notes: 'Cakecstacy — no order page' });
  const created = (await lead).leads[0];
  assert.equal(created.sentAt, undefined, 'a fresh lead has not been sent anything');

  const { lead: moved, stamped } = setLeadStage(created.id, 'Contacted');
  assert.equal(moved.stage, 'Contacted');
  assert.equal(stamped, true, 'the caller must be told the clock started');
  assert.ok(moved.sentAt, 'without this the day-3 follow-up can never become due');

  store.db.leads = store.db.leads.filter((row) => row.id !== created.id);
  store.save();
});

test('promoting a lead does not invent a won deal', async () => {
  const { promoteLead, addLeads } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const before = store.snapshot();
  const wonBefore = before.clients.filter((row) => row.stage === 'Won').length;
  const wonValueBefore = before.clients.filter((row) => row.stage === 'Won').reduce((sum, row) => sum + Number(row.value || 0), 0);

  const created = (await addLeads({ niche: 'bakery', location: 'Pune', sourceUrl: 'https://cakecstacy.com', notes: 'Cakecstacy — no order page' })).leads[0];
  const { client } = promoteLead(created.id, 'tester');

  const after = store.snapshot();
  const wonAfter = after.clients.filter((row) => row.stage === 'Won').length;
  const wonValueAfter = after.clients.filter((row) => row.stage === 'Won').reduce((sum, row) => sum + Number(row.value || 0), 0);

  assert.equal(client.stage, 'Lead', 'a new client record starts as a lead deal');
  assert.equal(wonAfter, wonBefore, 'win count must not move');
  assert.equal(wonValueAfter, wonValueBefore, 'won value must not move');

  // clean up
  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.db.leads = store.db.leads.filter((row) => row.id !== created.id);
  store.save();
});
