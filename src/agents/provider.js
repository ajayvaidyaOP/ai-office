import { config } from '../config.js';
import { store } from '../store.js';

/**
 * Model provider layer.
 *
 * Order of preference (AI_PROVIDER=auto):
 *   1. Ollama on your own machine (free, private)  — Chapters 3 & 6
 *   2. Gemini API (optional hosted fallback)
 *   3. Offline rules engine (always available)
 *
 * Every call is billed against a daily counter so an accidental loop cannot
 * drain an API budget (Chapter 9: cost limits).
 */

let ollamaCache = { at: 0, ok: false, models: [] };
let geminiBlockedUntil = 0;

const now = () => new Date().toISOString();

function cacheOllama(ok, models = []) {
  ollamaCache = { at: Date.now(), ok, models };
}

export async function probeOllama({ force = false } = {}) {
  const settings = store.settings;
  const baseUrl = settings.ollamaUrl || config.ai.ollamaUrl;
  if (!force && Date.now() - ollamaCache.at < 15_000) return ollamaCache;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${baseUrl}/api/tags`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    const models = (json.models || []).map((model) => model.name).filter(Boolean);
    cacheOllama(models.length > 0, models);
  } catch {
    cacheOllama(false, []);
  } finally {
    clearTimeout(timer);
  }
  return ollamaCache;
}

async function callOllama(prompt, system) {
  const settings = store.settings;
  const baseUrl = settings.ollamaUrl || config.ai.ollamaUrl;
  const model = settings.ollamaModel || config.ai.ollamaModel;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.requestTimeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        stream: false,
        options: { temperature: 0.2 },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: prompt },
        ],
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Ollama HTTP ${response.status} ${detail.slice(0, 160)}`);
    }
    const json = await response.json();
    const text = json?.message?.content?.trim();
    if (!text) throw new Error('Ollama returned an empty message');
    return { text, provider: 'ollama', model };
  } finally {
    clearTimeout(timer);
  }
}

async function callGemini(prompt, system) {
  if (!config.ai.geminiKey) throw new Error('No GEMINI_API_KEY configured');
  if (Date.now() < geminiBlockedUntil) throw new Error('Gemini temporarily paused after an error');
  const model = store.settings.geminiModel || config.ai.geminiModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), config.ai.requestTimeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': config.ai.geminiKey },
      signal: controller.signal,
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 1600 },
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      if (response.status === 401 || response.status === 403 || response.status === 429) {
        geminiBlockedUntil = Date.now() + 10 * 60_000;
      }
      throw new Error(`Gemini HTTP ${response.status} ${detail.slice(0, 160)}`);
    }
    const json = await response.json();
    const text = (json?.candidates?.[0]?.content?.parts || [])
      .map((part) => part.text || '')
      .join('')
      .trim();
    if (!text) throw new Error('Gemini returned an empty candidate');
    return { text, provider: 'gemini', model };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the configured model. Returns { text, provider, model } or throws.
 * Throws are caught by the agent layer, which falls back offline.
 */
export async function ask({ prompt, system, expectJson = false }) {
  const settings = store.settings;
  const provider = (settings.provider || 'auto').toLowerCase();

  if (store.usageToday() >= Number(settings.maxCallsPerDay || config.ai.maxCallsPerDay)) {
    throw new Error('Daily model call limit reached');
  }

  const attempts = [];
  if (provider === 'auto' || provider === 'ollama') {
    const probe = await probeOllama();
    if (probe.ok) attempts.push(() => callOllama(prompt, system));
    else if (provider === 'ollama') attempts.push(() => callOllama(prompt, system)); // surface the real error
  }
  if (provider === 'auto' || provider === 'gemini') {
    if (config.ai.geminiKey) attempts.push(() => callGemini(prompt, system));
  }
  if (attempts.length === 0) throw new Error('No AI provider is reachable');

  let lastError;
  for (const attempt of attempts) {
    try {
      const result = await attempt();
      store.recordUsage(result.provider, 1);
      store.db.meta.lastProviderTest = { at: now(), ok: true, provider: result.provider, model: result.model };
      store.save();
      if (expectJson) result.text = extractJson(result.text);
      return result;
    } catch (error) {
      lastError = error;
      store.db.meta.lastProviderTest = { at: now(), ok: false, provider: 'unknown', error: error.message };
      store.save();
    }
  }
  throw lastError || new Error('All AI providers failed');
}

/** Models sometimes wrap JSON in prose or fences — pull out the object. */
export function extractJson(raw) {
  const text = String(raw || '').trim();
  if (!text) throw new Error('Empty model response');
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error('No JSON found in model response');
  const open = candidate[start];
  const close = open === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < candidate.length; index += 1) {
    const char = candidate[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === open) depth += 1;
    else if (char === close) {
      depth -= 1;
      if (depth === 0) {
        const slice = candidate.slice(start, index + 1);
        return JSON.parse(slice);
      }
    }
  }
  throw new Error('Incomplete JSON in model response');
}

export function providerStatus() {
  return {
    configured: store.settings.provider,
    ollama: { reachable: ollamaCache.ok, models: ollamaCache.models, url: store.settings.ollamaUrl },
    gemini: { configured: Boolean(config.ai.geminiKey), model: store.settings.geminiModel, paused: Date.now() < geminiBlockedUntil },
    offline: { available: true },
    callsToday: store.usageToday(),
    limit: Number(store.settings.maxCallsPerDay || config.ai.maxCallsPerDay),
    lastTest: store.db.meta.lastProviderTest,
  };
}
