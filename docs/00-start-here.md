# Start here — your AI Digital Office

This repository is a **working, runnable version** of the *Build Your Own AI Digital Office* guide.
It implements the guide's first prototype end to end, plus the pieces you need to grow it:

| Guide chapter | What this repo gives you |
| --- | --- |
| Ch 1 — Understanding an AI digital office | A live office console with a command → plan → draft → approve loop |
| Ch 2 — Plan your office | Six agent roles wired in, each with a human control |
| Ch 3 — Tools and installation | `docker-compose.yml` for n8n, Ollama instructions, Telegram setup |
| Ch 4 — First AI Manager | `src/agents/` with the exact system prompt and JSON validation |
| Ch 5 — Specialist agents | Content, Lead Research, Follow-up, Quality Checker, Daily Reporting |
| Ch 6 — Connect everything | Telegram connector (polling + webhook), Sheets export, API |
| Ch 7 — First working prototype | Works out of the box in **offline mode** — no keys needed |
| Ch 8 — Leads and clients | `/lead`, `/verify`, `/outreach` with source URLs and verification |
| Ch 9 — Human approval and security | Approval gates, allow-list, audit trail, secret hygiene, cost cap |
| Ch 10 — Daily office management | `/report`, Daily Log tab, weekly maintenance checklist |
| Ch 11 — Troubleshooting | See `09-troubleshooting.md` and `npm run check` |
| Ch 12 — Budget and hosting | `10-budget-and-hosting.md` with the INR table |
| Ch 13 — Roadmap | `11-roadmap.md` six levels |
| Ch 14 — Copy-paste resources | Prompts in `05-prompts.md`, sheet templates in `templates/` |

## The one rule

> AI can draft and organise. A human must approve anything public, outbound,
> financial, or irreversible.

Nothing in this office publishes, messages, spends or deletes. `/approve` records your
decision — **you** still copy the text and publish it.

## Two ways to run it

### A. Just the office (fastest)

```bash
npm start          # no dependencies to install
# open http://localhost:3000
```

Works with zero API keys. The deterministic offline engine handles every agent, so you can
learn the workflow before you install anything heavy.

### B. With a real model

```bash
# 1. install Ollama from https://ollama.com/download, then:
ollama pull llama3.2

# 2. start the office
OLLAMA_MODEL=llama3.2 npm start
```

The console will switch from `offline` to `ollama` automatically. Gemini is optional:
add `GEMINI_API_KEY` to `.env`.

### C. With n8n and Docker (the guide's stack)

```bash
cp .env.example .env
docker compose up -d n8n
# n8n on http://localhost:5678, office on http://localhost:3000
```

Then follow `02-install.md` and `06-n8n-workflows.md`.

## First ten minutes

1. Open the Console.
2. Send `/task Plan a beginner-friendly Instagram Reel about free AI tools for small businesses`.
3. Open **Tasks** — you should see structured rows with priority, owner and status.
4. Send `/draft Write a friendly Instagram caption for that Reel`.
5. Read the draft, its Quality Checker notes, then click **Approve**.
6. Send `/report` and check the **Daily Log** tab.
7. Open **Setup → Google Sheets** and download the four CSVs. Import them into a sheet
   named *AI Digital Office* with tabs Tasks, Drafts, Leads, Daily Log.

## What runs where

```
Browser console  ──HTTP──▶  server.js  ──▶  agents (Ollama / Gemini / offline)
     ▲                          │
     └──── /api/state ──────────┤
                                ├──▶ data/db.json      (your office database)
                                └──▶ Telegram connector (optional)
```

Everything is plain Node.js 20+. No framework, no build step, no `node_modules`.
The database is a single JSON file you can copy, inspect and back up.

## Safety defaults

- Telegram users outside the allow-list are refused and logged.
- AI output is validated before it is stored; invalid JSON falls back to the offline planner.
- Duplicate commands within 20 seconds are ignored.
- A hard daily cap (`MAX_MODEL_CALLS_PER_DAY`) stops runaway model spend.
- Every command and decision is written to the audit trail.

Read `07-security-approvals.md` before you connect anything public.
