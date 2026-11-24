/**
 * Who is doing what — the "my team" view.
 *
 * The office has eight agents, but until v2.3 the UI showed a run count and a
 * success rate. That answers "is it alive", not "what is it doing for me".
 *
 * This module answers the second question using only stored facts:
 *   - what each agent owns right now (tasks, drafts, leads it studied)
 *   - what it finished (approved drafts, done tasks, verified leads)
 *   - what is stuck on the human (awaiting approval, needs verification)
 *   - when it last actually ran, with the provider that answered
 *
 * No invented activity: if an agent has never run, it says "has not run yet".
 */

const DAY = 86_400_000;

const isToday = (iso) => {
  if (!iso) return false;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
};

const ageDays = (iso) => {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / DAY);
};

/** Idle in plain words. Never says "healthy" when it is simply unused. */
const idleLabel = (iso) => {
  const days = ageDays(iso);
  if (days === null) return 'never run';
  if (days === 0) return 'ran today';
  if (days === 1) return 'ran yesterday';
  if (days === 2) return 'ran 2 days ago';
  return `idle ${days} days`;
};

/**
 * Build one row per agent, joining the static catalogue with live records.
 * `catalog` is AGENT_CATALOG, `runs` is db.runs, and the work lists come from db.
 */
export function teamWork({ catalog = [], runs = [], tasks = [], drafts = [], leads = [], clients = [], audit = [] }) {
  const runsByAgent = new Map();
  for (const run of runs) {
    const list = runsByAgent.get(run.agent) || [];
    list.push(run);
    runsByAgent.set(run.agent, list);
  }

  // Fallback: a task or draft records who produced it, so we can still show
  // ownership even when the run log was trimmed.
  const ownedTasks = (agentIds) => tasks.filter((task) => agentIds.includes(task.owner));
  const isDone = (task) => task.status === 'Done';

  const rows = catalog.map((agent) => {
    const mine = runsByAgent.get(agent.id) || [];
    // A run that fell back to local rules still produced the work, so it counts
    // as a success with a note — only real errors count against the agent.
    const okRuns = mine.filter((run) => run.ok);
    const fellBack = mine.filter((run) => run.fallback).length;
    const lastRun = mine[0] || null;
    const today = mine.filter((run) => isToday(run.ts)).length;

    const row = {
      id: agent.id,
      name: agent.name,
      responsibility: agent.responsibility,
      humanControl: agent.humanControl,
      runs: mine.length,
      runsToday: today,
      okRate: mine.length ? Math.round((okRuns.length / mine.length) * 100) : null,
      lastRunAt: lastRun?.ts || null,
      lastResult: lastRun ? (lastRun.ok ? (lastRun.fallback ? 'fallback' : 'ok') : 'failed') : 'never',
      lastDetail: lastRun?.detail || '',
      fallbacks: fellBack,
      provider: lastRun?.provider || '—',
      idle: idleLabel(lastRun?.ts),
      doing: [],
      waiting: [],
      finished: 0,
      blocked: null,
    };

    switch (agent.id) {
      case 'manager': {
        const open = ownedTasks(['You']).filter((task) => !isDone(task));
        row.doing = open.slice(0, 3).map((task) => task.task);
        row.finished = tasks.filter((task) => isDone(task)).length;
        row.waiting = open.length ? [`${open.length} task${open.length === 1 ? '' : 's'} open on your desk`] : [];
        break;
      }
      case 'content': {
        const awaiting = drafts.filter((draft) => draft.status === 'Awaiting approval');
        const mineDrafts = drafts.filter((draft) => draft.status === 'Approved');
        row.doing = awaiting.slice(0, 3).map((draft) => `${draft.platform}: ${draft.title || draft.request}`.slice(0, 70));
        row.finished = mineDrafts.length;
        row.waiting = awaiting.length ? [`${awaiting.length} draft${awaiting.length === 1 ? '' : 's'} need your approval`] : [];
        break;
      }
      case 'research':
      case 'finder': {
        const unverified = leads.filter((lead) => lead.reviewStatus !== 'Verified by human');
        const verified = leads.filter((lead) => lead.reviewStatus === 'Verified by human');
        row.finished = verified.length;
        row.doing = [...verified.slice(0, 2).map((lead) => `verified ${lead.businessName}`), ...(leads.length - verified.length ? [`${unverified.length} lead${unverified.length === 1 ? '' : 's'} found, not yet checked`] : [])].slice(0, 3);
        row.waiting = unverified.length ? [`${unverified.length} lead${unverified.length === 1 ? '' : 's'} waiting for your check`] : [];
        break;
      }
      case 'followup': {
        const sent = leads.filter((lead) => lead.sentAt || lead.lastTouchAt);
        row.finished = sent.filter((lead) => (lead.followUpsSent || []).length).length;
        row.doing = sent.length ? [`tracking ${sent.length} sent message${sent.length === 1 ? '' : 's'}`] : [];
        row.waiting = sent.length ? ['nothing — it only prepares text, you send it'] : [];
        break;
      }
      case 'quality': {
        const checked = drafts.filter((draft) => draft.qa);
        const failed = checked.filter((draft) => draft.qa?.decision === 'revise' || (draft.qa?.issues || []).length);
        row.finished = checked.length;
        row.doing = failed.slice(0, 2).map((draft) => `flagged ${draft.id}: ${(draft.qa?.issues || [])[0] || 'needs a look'}`);
        row.waiting = failed.length ? [`${failed.length} draft${failed.length === 1 ? '' : 's'} flagged by quality`] : [];
        break;
      }
      case 'report': {
        const todayReport = audit.some((row) => row.action === 'report.generated' && isToday(row.ts));
        row.doing = todayReport ? ["today's report is written"] : ['no report written today'];
        row.finished = audit.filter((row) => row.action === 'report.generated').length;
        break;
      }
      case 'proposal': {
        const proposals = drafts.filter((draft) => /proposal/i.test(draft.request || '') || /proposal/i.test(draft.title || ''));
        row.doing = proposals.slice(0, 2).map((draft) => draft.title || draft.request);
        row.finished = proposals.filter((draft) => draft.status === 'Approved').length;
        break;
      }
      default:
        break;
    }

    if (agent.id === 'content' || agent.id === 'manager' || agent.id === 'research' || agent.id === 'finder') {
      if (clients.length && agent.id === 'manager') row.doing.push(`${clients.length} client record${clients.length === 1 ? '' : 's'} tracked`);
    }

    return row;
  });

  return rows;
}

/** The one-line answer to "is my team working right now?" */
export function teamSummary(rows) {
  const working = rows.filter((row) => row.runsToday > 0);
  const failing = rows.filter((row) => row.lastResult === 'failed');
  const unused = rows.filter((row) => row.runs === 0);
  const waitingItems = rows.reduce((sum, row) => sum + row.waiting.length, 0);

  return {
    total: rows.length,
    activeToday: working.length,
    failing: failing.map((row) => row.name),
    neverRun: unused.map((row) => row.name),
    waitingItems,
  };
}

/**
 * Repair old run rows written before v2.3.
 *
 * Before v2.3 every provider miss was recorded as `ok: false` even though the
 * offline engine completed the job. Those rows made healthy agents look broken
 * (finder sat at 0%). We relabel them once, at load, so the history keeps its
 * meaning. Nothing is deleted; each row gains `fallback: true` and a note.
 */
export function repairLegacyRuns(runs = []) {
  let touched = 0;
  for (const run of runs) {
    if (run.ok === false && /no ai provider is reachable/i.test(run.detail || '')) {
      run.ok = true;
      run.fallback = true;
      run.detail = `offline fallback — ${run.detail}`.slice(0, 200);
      touched += 1;
    }
  }
  return touched;
}
