# Final deployment checklist

From the last page of the guide, adapted to this repository. Tick every box before you call
the office "live".

## Runtime

- [ ] Office starts with `npm start` and `/healthz` returns `ok: true`
- [ ] `npm run check` passes all checks
- [ ] Docker is running and n8n opens at <http://localhost:5678>
- [ ] Ollama is running and your chosen model is downloaded (`ollama list`)
- [ ] The engine tag in Setup is `ollama` or `gemini` — or you accept `offline` deliberately

## Access and secrets

- [ ] Telegram bot token is stored only in `.env` or the n8n credential store
- [ ] `.env` is **not** committed (`git status` is clean of secrets)
- [ ] Only your Telegram user ID can trigger workflows
- [ ] `OFFICE_ACCESS_CODE` is set if the console is reachable beyond localhost
- [ ] Google OAuth uses the narrowest scope that works
- [ ] `N8N_ENCRYPTION_KEY` is backed up separately from the workflows

## Data

- [ ] Google Sheets OAuth connection is tested with a read node
- [ ] Sheet tabs are named exactly `Tasks`, `Drafts`, `Leads`, `Daily Log`
- [ ] CSV export headers match the sheet headers
- [ ] AI output is validated before writing to Sheets
- [ ] Duplicate protection works (send the same command twice; only one row appears)

## Approvals

- [ ] Every draft requires Approve, Revise or Reject
- [ ] No workflow publishes, messages, spends or deletes without approval
- [ ] Approval records reviewer and timestamp
- [ ] A rejected draft keeps its reason
- [ ] The word "publish" appears nowhere in an automatic node

## Reliability

- [ ] Error workflow sends a Telegram alert
- [ ] Workflow export is saved to a **private** GitHub repository
- [ ] `npm run backup` has produced at least one backup, and it was copied off the machine
- [ ] n8n data volume is included in your backup plan
- [ ] Cost limits are configured: `MAX_MODEL_CALLS_PER_DAY` and provider billing alerts
- [ ] Restart procedure is written down and tested once

## People

- [ ] You know which commands you will use daily
- [ ] Anyone with bot access has read the approval rules
- [ ] A do-not-contact list exists if you do any outreach
- [ ] You know how to revoke the Telegram token and the Google credential

## Go-live test (15 minutes)

1. Send `/task Plan next week's content for my business`.
2. Confirm the tasks in the console **and** in the sheet.
3. Send `/draft Write a LinkedIn post about one of those tasks`.
4. Read the QA notes, then `/revise` once with real feedback.
5. `/approve` the new version. Copy it out; do not publish it yet.
6. Send the same `/draft` twice quickly — confirm only one row was created.
7. Stop the office. Start it again. Confirm the data is intact.
8. Run `npm run backup`.
9. Send `/report` and check the Daily Log row.
10. Check the Audit tab shows every step above.

If all ten pass, you have the prototype from Chapter 7, with the controls from Chapter 9.

## Known limitations of this build

Being explicit is part of a safe deployment:

- The console has no user accounts. It is a single-operator tool; put it behind a private
  network or `OFFICE_ACCESS_CODE` if exposed.
- Google Sheets write-back is manual (CSV export) by design.
- n8n starter workflows need credentials and column mapping after import.
- The offline engine is deterministic and will sound formulaic. That is the price of
  zero-cost, zero-download operation.
- There is no publishing, email, payment or deletion integration — intentionally.
- The audit trail keeps the latest 800 events; export backups for a longer history.

## After go-live

- Review the Audit tab weekly.
- Keep a small evaluation set of requests and re-test prompts after every change.
- Add one capability per week at most.
- Write a short monthly note: what saved time, what cost time, what to remove.
