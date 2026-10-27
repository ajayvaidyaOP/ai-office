import { config } from '../config.js';
import { handleCommand } from '../office.js';
import { store } from '../store.js';

/**
 * Telegram connector (Chapter 3 + Chapter 6).
 *
 * Two modes:
 *  - polling:  easiest for local use, no public URL needed. Started when
 *              TELEGRAM_BOT_TOKEN is set and TELEGRAM_MODE=polling.
 *  - webhook:  the server exposes POST /api/webhook/telegram; point Telegram at
 *              it with setWebhook. Use TELEGRAM_WEBHOOK_SECRET to verify.
 *
 * Security: only user IDs in ALLOWED_TELEGRAM_USER_IDS may trigger workflows.
 * Everyone else gets a polite refusal. The bot token is never logged.
 */

const API = 'https://api.telegram.org';

export const isAllowedTelegramUser = (id) => {
  const allowed = store.settings.allowedUserIds?.length
    ? store.settings.allowedUserIds
    : config.telegram.allowedUserIds;
  return allowed.map(String).includes(String(id));
};

export async function sendTelegram(chatId, text, buttons = []) {
  if (!config.telegram.botToken) return { ok: false, reason: 'no token' };
  const reply_markup = buttons.length
    ? {
        inline_keyboard: [
          buttons.map((button) => ({ text: button.label, callback_data: button.command.slice(0, 64) })),
        ],
      }
    : undefined;

  try {
    const response = await fetch(`${API}/bot${config.telegram.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text: text.slice(0, 4000),
        reply_markup,
        disable_web_page_preview: true,
      }),
    });
    const json = await response.json().catch(() => ({}));
    return { ok: Boolean(json.ok), reason: json.description || '' };
  } catch (error) {
    return { ok: false, reason: error.message };
  }
}

/** Turn a Telegram update into an office command. Shared by polling + webhook. */
export async function handleTelegramUpdate(update = {}) {
  const message = update.message || update.edited_message;
  const callback = update.callback_query;
  const fromId = message?.from?.id ?? callback?.from?.id;
  const chatId = message?.chat?.id ?? callback?.message?.chat?.id;

  if (!fromId || !chatId) return { ok: false, reason: 'no message' };

  if (!isAllowedTelegramUser(fromId)) {
    store.audit('telegram.denied', { actor: `tg:${fromId}`, level: 'warn', detail: 'user not in allow-list' });
    await sendTelegram(chatId, '🚫 This bot is private. Your Telegram user ID is not on the allow-list.');
    return { ok: false, reason: 'not allowed' };
  }

  const text = message?.text || callback?.data || '';
  if (!text) return { ok: false, reason: 'unsupported update type' };

  const result = await handleCommand({ raw: text, actor: `tg:${fromId}`, channel: 'telegram' });
  await sendTelegram(chatId, result.reply, result.buttons);
  if (callback?.id) {
    await fetch(`${API}/bot${config.telegram.botToken}/answerCallbackQuery`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callback_query_id: callback.id, text: 'Recorded' }),
    }).catch(() => {});
  }
  return result;
}

let polling = null;
let offset = 0;

export function startTelegramPolling() {
  if (!config.telegram.botToken || polling) return { started: false, reason: 'no token or already running' };
  const mode = (process.env.TELEGRAM_MODE || 'off').toLowerCase();
  if (mode !== 'polling') return { started: false, reason: `TELEGRAM_MODE=${mode}` };

  store.audit('telegram.polling_started', { detail: 'long-poll connector started' });
  let alive = true;

  const loop = async () => {
    while (alive) {
      try {
        const response = await fetch(
          `${API}/bot${config.telegram.botToken}/getUpdates?timeout=25&offset=${offset}&allowed_updates=${encodeURIComponent('["message","callback_query"]')}`,
        );
        const json = await response.json().catch(() => ({}));
        if (json.ok && Array.isArray(json.result)) {
          for (const update of json.result) {
            offset = update.update_id + 1;
            await handleTelegramUpdate(update).catch((error) =>
              console.error('[telegram] update failed:', error.message),
            );
          }
        } else if (json.error_code === 409) {
          console.error('[telegram] Another consumer is polling this bot. Stop it before starting this one.');
          alive = false;
        } else if (!json.ok) {
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 5000));
      }
    }
  };

  polling = loop();
  return { started: true, mode: 'polling' };
}

export function stopTelegramPolling() {
  polling = null;
}

export const telegramStatus = () => ({
  configured: Boolean(config.telegram.botToken),
  mode: (process.env.TELEGRAM_MODE || 'off').toLowerCase(),
  polling: Boolean(polling),
  allowedUsers: (store.settings.allowedUserIds || []).length,
  webhookPath: '/api/webhook/telegram',
});
