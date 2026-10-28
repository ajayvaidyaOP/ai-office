# n8n workflows — build order and starters

n8n is a chain of nodes. Each node does one job: receive a message, call a model,
validate data, write a row, send an update (Chapter 6).

## What is in `n8n/workflows/`

| File | Purpose | Nodes |
| --- | --- | --- |
| `01-ai-manager.json` | Telegram `/task` → Ollama → validate → Sheets Tasks → confirm | 8 |
| `02-daily-report.json` | Schedule 09:00 Mon–Sat → `/report` on this office → Telegram | 6 |
| `03-content-approval.json` | Telegram `/draft` → Ollama content → QA → Sheets Drafts → approval message | 8 |
| `04-record-decision.json` | `/approve`, `/revise`, `/reject` → update Drafts row → confirm | 6 |

> These are **starter exports**, not magic. n8n workflow JSON changes between versions,
> so after importing: open each node, confirm the parameters, then attach your credentials.
> The guide says the same thing: build in the editor and use n8n's own export for a
> version-compatible file.

## Import

1. n8n → **Workflows → Add workflow → ⋯ → Import from File**.
2. Pick `01-ai-manager.json`.
3. Open **Telegram Trigger** → Credential → *Create new* → paste the @BotFather token.
4. Open **AI Manager (Ollama)** and check:
   - URL `http://host.docker.internal:11434/api/chat` (Docker) or
     `http://localhost:11434/api/chat` (no Docker)
   - model name matches what `ollama list` shows
5. Open **Append Tasks** → Google Sheets credential → set spreadsheet ID → confirm the
   `Tasks` tab and the column mapping.
6. Replace `111111111` in the *Allow-list & parse* code node with your Telegram user ID.
7. **Save**, then **Test workflow**. Send `/task test plan` to the bot.
8. When it works, activate the workflow.

Repeat for `03` and `04`, then `02` (which only needs a chat ID and the Telegram credential).

## The prototype chain (Chapter 7)

Build it in this order — each step should work before you add the next:

1. **Telegram Trigger** — listens for messages from your bot.
2. **Allow-list** — `IF` or `Code` node comparing `message.from.id` with your ID.
3. **AI Manager** — HTTP Request to Ollama `/api/chat`, or the AI Agent node with an
   Ollama Chat Model sub-node.
4. **Validate JSON** — `Code` node: parse, check `task` is non-empty, clamp priority/owner,
   fall back to "Clarify request with user".
5. **Split Out** — `tasks` → one item per task.
6. **Google Sheets → Append** — Tasks tab, nine columns.
7. **Telegram → Send Message** — "Task received" plus the task list.
8. **Content Agent** — second HTTP Request with the content prompt.
9. **Append Draft** — Drafts tab, status `Awaiting approval`.
10. **Send approval message** — draft plus `/approve`, `/revise`, `/reject` commands.
11. **Decision workflow** — parse the reply, update the Drafts row (match on `Draft ID`).
12. **Error branch** — Settings → Error Workflow → your alert workflow (see below).

## Node-by-node reference

| Node | Type | What it does |
| --- | --- | --- |
| Telegram Trigger | trigger | listens for approved users' messages |
| IF: Command Check | logic | allows only `/task`, `/draft`, `/report` |
| AI Model | HTTP / AI | interprets the command, returns structured JSON |
| JSON Parse / Validate | Code | checks required fields before saving |
| Google Sheets: Append Task | Google Sheets | adds each task as a row |
| Content Agent | HTTP / AI | creates one draft when requested |
| Google Sheets: Append Draft | Google Sheets | stores the draft as `Awaiting approval` |
| Telegram: Send Draft | Telegram | sends the draft with approval options |
| Telegram: Handle Decision | trigger / Switch | records Approve, Revise or Reject |
| Google Sheets: Update Status | Google Sheets | records the final decision |

## Credentials, keys and webhooks

- **API key** — a secret that identifies your app. Treat it like a password.
- **OAuth2** — lets n8n access Google without your password. Grant the narrowest scope.
- **Webhook** — a URL that receives events. Telegram can push updates to it.
- **Environment variable** — configuration outside the workflow (chat ID, model name).
- **Credential store** — n8n's encrypted place for tokens. Never paste tokens into node
  fields, and never export a workflow with credentials attached.

Keep n8n's `N8N_ENCRYPTION_KEY` stable. If it changes, stored credentials become unreadable.

## Ollama URL cheat sheet

| Setup | URL |
| --- | --- |
| n8n in Docker, Ollama on host | `http://host.docker.internal:11434` |
| both on the host | `http://localhost:11434` |
| both containers, same network | `http://ollama:11434` |

On Linux add `extra_hosts: ["host.docker.internal:host-gateway"]` (already in the compose file).

## Test commands

```
/task Plan a beginner-friendly Instagram Reel about free AI tools.
/draft Write a friendly Instagram caption for that Reel.
/approve D-0001
/revise D-0001 Make it shorter and more conversational.
/reject D-0001 Not aligned with our brand voice.
```

Expected: a confirmation in Telegram, a Tasks row, a Drafts row marked *Awaiting approval*,
and after your decision the status becomes *Approved*, *Revision requested* or *Rejected*.

## Error workflow

1. Create a tiny workflow: **Error Trigger → Telegram (send message)**.
2. In every workflow: **Settings → Error Workflow → pick it**.
3. Message template:

```
⚠️ Workflow failed: {{ $json.workflow.name }}
Node: {{ $json.execution.lastNodeExecuted }}
Error: {{ $json.execution.error.message }}
Time: {{ $now }}
```

That single workflow has saved more evenings than any prompt tweak.

## When to split workflows

Start with one workflow and multiple prompts. Split only when:

- a role needs a different trigger (schedule vs Telegram);
- a role grows beyond ~10 nodes;
- different people own different roles;
- you need separate error handling or rate limits.

## Alternative: let this app be the brain

If visual building is not your goal, point n8n at this office:

```
Schedule Trigger → HTTP Request (POST http://host.docker.internal:3000/api/command,
body: {"raw":"/report"}) → Telegram Send Message
```

The workflow stays tiny, and the office keeps the approval logic, validation and audit trail
in one place.
