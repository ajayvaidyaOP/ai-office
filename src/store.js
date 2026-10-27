import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

const DB_FILE = path.join(config.dataDir, 'db.json');

const nowIso = () => new Date().toISOString();

const DEFAULT_SETTINGS = () => ({
  provider: config.ai.provider,
  ollamaUrl: config.ai.ollamaUrl,
  ollamaModel: config.ai.ollamaModel,
  geminiModel: config.ai.geminiModel,
  maxCallsPerDay: config.ai.maxCallsPerDay,
  allowedUserIds: config.telegram.allowedUserIds,
});

const emptyDb = () => ({
  version: 1,
  meta: {
    createdAt: nowIso(),
    seeded: false,
    settings: DEFAULT_SETTINGS(),
    lastReportAt: null,
    lastBackupAt: null,
    lastProviderTest: null,
  },
  counters: { task: 0, draft: 0, lead: 0 },
  tasks: [],
  drafts: [],
  leads: [],
  dailyLog: [],
  messages: [],
  audit: [],
  usage: [],
  dedupe: {},
});

const clone = (value) => JSON.parse(JSON.stringify(value));

class Store {
  constructor() {
    fs.mkdirSync(config.dataDir, { recursive: true });
    this.db = this.#load();
  }

  #load() {
    try {
      if (!fs.existsSync(DB_FILE)) return emptyDb();
      const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      const base = emptyDb();
      return {
        ...base,
        ...parsed,
        meta: { ...base.meta, ...parsed.meta, settings: { ...base.meta.settings, ...parsed.meta?.settings } },
        counters: { ...base.counters, ...parsed.counters },
      };
    } catch (error) {
      const backup = `${DB_FILE}.corrupt-${Date.now()}`;
      try {
        fs.renameSync(DB_FILE, backup);
      } catch {
        /* ignore */
      }
      console.error(`[store] Could not read database, started fresh. Old file: ${backup}`, error.message);
      return emptyDb();
    }
  }

  /** Atomic-ish save: write temp file, then rename over the database. */
  save() {
    const tmp = `${DB_FILE}.tmp`;
    fs.mkdirSync(config.dataDir, { recursive: true });
    fs.writeFileSync(tmp, JSON.stringify(this.db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  }

  get settings() {
    return this.db.meta.settings;
  }

  updateSettings(patch = {}) {
    const allowed = ['provider', 'ollamaUrl', 'ollamaModel', 'geminiModel', 'maxCallsPerDay', 'allowedUserIds'];
    for (const key of allowed) {
      if (patch[key] !== undefined) this.db.meta.settings[key] = patch[key];
    }
    this.save();
    return this.settings;
  }

  nextId(kind) {
    const prefix = { task: 'T', draft: 'D', lead: 'L' }[kind] || 'X';
    this.db.counters[kind] = (this.db.counters[kind] || 0) + 1;
    this.save();
    return `${prefix}-${String(this.db.counters[kind]).padStart(4, '0')}`;
  }

  /** Audit trail: every command, decision and system event (Chapter 9). */
  audit(action, { actor = 'system', ref = '', detail = '', level = 'info' } = {}) {
    const entry = {
      id: `A-${crypto.randomBytes(4).toString('hex')}`,
      ts: nowIso(),
      actor,
      action,
      ref,
      detail,
      level,
    };
    this.db.audit.unshift(entry);
    this.db.audit = this.db.audit.slice(0, 800);
    this.save();
    return entry;
  }

  message(message) {
    const entry = {
      id: `M-${crypto.randomBytes(4).toString('hex')}`,
      ts: nowIso(),
      role: 'bot',
      text: '',
      buttons: [],
      ...message,
    };
    this.db.messages.push(entry);
    this.db.messages = this.db.messages.slice(-300);
    this.save();
    return entry;
  }

  dailyReport() {
    return this.db.dailyLog.find((row) => row.date === todayKey()) || null;
  }

  usageToday(provider) {
    const today = todayKey();
    return this.db.usage
      .filter((row) => row.date === today && (!provider || row.provider === provider))
      .reduce((sum, row) => sum + row.calls, 0);
  }

  recordUsage(provider, calls = 1) {
    const today = todayKey();
    let row = this.db.usage.find((item) => item.date === today && item.provider === provider);
    if (!row) {
      row = { date: today, provider, calls: 0 };
      this.db.usage.push(row);
    }
    row.calls += calls;
    this.db.usage = this.db.usage.slice(-400);
    this.save();
  }

  /** Small in-memory dedupe window so a double-tap does not duplicate rows. */
  isDuplicate(key, windowMs = 20_000) {
    const cutoff = Date.now() - windowMs;
    for (const [storedKey, ts] of Object.entries(this.db.dedupe)) {
      if (ts < cutoff) delete this.db.dedupe[storedKey];
    }
    const seen = Boolean(this.db.dedupe[key]);
    this.db.dedupe[key] = Date.now();
    this.save();
    return seen;
  }

  snapshot() {
    return clone(this.db);
  }

  reset({ seed = false } = {}) {
    this.db = emptyDb();
    this.save();
    if (seed) seedDemoData(this);
  }
}

export const store = new Store();

/** Office-local date key (YYYY-MM-DD) in the configured timezone. */
export function todayKey(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: config.timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

export function officeTime(date = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      timeZone: config.timezone,
      hour: '2-digit',
      minute: '2-digit',
      day: '2-digit',
      month: 'short',
      hour12: false,
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

/**
 * First-boot demo — the worked example from Chapters 4 and 7 of the guide.
 * Everything is clearly labelled as demo data and can be wiped from Setup.
 */
export function seedDemoData(target = store) {
  if (target.db.meta.seeded) return false;
  const created = new Date().toISOString();
  const createdTask = (id, index, task) => ({
    id,
    createdAt: created,
    request: 'Plan a beginner-friendly Instagram Reel about free AI tools for small businesses',
    task,
    priority: 'High',
    owner: index === 1 ? 'Research Agent' : 'Content Agent',
    deadline: '',
    status: 'Pending',
    notes: index === 1 ? 'Verify official websites and pricing' : 'Include hook, 3 tools, and call to action',
    source: 'demo',
  });

  target.db.tasks.push(
    createdTask('T-0001', 1, 'Research 5 free AI tools useful for small businesses'),
    createdTask('T-0002', 2, 'Write a 30-second beginner-friendly Reel script'),
  );
  target.db.counters.task = 2;

  target.db.drafts.push({
    id: 'D-0001',
    taskId: 'T-0001',
    createdAt: created,
    request: 'Write a friendly Instagram caption for that Reel.',
    platform: 'Instagram',
    audience: 'small business owners',
    tone: 'friendly',
    draft:
      'Hook: Most small businesses do not need another tool — they need one that saves a repeatable hour every week.\n\nBody: Pick one free AI tool per job. Draft faster, tidy your notes, and keep a human check on anything public. Start with the task you repeat most, test it for seven days, then decide if it earns a paid plan.\n\nCall to action: Which task eats your week? Reply with one and I will cover it next.',
    status: 'Awaiting approval',
    reviewer: '',
    decisionAt: null,
    feedback: '',
    provider: 'offline',
    qa: {
      decision: 'approve',
      issues: [],
      suggested_revision: '',
      checkedAt: created,
    },
    history: [],
    source: 'demo',
  });
  target.db.counters.draft = 1;

  target.db.leads.push({
    id: 'L-0001',
    createdAt: created,
    businessName: 'Example Studio',
    website: 'https://example.com',
    niche: 'Design agency',
    sourceUrl: 'https://example.com',
    fitReason: 'Public site shows an active Instagram link but no visible content plan (demo row)',
    contactStatus: 'Not contacted',
    reviewStatus: 'Needs human verification',
    nextAction: 'Open source URL and confirm details manually',
    source: 'demo',
  });
  target.db.counters.lead = 1;

  target.db.meta.seeded = true;
  target.save();
  return true;
}
