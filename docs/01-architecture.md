# Architecture — how the office fits together

## The five parts

```
┌──────────────┐   command    ┌──────────────────┐   prompt    ┌─────────────┐
│  Telegram    │ ───────────▶ │   AI Manager     │ ──────────▶ │  AI model   │
│  or Console  │              │  (office router) │ ◀────────── │ Ollama/Gemini│
└──────────────┘              └────────┬─────────┘   JSON      └─────────────┘
        ▲                              │
        │   approval request           ├──▶ Tasks / Drafts / Leads / Daily Log
        │                              │        (data/db.json ⇄ Google Sheets)
        └──────────────────────────────┘
                    your decision
```

| Part | Guide chapter | File |
| --- | --- | --- |
| Command centre (Telegram / web console) | 3, 6 | `src/channels/telegram.js`, `public/app.js` |
| AI Manager and specialist agents | 4, 5 | `src/agents/*` |
| Workflow / routing rules | 6, 7 | `src/office.js` |
| Task database | 4, 8, 14 | `src/store.js`, `src/sheets.js` |
| Approval gates and audit | 9 | `src/office.js`, `src/store.js` |

## Command lifecycle

A `/draft` command is the clearest example:

1. **Intake** — text arrives from the console or Telegram. The sender is checked against
   `ALLOWED_USER_IDS` / `ALLOWED_TELEGRAM_USER_IDS`; unknown senders are refused and audited.
2. **Dedupe** — the same text from the same person inside 20 seconds is ignored (idempotency).
3. **Interpret** — the AI Manager (or the offline planner) turns the request into 1–5 tasks.
4. **Validate** — every task must have a non-empty `task` field, a valid priority, a valid owner.
   Invalid model output is replaced by the offline planner and flagged `needsReview`.
5. **Persist** — rows are appended to `data/db.json` with an ID (`T-0001`, `D-0001`, `L-0001`).
6. **Draft** — the Content Agent writes one draft; the Quality Checker reviews it and returns
   `approve | revise | reject` with issues.
7. **Gate** — the draft is stored as `Awaiting approval` and sent back with three options.
8. **Decision** — `/approve`, `/revise` or `/reject` updates the row, records reviewer and time,
   and appends to the audit trail. `/revise` regenerates a new version that is *again* gated.
9. **Report** — `/report` reads only stored rows; it cannot invent progress.

## Data model

`data/db.json`:

```jsonc
{
  "meta": { "settings": { "provider": "auto", "maxCallsPerDay": 200 } },
  "counters": { "task": 2, "draft": 1, "lead": 1 },
  "tasks": [
    {
      "id": "T-0001", "createdAt": "...", "request": "...", "task": "...",
      "priority": "High", "owner": "Research Agent", "deadline": "",
      "status": "Pending", "notes": "...", "provider": "offline"
    }
  ],
  "drafts": [
    {
      "id": "D-0001", "taskId": "T-0001", "platform": "Instagram",
      "draft": "...", "status": "Awaiting approval", "version": 1,
      "qa": { "decision": "approve", "issues": [] },
      "history": [ { "action": "approve", "actor": "owner", "note": "" } ]
    }
  ],
  "leads": [ { "id": "L-0001", "reviewStatus": "Needs human verification" } ],
  "dailyLog": [ { "date": "2026-10-27", "completed": 2, "pending": 3 } ],
  "audit": [ { "action": "draft.approved", "ref": "D-0001", "actor": "owner" } ],
  "messages": [ { "role": "bot", "text": "...", "buttons": [] } ]
}
```

Design choices worth knowing:

- **Single file, atomic save.** Written to `db.json.tmp` then renamed, so a crash cannot
  leave a half-written database.
- **Audit is append-only (capped).** 800 events retained; oldest fall off.
- **IDs are sequential per type.** Easy to read aloud in Telegram. Duplicate protection is
  handled by the dedupe window plus checking the existing rows before appending.
- **Provider is recorded per row.** You can tell later whether a draft came from Ollama,
  Gemini or the offline engine.

## Provider resolution

`AI_PROVIDER=auto` tries, in order:

1. **Ollama** at `OLLAMA_BASE_URL` (default `http://localhost:11434`). Probed for 2.5 s,
   result cached for 15 s so a stopped Ollama does not slow every command.
2. **Gemini** if `GEMINI_API_KEY` is set. Auth/rate-limit errors pause Gemini for 10 minutes.
3. **Offline rules engine** — always available, deterministic, conservative.

Each successful call increments a per-day counter. At the cap, calls fail fast and the
offline engine takes over — the office keeps working, it just gets less creative.

## Why the offline engine exists

The guide's advice is to get one reliable workflow before adding capability. Offline mode
does three useful things:

- lets you learn and demo the entire approval loop with no cost or downloads;
- gives you a safe fallback when the model is down or over budget;
- gives you a reference output to compare model drafts against.

It is deliberately rule-based: no invented deadlines, no invented contact details, no
statistics, no prices, and every lead marked *Needs human verification*.

## Where n8n fits

n8n is the guide's orchestration tool. You have two clean options:

| Option | Use when |
| --- | --- |
| **This app is the office; n8n calls it** | You want the working prototype now and n8n for scheduling/extras. Add an HTTP Request node → `POST http://host.docker.internal:3000/api/command`. |
| **n8n is the office; this app is the reference** | You want to rebuild the workflow visually, node by node, as in Chapters 6–7. Import the starters in `n8n/workflows/` and follow `06-n8n-workflows.md`. |

Either way the data contract is the same: Tasks / Drafts / Leads / Daily Log with the
columns in `src/sheets.js`.
