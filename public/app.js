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
  live: false, // true only while /api/stream is actually open
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

/* ── access code (only used when OFFICE_ACCESS_CODE is set) ── */
const ACCESS_KEY = 'invincible.office.code';
const getCode = () => localStorage.getItem(ACCESS_KEY) || '';
const setCode = (value) => localStorage.setItem(ACCESS_KEY, value);
const clearCode = () => localStorage.removeItem(ACCESS_KEY);

async function api(path, options = {}) {
  const code = getCode();
  const response = await fetch(path, {
    headers: {
      'content-type': 'application/json',
      ...(code ? { 'x-office-code': code } : {}),
      ...(options.headers || {}),
    },
    ...options,
  });

  if (response.status === 401) {
    // The server wants a code we do not have (or the wrong one).
    showLock('Enter your access code to open this office.');
    throw new Error('Locked — enter the access code.');
  }

  const json = await response.json().catch(() => ({ ok: false, error: 'Unexpected server response' }));
  if (!response.ok) throw new Error(json.error || `Request failed (${response.status})`);
  return json;
}

/* ── lock screen ──────────────────────────────────────────── */
function showLock(message = '') {
  const node = $('#lock-screen');
  if (!node) return;
  node.hidden = false;
  $('#lock-error').textContent = message;
  setTimeout(() => $('#lock-code')?.focus(), 60);
}

function hideLock() {
  const node = $('#lock-screen');
  if (node) node.hidden = true;
}

async function unlockWith(value) {
  const response = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: value }),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok || !json.ok) {
    $('#lock-error').textContent = json.error || 'That code did not work.';
    return false;
  }
  setCode(value);
  hideLock();
  await refresh();
  // The stream may have failed while we were locked — open it again with the code.
  if (!ui.live) startLiveStream();
  return true;
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
        .slice(0, 8)
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

  const missionRows = data.mission || [];
  $('#mission-count').textContent = `${missionRows.length} item${missionRows.length === 1 ? '' : 's'}`;
  renderActivityChart();
}

function renderActivityChart() {
  const series = ui.state?.dashboard?.activity || [];
  const chart = $('#activity-chart');
  if (!chart) return;
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

/* ── My Team ────────────────────────────────────────────────── */

const TEAM_ACCENT = {
  manager: '#a78bfa',
  content: '#38bdf8',
  research: '#a3e635',
  finder: '#34d399',
  followup: '#fbbf24',
  quality: '#fb7185',
  report: '#c4b5fd',
  proposal: '#f472b6',
};

const RESULT_TONE = {
  ok: { label: 'worked', color: '#a3e635' },
  fallback: { label: 'worked offline', color: '#fbbf24' },
  failed: { label: 'failed', color: '#fb7185' },
  never: { label: 'not started', color: '#64748b' },
};

/** Switch between the four Client Finder steps and keep the counters honest. */
function showFinderPane(pane) {
  if (!pane) return;
  $$('#finder-tabs button').forEach((item) => item.classList.toggle('is-active', item.dataset.pane === pane));
  $$('.finder-pane').forEach((section) => section.classList.toggle('is-active', section.dataset.pane === pane));
  const leads = (ui.state?.leads || []);
  const audited = leads.filter((lead) => lead.audit?.reachable).length;
  $('#seg-leads').textContent = leads.length;
  $('#seg-audited').textContent = audited;
  const hints = {
    search: 'Step 1 — describe the niche. You get a research plan, not a contact list.',
    leads: 'Step 2 — every lead needs a public source and your check before outreach.',
    audit: 'Step 3 — audit opens the real page. Evidence, never guesses.',
    manual: 'Step 4 — already know the business? Paste it with the source link.',
  };
  $('#finder-hint').textContent = hints[pane] || '';
  $('#content').scrollTop = 0;
}

/** Open the approval list, then scroll to and flash the draft the user came for. */
function revealApproval(draftId) {
  ui.filters.approvals = 'Awaiting approval';
  renderApprovals();
  // let the DOM settle before measuring
  requestAnimationFrame(() => {
    const row = document.querySelector(`[data-draft-card="${draftId}"]`);
    if (!row) return;
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 1600);
  });
}

function renderTeam() {
  const state = ui.state;
  if (!state) return;
  const rows = state.team?.rows || [];
  const summary = state.team?.summary || { total: 0, activeToday: 0, failing: [], neverRun: [], waitingItems: 0 };

  const working = rows.filter((row) => row.runsToday > 0).length;
  const needs = rows.filter((row) => row.waiting.length > 0).length;

  $('#team-head').innerHTML = `
    <div class="team-banner">
      <div>
        <b>${working} of ${summary.total} agents worked today.</b>
        <span>${needs} holding work for you · ${summary.waitingItems} item${summary.waitingItems === 1 ? '' : 's'} blocked on a human decision</span>
      </div>
      <button class="btn btn-ghost btn-sm" data-command="/brief"><svg class="ic"><use href="#i-moon" /></svg>Ask for a brief</button>
    </div>
    ${summary.neverRun.length ? `<p class="team-note">Never used yet: ${esc(summary.neverRun.join(', '))}. Built and waiting — not broken.</p>` : ''}`;

  if (!rows.length) {
    $('#team-grid').innerHTML = emptyState('No agents loaded', 'Restart the office once.');
    return;
  }

  // One line per agent. The detail that used to sit in a card lives in the
  // expandable row so the page reads as a list, not eight equal boxes.
  $('#team-grid').innerHTML = `<div class="team-table">
    ${rows
      .map((row) => {
        const tone = RESULT_TONE[row.lastResult] || RESULT_TONE.never;
        const accent = TEAM_ACCENT[row.id] || '#8b5cf6';
        const doing = row.doing.length ? row.doing.slice(0, 2).join(' · ') : 'nothing in hand';
        const waiting = row.waiting.length ? row.waiting.join(' · ') : '';
        return `<details class="team-row" style="--accent:${accent}">
          <summary>
            <span class="tr-dot" style="background:${tone.color}" title="${esc(tone.label)}"></span>
            <span class="tr-name"><b>${esc(row.name)}</b><small>${esc(row.idle)}</small></span>
            <span class="tr-doing">${esc(doing)}</span>
            <span class="tr-hold">${waiting ? `<svg class="ic"><use href="#i-alert" /></svg>${row.waiting.length}` : ''}</span>
            <span class="tr-rate">${row.okRate === null ? '—' : `${row.okRate}%`}</span>
            <svg class="ic tr-chev"><use href="#i-chevron" /></svg>
          </summary>
          <div class="tr-body">
            <p class="tm-job">${esc(row.responsibility)}</p>
            <div class="tm-stats">
              <span><b>${row.runs}</b> runs</span>
              <span><b>${row.finished}</b> finished</span>
              <span>engine <b>${esc(row.provider)}</b></span>
              <span>result <b style="color:${tone.color}">${esc(tone.label)}</b></span>
            </div>
            ${row.doing.length ? `<div class="tm-block"><span class="tm-label">Doing now</span><ul>${row.doing.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
            ${row.waiting.length ? `<div class="tm-block tm-wait"><span class="tm-label">Waiting on you</span><ul>${row.waiting.map((line) => `<li>${esc(line)}</li>`).join('')}</ul></div>` : ''}
            <p class="hint">${esc(row.humanControl)}</p>
          </div>
        </details>`;
      })
      .join('')}
  </div>`;

  const held = [];
  for (const draft of (state.drafts || []).filter((d) => d.status === 'Awaiting approval')) {
    held.push({ id: draft.id, what: `${draft.platform} draft: ${draft.title || draft.request}`, who: 'Content agent', view: 'approvals' });
  }
  for (const lead of (state.leads || []).filter((l) => l.reviewStatus !== 'Verified by human').slice(0, 6)) {
    held.push({ id: lead.id, what: `${lead.businessName} — needs a human check`, who: 'Research agent', view: 'finder' });
  }
  for (const lead of (state.leads || []).filter((l) => l.audit?.reachable && l.stage === 'Verified').slice(0, 4)) {
    held.push({ id: lead.id, what: `${lead.businessName} — audit ready, no outreach yet`, who: 'Finder', view: 'finder' });
  }

  $('#team-held-count').textContent = `${held.length} held`;
  $('#team-held').innerHTML = held.length
    ? held
        .slice(0, 10)
        .map(
          (row) => `<div class="list-row">
            <span class="agent-dot">${esc(initials(row.who))}</span>
            <span class="l-main"><b>${esc(row.what)}</b><small>${esc(row.who)} · ${esc(row.id)}</small></span>
            <button class="link-btn" data-view="${row.view}">open<svg class="ic"><use href="#i-chevron" /></svg></button>
          </div>`,
        )
        .join('')
    : emptyState('Nothing is stuck on you', 'Every agent is clear to continue.');
}

/* ── page help: what every button is for ───────────────────── */

/**
 * Plain answers to "what does this screen do and which button should I press".
 * Written for someone opening the console for the first time, not for docs.
 */
const PAGE_HELP = {
  dashboard: {
    what: 'One screen answer to: what needs me right now?',
    steps: [
      ['Morning brief', 'Asks the office to summarise today. Read it, then clear the queue.'],
      ['Ring on the left', 'Your office score: approvals waiting, overdue work, blocked items.'],
      ['Cards below', 'Click any number to jump to the full list behind it.'],
    ],
    avoid: 'Do not start new work while the Approvals badge is above zero.',
  },
  console: {
    what: 'Where you type commands in plain English. Nothing here sends anything to a client.',
    steps: [
      ['Type or pick a chip', 'e.g. /task plan the week, /find cafés in Pune, /draft an Instagram post.'],
      ['Enter', 'The office answers with drafts, plans or lists — all gated behind your approval.'],
      ['/help', 'Lists every command with one line each.'],
    ],
    avoid: 'Slash commands are exact. /draft works; "write me a post" is a guess.',
  },
  approvals: {
    what: 'The gate. Every draft — content, outreach, proposal — stops here until you decide.',
    steps: [
      ['Approve', 'Marks it ready. You still post or send it yourself; the app never does.'],
      ['Revise', 'Creates a new version and keeps the old one in history.'],
      ['Reject', 'Closes it with your reason so the same mistake is not repeated.'],
    ],
    avoid: 'Approve means "I checked this", not "publish this".',
  },
  team: {
    what: 'Eight agents. What each one is doing, what it finished, and what it is holding for you.',
    steps: [
      ['Status dot', 'Green worked, amber worked offline, red failed, grey never used.'],
      ['Doing now', 'The actual items in its hands — not a health score.'],
      ['Waiting on you', 'Work that cannot move until you approve or verify.'],
    ],
    avoid: 'If an agent says "never run", that feature exists but you have not used it yet.',
  },
  work: {
    what: 'Tasks with an owner, a priority and a deadline. Owners are you or an agent.',
    steps: [
      ['New task', 'Describe the work; the manager splits it into owned tasks.'],
      ['Filters', 'Open / Pending / Blocked / Done — use them instead of scrolling.'],
      ['CSV', 'Downloads the current table for a spreadsheet.'],
    ],
    avoid: 'A task owned by "You" is the only kind that moves on its own. Others need you to act.',
  },
  clients: {
    what: 'Your small CRM: one card per client, moving through the pipeline.',
    steps: [
      ['Add client', 'Only for businesses you already talked to. Leads live in Client Finder.'],
      ['Stage', 'Lead → Proposal sent → Negotiation → Won / Lost.'],
      ['Drawer', 'Click a card for notes, follow-up date and proposal draft.'],
    ],
    avoid: 'Do not put a cold lead here; verify it first in Client Finder.',
  },
  finder: {
    what: 'Four steps: find real businesses, check them, audit their site, or add one you already know.',
    steps: [
      ['1 · Find', 'Niche + city. You get a research plan you can actually execute.'],
      ['2 · Leads', 'Live search pulls real businesses from OpenStreetMap with source links.'],
      ['3 · Audit', 'Opens the page and reports only what is there. Failed fetch is not a finding.'],
      ['4 · Add manually', 'Paste a business you saw. It still needs a public source URL.'],
    ],
    avoid: 'Nothing here guesses a phone number or a name. If it was not found, it stays empty.',
  },
  calendar: {
    what: 'Next 21 days of deadlines and follow-ups.',
    steps: [
      ['Agenda', 'Everything due, oldest first.'],
      ['Overdue', 'Past its date and still open — fix these first.'],
      ['Waiting on you', 'Approvals that block other people.'],
    ],
    avoid: 'Nothing is auto-rescheduled. Overdue work stays overdue until you change it.',
  },
  reports: {
    what: 'Daily log, agent health, model usage.',
    steps: [
      ['Daily log', 'One row per day you generated a report.'],
      ['Agent health', 'Runs, success rate, average time, engine used.'],
      ['Model usage', 'Calls today against your daily cap.'],
    ],
    avoid: 'An agent with 0 runs is not broken; it simply has not been used.',
  },
  audit: {
    what: 'Every command, decision and blocked action, newest first.',
    steps: [
      ['Timeline', 'Who did what, on which record, at what time.'],
      ['Levels', 'info, warn, and blocked events tell you what the system refused.'],
    ],
    avoid: 'This list is append-only by design. It is your audit trail, not a debug log.',
  },
  setup: {
    what: 'Your profile, the AI engine, exports and a real deployment checklist.',
    steps: [
      ['Profile', 'Name, company, currency, monthly target.'],
      ['Engine', 'Ollama or Gemini. Offline rules always work without either.'],
      ['Checklist', 'Green means actually verified, not "probably fine".'],
      ['Backup', 'Downloads a snapshot. Copy it off this machine.'],
    ],
    avoid: 'Do not leave the console unlocked if this port is reachable from outside.',
  },
  guide: {
    what: 'The written guide, chapter by chapter, plus what changed in v2.1 and v2.2.',
    steps: [['Pick a chapter', 'Reads the markdown straight from docs/.']],
    avoid: 'Anything marked legacy in the setup chapters describes the old n8n path, which is gone.',
  },
};

function renderPageHelp() {
  const panel = $('#page-help');
  if (!panel || panel.hidden) return;
  const help = PAGE_HELP[ui.view];
  if (!help) {
    panel.innerHTML = '';
    return;
  }
  panel.innerHTML = `<div class="help-card">
    <header>
      <b>${esc(PAGES[ui.view]?.[0] || '')} — what this page does</b>
      <button class="icon-btn" data-help-close type="button" aria-label="Close help"><svg class="ic"><use href="#i-close" /></svg></button>
    </header>
    <p class="help-what">${esc(help.what)}</p>
    <ol class="help-steps">${help.steps.map(([label, text]) => `<li><b>${esc(label)}</b><span>${esc(text)}</span></li>`).join('')}</ol>
    <p class="help-avoid"><b>Watch out:</b> ${esc(help.avoid)}</p>
  </div>`;
}

function togglePageHelp(force) {
  const panel = $('#page-help');
  if (!panel) return;
  const next = force === undefined ? panel.hidden : force;
  panel.hidden = !next;
  if (next) renderPageHelp();
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
  const team = state.team?.summary;
  $('#count-team').textContent = team ? `${team.activeToday}/${team.total}` : '0';
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
  renderTeam();
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
  /* ── website auditor + follow-ups ───────────────────────── */
  $('#btn-audit-batch')?.addEventListener('click', async () => {
    const btn = $('#btn-audit-batch');
    const status = $('#audit-status');
    btn.disabled = true;
    status.textContent = 'Opening pages… this can take a few seconds.';
    try {
      const result = await mutate('/api/audit', { limit: 5, onlyUnverified: true }, { toastMessage: 'Audit finished' });
      const rows = result.rows || [];
      status.textContent = rows.length
        ? `${rows.length} checked · ${rows.filter((r) => r.severity === 'high').length} with a high-severity gap`
        : 'Nothing left to audit.';
      renderAuditPanel();
    } catch (error) {
      status.textContent = error.message;
      toast(error.message, 'bad');
    } finally {
      btn.disabled = false;
    }
  });

  document.addEventListener('click', async (event) => {
    const single = event.target.closest('[data-audit-lead]');
    if (single) {
      single.disabled = true;
      single.textContent = 'Opening…';
      try {
        await mutate('/api/audit', { id: single.dataset.auditLead }, { toastMessage: 'Audited' });
        renderAuditPanel();
      } catch (error) {
        toast(error.message, 'bad');
      } finally {
        single.disabled = false;
        single.textContent = 'Re-audit';
      }
      return;
    }

    const copyFollow = event.target.closest('[data-copy-followup]');
    if (copyFollow) {
      const [id, step] = copyFollow.dataset.copyFollowup.split('|');
      const row = (ui.state?.followups || []).find((item) => item.id === id && String(item.step) === step);
      if (row) {
        await navigator.clipboard?.writeText(row.text).catch(() => {});
        toast('Follow-up copied — send it yourself', 'good');
      }
      return;
    }

    const sent = event.target.closest('[data-followup-sent]');
    if (sent) {
      const [id, step, kind] = sent.dataset.followupSent.split('|');
      try {
        await mutate('/api/followups/sent', { kind, id, step: Number(step) }, { toastMessage: `Day ${step} recorded` });
        renderFollowUps();
      } catch (error) {
        toast(error.message, 'bad');
      }
    }
  });

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

  $('#btn-help').addEventListener('click', () => togglePageHelp());
  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-help-close]')) togglePageHelp(false);
  });
  document.addEventListener('keydown', (event) => {
    // "?" opens the page help, Escape closes it. Ignore while typing.
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (event.key === '?' && !typing) {
      event.preventDefault();
      togglePageHelp();
    }
    if (event.key === 'Escape' && !$('#page-help')?.hidden) togglePageHelp(false);
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
  $('#hero-approve').addEventListener('click', () => {
    // Go where the work actually is. Approvals win; otherwise the queue order does.
    const first = (ui.state?.dashboard?.mission || [])[0];
    const map = { approval: 'approvals', task: 'work', followup: 'calendar', verify: 'finder' };
    setView(map[first?.kind] || 'approvals');
  });

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

  $('#finder-tabs')?.addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    showFinderPane(button.dataset.pane);
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
        const ref = card.dataset.ref || '';
        if (kind === 'approval') {
          setView('approvals');
          if (ref) revealApproval(ref);
        } else if (kind === 'verify') setView('finder');
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

  $('#source-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.target);
    await runSourceSearch({
      niche: form.get('niche'),
      location: form.get('location'),
      limit: Number(form.get('limit') || 20),
      provider: form.get('provider') || 'auto',
    });
  });

  /* live search result controls (delegated) */
  document.addEventListener('click', async (event) => {
    const selectAll = event.target.closest('[data-source-select]');
    if (selectAll) {
      const on = selectAll.dataset.sourceSelect === 'all';
      document.querySelectorAll('[data-source-row]').forEach((box) => {
        box.checked = on;
      });
      return;
    }

    const importBtn = event.target.closest('[data-source-import]');
    if (importBtn && sourceResults?.results) {
      const picked = [...document.querySelectorAll('[data-source-row]')]
        .filter((box) => box.checked)
        .map((box) => sourceResults.results[Number(box.dataset.sourceRow)])
        .filter(Boolean);

      if (!picked.length) {
        toast('Tick at least one business first.', 'bad');
        return;
      }

      importBtn.disabled = true;
      try {
        const result = await api('/api/source/import', {
          method: 'POST',
          body: JSON.stringify({
            niche: sourceResults.niche,
            location: sourceResults.location,
            businesses: picked,
          }),
        });
        if (result.state) ui.state = result.state;
        renderAll();
        const skipped = result.skipped || [];
        if (result.imported && skipped.length) {
          toast(`${result.imported} added · ${skipped.length} skipped (${skipped[0].reason})`, 'warn');
        } else if (result.imported) {
          toast(`${result.imported} lead(s) added — verify each one before outreach.`, 'good');
        } else {
          toast(`Nothing added — ${skipped[0]?.reason || 'no usable rows'}.`, 'bad');
        }
        document.querySelectorAll('[data-source-row]').forEach((box) => {
          box.checked = false;
        });
      } catch (error) {
        toast(error.message, 'bad');
      } finally {
        importBtn.disabled = false;
      }
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
        await mutate('/api/reset', { confirm: 'DELETE EVERYTHING', seed: false }, { toastMessage: 'Office reset.', tone: 'bad' });
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

function bindLock() {
  $('#lock-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = $('#lock-code').value.trim();
    if (!value) return;
    const ok = await unlockWith(value);
    if (!ok) $('#lock-code').select();
  });
  $('#lock-exit')?.addEventListener('click', () => {
    clearCode();
    showLock('Code forgotten. Enter it again.');
  });
}

/* ── live state (v2.3) ─────────────────────────────────────── */

/** The honest light: green only while the stream is actually open. */
function updateLivePill(status) {
  const pill = $('#live-pill');
  if (!pill) return;
  const map = {
    live: { label: 'live', color: '#a3e635', title: 'Connected — updates arrive instantly' },
    connecting: { label: 'connecting', color: '#fbbf24', title: 'Opening the live connection' },
    offline: { label: 'polling', color: '#fb7185', title: 'Live stream unavailable — refreshing every 30s instead' },
  };
  const tone = map[status] || map.connecting;
  pill.dataset.status = status;
  pill.querySelector('b').textContent = tone.label;
  pill.querySelector('.dot').style.background = tone.color;
  pill.title = tone.title;
}

/**
 * Subscribe to /api/stream. The browser reconnects by itself on failure; we only
 * need to reflect the state honestly and fall back to polling if it never opens.
 */
function startLiveStream() {
  if (!('EventSource' in window)) {
    ui.live = false;
    updateLivePill('offline');
    return;
  }
  let stream;
  try {
    // If the console is locked the code is in memory only; pass it through the
    // query string because EventSource cannot set headers.
    const saved = getCode();
    const code = saved ? `?code=${encodeURIComponent(saved)}` : '';
    stream = new EventSource(`/api/stream${code}`);
  } catch {
    ui.live = false;
    updateLivePill('offline');
    return;
  }

  stream.addEventListener('hello', () => {
    ui.live = true;
    updateLivePill('live');
  });

  stream.addEventListener('state', (event) => {
    let payload;
    try {
      payload = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!payload?.state) return;
    const previousView = ui.view;
    const lastId = (ui.state?.messages || []).at(-1)?.id;
    ui.state = payload.state;
    // Only repaint what the person is looking at, so a live update never
    // yanks them out of a form they are typing into.
    renderChrome();
    if (ui.busy) return;
    if (previousView === 'dashboard') renderDashboard();
    if (previousView === 'team') renderTeam();
    if (previousView === 'approvals') renderApprovals();
    if (previousView === 'work') renderTasks();
    if (previousView === 'clients') renderClients();
    if (previousView === 'finder') renderFinder();
    if (previousView === 'calendar') renderCalendar();
    if (previousView === 'reports') renderReports();
    if (previousView === 'audit') renderAudit();
    if (previousView === 'console') {
      renderConsole();
      if ((ui.state?.messages || []).at(-1)?.id !== lastId) renderChat();
    }
    flashLive();
  });

  stream.addEventListener('error', () => {
    // EventSource retries on its own; only downgrade the indicator.
    if (ui.live) {
      ui.live = false;
      updateLivePill('offline');
    }
  });

  window.addEventListener('beforeunload', () => stream.close());
}

/** A short green pulse in the top bar so you can see the update land. */
function flashLive() {
  const pill = $('#live-pill');
  if (!pill) return;
  pill.classList.remove('just-updated');
  void pill.offsetWidth;
  pill.classList.add('just-updated');
}

async function boot() {
  bindLock();
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
  loadSourcingStatus();

  startLiveStream();
  updateLivePill('connecting');

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
    if (document.hidden || ui.live) return;
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
