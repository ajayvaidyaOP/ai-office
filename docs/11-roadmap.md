# Beginner-to-advanced roadmap

Six levels. The rule for every level: **add one capability only after the previous one works
reliably for at least a week.**

| Level | Milestone | What you build | Done when… |
| --- | --- | --- | --- |
| 1 | First automation | Telegram command creates a task in Google Sheets | 10 real tasks created without a manual row |
| 2 | Specialist workflows | Content, quality-check and reporting prompts | every draft has a QA note and a decision |
| 3 | Lead research | public-source lead tracker with verification and dedupe | every lead has a source URL and a review status |
| 4 | CRM and scheduling | connect a CRM and calendar where policies allow | no double-entry between office and CRM |
| 5 | Reliable operations | hosted deployment, monitoring, backups, alerts, cost limits | a week with zero missed days |
| 6 | Advanced agents | evaluation sets, model comparison, retrieval over your documents, controlled tools | you can prove a change is better, not just different |

## Level 1 — first automation

You already have it in this repo.

- `/task` → validated tasks → Tasks tab.
- Run it for a week with real work.
- Learn: commands, IDs, the audit trail, one approval decision.

**Do not** add publishing, email or bulk messaging yet.

## Level 2 — specialist workflows

- Content Agent: hook, message, CTA, platform length.
- Quality Checker: claims, tone, CTA, spam risk.
- Daily reporting: completed, pending, blocked, awaiting approval.
- Build a small test set: five requests you know well. Compare every prompt change against it.

## Level 3 — lead research

- Public sources only; a source URL is mandatory.
- Dedupe by domain and normalised name before inserting.
- Review status starts as *Needs human verification*.
- Add a do-not-contact list now, not later.
- Outreach drafts, never sends.

## Level 4 — CRM and scheduling

- Choose a CRM that has an API and permits your use.
- Map fields deliberately: lead → contact, task → activity.
- Keep the office as the source of truth for approvals; the CRM is the record of relationships.
- Calendar: only create reminders; never auto-book someone without consent.

## Level 5 — reliable operations

- Move to an always-on host (mini PC or small VM).
- Add an error workflow with Telegram alerts.
- Back up nightly; keep one copy off the machine.
- Add a cost cap and a monthly review.
- Write a one-page runbook: how to restart, restore, rotate a token.

## Level 6 — advanced agents

- **Evaluation:** 20–50 labelled examples; score every prompt change.
- **Model comparison:** same inputs, two models, blind review.
- **Retrieval:** index your own documents (briefs, price sheets, past proposals) so drafts
  use *your* facts. Keep sources attached to every claim.
- **Controlled tools:** read-only APIs first; every write tool behind an approval step.
- **Observability:** log tokens, latency, cost per task; alert on anomalies.

## Anti-patterns to avoid

- Building five agents before one works.
- Automating publishing before approval exists.
- Collecting leads you never verify.
- Chasing a bigger model instead of a clearer prompt.
- Adding a tool because it is impressive, not because a task is slow.
- Letting the sheet become a graveyard of "In Progress" rows.

## A realistic 90-day plan

| Week | Focus | Output |
| --- | --- | --- |
| 1 | Level 1 | 10 real tasks through the office |
| 2 | Level 2 | draft + QA + report on real work |
| 3 | Level 2 | prompt tuning against 5 known requests |
| 4 | Review | kill what you did not use |
| 5–6 | Level 3 | 20 verified leads with sources |
| 7 | Level 3 | outreach drafts, sent manually |
| 8 | Review | measure time saved, cost per week |
| 9–10 | Level 5 | always-on host, alerts, backups |
| 11 | Level 4 or 6 | pick **one**: CRM sync or evaluation set |
| 12 | Publish | a short write-up of what worked |

The write-up matters: it forces you to notice what actually saved time.
