/**
 * Tests for the "My Team" view (v2.3) and the run-log history repair.
 *
 * The rule these protect: an agent that did the work with the offline engine is
 * NOT a failure. Before v2.3 every provider miss was stored as ok:false, which
 * made a healthy office look broken (finder sat at 0% success).
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { teamWork, teamSummary, repairLegacyRuns } from '../src/team.js';

const catalog = [
  { id: 'content', name: 'Content Creation Agent', responsibility: 'Drafts posts.', humanControl: 'Approves before publishing' },
  { id: 'finder', name: 'Client Finder', responsibility: 'Scores leads.', humanControl: 'Verifies before outreach' },
  { id: 'proposal', name: 'Proposal Agent', responsibility: 'Drafts proposals.', humanControl: 'You send it' },
];

test('an offline fallback counts as work, not as failure', () => {
  const runs = [{ agent: 'content', ts: new Date().toISOString(), ok: true, fallback: true, provider: 'offline', detail: 'offline fallback — no provider' }];
  const [row] = teamWork({ catalog: [catalog[0]], runs });

  assert.equal(row.runs, 1);
  assert.equal(row.okRate, 100, 'the job got done, so the rate must not be dragged down');
  assert.equal(row.lastResult, 'fallback', 'but it must say plainly that local rules answered');
  assert.equal(row.fallbacks, 1);
});

test('a real error still counts against the agent', () => {
  const runs = [{ agent: 'content', ts: new Date().toISOString(), ok: false, provider: 'offline', detail: 'model returned garbage' }];
  const [row] = teamWork({ catalog: [catalog[0]], runs });

  assert.equal(row.okRate, 0);
  assert.equal(row.lastResult, 'failed', 'failures must stay visible');
});

test('an unused agent says so instead of pretending to be healthy', () => {
  const [row] = teamWork({ catalog: [catalog[2]], runs: [] });

  assert.equal(row.runs, 0);
  assert.equal(row.okRate, null, 'no runs means no rate, not 100%');
  assert.equal(row.lastResult, 'never');
  assert.equal(row.idle, 'never run');
  assert.equal(row.provider, '—');
});

test('each agent reports the work it is actually holding', () => {
  const drafts = [
    { id: 'D-0001', status: 'Awaiting approval', platform: 'Instagram', title: 'Reel caption', request: 'x' },
    { id: 'D-0002', status: 'Approved', platform: 'LinkedIn', title: 'Post', request: 'y' },
  ];
  const leads = [
    { businessName: 'Cakecstacy', reviewStatus: 'Verified by human' },
    { businessName: 'Posh Paws', reviewStatus: 'Needs human verification' },
  ];
  const rows = teamWork({ catalog, runs: [], drafts, leads });
  const content = rows.find((row) => row.id === 'content');
  const finder = rows.find((row) => row.id === 'finder');

  assert.ok(content.doing.some((line) => /Reel caption/.test(line)), 'the draft in hand must be named');
  assert.deepEqual(content.waiting, ['1 draft need your approval'], 'and the hold must be on the human');
  assert.equal(finder.finished, 1, 'one lead was verified');
  assert.match(finder.waiting[0], /1 lead waiting for your check/);
});

test('the summary separates "working", "failing" and "never used"', () => {
  const today = new Date().toISOString();
  const rows = teamWork({
    catalog,
    runs: [
      { agent: 'content', ts: today, ok: true, provider: 'offline' },
      { agent: 'finder', ts: today, ok: false, provider: 'offline', detail: 'fetch failed' },
    ],
  });
  const summary = teamSummary(rows);

  assert.equal(summary.total, 3);
  assert.equal(summary.activeToday, 2);
  assert.deepEqual(summary.failing, ['Client Finder']);
  assert.deepEqual(summary.neverRun, ['Proposal Agent']);
});

test('old failure rows are relabelled as fallbacks, never deleted', () => {
  const runs = [
    { agent: 'finder', ok: false, provider: 'offline', detail: 'No AI provider is reachable' },
    { agent: 'finder', ok: false, provider: 'offline', detail: 'the page returned 500' },
  ];
  const touched = repairLegacyRuns(runs);

  assert.equal(touched, 1, 'only the provider miss is a fallback');
  assert.equal(runs.length, 2, 'history is never thrown away');
  assert.equal(runs[0].ok, true);
  assert.equal(runs[0].fallback, true);
  assert.match(runs[0].detail, /offline fallback/);
  assert.equal(runs[1].ok, false, 'a real page error must stay a failure');
});
