import { store, todayKey, officeTime } from './store.js';
import {
  runContent,
  runFollowup,
  runManager,
  runOutreach,
  runQuality,
  runReport,
  runResearch,
  detectPlatform,
  detectTone,
} from './agents/index.js';
import { extractIds } from './agents/offline.js';

export const COMMANDS = [
  { command: '/task', description: 'Plan the work you describe into 1-5 tasks', example: '/task Plan a Reel about free AI tools' },
  { command: '/draft', description: 'Create one draft and send it for approval', example: '/draft Write a friendly Instagram caption for that Reel' },
  { command: '/report', description: 'Daily office summary from stored task data', example: '/report' },
  { command: '/approve', description: 'Approve a draft (no ID = latest awaiting draft)', example: '/approve D-0001' },
  { command: '/revise', description: 'Request a revision with feedback', example: '/revise D-0001 Make it shorter and more conversational' },
  { command: '/reject', description: 'Reject a draft with a reason', example: '/reject D-0001 Not aligned with our brand voice' },
  { command: '/lead', description: 'Structure leads from a public source you supply', example: '/lead design agencies | Pune | https://example.com | Example Studio — no visible content plan' },
  { command: '/status', description: 'Office counters, provider and limits', example: '/status' },
  { command: '/help', description: 'Show this command list', example: '/help' },
];

/** Extras that are not in the guide's command list but map to its Status column. */
const TASK_STATUS_COMMANDS = {
  '/done': { status: 'Done', label: 'marked done' },
  '/progress': { status: 'In Progress', label: 'moved to In Progress' },
  '/block': { status: 'Blocked', label: 'marked blocked' },
};

const HELP_TEXT = [
  '🤖 AI DIGITAL OFFICE — COMMANDS',
  '',
  ...COMMANDS.map((item) => `${item.command} — ${item.description}`),
  '',
  'EXTRAS (map to the Status / Review columns):',
  '/done T-0001 · /progress T-0001 · /block T-0001 reason · /verify L-0001',
  '/outreach L-0001 · /followup Client name',
  '',
  'Rules: nothing is published, messaged, spent or deleted without your approval.',
].join('\n');

const FLAG_MAP = {
  '--platform': 'platform',
  '-p': 'platform',
  '--tone': 'tone',
  '-t': 'tone',
  '--audience': 'audience',
  '-a': 'audience',
  '--type': 'kind',
  '--task': 'taskId',
};

/** Split "/draft text --tone friendly -p linkedin" into body + explicit options. */
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

function fallbackTaskId() {
  const open = store.db.tasks.filter((task) => task.status !== 'Done');
  return open.length === 1 ? open[0].id : '';
}

function findDraft(id) {
  return store.db.drafts.find((draft) => draft.id === id) || null;
}

function latestAwaitingDraft() {
  return [...store.db.drafts].reverse().find((draft) => draft.status === 'Awaiting approval') || null;
}

/** The approval message template from Chapter 9, in chat form. */
export function approvalMessage(draft) {
  return [
    `✋ APPROVAL NEEDED — ${draft.id}`,
    `Task: ${draft.taskId ? `${draft.taskId} · ` : ''}${draft.title}`,
    `Platform: ${draft.platform} · Tone: ${draft.tone || 'friendly'} · Version ${draft.version}`,
    `Status: Awaiting approval`,
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

function draftButtons(draft) {
  return [
    { label: 'Approve', command: `/approve ${draft.id}`, tone: 'good' },
    { label: 'Revise', command: `/revise ${draft.id} `, tone: 'warn' },
    { label: 'Reject', command: `/reject ${draft.id} `, tone: 'bad' },
  ];
}

function reply({ text, buttons = [], kind = 'bot', ref = '' }) {
  store.message({ role: kind, text, buttons, ref });
  return { ok: true, reply: text, buttons };
}

/** Main entry point — every channel (web console, Telegram bridge, API) uses this. */
export async function handleCommand({ raw = '', actor = 'owner', channel = 'web' }) {
  const text = String(raw || '').trim();
  if (!text) return reply({ text: 'Type /help to see what this office can do.' });

  store.message({ role: 'user', text, actor, channel });

  const firstWord = text.split(/\s+/)[0].toLowerCase();
  const rest = text.slice(firstWord.length).trim();

  if (!firstWord.startsWith('/')) {
    // Free text is treated as a plan request, like a chat with your AI Manager.
    if (store.isDuplicate(`task:${text}:${actor}`)) {
      return reply({ text: '⚠️ Same request received twice — ignoring the duplicate (idempotency rule).' });
    }
    return commandTask(rest || text, actor);
  }

  switch (firstWord) {
    case '/help':
    case '/start':
      return reply({ text: HELP_TEXT });
    case '/task':
      return commandTask(rest, actor);
    case '/draft':
      return commandDraft(rest, actor);
    case '/report':
      return commandReport(actor);
    case '/approve':
      return commandDecision('approve', rest, actor);
    case '/revise':
      return commandDecision('revise', rest, actor);
    case '/reject':
      return commandDecision('reject', rest, actor);
    case '/lead':
      return commandLead(rest, actor);
    case '/status':
      return commandStatus();
    case '/done':
    case '/progress':
    case '/block':
      return commandTaskStatus(firstWord, rest, actor);
    case '/verify':
      return commandVerify(rest, actor);
    case '/followup':
      return commandFollowup(rest, actor);
    case '/outreach':
      return commandOutreach(rest, actor);
    default:
      return reply({
        text: `❓ Unknown command "${firstWord}".\n\n${HELP_TEXT}`,
      });
  }
}

async function commandTask(request, actor) {
  const clean = normalise(request);
  if (!clean) {
    return reply({ text: 'Usage: /task Describe the work you want planned.\nExample: /task Plan a beginner-friendly Instagram Reel about free AI tools for small businesses.' });
  }

  const result = await runManager(clean, {});
  const createdAt = new Date().toISOString();
  const created = result.tasks.map((task) => {
    const id = store.nextId('task');
    const row = {
      id,
      createdAt,
      request: clean,
      task: task.task,
      priority: task.priority,
      owner: task.owner,
      deadline: task.deadline,
      status: task.status || 'Pending',
      notes: task.notes,
      source: actor,
      provider: result.provider,
      needsReview: Boolean(result.needsReview),
    };
    store.db.tasks.push(row);
    return row;
  });
  store.save();
  store.audit('task.created', { actor, ref: created.map((task) => task.id).join(','), detail: clean.slice(0, 160) });

  const lines = [
    '✅ Task received. Creating structured tasks.',
    '',
    ...created.map(
      (task) =>
        `${task.id} · ${task.priority} · ${task.owner}${task.deadline ? ` · due ${task.deadline}` : ''}\n   ${task.task}${task.notes ? `\n   ↳ ${task.notes}` : ''}`,
    ),
    '',
    result.validationIssues?.length ? `⚠️ Validation: ${result.validationIssues.join('; ')}` : '',
    `Engine: ${result.provider}`,
    '',
    'Next: /draft to create the piece of content, /report for the daily summary.',
  ].filter(Boolean);

  return reply({
    text: lines.join('\n'),
    buttons: [
      { label: 'Create draft', command: `/draft ${clean}`, tone: 'good' },
      { label: 'Daily report', command: '/report', tone: 'neutral' },
    ],
  });
}

async function commandDraft(request, actor) {
  const { body, options } = parseFlags(request);
  const linkedTask = store.db.tasks.find((task) => task.id === (options.taskId || '').toUpperCase());

  const requestText = normalise(body) || linkedTask?.task || store.db.tasks[store.db.tasks.length - 1]?.task || '';
  if (!requestText) {
    return reply({ text: 'Usage: /draft Describe the content you want.\nExample: /draft Write a friendly Instagram caption for that Reel.' });
  }

  if (store.isDuplicate(`draft:${requestText}:${actor}`) && !options.reviseOf) {
    return reply({ text: '⚠️ Same draft request received twice — ignoring the duplicate (idempotency rule).' });
  }

  const platform = options.platform ? titleCase(options.platform) : detectPlatform(requestText);
  const tone = options.tone || detectTone(requestText);
  const taskId = linkedTask?.id || fallbackTaskId() || '';

  const taskContext = linkedTask ? `${linkedTask.task}. ${linkedTask.notes || ''}`.trim() : '';
  const content = await runContent({ request: requestText, platform, audience: options.audience, tone, research: taskContext });
  const qa = await runQuality({ draft: content.draft, platform, audience: options.audience });

  const draft = {
    id: store.nextId('draft'),
    taskId,
    createdAt: new Date().toISOString(),
    request: requestText,
    title: shortTitle(requestText),
    platform,
    audience: options.audience || '',
    tone,
    draft: content.draft,
    status: 'Awaiting approval',
    reviewer: '',
    decisionAt: null,
    feedback: '',
    version: 1,
    provider: content.provider,
    qa,
    history: [],
    source: actor,
  };
  store.db.drafts.push(draft);
  if (taskId) {
    const task = store.db.tasks.find((row) => row.id === taskId);
    if (task && task.status === 'Pending') task.status = 'In Progress';
  }
  store.save();
  store.audit('draft.created', { actor, ref: draft.id, detail: `${platform} v${draft.version} — awaiting approval` });

  return reply({
    text: approvalMessage(draft),
    buttons: draftButtons(draft),
    ref: draft.id,
  });
}

function shortTitle(text) {
  const clean = text.replace(/^(write|create|make|draft|prepare)\s+(a|an|the|one)?\s*/i, '');
  return clean.length > 70 ? `${clean.slice(0, 69)}…` : clean;
}

async function commandDecision(decision, rest, actor) {
  const ids = extractIds(rest, 'draft');
  let draft = ids.length ? findDraft(ids[0]) : latestAwaitingDraft();

  if (!draft) {
    return reply({ text: `No draft found for that ID. Use /report to see drafts awaiting approval, or /draft to create one.` });
  }
  const feedback = normalise(rest.replace(/\bD-\d{4}\b/i, '')).slice(0, 400);
  draft.reviewer = actor;
  draft.decisionAt = new Date().toISOString();

  if (decision === 'approve') {
    if (draft.status === 'Approved') return reply({ text: `${draft.id} is already approved. Nothing was sent anywhere — publishing stays manual (Chapter 9).` });
    draft.status = 'Approved';
    draft.feedback = feedback;
    draft.history.push({ at: draft.decisionAt, action: 'approve', actor, note: feedback });
    store.save();
    store.audit('draft.approved', { actor, ref: draft.id, detail: feedback || 'approved without note' });
    return reply({
      text: [
        `✅ ${draft.id} approved by you.`,
        '',
        'Copy it out and publish manually — this office never posts on its own.',
        'Recorded in the Drafts tab: status Approved.',
        feedback ? `Note: ${feedback}` : '',
      ].filter(Boolean).join('\n'),
      buttons: [
        { label: 'Copy draft', command: draft.draft, tone: 'neutral' },
        { label: 'Daily report', command: '/report', tone: 'neutral' },
      ],
      ref: draft.id,
    });
  }

  if (decision === 'reject') {
    draft.status = 'Rejected';
    draft.feedback = feedback;
    draft.history.push({ at: draft.decisionAt, action: 'reject', actor, note: feedback });
    store.save();
    store.audit('draft.rejected', { actor, ref: draft.id, detail: feedback || 'no reason given' });
    return reply({
      text: `🚫 ${draft.id} rejected.${feedback ? `\nReason: ${feedback}` : '\nNo reason recorded — add one next time so the agent can learn.'}`,
      ref: draft.id,
    });
  }

  // revise → regenerate a new version, still human-gated
  draft.status = 'Revision requested';
  draft.feedback = feedback;
  draft.history.push({ at: draft.decisionAt, action: 'revise', actor, note: feedback });
  store.save();
  store.audit('draft.revision_requested', { actor, ref: draft.id, detail: feedback || 'no feedback' });

  const revisedRequest = [draft.request, feedback ? `Revision feedback: ${feedback}` : ''].filter(Boolean).join('\n');
  const content = await runContent({
    request: revisedRequest,
    platform: draft.platform,
    audience: draft.audience,
    tone: draft.tone,
  });
  const qa = await runQuality({ draft: content.draft, platform: draft.platform, audience: draft.audience });

  const revision = {
    ...draft,
    id: store.nextId('draft'),
    createdAt: new Date().toISOString(),
    request: draft.request,
    draft: content.draft,
    status: 'Awaiting approval',
    reviewer: '',
    decisionAt: null,
    version: (draft.version || 1) + 1,
    provider: content.provider,
    qa,
    history: [...draft.history, { at: new Date().toISOString(), action: 'regenerated', actor: 'system', note: `v${(draft.version || 1) + 1}` }],
  };
  store.db.drafts.push(revision);
  store.save();

  return reply({
    text: [
      `📝 Revision requested for ${draft.id}.`,
      feedback ? `Feedback: ${feedback}` : 'No feedback given, so the agent produced a fresh version.',
      '',
      approvalMessage(revision),
    ].join('\n'),
    buttons: draftButtons(revision),
    ref: revision.id,
  });
}

async function commandReport(actor) {
  const tasks = store.db.tasks;
  const awaiting = store.db.drafts.filter((draft) => draft.status === 'Awaiting approval');
  const data = {
    date: todayKey(),
    completed: tasks.filter((task) => task.status === 'Done'),
    pending: tasks.filter((task) => task.status === 'Pending' || task.status === 'In Progress'),
    blocked: tasks.filter((task) => task.status === 'Blocked'),
    awaiting,
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
    awaiting: awaiting.map(({ id, platform, status }) => ({ id, platform, status })),
    priorities: data.priorities.slice(0, 3).map(({ id, task }) => ({ id, task })),
  });

  const entry = {
    date: data.date,
    ts: new Date().toISOString(),
    completed: data.completed.length,
    pending: data.pending.length,
    blocked: data.blocked.length,
    draftsAwaitingApproval: awaiting.length,
    notes: report.text,
    provider: report.provider,
  };
  const existing = store.db.dailyLog.findIndex((row) => row.date === entry.date);
  if (existing >= 0) store.db.dailyLog[existing] = entry;
  else store.db.dailyLog.push(entry);
  store.db.meta.lastReportAt = entry.ts;
  store.save();
  store.audit('report.generated', { actor, detail: `pending ${entry.pending}, awaiting ${entry.draftsAwaitingApproval}` });

  return reply({
    text: report.text,
    buttons: awaiting[0]
      ? [
          { label: `Review ${awaiting[0].id}`, command: `/approve ${awaiting[0].id}`, tone: 'good' },
          { label: 'All drafts', command: '/status', tone: 'neutral' },
        ]
      : [{ label: 'Plan work', command: '/task ', tone: 'neutral' }],
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
        '/lead design agencies | Pune | https://example.com/directory | Example Studio — active Instagram, no content plan',
        '',
        'Chapter 8 rules apply: public sources only, source URL mandatory, every lead marked "Needs human verification", never auto-contacted.',
      ].join('\n'),
    });
  }

  const parts = rest.split('|').map((part) => part.trim());
  const urlPart = parts.find((part) => /^https?:\/\//i.test(part)) || (text.match(/https?:\/\/\S+/) || [])[0] || '';
  const withoutUrl = parts.filter((part) => part !== urlPart);
  const niche = withoutUrl[0] || 'unspecified';
  const location = withoutUrl[1] || '';
  const notes = withoutUrl.slice(2).join('\n');

  const result = await runResearch({ niche, location, sourceUrl: urlPart, notes });
  if (!result.ok) {
    return reply({
      text: [
        '🛑 No lead rows were created.',
        '',
        result.reason || 'The agent needs a public source URL and your own notes — it will not invent businesses or contact details.',
        '',
        'Add your notes after the URL:',
        '/lead design agencies | Pune | https://example.com/directory | Example Studio — no visible content plan',
      ].join('\n'),
    });
  }

  const created = result.leads.map((lead) => {
    const row = {
      id: store.nextId('lead'),
      createdAt: new Date().toISOString(),
      businessName: lead.businessName,
      website: lead.website,
      niche: lead.niche || niche,
      sourceUrl: lead.sourceUrl,
      fitReason: lead.fitReason,
      contactStatus: 'Not contacted',
      reviewStatus: 'Needs human verification',
      nextAction: 'Open the source URL and verify manually',
      provider: result.provider,
      source: actor,
    };
    store.db.leads.push(row);
    return row;
  });
  store.save();
  store.audit('lead.created', { actor, ref: created.map((lead) => lead.id).join(','), detail: `${created.length} rows from ${urlPart}` });

  return reply({
    text: [
      `🔎 ${created.length} lead row${created.length === 1 ? '' : 's'} prepared — all marked "Needs human verification".`,
      '',
      ...created.map((lead) => `${lead.id} · ${lead.businessName}\n   ${lead.fitReason || 'no fit reason'}\n   Source: ${lead.sourceUrl}`),
      '',
      'No contact details were invented. Verify the source before any outreach, and send every message yourself.',
      `Engine: ${result.provider}`,
    ].join('\n'),
    buttons: created[0]
      ? [{ label: 'Draft outreach', command: `/outreach ${created[0].id}`, tone: 'neutral' }]
      : [],
  });
}

async function commandOutreach(rest, actor) {
  const ids = extractIds(rest, 'lead');
  const lead = ids.length ? store.db.leads.find((row) => row.id === ids[0]) : null;
  if (!lead) {
    return reply({ text: 'Usage: /outreach L-0001\nCreates a draft only. Nothing is sent — you send every message yourself.' });
  }
  const result = await runOutreach({ businessName: lead.businessName, website: lead.website, fitReason: lead.fitReason });
  store.audit('outreach.drafted', { actor, ref: lead.id, detail: `${result.wordCount} words — not sent` });
  return reply({
    text: [
      `✍️ Outreach draft for ${lead.id} · ${lead.businessName} (${result.wordCount} words)`,
      '',
      result.draft,
      '',
      'Status: Needs human verification. This was NOT sent — copy it, check the facts, then send it yourself.',
    ].join('\n'),
    buttons: [{ label: 'Verify lead', command: `/status`, tone: 'neutral' }],
    ref: lead.id,
  });
}

async function commandVerify(rest, actor) {
  const ids = extractIds(rest, 'lead');
  if (!ids.length) return reply({ text: 'Usage: /verify L-0001 — marks a lead as checked by a human.' });
  const lead = store.db.leads.find((row) => row.id === ids[0]);
  if (!lead) return reply({ text: `Lead ${ids[0]} not found.` });
  lead.reviewStatus = 'Verified by human';
  lead.nextAction = 'Eligible for a manual outreach draft';
  store.save();
  store.audit('lead.verified', { actor, ref: lead.id, detail: 'reviewed against source by a human' });
  return reply({
    text: [
      `✅ ${lead.id} · ${lead.businessName} marked "Verified by human".`,
      `Source checked: ${lead.sourceUrl}`,
      '',
      'Next: /outreach ' + lead.id + ' for a draft. You still send every message yourself.',
    ].join('\n'),
    ref: lead.id,
  });
}

async function commandFollowup(rest, actor) {
  const company = normalise(rest) || 'the client';
  const result = await runFollowup({ clientName: company, context: 'the work we discussed', priorInteraction: '' });
  store.audit('followup.drafted', { actor, detail: `follow-up for ${company}` });
  return reply({
    text: [`📨 Follow-up draft for ${company} — not sent.`, '', result.draft, '', `Engine: ${result.provider}`].join('\n'),
  });
}

function commandTaskStatus(command, rest, actor) {
  const ids = extractIds(rest, 'task');
  const config = TASK_STATUS_COMMANDS[command];
  if (!ids.length) {
    return reply({ text: `Usage: ${command} T-0001${command === '/block' ? ' reason' : ''}` });
  }
  const task = store.db.tasks.find((row) => row.id === ids[0]);
  if (!task) return reply({ text: `Task ${ids[0]} not found. Try /report to see open tasks.` });

  task.status = config.status;
  if (command === '/block') {
    const reason = normalise(rest.replace(/T-\d{4}/i, ''));
    if (reason) task.notes = reason;
  }
  store.save();
  store.audit('task.status', { actor, ref: task.id, detail: `${config.status}${command === '/block' ? ` — ${task.notes}` : ''}` });

  return reply({
    text: `🔄 ${task.id} ${config.label}.\n${task.task}${command === '/block' && task.notes ? `\nReason: ${task.notes}` : ''}`,
    ref: task.id,
  });
}

function commandStatus() {
  const tasks = store.db.tasks;
  const drafts = store.db.drafts;
  const leads = store.db.leads;
  const awaiting = drafts.filter((draft) => draft.status === 'Awaiting approval');
  const byStatus = tasks.reduce((acc, task) => ({ ...acc, [task.status]: (acc[task.status] || 0) + 1 }), {});

  const text = [
    '📊 OFFICE STATUS',
    '',
    `Tasks: ${tasks.length} total · ${Object.entries(byStatus).map(([key, value]) => `${key} ${value}`).join(' · ') || 'none yet'}`,
    `Drafts: ${drafts.length} total · ${awaiting.length} awaiting approval`,
    `Leads: ${leads.length} total · ${leads.filter((lead) => lead.reviewStatus === 'Needs human verification').length} need verification`,
    `Model calls today: ${store.usageToday()} / ${store.settings.maxCallsPerDay}`,
    `Provider setting: ${store.settings.provider}`,
    `Report last generated: ${store.db.meta.lastReportAt ? officeTime(new Date(store.db.meta.lastReportAt)) : 'never'}`,
    '',
    awaiting.length ? `Awaiting: ${awaiting.map((draft) => draft.id).join(', ')}` : 'Nothing awaiting approval.',
    '',
    'Nothing publishes or messages automatically — every draft needs /approve.',
  ].join('\n');

  return reply({ text });
}

export const titleCase = (value = '') =>
  String(value)
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
