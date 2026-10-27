# Telegram — your command centre

Telegram is the front door in the guide: you send a command from your phone, the office
plans or drafts, and the result comes back with approval options.

## Create the bot

1. Telegram → **@BotFather** → `/newbot`.
2. Display name, then username ending in `bot`.
3. Copy the token. It looks like `123456789:AA...`.

Put it in `.env`:

```bash
TELEGRAM_BOT_TOKEN=123456789:AA...
ALLOWED_TELEGRAM_USER_IDS=987654321
TELEGRAM_MODE=polling
WEBHOOK_SECRET=choose-a-long-random-string   # only for webhook mode
```

Restart the office. The startup log prints `Telegram: polling for commands` when the
connector is live.

## Find your numeric user ID

Message **@userinfobot**. It replies with an `Id` like `987654321`. Usernames and phone
numbers are not accepted in the allow-list — only numeric IDs.

Add more people (a VA, a co-founder) by comma-separating IDs:

```bash
ALLOWED_TELEGRAM_USER_IDS=987654321,123123123
```

Anyone else who messages the bot gets a polite refusal, and the attempt is written to the
audit trail as `telegram.denied`.

## Commands

| Command | What happens |
| --- | --- |
| `/task <request>` | AI Manager creates 1–5 tasks in the Tasks tab |
| `/draft <request>` | Content Agent writes one draft, Quality Checker reviews it |
| `/report` | Daily Reporting Agent summarises stored rows only |
| `/approve D-0001` | Records your approval — nothing is published |
| `/revise D-0001 <feedback>` | New version, still awaiting approval |
| `/reject D-0001 <reason>` | Marks rejected with your reason |
| `/lead niche \| place \| source URL \| notes` | Lead rows with source URLs, all unverified |
| `/status` | Counters, provider, daily model usage |
| `/help` | Command list |
| `/outreach L-0001` | Drafts a first message; never sends it |
| `/followup Client name` | Drafts a polite follow-up |
| `/verify L-0001` | Marks a lead reviewed by a human |
| `/done T-0001`, `/progress T-0001`, `/block T-0001 reason` | Task status updates |

If someone types plain text without a slash, it is treated as `/task` — like chatting with
your manager.

## Buttons

Approval messages include three inline buttons. Tapping one sends the matching command back
as a callback (`/approve D-0001`, etc.). The connector answers the callback so Telegram
does not show a spinner.

Approval template (Chapter 9):

```
✋ APPROVAL NEEDED — D-0001
Task: Instagram Reel caption
Status: Awaiting approval

Draft:
[AI-generated draft]

Choose:
/approve D-0001
/revise D-0001 Your feedback
/reject D-0001 Reason
```

## Polling vs webhook

| Mode | Use when | Notes |
| --- | --- | --- |
| Polling (`TELEGRAM_MODE=polling`) | local laptop, home server, no public URL | long-poll with a 25 s timeout; no open ports |
| Webhook | cloud VM with HTTPS | faster, but needs TLS and a secret token |

Polling rules:

- Only **one** process may poll a bot. A second consumer returns `409 Conflict` and the
  connector stops itself rather than fighting for updates.
- The update offset is advanced per update, so a crash does not replay old commands.

Webhook mode:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -d "url=https://your-domain/api/webhook/telegram" \
  -d "secret_token=$WEBHOOK_SECRET"
```

The server checks `X-Telegram-Bot-Api-Secret-Token`; wrong secrets get `401` and the update
is ignored. Set `TELEGRAM_MODE=off` so polling does not compete with the webhook.

## Privacy and safety

- Bot conversations are stored in Telegram's cloud. Do not send client secrets or personal
  data through the bot.
- Drafts written by a **local** Ollama model never leave your machine until you copy them.
  Gemini and other hosted APIs do leave your machine — keep sensitive context out.
- Rate: Telegram allows roughly 30 messages per second to different chats; a personal office
  will never approach this. Free-form bulk messaging is against Telegram's terms.
- The bot can only do what the workflow allows. There is no `/publish`, `/send`, `/delete`
  or `/pay` command in this office — by design.
