/**
 * Offline agent engine.
 *
 * This is the deterministic fallback that lets the whole office run with zero
 * API keys, zero downloads and zero internet — useful for demos, tests and for
 * the "one reliable workflow first" goal from Chapter 2 of the guide.
 *
 * The rules here are deliberately conservative: no invented deadlines, no
 * invented contact details, no external actions, everything marked for human
 * review.
 */

const PRIORITY_ORDER = ['High', 'Medium', 'Low'];
const isPriority = (value) => PRIORITY_ORDER.includes(value);

const TASK_ID = /\bT-\d{4}\b/gi;
const DRAFT_ID = /\bD-\d{4}\b/gi;
const LEAD_ID = /\bL-\d{4}\b/gi;

export function detectPlatform(text = '') {
  const value = text.toLowerCase();
  if (/(instagram|reel|ig\b|story)/.test(value)) return 'Instagram';
  if (/(linkedin)/.test(value)) return 'LinkedIn';
  if (/(youtube|shorts|video)/.test(value)) return 'YouTube';
  if (/(twitter|\bx\b|thread)/.test(value)) return 'X (Twitter)';
  if (/(facebook|fb\b)/.test(value)) return 'Facebook';
  if (/(whatsapp)/.test(value)) return 'WhatsApp';
  if (/(email|newsletter)/.test(value)) return 'Email';
  return 'General';
}

export function detectTone(text = '') {
  const value = text.toLowerCase();
  if (/(formal|professional|corporate)/.test(value)) return 'professional';
  if (/(funny|humou?r|witty)/.test(value)) return 'witty';
  if (/(bold|punchy|direct)/.test(value)) return 'direct';
  if (/(premium|luxury)/.test(value)) return 'premium';
  return 'friendly';
}

export function detectDeadline(text = '') {
  const value = text.toLowerCase();
  const iso = value.match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];
  const explicit = value.match(/(?:by|before|deadline[:\s]+)\s*(\d{1,2})\s*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*/);
  if (explicit) {
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const month = months.indexOf(explicit[2]);
    const day = Number(explicit[1]);
    const now = new Date();
    let year = now.getFullYear();
    const candidate = new Date(Date.UTC(year, month, day));
    const today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    if (candidate < today) year += 1;
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }
  if (/\b(tomorrow)\b/.test(value)) {
    const d = new Date(Date.now() + 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (/\b(today|tonight)\b/.test(value)) return new Date().toISOString().slice(0, 10);
  return '';
}

/** Chapter 4 example output: split a request into measurable tasks. */
export function offlineManager(request, { platform } = {}) {
  const text = String(request || '').trim();
  if (!text) {
    return {
      tasks: [
        {
          task: 'Clarify request with user',
          priority: 'Medium',
          owner: 'You',
          deadline: '',
          status: 'Pending',
          notes: 'No request text was received',
        },
      ],
      provider: 'offline',
    };
  }

  if (text.length < 8 || /^(hi|hello|hey|test|testing|asdf)\b/i.test(text)) {
    return {
      tasks: [
        {
          task: 'Clarify request with user',
          priority: 'Medium',
          owner: 'You',
          deadline: '',
          status: 'Pending',
          notes: `The request "${text}" is too short to plan. Ask for the goal, audience and format.`,
        },
      ],
      provider: 'offline',
    };
  }

  const deadline = detectDeadline(text);
  const lower = text.toLowerCase();
  const tasks = [];

  const researchish = /(research|find|compare|tools?|leads?|competitor|ideas?)/.test(lower);
  const contentish = /(reel|post|caption|script|content|video|blog|newsletter|carousel|story|design|draft|write)/.test(lower);
  const planish = /(plan|schedule|launch|campaign|calendar|strategy|roadmap)/.test(lower);
  const moneyish = /(budget|pricing|quote|invoice|cost|spend)/.test(lower);
  const clientish = /(client|proposal|follow ?up|enquir|inquiry|onboard)/.test(lower);

  if (researchish) {
    const subject = (text.match(/(\d+\s+)?(free|paid|best|top)?\s*(ai\s+)?tools?[^.,;]*/i) || [])[0];
    tasks.push({
      task: subject ? `Research ${subject.trim()} worth sharing` : `Research the facts needed to answer: "${shorten(text)}"`,
      priority: 'High',
      owner: 'Research Agent',
      deadline,
      status: 'Pending',
      notes: 'Verify official websites, pricing and current terms before using any claim',
    });
  }

  if (contentish) {
    const platformName = platform || detectPlatform(text);
    const piece = /reel/.test(lower)
      ? 'Reel script (hook + 3 beats + call to action)'
      : /caption/.test(lower)
        ? 'caption'
        : /blog/.test(lower)
          ? 'blog outline'
          : 'draft';
    tasks.push({
      task: `Write the ${platformName} ${piece} for this request`,
      priority: 'High',
      owner: 'Content Agent',
      deadline,
      status: 'Pending',
      notes: 'Send to Quality Checker, then wait for approval before publishing',
    });
  }

  if (moneyish) {
    tasks.push({
      task: 'Prepare a budget line-up with current prices',
      priority: 'Medium',
      owner: 'You',
      deadline,
      status: 'Pending',
      notes: 'Re-check live prices manually — AI must not quote final prices',
    });
  }

  if (clientish) {
    tasks.push({
      task: 'Draft the client follow-up message for review',
      priority: 'Medium',
      owner: 'Content Agent',
      deadline,
      status: 'Pending',
      notes: 'You send every message manually (Chapter 8 rule)',
    });
  }

  if (planish && (tasks.length === 0 || /(schedule|launch|campaign|calendar|roadmap|deadline)/.test(lower))) {
    tasks.push({
      task: 'Turn the plan into a dated checklist and confirm the order',
      priority: 'Medium',
      owner: 'You',
      deadline,
      status: 'Pending',
      notes: 'No deadline was invented unless the request contained one',
    });
  }

  if (tasks.length === 0) {
    tasks.push({
      task: `Complete the request: ${shorten(text)}`,
      priority: 'Medium',
      owner: 'You',
      deadline,
      status: 'Pending',
      notes: 'Add a measurable finish line (what "done" looks like)',
    });
  }

  const capped = tasks.slice(0, 5);
  capped.forEach((task) => {
    if (!isPriority(task.priority)) task.priority = 'Medium';
  });

  return { tasks: capped, provider: 'offline' };
}

const shorten = (text, max = 90) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Chapter 5 content agent — deterministic, brand-safe skeleton draft. */
export function offlineContent({ request, platform, audience, tone, research = '' }) {
  const topic = cleanTopic(request);
  const where = platform || detectPlatform(request);
  const who = audience || 'people who care about this topic';
  const voice = tone || detectTone(request);
  const hook = makeHook(topic, where, voice);
  const facts = research
    ? research
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 3)
        .join(' ')
    : '';

  const body = [
    `Keep it practical for ${who}: one clear idea, one example, one next step.`,
    facts ? `Grounded in your research notes: ${shorten(facts, 220)}` : 'No statistics or prices are claimed here — add your own verified numbers if needed.',
    'Everything here is a draft. Check facts, then approve before publishing.',
  ].join(' ');

  const cta =
    where === 'Email'
      ? 'Call to action: Reply to this email with the one task you want to hand off first.'
      : where === 'LinkedIn'
        ? 'Call to action: If this matches a problem you are solving, comment with the task that eats your week.'
        : where === 'YouTube'
          ? 'Call to action: Subscribe and tell me in the comments which task you would automate first.'
          : 'Call to action: Save this, then reply with the one task that eats your week — I will cover it next.';

  return [
    `Hook: ${hook}`,
    '',
    `Body: ${body}`,
    '',
    `Tone: ${voice}. Platform: ${where}.`,
    cta,
  ].join('\n');
}

const cleanTopic = (request = '') => {
  let text = String(request)
    .replace(/\/?(draft|task)\b/gi, ' ')
    .replace(/\b(write|create|make|prepare|please|give)\b/gi, ' ')
    .replace(/\b(friendly|professional|witty|direct|premium|short|quick|funny)\b/gi, ' ')
    .replace(/\b(instagram|linkedin|youtube|facebook|twitter|whatsapp|email|newsletter)\b/gi, ' ')
    .replace(/\b(caption|script|post|reel|video|carousel|story|blog|thread)\b/gi, ' ')
    .replace(/\b(about|for|on|of)\b/gi, ' ')
    .replace(/\b(that|this|the|a|an|me|one)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (text.length < 6) text = 'this idea';
  return shorten(text, 100);
};

const makeHook = (topic, platform, tone) => {
  const templates = {
    witty: `Nobody warned me that "${shorten(topic, 70)}" would become a weekly habit.`,
    direct: `Here is the short version of ${shorten(topic, 80)} — plus what to ignore.`,
    premium: `A quieter approach to ${shorten(topic, 80)}, built for people who value their time.`,
    professional: `${capitalise(shorten(topic, 80))}: a practical checklist you can use this week.`,
    friendly: `If ${shorten(topic, 80)} keeps slipping down your list, try this simple version first.`,
  };
  const hook = templates[tone] || templates.friendly;
  return platform === 'YouTube' ? `${hook} (30-second version, no fluff.)` : hook;
};

const capitalise = (text) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** Chapter 5 quality checker — returns the documented JSON shape. */
export function offlineQuality(draft, { platform } = {}) {
  const text = String(draft || '');
  const issues = [];
  let decision = 'approve';

  if (text.trim().length < 80) {
    issues.push('Draft is very short — a hook, message and CTA may be missing.');
    decision = 'revise';
  }
  if (/\b(guarantee|guaranteed|100%|instantly|overnight)\b/i.test(text)) {
    issues.push('Contains an absolute or guaranteed-result claim — remove or soften it.');
    decision = 'revise';
  }
  if (/\b(₹|rs\.?|inr|\$)\s?\d/.test(text) && !/verified/i.test(text)) {
    issues.push('Contains a price or money figure — confirm it against a current source before publishing.');
    decision = 'revise';
  }
  if (/\d+\s?%/.test(text) && !/verified/i.test(text)) {
    issues.push('Contains a percentage — check the source or remove the statistic.');
    decision = 'revise';
  }
  if (!/(call to action|reply|comment|save this|subscribe|click|dm\b|sign up|book a call|share)/i.test(text)) {
    issues.push('No clear call to action detected.');
    decision = 'revise';
  }
  if (/(dear customer|customer)/i.test(text)) {
    issues.push('Generic greeting detected — personalise before sending.');
    decision = 'revise';
  }
  if (/\b(earn|income|profit)\b/i.test(text)) {
    issues.push('Income/earning wording can read as a promise — keep it factual.');
    decision = decision === 'approve' ? 'revise' : decision;
  }
  if (platform === 'X (Twitter)' && text.length > 280) {
    issues.push('Longer than a single X post — split into a thread.');
    decision = 'revise';
  }

  const suggested = decision === 'approve'
    ? ''
    : `${text.trim()}\n\n[Auto-check suggestion] Add a specific, verifiable detail and end with one simple question or reply prompt.`;

  return { decision, issues, suggested_revision: suggested, provider: 'offline' };
}

/** Chapter 8 outreach — respects the "verified facts only" rule. */
export function offlineOutreach({ businessName, website, fitReason }) {
  const name = businessName || 'your team';
  const observation = fitReason || 'you share useful updates on social media';
  const site = website ? ` I found you at ${website}.` : '';
  return `Hi ${name},${site}\n\nI noticed ${observation}. I work with small teams that want a calmer way to keep content and follow-ups moving without hiring more people.\n\nWould it be useful if I sent one short example of what that could look like for you? No pitch attached — just a sample.`;
}

/** Chapter 5 daily reporting agent — data-only summary. */
export function offlineReport(data) {
  const { completed = [], pending = [], blocked = [], awaiting = [], priorities = [] } = data;
  const lines = ['📋 DAILY OFFICE REPORT', ''];
  lines.push(`✅ Completed: ${completed.length ? completed.length : '0'}`);
  completed.slice(0, 5).forEach((task) => lines.push(`   • ${task.id} — ${task.task}`));

  lines.push(`🕓 Pending: ${pending.length}`);
  pending.slice(0, 5).forEach((task) => lines.push(`   • ${task.id} — ${task.task} (${task.priority}, ${task.owner})`));

  lines.push(`🚧 Blocked: ${blocked.length}`);
  blocked.slice(0, 5).forEach((task) => lines.push(`   • ${task.id} — ${task.task} — ${task.notes || 'reason not recorded'}`));

  lines.push(`✋ Drafts awaiting approval: ${awaiting.length}`);
  awaiting.slice(0, 5).forEach((draft) => lines.push(`   • ${draft.id} — ${draft.platform} (${draft.status})`));

  lines.push('', '🎯 Three priorities for tomorrow:');
  if (priorities.length === 0) {
    lines.push('   1. No open work — plan the next task with /task');
  } else {
    priorities.slice(0, 3).forEach((task, index) => lines.push(`   ${index + 1}. ${task.id} — ${task.task}`));
  }
  lines.push('', 'Report uses stored task data only. No progress was invented.');
  return lines.join('\n');
}

/** Offline follow-up drafting (Chapter 5). */
export function offlineFollowup({ clientName, context, priorInteraction }) {
  const name = clientName || 'there';
  return `Subject: Quick follow-up${context ? ` — ${shorten(context, 50)}` : ''}

Hi ${name},

I wanted to check in on ${context || 'the work we discussed'}. ${priorInteraction ? `Last time we spoke: ${shorten(priorInteraction, 140)}.` : 'I have not heard back yet, so I am keeping this short.'}

Would it help if I sent a one-page summary of the next step?

Facts I was unsure about:
- Current scope and timeline
- Whether your contact person is still the same
- Any budget range you want me to work within`;
}

/**
 * Chapter 8 lead research, offline mode.
 *
 * The safest behaviour when no model is available is to structure ONLY what a
 * human already typed, keep the source URL, and mark it for verification.
 * If there are no notes, return nothing rather than guessing.
 */
export function offlineResearch({ niche = '', location = '', sourceUrl = '', notes = '' }) {
  if (!sourceUrl || !/^https?:\/\//i.test(sourceUrl)) return [];
  const lines = String(notes || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  return lines.slice(0, 5).map((line) => {
    const [namePart, ...rest] = line.split(/\s+[—-]\s+/);
    const businessName = (namePart || line).replace(/\|/g, '').trim().slice(0, 120);
    return {
      businessName,
      website: '',
      niche: niche || 'unspecified',
      sourceUrl,
      fitReason: rest.join(' — ').trim() || `Listed on ${sourceUrl}${location ? ` (${location})` : ''}`,
      reviewStatus: 'Needs human verification',
      contactStatus: 'Not contacted',
    };
  });
}


/* ── Client pipeline helpers (Chapter 8, extended) ───────────── */

export const LEAD_STAGES = ['New', 'Verified', 'Contacted', 'Replied', 'Won', 'Lost'];

export const nextStage = (stage) => {
  const index = LEAD_STAGES.indexOf(stage);
  if (index === -1 || stage === 'Won' || stage === 'Lost') return stage;
  return LEAD_STAGES[Math.min(index + 1, LEAD_STAGES.length - 3)];
};

/**
 * Deterministic 0-100 fit score. Deliberately explainable:
 * every point comes from something a human can see.
 */
export function scoreLead(lead = {}) {
  let score = 18;
  const reasons = [];
  if (/^https?:\/\//i.test(String(lead.sourceUrl || ''))) { score += 18; reasons.push('public source'); }
  if (/^https?:\/\//i.test(String(lead.website || ''))) { score += 14; reasons.push('website found'); }
  if (String(lead.fitReason || '').length >= 20) { score += 12; reasons.push('specific fit reason'); }
  if (String(lead.niche || '').length > 2) { score += 8; reasons.push('niche known'); }
  if (String(lead.location || '').length > 1) { score += 5; reasons.push('location known'); }
  if (lead.reviewStatus === 'Verified by human') { score += 20; reasons.push('human verified'); }
  if (['Contacted', 'Replied', 'Won'].includes(lead.stage)) { score += 6; reasons.push('already in conversation'); }
  if (String(lead.notes || '').length > 10) { score += 4; reasons.push('context notes'); }
  if (!lead.sourceUrl) { score -= 10; reasons.push('missing source'); }
  if (lead.stage === 'Lost') { score = Math.min(score, 25); reasons.push('marked lost'); }
  return { score: Math.max(4, Math.min(98, Math.round(score))), reasons };
}

/** Chapter 8 morning brief, offline edition. */
export function offlineBrief(context = {}) {
  const { mission = [], approvals = 0, pipeline = {}, followUps = 0, dueToday = 0, overdue = 0, date = '' } = context;
  const lines = [`☀️ INVINCIBLE BRIEF — ${date || new Date().toISOString().slice(0, 10)}`, ''];

  lines.push('Focus:');
  if (mission.length === 0) {
    lines.push('   1. Nothing urgent in the queue — plan one small next step.');
  } else {
    mission.slice(0, 3).forEach((item, index) => lines.push(`   ${index + 1}. ${item.title}${item.reason ? ` — ${item.reason}` : ''}`));
  }

  lines.push('', 'Waiting on you:');
  lines.push(`   • ${approvals} draft${approvals === 1 ? '' : 's'} awaiting approval`);
  if (overdue) lines.push(`   • ${overdue} task${overdue === 1 ? '' : 's'} overdue`);
  if (dueToday) lines.push(`   • ${dueToday} task${dueToday === 1 ? '' : 's'} due today`);
  if (followUps) lines.push(`   • ${followUps} follow-up${followUps === 1 ? '' : 's'} due`);

  lines.push('', 'Money:');
  lines.push(`   • Open pipeline ₹${Number(pipeline.openValue || 0).toLocaleString('en-IN')} across ${pipeline.openCount || 0} live deal(s)`);
  lines.push(`   • Won this cycle ₹${Number(pipeline.wonValue || 0).toLocaleString('en-IN')} · ${pipeline.winRate || 0}% win rate`);

  lines.push('', 'One suggestion:');
  if (approvals > 0) lines.push('   Clear the approval queue first — drafts do not earn anything sitting still.');
  else if (followUps > 0) lines.push('   Send one follow-up before lunch; it is the cheapest deal you will close today.');
  else if (pipeline.openCount) lines.push('   Move one deal to its next stage and write the next step in the notes.');
  else lines.push('   Run /find for one niche and add five real businesses with sources.');

  lines.push('', 'Based only on stored office data. No progress was invented.');
  return lines.join('\n');
}

/** Client Finder research plan, offline edition. */
export function offlineFindPlan({ niche = '', location = '', notes = '' } = {}) {
  const n = String(niche || 'your niche').trim();
  const l = String(location || 'your city').trim();
  return {
    summary: `Best-fit clients are small ${n} businesses in ${l} that already post online but have no visible plan.`,
    queries: [
      `${n} ${l} contact`,
      `${n} ${l} instagram`,
      `best ${n} in ${l} 2026`,
      `site:linkedin.com/company ${n} ${l}`,
      `site:justdial.com ${n} ${l}`,
      `${n} near ${l}`,
      `${n} ${l} google maps`,
      notes ? `${n} ${l} ${shorten(notes, 40)}` : `${n} ${l} reviews`,
    ],
    directories: [
      'Google Maps listings with website links',
      'Justdial / IndiaMART category pages',
      'LinkedIn company pages filtered by city',
      'Instagram location tags and recent posts',
      'Clutch or DesignRush if the niche is creative',
      'Local business association or chamber directory',
    ],
    checklist: [
      'Open the public source and confirm the business is real by hand',
      'Check their website and latest public post date',
      'Write one specific fit reason in your own words',
      'Copy the exact source URL into the lead row',
      'Dedupe by domain and normalised business name before adding',
      'Never invent an email, phone number or revenue figure',
    ],
    red_flags: [
      'No website and no active public presence',
      'Already has a large in-house content team',
      'Only gated or paid directories list them',
      'Source URL does not actually mention the business',
    ],
    provider: 'offline',
  };
}

/** Proposal draft, offline edition. */
export function offlineProposal({ company = '', contact = '', niche = '', value = 0, notes = '' } = {}) {
  const name = company || 'your business';
  const who = contact && contact !== 'Owner' ? contact : 'there';
  const price = Number(value) > 0 ? `₹${Number(value).toLocaleString('en-IN')}` : '[PRICE TBC]';
  return [
    `# Proposal — ${name}`,
    '',
    '## Understanding',
    `Hi ${who}, from what we discussed, ${name} is doing good work in ${niche || 'your space'} but the content and follow-up work is competing with delivery time. The goal is a repeatable weekly rhythm, not more posting.`,
    '',
    '## What we will do',
    '1. One weekly content plan with hooks and calls to action.',
    '2. Three drafts per week for your approval — nothing is published without you.',
    '3. A simple lead and follow-up tracker with one review call each week.',
    '4. A short monthly report: what shipped, what worked, what changes next.',
    '',
    '## Timeline',
    '[CONFIRM] — propose a two-week setup, then a weekly rhythm.',
    '',
    '## Investment',
    `${price} per month [CONFIRM]`,
    '',
    '## Next step',
    `Does the weekly rhythm above match how ${name} actually works? If yes, I will send the first content plan for review.`,
    '',
    '---',
    notes ? `Notes used: ${shorten(notes, 200)}` : 'No extra notes were provided.',
    'Draft only. Check every price, date and claim before sending.',
  ].join('\n');
}

/** Pull IDs out of any text (used by /approve, /revise, /reject). */
export function extractIds(text = '', kind = 'task') {
  const regex = kind === 'draft' ? DRAFT_ID : kind === 'lead' ? LEAD_ID : TASK_ID;
  return [...new Set((String(text).match(regex) || []).map((id) => id.toUpperCase()))];
}

export function summariseRequestSafely(text, max = 120) {
  return shorten(String(text || '').replace(/\s+/g, ' ').trim(), max);
}
