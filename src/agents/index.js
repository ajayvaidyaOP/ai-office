import { PROMPTS, fillPrompt } from './prompts.js';
import { ask, extractJson, probeOllama } from './provider.js';
import { store } from '../store.js';
import {
  detectPlatform,
  detectTone,
  offlineBrief,
  offlineContent,
  offlineFindPlan,
  offlineFollowup,
  offlineManager,
  offlineOutreach,
  offlineProposal,
  offlineQuality,
  offlineReport,
  offlineResearch,
  scoreLead,
  summariseRequestSafely,
} from './offline.js';

/** Record every agent invocation for the Agents + Reports pages. */
const track = (agent, startedAt, provider, ok = true, ref = '', detail = '') =>
  store.recordRun({ agent, ok, provider, ms: Date.now() - startedAt, ref, detail });

const PRIORITIES = ['High', 'Medium', 'Low'];
const OWNERS = ['You', 'Content Agent', 'Research Agent'];

/**
 * Validation rule from Chapter 4:
 * "Before writing to Sheets, check that the AI response is valid JSON and that
 *  every task has a non-empty task field. If validation fails, send the raw
 *  response to Telegram and mark the request as needing review."
 */
export function validateTasks(payload) {
  const issues = [];
  const tasks = Array.isArray(payload) ? payload : payload?.tasks;
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return { ok: false, issues: ['No tasks array in the AI response'], tasks: [] };
  }

  const cleaned = [];
  tasks.slice(0, 5).forEach((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      issues.push(`Task ${index + 1} is not an object`);
      return;
    }
    const task = String(raw.task || '').trim();
    if (!task) {
      issues.push(`Task ${index + 1} has an empty task field`);
      return;
    }
    const priority = PRIORITIES.includes(raw.priority) ? raw.priority : 'Medium';
    const owner = OWNERS.includes(raw.owner) ? raw.owner : 'You';
    const deadlineRaw = String(raw.deadline || '').trim();
    const deadline = /^\d{4}-\d{2}-\d{2}$/.test(deadlineRaw) && !Number.isNaN(Date.parse(deadlineRaw)) ? deadlineRaw : '';
    if (deadlineRaw && !deadline) issues.push(`Task ${index + 1} had an invalid deadline, cleared`);
    cleaned.push({
      task: task.slice(0, 300),
      priority,
      owner,
      deadline,
      status: 'Pending',
      notes: String(raw.notes || '').slice(0, 300),
    });
  });

  return { ok: cleaned.length > 0, issues, tasks: cleaned };
}

/**
 * AI Manager — Chapter 4.
 * Tries the model, validates the JSON, and falls back to the offline planner.
 */
export async function runManager(request, context = {}) {
  const startedAt = Date.now();
  const platform = detectPlatform(request);
  try {
    const result = await ask({
      prompt: `Request from the human:\n${request}\n\nPlatform hint: ${platform}. Today is ${new Date().toISOString().slice(0, 10)}.`,
      system: PROMPTS.manager,
      expectJson: true,
    });
    const validation = validateTasks(result.text);
    if (!validation.ok) {
      return {
        ...offlineManager(request, { platform }),
        provider: `${result.provider} (invalid JSON → offline fallback)`,
        validationIssues: validation.issues,
        needsReview: true,
      };
    }
    track('manager', startedAt, result.provider, true, '', `${validation.tasks.length} tasks`);
    return {
      tasks: validation.tasks,
      provider: `${result.provider}/${result.model}`,
      validationIssues: validation.issues,
      needsReview: validation.issues.length > 0,
    };
  } catch (error) {
    track('manager', startedAt, 'offline', false, '', error.message);
    return {
      ...offlineManager(request, { platform }),
      provider: 'offline',
      providerError: error.message,
      needsReview: false,
    };
  }
}

/** Content Creation Agent — Chapter 5. */
export async function runContent({ request, platform, audience, tone, research }) {
  const startedAt = Date.now();
  const resolvedPlatform = platform || detectPlatform(request);
  const resolvedTone = tone || detectTone(request);
  try {
    const result = await ask({
      prompt: [
        `Task: ${request}`,
        `Platform: ${resolvedPlatform}`,
        `Audience: ${audience || 'not specified — infer conservatively'}`,
        `Tone: ${resolvedTone}`,
        research ? `Task context from your office sheet (do not treat as verified facts):\n${research}` : 'Research notes: none supplied, so do not state statistics or prices.',
        'Write one draft only.',
      ].join('\n'),
      system: PROMPTS.content,
    });
    track('content', startedAt, result.provider, true, '', resolvedPlatform);
    return {
      draft: result.text.trim(),
      platform: resolvedPlatform,
      tone: resolvedTone,
      audience: audience || '',
      provider: `${result.provider}/${result.model}`,
    };
  } catch (error) {
    track('content', startedAt, 'offline', false, '', error.message);
    return {
      draft: offlineContent({ request, platform: resolvedPlatform, audience, tone: resolvedTone, research }),
      platform: resolvedPlatform,
      tone: resolvedTone,
      audience: audience || '',
      provider: 'offline',
      providerError: error.message,
    };
  }
}

/** Quality Checker — Chapter 5 (JSON contract). */
export async function runQuality({ draft, platform, audience }) {
  const startedAt = Date.now();
  try {
    const result = await ask({
      prompt: [
        `Platform: ${platform || 'General'}`,
        `Audience: ${audience || 'general'}`,
        'Draft to review:',
        draft,
      ].join('\n'),
      system: PROMPTS.quality,
      expectJson: true,
    });
    const payload = result.text;
    const decision = ['approve', 'revise', 'reject'].includes(payload.decision) ? payload.decision : 'revise';
    track('quality', startedAt, result.provider, true, '', decision);
    return {
      decision,
      issues: Array.isArray(payload.issues) ? payload.issues.map(String).slice(0, 10) : [],
      suggested_revision: String(payload.suggested_revision || ''),
      checkedAt: new Date().toISOString(),
      provider: `${result.provider}/${result.model}`,
    };
  } catch (error) {
    track('quality', startedAt, 'offline', false, '', error.message);
    return {
      ...offlineQuality(draft, { platform }),
      checkedAt: new Date().toISOString(),
      providerError: error.message,
    };
  }
}

/** Lead Research Agent — Chapter 5. Model never invents contacts; every row needs verification. */
export async function runResearch({ niche, location, sourceUrl, notes = '' }) {
  const startedAt = Date.now();
  if (!sourceUrl) {
    return {
      ok: false,
      reason: 'A public source URL is required. The agent will not invent businesses or contact details.',
      leads: [],
      provider: 'offline',
    };
  }
  try {
    const result = await ask({
      prompt: [
        `Niche: ${niche || 'not specified'}`,
        `Location: ${location || 'not specified'}`,
        `Public source URL: ${sourceUrl}`,
        notes ? `Human notes from that source:\n${notes}` : 'Human notes: none supplied. Return an empty leads array instead of guessing.',
      ].join('\n'),
      system: PROMPTS.research,
      expectJson: true,
    });
    const rows = Array.isArray(result.text?.leads) ? result.text.leads : [];
    const leads = sanitiseLeads(rows, sourceUrl);
    track('leadResearch', startedAt, result.provider, leads.length > 0, '', `${leads.length} rows`);
    return { ok: leads.length > 0, leads, provider: `${result.provider}/${result.model}` };
  } catch (error) {
    const leads = offlineResearch({ niche, location, sourceUrl, notes });
    track('leadResearch', startedAt, 'offline', false, '', error.message);
    return { ok: leads.length > 0, leads, provider: 'offline', providerError: error.message };
  }
}

function sanitiseLeads(rows, fallbackSource) {
  return rows
    .slice(0, 10)
    .map((row) => ({
      businessName: String(row.business_name || row.businessName || '').trim().slice(0, 120),
      website: String(row.website || '').trim().slice(0, 200),
      niche: String(row.niche || '').trim().slice(0, 80),
      sourceUrl: String(row.source_url || row.sourceUrl || fallbackSource).trim().slice(0, 300),
      fitReason: String(row.fit_reason || row.fitReason || '').trim().slice(0, 300),
    }))
    .filter((row) => row.businessName && /^https?:\/\//i.test(row.sourceUrl))
    .map((row) => ({ ...row, reviewStatus: 'Needs human verification', contactStatus: 'Not contacted' }));
}

/** Client Follow-up Agent — Chapter 5. */
export async function runFollowup({ clientName, context, priorInteraction }) {
  try {
    const result = await ask({
      prompt: [
        `Client: ${clientName || 'not provided'}`,
        `Context: ${context || 'not provided'}`,
        `Prior interaction: ${priorInteraction || 'not provided'}`,
        'Only use these facts.',
      ].join('\n'),
      system: PROMPTS.followup,
    });
    return { draft: result.text.trim(), provider: `${result.provider}/${result.model}` };
  } catch (error) {
    return { draft: offlineFollowup({ clientName, context, priorInteraction }), provider: 'offline', providerError: error.message };
  }
}

/** Outreach Drafting Agent — Chapter 8, under-90-words rule enforced in code too. */
export async function runOutreach({ businessName, website, fitReason }) {
  const values = { business_name: businessName || '', website: website || '', fit_reason: fitReason || '' };
  let text;
  let provider = 'offline';
  try {
    const result = await ask({ prompt: 'Write the outreach message now.', system: fillPrompt(PROMPTS.outreach, values) });
    text = result.text.trim();
    provider = `${result.provider}/${result.model}`;
  } catch (error) {
    text = offlineOutreach({ businessName, website, fitReason });
  }
  const words = text.split(/\s+/).filter(Boolean);
  return {
    draft: words.length > 90 ? `${words.slice(0, 90).join(' ')}…` : text,
    wordCount: Math.min(words.length, 90),
    overLimit: words.length > 90,
    provider,
    status: 'Needs human verification', // never auto-sent
  };
}

/** Daily Reporting Agent — Chapter 5 / Chapter 10. */
export async function runReport(data) {
  try {
    const result = await ask({
      prompt: `Task data (JSON):\n${JSON.stringify(data, null, 2)}`,
      system: PROMPTS.report,
    });
    return { text: result.text.trim(), provider: `${result.provider}/${result.model}` };
  } catch (error) {
    return { text: offlineReport(data), provider: 'offline', providerError: error.message };
  }
}

/** Chief of Staff morning brief — Chapter 10, upgraded. */
export async function runBrief(context) {
  const startedAt = Date.now();
  try {
    const result = await ask({
      prompt: `Office data (JSON):\n${JSON.stringify(context, null, 2)}`,
      system: PROMPTS.brief,
    });
    track('brief', startedAt, result.provider, true);
    return { text: result.text.trim(), provider: `${result.provider}/${result.model}` };
  } catch (error) {
    track('brief', startedAt, 'offline', false, '', error.message);
    return { text: offlineBrief(context), provider: 'offline', providerError: error.message };
  }
}

/** Client Finder — research plan, never invented businesses. */
export async function runFindPlan({ niche, location, notes = '' }) {
  const startedAt = Date.now();
  const fallback = offlineFindPlan({ niche, location, notes });
  try {
    const result = await ask({
      prompt: [
        `Niche: ${niche || 'not specified'}`,
        `Location: ${location || 'not specified'}`,
        notes ? `What the human already knows:\n${notes}` : 'No extra notes.',
        'Produce the research plan only. Do not list businesses you cannot verify.',
      ].join('\n'),
      system: PROMPTS.finderPlan,
      expectJson: true,
    });
    const plan = normalisePlan(result.text, fallback);
    track('finder', startedAt, result.provider, true, '', `${plan.queries.length} queries`);
    return { ...plan, provider: `${result.provider}/${result.model}` };
  } catch (error) {
    track('finder', startedAt, 'offline', false, '', error.message);
    return { ...fallback, provider: 'offline', providerError: error.message };
  }
}

function normalisePlan(payload, fallback) {
  const list = (value, max = 10) =>
    Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean).slice(0, max) : [];
  const plan = {
    summary: String(payload?.summary || fallback.summary).slice(0, 240),
    queries: list(payload?.queries).length ? list(payload.queries) : fallback.queries,
    directories: list(payload?.directories, 8).length ? list(payload.directories, 8) : fallback.directories,
    checklist: list(payload?.checklist, 8).length ? list(payload.checklist, 8) : fallback.checklist,
    red_flags: list(payload?.red_flags, 8).length ? list(payload.red_flags, 8) : fallback.red_flags,
  };
  return plan;
}

/** Proposal Agent — drafts only, price stays human-controlled. */
export async function runProposal({ company, contact, niche, value, notes }) {
  const startedAt = Date.now();
  try {
    const result = await ask({
      prompt: [
        `Client: ${company || 'not provided'}`,
        `Contact: ${contact || 'not provided'}`,
        `Niche: ${niche || 'not provided'}`,
        `Indicative value: ${Number(value) > 0 ? `INR ${value}` : 'not decided'}`,
        notes ? `Context notes: ${notes}` : 'No extra notes.',
      ].join('\n'),
      system: PROMPTS.proposal,
    });
    track('proposal', startedAt, result.provider, true, '', company);
    return { text: result.text.trim(), provider: `${result.provider}/${result.model}` };
  } catch (error) {
    track('proposal', startedAt, 'offline', false, '', error.message);
    return { text: offlineProposal({ company, contact, niche, value, notes }), provider: 'offline', providerError: error.message };
  }
}

export async function testProvider() {
  const probe = await probeOllama({ force: true });
  if (probe.ok) {
    try {
      const result = await ask({
        prompt: 'Reply with exactly: OFFICE ONLINE',
        system: 'You are a connection test. Reply with the exact words requested and nothing else.',
      });
      return { ok: true, provider: result.provider, model: result.model, reply: result.text.slice(0, 120) };
    } catch (error) {
      return { ok: false, provider: 'ollama', error: error.message };
    }
  }
  return { ok: false, provider: 'none', error: 'No model reachable — running in offline rules mode', models: probe.models };
}

export { detectPlatform, detectTone, summariseRequestSafely, scoreLead };
