/* ═══════════════════════════════════════════════════════════════
   UNIT TESTS — node --test, zero dependencies.

   These test the rules that must never break:
   - an audit may only report what it saw
   - the lead score rewards a broken web presence, not a tidy row
   - revision feedback can never end up inside a client message
   - nothing in the follow-up engine claims a message was sent
   ═══════════════════════════════════════════════════════════════ */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/* Use a throwaway data dir so tests never touch the real office db. */
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'invincible-test-'));
process.env.DATA_DIR = tmpDir;
process.env.SCHEDULER = 'off';
process.env.SEED_DEMO = 'false';

const { auditWebsite, summarise, normaliseUrl, isSocialUrl } = await import('../src/agents/auditor.js');
const { scoreLead, offlineOutreach, extractIds } = await import('../src/agents/offline.js');

/* ── helpers ──────────────────────────────────────────────── */

const fixture = (name) => fs.readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

async function withFixtureServer(files, run) {
  const http = await import('node:http');
  const server = http.createServer((req, res) => {
    const body = files[req.url];
    if (body === undefined) {
      res.writeHead(404, { 'content-type': 'text/html' });
      return res.end('not found');
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end(body);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

/* ── auditor: honesty rules ───────────────────────────────── */

test('a clean page produces no invented findings', async () => {
  await withFixtureServer({ '/good': fixture('good.html') }, async (base) => {
    const result = await auditWebsite(`${base}/good`);
    assert.equal(result.reachable, true);
    const keys = result.findings.map((f) => f.key);
    assert.ok(!keys.includes('no-viewport'), 'viewport exists in the fixture');
    assert.ok(!keys.includes('placeholder-text'), 'no lorem ipsum in the fixture');
    assert.ok(!keys.includes('wrong-currency'), 'no dollar prices in the fixture');
    assert.ok(!keys.includes('no-contact-path'), 'tel and WhatsApp links exist');
    // http-only is a real defect of this fixture and should be reported.
    assert.ok(keys.includes('no-https'));
  });
});

test('a broken page reports each defect with evidence', async () => {
  await withFixtureServer({ '/broken': fixture('broken.html') }, async (base) => {
    const result = await auditWebsite(`${base}/broken`);
    const keys = result.findings.map((f) => f.key);
    for (const expected of [
      'no-viewport',
      'placeholder-text',
      'wrong-currency',
      'hotlinked-assets',
      'bad-tel-link',
    ]) {
      assert.ok(keys.includes(expected), `expected ${expected} in ${keys.join(',')}`);
    }
    assert.equal(result.severity, 'high');
    for (const finding of result.findings) {
      assert.ok(finding.title, 'every finding needs a title');
      assert.ok(finding.evidence, `every finding needs evidence (${finding.key})`);
    }
  });
});

test('one broken thing outranks several small ones', () => {
  assert.equal(summarise([]), 'none');
  assert.equal(summarise([{ severity: 'low' }, { severity: 'medium' }]), 'medium');
  assert.equal(summarise([{ severity: 'low' }, { severity: 'high' }]), 'high');
});

test('a page that does not exist is reported as an error, not as "no viewport"', async () => {
  await withFixtureServer({}, async (base) => {
    const result = await auditWebsite(`${base}/missing`);
    const keys = result.findings.map((f) => f.key);
    assert.ok(keys.includes('http-error'));
    assert.ok(!keys.includes('no-viewport'), 'do not inspect HTML that never loaded');
  });
});

test('a lead with no website gets the strongest-angle finding', async () => {
  const result = await auditWebsite('');
  assert.equal(result.severity, 'high');
  assert.equal(result.findings[0].key, 'no-website');
  assert.equal(result.checks.fetched, false);
});

test('url normalisation refuses nonsense', () => {
  assert.equal(normaliseUrl(''), '');
  assert.equal(normaliseUrl('not a url'), '');
  assert.equal(normaliseUrl('example.com'), 'https://example.com/');
  assert.ok(isSocialUrl('https://instagram.com/some_bakery'));
  assert.ok(!isSocialUrl('https://somebakery.in'));
});

/* ── scoring: the rule the whole offer depends on ─────────── */

test('a broken site scores higher than a perfect one', () => {
  const base = {
    sourceUrl: 'https://example.com/listing',
    niche: 'dentist',
    location: 'Pune',
    fitReason: 'found on a public directory with a real phone number',
    reviewStatus: 'Needs human verification',
    stage: 'New',
    phone: '+919876543210',
  };
  // Both audits must be REAL (page actually read) for the comparison to be fair.
  const broken = scoreLead({
    ...base,
    website: 'https://clinic.in',
    audit: { severity: 'high', reachable: true, checks: { fetched: true }, findings: [{}] },
  });
  const fine = scoreLead({
    ...base,
    website: 'https://clinic.in',
    audit: { severity: 'none', reachable: true, checks: { fetched: true }, findings: [] },
  });
  const none = scoreLead({ ...base, website: '', audit: null });
  assert.ok(broken.score > fine.score, 'broken must beat fine');
  assert.ok(none.score > fine.score, 'no website at all must beat a working one');
});

test('a reachable phone raises the score, a dead lead caps it', () => {
  const withPhone = scoreLead({ sourceUrl: 'https://x.com/a', phone: '+919876543210', website: '', niche: 'cafe', location: 'Pune' });
  const noPhone = scoreLead({ sourceUrl: 'https://x.com/a', phone: '', website: '', niche: 'cafe', location: 'Pune' });
  assert.ok(withPhone.score > noPhone.score);

  const lost = scoreLead({ sourceUrl: 'https://x.com/a', stage: 'Lost', audit: { severity: 'high', findings: [{}] } });
  assert.ok(lost.score <= 20, 'lost leads must not look attractive');
});

test('score stays inside 4..98', () => {
  for (const lead of [{}, { audit: { severity: 'high', findings: [{}] }, phone: '+919876543210', sourceUrl: 'https://a.b' }]) {
    const { score } = scoreLead(lead);
    assert.ok(score >= 4 && score <= 98, `got ${score}`);
  }
});

/* ── writing: feedback must never become message text ────── */

test('outreach uses the first audit finding and stays under 90 words', () => {
  const message = offlineOutreach({
    businessName: 'Posh Paws',
    website: 'https://poshpaws.in',
    findings: [
      { title: 'booking page shows a placeholder price for every service' },
      { title: 'the summary step says "Invalid date"' },
    ],
  });
  assert.match(message, /Posh Paws/);
  assert.match(message, /booking page shows a placeholder price/);
  assert.match(message, /\?$/);
  assert.ok(message.split(/\s+/).length <= 90);
  assert.ok(!/\$|₹|price is|costs INR/i.test(message), 'no price in the first message');
});

test('revision feedback is an instruction, never body text', () => {
  const feedback = 'Revision feedback to apply: make it shorter and mention the menu.';
  const message = offlineOutreach({
    businessName: 'Zyka Tales',
    website: 'https://zykatales.com',
    findings: [{ title: 'menu prices are in dollars' }],
    feedback,
  });
  assert.ok(!message.includes('Revision feedback to apply'), 'feedback must not leak into the message');
  assert.ok(!message.includes('make it shorter and mention the menu'), 'feedback text must not leak');
  assert.ok(message.split(/\s+/).length <= 90);
});

test('with no audit, the message asks instead of asserting a defect', () => {
  const message = offlineOutreach({ businessName: 'Adaa Fashions', website: '' });
  assert.match(message, /could not find/i);
  assert.ok(!/broken|error|invalid/i.test(message), 'never invent a defect');
});

test('id extraction ignores unrelated numbers', () => {
  assert.deepEqual(extractIds('L-0007', 'lead'), ['L-0007']);
  assert.deepEqual(extractIds('please check l-0012 and L-0012', 'lead'), ['L-0012']);
  assert.deepEqual(extractIds('no ids here', 'lead'), []);
});

/* ── credibility: an audit that never reached the page must not score ── */

test('an unreachable audit does not inflate the score', () => {
  const base = {
    sourceUrl: 'https://example.com/listing',
    phone: '+919876543210',
    niche: 'dentist',
    location: 'Pune',
    fitReason: 'found on a public directory with a real phone number',
    website: 'https://clinic.in',
    stage: 'New',
    reviewStatus: 'Needs human verification',
  };
  // What a network failure looks like: severity high, but the page never opened.
  const unreachable = scoreLead({
    ...base,
    audit: { severity: 'high', reachable: false, checks: { fetched: false }, findings: [{}, {}] },
  });
  // The same lead with no audit at all should score the same, not lower.
  const noAudit = scoreLead({ ...base, audit: null });

  assert.equal(unreachable.score, noAudit.score, 'a failed fetch must not change the ranking');
  assert.ok(
    unreachable.reasons.some((r) => /could not reach the page/.test(r)),
    'and the reason must say so out loud',
  );
});

test('a real audit still moves the score', () => {
  const base = {
    sourceUrl: 'https://example.com/listing',
    phone: '+919876543210',
    niche: 'dentist',
    location: 'Pune',
    website: 'https://clinic.in',
    stage: 'New',
  };
  const real = scoreLead({
    ...base,
    audit: { severity: 'high', reachable: true, checks: { fetched: true }, findings: [{}] },
  });
  const none = scoreLead({ ...base, audit: null });
  assert.ok(real.score > none.score, 'a page we actually read should rank higher');
});

/* ── evidence harvester: verbatim quotes or nothing ───────── */

const { harvestEvidence, evidenceLine } = await import('../src/agents/auditor.js');

test('harvested evidence is verbatim from the page', async () => {
  await withFixtureServer({ '/broken': fixture('broken.html') }, async (base) => {
    const evidence = await harvestEvidence(`${base}/broken`);
    assert.equal(evidence.ok, true);
    assert.ok(evidence.quotes.length >= 4, `expected several quotes, got ${evidence.quotes.length}`);
    const all = evidence.quotes.map((q) => q.quote).join(' ');
    assert.match(all, /Lorem ipsum/i, 'must quote the real placeholder text');
    assert.match(all, /\$25\.50|Signature cake/i, 'must quote the real dollar price');
    assert.match(all, /tel:\+18003568933/i, 'must quote the real tel: href');
    for (const quote of evidence.quotes) {
      assert.ok(quote.label && quote.quote, 'every quote needs a label and text');
    }
  });
});

test('no evidence is invented when the page cannot be read', async () => {
  await withFixtureServer({}, async (base) => {
    const evidence = await harvestEvidence(`${base}/gone`);
    assert.equal(evidence.ok, false);
    assert.deepEqual(evidence.quotes, []);
    assert.ok(evidence.reason, 'and it must say why');
    assert.equal(evidenceLine(evidence), '', 'no one-liner without proof');
  });
});
