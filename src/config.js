import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Product identity — one place to rename the office. */
export const BRAND = {
  name: 'AI Invincible Office',
  short: 'Invincible',
  workspace: 'Invincible HQ',
  tagline: 'Plan the week, find the clients, draft the work — you approve everything.',
  version: '2.4.0',
};

/** Tiny .env loader — no dependencies, never overrides real environment values. */
function loadEnvFile() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadEnvFile();

const num = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const list = (value) =>
  String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

export const config = {
  root: ROOT,
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  publicDir: path.join(ROOT, 'public'),
  seedDemo: String(process.env.SEED_DEMO || 'true') !== 'false',
  timezone: process.env.OFFICE_TIMEZONE || 'Asia/Kolkata',

  access: {
    allowedUserIds: list(process.env.ALLOWED_USER_IDS || 'owner'),
    /** When set, every /api/* call must send x-office-code. The UI collects it once. */
    code: process.env.OFFICE_ACCESS_CODE || '',
  },

  /** Auditor agent — how hard it is allowed to look at a lead's website. */
  audit: {
    timeoutMs: num(process.env.AUDIT_TIMEOUT_MS, 8000),
    maxBytes: num(process.env.AUDIT_MAX_BYTES, 400000),
    perRun: num(process.env.AUDIT_PER_RUN, 5),
  },

  /** Follow-up cadence in days. Empty string disables a step. */
  followUp: {
    first: num(process.env.FOLLOWUP_DAYS_1, 3),
    second: num(process.env.FOLLOWUP_DAYS_2, 7),
  },

  /** In-process scheduler. Off by default in tests (SCHEDULER=off). */
  scheduler: {
    enabled: String(process.env.SCHEDULER || 'on').toLowerCase() !== 'off',
    hour: num(process.env.SCHEDULER_HOUR, 9),
    minute: num(process.env.SCHEDULER_MINUTE, 0),
  },

  ai: {
    provider: (process.env.AI_PROVIDER || 'auto').toLowerCase(),
    ollamaUrl: (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/+$/, ''),
    ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
    geminiKey: process.env.GEMINI_API_KEY || '',
    geminiModel: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
    maxCallsPerDay: num(process.env.MAX_MODEL_CALLS_PER_DAY, 200),
    requestTimeoutMs: num(process.env.AI_TIMEOUT_MS, 60_000),
  },

  sourcing: {
    provider: (process.env.SOURCING_PROVIDER || 'auto').toLowerCase(),
    placesKey: process.env.GOOGLE_PLACES_API_KEY || '',
    overpassUrl: process.env.OVERPASS_URL || 'https://overpass-api.de/api/interpreter',
    placesUrl: process.env.PLACES_URL || 'https://places.googleapis.com/v1/places:searchText',
    nominatimUrl: process.env.NOMINATIM_URL || 'https://nominatim.openstreetmap.org',
    userAgent: process.env.SOURCING_USER_AGENT || 'AI-Invincible-Office/2.0 (lead research; contact via app)',
    requestTimeoutMs: num(process.env.SOURCING_TIMEOUT_MS, 30_000),
  },


  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    /** Where scheduled briefs are delivered. Deliberately separate from client data. */
    ownerChatId: process.env.TELEGRAM_OWNER_CHAT_ID || '',
    allowedUserIds: list(process.env.ALLOWED_TELEGRAM_USER_IDS || process.env.ALLOWED_USER_IDS || 'owner'),
    webhookSecret: process.env.WEBHOOK_SECRET || '',
  },

  version: BRAND.version,
};

export const hasSecret = (value) => Boolean(value && String(value).trim());

/** True when a usable secret is configured — never returns the secret itself. */
export const secretStatus = () => ({
  accessCode: hasSecret(config.access.code),
  placesApiKey: hasSecret(config.sourcing.placesKey),
  telegramBotToken: hasSecret(config.telegram.botToken),
  geminiKey: hasSecret(config.ai.geminiKey),
  webhookSecret: hasSecret(config.telegram.webhookSecret),
});
