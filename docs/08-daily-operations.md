# Daily operations — run it like a small team

A short morning brief, a review session for drafts and leads, an end-of-day summary.
The whole point is to remove coordination work, not to add a second job.

## The daily routine (Chapter 10)

| Time | Action | Tool |
| --- | --- | --- |
| Morning | Send `/report`, review priorities | Telegram / Console + Sheets |
| Morning | Approve, revise or reject drafts | Console → Drafts |
| Midday | Review new leads, verify sources | Console → Leads |
| Afternoon | Do the priority work (AI drafts help) | Your choice |
| Evening | `/report` again, mark finished work `/done` | Console + Sheets |
| Weekly | Back up, review errors, prune duplicates | n8n + GitHub + `npm run backup` |

## Morning, 5 minutes

1. `/report` — read the three priorities. If they are wrong, fix the task rows, not the AI.
2. Open **Drafts**. For each one:
   - read the Quality Checker notes first;
   - `/approve` only if you would put your name on it;
   - `/revise <feedback>` when it is close;
   - `/reject <reason>` when it misses the point — reasons improve future prompts.
3. Open **Leads**. New rows are *Needs human verification*. Open each source URL, then
   `/verify L-0001` if the business is real and relevant.

## Working with drafts

- One draft = one decision. Do not batch-approve without reading.
- Keep feedback specific: "shorter, more conversational, drop the statistic" beats "make it better".
- Revisions create a new version; the old one is kept with its decision in history.
- Approved text still needs to be copied and published manually. Set a 60-second timer for
  fact-checking before you post.

## Lead hygiene

- Deduplicate by domain and normalised business name before adding.
- One niche and one location per `/lead` request keeps the model focused.
- If a lead has no source URL, it does not exist.
- Keep a do-not-contact list; honour it immediately.
- Do not let a week pass with 40 unverified leads. Ten verified beats forty guesses.

## Evening, 3 minutes

1. `/done T-000x` for finished work, `/block T-000x reason` for stuck work.
2. `/report` — the Daily Log row for the day is written or replaced.
3. Check the **Audit** tab if anything felt off.

## Weekly maintenance checklist

- [ ] `npm run backup` and copy the folder off the machine.
- [ ] Export workflows from n8n and commit them to a **private** repo.
- [ ] Check n8n execution logs for failed runs.
- [ ] Review Telegram bot access; remove anyone who no longer needs it.
- [ ] Scan Sheets for duplicate tasks or leads.
- [ ] Review model quality; adjust one prompt at a time.
- [ ] Check API usage and cost dashboards.
- [ ] Test the approval flow with a harmless example task.
- [ ] Update the status column — no task should sit "In Progress" for two weeks.

## Weekly review questions

1. Which command did I use most? (Audit trail answers this.)
2. Which drafts did I always revise? That prompt needs work.
3. Which leads did I never verify? Stop collecting that source.
4. Where did the office save me time this week — and where did it cost me time?
5. What is the one capability to add next? (See `11-roadmap.md` — one level at a time.)

## Signs the office is working

- You spend less time deciding *what* to do and more time doing it.
- Drafts need fewer revisions over time because the prompts improved.
- You catch a bad claim **before** publishing because QA flagged it.
- You have a written trail of what was decided, by whom, and when.

## Signs to slow down

- You approve drafts without reading them.
- Lead rows are piling up unverified.
- You cannot explain why a task exists.
- Model spend is rising while output quality is flat.

When any of these appear, go back to Level 1 behaviour: one command, one review, one decision
at a time.
