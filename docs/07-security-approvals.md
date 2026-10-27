# Security and human approval

Automation becomes dangerous when it can act publicly or irreversibly without supervision.
Build gates **before** connecting publishing, email, payments, deletion or outbound messaging.

## Actions that always need approval

- Publishing to social media, a website or a newsletter.
- Sending any message to a client, lead or customer.
- Making a purchase, changing a subscription, or spending above your limit.
- Deleting rows, files, workflows or accounts.
- Changing credentials, permissions or connected integrations.
- Sending bulk messages or automated follow-ups.

This office has **no** command for any of the above. The absence is the control.

## What is implemented here

| Control | How |
| --- | --- |
| Authorised users only | `ALLOWED_USER_IDS` + `ALLOWED_TELEGRAM_USER_IDS`; unknown senders refused and logged |
| Secret storage | `.env` on the server; the UI only reports *set / not set*, never the value |
| Least privilege | CSV export instead of write-back by default; narrow Google scopes documented |
| Validation | JSON parsed and validated before storage; fallback planner on failure |
| Idempotency | 20-second duplicate window + unique sequential IDs |
| Error handling | clear replies, provider fallback, optional access code |
| Logging | audit rows with action, actor, reference, detail and timestamp |
| Backups | `npm run backup` writes `backups/<timestamp>/` with db + CSVs |
| Cost limits | `MAX_MODEL_CALLS_PER_DAY`, counted per provider per day |
| Review | Audit tab, 200 latest events; reset and settings changes are logged |

## Secrets checklist

- `.env` is git-ignored. Confirm with `git status` before every commit.
- Never paste a token into a workflow node, a sheet cell, a screenshot or a chat message.
- `OFFICE_ACCESS_CODE` adds a required `x-office-code` header on every `/api/*` call — use it
  if the console is reachable from a network you do not fully trust.
- Rotate the Telegram token with @BotFather (`/revoke`) if it leaks, then update `.env`.
- Google OAuth: revoke unused access at <https://myaccount.google.com/permissions>.
- n8n: keep `N8N_ENCRYPTION_KEY` stable and private; back it up separately from workflows.

## Approval message template (Chapter 9)

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

The app produces this automatically, and records `reviewer` and `decisionAt`.

## What "approved" means here

`/approve` writes a decision. It does **not** publish, send or schedule anything. You copy
the text and post it yourself. This is deliberate: until you have a compliant sending
process and explicit permission, every outbound action stays human.

If you later automate publishing, keep these rules:

1. A separate workflow for publishing, never the same one that drafts.
2. An explicit approval record (status = Approved, reviewer, timestamp) as a precondition.
3. A kill switch — a single setting that disables the publishing node.
4. A rate limit and a dry-run mode.
5. Logging of exactly what was published, where, and from which approval.

## Lead-generation ethics (Chapter 8)

- Use only sources you are permitted to access; respect terms, robots directives, rate limits.
- Do not scrape private, gated or login-protected data.
- Do not invent email addresses, phone numbers, revenue, employee counts or client results.
- Deduplicate by website domain and normalised business name before adding a lead.
- Every lead starts as *Needs human verification* and stays that way until you open the source.
- Draft outreach, send manually, and stop immediately if someone asks not to be contacted.
- Keep a "do not contact" list from day one. It is cheaper than an apology.

## Threat model in one page

| Risk | Likelihood | Impact | Control |
| --- | --- | --- | --- |
| Someone finds your bot and burns credits | medium | medium | allow-list + daily cap |
| Token committed to Git | medium | high | `.gitignore`, secret scan before push, rotate |
| Model invents a client fact | high | high | validation + QA + human review + source URLs |
| Duplicate rows from a double-tap | high | low | dedupe window, unique IDs |
| Runaway loop spends money | low | high | `MAX_MODEL_CALLS_PER_DAY` |
| Laptop sleeps, workflows stop | high | low | always-on machine or hosted VM |
| Prompt injection in a web page you paste | medium | high | never paste untrusted pages into a prompt with tool access |
| Deleting the database by accident | medium | high | `npm run backup`, reset requires typing RESET |

## Weekly security routine

- [ ] Check the Audit tab for anything unexpected. Unknown users are `telegram.denied`.
- [ ] Re-run `npm run check`.
- [ ] Export a backup and copy it off the machine.
- [ ] Remove credentials you no longer use.
- [ ] Review the model spend counter against your budget.
- [ ] Test the approval flow with a harmless task.
