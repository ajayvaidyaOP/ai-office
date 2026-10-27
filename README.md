# AI Digital Office

A **working prototype** of the *Build Your Own AI Digital Office* guide: a Telegram-style
console where you send a command, the AI Manager plans the work, specialist agents draft the
content, and **nothing leaves the office without your approval**.

Built from the 23-page setup guide (n8n + Ollama + Google Sheets + Telegram, with human
approval gates). It runs with **zero API keys and zero dependencies** — the deterministic
offline engine handles every agent until you connect a real model.

```bash
npm start        # → http://localhost:3000
npm run check    # deployment self-check (spins a throwaway instance)
```

---

## What it looks like

- **Console** — a chat with your AI Manager, quick command chips, live "awaiting approval" counter.
- **Tasks** — the Tasks sheet, mirrored; priority, owner, deadline, status.
- **Drafts** — every draft with its Quality Checker verdict and Approve / Revise / Reject.
- **Leads** — public-source rows with mandatory URLs and *Needs human verification*.
- **Daily Log** — one row per day from the reporting agent.
- **Audit** — every command and decision, newest first.
- **Setup** — engine, secrets status, CSV export, deployment checklist.
- **Guide** — the chapters, readable inside the app.

Dark "control room" UI, responsive down to a phone. No build step, no framework, no `node_modules`.

```
┌────────────────┐   command   ┌──────────────────┐   prompt   ┌──────────────┐
│ Telegram /     │ ──────────▶ │   AI Manager     │ ─────────▶ │ Ollama or    │
│ web console    │             │   (validation)   │ ◀───────── │ Gemini /     │
└────────────────┘             └────────┬─────────┘    JSON    │ offline rules│
        ▲                               │                      └──────────────┘
        │  approval request             ├──▶ Tasks · Drafts · Leads · Daily Log
        └───────────────────────────────┘        (data/db.json ⇄ Google Sheets)
```

## Guide → build map

| Guide chapter | Here |
| --- | --- |
| Ch 1–2 — concepts, roles | six agents wired in, each with a human control |
| Ch 3 — tools & installation | `docker-compose.yml`, `Dockerfile`, `docs/02-install.md` |
| Ch 4 — AI Manager | `src/agents/` with the exact prompt + JSON validation |
| Ch 5 — specialist agents | Content, Lead Research, Follow-up, Quality Checker, Reporting |
| Ch 6 — connect everything | Telegram polling/webhook, Sheets CSV, JSON API |
| Ch 7 — working prototype | runs out of the box on the offline engine |
| Ch 8 — leads & clients | `/lead`, `/verify`, `/outreach` — no auto-messaging, ever |
| Ch 9 — approval & security | gates, allow-list, audit trail, daily cost cap |
| Ch 10 — daily operations | `/report`, Daily Log, weekly checklist |
| Ch 11 — troubleshooting | `npm run check` + `docs/09-troubleshooting.md` |
| Ch 12 — budget & hosting | `docs/10-budget-and-hosting.md` (INR table) |
| Ch 13 — roadmap | `docs/11-roadmap.md` (six levels) |
| Ch 14 — copy-paste resources | `docs/05-prompts.md`, `templates/*.csv`, `n8n/workflows/` |

## Commands

| Command | What happens |
| --- | --- |
| `/task <request>` | 1–5 validated tasks, priority + owner + status |
| `/draft <request>` | one draft + QA notes, saved as *Awaiting approval* |
| `/report` | daily summary from stored rows only |
| `/approve D-0001` | records approval — you still publish manually |
| `/revise D-0001 <feedback>` | new version, gated again |
| `/reject D-0001 <reason>` | records the reason |
| `/lead niche \| place \| source URL \| notes` | lead rows, all unverified |
| `/verify L-0001` · `/outreach L-0001` | human check, then a draft you send yourself |
| `/done` `/progress` `/block` `T-0001` | task status |
| `/status`, `/help` | counters, command list |

Plain text without a slash is treated as `/task`. `--platform`, `--tone`, `--audience` flags work on `/draft`.

## Three ways to run

### 1. Office only — zero setup

```bash
npm start
```

Node.js 20+. No npm install, no keys. The offline engine plans, drafts and checks quality
with conservative rules (no invented deadlines, prices, statistics or contacts).

### 2. With a local model (free, private)

```bash
ollama pull llama3.2
AI_PROVIDER=auto OLLAMA_MODEL=llama3.2 npm start
```

Or copy `.env.example` → `.env`. **Setup → Test connection** shows the live engine.

### 3. Full guide stack (n8n + Docker)

```bash
cp .env.example .env      # add N8N_ENCRYPTION_KEY, Telegram token, timezone
docker compose up -d      # n8n :5678, office :3000
```

Then import the starters from `n8n/workflows/` and follow `docs/06-n8n-workflows.md`.

## Repository layout

```
server.js               HTTP server + JSON API (no dependencies)
src/
  office.js             command router, approval gates, dedupe, audit
  store.js              JSON database, IDs, seed demo, usage counters
  sheets.js             Chapter 14 tab layouts, CSV export
  agents/
    prompts.js          the exact prompts from the guide
    provider.js         Ollama / Gemini resolution, JSON extraction, cost cap
    offline.js          deterministic rules engine (always available)
    index.js            agent entry points with validation + fallback
  channels/telegram.js  polling + webhook connector, allow-list
public/                 console UI (vanilla ES modules + CSS)
docs/                   14 chapters: setup, prompts, security, budget, API…
n8n/workflows/          importable starter workflows (4)
templates/              Google Sheets CSV headers
scripts/check.mjs       end-to-end self-check
scripts/backup.mjs      DB + CSV backup
```

## Safety defaults

- **Allow-list** — unknown Telegram users are refused and logged.
- **Validation** — AI JSON is checked before storage; invalid output falls back to the planner.
- **Approval gate** — no command publishes, messages, spends or deletes.
- **Idempotency** — duplicate commands inside 20 seconds are ignored.
- **Cost cap** — `MAX_MODEL_CALLS_PER_DAY` stops runaway spend; the office degrades to offline.
- **Audit trail** — command, actor, reference, timestamp, decision.
- **Semi-automatic by design** — `/approve` records intent; you copy and publish.

Read [`docs/07-security-approvals.md`](docs/07-security-approvals.md) before connecting anything public.

## Verify

```bash
npm run check    # health, /task, /draft, approval gate, /report, /lead, CSV, audit
npm run backup   # data/db.json + four CSVs into backups/<timestamp>/
```

## Configuration

Copy `.env.example` to `.env`. Every variable is documented in
[`docs/13-api-reference.md`](docs/13-api-reference.md).

Most useful:

```bash
AI_PROVIDER=auto                 # auto | ollama | gemini | offline
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
MAX_MODEL_CALLS_PER_DAY=200
TELEGRAM_BOT_TOKEN=
ALLOWED_TELEGRAM_USER_IDS=
TELEGRAM_MODE=off               # set to polling to start the bot
OFFICE_ACCESS_CODE=             # optional header gate for /api/*
```

Inside Docker, Ollama on the host is `http://host.docker.internal:11434` (already set in
`docker-compose.yml`, with `host-gateway` for Linux).

## The one rule

> AI can draft and organise. A human must approve anything public, outbound, financial,
> or irreversible.

This repository is an educational prototype. It does not claim that any provider's free tier,
price or licence will stay the same. Test each workflow in your own environment and follow
each provider's current terms.
