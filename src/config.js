import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

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

  sheets: {
    spreadsheetId: process.env.GOOGLE_SHEETS_ID || '',
    serviceAccountFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '',
  },

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN || '',
    allowedUserIds: list(process.env.ALLOWED_TELEGRAM_USER_IDS || process.env.ALLOWED_USER_IDS || 'owner'),
    webhookSecret: process.env.WEBHOOK_SECRET || '',
  },

  version: '1.0.0',
};

export const hasSecret = (value) => Boolean(value && String(value).trim());

/** True when a usable secret is configured — never returns the secret itself. */
export const secretStatus = () => ({
  telegramBotToken: hasSecret(config.telegram.botToken),
  geminiKey: hasSecret(config.ai.geminiKey),
  webhookSecret: hasSecret(config.telegram.webhookSecret),
  googleSheetId: hasSecret(config.sheets.spreadsheetId),
  googleServiceAccount: hasSecret(config.sheets.serviceAccountFile),
});
