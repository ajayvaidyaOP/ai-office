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

/* ── deal -> delivery: the four hand-offs a real office needs ── */

test('promoting keeps the send history and stops calling it Won or Lost', async () => {
  const { promoteLead, addLeads, markLeadSent, verifyLead } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const created = (await addLeads({ niche: 'bakery', location: 'Pune', sourceUrl: 'https://cakecstacy.com', notes: 'Cakecstacy — no order page' })).leads[0];
  verifyLead(created.id);
  const sentAt = markLeadSent({ id: created.id, channel: 'Instagram DM' }).lead.sentAt;

  const { lead, client } = promoteLead(created.id, 'tester');

  assert.equal(lead.stage, 'Client', 'a handed-over lead is a client, not a lost or won deal');
  assert.equal(client.sentAt, sentAt, 'the fact that you already messaged them must survive promotion');
  assert.ok(!client.proposalSentAt, 'promotion must not claim a proposal was sent');

  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.db.leads = store.db.leads.filter((row) => row.id !== created.id);
  store.save();
});

test('approving a proposal moves the pipeline but does not fake the send', async () => {
  const { decideDraft, createProposal, addClient } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const { client } = addClient({ company: 'Zenith Bakery', niche: 'bakery', stage: 'Lead' }, 'tester');
  const { draft } = await createProposal(client.id, 'tester');
  await decideDraft({ id: draft.id, decision: 'approve', feedback: 'looks good' }, 'tester');

  const after = store.db.clients.find((row) => row.id === client.id);
  assert.equal(after.stage, 'Proposal sent', 'the board must show that a proposal exists');
  assert.ok(!after.proposalSentAt, 'approving is not sending — the human still sends by hand');

  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.db.drafts = store.db.drafts.filter((row) => row.id !== draft.id);
  store.save();
});

test('/sent C-0001 starts the proposal chase that used to never exist', async () => {
  const { markProposalSent, addClient, followUpQueue } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const { client } = addClient({ company: 'Kirti Interiors', niche: 'interior', stage: 'Proposal sent' }, 'tester');
  markProposalSent({ id: client.id, channel: 'Email' }, 'tester');

  const after = store.db.clients.find((row) => row.id === client.id);
  assert.ok(after.proposalSentAt, 'proposalSentAt was read by the queue but never written before this');

  after.proposalSentAt = new Date(Date.now() - 4 * 864e5).toISOString();
  const due = followUpQueue().filter((row) => row.kind === 'client' && row.id === client.id);
  assert.equal(due.length, 1, 'an ignored proposal must become due a follow-up');
  assert.equal(due[0].step, 3);

  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.save();
});

test('work can be billed to a client', async () => {
  const { createTasks, addClient } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const { client } = addClient({ company: 'Cakecstacy', niche: 'bakery' }, 'tester');
  const { tasks } = await createTasks('Write three Reels for the weekend menu', 'tester', client.id);

  assert.ok(tasks.length > 0);
  assert.equal(tasks[0].clientId, client.id, 'a task with no client cannot be billed or costed');
  assert.equal(tasks[0].client, 'Cakecstacy');

  store.db.tasks = store.db.tasks.filter((row) => !tasks.some((task) => task.id === row.id));
  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.save();
});

test('a task cannot be billed to a client that does not exist', async () => {
  const { createTasks } = await import('../src/office.js');
  await assert.rejects(async () => createTasks('Something small', 'tester', 'C-9999'), /C-9999 not found/);
});

/* ── money: the retainer half of the office ─────────────────── */

test('a retainer is due to invoice on day one, not a month later', async () => {
  const { setRetainer, addClient, markInvoiceSent } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const { client } = addClient({ company: 'Skyline Realty', niche: 'realty' }, 'tester');
  setRetainer(client.id, { amount: 15000, cycle: 'monthly' }, 'tester');

  /* these actions return the live row, so read a copy or every assert sees the future */
  const onRetainer = { ...store.db.clients.find((row) => row.id === client.id) };

  assert.equal(onRetainer.stage, 'Won', 'signing a retainer is a won deal');
  assert.equal(onRetainer.recurringAmount, 15000);
  assert.equal(onRetainer.nextInvoiceAt, onRetainer.retainerStartAt, 'the first invoice is due the day the retainer starts');

  markInvoiceSent(client.id, 'tester');
  const after = { ...store.db.clients.find((row) => row.id === client.id) };
  assert.equal(after.invoices.length, 1);
  assert.notEqual(after.nextInvoiceAt, onRetainer.nextInvoiceAt, 'logging an invoice must move the date forward');
  assert.equal(after.proposalSentAt ?? null, null, 'a retainer must not touch the proposal clock');

  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.save();
});

test('month-end retainers do not drift into the wrong month', async () => {
  const { setRetainer, addClient } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const { client } = addClient({ company: 'Month End Ltd' }, 'tester');
  const { client: onRetainer } = setRetainer(client.id, { amount: 5000, cycle: 'monthly', startDate: '2026-01-31' }, 'tester');
  assert.equal(onRetainer.nextInvoiceAt, '2026-01-31');

  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.save();
});

test('a client without a retainer cannot be invoiced', async () => {
  const { markInvoiceSent, addClient } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const { client } = addClient({ company: 'No Retainer Co' }, 'tester');
  // assert.rejects does not catch a synchronous throw, so wrap it
  await assert.rejects(async () => markInvoiceSent(client.id), /not on a retainer/);

  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.save();
});

test('a bad retainer cycle or amount is refused', async () => {
  const { setRetainer, addClient } = await import('../src/office.js');
  const { store } = await import('../src/store.js');

  const { client } = addClient({ company: 'Bad Input Co' }, 'tester');
  await assert.rejects(async () => setRetainer(client.id, { amount: 1000, cycle: 'weekly' }), /Cycle must be one of/);
  await assert.rejects(async () => setRetainer(client.id, { amount: 0, cycle: 'monthly' }), /needs a monthly amount/);

  store.db.clients = store.db.clients.filter((row) => row.id !== client.id);
  store.save();
});
