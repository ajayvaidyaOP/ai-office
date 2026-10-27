import { todayKey } from './store.js';

const DAY = 86_400_000;
const startOfDay = (date = new Date()) => {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
};

const dayDiff = (iso) => {
  if (!iso) return null;
  const target = new Date(`${String(iso).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  return Math.round((startOfDay() - startOfDay(target)) / DAY);
};

const money = (value) => Number(value) || 0;

export const PIPE_STAGES = ['Lead', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];
const OPEN_STAGES = ['Lead', 'Proposal sent', 'Negotiation'];

/** Everything the dashboard needs, computed from one snapshot. */
export function overview(db) {
  const today = todayKey();
  const tasks = db.tasks || [];
  const drafts = db.drafts || [];
  const leads = db.leads || [];
  const clients = db.clients || [];

  const openTasks = tasks.filter((task) => task.status !== 'Done');
  const overdue = openTasks.filter((task) => {
    const diff = dayDiff(task.deadline);
    return diff !== null && diff > 0;
  });
  const dueToday = openTasks.filter((task) => dayDiff(task.deadline) === 0);
  const doneThisWeek = tasks.filter(
    (task) => task.status === 'Done' && task.createdAt && Date.now() - new Date(task.createdAt).getTime() < 7 * DAY,
  );
  const awaiting = drafts.filter((draft) => draft.status === 'Awaiting approval');

  const openDeals = clients.filter((client) => OPEN_STAGES.includes(client.stage));
  const wonDeals = clients.filter((client) => client.stage === 'Won');
  const lostDeals = clients.filter((client) => client.stage === 'Lost');
  const closed = wonDeals.length + lostDeals.length;

  const byStage = PIPE_STAGES.map((stage) => {
    const rows = clients.filter((client) => client.stage === stage);
    return {
      stage,
      count: rows.length,
      value: rows.reduce((sum, client) => sum + money(client.value), 0),
    };
  });

  const followUps = [
    ...clients
      .filter((client) => client.nextFollowUp && OPEN_STAGES.includes(client.stage))
      .map((client) => ({ id: client.id, name: client.company, date: client.nextFollowUp, kind: 'client' })),
    ...leads
      .filter((lead) => lead.nextFollowUp && ['Verified', 'Contacted', 'Replied'].includes(lead.stage))
      .map((lead) => ({ id: lead.id, name: lead.businessName, date: lead.nextFollowUp, kind: 'lead' })),
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const followUpsDue = followUps.filter((row) => {
    const diff = dayDiff(row.date);
    return diff !== null && diff >= 0;
  });

  const needsVerification = leads.filter((lead) => lead.reviewStatus !== 'Verified by human');
  const weeklyTarget = Math.round(money(db.meta?.settings?.monthlyTarget || 150000) / 4.34);
  const wonValue = wonDeals.reduce((sum, client) => sum + money(client.value), 0);

  return {
    date: today,
    tasks: {
      total: tasks.length,
      open: openTasks.length,
      overdue: overdue.length,
      dueToday: dueToday.length,
      blocked: openTasks.filter((task) => task.status === 'Blocked').length,
      done: tasks.filter((task) => task.status === 'Done').length,
      doneThisWeek: doneThisWeek.length,
    },
    drafts: {
      total: drafts.length,
      awaiting: awaiting.length,
      approved: drafts.filter((draft) => draft.status === 'Approved').length,
      revision: drafts.filter((draft) => draft.status === 'Revision requested').length,
      rejected: drafts.filter((draft) => draft.status === 'Rejected').length,
      approvalRate: drafts.length
        ? Math.round((drafts.filter((draft) => draft.status === 'Approved').length / drafts.length) * 100)
        : 0,
    },
    pipeline: {
      openCount: openDeals.length,
      openValue: openDeals.reduce((sum, client) => sum + money(client.value), 0),
      wonCount: wonDeals.length,
      wonValue,
      lostCount: lostDeals.length,
      winRate: closed ? Math.round((wonDeals.length / closed) * 100) : 0,
      avgDeal: clients.length ? Math.round(clients.reduce((sum, client) => sum + money(client.value), 0) / clients.length) : 0,
      target: money(db.meta?.settings?.monthlyTarget || 150000),
      weeklyTarget,
      weeklyValue: wonValue,
      byStage,
    },
    leads: {
      total: leads.length,
      new: leads.filter((lead) => lead.stage === 'New').length,
      contacted: leads.filter((lead) => lead.stage === 'Contacted').length,
      replied: leads.filter((lead) => lead.stage === 'Replied').length,
      verified: leads.length - needsVerification.length,
      needsVerification: needsVerification.length,
      won: leads.filter((lead) => lead.stage === 'Won').length,
      byStage: ['New', 'Verified', 'Contacted', 'Replied', 'Won', 'Lost'].map((stage) => ({
        stage,
        count: leads.filter((lead) => lead.stage === stage).length,
      })),
    },
    clients: {
      total: clients.length,
      active: openDeals.length,
      won: wonDeals.length,
      lost: lostDeals.length,
      byStage,
    },
    followUps: { total: followUps.length, due: followUpsDue.length, list: followUpsDue.slice(0, 8) },
    model: { callsToday: 0, limit: Number(db.meta?.settings?.maxCallsPerDay || 200) },
    activity: {
      runs7d: (db.runs || []).filter((run) => Date.now() - new Date(run.ts).getTime() < 7 * DAY).length,
      audits7d: (db.audit || []).filter((row) => Date.now() - new Date(row.ts).getTime() < 7 * DAY).length,
    },
  };
}

/** The "what should I do next" list — deterministic, explainable, no invented urgency. */
export function missionToday(db) {
  const items = [];
  const settings = db.meta?.settings || {};

  for (const draft of (db.drafts || []).filter((row) => row.status === 'Awaiting approval')) {
    items.push({
      kind: 'approval',
      ref: draft.id,
      title: `Approve ${draft.id} — ${draft.title || draft.platform}`,
      reason: `${draft.platform} draft waiting since ${String(draft.createdAt).slice(0, 10)}`,
      priority: 'High',
      due: String(draft.createdAt).slice(0, 10),
    });
  }

  for (const task of db.tasks || []) {
    if (task.status === 'Done') continue;
    const diff = dayDiff(task.deadline);
    if (diff !== null && diff > 0) {
      items.push({
        kind: 'task',
        ref: task.id,
        title: task.task,
        reason: `Overdue by ${diff} day${diff === 1 ? '' : 's'}`,
        priority: 'High',
        due: task.deadline,
      });
    } else if (diff === 0) {
      items.push({ kind: 'task', ref: task.id, title: task.task, reason: 'Due today', priority: task.priority, due: task.deadline });
    }
  }

  for (const follow of [
    ...(db.clients || [])
      .filter((client) => client.nextFollowUp && OPEN_STAGES.includes(client.stage))
      .map((client) => ({ kind: 'client', id: client.id, name: client.company, date: client.nextFollowUp, value: client.value })),
    ...(db.leads || [])
      .filter((lead) => lead.nextFollowUp && ['Verified', 'Contacted', 'Replied'].includes(lead.stage))
      .map((lead) => ({ kind: 'lead', id: lead.id, name: lead.businessName, date: lead.nextFollowUp, value: 0 })),
  ]) {
    const diff = dayDiff(follow.date);
    if (diff !== null && diff >= 0) {
      items.push({
        kind: 'followup',
        ref: follow.id,
        title: `Follow up with ${follow.name}`,
        reason: diff === 0 ? 'Scheduled for today' : `Scheduled ${diff} day${diff === 1 ? '' : 's'} ago`,
        priority: 'Medium',
        due: follow.date,
      });
    }
  }

  const needsVerification = (db.leads || []).filter((lead) => lead.reviewStatus !== 'Verified by human');
  if (needsVerification.length) {
    items.push({
      kind: 'verify',
      ref: needsVerification[0].id,
      title: `Verify ${needsVerification.length} lead${needsVerification.length === 1 ? '' : 's'} against their public source`,
      reason: 'Unverified leads cannot be used for outreach',
      priority: 'Medium',
      due: '',
    });
  }

  for (const task of db.tasks || []) {
    if (task.status === 'Pending' && task.priority === 'High' && !items.some((item) => item.ref === task.id)) {
      items.push({ kind: 'task', ref: task.id, title: task.task, reason: 'High priority, no deadline set', priority: 'High', due: '' });
    }
  }

  const rank = { High: 0, Medium: 1, Low: 2 };
  const order = { approval: 0, task: 1, followup: 2, verify: 3 };
  items.sort((a, b) => (rank[a.priority] - rank[b.priority]) || (order[a.kind] - order[b.kind]));

  const seen = new Set();
  const unique = items.filter((item) => {
    const key = `${item.kind}:${item.ref}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, 8);
}

/** Per-agent health for the Agents page. */
export function agentStats(db) {
  const runs = db.runs || [];
  const groups = new Map();
  for (const run of runs) {
    const current = groups.get(run.agent) || { agent: run.agent, runs: 0, ok: 0, totalMs: 0, lastAt: null, providers: {} };
    current.runs += 1;
    if (run.ok) current.ok += 1;
    current.totalMs += Number(run.ms) || 0;
    if (!current.lastAt || new Date(run.ts) > new Date(current.lastAt)) current.lastAt = run.ts;
    current.providers[run.provider] = (current.providers[run.provider] || 0) + 1;
    groups.set(run.agent, current);
  }
  return [...groups.values()]
    .map((group) => ({
      agent: group.agent,
      runs: group.runs,
      okRate: Math.round((group.ok / group.runs) * 100),
      avgMs: Math.round(group.totalMs / group.runs),
      lastAt: group.lastAt,
      provider: Object.entries(group.providers).sort((a, b) => b[1] - a[1])[0]?.[0] || 'offline',
    }))
    .sort((a, b) => b.runs - a.runs);
}

/** 14-day activity for charts: created / approved / done per day. */
export function activitySeries(db, days = 14) {
  const series = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.now() - offset * DAY);
    const key = todayKey(date);
    const inDay = (iso) => iso && String(iso).slice(0, 10) === key;
    series.push({
      date: key,
      label: date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }),
      tasks: (db.tasks || []).filter((task) => inDay(task.createdAt)).length,
      drafts: (db.drafts || []).filter((draft) => inDay(draft.createdAt)).length,
      approved: (db.drafts || []).filter((draft) => draft.status === 'Approved' && inDay(draft.decisionAt)).length,
      runs: (db.runs || []).filter((run) => inDay(run.ts)).length,
    });
  }
  return series;
}

/** Everything the UI and the brief agent need. */
export function dashboard(db) {
  return {
    overview: overview(db),
    mission: missionToday(db),
    activity: activitySeries(db),
    agents: agentStats(db),
    money: {
      currency: db.meta?.settings?.currency || 'INR',
      weeklyTarget: Math.round(Number(db.meta?.settings?.monthlyTarget || 150000) / 4.34),
    },
  };
}
