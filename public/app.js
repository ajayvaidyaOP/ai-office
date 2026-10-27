/* ═══════════════════════════════════════════════════════════════
   AI INVINCIBLE OFFICE — front-end controller
   Vanilla ES modules. No build step. One source of truth: GET /api/state.
   ═══════════════════════════════════════════════════════════════ */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ui = {
  state: null,
  view: 'dashboard',
  filters: { approvals: 'Awaiting approval', tasks: 'open' },
  clientQuery: '',
  reportTab: 'daily',
  busy: false,
  chatClearedAt: 0,
  docs: [],
  activeDoc: null,
  paletteIndex: 0,
  paletteItems: [],
  drawerClientId: null,
};

const esc = (value = '') =>
  String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const inr = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`;
const num = (value) => Number(value || 0).toLocaleString('en-IN');
const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const timeLabel = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
};

const dayLabel = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
};

const fullDay = (iso) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' });
};

const daysFromToday = (dateOnly) => {
  if (!dateOnly) return null;
  const target = new Date(`${String(dateOnly).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86_400_000);
};

const dueLabel = (dateOnly) => {
  const diff = daysFromToday(dateOnly);
  if (diff === null) return '';
  if (diff === 0) return 'today';
  if (diff === 1) return 'tomorrow';
  if (diff === -1) return 'yesterday';
  if (diff < 0) return `${Math.abs(diff)} days overdue`;
  return `in ${diff} days`;
};

/* ── toast ─────────────────────────────────────────────────── */

let toastTimer;
function toast(message, tone = '') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast is-visible ${tone ? `is-${tone}` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { node.className = 'toast'; }, 3600);
}

/* ── api ───────────────────────────────────────────────────── */

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const json = await response.json().catch(() => ({ ok: false, error: 'Unexpected server response' }));
  if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
  return json;
}

async function refresh() {
  ui.state = await api('/api/state');
  renderAll();
}

async function mutate(path, body, { toastMessage, tone = 'good', then } = {}) {
  try {
    const result = await api(path, { method: 'POST', body: body === undefined ? '{}' : JSON.stringify(body) });
    if (result.state) {
      ui.state = result.state;
      renderAll();
    } else {
      await refresh();
    }
    if (toastMessage) toast(toastMessage, tone);
    if (then) then(result);
    return result;
  } catch (error) {
    toast(error.message, 'bad');
    throw error;
  }
}

async function sendCommand(raw) {
  const text = String(raw || '').trim();
  if (!text || ui.busy) return;
  ui.busy = true;
  setView('console');
  appendLocalMessage({ role: 'user', text, ts: new Date().toISOString() });
  showTyping(true);
  try {
    const result = await api('/api/command', { method: 'POST', body: JSON.stringify({ raw: text }) });
    ui.state = result.state;
    ui.busy = false;
    showTyping(false);
    renderAll();
  } catch (error) {
    ui.busy = false;
    showTyping(false);
    appendLocalMessage({ role: 'system', text: `⚠️ ${error.message}`, ts: new Date().toISOString() });
    toast(error.message, 'bad');
  }
}

/* ── helpers ───────────────────────────────────────────────── */

const icon = (name, cls = 'ic') => `<svg class="${cls}"><use href="#i-${name}" /></svg>`;

const STAGE_TONE = {
  Lead: 'violet',
  'Proposal sent': 'cyan',
  Negotiation: 'amber',
  Won: 'lime',
  Lost: 'rose',
  New: '',
  Verified: 'cyan',
  Contacted: 'violet',
  Replied: 'amber',
};
const stageTag = (stage) => `<span class="tag tag-${STAGE_TONE[stage] || ''}">${esc(stage)}</span>`;

const priorityTone = (priority) => ({ High: 'rose', Medium: 'amber', Low: 'cyan' }[priority] || '');
const priorityTag = (priority) => `<span class="tag tag-${priorityTone(priority)}">${esc(priority)}</span>`;

const STATUS_TONE = {
  Pending: 'amber',
  'In Progress': 'cyan',
  Blocked: 'rose',
  Done: 'lime',
  Approved: 'lime',
  'Awaiting approval': 'amber',
  'Revision requested': 'cyan',
  Rejected: 'rose',
};
const statusTag = (status) => `<span class="tag tag-${STATUS_TONE[status] || ''}">${esc(status)}</span>`;

const kindLabel = (kind) => ({ content: 'Content', outreach: 'Outreach', proposal: 'Proposal' }[kind || 'content'] || 'Content');
const kindIcon = (kind) => ({ content: 'sparkles', outreach: 'send', proposal: 'briefcase' }[kind || 'content'] || 'sparkles');

const initials = (name = '') =>
  name
    .replace(/[^A-Za-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join('') || 'AI';

const emptyState = (title, hint = '') =>
  `<div class="empty-state"><b>${esc(title)}</b>${hint ? `<span>${hint}</span>` : ''}</div>`;

/* ── derived numbers ───────────────────────────────────────── */

function officeScore() {
  const data = ui.state?.dashboard?.overview;
  if (!data) return { score: 50, items: [] };
  const awaiting = data.drafts.awaiting;
  const overdue = data.tasks.overdue;
  const unverified = data.leads.needsVerification;
  const weeklyTarget = data.pipeline.weeklyTarget || 1;
  const progress = clamp((data.pipeline.wonValue / weeklyTarget) * 20, 0, 20);
  const approvalHealth = data.drafts.total ? (data.drafts.approved / data.drafts.total) * 12 : 6;
  const score = clamp(Math.round(58 + progress + approvalHealth - awaiting * 5 - overdue * 6 - unverified * 2), 8, 98);
  return {
    score,
    items: [
      { label: `${awaiting} awaiting approval`, tone: awaiting ? '#fbbf24' : '#a3e635' },
      { label: `${overdue} overdue task${overdue === 1 ? '' : 's'}`, tone: overdue ? '#fb7185' : '#a3e635' },
      { label: `${data.leads.verified}/${data.leads.total} leads verified`, tone: '#22d3ee' },
    ],
  };
}

/* ── dashboard ─────────────────────────────────────────────── */

function renderDashboard() {
  const state = ui.state;
  if (!state) return;
  const data = state.dashboard;
  const o = data.overview;
  const settings = state.meta.settings || {};
  const owner = settings.ownerName || 'Founder';

  const hour = new Date().getHours();
  const greeting = hour < 5 ? 'Still working' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  $('#hero-date').textContent = fullDay(new Date().toISOString()).toUpperCase();
  $('#hero-greeting').textContent = `${greeting}, ${owner}.`;

  const lines = [];
  if (o.drafts.awaiting) lines.push(`${o.drafts.awaiting} draft${o.drafts.awaiting === 1 ? '' : 's'} waiting on your approval`);
  if (o.tasks.overdue) lines.push(`${o.tasks.overdue} task${o.tasks.overdue === 1 ? '' : 's'} overdue`);
  if (o.followUps.due) lines.push(`${o.followUps.due} follow-up${o.followUps.due === 1 ? '' : 's'} due`);
  if (!lines.length) lines.push('Queue is clear. Plan the next move or hunt for a new client.');
  $('#hero-line').textContent =
    o.drafts.awaiting
      ? `${lines.join(' · ')}. Clear approvals first — nothing ships without you.`
      : `${lines.join(' · ')}.`;

  const { score, items } = officeScore();
  $('#ring-value').style.strokeDashoffset = String(314 - (314 * score) / 100);
  $('#ring-value').style.stroke = score > 75 ? '#a3e635' : score > 45 ? '#a78bfa' : '#fb7185';
  $('#score-number').textContent = score;
  $('#score-legend').innerHTML = items
    .map((item) => `<li><span class="dot" style="background:${item.tone}"></span>${esc(item.label)}</li>`)
    .join('');

  const kpis = [
    {
      label: 'Awaiting approval',
      value: o.drafts.awaiting,
      icon: 'check-circle',
      accent: '#fbbf24',
      soft: 'rgba(251,191,36,0.13)',
      foot: o.drafts.awaiting ? `${o.drafts.awaiting} draft${o.drafts.awaiting === 1 ? '' : 's'} blocked on you` : 'All clear',
    },
    {
      label: 'Open pipeline',
      value: inr(o.pipeline.openValue),
      icon: 'wallet',
      accent: '#a78bfa',
      soft: 'rgba(139,92,246,0.14)',
      foot: `${o.pipeline.openCount} live deal${o.pipeline.openCount === 1 ? '' : 's'} · won ${inr(o.pipeline.wonValue)}`,
    },
    {
      label: 'Tasks open',
      value: o.tasks.open,
      icon: 'bolt',
      accent: '#22d3ee',
      soft: 'rgba(34,211,238,0.13)',
      foot: `${o.tasks.dueToday} due today · ${o.tasks.overdue} overdue`,
    },
    {
      label: 'Clients',
      value: o.clients.total,
      icon: 'briefcase',
      accent: '#a3e635',
      soft: 'rgba(163,230,53,0.13)',
      foot: `${o.leads.needsVerification} lead${o.leads.needsVerification === 1 ? '' : 's'} need verification`,
    },
  ];

  $('#kpi-grid').innerHTML = kpis
    .map(
      (kpi) => `
      <article class="kpi" style="--accent:${kpi.accent};--accent-soft:${kpi.soft}">
        <div class="kpi-top">
          <span class="kpi-label">${esc(kpi.label)}</span>
          <span class="kpi-icon">${icon(kpi.icon)}</span>
        </div>
        <div class="kpi-value">${kpi.value}</div>
        <div class="kpi-foot">${esc(kpi.foot)}</div>
      </article>`,
    )
    .join('');

  const missionIcons = { approval: 'check-circle', task: 'bolt', followup: 'clock', verify: 'target' };
  const missionTones = {
    approval: ['#fbbf24', 'rgba(251,191,36,0.13)'],
    task: ['#c4b5fd', 'rgba(139,92,246,0.14)'],
    followup: ['#22d3ee', 'rgba(34,211,238,0.13)'],
    verify: ['#a3e635', 'rgba(163,230,53,0.13)'],
  };
  $('#mission-list').innerHTML = data.mission.length
    ? data.mission
        .slice(0, 6)
        .map((item) => {
          const [tone, soft] = missionTones[item.kind] || missionTones.task;
          return `<div class="mission-item" data-mission="${esc(item.kind)}" data-ref="${esc(item.ref)}">
            <span class="mission-icon" style="--tone:${tone};--tone-soft:${soft}">${icon(missionIcons[item.kind] || 'bolt')}</span>
            <span class="mission-main"><b>${esc(item.title)}</b><span>${esc(item.reason)}</span></span>
            <span class="mission-go">${icon('arrow-right')}</span>
          </div>`;
        })
        .join('')
    : emptyState('Nothing urgent', 'Run /task or /find to create the next move.');

  const maxStage = Math.max(1, ...o.pipeline.byStage.map((s) => s.value || s.count));
  $('#funnel').innerHTML = o.pipeline.byStage
    .map((stage) => {
      const width = Math.max(3, Math.round(((stage.value || stage.count) / maxStage) * 100));
      return `<div class="funnel-row">
        <span class="f-stage">${esc(stage.stage)}</span>
        <span class="funnel-track"><span class="funnel-bar" style="width:${width}%"></span></span>
        <b>${stage.value ? inr(stage.value) : '—'}</b>
      </div>`;
    })
    .join('');

  $('#funnel-foot').innerHTML = `
    <span>Win rate <b>${o.pipeline.winRate}%</b></span>
    <span>Avg deal <b>${inr(o.pipeline.avgDeal)}</b></span>
    <span>Target <b>${inr(o.pipeline.target)}/mo</b></span>`;

  const waiting = (state.drafts || []).filter((draft) => draft.status === 'Awaiting approval').slice(0, 4);
  $('#approval-mini').innerHTML = waiting.length
    ? waiting
        .map(
          (draft) => `<div class="approval-line">
            <span class="agent-dot">${esc(initials(kindLabel(draft.kind)))}</span>
            <span class="a-main"><b>${esc(draft.title || draft.request)}</b><small>${esc(draft.id)} · ${esc(draft.platform)} · ${esc(kindLabel(draft.kind))}</small></span>
            <span class="a-actions">
              <button class="mini-act good" data-approve="${esc(draft.id)}" title="Approve">${icon('check')}</button>
              <button class="mini-act" data-open-approval="${esc(draft.id)}" title="Review">${icon('arrow-right')}</button>
            </span>
          </div>`,
        )
        .join('')
    : emptyState('Inbox zero', 'Every draft has a decision.');

  renderActivityChart();

  const followUps = [...(data.overview.followUps.list || [])];
  $('#followup-list').innerHTML = followUps.length
    ? followUps
        .slice(0, 5)
        .map(
          (row) => `<div class="list-row">
            <span class="agent-dot">${esc(initials(row.name))}</span>
            <span class="l-main"><b>${esc(row.name)}</b><small>${esc(row.id)} · ${row.kind === 'client' ? 'client' : 'lead'}</small></span>
            <time>${esc(dueLabel(row.date))}</time>
          </div>`,
        )
        .join('')
    : emptyState('No follow-ups due', 'Schedule one from a client card.');

  const agents = (state.agents || []).slice(0, 8);
  $('#agent-grid').innerHTML = agents
    .map((agent) => {
      const stats = data.agents.find((row) => row.agent === agent.id) || { runs: 0, okRate: 100 };
      return `<div class="agent-card" title="${esc(agent.responsibility)}">
        <span class="agent-dot">${esc(initials(agent.name))}</span>
        <span class="ag-main"><b>${esc(agent.name)}</b><small>${stats.runs} runs · ${stats.okRate}% ok</small></span>
      </div>`;
    })
    .join('');
}

function renderActivityChart() {
  const series = ui.state?.dashboard?.activity || [];
  const chart = $('#activity-chart');
  if (!series.length) {
    chart.innerHTML = emptyState('No activity yet');
    return;
  }
  const width = 520;
  const height = 140;
  const padding = 6;
  const maxRuns = Math.max(1, ...series.map((d) => d.runs));
  const maxAll = Math.max(maxRuns, ...series.map((d) => d.drafts));

  const point = (index, value) => ({
    x: padding + (index / Math.max(1, series.length - 1)) * (width - padding * 2),
    y: height - padding - (value / maxAll) * (height - padding * 2 - 8),
  });

  const runsPoints = series.map((d, i) => point(i, d.runs));
  const draftPoints = series.map((d, i) => point(i, d.drafts));
  const line = (points) => points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line(runsPoints)} L${width - padding},${height} L${padding},${height} Z`;
  const totalRuns = series.reduce((sum, d) => sum + d.runs, 0);

  chart.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="Agent runs over 14 days">
      <defs>
        <linearGradient id="sparkFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="#8b5cf6" stop-opacity="0.38" />
          <stop offset="100%" stop-color="#8b5cf6" stop-opacity="0" />
        </linearGradient>
      </defs>
      <path class="spark-area" d="${area}" />
      <path class="spark-line" d="${line(runsPoints)}" vector-effect="non-scaling-stroke" />
      <path class="spark-line-2" d="${line(draftPoints)}" vector-effect="non-scaling-stroke" />
      ${runsPoints.map((p) => `<circle class="spark-dot" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="2" />`).join('')}
    </svg>`;
  $('#activity-total').textContent = `${totalRuns} runs`;
}

/* ── console ───────────────────────────────────────────────── */

const WELCOME = {
  role: 'bot',
  text: [
    '👋 Welcome to AI Invincible Office.',
    '',
    'I am your manager. I plan the work, draft the content, find clients with you, and hold every draft until you approve it.',
    '',
    'Try:',
    '/brief — today’s focus',
    '/task Plan a beginner-friendly Instagram Reel about free AI tools',
    '/find cafés in Pune',
  ].join('\n'),
  buttons: [
    { label: 'Morning brief', command: '/brief', tone: 'good' },
    { label: 'Find clients', command: '/find cafés in Pune', tone: 'neutral' },
    { label: 'Commands', command: '/help', tone: 'neutral' },
  ],
  ts: '',
};

function messageNode(message) {
  const wrap = document.createElement('div');
  const role = message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'bot';
  wrap.className = `msg msg-${role}`;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = message.text;
  wrap.appendChild(bubble);

  if (Array.isArray(message.buttons) && message.buttons.length) {
    const bar = document.createElement('div');
    bar.className = 'msg-buttons';
    for (const button of message.buttons) {
      const element = document.createElement('button');
      element.type = 'button';
      element.className = `quick-btn ${button.tone || ''}`.trim();
      element.textContent = button.label;
      element.addEventListener('click', () => handleQuickButton(button));
      bar.appendChild(element);
    }
    wrap.appendChild(bar);
  }

  if (message.ts) {
    const time = document.createElement('span');
    time.className = 'msg-time';
    time.textContent = timeLabel(message.ts);
    wrap.appendChild(time);
  }
  return wrap;
}

function handleQuickButton(button) {
  const command = String(button.command || '');
  if (!command.startsWith('/')) {
    navigator.clipboard
      ?.writeText(command)
      .then(() => toast('Copied — publish it yourself when ready.', 'good'))
      .catch(() => toast('Copy failed. Select the text manually.', 'bad'));
    return;
  }
  if (command.endsWith(' ')) {
    openModal({
      title: button.label,
      message: 'Add the detail the agent needs. You stay in control.',
      fields: [{ name: 'value', label: 'Detail', type: 'textarea', rows: 3, placeholder: 'Your feedback…' }],
      confirmLabel: 'Send',
      onConfirm: (values) => {
        const suffix = String(values.value || '').trim();
        if (!suffix) return toast('Add a short note first.', 'bad'), false;
        sendCommand(`${command.trim()} ${suffix}`);
        return true;
      },
    });
    return;
  }
  sendCommand(command);
}

function renderChat() {
  const stream = $('#chat-stream');
  if (!stream) return;
  const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 100;
  const previousTop = stream.scrollTop;
  stream.innerHTML = '';
  const messages = (ui.state?.messages || []).filter((m) => new Date(m.ts).getTime() > ui.chatClearedAt);
  for (const message of messages.length ? messages : [WELCOME]) stream.appendChild(messageNode(message));
  showTyping(ui.busy);
  if (!nearBottom) stream.scrollTop = previousTop;
  else stream.scrollTop = stream.scrollHeight;
}

function appendLocalMessage(message) {
  const stream = $('#chat-stream');
  if (!stream) return;
  stream.querySelector('.typing-wrap')?.remove();
  stream.appendChild(messageNode(message));
  stream.scrollTop = stream.scrollHeight;
}

function showTyping(show) {
  const stream = $('#chat-stream');
  if (!stream) return;
  stream.querySelector('.typing-wrap')?.remove();
  if (!show) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-bot typing-wrap';
  wrap.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>';
  stream.appendChild(wrap);
  stream.scrollTop = stream.scrollHeight;
}

function renderConsole() {
  const state = ui.state;
  const o = state?.dashboard?.overview;
  if (!o) return;
  $('#mini-awaiting').textContent = o.drafts.awaiting;
  $('#mini-open').textContent = o.tasks.open;
  $('#mini-pipeline').textContent = inr(o.pipeline.openValue);
  $('#mini-verified').textContent = `${o.leads.verified}/${o.leads.total}`;
  $('#chat-status').textContent = o.drafts.awaiting
    ? `Online · ${o.drafts.awaiting} draft${o.drafts.awaiting === 1 ? '' : 's'} waiting for you`
    : 'Online · approval gates on';

  const brief = state.meta.lastBrief;
  $('#mini-brief-text').textContent = brief?.text || 'No brief yet. Generate one to see today’s focus.';

  const quick = [
    { label: 'Morning brief', icon: 'moon', action: '/brief' },
    { label: 'New task', icon: 'bolt', action: '/task ' },
    { label: 'Find clients', icon: 'target', action: '/find ' },
    { label: 'Draft post', icon: 'sparkles', action: '/draft ' },
    { label: 'Daily report', icon: 'chart', action: '/report' },
    { label: 'Clients', icon: 'briefcase', action: '/clients' },
  ];
  $('#quick-grid').innerHTML = quick
    .map((item) => `<button class="quick-action" data-quick="${esc(item.action)}">${icon(item.icon)}${esc(item.label)}</button>`)
    .join('');
}

/* ── approvals ─────────────────────────────────────────────── */

function renderApprovals() {
  const state = ui.state;
  if (!state) return;
  const filter = ui.filters.approvals;
  const all = state.drafts || [];
  const awaiting = all.filter((draft) => draft.status === 'Awaiting approval');
  $('#seg-awaiting').textContent = awaiting.length;

  const list = filter === 'all' ? all : all.filter((draft) => draft.status === filter);
  const host = $('#approval-list');

  if (!list.length) {
    host.innerHTML = emptyState(
      filter === 'Awaiting approval' ? 'Nothing waiting' : 'Nothing here yet',
      filter === 'Awaiting approval' ? 'Every draft has a decision. Generate one with /draft.' : 'Try another filter.',
    );
    return;
  }

  host.innerHTML = list
    .map((draft) => {
      const qa = draft.qa;
      const qaTone = qa?.decision === 'reject' ? 'bad' : qa?.decision === 'revise' ? 'warn' : '';
      const awaitingThis = draft.status === 'Awaiting approval';
      return `<article class="card approval-card" data-draft-card="${esc(draft.id)}">
        <div class="ac-head">
          <div class="ac-title">
            <strong>${esc(draft.title || draft.request)}</strong>
            <small>${esc(draft.id)} · ${esc(draft.platform)} · v${draft.version || 1} · ${esc(draft.provider || 'offline')}${draft.taskId ? ` · ${esc(draft.taskId)}` : ''}${draft.leadId ? ` · ${esc(draft.leadId)}` : ''}${draft.clientId ? ` · ${esc(draft.clientId)}` : ''}</small>
          </div>
          <div class="ac-tags">
            <span class="tag tag-violet">${icon(kindIcon(draft.kind), 'ic')}${esc(kindLabel(draft.kind))}</span>
            ${statusTag(draft.status)}
          </div>
        </div>
        <pre class="draft-body">${esc(draft.draft)}</pre>
        ${qa ? `<div class="qa-note ${qaTone}">${icon(qa.decision === 'approve' ? 'check' : 'alert')}
          <div><b>Quality Checker: ${esc(qa.decision)}</b>${qa.issues?.length ? `<ul>${qa.issues.map((issue) => `<li>${esc(issue)}</li>`).join('')}</ul>` : ' — no blocking issues'}</div>
        </div>` : ''}
        <div class="ac-actions">
          ${awaitingThis ? `<button class="btn btn-sm btn-primary" data-approve="${esc(draft.id)}">${icon('check')}Approve</button>` : ''}
          ${draft.status !== 'Rejected' ? `<button class="btn btn-sm btn-ghost" data-revise="${esc(draft.id)}">${icon('refresh')}Request revision</button>` : ''}
          ${awaitingThis ? `<button class="btn btn-sm btn-ghost" data-reject="${esc(draft.id)}">${icon('close')}Reject</button>` : ''}
          <button class="btn btn-sm btn-ghost" data-copy="${esc(draft.id)}">${icon('copy')}Copy</button>
          <span class="ac-meta">${draft.decisionAt ? `${esc(dayLabel(draft.decisionAt))} ${esc(timeLabel(draft.decisionAt))}` : `created ${esc(dayLabel(draft.createdAt))}`}${draft.feedback ? ` · “${esc(draft.feedback.slice(0, 46))}”` : ''}</span>
        </div>
      </article>`;
    })
    .join('');
}

/* ── work ──────────────────────────────────────────────────── */

function renderTasks() {
  const state = ui.state;
  if (!state) return;
  const filter = ui.filters.tasks;
  const all = state.tasks || [];
  const rows = all.filter((task) => {
    if (filter === 'open') return task.status !== 'Done';
    if (filter === 'all') return true;
    return task.status === filter;
  });

  $('#task-list').innerHTML = rows.length
    ? rows
        .map((task) => {
          const done = task.status === 'Done';
          const due = task.deadline ? dueLabel(task.deadline) : '';
          const overdue = task.status !== 'Done' && daysFromToday(task.deadline) < 0;
          return `<div class="task-row ${done ? 'is-done' : ''}">
            <span class="priority-bar priority-${esc(task.priority)}"></span>
            <button class="task-check" data-task-done="${esc(task.id)}" title="${done ? 'Reopen' : 'Mark done'}">${icon('check')}</button>
            <div class="task-main">
              <b>${esc(task.task)}</b>
              <div class="task-sub">
                <span class="mono">${esc(task.id)}</span>
                ${priorityTag(task.priority)}
                <span>${esc(task.owner)}</span>
                ${task.deadline ? `<span style="${overdue ? 'color:#fb7185' : ''}">${esc(task.deadline)} · ${esc(due)}</span>` : '<span>no deadline</span>'}
                ${task.status === 'Blocked' ? `<span style="color:#fb7185">blocked${task.notes ? `: ${esc(task.notes.slice(0, 40))}` : ''}</span>` : ''}
              </div>
            </div>
            <div class="task-actions">
              ${!done ? `<button class="mini-act" data-task-progress="${esc(task.id)}" title="In progress">${icon('play')}</button>` : ''}
              ${!done ? `<button class="mini-act bad" data-task-block="${esc(task.id)}" title="Block">${icon('alert')}</button>` : ''}
              <button class="mini-act bad" data-task-delete="${esc(task.id)}" title="Delete">${icon('trash')}</button>
            </div>
          </div>`;
        })
        .join('')
    : emptyState('No tasks in this view', 'Use /task or the New button to plan work.');
}

/* ── clients ───────────────────────────────────────────────── */

function renderClients() {
  const state = ui.state;
  if (!state) return;
  const o = state.dashboard.overview;
  $('#client-kpis').innerHTML = [
    { label: 'Open pipeline', value: inr(o.pipeline.openValue) },
    { label: 'Won', value: inr(o.pipeline.wonValue) },
    { label: 'Win rate', value: `${o.pipeline.winRate}%` },
    { label: 'Active deals', value: o.pipeline.openCount },
  ]
    .map((item) => `<div class="kpi-chip"><span>${esc(item.label)}</span><b>${item.value}</b></div>`)
    .join('');

  const query = ui.clientQuery.toLowerCase();
  const clients = (state.clients || []).filter(
    (client) =>
      !query ||
      [client.company, client.contact, client.niche, client.notes].join(' ').toLowerCase().includes(query),
  );

  const stages = ['Lead', 'Proposal sent', 'Negotiation', 'Won'];
  $('#client-kanban').innerHTML = stages
    .map((stage) => {
      const rows = clients.filter((client) => client.stage === stage);
      return `<div class="kanban-col">
        <div class="kanban-head"><b>${esc(stage)}</b><span class="n">${rows.length}</span></div>
        ${
          rows.length
            ? rows
                .map(
                  (client) => `<div class="client-card" data-client="${esc(client.id)}">
                    <b>${esc(client.company)}</b>
                    <div class="cc-meta"><span>${esc(client.contact || 'Owner')}</span><span>${esc(client.niche || '')}</span></div>
                    <div class="cc-value">${inr(client.value)}</div>
                    ${client.nextFollowUp ? `<div class="cc-next">follow-up ${esc(dueLabel(client.nextFollowUp))}</div>` : ''}
                  </div>`,
                )
                .join('')
            : `<div class="empty-state" style="padding:18px 6px"><span>Empty</span></div>`
        }
      </div>`;
    })
    .join('') +
    (clients.some((client) => client.stage === 'Lost')
      ? `<div class="kanban-col" style="grid-column:1/-1">
          <div class="kanban-head"><b>Lost</b><span class="n">${clients.filter((c) => c.stage === 'Lost').length}</span></div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${clients
            .filter((client) => client.stage === 'Lost')
            .map((client) => `<div class="client-card" style="flex:1;min-width:180px;opacity:.7" data-client="${esc(client.id)}"><b>${esc(client.company)}</b><div class="cc-meta"><span>${esc(client.contact)}</span><span>${inr(client.value)}</span></div></div>`)
            .join('')}</div>
        </div>`
      : '');
}

/* ── finder ────────────────────────────────────────────────── */

let finderPlan = null;

function renderFinder() {
  const state = ui.state;
  if (!state) return;
  const o = state.dashboard.overview;
  $('#leads-tag').textContent = `${o.leads.total} leads · ${o.leads.needsVerification} to verify`;

  const stages = state.dashboard.overview.leads.byStage;
  const max = Math.max(1, ...stages.map((s) => s.count));
  $('#lead-stages').innerHTML = stages
    .map(
      (stage) => `<div class="lead-stage-row">
        <span>${esc(stage.stage)}</span>
        <span class="lead-stage-track"><span class="lead-stage-bar" style="width:${Math.round((stage.count / max) * 100)}%"></span></span>
        <b>${stage.count}</b>
      </div>`,
    )
    .join('');

  if (finderPlan) renderFinderPlan(finderPlan);
}

function renderFinderPlan(plan) {
  const host = $('#finder-result');
  const block = (title, items, ordered = false) => `
    <div class="plan-block">
      <h5>${esc(title)}</h5>
      <${ordered ? 'ol' : 'ul'}>${items.map((item) => `<li>${esc(item)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>
    </div>`;

  host.innerHTML = `
    <div class="qa-note">${icon('sparkles')}<div><b>${esc(plan.summary || 'Research plan ready')}</b><br>Save the queries, verify every row by hand, then add leads below.</div></div>
    ${block('Search queries', plan.queries || [], true)}
    ${block('Where to look', plan.directories || [])}
    ${block('Verify before adding', plan.checklist || [])}
    ${block('Red flags', plan.red_flags || [])}
    <div class="drawer-actions">
      <button class="btn btn-sm btn-ghost" id="copy-plan">${icon('copy')}Copy plan</button>
      <button class="btn btn-sm btn-primary" id="plan-to-leads">${icon('plus')}Add leads from this plan</button>
    </div>`;

  $('#copy-plan').addEventListener('click', () => {
    const text = [
      plan.summary,
      '',
      'Search queries:',
      ...(plan.queries || []).map((q, i) => `${i + 1}. ${q}`),
      '',
      'Directories:',
      ...(plan.directories || []).map((d) => `- ${d}`),
      '',
      'Checklist:',
      ...(plan.checklist || []).map((c) => `- ${c}`),
      '',
      'Red flags:',
      ...(plan.red_flags || []).map((r) => `- ${r}`),
    ].join('\n');
    navigator.clipboard?.writeText(text).then(() => toast('Plan copied.', 'good')).catch(() => toast('Copy failed.', 'bad'));
  });

  $('#plan-to-leads').addEventListener('click', () => {
    const sourceInput = $('#lead-form [name="sourceUrl"]');
    const notesInput = $('#lead-form [name="notes"]');
    const nicheInput = $('#lead-form [name="niche"]');
    const locationInput = $('#lead-form [name="location"]');
    if (plan.niche) nicheInput.value = plan.niche;
    if (plan.location) locationInput.value = plan.location;
    sourceInput.focus();
    notesInput.placeholder = 'Paste the businesses you verified, one per line: Name — observation';
    toast('Source URL add karein, phir observations paste karein.', 'good');
  });
}

/* ── calendar ──────────────────────────────────────────────── */

function renderCalendar() {
  const state = ui.state;
  if (!state) return;
  const items = [];

  for (const task of state.tasks || []) {
    if (task.status === 'Done' || !task.deadline) continue;
    items.push({ date: task.deadline, kind: 'task', title: task.task, meta: `${task.id} · ${task.priority} · ${task.owner}` });
  }
  for (const client of state.clients || []) {
    if (!client.nextFollowUp || ['Won', 'Lost'].includes(client.stage)) continue;
    items.push({ date: client.nextFollowUp, kind: 'followup', title: `Follow up with ${client.company}`, meta: `${client.id} · ${client.stage} · ${inr(client.value)}` });
  }
  for (const lead of state.leads || []) {
    if (!lead.nextFollowUp || ['Won', 'Lost'].includes(lead.stage)) continue;
    items.push({ date: lead.nextFollowUp, kind: 'followup', title: `Follow up with ${lead.businessName}`, meta: `${lead.id} · lead · score ${lead.score || 0}` });
  }
  for (const draft of state.drafts || []) {
    if (draft.status !== 'Awaiting approval') continue;
    items.push({ date: String(draft.createdAt).slice(0, 10), kind: 'approval', title: `Approve ${draft.id} — ${draft.title}`, meta: `${draft.platform} · ${kindLabel(draft.kind)}` });
  }

  items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const upcoming = items.filter((item) => {
    const diff = daysFromToday(item.date);
    return diff !== null && diff >= -30 && diff <= 21;
  });
  $('#cal-count').textContent = `${upcoming.length} items`;

  const groups = new Map();
  for (const item of upcoming) {
    if (!groups.has(item.date)) groups.set(item.date, []);
    groups.get(item.date).push(item);
  }

  $('#agenda').innerHTML = groups.size
    ? [...groups.entries()]
        .map(([date, rows]) => {
          const diff = daysFromToday(date);
          const tone = diff < 0 ? 'color:#fb7185' : diff === 0 ? 'color:#c4b5fd' : '';
          const label = diff === 0 ? 'TODAY' : new Date(`${date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' }).toUpperCase();
          return `<div class="agenda-day">
            <div class="agenda-date ${diff === 0 ? 'is-today' : ''}">
              <b style="${tone}">${String(date).slice(8, 10)}</b>
              <span>${label}</span>
            </div>
            <div class="agenda-items">
              ${rows
                .map(
                  (row) => `<div class="agenda-item">
                    <span class="kind kind-${row.kind}"></span>
                    <b>${esc(row.title)}</b>
                    <small>${esc(row.meta)}</small>
                  </div>`,
                )
                .join('')}
            </div>
          </div>`;
        })
        .join('')
    : emptyState('Nothing scheduled', 'Add deadlines to tasks or follow-ups to clients.');

  const overdue = upcoming.filter((item) => daysFromToday(item.date) < 0);
  $('#overdue-list').innerHTML = overdue.length
    ? overdue
        .slice(0, 8)
        .map(
          (item) => `<div class="list-row"><span class="l-main"><b>${esc(item.title)}</b><small>${esc(item.meta)}</small></span><time style="color:#fb7185">${esc(dueLabel(item.date))}</time></div>`,
        )
        .join('')
    : emptyState('Nothing overdue');

  const waiting = (state.drafts || []).filter((draft) => draft.status === 'Awaiting approval');
  $('#waiting-list').innerHTML = waiting.length
    ? waiting
        .slice(0, 6)
        .map(
          (draft) => `<div class="list-row"><span class="l-main"><b>${esc(draft.title)}</b><small>${esc(draft.id)} · ${esc(draft.platform)}</small></span><button class="mini-act good" data-approve="${esc(draft.id)}">${icon('check')}</button></div>`,
        )
        .join('')
    : emptyState('Inbox zero');
}

/* ── reports ───────────────────────────────────────────────── */

function renderReports() {
  const state = ui.state;
  if (!state) return;
  const logs = state.dailyLog || [];

  $('#report-daily').innerHTML = logs.length
    ? `<div class="report-list">${logs
        .map(
          (row) => `<article class="card report-card">
            <div class="report-head">
              <b>${esc(row.date)}</b>
              <div class="report-stats">
                <span class="report-stat">Done<b>${row.completed}</b></span>
                <span class="report-stat">Pending<b>${row.pending}</b></span>
                <span class="report-stat">Blocked<b>${row.blocked}</b></span>
                <span class="report-stat">Awaiting<b>${row.draftsAwaitingApproval}</b></span>
              </div>
            </div>
            <pre class="report-notes">${esc(row.notes || '')}</pre>
          </article>`,
        )
        .join('')}</div>`
    : `<div class="card">${emptyState('No reports yet', 'Generate today’s report to write the first row.')}</div>`;

  const agentRows = (state.dashboard.agents || [])
    .map((row) => {
      const meta = (state.agents || []).find((agent) => agent.id === row.agent);
      return `<tr>
        <td><b>${esc(meta?.name || row.agent)}</b></td>
        <td>${row.runs}</td>
        <td><span class="meter"><span class="meter-track"><span class="meter-fill" style="width:${row.okRate}%;background:${row.okRate > 85 ? '#a3e635' : row.okRate > 60 ? '#fbbf24' : '#fb7185'}"></span></span>${row.okRate}%</span></td>
        <td>${row.avgMs} ms</td>
        <td>${esc(row.provider)}</td>
        <td>${esc(dayLabel(row.lastAt))} ${esc(timeLabel(row.lastAt))}</td>
      </tr>`;
    })
    .join('');

  $('#report-agents').innerHTML = `<div class="card panel">
    <table class="table">
      <thead><tr><th>Agent</th><th>Runs</th><th>Success</th><th>Avg time</th><th>Engine</th><th>Last run</th></tr></thead>
      <tbody>${agentRows || '<tr><td colspan="6">No agent runs recorded yet.</td></tr>'}</tbody>
    </table>
  </div>`;

  const usage = state.usage || [];
  const total = usage.reduce((sum, row) => sum + row.calls, 0);
  $('#report-usage').innerHTML = `<div class="card panel">
    <div class="kpi-strip" style="margin-bottom:14px">
      <div class="kpi-chip"><span>Today</span><b>${state.provider?.callsToday ?? 0}</b></div>
      <div class="kpi-chip"><span>Daily cap</span><b>${state.provider?.limit ?? 0}</b></div>
      <div class="kpi-chip"><span>Last 14 days</span><b>${total}</b></div>
      <div class="kpi-chip"><span>Engine</span><b>${esc(state.provider?.configured || 'auto')}</b></div>
    </div>
    <table class="table">
      <thead><tr><th>Date</th><th>Provider</th><th>Calls</th></tr></thead>
      <tbody>${usage.length ? usage.slice().reverse().map((row) => `<tr><td>${esc(row.date)}</td><td>${esc(row.provider)}</td><td>${row.calls}</td></tr>`).join('') : '<tr><td colspan="3">No model calls — the offline engine is doing the work.</td></tr>'}</tbody>
    </table>
    <p class="hint">Offline engine calls are free. Set a cap in Setup so a loop cannot drain an API budget.</p>
  </div>`;
}

/* ── audit ─────────────────────────────────────────────────── */

const ACTION_LABEL = {
  'task.created': 'Task created',
  'task.status': 'Task status changed',
  'task.deleted': 'Task deleted',
  'draft.created': 'Draft created',
  'draft.approved': 'Draft approved',
  'draft.rejected': 'Draft rejected',
  'draft.revision_requested': 'Revision requested',
  'lead.created': 'Leads added',
  'lead.verified': 'Lead verified',
  'lead.stage': 'Lead stage moved',
  'lead.promoted': 'Lead promoted to client',
  'client.created': 'Client added',
  'client.stage': 'Client stage moved',
  'client.updated': 'Client updated',
  'followup.scheduled': 'Follow-up scheduled',
  'followup.drafted': 'Follow-up drafted',
  'outreach.drafted': 'Outreach drafted',
  'finder.plan': 'Finder plan built',
  'brief.generated': 'Morning brief',
  'report.generated': 'Daily report',
  'settings.updated': 'Settings updated',
  'provider.tested': 'Provider tested',
  'office.reset': 'Office reset',
  'telegram.denied': 'Blocked Telegram user',
  'telegram.polling_started': 'Telegram connected',
};

function renderAudit() {
  const rows = ui.state?.audit || [];
  $('#audit-count').textContent = `${rows.length} events`;
  $('#audit-list').innerHTML = rows.length
    ? rows
        .slice(0, 120)
        .map(
          (row) => `<li data-level="${esc(row.level || 'info')}">
            <span class="t">${esc(dayLabel(row.ts))} ${esc(timeLabel(row.ts))}</span>
            <span class="tick"><span></span></span>
            <span class="what"><b>${esc(ACTION_LABEL[row.action] || row.action)}</b>
              ${row.ref ? `<span class="mono">${esc(row.ref)}</span>` : ''}
              <span>${esc(row.detail || '')}</span>
              <span> · ${esc(row.actor || 'system')}</span>
            </span>
          </li>`,
        )
        .join('')
    : `<li class="muted">No events yet.</li>`;
}

/* ── setup ─────────────────────────────────────────────────── */

function renderSetup() {
  const state = ui.state;
  if (!state) return;
  const settings = state.meta.settings || {};
  $('#set-company').value = settings.companyName || 'AI Invincible Office';
  $('#set-owner').value = settings.ownerName || 'Founder';
  $('#set-target').value = settings.monthlyTarget || 150000;
  $('#set-provider').value = settings.provider || 'auto';
  $('#set-ollama-url').value = settings.ollamaUrl || '';
  $('#set-ollama-model').value = settings.ollamaModel || '';
  $('#set-gemini-model').value = settings.geminiModel || '';
  $('#set-max-calls').value = settings.maxCallsPerDay || 200;

  const secrets = state.secrets || {};
  const rows = [
    ['AI engine', state.provider?.ollama?.reachable ? 'Ollama online' : state.provider?.gemini?.configured ? 'Gemini key set' : 'offline rules only', state.provider?.ollama?.reachable || state.provider?.gemini?.configured],
    ['Telegram bot token', secrets.telegramBotToken ? 'stored in .env' : 'not set', secrets.telegramBotToken],
    ['Telegram allow-list', `${settings.allowedUserIds?.length || 0} user(s)`, (settings.allowedUserIds?.length || 0) > 0],
    ['Gemini API key', secrets.geminiKey ? 'set' : 'optional', secrets.geminiKey],
    ['Webhook secret', secrets.webhookSecret ? 'set' : 'optional', secrets.webhookSecret],
    ['Google Sheet ID', secrets.googleSheetId ? 'set' : 'CSV export available', secrets.googleSheetId],
  ];
  $('#secret-list').innerHTML = rows
    .map(
      ([label, value, ok]) =>
        `<li><span class="mark ${ok ? 'mark-yes' : 'mark-no'}">${ok ? '✓' : '–'}</span><span><b>${esc(label)}</b><br>${esc(value)}</span></li>`,
    )
    .join('');

  const tg = state.telegram || {};
  $('#telegram-list').innerHTML = [
    ['Bot token', tg.configured ? 'configured' : 'missing', tg.configured],
    ['Mode', tg.mode === 'off' ? 'off — set TELEGRAM_MODE=polling' : tg.mode, tg.mode !== 'off'],
    ['Polling', tg.polling ? 'connected' : 'idle', tg.polling],
    ['Allowed users', String(tg.allowedUsers || 0), (tg.allowedUsers || 0) > 0],
  ]
    .map(
      ([label, value, ok]) =>
        `<li><span class="mark ${ok ? 'mark-yes' : 'mark-no'}">${ok ? '✓' : '–'}</span><span><b>${esc(label)}</b><br>${esc(value)}</span></li>`,
    )
    .join('');
}

/* ── guide ─────────────────────────────────────────────────── */

function markdownToHtml(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const html = [];
  let inCode = false;
  let codeBuffer = [];
  let listType = null;
  let tableBuffer = [];

  const closeList = () => {
    if (listType) {
      html.push(`</${listType}>`);
      listType = null;
    }
  };

  const inline = (text) =>
    esc(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');

  const flushTable = () => {
    if (!tableBuffer.length) return;
    const rows = tableBuffer.filter((row) => !/^\|?[\s:|-]+\|?$/.test(row));
    const cells = rows.map((row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
    if (cells.length) {
      html.push(`<table><thead><tr>${cells[0].map((cell) => `<th>${inline(cell)}</th>`).join('')}</tr></thead><tbody>`);
      cells.slice(1).forEach((row) => html.push(`<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join('')}</tr>`));
      html.push('</tbody></table>');
    }
    tableBuffer = [];
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code>${esc(codeBuffer.join('\n'))}</code></pre>`);
        codeBuffer = [];
        inCode = false;
      } else {
        closeList();
        flushTable();
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      codeBuffer.push(line);
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line)) {
      closeList();
      tableBuffer.push(line.trim());
      continue;
    }
    flushTable();
    const heading = line.match(/^(#{1,4})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      continue;
    }
    if (/^\s*(---|\*\*\*)\s*$/.test(line)) {
      closeList();
      html.push('<hr>');
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      closeList();
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`);
      continue;
    }
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      if (listType !== 'ul') {
        closeList();
        html.push('<ul>');
        listType = 'ul';
      }
      html.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ol) {
      if (listType !== 'ol') {
        closeList();
        html.push('<ol>');
        listType = 'ol';
      }
      html.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }
    if (!line.trim()) {
      closeList();
      continue;
    }
    closeList();
    html.push(`<p>${inline(line)}</p>`);
  }
  closeList();
  flushTable();
  if (inCode) html.push(`<pre><code>${esc(codeBuffer.join('\n'))}</code></pre>`);
  return html.join('\n');
}

async function loadDocs() {
  try {
    const { docs } = await api('/api/docs');
    ui.docs = docs;
    $('#doc-list').innerHTML = docs
      .map((doc) => `<button class="doc-link" data-file="${esc(doc.file)}">${esc(doc.title)}</button>`)
      .join('');
    $$('#doc-list .doc-link').forEach((button) =>
      button.addEventListener('click', () => openDoc(button.dataset.file)),
    );
    if (docs.length) openDoc(ui.activeDoc || docs[0].file);
  } catch (error) {
    $('#doc-list').innerHTML = `<p class="muted xs">${esc(error.message)}</p>`;
  }
}

async function openDoc(file) {
  ui.activeDoc = file;
  $$('#doc-list .doc-link').forEach((link) => link.classList.toggle('is-active', link.dataset.file === file));
  const body = $('#doc-body');
  body.innerHTML = '<p class="muted">Loading…</p>';
  try {
    const { markdown } = await api(`/api/docs/${encodeURIComponent(file)}`);
    body.innerHTML = `<div class="prose">${markdownToHtml(markdown)}</div>`;
    $('#content').scrollTop = 0;
  } catch (error) {
    body.innerHTML = `<p class="muted">${esc(error.message)}</p>`;
  }
}

/* ── modal ─────────────────────────────────────────────────── */

let modalState = null;

function openModal({ title, message = '', fields = [], confirmLabel = 'Confirm', onConfirm }) {
  modalState = { onConfirm };
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';

  if (message) {
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    body.appendChild(paragraph);
  }

  for (const field of fields) {
    const label = document.createElement('label');
    label.textContent = field.label || '';
    let input;
    if (field.type === 'select') {
      input = document.createElement('select');
      for (const option of field.options || []) {
        const node = document.createElement('option');
        node.value = option.value ?? option;
        node.textContent = option.label ?? option;
        input.appendChild(node);
      }
      if (field.value) input.value = field.value;
    } else if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.rows = field.rows || 3;
      input.placeholder = field.placeholder || '';
      if (field.value) input.value = field.value;
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      input.placeholder = field.placeholder || '';
      if (field.value !== undefined) input.value = field.value;
      if (field.min !== undefined) input.min = field.min;
      if (field.step !== undefined) input.step = field.step;
    }
    input.name = field.name || 'value';
    label.appendChild(input);
    body.appendChild(label);
  }

  $('#modal-confirm').textContent = confirmLabel;
  $('#modal-confirm').classList.remove('btn-danger');
  $('#modal').hidden = false;
  setTimeout(() => body.querySelector('input, textarea, select')?.focus(), 60);
}

function closeModal() {
  $('#modal').hidden = true;
  modalState = null;
}

function modalValues() {
  const values = {};
  $$('#modal-body input, #modal-body textarea, #modal-body select').forEach((input) => {
    values[input.name] = input.value;
  });
  return values;
}

/* ── drawer ────────────────────────────────────────────────── */

function openClientDrawer(id) {
  const client = (ui.state?.clients || []).find((row) => row.id === id);
  if (!client) return;
  ui.drawerClientId = id;
  $('#drawer-id').textContent = `${client.id} · ${client.stage.toUpperCase()}`;
  $('#drawer-title').textContent = client.company;

  const stages = ['Lead', 'Proposal sent', 'Negotiation', 'Won', 'Lost'];
  const currentIndex = stages.indexOf(client.stage);
  const proposals = (ui.state.drafts || []).filter((draft) => draft.kind === 'proposal' && draft.clientId === client.id);

  $('#drawer-body').innerHTML = `
    <div class="drawer-stat-grid">
      <div class="drawer-stat"><span>Deal value</span><b>${inr(client.value)}</b></div>
      <div class="drawer-stat"><span>Next follow-up</span><b>${client.nextFollowUp ? esc(dayLabel(client.nextFollowUp)) : '—'}</b></div>
      <div class="drawer-stat"><span>Contact</span><b style="font-size:13px">${esc(client.contact || 'Owner')}</b></div>
      <div class="drawer-stat"><span>Niche</span><b style="font-size:13px">${esc(client.niche || '—')}</b></div>
    </div>

    <div class="drawer-section">
      <h4>Pipeline stage</h4>
      <div class="stage-steps">
        ${stages
          .map(
            (stage, index) => `<button class="stage-step ${stage === client.stage ? 'is-current' : index < currentIndex ? 'is-past' : ''}" data-client-stage="${esc(stage)}">${esc(stage)}</button>`,
          )
          .join('')}
      </div>
    </div>

    <div class="drawer-section">
      <h4>Contact</h4>
      <p>${client.email ? `${esc(client.email)}<br>` : ''}${client.phone ? `${esc(client.phone)}<br>` : ''}${client.sourceUrl ? `<a href="${esc(client.sourceUrl)}" target="_blank" rel="noreferrer noopener">${esc(client.sourceUrl)}</a>` : 'No source URL on file.'}</p>
    </div>

    <div class="drawer-section">
      <h4>Notes</h4>
      <textarea id="drawer-notes" rows="4" style="width:100%;padding:10px 12px;border:1px solid var(--line);border-radius:11px;background:rgba(5,5,10,.55);color:var(--text);font-size:12.5px;outline:none;resize:vertical">${esc(client.notes || '')}</textarea>
      <div class="drawer-actions" style="margin-top:8px">
        <button class="btn btn-sm btn-ghost" id="drawer-save-notes">Save notes</button>
      </div>
    </div>

    <div class="drawer-section">
      <h4>Actions</h4>
      <div class="drawer-actions">
        <button class="btn btn-sm btn-primary" id="drawer-proposal">${icon('sparkles')}Draft proposal</button>
        <button class="btn btn-sm btn-ghost" id="drawer-followup">${icon('calendar')}Schedule follow-up</button>
        <button class="btn btn-sm btn-ghost" id="drawer-stage-advance">${icon('arrow-right')}Advance stage</button>
      </div>
    </div>

    <div class="drawer-section">
      <h4>Proposals</h4>
      ${proposals.length
        ? proposals
            .map(
              (draft) => `<div class="list-row"><span class="l-main"><b>${esc(draft.id)} · ${esc(draft.status)}</b><small>${esc(dayLabel(draft.createdAt))} · v${draft.version}</small></span><button class="mini-act good" data-open-approval="${esc(draft.id)}">${icon('arrow-right')}</button></div>`,
            )
            .join('')
        : '<p>No proposal yet.</p>'}
    </div>
  `;

  $('#drawer').hidden = false;

  $$('[data-client-stage]').forEach((button) =>
    button.addEventListener('click', async () => {
      await mutate(`/api/clients/${client.id}/stage`, { stage: button.dataset.clientStage }, { toastMessage: `${client.company} → ${button.dataset.clientStage}` });
      openClientDrawer(client.id);
    }),
  );

  $('#drawer-save-notes').addEventListener('click', async () => {
    await mutate(`/api/clients/${client.id}/notes`, { notes: $('#drawer-notes').value }, { toastMessage: 'Notes saved.' });
  });

  $('#drawer-proposal').addEventListener('click', async () => {
    const result = await mutate(`/api/clients/${client.id}/proposal`, {}, { toastMessage: 'Proposal draft created — approve it in the inbox.' });
    closeDrawer();
    if (result?.draft?.id) {
      setView('approvals');
      setTimeout(() => document.querySelector(`[data-draft-card="${result.draft.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    }
  });

  $('#drawer-followup').addEventListener('click', () => {
    const inThree = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);
    openModal({
      title: `Schedule follow-up — ${client.company}`,
      fields: [{ name: 'date', label: 'Date', type: 'date', value: client.nextFollowUp || inThree }],
      confirmLabel: 'Schedule',
      onConfirm: async (values) => {
        if (!values.date) {
          toast('Pick a date.', 'bad');
          return false;
        }
        await mutate(`/api/clients/${client.id}/followup`, { date: values.date }, { toastMessage: `Follow-up set for ${values.date}.` });
        openClientDrawer(client.id);
        return true;
      },
    });
  });

  $('#drawer-stage-advance').addEventListener('click', async () => {
    const next = stages[Math.min(currentIndex + 1, stages.length - 2)] || 'Negotiation';
    await mutate(`/api/clients/${client.id}/stage`, { stage: next }, { toastMessage: `${client.company} → ${next}` });
    openClientDrawer(client.id);
  });

  $$('#drawer-body [data-open-approval]').forEach((button) =>
    button.addEventListener('click', () => {
      closeDrawer();
      setView('approvals');
      setTimeout(() => document.querySelector(`[data-draft-card="${button.dataset.openApproval}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
    }),
  );
}

function closeDrawer() {
  $('#drawer').hidden = true;
  ui.drawerClientId = null;
}

/* ── palette ───────────────────────────────────────────────── */

function paletteSource() {
  const state = ui.state;
  const items = [];
  const nav = [
    ['dashboard', 'Dashboard', 'Overview and focus', 'grid'],
    ['console', 'AI Console', 'Talk to your manager', 'chat'],
    ['approvals', 'Approvals', 'Draft inbox', 'check-circle'],
    ['work', 'Work', 'Tasks', 'bolt'],
    ['clients', 'Clients', 'Pipeline and CRM', 'briefcase'],
    ['finder', 'Client Finder', 'Research plan and leads', 'target'],
    ['calendar', 'Calendar', 'Deadlines and follow-ups', 'calendar'],
    ['reports', 'Reports', 'Daily log and agent health', 'chart'],
    ['setup', 'Setup', 'Engine, secrets, exports', 'settings'],
    ['guide', 'Guide', 'Read the chapters', 'book'],
  ];
  for (const [view, label, hint, iconName] of nav) {
    items.push({ group: 'Go to', label, hint, icon: iconName, run: () => setView(view) });
  }

  const actions = [
    ['Morning brief', '/brief', 'moon'],
    ['New task', 'task', 'bolt'],
    ['New draft', 'draft', 'sparkles'],
    ['Add client', 'client', 'briefcase'],
    ['Find clients', 'find', 'target'],
    ['Daily report', '/report', 'chart'],
  ];
  for (const [label, action, iconName] of actions) {
    items.push({
      group: 'Actions',
      label,
      hint: action.startsWith('/') ? action : 'opens a form',
      icon: iconName,
      run: () => (action.startsWith('/') ? sendCommand(action) : openNewModal(action)),
    });
  }

  for (const client of (state?.clients || []).slice(0, 40)) {
    items.push({ group: 'Clients', label: client.company, hint: `${client.id} · ${client.stage} · ${inr(client.value)}`, icon: 'briefcase', run: () => { setView('clients'); openClientDrawer(client.id); } });
  }
  for (const draft of (state?.drafts || []).filter((d) => d.status === 'Awaiting approval').slice(0, 20)) {
    items.push({ group: 'Approvals', label: draft.title, hint: `${draft.id} · ${draft.platform}`, icon: 'check-circle', run: () => { setView('approvals'); setTimeout(() => document.querySelector(`[data-draft-card="${draft.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120); } });
  }
  for (const task of (state?.tasks || []).filter((t) => t.status !== 'Done').slice(0, 20)) {
    items.push({ group: 'Tasks', label: task.task, hint: `${task.id} · ${task.priority}`, icon: 'bolt', run: () => setView('work') });
  }
  return items;
}

function renderPalette(query = '') {
  const all = paletteSource();
  const q = query.trim().toLowerCase();
  const filtered = q
    ? all.filter((item) => `${item.label} ${item.hint} ${item.group}`.toLowerCase().includes(q))
    : all;
  ui.paletteItems = filtered.slice(0, 40);
  ui.paletteIndex = 0;

  if (!ui.paletteItems.length) {
    $('#palette-list').innerHTML = `<div class="palette-empty">No match for “${esc(query)}”.<br>Try “client”, “approve” or “/brief”.</div>`;
    return;
  }

  let lastGroup = '';
  $('#palette-list').innerHTML = ui.paletteItems
    .map((item, index) => {
      const header = item.group !== lastGroup ? `<div class="palette-group">${esc(item.group)}</div>` : '';
      lastGroup = item.group;
      return `${header}<button class="palette-item ${index === 0 ? 'is-active' : ''}" data-palette-index="${index}">
        ${icon(item.icon)}<span class="p-main"><b>${esc(item.label)}</b><small>${esc(item.hint)}</small></span>
        ${icon('arrow-right')}
      </button>`;
    })
    .join('');

  $$('#palette-list .palette-item').forEach((button) =>
    button.addEventListener('click', () => runPalette(Number(button.dataset.paletteIndex))),
  );
}

function runPalette(index) {
  const item = ui.paletteItems[index];
  if (!item) return;
  closePalette();
  item.run();
}

function openPalette() {
  $('#palette').hidden = false;
  $('#palette-input').value = '';
  renderPalette('');
  setTimeout(() => $('#palette-input').focus(), 40);
}

function closePalette() {
  $('#palette').hidden = true;
}

function movePalette(delta) {
  if (!ui.paletteItems.length) return;
  ui.paletteIndex = (ui.paletteIndex + delta + ui.paletteItems.length) % ui.paletteItems.length;
  $$('#palette-list .palette-item').forEach((button, index) =>
    button.classList.toggle('is-active', index === ui.paletteIndex),
  );
  $(`#palette-list .palette-item[data-palette-index="${ui.paletteIndex}"]`)?.scrollIntoView({ block: 'nearest' });
}

/* ── new-entity modals ─────────────────────────────────────── */

function openNewModal(kind) {
  if (kind === 'task') {
    openModal({
      title: 'New task',
      message: 'Describe the work. The AI Manager splits it into 1–5 tasks with priority and owner.',
      fields: [{ name: 'request', label: 'What needs to happen?', type: 'textarea', rows: 4, placeholder: 'Plan a beginner-friendly Instagram Reel about free AI tools…' }],
      confirmLabel: 'Plan it',
      onConfirm: async (values) => {
        if (!values.request?.trim()) return toast('Describe the work first.', 'bad'), false;
        await mutate('/api/tasks', { request: values.request }, { toastMessage: 'Tasks planned.' });
        setView('work');
        return true;
      },
    });
    return;
  }

  if (kind === 'draft') {
    openModal({
      title: 'New draft',
      message: 'The Content Agent writes one draft and the Quality Checker reviews it before it reaches you.',
      fields: [
        { name: 'request', label: 'What should we write?', type: 'textarea', rows: 3, placeholder: 'Write a friendly Instagram caption about our AI tools Reel' },
        { name: 'platform', label: 'Platform', type: 'select', options: ['Instagram', 'LinkedIn', 'YouTube', 'X (Twitter)', 'Email', 'General'] },
        { name: 'tone', label: 'Tone', type: 'select', options: ['friendly', 'professional', 'witty', 'direct', 'premium'] },
      ],
      confirmLabel: 'Draft it',
      onConfirm: async (values) => {
        if (!values.request?.trim()) return toast('Add a content request.', 'bad'), false;
        await mutate('/api/drafts', values, { toastMessage: 'Draft created — approval required.' });
        setView('approvals');
        return true;
      },
    });
    return;
  }

  if (kind === 'client') {
    openModal({
      title: 'Add client',
      message: 'A client record you control. Nothing is sent from here.',
      fields: [
        { name: 'company', label: 'Company', placeholder: 'Nimbus Interiors' },
        { name: 'contact', label: 'Contact person', placeholder: 'Riya' },
        { name: 'niche', label: 'Niche', placeholder: 'Interior design' },
        { name: 'stage', label: 'Stage', type: 'select', options: ['Lead', 'Proposal sent', 'Negotiation', 'Won', 'Lost'] },
        { name: 'value', label: 'Deal value (₹)', type: 'number', min: 0, step: 1000, value: 0 },
        { name: 'notes', label: 'Notes', type: 'textarea', rows: 2, placeholder: 'Monthly content retainer…' },
      ],
      confirmLabel: 'Add client',
      onConfirm: async (values) => {
        if (!values.company?.trim()) return toast('Company name is required.', 'bad'), false;
        await mutate('/api/clients', values, { toastMessage: 'Client added.' });
        setView('clients');
        return true;
      },
    });
    return;
  }

  if (kind === 'find') {
    openModal({
      title: 'Client Finder',
      message: 'Give a niche and a city. You get queries, directories, a checklist and red flags — no invented businesses.',
      fields: [
        { name: 'niche', label: 'Niche', placeholder: 'cafés' },
        { name: 'location', label: 'City', placeholder: 'Pune' },
        { name: 'notes', label: 'What you already know', type: 'textarea', rows: 2, placeholder: 'They post daily specials but have no weekly plan.' },
      ],
      confirmLabel: 'Build plan',
      onConfirm: async (values) => {
        if (!values.niche?.trim()) return toast('Add a niche.', 'bad'), false;
        const result = await mutate('/api/find', values, { toastMessage: 'Research plan ready.' });
        finderPlan = { ...result, niche: values.niche, location: values.location };
        setView('finder');
        renderFinderPlan(finderPlan);
        return true;
      },
    });
  }
}

/* ── navigation & render ───────────────────────────────────── */

const PAGES = {
  dashboard: ['Dashboard', 'Your whole office at a glance.'],
  console: ['AI Console', 'Ask your manager. Every draft waits for your approval.'],
  approvals: ['Approvals', 'Read, revise, approve. Nothing leaves this office without you.'],
  work: ['Work', 'Tasks with owners, priorities and deadlines.'],
  clients: ['Clients', 'Your pipeline and client records.'],
  finder: ['Client Finder', 'Public-source research with human verification.'],
  calendar: ['Calendar', 'Deadlines, follow-ups and approvals in one timeline.'],
  reports: ['Reports', 'Daily log, agent health and model usage.'],
  audit: ['Audit trail', 'Every command, decision and blocked action.'],
  setup: ['Setup', 'Engine, secrets, exports and the deployment checklist.'],
  guide: ['Guide', 'The setup guide, chapter by chapter.'],
};

function setView(view) {
  if (!PAGES[view]) return;
  ui.view = view;
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('is-active', section.dataset.view === view));
  const [title, sub] = PAGES[view];
  $('#page-title').textContent = title;
  $('#page-sub').textContent = sub;
  $('#content').scrollTop = 0;
  if (view === 'guide' && !ui.docs.length) loadDocs();
  if (view === 'clients') renderClients();
  if (view === 'finder') renderFinder();
  if (view === 'reports') renderReports();
  if (view === 'setup') renderSetup();
}

function renderChrome() {
  const state = ui.state;
  if (!state) return;
  const o = state.dashboard.overview;
  const settings = state.meta.settings || {};

  $('#brand-name').textContent = settings.companyName || 'AI Invincible Office';
  $('#brand-sub').textContent = `Invincible HQ · v${state.meta.version}`;
  $('#avatar').textContent = initials(settings.ownerName || 'Founder').slice(0, 1);

  $('#badge-approvals').hidden = o.drafts.awaiting === 0;
  $('#badge-approvals').textContent = o.drafts.awaiting;
  $('#count-work').textContent = o.tasks.open;
  $('#count-clients').textContent = o.clients.total;
  $('#count-leads').textContent = o.leads.total;

  const offline = !(state.provider?.ollama?.reachable || state.provider?.gemini?.configured);
  $('#engine-label').textContent = offline ? 'offline engine' : state.provider.ollama.reachable ? `ollama · ${state.provider.ollama.models?.[0] || 'model'}` : `gemini · ${state.provider.gemini.model}`;
  $('#engine-note').textContent = offline ? 'local rules · zero cost' : 'connected · drafts stay yours';
  $('#engine-pill .pulse').style.background = offline ? '#fbbf24' : '#a3e635';
}

function renderAll() {
  renderChrome();
  renderDashboard();
  renderChat();
  renderConsole();
  renderApprovals();
  renderTasks();
  renderClients();
  renderFinder();
  renderCalendar();
  renderReports();
  renderAudit();
  renderSetup();
}

/* ── confirm helper ────────────────────────────────────────── */

function confirmAction({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm }) {
  openModal({
    title,
    message,
    fields: [],
    confirmLabel,
    onConfirm: async () => {
      await onConfirm();
      return true;
    },
  });
  if (danger) $('#modal-confirm').classList.add('btn-danger');
  else $('#modal-confirm').classList.remove('btn-danger');
}

/* ── events ────────────────────────────────────────────────── */

function bindGlobal() {
  $('#nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item');
    if (button) setView(button.dataset.view);
  });

  document.addEventListener('click', (event) => {
    const goto = event.target.closest('[data-view]');
    if (goto && !goto.classList.contains('nav-item') && !goto.classList.contains('view')) setView(goto.dataset.view);
    const view = event.target.closest('[data-goto]');
    if (view) setView(view.dataset.goto);
  });

  $('#search-trigger').addEventListener('click', openPalette);

  $('#btn-new').addEventListener('click', () => {
    openModal({
      title: 'What do you want to create?',
      message: 'Everything starts as a draft or a task — nothing is sent.',
      fields: [
        { name: 'kind', label: 'Type', type: 'select', options: [
          { value: 'task', label: 'Tasks — plan work' },
          { value: 'draft', label: 'Draft — content, outreach, proposal' },
          { value: 'client', label: 'Client — CRM record' },
          { value: 'find', label: 'Client Finder — research plan' },
        ] },
      ],
      confirmLabel: 'Continue',
      onConfirm: (values) => {
        closeModal();
        setTimeout(() => openNewModal(values.kind), 60);
        return false;
      },
    });
  });

  $('#hero-brief').addEventListener('click', () => generateBrief());
  $('#mini-brief-refresh').addEventListener('click', () => generateBrief());
  $('#btn-brief-top').addEventListener('click', () => generateBrief());
  $('#hero-approve').addEventListener('click', () => setView('approvals'));

  const composer = $('#composer-input');
  const form = $('#composer-form');
  const autoGrow = () => {
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 140)}px`;
  };
  composer.addEventListener('input', autoGrow);
  composer.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      form.requestSubmit();
    }
  });
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const value = composer.value;
    composer.value = '';
    autoGrow();
    sendCommand(value);
  });

  $('#chips').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    composer.value = chip.dataset.command;
    composer.focus();
    autoGrow();
  });

  $('#chat-clear').addEventListener('click', () => {
    ui.chatClearedAt = Date.now();
    renderChat();
    toast('Chat view cleared. Office data is untouched.');
  });

  $('#approval-filters').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    ui.filters.approvals = button.dataset.filter;
    $$('#approval-filters button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderApprovals();
  });

  $('#task-filters').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    ui.filters.tasks = button.dataset.filter;
    $$('#task-filters button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderTasks();
  });

  $('#btn-add-task').addEventListener('click', () => openNewModal('task'));
  $('#btn-add-client').addEventListener('click', () => openNewModal('client'));
  $('#btn-new-draft').addEventListener('click', () => openNewModal('draft'));
  $('#client-search').addEventListener('input', (event) => {
    ui.clientQuery = event.target.value;
    renderClients();
  });

  $('#report-tabs').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    ui.reportTab = button.dataset.tab;
    $$('#report-tabs button').forEach((item) => item.classList.toggle('is-active', item === button));
    $$('.report-pane').forEach((pane) => pane.classList.toggle('is-active', pane.id === `report-${button.dataset.tab}`));
  });

  $('#btn-report').addEventListener('click', async () => {
    await mutate('/api/report', {}, { toastMessage: 'Daily report written.' });
    setView('reports');
  });

  /* delegated actions across views */
  document.addEventListener('click', async (event) => {
    const target = event.target.closest('button');

    if (!target) {
      const card = event.target.closest('[data-client], [data-mission]');
      if (card?.dataset.client) {
        openClientDrawer(card.dataset.client);
        return;
      }
      if (card?.dataset.mission) {
        const kind = card.dataset.mission;
        if (kind === 'approval') setView('approvals');
        else if (kind === 'verify') setView('finder');
        else if (kind === 'followup') setView('calendar');
        else setView('work');
      }
      return;
    }

    if (target.dataset.quick) {
      const action = target.dataset.quick;
      if (action.endsWith(' ')) {
        $('#composer-input').value = action;
        $('#composer-input').focus();
      } else {
        sendCommand(action);
      }
      return;
    }

    if (target.dataset.approve) {
      await mutate(`/api/drafts/${target.dataset.approve}/decision`, { decision: 'approve' }, { toastMessage: `${target.dataset.approve} approved — publish it yourself.` });
      return;
    }

    if (target.dataset.openApproval) {
      setView('approvals');
      setTimeout(() => document.querySelector(`[data-draft-card="${target.dataset.openApproval}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 120);
      return;
    }

    if (target.dataset.revise) {
      const id = target.dataset.revise;
      openModal({
        title: `Request revision · ${id}`,
        message: 'Tell the agent what to change. It produces a new version — still waiting for your approval.',
        fields: [{ name: 'feedback', label: 'Feedback', type: 'textarea', rows: 3, placeholder: 'Shorter, more conversational, drop the statistic.' }],
        confirmLabel: 'Request revision',
        onConfirm: async (values) => {
          await mutate(`/api/drafts/${id}/decision`, { decision: 'revise', feedback: values.feedback }, { toastMessage: `Revision requested for ${id}.` });
          return true;
        },
      });
      return;
    }

    if (target.dataset.reject) {
      const id = target.dataset.reject;
      openModal({
        title: `Reject · ${id}`,
        message: 'Record the reason so the agents learn what to avoid.',
        fields: [{ name: 'feedback', label: 'Reason', type: 'textarea', rows: 2, placeholder: 'Off brand, wrong audience…' }],
        confirmLabel: 'Reject draft',
        onConfirm: async (values) => {
          await mutate(`/api/drafts/${id}/decision`, { decision: 'reject', feedback: values.feedback }, { toastMessage: `${id} rejected.`, tone: 'bad' });
          return true;
        },
      });
      return;
    }

    if (target.dataset.copy) {
      const draft = (ui.state.drafts || []).find((row) => row.id === target.dataset.copy);
      navigator.clipboard?.writeText(draft?.draft || '')
        .then(() => toast('Draft copied.', 'good'))
        .catch(() => toast('Copy failed — select the text manually.', 'bad'));
      return;
    }

    if (target.dataset.taskDone) {
      const task = (ui.state.tasks || []).find((row) => row.id === target.dataset.taskDone);
      const status = task?.status === 'Done' ? 'Pending' : 'Done';
      await mutate(`/api/tasks/${target.dataset.taskDone}/status`, { status }, { toastMessage: `${target.dataset.taskDone} → ${status}` });
      return;
    }
    if (target.dataset.taskProgress) {
      await mutate(`/api/tasks/${target.dataset.taskProgress}/status`, { status: 'In Progress' }, { toastMessage: `${target.dataset.taskProgress} in progress.` });
      return;
    }
    if (target.dataset.taskBlock) {
      const id = target.dataset.taskBlock;
      openModal({
        title: `Block ${id}`,
        message: 'Why is it blocked? The reporting agent uses this reason.',
        fields: [{ name: 'reason', label: 'Reason', type: 'textarea', rows: 2, placeholder: 'Waiting on the client to confirm the brief.' }],
        confirmLabel: 'Mark blocked',
        onConfirm: async (values) => {
          await mutate(`/api/tasks/${id}/status`, { status: 'Blocked', reason: values.reason }, { toastMessage: `${id} blocked.` });
          return true;
        },
      });
      return;
    }
    if (target.dataset.taskDelete) {
      const id = target.dataset.taskDelete;
      confirmAction({
        title: `Delete ${id}?`,
        message: 'The task is removed but the audit trail keeps a record. This cannot be undone.',
        confirmLabel: 'Delete task',
        danger: true,
        onConfirm: async () => {
          await mutate(`/api/tasks/${id}`, undefined, { toastMessage: `${id} deleted.` });
        },
      });
      return;
    }

    if (target.dataset.client) {
      openClientDrawer(target.dataset.client);
      return;
    }

    if (target.dataset.mission) {
      const kind = target.dataset.mission;
      if (kind === 'approval') setView('approvals');
      else if (kind === 'verify') setView('finder');
      else if (kind === 'followup') setView('calendar');
      else setView('work');
      return;
    }
  });

  /* finder forms */
  $('#finder-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const payload = { niche: form.get('niche'), location: form.get('location'), notes: form.get('notes') };
    try {
      const result = await api('/api/find', { method: 'POST', body: JSON.stringify(payload) });
      if (result.state) {
        ui.state = result.state;
        renderAll();
      }
      finderPlan = { ...result, niche: payload.niche, location: payload.location };
      renderFinderPlan(finderPlan);
      toast('Research plan ready.', 'good');
    } catch (error) {
      toast(error.message, 'bad');
    }
  });

  $('#lead-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    const payload = {
      niche: form.get('niche') || 'unspecified',
      location: form.get('location') || '',
      sourceUrl: form.get('sourceUrl'),
      notes: form.get('notes'),
    };
    try {
      const result = await api('/api/leads', { method: 'POST', body: JSON.stringify(payload) });
      ui.state = result.state;
      renderAll();
      toast(`${result.leads?.length || 0} lead row(s) added — verify them before outreach.`, 'good');
      event.target.reset();
    } catch (error) {
      toast(error.message, 'bad');
    }
  });

  /* setup */
  $('#profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await mutate('/api/settings', {
      companyName: $('#set-company').value,
      ownerName: $('#set-owner').value,
      monthlyTarget: Number($('#set-target').value),
    }, { toastMessage: 'Profile saved.' });
  });

  $('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    await mutate('/api/settings', {
      provider: $('#set-provider').value,
      ollamaUrl: $('#set-ollama-url').value,
      ollamaModel: $('#set-ollama-model').value,
      geminiModel: $('#set-gemini-model').value,
      maxCallsPerDay: Number($('#set-max-calls').value),
    }, { toastMessage: 'Engine settings saved.' });
  });

  $('#btn-test-provider').addEventListener('click', async () => {
    const target = $('#provider-test-result');
    target.textContent = 'Testing…';
    try {
      const result = await api('/api/provider/test', { method: 'POST' });
      if (result.state) {
        ui.state = result.state;
        renderAll();
      }
      target.textContent = result.ok ? `✓ ${result.provider} replied` : `⚠ ${result.error}`;
      toast(result.ok ? `Connected to ${result.provider}.` : result.error, result.ok ? 'good' : 'bad');
    } catch (error) {
      target.textContent = `⚠ ${error.message}`;
    }
  });

  $('#btn-download-backup').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(ui.state, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `invincible-office-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded. Store it somewhere safe.', 'good');
  });

  $('#btn-reset').addEventListener('click', () => {
    openModal({
      title: 'Reset office',
      message: 'Deletes every task, draft, lead, client and log on this machine. Type RESET to confirm.',
      fields: [{ name: 'confirm', label: 'Type RESET', placeholder: 'RESET' }],
      confirmLabel: 'Reset everything',
      onConfirm: async (values) => {
        if (String(values.confirm).trim() !== 'RESET') return toast('Type RESET to confirm.', 'bad'), false;
        await mutate('/api/reset', { seed: false }, { toastMessage: 'Office reset.', tone: 'bad' });
        return true;
      },
    });
    $('#modal-confirm').classList.add('btn-danger');
  });

  /* modal + drawer + palette */
  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target.id === 'modal') closeModal();
  });
  $('#modal-confirm').addEventListener('click', async () => {
    if (!modalState) return;
    const values = modalValues();
    const result = await modalState.onConfirm?.(values, values);
    if (result !== false) closeModal();
  });

  $('#drawer-close').addEventListener('click', closeDrawer);
  $('#drawer').addEventListener('click', (event) => {
    if (event.target.id === 'drawer') closeDrawer();
  });

  $('#palette-input').addEventListener('input', (event) => renderPalette(event.target.value));
  $('#palette').addEventListener('click', (event) => {
    if (event.target.id === 'palette') closePalette();
  });

  document.addEventListener('keydown', (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if ($('#palette').hidden) openPalette();
      else closePalette();
      return;
    }
    if (event.key === 'Escape') {
      if (!$('#palette').hidden) closePalette();
      else if (!$('#modal').hidden) closeModal();
      else if (!$('#drawer').hidden) closeDrawer();
      return;
    }
    if (!$('#palette').hidden) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        movePalette(1);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        movePalette(-1);
      } else if (event.key === 'Enter') {
        event.preventDefault();
        runPalette(ui.paletteIndex);
      }
    }
  });
}

async function generateBrief() {
  try {
    await mutate('/api/brief', {}, { toastMessage: 'Morning brief ready.' });
    if (ui.view !== 'console') setView('console');
  } catch {
    /* toast already shown */
  }
}

function renderChips() {
  const chips = ['/brief', '/task ', '/draft ', '/find ', '/report', '/clients', '/status', '/help'];
  $('#chips').innerHTML = chips
    .map((command) => `<button class="chip" type="button" data-command="${esc(command)}">${esc(command.trim())}</button>`)
    .join('');
}

async function boot() {
  const fresh = await fetch('/healthz').then((r) => r.json()).catch(() => null);
  if (fresh?.name) {
    document.title = fresh.name;
    $('#brand-name').textContent = fresh.name;
  }

  bindGlobal();
  renderChips();
  try {
    await refresh();
  } catch (error) {
    toast(`Could not load office state: ${error.message}`, 'bad');
    return;
  }
  setView('dashboard');

  let lastMessage = (ui.state?.messages || []).at(-1)?.id || '';
  setInterval(async () => {
    if (document.hidden || ui.view !== 'console' || ui.busy) return;
    try {
      const next = await api('/api/state');
      const nextMessage = (next.messages || []).at(-1)?.id || '';
      const changed = nextMessage !== lastMessage;
      lastMessage = nextMessage;
      ui.state = next;
      renderChrome();
      renderConsole();
      if (changed) renderChat();
    } catch {
      /* retry next tick */
    }
  }, 12_000);

  setInterval(() => {
    if (document.hidden) return;
    api('/api/state')
      .then((next) => {
        ui.state = next;
        renderChrome();
        if (ui.view === 'dashboard') renderDashboard();
        if (ui.view === 'approvals') renderApprovals();
      })
      .catch(() => {});
  }, 30_000);
}

boot();
