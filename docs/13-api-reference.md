# API reference

The office exposes a small JSON API. Everything the console does goes through it, so you can
automate, test or integrate without touching the UI.

Base URL: `http://localhost:3000`

If `OFFICE_ACCESS_CODE` is set, every `/api/*` request needs:

```
x-office-code: your-code
```

The Telegram webhook is exempt (it uses its own secret header).

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/healthz` | liveness + version |
| GET | `/api/state` | full office state (tasks, drafts, leads, log, audit, provider) |
| POST | `/api/command` | run any command: `{ "raw": "/task ..." }` |
| POST | `/api/settings` | provider, models, daily cap |
| POST | `/api/provider/test` | force a connection test |
| POST | `/api/reset` | wipe data: `{ "seed": false }` |
| GET | `/api/export/all` | all four tabs as CSV text in JSON |
| GET | `/api/export/tasks` | Tasks CSV download |
| GET | `/api/export/drafts` | Drafts CSV download |
| GET | `/api/export/leads` | Leads CSV download |
| GET | `/api/export/daily-log` | Daily Log CSV download |
| GET | `/api/docs` | list guide chapters |
| GET | `/api/docs/:slug` | one chapter as markdown |
| POST | `/api/webhook/telegram` | Telegram updates (secret header) |

## Examples

### Run a command

```bash
curl -s localhost:3000/api/command \
  -H 'content-type: application/json' \
  -d '{"raw":"/task Plan a Reel about free AI tools"}'
```

Response:

```json
{
  "ok": true,
  "reply": "✅ Task received…\nT-0003 · High · Research Agent …",
  "buttons": [{ "label": "Create draft", "command": "/draft …", "tone": "good" }],
  "state": { "tasks": [], "drafts": [], "provider": {} }
}
```

Every successful command returns the full new state, so a client can re-render without a
second request.

### Approve a draft

```bash
curl -s localhost:3000/api/command \
  -H 'content-type: application/json' \
  -d '{"raw":"/approve D-0001"}'
```

### Update settings

```bash
curl -s localhost:3000/api/settings \
  -H 'content-type: application/json' \
  -d '{"provider":"ollama","ollamaModel":"llama3.2","maxCallsPerDay":120}'
```

`provider` accepts `auto`, `ollama`, `gemini`, `offline`.

### Export

```bash
curl -s localhost:3000/api/export/tasks -o tasks.csv
curl -s localhost:3000/api/export/all | jq -r '.tabs["Leads"]' > leads.csv
```

### Telegram webhook

```bash
curl -s localhost:3000/api/webhook/telegram \
  -H 'content-type: application/json' \
  -H "x-telegram-bot-api-secret-token: $WEBHOOK_SECRET" \
  -d '{"update_id":1,"message":{"message_id":1,"from":{"id":111111111},"chat":{"id":111111111},"text":"/status"}}'
```

## Commands

| Command | Aliases / notes |
| --- | --- |
| `/task <request>` | plain text without a slash is treated as `/task` |
| `/draft <request> [--platform X] [--tone Y] [--audience Z]` | also `-p`, `-t`, `-a` |
| `/report` | writes or replaces today's Daily Log row |
| `/approve [D-0001] [note]` | no ID = latest awaiting draft |
| `/revise [D-0001] <feedback>` | creates a new gated version |
| `/reject [D-0001] <reason>` | records the reason |
| `/lead niche \| location \| url \| notes` | URL mandatory; one business per line |
| `/verify L-0001` | marks human verification |
| `/outreach L-0001` | drafts, never sends, enforces 90 words |
| `/followup <client>` | drafts a follow-up |
| `/done T-0001`, `/progress T-0001`, `/block T-0001 reason` | task status |
| `/status`, `/help` | counters and command list |

## Environment variables

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `HOST` | `0.0.0.0` | bind address |
| `DATA_DIR` | `./data` | where `db.json` lives |
| `SEED_DEMO` | `true` | seed the Chapter 4 example on first boot |
| `OFFICE_TIMEZONE` | `Asia/Kolkata` | dates in reports and logs |
| `ALLOWED_USER_IDS` | `owner` | console actors allowed |
| `OFFICE_ACCESS_CODE` | *(unset)* | required header value for `/api/*` |
| `AI_PROVIDER` | `auto` | `auto`, `ollama`, `gemini`, `offline` |
| `OLLAMA_BASE_URL` | `http://localhost:11434` | Ollama endpoint |
| `OLLAMA_MODEL` | `llama3.2` | model name as shown by `ollama list` |
| `GEMINI_API_KEY` | *(unset)* | optional hosted fallback |
| `GEMINI_MODEL` | `gemini-2.0-flash` | Gemini model id |
| `MAX_MODEL_CALLS_PER_DAY` | `200` | hard cost cap |
| `TELEGRAM_BOT_TOKEN` | *(unset)* | @BotFather token |
| `ALLOWED_TELEGRAM_USER_IDS` | `ALLOWED_USER_IDS` | numeric IDs only |
| `TELEGRAM_MODE` | `off` | `polling` to start the connector |
| `WEBHOOK_SECRET` | *(unset)* | `secret_token` for webhook mode |
| `GOOGLE_SHEETS_ID` | *(unset)* | reserved for direct sync |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | *(unset)* | reserved for direct sync |

## Response codes

| Code | Meaning |
| --- | --- |
| 200 | success |
| 400 | bad JSON body or invalid input |
| 401 | missing/incorrect `x-office-code` or webhook secret |
| 404 | unknown route, doc or export |
| 500 | unexpected server error (check the terminal) |

## Data shapes

Task:

```json
{ "id": "T-0001", "createdAt": "2026-10-27T10:00:00.000Z", "request": "…",
  "task": "…", "priority": "High", "owner": "Research Agent", "deadline": "",
  "status": "Pending", "notes": "…", "provider": "offline" }
```

Draft:

```json
{ "id": "D-0001", "taskId": "T-0001", "platform": "Instagram", "draft": "…",
  "status": "Awaiting approval", "version": 1, "feedback": "",
  "qa": { "decision": "approve", "issues": [], "suggested_revision": "" },
  "history": [] }
```

Lead:

```json
{ "id": "L-0001", "businessName": "Example Studio", "website": "",
  "niche": "design agencies", "sourceUrl": "https://example.com/directory",
  "fitReason": "…", "contactStatus": "Not contacted",
  "reviewStatus": "Needs human verification", "nextAction": "…" }
```

Audit event:

```json
{ "id": "A-1a2b3c4d", "ts": "2026-10-27T10:00:00.000Z", "actor": "owner",
  "action": "draft.approved", "ref": "D-0001", "detail": "", "level": "info" }
```
