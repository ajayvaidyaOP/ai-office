# AI Invincible Office

**Your own AI back office.** A command centre where a manager agent plans the week, a client
finder builds research plans, a content studio drafts posts, proposals and outreach, and a CRM
tracks the money — with **one rule: nothing leaves the office without your approval**.

Built on the 23-page *AI Digital Office* setup guide, extended into a full working product.
(n8n and Google Sheets from the original guide were removed in v2.2 — the app now has its
own scheduler and a CSV export. See `docs/15-what-changed-v2.1.md`.)

- **Dashboard** — health score, focus list, pipeline, approval queue, activity chart.
- **AI Console** — talk to your manager: `/task`, `/draft`, `/brief`, `/find`, `/clients`.
- **Approvals inbox** — read, revise, approve or reject every draft and proposal.
- **Clients CRM** — kanban pipeline, deal values, follow-ups, proposals, notes.
- **Client Finder** — niche + city → **real businesses from OpenStreetMap or Google Places**, scored
  for sales fit and imported as leads with their source links; plus a manual research playbook.
- **Website Auditor** — opens a lead's public page and reports only what it can actually see
  (no viewport, no booking path, lorem ipsum still live, dollar prices, a `tel:` link that dials
  the wrong number, images hot-linked from another site) — every finding with screenshot-able evidence.
- **Follow-up engine** — day 3 / day 7 cadence after you mark a message sent, with the exact text
  and a "who is due" queue. Nothing is ever sent for you.
- **Daily scheduler** — one tick a minute; at 09:00 Asia/Kolkata it builds the brief + follow-up
  queue and tells **you** on Telegram. It can only address the owner's chat id, never a client.
- **Work** — tasks with owners, priorities, deadlines, blocked reasons.
- **Calendar** — deadlines, follow-ups and approvals in one agenda.
- **Reports** — daily log, agent health, model usage.
- **Audit** — every command, decision and blocked action.

Zero dependencies. Runs without any API key (offline rules engine), and upgrades to **Ollama**
(local, private) or **Gemini** when you want richer writing.

```bash
npm start        # → http://localhost:3000
npm run check    # end-to-end self-test (30 checks)
npm test         # unit tests for the rules that must never break
```

---

## What it looks like

```
┌───────────────┬──────────────────────────────────────────────────────────┐
│  DASHBOARD    │  Good evening, Founder.        office health  ●  71      │
│  Console      │  2 drafts waiting · 1 task overdue · 2 follow-ups due    │
│  Approvals ②  │  ┌────────┬────────┬────────┬────────┐                  │
│  Work      5  │  │Awaiting│Pipeline│ Tasks  │Clients │                  │
│  Clients   6  │  │   2    │ ₹75,000│   5    │   6    │                  │
│  Finder    5  │  └────────┴────────┴────────┴────────┘                  │
│  Calendar     │  Focus today ──────────  Pipeline ──────────            │
│  Reports      │  ▸ Approve D-0001         Lead      ₹0                  │
│  Audit        │  ▸ Approve D-0004         Proposal  ₹30,000            │
│               │  ▸ Send proposal          Negotiation ₹45,000           │
└───────────────┴──────────────────────────────────────────────────────────┘
```

Dark obsidian glass, violet→cyan accents, ⌘K command palette, client drawer, kanban, charts.

## Commands

| Command | What happens |
| --- | --- |
| `/task <request>` | 1–5 validated tasks with priority + owner |
| `/draft <request>` | one draft + QA notes, saved as *Awaiting approval* |
| `/brief` | morning brief: focus, waiting on you, money, one suggestion |
| `/report` | daily summary from stored rows only |
| `/approve D-0001` | records the decision — you still publish manually |
| `/revise D-0001 <feedback>` | new version, gated again |
| `/reject D-0001 <reason>` | records the reason |
| `/find cafés in Pune` | Client Finder research plan (queries, directories, checklist) |
| `/source cafés in Pune` | **live search** — real businesses with real source URLs |
| `/lead niche \| city \| source URL \| notes` | lead rows with source URLs + fit score |
| `/verify L-0001` | mark a lead checked by a human |
| `/promote L-0001` | turn a lead into a client record |
| `/stage C-0002 Negotiation` | move a client (or lead) pipeline stage |
| `/outreach L-0001` | gated outreach draft, never sent |
| `/proposal C-0002` | gated proposal draft with price placeholders |
| `/clients` | pipeline summary |
| `/done` · `/progress` · `/block T-0001` | task status |
| `/status`, `/help` | counters, command list |

Plain text without a slash is treated as `/task`. `--platform`, `--tone`, `--audience` flags work on `/draft`.

## Three ways to run

### 1. Office only — zero setup

```bash
npm start
```

Node.js 20+. No `npm install`, no keys. The offline engine plans, drafts, scores leads and
writes briefs with conservative rules: no invented deadlines, prices, statistics or contacts.

### 2. With a local model (free, private)

```bash
ollama pull llama3.2
AI_PROVIDER=auto OLLAMA_MODEL=llama3.2 npm start
```

Or copy `.env.example` → `.env`. **Setup → Test connection** shows the live engine.

### 3. Docker (this office only)

```bash
cp .env.example .env      # set OFFICE_ACCESS_CODE, Telegram token, timezone
docker compose up -d      # → office on :3000
```

No n8n container, no workflow imports — the daily brief and follow-up queue are built in
(`src/scheduler.js`). Your data lives in `./data`, mounted into the container.

## How it is built

```
server.js                HTTP server + JSON API (no dependencies)
src/
  office.js              actions + command router + approval gates
  metrics.js             dashboard math: overview, mission, pipeline, agents
  store.js               JSON database, IDs, migrations, demo seed
  sheets.js              sheet tabs + CSV export (Tasks/Drafts/Leads/Daily Log/Clients)
  agents/
    prompts.js           the exact agent prompts from the guide + finder/proposal/brief
    provider.js          Ollama / Gemini resolution, JSON extraction, daily cost cap
    offline.js           deterministic rules engine (always available)
    index.js             agent entry points with validation + fallback
    auditor.js           website auditor + evidence harvester (read-only)
  channels/telegram.js   polling + webhook connector, allow-list
  scheduler.js           daily brief + follow-up queue (replaces n8n)
public/                  the console: HTML, CSS design system, ES-module app
docs/                    guide + v2.1/v2.2 changelogs + your Pune pitch pack
test/                    node --test unit tests with local fixtures
scripts/check.mjs        end-to-end self-check (30 checks)
scripts/backup.mjs       DB + CSV backup with sha256 + freshness report
```

Flow: **command → action → agent (Ollama/Gemini/offline) → validate → store → gate → your decision → audit.**

## API

Everything the UI does is a documented endpoint — `/api/state`, `/api/command`, `/api/tasks`,
`/api/drafts/:id/decision`, `/api/clients`, `/api/leads/:id/promote`, `/api/find`, `/api/brief`,
`/api/report`, CSV exports and more. See [`docs/13-api-reference.md`](docs/13-api-reference.md).

## Safety defaults

- **Allow-list** — unknown Telegram users are refused and logged.
- **Validation** — AI JSON is checked before storage; invalid output falls back to the planner.
- **Approval gate** — no command publishes, messages, spends or deletes.
- **Idempotency** — duplicate commands inside 20 seconds are ignored.
- **Cost cap** — `MAX_MODEL_CALLS_PER_DAY`; the office degrades to offline instead of failing.
- **Audit** — command, actor, reference, timestamp, decision.
- **Semi-automatic by design** — `/approve` records intent; you copy and publish.

Read [`docs/07-security-approvals.md`](docs/07-security-approvals.md) before connecting anything public.

## Verify

```bash
npm run check    # health, task, draft, approval gate, report, leads, clients, proposal, finder, CSV
npm run backup   # data/db.json + five CSVs into backups/<timestamp>/
```

## Configuration

Copy `.env.example` to `.env`. Useful values:

```bash
AI_PROVIDER=auto                 # auto | ollama | gemini | offline
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
MAX_MODEL_CALLS_PER_DAY=200
TELEGRAM_BOT_TOKEN=
ALLOWED_TELEGRAM_USER_IDS=
TELEGRAM_MODE=off               # polling to start the bot
OFFICE_ACCESS_CODE=             # optional header gate for /api/*
```

Docker + Ollama on the host → `http://host.docker.internal:11434` (already configured).

## The one rule

> AI can draft and organise. A human must approve anything public, outbound, financial,
> or irreversible.

Educational prototype. Prices, free tiers and licences change — verify each provider's current
terms before you rely on them.
