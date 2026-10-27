import { store, todayKey, officeTime } from './store.js';
import { dashboard, missionToday, overview } from './metrics.js';
import { BRAND } from './config.js';
import {
  runBrief,
  runContent,
  runFindPlan,
  runFollowup,
  runManager,
  runOutreach,
  runProposal,
  runQuality,
  runReport,
  runResearch,
  detectPlatform,
  detectTone,
  scoreLead,
} from './agents/index.js';
import { extractIds, LEAD_STAGES, offlineBrief, offlineProposal } from './agents/offline.js';

export const COMMANDS = [
  { command: '/task', group: 'Work', description: 'Plan the work you describe into 1-5 tasks', example: '/task Plan a Reel about free AI tools' },
  { command: '/draft', group: 'Work', description: 'Create one draft and send it for approval', example: '/draft Write a friendly Instagram caption' },
  { command: '/brief', group: 'Work', description: 'Your morning brief: focus, waiting on you, money', example: '/brief' },
  { command: '/report', group: 'Work', description: 'Daily office summary from stored data', example: '/report' },
  { command: '/approve', group: 'Approvals', description: 'Approve a draft (no ID = latest awaiting)', example: '/approve D-0001' },
  { command: '/revise', group: 'Approvals', description: 'Request a revision with feedback', example: '/revise D-0001 Make it shorter' },
  { command: '/reject', group: 'Approvals', description: 'Reject a draft with a reason', example: '/reject D-0001 Off brand' },
  { command: '/find', group: 'Clients', description: 'Client Finder research plan for a niche', example: '/find cafes in Pune' },
  { command: '/lead', group: 'Clients', description: 'Add leads from a public source you supply', example: '/lead cafes | Pune | https://x.com | GreenLeaf — no weekly plan' },
  { command: '/verify', group: 'Clients', description: 'Mark a lead verified against its source', example: '/verify L-0001' },
  { command: '/promote', group: 'Clients', description: 'Turn a lead into a client record', example: '/promote L-0002' },
  { command: '/stage', group: 'Clients', description: 'Move a lead or client pipeline stage', example: '/stage C-0002 Negotiation' },
  { command: '/outreach', group: 'Clients', description: 'Draft a first message for a lead', example: '/outreach L-0001' },
  { command: '/proposal', group: 'Clients', description: 'Draft a proposal for a client', example: '/proposal C-0002' },
  { command: '/clients', group: 'Clients', description: 'List clients and open pipeline', example: '/clients' },
  { command: '/done', group: 'Tasks', description: 'Mark a task done', example: '/done T-0001' },
  { command: '/progress', group: 'Tasks', description: 'Move a task to In Progress', example: '/progress T-0001' },
  { command: '/block', group: 'Tasks', description: 'Mark a task blocked with a reason', example: '/block T-0001 Waiting on client' },
  { command: '/status', group: 'Office', description: 'Office counters, provider and limits', example: '/status' },
  { command: '/help', group: 'Office', description: 'Show the command list', example: '/help' },
];

const WHATSAPP_LIKE = [
  `🤖 ${BRAND.name.toUpperCase()} — COMMANDS`,
  '',
  'WORK',
  '/task <request> — plan work into tasks',
  '/draft <request> [--platform X] [--tone Y] — draft + QA',
  '/brief — morning brief',
  '/report — daily summary',
  '',
  'APPROVALS (nothing sends without these)',
  '/approve D-0001 · /revise D-0001 <feedback> · /reject D-0001 <reason>',
  '',
  'CLIENTS',
  '/find <niche> in <city> — research plan',
  '/lead niche | city | source URL | notes — add leads',
  '/verify L-0001 · /promote L-0001 · /stage C-0001 Negotiation',
  '/outreach L-0001 · /proposal C-0001 · /clients',
  '',
  'TASKS',
  '/done T-0001 · /progress T-0001 · /block T-0001 <reason>',
  '',
  'OFFICE',
  '/status · /help',
  '',
  'Rule: nothing is published, sent, spent or deleted without your approval.',
].join('\n');

const FLAG_MAP = {
  '--platform': 'platform',
  '-p': 'platform',
  '--tone': 'tone',
  '-t': 'tone',
  '--audience': 'audience',
  '-a': 'audience',
  '--task': 'taskId',
  '--taskid': 'taskId',
};

export function parseFlags(input) {
  const options = {};
  const words = String(input || '').split(/\s+/);
  const kept = [];
  for (let index = 0; index < words.length; index += 1) {
    const word = words[index];
    const key = FLAG_MAP[word.toLowerCase()];
    if (key) {
      const value = words[index + 1];
      if (value && !FLAG_MAP[value.toLowerCase()]) {
        options[key] = value;
        index += 1;
      }
      continue;
    }
    kept.push(word);
  }
  return { body: kept.join(' ').trim(), options };
}

const normalise = (value = '') => String(value).replace(/\s+/g, ' ').trim();

export const titleCase = (value = '') =>
  String(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');

const shortTitle = (text, max = 70) => {
  const clean = String(text).replace(/^(write|create|make|draft|prepare)\s+(a|an|the|one)?\s*/i, '');
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
};

const money = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;

/* ══════════════════════════════════════════════════════════════
   ACTIONS — shared by the command layer, the HTTP API and the UI
   ══════════════════════════════════════════════════════════════ */

export async function createTasks(request, actor = 'owner') {
  const clean = normalise(request);
  if (!clean) throw new Error('Describe the work you want planned.');

  const result = await runManager(clean, {});
  const createdAt = new Date().toISOString();
  const tasks = result.tasks.map((task) => {
    const row = {
      id: store.nextId('task'),
      createdAt,
      request: clean,
      task: task.task,
      priority: task.priority,
      owner: task.owner,
      deadline: task.deadline,
      status: task.status || 'Pending',
      notes: task.notes,
      provider: result.provider,
      needsReview: Boolean(result.needsReview),
      source: actor,
    };
    store.db.tasks.push(row);
    return row;
  });
  store.save();
  store.audit('task.created', { actor, ref: tasks.map((task) => task.id).join(','), detail: clean.slice(0, 160) });
  return { tasks, provider: result.provider, validationIssues: result.validationIssues || [], needsReview: Boolean(result.needsReview) };
}

export async function createDraft(input, actor = 'owner') {
  const { request = '', platform, tone, audience, taskId, kind = 'content', leadId = '', clientId = '' } = input || {};
  const linkedTask = store.db.tasks.find((task) => task.id === String(taskId || '').toUpperCase());
  const lead = leadId ? store.db.leads.find((row) => row.id === leadId) : null;
  const client = clientId ? store.db.clients.find((row) => row.id === clientId) : null;

  const requestText = normalise(request) || linkedTask?.task || lead?.businessName || client?.company || '';
  if (!requestText) throw new Error('Describe the content you want.');

  const resolvedPlatform =
    kind === 'outreach' ? 'Direct message' : kind === 'proposal' ? 'Proposal' : platform ? titleCase(platform) : detectPlatform(requestText);
  const resolvedTone = tone || detectTone(requestText);
  const dedupeKey = `${kind}:${requestText}:${actor}:${leadId}${clientId}`;
  if (!input.skipDedupe && store.isDuplicate(dedupeKey)) {
    return { duplicate: true, message: 'Same request received twice — ignoring the duplicate (idempotency rule).' };
  }

  const startedAt = Date.now();
  let draftText = '';
  let provider = 'offline';
  let qa = { decision: 'approve', issues: [], suggested_revision: '' };

  if (kind === 'outreach' && lead) {
    const result = await runOutreach({ businessName: lead.businessName, website: lead.website, fitReason: lead.fitReason });
    draftText = result.draft;
    provider = result.provider;
  } else if (kind === 'proposal' && client) {
    const result = await runProposal({
      company: client.company,
      contact: client.contact,
      niche: client.niche,
      value: client.value,
      notes: client.notes,
    });
    draftText = result.text;
    provider = result.provider;
  } else {
    const taskContext = linkedTask ? `${linkedTask.task}. ${linkedTask.notes || ''}`.trim() : lead ? `${lead.fitReason}` : '';
    const content = await runContent({
      request: requestText,
      platform: resolvedPlatform,
      audience: audience || client?.contact || '',
      tone: resolvedTone,
      research: taskContext,
    });
    draftText = content.draft;
    provider = content.provider;
  }

  if (kind !== 'outreach') {
    qa = await runQuality({ draft: draftText, platform: resolvedPlatform, audience: audience || client?.contact || '' });
  } else {
    const words = draftText.split(/\s+/).filter(Boolean).length;
    qa = {
      decision: words > 90 ? 'revise' : 'approve',
      issues: words > 90 ? ['Over the 90-word outreach limit — trim it.'] : [],
      suggested_revision: '',
      checkedAt: new Date().toISOString(),
      provider: 'offline',
    };
  }

  const draft = {
    id: store.nextId('draft'),
    kind,
    taskId: linkedTask?.id || (lead ? '' : ''),
    leadId: lead?.id || '',
    clientId: client?.id || '',
    createdAt: new Date().toISOString(),
    request: requestText,
    title:
      kind === 'outreach' && lead
        ? `Outreach — ${lead.businessName}`
        : kind === 'proposal' && client
          ? `Proposal — ${client.company}`
          : shortTitle(requestText),
    platform: resolvedPlatform,
    audience: audience || client?.contact || '',
    tone: resolvedTone,
    draft: draftText,
    status: 'Awaiting approval',
    reviewer: '',
    decisionAt: null,
    feedback: '',
    version: 1,
    provider,
    qa,
    history: [],
    source: actor,
    ms: Date.now() - startedAt,
  };
  store.db.drafts.push(draft);
  if (linkedTask && linkedTask.status === 'Pending') linkedTask.status = 'In Progress';
  store.save();
  store.audit('draft.created', { actor, ref: draft.id, detail: `${kind} · ${resolvedPlatform} v1 — awaiting approval` });
  return { draft };
}

export function findDraft(id) {
  return store.db.drafts.find((draft) => draft.id === id) || null;
}

export const latestAwaitingDraft = () =>
  [...store.db.drafts].reverse().find((draft) => draft.status === 'Awaiting approval') || null;

export function approvalMessage(draft) {
  const kindLabel = { content: 'Content', outreach: 'Outreach', proposal: 'Proposal' }[draft.kind || 'content'] || 'Draft';
  return [
    `✋ APPROVAL NEEDED — ${draft.id} (${kindLabel})`,
    `Task: ${draft.title}${draft.taskId ? ` · ${draft.taskId}` : ''}${draft.leadId ? ` · ${draft.leadId}` : ''}${draft.clientId ? ` · ${draft.clientId}` : ''}`,
    `Channel: ${draft.platform} · Tone: ${draft.tone || 'friendly'} · Version ${draft.version}`,
    'Status: Awaiting approval',
    '',
    'Draft:',
    draft.draft,
    '',
    draft.qa?.issues?.length
      ? `Quality Checker: ${draft.qa.decision} — ${draft.qa.issues.join('; ')}`
      : `Quality Checker: ${draft.qa?.decision || 'not run'} — no blocking issues`,
    '',
    'Choose:',
    `/approve ${draft.id}`,
    `/revise ${draft.id} Your feedback`,
    `/reject ${draft.id} Reason`,
  ].join('\n');
}

export const draftButtons = (draft) => [
  { label: 'Approve', command: `/approve ${draft.id}`, tone: 'good' },
  { label: 'Revise', command: `/revise ${draft.id} `, tone: 'warn' },
  { label: 'Reject', command: `/reject ${draft.id} `, tone: 'bad' },
];

export async function decideDraft({ id, decision, feedback = '' }, actor = 'owner') {
  const draft = id ? findDraft(String(id).toUpperCase()) : latestAwaitingDraft();
  if (!draft) throw new Error('No draft found for that ID.');

  const note = normalise(feedback).slice(0, 400);
  draft.reviewer = actor;
  draft.decisionAt = new Date().toISOString();

  if (decision === 'approve') {
    if (draft.status === 'Approved') return { draft, already: true };
    draft.status = 'Approved';
    draft.feedback = note;
    draft.history.push({ at: draft.decisionAt, action: 'approve', actor, note });
    store.save();
    store.audit('draft.approved', { actor, ref: draft.id, detail: note || 'approved without note' });
    return { draft, approved: true };
  }

  if (decision === 'reject') {
    draft.status = 'Rejected';
    draft.feedback = note;
    draft.history.push({ at: draft.decisionAt, action: 'reject', actor, note });
    store.save();
    store.audit('draft.rejected', { actor, ref: draft.id, detail: note || 'no reason given' });
    return { draft, rejected: true };
  }

  // revise → regenerate according to the draft kind, still gated
  draft.status = 'Revision requested';
  draft.feedback = note;
  draft.history.push({ at: draft.decisionAt, action: 'revise', actor, note });
  store.save();
  store.audit('draft.revision_requested', { actor, ref: draft.id, detail: note || 'no feedback' });

  let draftText = '';
  let provider = 'offline';

  if (draft.kind === 'outreach') {
    const lead = store.db.leads.find((row) => row.id === draft.leadId);
    const result = await runOutreach({
      businessName: lead?.businessName || draft.title,
      website: lead?.website || '',
      fitReason: `${lead?.fitReason || ''} ${note}`.trim(),
    });
    draftText = result.draft;
    provider = result.provider;
  } else if (draft.kind === 'proposal') {
    const client = store.db.clients.find((row) => row.id === draft.clientId);
    const result = await runProposal({
      company: client?.company || draft.title,
      contact: client?.contact || '',
      niche: client?.niche || '',
      value: client?.value || 0,
      notes: `${client?.notes || ''} ${note}`.trim(),
    });
    draftText = result.text;
    provider = result.provider;
  } else {
    const result = await runContent({
      request: [draft.request, note ? `Revision feedback: ${note}` : ''].filter(Boolean).join('\n'),
      platform: draft.platform,
      audience: draft.audience,
      tone: draft.tone,
    });
    draftText = result.draft;
    provider = result.provider;
  }

  const qa = await runQuality({ draft: draftText, platform: draft.platform, audience: draft.audience });
  const revision = {
    ...draft,
    id: store.nextId('draft'),
    createdAt: new Date().toISOString(),
    draft: draftText,
    status: 'Awaiting approval',
    reviewer: '',
    decisionAt: null,
    version: (draft.version || 1) + 1,
    provider,
    qa,
    history: [
      ...draft.history,
      { at: new Date().toISOString(), action: 'regenerated', actor: 'system', note: `v${(draft.version || 1) + 1}` },
    ],
  };
  store.db.drafts.push(revision);
  store.save();
  return { draft, revision };
}

export async function addLeads({ niche = 'unspecified', location = '', sourceUrl = '', notes = '' }, actor = 'owner') {
  const result = await runResearch({ niche, location, sourceUrl, notes });
  if (!result.ok) return { ok: false, reason: result.reason || 'A public source URL and your own notes are required.' };

  const leads = result.leads.map((lead) => {
    const scored = scoreLead({ ...lead, location, stage: 'New' });
    const row = {
      id: store.nextId('lead'),
      createdAt: new Date().toISOString(),
      businessName: lead.businessName,
      website: lead.website,
      niche: lead.niche || niche,
      location,
      sourceUrl: lead.sourceUrl,
      fitReason: lead.fitReason,
      contactStatus: 'Not contacted',
      reviewStatus: 'Needs human verification',
      stage: 'New',
      score: scored.score,
      scoreReasons: scored.reasons,
      owner: actor,
      lastTouchAt: null,
      nextFollowUp: null,
      notes: '',
      provider: result.provider,
      source: actor,
    };
    store.db.leads.push(row);
    return row;
  });
  store.save();
  store.audit('lead.created', { actor, ref: leads.map((lead) => lead.id).join(','), detail: `${leads.length} rows from ${sourceUrl}` });
  return { ok: true, leads, provider: result.provider };
}

export function verifyLead(id, actor = 'owner') {
  const lead = store.db.leads.find((row) => row.id === String(id || '').toUpperCase());
  if (!lead) throw new Error(`Lead ${id} not found.`);
  lead.reviewStatus = 'Verified by human';
  if (lead.stage === 'New') lead.stage = 'Verified';
  const scored = scoreLead(lead);
  lead.score = scored.score;
  lead.scoreReasons = scored.reasons;
  lead.nextAction = 'Eligible for a manual outreach draft';
  store.save();
  store.audit('lead.verified', { actor, ref: lead.id, detail: 'reviewed against the public source' });
  return { lead };
}

export function setLeadStage(id, stage, actor = 'owner') {
  const lead = store.db.leads.find((row) => row.id === String(id || '').toUpperCase());
  if (!lead) throw new Error(`Lead ${id} not found.`);
  const target = LEAD_STAGES.find((item) => item.toLowerCase() === String(stage || '').toLowerCase());
  if (!target) throw new Error(`Stage must be one of: ${LEAD_STAGES.join(', ')}`);
  lead.stage = target;
  if (target !== 'New') lead.lastTouchAt = new Date().toISOString();
  if (target === 'Won') lead.contactStatus = 'Client';
  const scored = scoreLead(lead);
  lead.score = scored.score;
  lead.scoreReasons = scored.reasons;
  store.save();
  store.audit('lead.stage', { actor, ref: lead.id, detail: `${target} — ${lead.businessName}` });
  return { lead };
}

export function addClient(data = {}, actor = 'owner') {
  const company = normalise(data.company);
  if (!company) throw new Error('A company name is required.');
  const stage = ['Lead', 'Proposal sent', 'Negotiation', 'Won', 'Lost'].find(
    (item) => item.toLowerCase() === String(data.stage || 'lead').toLowerCase(),
  );
  const client = {
    id: store.nextId('client'),
    createdAt: new Date().toISOString(),
    company,
    contact: normalise(data.contact) || 'Owner',
    email: normalise(data.email),
    phone: normalise(data.phone),
    niche: normalise(data.niche) || 'General',
    stage: stage || 'Lead',
    value: Math.max(0, Number(data.value) || 0),
    currency: store.settings.currency || 'INR',
    leadId: data.leadId || '',
    sourceUrl: data.sourceUrl || '',
    owner: actor,
    lastTouchAt: new Date().toISOString(),
    nextFollowUp: data.nextFollowUp || null,
    notes: normalise(data.notes),
    source: actor,
  };
  store.db.clients.push(client);
  store.save();
  store.audit('client.created', { actor, ref: client.id, detail: `${client.company} · ${client.stage}` });
  return { client };
}

export function promoteLead(id, actor = 'owner') {
  const lead = store.db.leads.find((row) => row.id === String(id || '').toUpperCase());
  if (!lead) throw new Error(`Lead ${id} not found.`);
  if (lead.clientId) throw new Error(`${lead.id} is already linked to ${lead.clientId}.`);

  const { client } = addClient(
    {
      company: lead.businessName,
      contact: 'Owner',
      niche: lead.niche,
      stage: 'Lead',
      value: 0,
      leadId: lead.id,
      sourceUrl: lead.sourceUrl,
      notes: lead.fitReason,
    },
    actor,
  );
  lead.clientId = client.id;
  lead.stage = 'Won';
  lead.contactStatus = 'Client';
  lead.nextFollowUp = null;
  store.save();
  store.audit('lead.promoted', { actor, ref: client.id, detail: `${lead.id} → ${client.id}` });
  return { lead, client };
}

export function setClientStage(id, stage, actor = 'owner') {
  const client = store.db.clients.find((row) => row.id === String(id || '').toUpperCase());
  if (!client) throw new Error(`Client ${id} not found.`);
  const target = ['Lead', 'Proposal sent', 'Negotiation', 'Won', 'Lost'].find(
    (item) => item.toLowerCase() === String(stage || '').toLowerCase(),
  );
  if (!target) throw new Error('Stage must be Lead, Proposal sent, Negotiation, Won or Lost.');
  client.stage = target;
  client.lastTouchAt = new Date().toISOString();
  if (target === 'Won' || target === 'Lost') client.nextFollowUp = null;
  store.save();
  store.audit('client.stage', { actor, ref: client.id, detail: `${target} — ${client.company}` });
  return { client };
}

export function setFollowUp({ kind, id, date }, actor = 'owner') {
  const list = kind === 'lead' ? store.db.leads : store.db.clients;
  const row = list.find((item) => item.id === String(id || '').toUpperCase());
  if (!row) throw new Error(`${id} not found.`);
  row.nextFollowUp = date || null;
  if (date) row.lastTouchAt = new Date().toISOString();
  store.save();
  store.audit('followup.scheduled', { actor, ref: row.id, detail: date ? `next follow-up ${date}` : 'follow-up cleared' });
  return { row };
}

export async function createProposal(clientId, actor = 'owner') {
  const client = store.db.clients.find((row) => row.id === String(clientId || '').toUpperCase());
  if (!client) throw new Error(`Client ${clientId} not found. Add them first.`);
  return createDraft({ kind: 'proposal', clientId: client.id, request: `Proposal for ${client.company}`, skipDedupe: true }, actor);
}

export async function createBrief(actor = 'owner') {
  const db = store.db;
  const overviewData = overview(db);
  const mission = missionToday(db);
  const context = {
    date: todayKey(),
    mission: mission.map(({ title, reason }) => ({ title, reason })),
    approvals: overviewData.drafts.awaiting,
    pipeline: {
      openValue: overviewData.pipeline.openValue,
      openCount: overviewData.pipeline.openCount,
      wonValue: overviewData.pipeline.wonValue,
      winRate: overviewData.pipeline.winRate,
    },
    followUps: overviewData.followUps.due,
    dueToday: overviewData.tasks.dueToday,
    overdue: overviewData.tasks.overdue,
  };
  const result = await runBrief(context);
  store.db.meta.lastBriefAt = new Date().toISOString();
  store.db.meta.lastBrief = { date: context.date, text: result.text, provider: result.provider };
  store.save();
  store.audit('brief.generated', { actor, detail: `${mission.length} mission items` });
  return { brief: result.text, provider: result.provider, context };
}

export async function generateReport(actor = 'owner') {
  const db = store.db;
  const waiting = db.drafts.filter((draft) => draft.status === 'Awaiting approval');
  const tasks = db.tasks;
  const data = {
    date: todayKey(),
    completed: tasks.filter((task) => task.status === 'Done'),
    pending: tasks.filter((task) => task.status === 'Pending' || task.status === 'In Progress'),
    blocked: tasks.filter((task) => task.status === 'Blocked'),
    awaiting: waiting,
    priorities: [
      ...tasks.filter((task) => task.status !== 'Done' && task.priority === 'High'),
      ...tasks.filter((task) => task.status !== 'Done' && task.priority === 'Medium'),
      ...tasks.filter((task) => task.status !== 'Done' && task.priority === 'Low'),
    ],
  };

  const report = await runReport({
    date: data.date,
    completed: data.completed.map(({ id, task }) => ({ id, task })),
    pending: data.pending.map(({ id, task, priority, owner }) => ({ id, task, priority, owner })),
    blocked: data.blocked.map(({ id, task, notes }) => ({ id, task, notes })),
    awaiting: waiting.map(({ id, platform, status }) => ({ id, platform, status })),
    priorities: data.priorities.slice(0, 3).map(({ id, task }) => ({ id, task })),
  });

  const entry = {
    date: data.date,
    ts: new Date().toISOString(),
    completed: data.completed.length,
    pending: data.pending.length,
    blocked: data.blocked.length,
    draftsAwaitingApproval: waiting.length,
    notes: report.text,
    provider: report.provider,
  };
  const index = db.dailyLog.findIndex((row) => row.date === entry.date);
  if (index >= 0) db.dailyLog[index] = entry;
  else db.dailyLog.push(entry);
  db.meta.lastReportAt = entry.ts;
  store.save();
  store.audit('report.generated', { actor, detail: `pending ${entry.pending}, awaiting ${entry.draftsAwaitingApproval}` });
  return { report: report.text, provider: report.provider, entry };
}

export async function createFindPlan({ niche, location, notes }, actor = 'owner') {
  if (!normalise(niche)) throw new Error('Tell the Client Finder a niche, for example: cafes in Pune.');
  const plan = await runFindPlan({ niche, location, notes });
  store.db.meta.lastFind = { at: new Date().toISOString(), niche, location, provider: plan.provider };
  store.save();
  store.audit('finder.plan', { actor, detail: `${niche}${location ? ` in ${location}` : ''}` });
  return plan;
}

export function updateTaskStatus(id, status, reason = '', actor = 'owner') {
  const task = store.db.tasks.find((row) => row.id === String(id || '').toUpperCase());
  if (!task) throw new Error(`Task ${id} not found.`);
  task.status = status;
  if (reason) task.notes = normalise(reason).slice(0, 300);
  store.save();
  store.audit('task.status', { actor, ref: task.id, detail: `${status}${reason ? ` — ${reason}` : ''}` });
  return { task };
}

export function deleteTask(id, actor = 'owner') {
  const index = store.db.tasks.findIndex((row) => row.id === String(id || '').toUpperCase());
  if (index === -1) throw new Error(`Task ${id} not found.`);
  const [task] = store.db.tasks.splice(index, 1);
  store.save();
  store.audit('task.deleted', { actor, ref: task.id, detail: task.task, level: 'warn' });
  return { task };
}

export function upsertClientNotes(id, notes, actor = 'owner') {
  const client = store.db.clients.find((row) => row.id === String(id || '').toUpperCase());
  if (!client) throw new Error(`Client ${id} not found.`);
  client.notes = normalise(notes).slice(0, 600);
  client.lastTouchAt = new Date().toISOString();
  store.save();
  store.audit('client.updated', { actor, ref: client.id, detail: 'notes updated' });
  return { client };
}

/* ══════════════════════════════════════════════════════════════
   COMMAND LAYER — chat formatting on top of the actions
   ══════════════════════════════════════════════════════════════ */

function reply({ text, buttons = [], kind = 'bot', ref = '' }) {
  store.message({ role: kind, text, buttons, ref });
  return { ok: true, reply: text, buttons };
}

export async function handleCommand({ raw = '', actor = 'owner', channel = 'web' }) {
  const text = String(raw || '').trim();
  if (!text) return reply({ text: 'Type /help to see what this office can do.' });

  store.message({ role: 'user', text, actor, channel });
  const firstWord = text.split(/\s+/)[0].toLowerCase();
  const rest = text.slice(firstWord.length).trim();

  if (!firstWord.startsWith('/')) return commandTask(rest || text, actor);

  switch (firstWord) {
    case '/help':
      return reply({ text: WHATSAPP_LIKE });
    case '/task':
      return commandTask(rest, actor);
    case '/draft':
      return commandDraft(rest, actor);
    case '/brief':
      return commandBrief(actor);
    case '/report':
      return commandReport(actor);
    case '/approve':
    case '/revise':
    case '/reject':
      return commandDecision(firstWord.slice(1), rest, actor);
    case '/find':
      return commandFind(rest, actor);
    case '/lead':
      return commandLead(rest, actor);
    case '/verify':
      return commandVerify(rest, actor);
    case '/promote':
      return commandPromote(rest, actor);
    case '/stage':
      return commandStage(rest, actor);
    case '/outreach':
      return commandOutreach(rest, actor);
    case '/proposal':
      return commandProposal(rest, actor);
    case '/clients':
      return commandClients(actor);
    case '/client':
      return commandClient(rest);
    case '/followup':
      return commandFollowup(rest, actor);
    case '/follow':
      return commandFollow(rest, actor);
    case '/done':
    case '/progress':
    case '/block':
      return commandTaskStatus(firstWord, rest, actor);
    case '/delete':
      return commandDelete(rest, actor);
    case '/status':
      return commandStatus();
    default:
      return reply({ text: `❓ Unknown command "${firstWord}".\n\n${WHATSAPP_LIKE}` });
  }
}

async function commandTask(request, actor) {
  const clean = normalise(request);
  if (!clean) {
    return reply({ text: 'Usage: /task Describe the work you want planned.\nExample: /task Plan a beginner-friendly Instagram Reel about free AI tools.' });
  }
  const result = await createTasks(clean, actor);
  const lines = [
    '✅ Task received. Creating structured tasks.',
    '',
    ...result.tasks.map(
      (task) =>
        `${task.id} · ${task.priority} · ${task.owner}${task.deadline ? ` · due ${task.deadline}` : ''}\n   ${task.task}${task.notes ? `\n   ↳ ${task.notes}` : ''}`,
    ),
    '',
    result.validationIssues.length ? `⚠️ Validation: ${result.validationIssues.join('; ')}` : '',
    `Engine: ${result.provider}`,
    '',
    'Next: /draft for the content, /brief for today’s focus.',
  ].filter(Boolean);

  return reply({
    text: lines.join('\n'),
    buttons: [
      { label: 'Create draft', command: `/draft ${clean}`, tone: 'good' },
      { label: 'Morning brief', command: '/brief', tone: 'neutral' },
    ],
  });
}

async function commandDraft(request, actor) {
  const { body, options } = parseFlags(request);
  const result = await createDraft(
    {
      request: body,
      platform: options.platform,
      tone: options.tone,
      audience: options.audience,
      taskId: options.taskId,
    },
    actor,
  );
  if (result.duplicate) return reply({ text: `⚠️ ${result.message}` });
  return reply({ text: approvalMessage(result.draft), buttons: draftButtons(result.draft), ref: result.draft.id });
}

async function commandDecision(decision, rest, actor) {
  const ids = extractIds(rest, 'draft');
  const feedback = normalise(rest.replace(/\bD-\d{4}\b/i, '')).slice(0, 400);
  let result;
  try {
    result = await decideDraft({ id: ids[0], decision, feedback }, actor);
  } catch (error) {
    return reply({ text: `No draft found for that ID. Use /report or the Approvals page, or /draft to create one.` });
  }

  if (decision === 'approve') {
    const draft = result.draft;
    if (result.already) return reply({ text: `${draft.id} is already approved. Nothing was sent — publishing stays manual.` });
    return reply({
      text: [
        `✅ ${draft.id} approved by you.`,
        '',
        draft.kind === 'outreach'
          ? 'Copy it and send it yourself — this office never messages anyone.'
          : 'Copy it out and publish manually — this office never posts on its own.',
        feedback ? `Note: ${feedback}` : '',
      ].filter(Boolean).join('\n'),
      buttons: [
        { label: 'Copy draft', command: draft.draft, tone: 'neutral' },
        { label: 'Morning brief', command: '/brief', tone: 'neutral' },
      ],
      ref: draft.id,
    });
  }

  if (decision === 'reject') {
    return reply({
      text: `🚫 ${result.draft.id} rejected.${feedback ? `\nReason: ${feedback}` : '\nNo reason recorded — add one next time so the agent can learn.'}`,
      ref: result.draft.id,
    });
  }

  const revision = result.revision;
  return reply({
    text: [
      `📝 Revision requested for ${result.draft.id}.`,
      feedback ? `Feedback: ${feedback}` : 'No feedback given, so the agent produced a fresh version.',
      '',
      approvalMessage(revision),
    ].join('\n'),
    buttons: draftButtons(revision),
    ref: revision.id,
  });
}

async function commandBrief(actor) {
  const { brief, provider } = await createBrief(actor);
  return reply({
    text: brief,
    buttons: [
      { label: 'Approvals', command: '/status', tone: 'neutral' },
      { label: 'Daily report', command: '/report', tone: 'neutral' },
    ],
  });
}

async function commandReport(actor) {
  const { report, entry } = await generateReport(actor);
  return reply({
    text: report,
    buttons: [
      { label: 'Morning brief', command: '/brief', tone: 'neutral' },
      { label: 'Clients', command: '/clients', tone: 'neutral' },
    ],
  });
}

async function commandFind(rest, actor) {
  const text = normalise(rest);
  if (!text) {
    return reply({ text: 'Usage: /find cafes in Pune\nReturns a research plan: queries, directories, a verification checklist and red flags.' });
  }
  const match = text.match(/^(.*?)\s+(?:in|near|around)\s+(.+)$/i);
  const niche = match ? match[1].trim() : text;
  const location = match ? match[2].trim() : '';
  const plan = await createFindPlan({ niche, location }, actor);

  return reply({
    text: [
      `🔎 CLIENT FINDER PLAN — ${niche}${location ? ` in ${location}` : ''}`,
      '',
      plan.summary,
      '',
      'Search queries:',
      ...plan.queries.map((query, index) => `   ${index + 1}. ${query}`),
      '',
      'Where to look:',
      ...plan.directories.map((item) => `   • ${item}`),
      '',
      'Verify before adding:',
      ...plan.checklist.map((item) => `   ✓ ${item}`),
      '',
      'Red flags:',
      ...plan.red_flags.map((item) => `   ✕ ${item}`),
      '',
      'Nothing was scraped or invented. Add rows with:',
      '/lead niche | city | source URL | what you saw',
      `Engine: ${plan.provider}`,
    ].join('\n'),
    buttons: [
      { label: 'Add leads', command: '/lead ', tone: 'good' },
      { label: 'Open pipeline', command: '/clients', tone: 'neutral' },
    ],
  });
}

async function commandLead(rest, actor) {
  const text = normalise(rest);
  if (!text) {
    return reply({
      text: [
        'Usage: /lead niche | location | source URL | notes',
        '',
        'Example:',
        '/lead cafes | Pune | https://example.com/directory | GreenLeaf — daily specials, no weekly plan',
        '',
        'Chapter 8 rules: public sources only, source URL mandatory, every lead marked "Needs human verification", never auto-contacted.',
      ].join('\n'),
    });
  }

  const parts = rest.split('|').map((part) => part.trim());
  const urlPart = parts.find((part) => /^https?:\/\//i.test(part)) || (text.match(/https?:\/\/\S+/) || [])[0] || '';
  const withoutUrl = parts.filter((part) => part !== urlPart);
  const niche = withoutUrl[0] || 'unspecified';
  const location = withoutUrl[1] || '';
  const notes = withoutUrl.slice(2).join('\n');

  const result = await addLeads({ niche, location, sourceUrl: urlPart, notes }, actor);
  if (!result.ok) {
    return reply({
      text: [
        '🛑 No lead rows were created.',
        '',
        result.reason,
        '',
        'Add your notes after the URL:',
        '/lead cafes | Pune | https://example.com/directory | GreenLeaf — no visible weekly plan',
      ].join('\n'),
    });
  }

  return reply({
    text: [
      `🔎 ${result.leads.length} lead row${result.leads.length === 1 ? '' : 's'} prepared — all marked "Needs human verification".`,
      '',
      ...result.leads.map((lead) => `${lead.id} · ${lead.businessName} · score ${lead.score}\n   ${lead.fitReason || 'no fit reason'}\n   Source: ${lead.sourceUrl}`),
      '',
      'No contact details were invented. Verify the source, then /verify L-0001.',
      `Engine: ${result.provider}`,
    ].join('\n'),
    buttons: result.leads[0]
      ? [
          { label: `Draft outreach ${result.leads[0].id}`, command: `/outreach ${result.leads[0].id}`, tone: 'neutral' },
          { label: 'Pipeline', command: '/clients', tone: 'neutral' },
        ]
      : [],
  });
}

async function commandVerify(rest, actor) {
  const ids = extractIds(rest, 'lead');
  if (!ids.length) return reply({ text: 'Usage: /verify L-0001 — marks a lead as checked by a human.' });
  try {
    const { lead } = verifyLead(ids[0], actor);
    return reply({
      text: [
        `✅ ${lead.id} · ${lead.businessName} marked "Verified by human" (score ${lead.score}).`,
        `Source checked: ${lead.sourceUrl}`,
        '',
        `Next: /outreach ${lead.id} for a draft, or /promote ${lead.id} once they say yes.`,
      ].join('\n'),
      ref: lead.id,
    });
  } catch (error) {
    return reply({ text: error.message });
  }
}

async function commandPromote(rest, actor) {
  const ids = extractIds(rest, 'lead');
  if (!ids.length) return reply({ text: 'Usage: /promote L-0001 — creates a client record from a lead.' });
  try {
    const { lead, client } = promoteLead(ids[0], actor);
    return reply({
      text: [
        `🤝 ${lead.businessName} is now a client: ${client.id}.`,
        '',
        'Pipeline stage: Lead. Set the deal value in the Clients page, then /proposal to draft the first proposal.',
      ].join('\n'),
      buttons: [
        { label: 'Draft proposal', command: `/proposal ${client.id}`, tone: 'good' },
        { label: 'Clients', command: '/clients', tone: 'neutral' },
      ],
      ref: client.id,
    });
  } catch (error) {
    return reply({ text: error.message });
  }
}

async function commandStage(rest, actor) {
  const parts = normalise(rest).split(/\s+/);
  const id = (parts[0] || '').toUpperCase();
  const stage = parts.slice(1).join(' ');
  if (!id || !stage) return reply({ text: 'Usage: /stage C-0001 Negotiation\nStages: Lead, Proposal sent, Negotiation, Won, Lost' });

  try {
    if (id.startsWith('C-')) {
      const { client } = setClientStage(id, stage, actor);
      return reply({ text: `🔄 ${client.id} · ${client.company} → ${client.stage}\nDeal value: ${money(client.value)}` });
    }
    const { lead } = setLeadStage(id, stage, actor);
    return reply({ text: `🔄 ${lead.id} · ${lead.businessName} → ${lead.stage} (score ${lead.score})` });
  } catch (error) {
    return reply({ text: error.message });
  }
}

async function commandOutreach(rest, actor) {
  const ids = extractIds(rest, 'lead');
  if (!ids.length) return reply({ text: 'Usage: /outreach L-0001\nCreates a gated draft. Nothing is sent — you send every message yourself.' });
  const lead = store.db.leads.find((row) => row.id === ids[0]);
  if (!lead) return reply({ text: `Lead ${ids[0]} not found.` });
  const result = await createDraft({ kind: 'outreach', leadId: lead.id, request: `Outreach for ${lead.businessName}` }, actor);
  if (result.duplicate) return reply({ text: `⚠️ ${result.message}` });
  return reply({ text: approvalMessage(result.draft), buttons: draftButtons(result.draft), ref: result.draft.id });
}

async function commandProposal(rest, actor) {
  const parts = normalise(rest).split(/\s+/);
  const id = (parts[0] || '').toUpperCase();
  if (!id.startsWith('C-')) return reply({ text: 'Usage: /proposal C-0001 — drafts a proposal for a client record.' });
  try {
    const result = await createProposal(id, actor);
    return reply({ text: approvalMessage(result.draft), buttons: draftButtons(result.draft), ref: result.draft.id });
  } catch (error) {
    return reply({ text: error.message });
  }
}

function commandClients(actor) {
  const clients = store.db.clients;
  const data = overview(store.db);
  if (!clients.length) {
    return reply({ text: 'No clients yet. Find one with /find, add leads with /lead, then /promote L-0001.' });
  }
  const open = clients.filter((client) => !['Won', 'Lost'].includes(client.stage));
  return reply({
    text: [
      '🤝 CLIENTS & PIPELINE',
      '',
      `Open pipeline: ${money(data.pipeline.openValue)} across ${data.pipeline.openCount} deal(s)`,
      `Won: ${money(data.pipeline.wonValue)} · win rate ${data.pipeline.winRate}%`,
      '',
      ...clients
        .slice()
        .sort((a, b) => Number(b.value) - Number(a.value))
        .map(
          (client) =>
            `${client.id} · ${client.company} · ${client.stage} · ${money(client.value)}${client.nextFollowUp ? `\n   follow-up ${client.nextFollowUp}` : ''}`,
        ),
      '',
      'Next: /proposal C-0001, /stage C-0001 Negotiation, or /clients in the app for the full CRM.',
    ].join('\n'),
  });
}

function commandClient(rest) {
  const id = normalise(rest).split(/\s+/)[0]?.toUpperCase();
  const client = store.db.clients.find((row) => row.id === id);
  if (!client) return reply({ text: 'Usage: /client C-0001' });
  return reply({
    text: [
      `🏢 ${client.id} · ${client.company}`,
      `Contact: ${client.contact}${client.email ? ` · ${client.email}` : ''}${client.phone ? ` · ${client.phone}` : ''}`,
      `Niche: ${client.niche}`,
      `Stage: ${client.stage} · Value: ${money(client.value)}`,
      `Next follow-up: ${client.nextFollowUp || 'not scheduled'}`,
      client.notes ? `Notes: ${client.notes}` : '',
      '',
      'Proposal: /proposal ' + client.id,
    ].filter(Boolean).join('\n'),
  });
}

async function commandFollowup(rest, actor) {
  const name = normalise(rest) || 'the client';
  const result = await runFollowup({ clientName: name, context: 'the work we discussed', priorInteraction: '' });
  store.audit('followup.drafted', { actor, detail: `follow-up for ${name}` });
  return reply({ text: [`📨 Follow-up draft for ${name} — not sent.`, '', result.draft, '', `Engine: ${result.provider}`].join('\n') });
}

function commandFollow(rest, actor) {
  const parts = normalise(rest).split(/\s+/);
  const id = (parts[0] || '').toUpperCase();
  const date = parts[1] || '';
  if (!/^([LC])-\d{4}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return reply({ text: 'Usage: /follow C-0001 2026-11-02\nAlso works for leads: /follow L-0004 2026-11-02' });
  }
  try {
    const kind = id.startsWith('L') ? 'lead' : 'client';
    const { row } = setFollowUp({ kind, id, date }, actor);
    return reply({ text: `📅 Follow-up for ${row.company || row.businessName} scheduled on ${date}.` });
  } catch (error) {
    return reply({ text: error.message });
  }
}

function commandTaskStatus(command, rest, actor) {
  const ids = extractIds(rest, 'task');
  const map = {
    '/done': { status: 'Done', label: 'marked done' },
    '/progress': { status: 'In Progress', label: 'moved to In Progress' },
    '/block': { status: 'Blocked', label: 'marked blocked' },
  };
  const config = map[command];
  if (!ids.length) return reply({ text: `Usage: ${command} T-0001${command === '/block' ? ' reason' : ''}` });
  const reason = command === '/block' ? normalise(rest.replace(/T-\d{4}/i, '')) : '';
  try {
    const { task } = updateTaskStatus(ids[0], config.status, reason, actor);
    return reply({
      text: `🔄 ${task.id} ${config.label}.\n${task.task}${reason ? `\nReason: ${reason}` : ''}`,
      ref: task.id,
    });
  } catch (error) {
    return reply({ text: error.message });
  }
}

function commandDelete(rest, actor) {
  const ids = extractIds(rest, 'task');
  if (!ids.length) return reply({ text: 'Usage: /delete T-0001 — this is logged as a destructive action.' });
  try {
    const { task } = deleteTask(ids[0], actor);
    return reply({ text: `🗑️ ${task.id} deleted. The audit trail keeps a record of it.` });
  } catch (error) {
    return reply({ text: error.message });
  }
}

function commandStatus() {
  const db = store.db;
  const data = overview(db);
  const awaiting = db.drafts.filter((draft) => draft.status === 'Awaiting approval');
  return reply({
    text: [
      '📊 OFFICE STATUS',
      '',
      `Tasks: ${data.tasks.total} · open ${data.tasks.open} · overdue ${data.tasks.overdue} · blocked ${data.tasks.blocked}`,
      `Drafts: ${data.drafts.total} · ${awaiting.length} awaiting approval · approval rate ${data.drafts.approvalRate}%`,
      `Leads: ${data.leads.total} · ${data.leads.needsVerification} need verification`,
      `Pipeline: ${money(data.pipeline.openValue)} open · ${money(data.pipeline.wonValue)} won · win rate ${data.pipeline.winRate}%`,
      `Model calls today: ${store.usageToday()} / ${store.settings.maxCallsPerDay}`,
      `Provider setting: ${store.settings.provider}`,
      `Brief last generated: ${db.meta.lastBriefAt ? officeTime(new Date(db.meta.lastBriefAt)) : 'never'}`,
      '',
      awaiting.length ? `Awaiting: ${awaiting.map((draft) => draft.id).join(', ')}` : 'Nothing awaiting approval.',
      '',
      'Nothing publishes or messages automatically — every draft needs /approve.',
    ].join('\n'),
  });
}

export { dashboard, missionToday, overview, offlineBrief, offlineProposal };
