/* AI Digital Office — front-end controller. Plain ES modules, no build step. */

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

const ui = {
  state: null,
  view: 'console',
  filters: { tasks: 'all', drafts: 'all' },
  busy: false,
  docs: [],
  activeDoc: null,
  chatClearedAt: 0,
};

const escapeHtml = (value = '') =>
  String(value).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));

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
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
};

const shortDate = (iso) => (iso ? String(iso).slice(0, 10) : '');

/* ── Toast ─────────────────────────────────────────────────── */

let toastTimer;
function toast(message, tone = '') {
  const node = $('#toast');
  node.textContent = message;
  node.className = `toast is-visible ${tone ? `is-${tone}` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    node.className = 'toast';
  }, 3600);
}

/* ── API ───────────────────────────────────────────────────── */

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

async function sendCommand(raw) {
  const text = String(raw || '').trim();
  if (!text || ui.busy) return;
  ui.busy = true;
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

/* ── Chat ──────────────────────────────────────────────────── */

const WELCOME = {
  role: 'bot',
  text: [
    '👋 Welcome to your AI Digital Office.',
    '',
    'Send a command and I will plan the work, draft the content, and wait for your approval before anything leaves this screen.',
    '',
    'Try one of these:',
    '/task Plan a beginner-friendly Instagram Reel about free AI tools for small businesses',
    '/draft Write a friendly Instagram caption for that Reel',
    '/report',
  ].join('\n'),
  buttons: [
    { label: 'Try /task', command: '/task Plan a beginner-friendly Instagram Reel about free AI tools for small businesses', tone: 'good' },
    { label: 'Daily report', command: '/report' },
    { label: 'Commands', command: '/help' },
  ],
  ts: new Date().toISOString(),
};

function messageNode(message) {
  const wrap = document.createElement('div');
  wrap.className = `msg msg-${message.role === 'user' ? 'user' : message.role === 'system' ? 'system' : 'bot'}`;
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

  const time = document.createElement('span');
  time.className = 'msg-time';
  time.textContent = timeLabel(message.ts);
  wrap.appendChild(time);
  return wrap;
}

function handleQuickButton(button) {
  const command = String(button.command || '');
  if (!command.startsWith('/')) {
    navigator.clipboard
      ?.writeText(command)
      .then(() => toast('Copied — publish it yourself when you are ready.', 'good'))
      .catch(() => toast('Copy failed. Select the draft text manually.', 'bad'));
    return;
  }
  if (command.endsWith(' ')) {
    openModal({
      title: button.label,
      message: 'Add the detail the agent needs. This stays in your hands.',
      field: { type: 'textarea', placeholder: 'Your feedback or reason…' },
      confirmLabel: 'Send',
      onConfirm: (value) => {
        const suffix = value.trim();
        if (!suffix) {
          toast('Add a short note first.', 'bad');
          return false;
        }
        sendCommand(`${command.trim()} ${suffix}`);
        return true;
      },
    });
    return;
  }
  sendCommand(command);
}

function renderChat({ keepScroll = false } = {}) {
  const stream = $('#chat-stream');
  const nearBottom = stream.scrollHeight - stream.scrollTop - stream.clientHeight < 90;
  const previousTop = stream.scrollTop;
  stream.innerHTML = '';
  const messages = (ui.state?.messages || []).filter(
    (message) => new Date(message.ts).getTime() > ui.chatClearedAt,
  );
  const list = messages.length ? messages : [WELCOME];
  for (const message of list) stream.appendChild(messageNode(message));
  showTyping(ui.busy);
  stream.scrollTop = keepScroll && !nearBottom ? previousTop : stream.scrollHeight;
}

function appendLocalMessage(message) {
  const stream = $('#chat-stream');
  if (stream.querySelector('.typing')) stream.querySelector('.typing').remove();
  stream.appendChild(messageNode(message));
  stream.scrollTop = stream.scrollHeight;
}

function showTyping(show) {
  const stream = $('#chat-stream');
  const existing = stream.querySelector('.typing-wrap');
  if (existing) existing.remove();
  if (!show) return;
  const wrap = document.createElement('div');
  wrap.className = 'msg msg-bot typing-wrap';
  wrap.innerHTML = '<div class="bubble typing"><i></i><i></i><i></i></div>';
  stream.appendChild(wrap);
  stream.scrollTop = stream.scrollHeight;
}

/* ── Stats / rail ──────────────────────────────────────────── */

function renderStats() {
  const state = ui.state;
  if (!state) return;
  const tasks = state.tasks || [];
  const drafts = state.drafts || [];
  const leads = state.leads || [];
  const awaiting = drafts.filter((draft) => draft.status === 'Awaiting approval');
  const open = tasks.filter((task) => task.status !== 'Done');
  const blocked = tasks.filter((task) => task.status === 'Blocked');
  const toVerify = leads.filter((lead) => lead.reviewStatus === 'Needs human verification');

  $('#stat-awaiting').textContent = awaiting.length;
  $('#stat-awaiting-foot').textContent = awaiting.length
    ? `${awaiting.map((draft) => draft.id).slice(0, 3).join(' · ')}`
    : 'All clear — nothing waiting';
  $('#stat-open').textContent = open.length;
  $('#stat-blocked').textContent = blocked.length;
  $('#stat-leads').textContent = toVerify.length;
  $('#stat-calls').textContent = `${state.provider?.callsToday ?? 0}/${state.provider?.limit ?? 0}`;

  $('#nav-count-tasks').textContent = open.length;
  $('#nav-count-drafts').textContent = awaiting.length;
  $('#nav-count-drafts').dataset.active = awaiting.length > 0;
  $('#nav-count-leads').textContent = toVerify.length;
  $('#nav-dot-console').hidden = awaiting.length === 0;

  const engine = state.provider;
  const mode = engine?.ollama?.reachable
    ? 'ollama'
    : engine?.gemini?.configured
      ? 'gemini'
      : 'offline';
  const tag = $('#engine-tag');
  tag.textContent = mode;
  tag.className = `tag ${mode === 'offline' ? 'tag-warn' : 'tag-good'}`;
  $('#provider-label').textContent =
    mode === 'offline' ? 'offline rules engine' : `${mode} · ${mode === 'ollama' ? engine.ollama.models?.[0] || engine.ollama.models?.length + ' model(s)' : engine.gemini.model}`;

  $('#engine-note').textContent =
    mode === 'offline'
      ? 'No local model detected and no Gemini key. Every agent is still working with deterministic rules — safe, just less flexible.'
      : mode === 'ollama'
        ? `Connected to Ollama at ${engine.ollama.url}. Drafts are private and stay on this machine.`
        : `Using Gemini (${engine.gemini.model}). Prompts leave your machine — keep secrets out of drafts.`;

  $('#chat-status').textContent = awaiting.length
    ? `Online · ${awaiting.length} draft${awaiting.length === 1 ? '' : 's'} awaiting your approval`
    : 'Online · approval gates on';

  $('#brand-sub').textContent = `Prototype v${state.meta?.version || '1.0'}`;
}

function renderTeam() {
  const list = $('#team-list');
  list.innerHTML = '';
  for (const agent of ui.state?.agents || []) {
    const item = document.createElement('li');
    const initials = agent.name
      .replace(/[^A-Za-z ]/g, '')
      .split(/\s+/)
      .map((word) => word[0])
      .join('')
      .slice(0, 2);
    item.innerHTML = `<span class="team-dot">${escapeHtml(initials)}</span><span><b>${escapeHtml(agent.name)}</b>${escapeHtml(agent.humanControl)}</span>`;
    list.appendChild(item);
  }
}

/* ── Tasks ─────────────────────────────────────────────────── */

const statusTone = (status) =>
  ({
    Done: 'tag-good',
    Blocked: 'tag-bad',
    'In Progress': 'tag-info',
    Pending: 'tag-warn',
    Approved: 'tag-good',
    'Awaiting approval': 'tag-warn',
    'Revision requested': 'tag-info',
    Rejected: 'tag-bad',
  })[status] || '';

const priorityTone = (priority) => (priority === 'High' ? 'tag-bad' : priority === 'Medium' ? 'tag-warn' : 'tag');

function renderTasks() {
  const body = $('#tasks-table tbody');
  const tasks = (ui.state?.tasks || []).filter(
    (task) => ui.filters.tasks === 'all' || task.status === ui.filters.tasks,
  );
  body.innerHTML = '';
  $('#tasks-empty').hidden = tasks.length > 0;
  $('#tasks-table').hidden = tasks.length === 0;

  for (const task of tasks) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="mono">${escapeHtml(task.id)}</span></td>
      <td class="task-cell">
        <strong>${escapeHtml(task.task)}</strong>
        <span>${escapeHtml(task.request || '')}</span>
        ${task.notes ? `<span>↳ ${escapeHtml(task.notes)}</span>` : ''}
      </td>
      <td><span class="tag ${priorityTone(task.priority)}">${escapeHtml(task.priority)}</span></td>
      <td>${escapeHtml(task.owner)}</td>
      <td>${task.deadline ? escapeHtml(task.deadline) : '<span class="muted">—</span>'}</td>
      <td><span class="tag ${statusTone(task.status)}">${escapeHtml(task.status)}</span></td>
      <td>
        <div class="row-actions">
          ${task.status !== 'Done' ? `<button class="mini-btn good" data-task-done="${escapeHtml(task.id)}">Done</button>` : ''}
          ${task.status === 'Pending' ? `<button class="mini-btn" data-task-start="${escapeHtml(task.id)}">Start</button>` : ''}
          ${task.status !== 'Blocked' && task.status !== 'Done' ? `<button class="mini-btn bad" data-task-block="${escapeHtml(task.id)}">Block</button>` : ''}
          ${task.status === 'Done' ? `<button class="mini-btn" data-task-reopen="${escapeHtml(task.id)}">Reopen</button>` : ''}
        </div>
      </td>`;
    body.appendChild(row);
  }
}

/* ── Drafts ────────────────────────────────────────────────── */

function renderDrafts() {
  const list = $('#drafts-list');
  const drafts = (ui.state?.drafts || []).filter(
    (draft) => ui.filters.drafts === 'all' || draft.status === ui.filters.drafts,
  );
  list.innerHTML = '';

  if (drafts.length === 0) {
    list.innerHTML = `
      <div class="card empty">
        <p>No drafts here yet. Try <code>/draft Write a friendly Instagram caption for that Reel</code>.</p>
      </div>`;
    return;
  }

  for (const draft of drafts) {
    const card = document.createElement('article');
    card.className = 'card draft-card';
    const qa = draft.qa;
    const qaTone = qa?.decision === 'reject' ? 'is-bad' : qa?.decision === 'revise' ? 'is-warn' : '';
    const awaiting = draft.status === 'Awaiting approval';

    card.innerHTML = `
      <div class="draft-head">
        <div class="draft-title">
          <strong>${escapeHtml(draft.id)} · ${escapeHtml(draft.title || draft.request)}</strong>
          <small>${escapeHtml(draft.platform)} · tone ${escapeHtml(draft.tone || 'friendly')} · v${draft.version || 1} · ${escapeHtml(draft.provider || 'offline')}${draft.taskId ? ` · linked ${escapeHtml(draft.taskId)}` : ''}</small>
        </div>
        <div class="draft-tags">
          <span class="tag ${statusTone(draft.status)}">${escapeHtml(draft.status)}</span>
          ${draft.reviewer ? `<span class="tag">${escapeHtml(draft.reviewer)}</span>` : ''}
        </div>
      </div>
      <pre class="draft-body">${escapeHtml(draft.draft)}</pre>
      ${
        qa
          ? `<div class="qa ${qaTone}">
              <strong>QA:</strong>
              <div>
                ${escapeHtml(qa.decision || 'not run')}${qa.issues?.length ? `<ul>${qa.issues.map((issue) => `<li>${escapeHtml(issue)}</li>`).join('')}</ul>` : ' — no blocking issues'}
              </div>
            </div>`
          : ''
      }
      <div class="draft-actions">
        ${awaiting ? `<button class="btn btn-small btn-good" data-draft="approve" data-id="${escapeHtml(draft.id)}">Approve</button>` : ''}
        ${
          draft.status !== 'Rejected'
            ? `<button class="btn btn-small btn-ghost" data-draft="revise" data-id="${escapeHtml(draft.id)}">Request revision</button>`
            : ''
        }
        ${awaiting ? `<button class="btn btn-small btn-danger" data-draft="reject" data-id="${escapeHtml(draft.id)}">Reject</button>` : ''}
        <button class="btn btn-small btn-ghost" data-copy="${escapeHtml(draft.id)}">Copy</button>
        <div class="draft-meta">
          ${draft.decisionAt ? `<span>${escapeHtml(dayLabel(draft.decisionAt))} ${escapeHtml(timeLabel(draft.decisionAt))}</span>` : `<span>${escapeHtml(dayLabel(draft.createdAt))}</span>`}
          ${draft.feedback ? `<span>· ${escapeHtml(draft.feedback.slice(0, 60))}</span>` : ''}
        </div>
      </div>`;
    list.appendChild(card);
  }
}

/* ── Leads ─────────────────────────────────────────────────── */

function renderLeads() {
  const body = $('#leads-table tbody');
  const leads = ui.state?.leads || [];
  body.innerHTML = '';
  $('#leads-empty').hidden = leads.length > 0;
  $('#leads-table').hidden = leads.length === 0;
  $('#leads-summary').textContent = `${leads.length} lead${leads.length === 1 ? '' : 's'} · ${leads.filter((lead) => lead.reviewStatus === 'Needs human verification').length} need verification`;

  for (const lead of leads) {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><span class="mono">${escapeHtml(lead.id)}</span></td>
      <td class="task-cell">
        <strong>${escapeHtml(lead.businessName)}</strong>
        <span>${escapeHtml(lead.fitReason || '')}</span>
      </td>
      <td>${escapeHtml(lead.niche || '—')}</td>
      <td><a class="mono" href="${escapeHtml(lead.sourceUrl)}" target="_blank" rel="noreferrer noopener">source ↗</a></td>
      <td><span class="tag">${escapeHtml(lead.contactStatus)}</span></td>
      <td><span class="tag ${lead.reviewStatus === 'Verified' ? 'tag-good' : 'tag-warn'}">${escapeHtml(lead.reviewStatus)}</span></td>
      <td>
        <div class="row-actions">
          <button class="mini-btn" data-outreach="${escapeHtml(lead.id)}">Outreach</button>
          ${lead.reviewStatus !== 'Verified' ? `<button class="mini-btn good" data-verify="${escapeHtml(lead.id)}">Verify</button>` : ''}
        </div>
      </td>`;
    body.appendChild(row);
  }
}

/* ── Daily log ─────────────────────────────────────────────── */

function renderLog() {
  const list = $('#log-list');
  const rows = ui.state?.dailyLog || [];
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<div class="card empty"><p>No reports yet. Generate today\'s report to write the first row.</p></div>';
    return;
  }
  for (const row of rows) {
    const card = document.createElement('article');
    card.className = 'card log-card';
    card.innerHTML = `
      <div class="log-head">
        <strong>${escapeHtml(row.date)}</strong>
        <div class="log-stats">
          <span class="log-stat">Completed<b>${row.completed}</b></span>
          <span class="log-stat">Pending<b>${row.pending}</b></span>
          <span class="log-stat">Blocked<b>${row.blocked}</b></span>
          <span class="log-stat">Awaiting approval<b>${row.draftsAwaitingApproval}</b></span>
        </div>
      </div>
      <pre class="log-body">${escapeHtml(row.notes || '')}</pre>`;
    list.appendChild(card);
  }
}

/* ── Audit ─────────────────────────────────────────────────── */

const ACTION_LABEL = {
  'task.created': 'Task created',
  'task.status': 'Task status changed',
  'draft.created': 'Draft created',
  'draft.approved': 'Draft approved',
  'draft.rejected': 'Draft rejected',
  'draft.revision_requested': 'Revision requested',
  'lead.created': 'Leads added',
  'outreach.drafted': 'Outreach drafted',
  'followup.drafted': 'Follow-up drafted',
  'report.generated': 'Daily report',
  'settings.updated': 'Settings updated',
  'provider.tested': 'Provider tested',
  'office.reset': 'Office reset',
  'telegram.denied': 'Blocked Telegram user',
  'telegram.polling_started': 'Telegram connected',
};

function renderAudit() {
  const list = $('#audit-list');
  const rows = ui.state?.audit || [];
  list.innerHTML = '';
  if (!rows.length) {
    list.innerHTML = '<li class="muted">No events recorded yet.</li>';
    return;
  }
  for (const row of rows) {
    const item = document.createElement('li');
    item.dataset.level = row.level || 'info';
    item.innerHTML = `
      <span class="t">${escapeHtml(dayLabel(row.ts).slice(0, 6))} ${escapeHtml(timeLabel(row.ts))}</span>
      <span class="tick"><span></span></span>
      <span class="what">
        <b>${escapeHtml(ACTION_LABEL[row.action] || row.action)}</b>
        ${row.ref ? `<span class="mono">${escapeHtml(row.ref)}</span>` : ''}
        <span>${escapeHtml(row.detail || '')}</span>
        <span class="muted small"> · ${escapeHtml(row.actor || 'system')}</span>
      </span>`;
    list.appendChild(item);
  }
}

/* ── Setup ─────────────────────────────────────────────────── */

function renderSetup() {
  const state = ui.state;
  if (!state) return;
  const settings = state.meta.settings || {};
  $('#set-provider').value = settings.provider || 'auto';
  $('#set-ollama-url').value = settings.ollamaUrl || '';
  $('#set-ollama-model').value = settings.ollamaModel || '';
  $('#set-gemini-model').value = settings.geminiModel || '';
  $('#set-max-calls').value = settings.maxCallsPerDay || 200;

  const secrets = state.secrets || {};
  const rows = [
    ['Engine reachable', state.provider?.ollama?.reachable ? 'Ollama online' : state.provider?.gemini?.configured ? 'Gemini key set' : 'offline rules only', state.provider?.ollama?.reachable || state.provider?.gemini?.configured],
    ['Telegram bot token', secrets.telegramBotToken ? 'stored in .env' : 'not set', secrets.telegramBotToken],
    ['Telegram allow-list', `${settings.allowedUserIds?.length || 0} user(s)`, (settings.allowedUserIds?.length || 0) > 0],
    ['Gemini API key', secrets.geminiKey ? 'set' : 'not set (optional)', secrets.geminiKey],
    ['Webhook secret', secrets.webhookSecret ? 'set' : 'optional', secrets.webhookSecret],
    ['Google Sheet ID', secrets.googleSheetId ? 'set' : 'not set (CSV export available)', secrets.googleSheetId],
  ];
  $('#secret-list').innerHTML = rows
    .map(
      ([label, value, ok]) =>
        `<li><span class="mark ${ok ? 'mark-yes' : 'mark-no'}">${ok ? '✓' : '–'}</span><span><b>${escapeHtml(label)}</b><br />${escapeHtml(value)}</span></li>`,
    )
    .join('');

  const tg = state.telegram || {};
  $('#telegram-list').innerHTML = [
    ['Bot token', tg.configured ? 'configured' : 'missing', tg.configured],
    ['Mode', `${tg.mode}${tg.mode === 'off' ? ' — set TELEGRAM_MODE=polling to start' : ''}`, tg.mode !== 'off'],
    ['Polling', tg.polling ? 'connected' : 'idle', tg.polling],
    ['Allowed users', String(tg.allowedUsers || 0), (tg.allowedUsers || 0) > 0],
    ['Webhook path', tg.webhookPath, true],
  ]
    .map(
      ([label, value, ok]) =>
        `<li><span class="mark ${ok ? 'mark-yes' : 'mark-no'}">${ok ? '✓' : '–'}</span><span><b>${escapeHtml(label)}</b><br />${escapeHtml(value)}</span></li>`,
    )
    .join('');
}

/* ── Docs ──────────────────────────────────────────────────── */

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

  const flushTable = () => {
    if (!tableBuffer.length) return;
    const rows = tableBuffer.filter((row) => !/^\|?[\s:|-]+\|?$/.test(row));
    const cells = rows.map((row) => row.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim()));
    if (cells.length) {
      html.push('<table><thead><tr>' + cells[0].map((cell) => `<th>${inline(cell)}</th>`).join('') + '</tr></thead><tbody>');
      cells.slice(1).forEach((row) => {
        html.push('<tr>' + row.map((cell) => `<td>${inline(cell)}</td>`).join('') + '</tr>');
      });
      html.push('</tbody></table>');
    }
    tableBuffer = [];
  };

  const inline = (text) =>
    escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|\s)\*([^*\n]+)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');

  for (const line of lines) {
    if (line.startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
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
      html.push('<hr />');
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
  if (inCode) html.push(`<pre><code>${escapeHtml(codeBuffer.join('\n'))}</code></pre>`);
  return html.join('\n');
}

async function loadDocs() {
  try {
    const { docs } = await api('/api/docs');
    ui.docs = docs;
    const list = $('#doc-list');
    list.innerHTML = '';
    for (const doc of docs) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'doc-link';
      button.dataset.file = doc.file;
      button.textContent = doc.title;
      button.addEventListener('click', () => openDoc(doc.file));
      list.appendChild(button);
    }
    if (docs.length) openDoc(ui.activeDoc || docs[0].file);
  } catch (error) {
    $('#doc-list').innerHTML = `<p class="muted small">${escapeHtml(error.message)}</p>`;
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
    $('#scroll').scrollTop = 0;
  } catch (error) {
    body.innerHTML = `<p class="muted">${escapeHtml(error.message)}</p>`;
  }
}

/* ── Modal ─────────────────────────────────────────────────── */

let modalState = null;

function openModal({ title, message = '', field = null, fields = null, confirmLabel = 'Send', onConfirm }) {
  modalState = { onConfirm };
  $('#modal-title').textContent = title;
  const body = $('#modal-body');
  body.innerHTML = '';

  if (message) {
    const paragraph = document.createElement('p');
    paragraph.textContent = message;
    paragraph.style.margin = '0 0 14px';
    body.appendChild(paragraph);
  }

  const definitions = fields || (field ? [field] : []);
  for (const definition of definitions) {
    const label = document.createElement('label');
    label.textContent = definition.label || '';
    const input = document.createElement('textarea');
    input.rows = definition.rows || 3;
    input.name = definition.name || 'value';
    input.placeholder = definition.placeholder || '';
    input.value = definition.value || '';
    label.appendChild(input);
    body.appendChild(label);
  }

  $('#modal-confirm').textContent = confirmLabel;
  $('#modal').hidden = false;
  setTimeout(() => body.querySelector('textarea')?.focus(), 60);
}

function closeModal() {
  $('#modal').hidden = true;
  modalState = null;
}

function modalValues() {
  const values = {};
  $$('#modal-body textarea').forEach((input) => {
    values[input.name] = input.value;
  });
  return values;
}

/* ── Render ────────────────────────────────────────────────── */

function renderAll() {
  renderStats();
  renderTeam();
  renderChat();
  renderTasks();
  renderDrafts();
  renderLeads();
  renderLog();
  renderAudit();
  renderSetup();
}

function setView(view) {
  ui.view = view;
  $$('.nav-item').forEach((item) => item.classList.toggle('is-active', item.dataset.view === view));
  $$('.view').forEach((section) => section.classList.toggle('is-active', section.dataset.view === view));
  const titles = {
    console: ['Console', 'Send a command — the office plans, drafts and waits for your approval.'],
    tasks: ['Tasks', 'The Tasks tab of your Google Sheet, mirrored here.'],
    drafts: ['Drafts', 'Everything written by the Content Agent. Nothing leaves without a decision.'],
    leads: ['Leads', 'Public-source research with mandatory URLs and human verification.'],
    log: ['Daily Log', 'One row per day from the Daily Reporting Agent.'],
    audit: ['Audit trail', 'Every command, decision and blocked action, newest first.'],
    setup: ['Setup', 'Engine, secrets, Sheets export and the deployment checklist.'],
    docs: ['Guide', 'The AI Digital Office setup guide, chapter by chapter.'],
  };
  const [title, sub] = titles[view] || ['', ''];
  $('#view-title').textContent = title;
  $('#view-sub').textContent = sub;
  $('#scroll').scrollTop = 0;
  if (view === 'docs' && ui.docs.length === 0) loadDocs();
}

/* ── Events ────────────────────────────────────────────────── */

function bind() {
  $('#nav').addEventListener('click', (event) => {
    const button = event.target.closest('.nav-item');
    if (button) setView(button.dataset.view);
  });

  document.addEventListener('click', (event) => {
    const goto = event.target.closest('[data-goto]');
    if (goto) setView(goto.dataset.goto);
  });

  const composer = $('#composer-input');
  const form = $('#composer-form');

  const autoGrow = () => {
    composer.style.height = 'auto';
    composer.style.height = `${Math.min(composer.scrollHeight, 130)}px`;
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
    setView('console');
  });

  $('#chips').addEventListener('click', (event) => {
    const chip = event.target.closest('.chip');
    if (!chip) return;
    composer.value = chip.dataset.command;
    composer.focus();
    autoGrow();
  });

  $('#btn-clear').addEventListener('click', () => {
    ui.chatClearedAt = Date.now();
    renderChat();
    toast('Chat view cleared. Office data is untouched.');
  });

  const newTask = () =>
    openModal({
      title: 'New task',
      message: 'Describe the work. The AI Manager will split it into 1-5 tasks with priority and owner.',
      field: { type: 'textarea', placeholder: 'Plan a beginner-friendly Instagram Reel about free AI tools…', rows: 4 },
      confirmLabel: 'Plan it',
      onConfirm: (value) => {
        if (!value.trim()) {
          toast('Describe the work first.', 'bad');
          return false;
        }
        sendCommand(`/task ${value.trim()}`);
        setView('console');
        return true;
      },
    });

  $('#btn-task').addEventListener('click', newTask);
  $('#btn-task-2').addEventListener('click', newTask);

  $('#btn-draft').addEventListener('click', () => {
    const pending = (ui.state?.tasks || []).filter((task) => task.status !== 'Done').slice(0, 6);
    openModal({
      title: 'New draft',
      message: 'Describe the content. Add --platform and --tone if you want to be explicit.',
      fields: [
        { name: 'request', label: 'What should the Content Agent write?', rows: 3, placeholder: 'Write a friendly Instagram caption for that Reel' },
        { name: 'platform', label: 'Platform (optional)', rows: 1, placeholder: 'Instagram / LinkedIn / YouTube / Email' },
      ],
      confirmLabel: 'Draft it',
      onConfirm: (value) => {
        if (!value.request?.trim()) {
          toast('Add a content request.', 'bad');
          return false;
        }
        const flags = value.platform?.trim() ? ` --platform ${value.platform.trim()}` : '';
        sendCommand(`/draft ${value.request.trim()}${flags}`);
        setView('console');
        return true;
      },
    });
    void pending;
  });

  $('#btn-lead').addEventListener('click', () => {
    openModal({
      title: 'Add leads',
      message: 'A public source URL is mandatory. The agent will not invent businesses or contact details.',
      fields: [
        { name: 'niche', label: 'Niche', rows: 1, placeholder: 'design agencies' },
        { name: 'location', label: 'Location (optional)', rows: 1, placeholder: 'Pune' },
        { name: 'source', label: 'Public source URL', rows: 1, placeholder: 'https://example.com/directory' },
        { name: 'notes', label: 'What you saw on that page (one business per line)', rows: 4, placeholder: 'Example Studio — active Instagram, no visible content plan' },
      ],
      confirmLabel: 'Prepare rows',
      onConfirm: (value) => {
        if (!value.source?.trim().startsWith('http')) {
          toast('A public http(s) source URL is required.', 'bad');
          return false;
        }
        if (!value.notes?.trim()) {
          toast('Add at least one observation from that source.', 'bad');
          return false;
        }
        sendCommand(`/lead ${value.niche || 'unspecified'} | ${value.location || ''} | ${value.source.trim()} | ${value.notes.trim()}`);
        setView('console');
        return true;
      },
    });
  });

  const report = () => {
    sendCommand('/report');
    setView('console');
  };
  $('#btn-report').addEventListener('click', report);
  $('#btn-report-2').addEventListener('click', report);

  $('#task-filters').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    ui.filters.tasks = button.dataset.filter;
    $$('#task-filters button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderTasks();
  });

  $('#draft-filters').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    ui.filters.drafts = button.dataset.filter;
    $$('#draft-filters button').forEach((item) => item.classList.toggle('is-active', item === button));
    renderDrafts();
  });

  $('#tasks-table').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.taskDone) sendCommand(`/done ${button.dataset.taskDone}`);
    if (button.dataset.taskStart) sendCommand(`/progress ${button.dataset.taskStart}`);
    if (button.dataset.taskBlock) {
      openModal({
        title: 'Block task',
        message: 'Record why it is blocked. The Daily Reporting Agent uses this reason.',
        field: { type: 'textarea', rows: 2, placeholder: 'Waiting for the client to confirm the brief' },
        confirmLabel: 'Mark blocked',
        onConfirm: (value) => {
          sendCommand(`/block ${button.dataset.taskBlock} ${value.trim()}`);
          return true;
        },
      });
    }
    if (button.dataset.taskReopen) sendCommand(`/progress ${button.dataset.taskReopen}`);
  });

  $('#drafts-list').addEventListener('click', (event) => {
    const action = event.target.closest('[data-draft]');
    if (action) {
      const { draft: kind, id } = action.dataset;
      if (kind === 'approve') {
        sendCommand(`/approve ${id}`);
        return;
      }
      openModal({
        title: kind === 'revise' ? `Request revision · ${id}` : `Reject · ${id}`,
        message:
          kind === 'revise'
            ? 'Tell the agent what to change. It will produce a new version — still waiting for your approval.'
            : 'Record the reason so the office learns what to avoid.',
        field: {
          type: 'textarea',
          rows: 3,
          placeholder: kind === 'revise' ? 'Make it shorter and more conversational.' : 'Not aligned with our brand voice.',
        },
        confirmLabel: kind === 'revise' ? 'Request revision' : 'Reject draft',
        onConfirm: (value) => {
          sendCommand(`/${kind} ${id} ${value.trim()}`);
          setView('console');
          return true;
        },
      });
      return;
    }
    const copy = event.target.closest('[data-copy]');
    if (copy) {
      const draft = ui.state.drafts.find((row) => row.id === copy.dataset.copy);
      navigator.clipboard
        ?.writeText(draft?.draft || '')
        .then(() => toast('Draft copied to clipboard.', 'good'))
        .catch(() => toast('Copy failed — select the text manually.', 'bad'));
    }
  });

  $('#leads-table').addEventListener('click', (event) => {
    const outreach = event.target.closest('[data-outreach]');
    if (outreach) {
      sendCommand(`/outreach ${outreach.dataset.outreach}`);
      setView('console');
      return;
    }
    const verify = event.target.closest('[data-verify]');
    if (verify) {
      api('/api/command', { method: 'POST', body: JSON.stringify({ raw: `/verify ${verify.dataset.verify}` }) })
        .then((result) => {
          ui.state = result.state;
          renderAll();
          toast('Lead marked verified by you.', 'good');
        })
        .catch((error) => toast(error.message, 'bad'));
    }
  });

  $('#settings-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    try {
      const result = await api('/api/settings', {
        method: 'POST',
        body: JSON.stringify({
          provider: $('#set-provider').value,
          ollamaUrl: $('#set-ollama-url').value,
          ollamaModel: $('#set-ollama-model').value,
          geminiModel: $('#set-gemini-model').value,
          maxCallsPerDay: Number($('#set-max-calls').value),
        }),
      });
      ui.state = result.state;
      renderAll();
      toast('Settings saved.', 'good');
    } catch (error) {
      toast(error.message, 'bad');
    }
  });

  $('#btn-test-provider').addEventListener('click', async () => {
    const target = $('#provider-test-result');
    target.textContent = 'Testing…';
    try {
      const result = await api('/api/provider/test', { method: 'POST' });
      ui.state = result.state;
      renderAll();
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
    link.download = `ai-digital-office-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast('Backup downloaded. Store it somewhere safe (Chapter 9).', 'good');
  });

  $('#btn-reset').addEventListener('click', () => {
    openModal({
      title: 'Reset office',
      message: 'This deletes every task, draft, lead and log entry on this machine. Download a backup first. Type RESET to confirm.',
      field: { type: 'textarea', rows: 1, placeholder: 'RESET' },
      confirmLabel: 'Reset everything',
      onConfirm: async (value) => {
        if (value.trim() !== 'RESET') {
          toast('Type RESET to confirm.', 'bad');
          return false;
        }
        try {
          const result = await api('/api/reset', { method: 'POST', body: JSON.stringify({ seed: false }) });
          ui.state = result.state;
          renderAll();
          toast('Office reset. Fresh start.', 'good');
        } catch (error) {
          toast(error.message, 'bad');
        }
        return true;
      },
    });
  });

  $('#modal-close').addEventListener('click', closeModal);
  $('#modal-cancel').addEventListener('click', closeModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target.id === 'modal') closeModal();
  });
  $('#modal-confirm').addEventListener('click', () => {
    if (!modalState) return;
    const values = modalValues();
    const firstKey = Object.keys(values)[0];
    const value = firstKey ? values[firstKey] : '';
    const handled = modalState.onConfirm?.(value, values);
    if (handled !== false) closeModal();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('#modal').hidden) closeModal();
    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      setView('console');
      composer.focus();
    }
  });
}

/* ── Boot ──────────────────────────────────────────────────── */

function renderChips() {
  const chips = ['/task ', '/draft ', '/report', '/lead ', '/status', '/help'];
  $('#chips').innerHTML = chips
    .map((command) => `<button class="chip" type="button" data-command="${escapeHtml(command)}">${escapeHtml(command.trim())}</button>`)
    .join('');
}

async function boot() {
  bind();
  renderChips();
  try {
    await refresh();
  } catch (error) {
    toast(`Could not load office state: ${error.message}`, 'bad');
    return;
  }
  let lastMessageId = (ui.state?.messages || []).at(-1)?.id || '';
  setInterval(async () => {
    if (ui.view !== 'console' || document.hidden) return;
    try {
      const next = await api('/api/state');
      const nextMessageId = (next.messages || []).at(-1)?.id || '';
      const changed = nextMessageId !== lastMessageId;
      lastMessageId = nextMessageId;
      ui.state = next;
      renderStats();
      if (changed) renderChat({ keepScroll: true });
      renderTasks();
      renderDrafts();
    } catch {
      /* offline for a moment — the next tick will retry */
    }
  }, 12_000);
}

boot();
