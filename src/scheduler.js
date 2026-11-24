/* ═══════════════════════════════════════════════════════════════
   SCHEDULER — the office remembering to show up.

   One cheap check a minute. When the local clock (Asia/Kolkata)
   reaches the configured hour, it runs the morning routine ONCE
   per day:

     1. generate the brief (stored, so the dashboard shows it)
     2. build the follow-up queue
     3. post both to YOUR Telegram chat, if a bot token is set

   It never contacts a client. It only tells you what needs doing.
   ═══════════════════════════════════════════════════════════════ */

import { config } from './config.js';
import { store, todayKey } from './store.js';
import { createBrief, followUpQueue } from './office.js';
import { notifyOwner } from './channels/telegram.js';

let timer = null;
let lastRunKey = '';

const state = {
  enabled: Boolean(config.scheduler.enabled),
  hour: config.scheduler.hour,
  minute: config.scheduler.minute,
  lastRunAt: null,
  lastRunKey: '',
  nextRunHint: '',
  runs: 0,
};

export const schedulerStatus = () => ({
  ...state,
  enabled: state.enabled,
  hour: state.hour,
  minute: state.minute,
});

/** Local hour/minute in the office timezone, without any dependency. */
function localClock(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: config.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value || 0);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value || 0);
  const dayKey = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone }).format(date);
  return { hour, minute, dayKey };
}

/** The routine itself — exported so a test or a button can run it on demand. */
export async function runMorningRoutine({ reason = 'scheduled' } = {}) {
  const startedAt = new Date().toISOString();
  const notes = [];

  let brief = null;
  try {
    brief = await createBrief('system');
    notes.push('brief generated');
  } catch (error) {
    notes.push(`brief failed: ${error.message}`);
  }

  const queue = followUpQueue();
  notes.push(`${queue.length} follow-up(s) due`);

  const lines = [
    '☀️ OFFICE MORNING ROUTINE',
    '',
    brief?.brief ? brief.brief.split('\n').slice(0, 14).join('\n') : 'Brief not available.',
    '',
  ];

  if (queue.length) {
    lines.push(`⏰ ${queue.length} follow-up(s) due — open /followups for the exact text:`);
    queue.slice(0, 5).forEach((row) => lines.push(`   • Day ${row.step}: ${row.name} (${row.channel})`));
  } else {
    lines.push('⏰ No follow-ups due today.');
  }
  lines.push('', 'Nothing was sent to any client. Every message is yours to copy and send.');

  const message = lines.join('\n');
  let notified = false;
  try {
    const result = await notifyOwner(message);
    notified = Boolean(result?.ok);
    if (!result?.ok) notes.push(`telegram: ${result?.reason || 'not configured'}`);
  } catch (error) {
    notes.push(`telegram error: ${error.message}`);
  }

  store.audit('scheduler.morning_routine', {
    actor: 'system',
    detail: `${reason} · ${notes.join(' · ')}${notified ? ' · told owner on Telegram' : ''}`,
  });

  state.lastRunAt = startedAt;
  state.runs += 1;
  return { ok: true, at: startedAt, reason, brief: brief?.brief || '', followUps: queue.length, notified, notes };
}

/** Start the minute ticker. Safe to call twice. */
export function startScheduler({ onTick } = {}) {
  if (!config.scheduler.enabled) {
    state.enabled = false;
    return { started: false, reason: 'SCHEDULER=off' };
  }
  if (timer) return { started: false, reason: 'already running' };

  state.enabled = true;
  timer = setInterval(() => {
    try {
      const { hour, minute, dayKey } = localClock();
      state.nextRunHint = `${String(config.scheduler.hour).padStart(2, '0')}:${String(config.scheduler.minute).padStart(2, '0')} ${config.timezone}`;
      const due = hour === config.scheduler.hour && minute === config.scheduler.minute;
      if (!due) return;
      const runKey = `${dayKey}-${config.scheduler.hour}:${config.scheduler.minute}`;
      if (lastRunKey === runKey) return;
      lastRunKey = runKey;
      state.lastRunKey = runKey;
      runMorningRoutine({ reason: 'scheduled' })
        .then((result) => onTick?.(result))
        .catch((error) => console.error('[scheduler]', error.message));
    } catch (error) {
      console.error('[scheduler]', error.message);
    }
  }, 60_000);

  // Do not hold the process open just for the ticker.
  timer.unref?.();

  store.audit('scheduler.started', {
    detail: `daily ${config.scheduler.hour}:${String(config.scheduler.minute).padStart(2, '0')} ${config.timezone}`,
  });
  return { started: true, hour: config.scheduler.hour, minute: config.scheduler.minute };
}

export function stopScheduler() {
  if (timer) clearInterval(timer);
  timer = null;
  return { stopped: true };
}
