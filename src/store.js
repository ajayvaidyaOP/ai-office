import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config, BRAND } from './config.js';

const DB_FILE = path.join(config.dataDir, 'db.json');

const nowIso = () => new Date().toISOString();

const DEFAULT_SETTINGS = () => ({
  provider: config.ai.provider,
  ollamaUrl: config.ai.ollamaUrl,
  ollamaModel: config.ai.ollamaModel,
  geminiModel: config.ai.geminiModel,
  maxCallsPerDay: config.ai.maxCallsPerDay,
  allowedUserIds: config.telegram.allowedUserIds,
  companyName: 'AI Invincible Office',
  currency: 'INR',
  monthlyTarget: 150000,
  ownerName: 'Founder',
});

const emptyDb = () => ({
  version: 2,
  meta: {
    brand: BRAND.name,
    createdAt: nowIso(),
    seeded: false,
    settings: DEFAULT_SETTINGS(),
    lastReportAt: null,
    lastBackupAt: null,
    lastProviderTest: null,
    lastBriefAt: null,
  },
  counters: { task: 0, draft: 0, lead: 0, client: 0, run: 0 },
  tasks: [],
  drafts: [],
  leads: [],
  clients: [],
  dailyLog: [],
  messages: [],
  audit: [],
  usage: [],
  runs: [],
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
        meta: {
          ...base.meta,
          ...parsed.meta,
          brand: BRAND.name,
          settings: { ...base.meta.settings, ...parsed.meta?.settings },
        },
        counters: { ...base.counters, ...parsed.counters },
        clients: parsed.clients || [],
        runs: parsed.runs || [],
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
    const allowed = [
      'provider',
      'ollamaUrl',
      'ollamaModel',
      'geminiModel',
      'maxCallsPerDay',
      'allowedUserIds',
      'companyName',
      'currency',
      'monthlyTarget',
      'ownerName',
    ];
    for (const key of allowed) {
      if (patch[key] === undefined) continue;
      if (key === 'maxCallsPerDay' || key === 'monthlyTarget') {
        const value = Number(patch[key]);
        if (Number.isFinite(value) && value >= 0) this.db.meta.settings[key] = Math.min(value, 100_000_000);
        continue;
      }
      this.db.meta.settings[key] = String(patch[key]).slice(0, 120);
    }
    this.save();
    return this.settings;
  }

  nextId(kind) {
    const prefix = { task: 'T', draft: 'D', lead: 'L', client: 'C', run: 'R' }[kind] || 'X';
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

  /** One row per agent invocation — powers the Agents and Reports pages. */
  recordRun({ agent, ok = true, provider = 'offline', ms = 0, ref = '', detail = '' }) {
    const entry = {
      id: `R-${crypto.randomBytes(3).toString('hex')}`,
      ts: nowIso(),
      agent,
      ok: Boolean(ok),
      provider,
      ms: Math.round(ms),
      ref,
      detail: String(detail || '').slice(0, 200),
    };
    this.db.runs.unshift(entry);
    this.db.runs = this.db.runs.slice(0, 400);
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

const daysFromNow = (days, hour = 10) => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

const dateOnly = (days) => daysFromNow(days).slice(0, 10);

/**
 * First-boot demo — a lived-in office so every screen has something to show.
 * Fully wiped by Setup → Reset. All rows carry source: "demo".
 */
export function seedDemoData(target = store) {
  if (target.db.meta.seeded) return false;

  const asDraft = (id, taskId, title, platform, status, overrides = {}) => ({
    id,
    taskId,
    createdAt: new Date(Date.now() - (Number(String(id).slice(2)) + 1) * 6 * 3_600_000).toISOString(),
    request: overrides.request || title,
    title,
    platform,
    audience: overrides.audience || 'small business owners',
    tone: overrides.tone || 'friendly',
    draft: overrides.draft || '',
    status,
    reviewer: overrides.reviewer || '',
    decisionAt: overrides.decisionAt || null,
    feedback: overrides.feedback || '',
    version: overrides.version || 1,
    provider: 'offline',
    qa: overrides.qa || { decision: 'approve', issues: [], suggested_revision: '' },
    history: [],
    source: 'demo',
  });

  target.db.tasks.push(
    {
      id: 'T-0001',
      createdAt: daysFromNow(-4),
      request: 'Plan a beginner-friendly Instagram Reel about free AI tools for small businesses',
      task: 'Research 5 free AI tools useful for small businesses',
      priority: 'High',
      owner: 'Research Agent',
      deadline: dateOnly(0),
      status: 'Pending',
      notes: 'Verify official websites and pricing before using any claim',
      provider: 'offline',
      source: 'demo',
    },
    {
      id: 'T-0002',
      createdAt: daysFromNow(-4),
      request: 'Plan a beginner-friendly Instagram Reel about free AI tools for small businesses',
      task: 'Write the 30-second Reel script',
      priority: 'High',
      owner: 'Content Agent',
      deadline: dateOnly(1),
      status: 'In Progress',
      notes: 'Hook, 3 tools, call to action',
      provider: 'offline',
      source: 'demo',
    },
    {
      id: 'T-0003',
      createdAt: daysFromNow(-3),
      request: 'Send the proposal to GreenLeaf Café',
      task: 'Send proposal to GreenLeaf Café',
      priority: 'High',
      owner: 'You',
      deadline: dateOnly(-1),
      status: 'Pending',
      notes: 'Awaiting your final price check — nothing is sent automatically',
      provider: 'offline',
      source: 'demo',
    },
    {
      id: 'T-0004',
      createdAt: daysFromNow(-2),
      request: 'Follow up with Pixel Works after the demo call',
      task: 'Follow up with Pixel Works',
      priority: 'Medium',
      owner: 'You',
      deadline: dateOnly(0),
      status: 'Pending',
      notes: 'They asked for a smaller starting scope',
      provider: 'offline',
      source: 'demo',
    },
    {
      id: 'T-0005',
      createdAt: daysFromNow(-2),
      request: 'Update the pricing sheet for October',
      task: 'Update the pricing sheet',
      priority: 'Low',
      owner: 'You',
      deadline: dateOnly(5),
      status: 'Pending',
      notes: 'Check the current tool costs before publishing',
      provider: 'offline',
      source: 'demo',
    },
    {
      id: 'T-0006',
      createdAt: daysFromNow(-6),
      request: 'Prepare the September invoice',
      task: 'Prepare September invoice',
      priority: 'Medium',
      owner: 'You',
      deadline: dateOnly(-3),
      status: 'Done',
      notes: 'Sent manually on time',
      provider: 'offline',
      source: 'demo',
    },
  );
  target.db.counters.task = 6;

  target.db.drafts.push(
    asDraft(
      'D-0001',
      'T-0002',
      'Reel caption — free AI tools for small businesses',
      'Instagram',
      'Awaiting approval',
      {
        version: 2,
        request: 'Write a friendly Instagram caption for the AI tools Reel',
        draft:
          'Hook: Most small businesses do not need another tool — they need one that saves a repeatable hour every week.\n\nBody: Pick one free AI tool per job. Draft faster, tidy your notes, and keep a human check on anything public. Start with the task you repeat most, test it for seven days, then decide if it earns a paid plan.\n\nCall to action: Save this, then reply with the one task that eats your week — I will cover it next.',
        qa: {
          decision: 'approve',
          issues: [],
          suggested_revision: '',
          checkedAt: daysFromNow(-1),
        },
      },
    ),
    asDraft('D-0002', 'T-0004', 'LinkedIn post — the quiet follow-up', 'LinkedIn', 'Approved', {
      request: 'Write a LinkedIn post about client follow-ups',
      draft:
        'Hook: The follow-up is not a reminder. It is the service.\n\nBody: A good follow-up adds one useful thing: a summary, a next step, or a decision. If it only asks "any update?", it is noise.\n\nCall to action: What is the most useful follow-up you have received?',
      reviewer: 'owner',
      decisionAt: daysFromNow(-1),
      qa: { decision: 'approve', issues: [], suggested_revision: '' },
    }),
    asDraft('D-0003', 'T-0001', 'Newsletter — five tools, one hour', 'Email', 'Revision requested', {
      request: 'Draft the October newsletter about free AI tools',
      draft:
        'Subject: Five free AI tools that give you back an hour\n\nBody: This month: a short list of free tools that solve one boring task each, plus the checklist I use before trusting any AI draft.\n\nCall to action: Reply with the task you want to remove from your week.',
      feedback: 'Shorter, and add one real example from a client project.',
      reviewer: 'owner',
      decisionAt: daysFromNow(-2),
      qa: { decision: 'revise', issues: ['Needs one concrete example before publishing.'], suggested_revision: '' },
    }),
    asDraft('D-0004', 'T-0002', 'Carousel — 3 signs your content plan is stuck', 'Instagram', 'Awaiting approval', {
      request: 'Create an Instagram carousel about stuck content plans',
      draft:
        'Slide 1: Your content plan is not stuck. Your decision list is.\n\nSlide 2: Three signs: the same idea repeats, nothing gets approved, and every post starts from zero.\n\nSlide 3: Fix: one idea, one owner, one approval window per week.\n\nSlide 4: Save this and try one approval window this week.',
      qa: {
        decision: 'revise',
        issues: ['No clear call to action on the final slide.', 'Slide count is high for a 30-second read.'],
        suggested_revision: '',
      },
    }),
  );
  target.db.counters.draft = 4;

  const lead = (id, businessName, niche, stage, score, extra = {}) => ({
    id,
    createdAt: daysFromNow(-(Number(id.slice(2)) + 1)),
    businessName,
    website: extra.website || '',
    niche,
    location: extra.location || 'Pune',
    sourceUrl: extra.sourceUrl || 'https://example.com/directory',
    fitReason: extra.fitReason || 'Active on social media, no visible content plan',
    contactStatus: stage === 'New' ? 'Not contacted' : stage === 'Won' ? 'Client' : 'Contacted',
    reviewStatus: extra.reviewStatus || 'Needs human verification',
    stage,
    score,
    owner: 'You',
    lastTouchAt: stage === 'New' ? null : daysFromNow(-2),
    nextFollowUp: extra.nextFollowUp || null,
    notes: extra.notes || '',
    provider: 'offline',
    source: 'demo',
  });

  target.db.leads.push(
    lead('L-0001', 'Example Studio', 'Design agency', 'Verified', 72, {
      website: 'https://example.com',
      sourceUrl: 'https://example.com',
      reviewStatus: 'Verified by human',
      fitReason: 'Public site shows an active Instagram link but no visible content plan',
      nextFollowUp: dateOnly(1),
      notes: 'Good fit for the starter content plan.',
    }),
    lead('L-0002', 'Pixel Works', 'Product studio', 'Won', 88, {
      website: 'https://example.org',
      reviewStatus: 'Verified by human',
      fitReason: 'Asked for a smaller starting scope after the demo call',
      nextFollowUp: dateOnly(2),
      notes: 'Converted to client C-0002.',
    }),
    lead('L-0003', 'GreenLeaf Café', 'Café / F&B', 'Contacted', 65, {
      fitReason: 'Posts daily specials but no weekly plan or offer structure',
      nextFollowUp: dateOnly(0),
      notes: 'Proposal drafted, waiting on your price check.',
    }),
    lead('L-0004', 'Skyline Realty', 'Real estate', 'New', 48, {
      fitReason: 'Listed in a public business directory; unclear if they handle content internally',
    }),
    lead('L-0005', 'The Craft Room', 'D2C handmade', 'Replied', 81, {
      fitReason: 'Replied to the first message and asked for examples',
      reviewStatus: 'Verified by human',
      nextFollowUp: dateOnly(3),
      notes: 'Send two case-study examples, no pricing yet.',
    }),
  );
  target.db.counters.lead = 5;

  const client = (id, company, stage, value, extra = {}) => ({
    id,
    createdAt: daysFromNow(-(Number(id.slice(2)) + 8)),
    company,
    contact: extra.contact || 'Owner',
    email: extra.email || '',
    phone: extra.phone || '',
    niche: extra.niche || 'Small business',
    stage,
    value,
    currency: 'INR',
    leadId: extra.leadId || '',
    sourceUrl: extra.sourceUrl || '',
    owner: 'You',
    lastTouchAt: daysFromNow(-(extra.touchedDaysAgo ?? 2)),
    nextFollowUp: extra.nextFollowUp || null,
    notes: extra.notes || '',
    source: 'demo',
  });

  target.db.clients.push(
    client('C-0001', 'Nimbus Interiors', 'Won', 85000, {
      contact: 'Riya Kulkarni',
      niche: 'Interior design',
      touchedDaysAgo: 3,
      notes: 'Monthly content retainer. Invoice on the 1st.',
    }),
    client('C-0002', 'Pixel Works', 'Negotiation', 45000, {
      contact: 'Aman',
      niche: 'Product studio',
      leadId: 'L-0002',
      nextFollowUp: dateOnly(2),
      notes: 'Wants a smaller starting scope. Send two options.',
    }),
    client('C-0003', 'GreenLeaf Café', 'Proposal sent', 30000, {
      contact: 'Meera',
      niche: 'Café / F&B',
      nextFollowUp: dateOnly(0),
      notes: 'Proposal drafted; price check pending.',
    }),
    client('C-0004', 'Skyline Realty', 'Lost', 20000, {
      contact: 'Front desk',
      niche: 'Real estate',
      nextFollowUp: null,
      notes: 'Chose an in-house team. Revisit in six months.',
    }),
  );
  target.db.counters.client = 4;

  target.db.dailyLog.push(
    {
      date: dateOnly(-1),
      ts: daysFromNow(-1),
      completed: 1,
      pending: 4,
      blocked: 0,
      draftsAwaitingApproval: 2,
      notes:
        '📋 DAILY OFFICE REPORT\n\n✅ Completed: 1 — T-0006 September invoice\n🕓 Pending: 4\n✋ Drafts awaiting approval: 2\n🎯 Priorities: T-0003 proposal, T-0004 follow-up, T-0001 research\n\nReport uses stored task data only.',
      provider: 'offline',
    },
  );
  target.db.meta.lastReportAt = daysFromNow(-1);

  const run = (agent, provider, ms, hoursAgo, ref = '', ok = true) => ({
    id: `R-${crypto.randomBytes(3).toString('hex')}`,
    ts: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
    agent,
    ok,
    provider,
    ms,
    ref,
    detail: '',
  });

  target.db.runs.push(
    run('manager', 'offline', 120, 1, 'T-0001'),
    run('content', 'offline', 340, 2, 'D-0001'),
    run('quality', 'offline', 90, 2, 'D-0001'),
    run('brief', 'offline', 60, 4),
    run('content', 'offline', 410, 20, 'D-0003'),
    run('leadResearch', 'offline', 150, 26, 'L-0003'),
    run('report', 'offline', 80, 28),
    run('manager', 'offline', 130, 32, 'T-0003'),
    run('outreach', 'offline', 110, 44, 'L-0005'),
    run('quality', 'offline', 140, 50, 'D-0004', false),
  );

  const audit = (action, hoursAgo, ref = '', detail = '', level = 'info') =>
    target.db.audit.push({
      id: `A-${crypto.randomBytes(4).toString('hex')}`,
      ts: new Date(Date.now() - hoursAgo * 3_600_000).toISOString(),
      actor: 'owner',
      action,
      ref,
      detail,
      level,
    });

  audit('task.created', 96, 'T-0001,T-0002', 'Plan a beginner-friendly Instagram Reel');
  audit('draft.created', 50, 'D-0001', 'Instagram v1 — awaiting approval');
  audit('draft.revision_requested', 26, 'D-0001', 'Make the hook more specific');
  audit('draft.created', 8, 'D-0001', 'Instagram v2 — awaiting approval');
  audit('draft.approved', 20, 'D-0002', 'Looks good');
  audit('draft.revision_requested', 46, 'D-0003', 'Shorter, add one real example');
  audit('draft.created', 5, 'D-0004', 'Carousel — QA flagged missing CTA');
  audit('lead.created', 48, 'L-0001,L-0002,L-0003', 'Three rows from a public directory');
  audit('lead.verified', 30, 'L-0001', 'Reviewed against source');
  audit('lead.promoted', 24, 'C-0002', 'Pixel Works moved to clients');
  audit('client.updated', 12, 'C-0003', 'Proposal sent — follow up today');
  audit('report.generated', 28, '', 'pending 4, awaiting 2');

  target.db.meta.seeded = true;
  target.save();
  return true;
}
