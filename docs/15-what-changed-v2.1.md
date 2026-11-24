# What changed — v2.1 (auditor, follow-ups, honest scoring)

Written 24 November 2026. Everything here was verified by running it, not by reading it.
The v2.0 office was a good **assistant**. These changes make it do the two jobs that
actually earn money: **prove the problem** and **remember to follow up**.

---

## 1. Security: the access code no longer breaks the dashboard

**Before:** `OFFICE_ACCESS_CODE` made every `/api/*` call return 401, but `public/app.js`
never sent the header. Setting a code = permanently dead console.
The comparison was also a plain `!==`.

**Now**
- `GET /api/auth` → `{ required: true|false }` (public, tells the UI whether to ask).
- `POST /api/auth/login` → verifies the code, constant-time (`crypto.timingSafeEqual`).
- The browser stores the code in `localStorage` and sends `x-office-code` on every call.
- On a 401 the UI shows a **lock screen** and unlocks in place — no reload, no dead page.
- Failed logins are written to the audit trail (`auth.failed`).

Verified live with `OFFICE_ACCESS_CODE=punE2026`:

| request | result |
| --- | --- |
| `/api/state` no header | `401` |
| `/api/state` wrong code | `401` |
| `/api/state` right code | `200` |
| `/api/auth/login` wrong / right | `401` / `200` |
| `index.html` | `200` (shell must load so the lock can render) |
| `/api/reset` unauthenticated | `401` |

---

## 2. Lead scoring was backwards — fixed

**Before:** `scoreLead` gave **+14 for having a website**. You sell websites, so your best
prospect (broken or absent site) scored *lowest*. Every row also scored ~79 because the
formula rewarded form-filling, not buying intent.

**Now** the score has two halves:

1. **Reachability (max ~55)** — public source, phone published, human verified.
2. **Opportunity (max 45)** — driven by what the auditor actually found:
   `high = +45`, `medium = +28`, `low = +8`, `none = 0`.
   A lead with **no website at all** gets `+32` because there is nothing to audit.

Locked in by tests (`test/auditor.test.mjs`):
> a broken site must score higher than a perfect one, and "no website" must beat both.

---

## 3. New agent: Website Auditor (`src/agents/auditor.js`)

The office now opens a lead's page and reports **only what it can see**, with evidence
you can screenshot.

**Checks**

| Check | Severity | Evidence produced |
| --- | --- | --- |
| Site unreachable / HTTP 4xx-5xx | high | status code + URL |
| No `<meta viewport>` | high | "no viewport tag in the head" |
| No phone / WhatsApp / email / form anywhere | high | link counts (0 tel:, 0 wa.me, 0 form) |
| Placeholder copy live ("lorem ipsum", "dummy text") | high | the matched phrase |
| `tel:` link that is not an Indian number | high | the actual `href` |
| http:// only (no SSL) | medium | fetched URL |
| No booking / order step | medium | "contact links exist but no form or booking flow" |
| Prices in $ with no ₹ | medium | the matched dollar amounts |
| Images hot-linked from another domain | medium | the foreign hosts |
| No `<title>` / no meta description | medium / low | — |
| Heavy HTML | medium | KB, marked **UNVERIFIED** for real mobile speed |

**Ethics built in**
- One request per page, 8 s timeout, 400 KB cap, identifiable user-agent.
- Read-only: it never submits a form, never posts, never messages.
- If a page cannot be loaded, the finding is **"site did not open"**, not an invented defect.
- 250 ms gap between leads in a batch; batches are capped (default 5, max 20).

**Commands / API**
```
/audit L-0007          audit one lead, print every finding + evidence
/audit-all 5           audit the next 5 unaudited leads
POST /api/audit        { id } | { limit, onlyUnverified }
```

**Proven with local fixtures** (`test/fixtures/`), because the build sandbox has no
internet. The broken fixture (`broken.html`) correctly returns 8 findings including
no viewport, lorem ipsum, dollar prices, hot-linked images and a US `tel:` link. The clean
fixture returns only the one real defect (http-only). A 404 page reports the error and
does **not** pretend to have inspected HTML that never loaded.

---

## 4. Outreach now uses the evidence

`offlineOutreach` was a generic template ("a calmer way to keep content flowing").
It now writes from the audit:

```
Hi Zyka Tales — I opened zykatales.com today and prices are in dollars, not rupees.
A customer ready to place an order stops there and goes to the next option.
I also saw unfinished template text is live on the page.
I can fix that one step and test it on a phone, free, before you decide anything.
Want me to send a 30-second recording of it?
```

Rules it enforces: real business name, one specific problem, plain-language cost, one
quick win, **no price**, soft yes/no question, ≤ 90 words. With no audit it *asks*
("could not find a clear way to book or order") instead of asserting a defect.

---

## 5. Revision no longer glues feedback into the message

**Before:** `/revise D-0005 make it shorter` produced
`"...no phone published Hi Posh Paws — I tried booking..."` — the note was appended to the
body and would have been sent to a real business.

**Now** feedback travels as an instruction: `runOutreach` / `runContent` / `runProposal`
receive `feedback` + `previousDraft` and are told to rewrite, never append. `markLeadSent`
will refuse a lead that a human has not verified.

Test: `revision feedback is an instruction, never body text`.
Live check: revised draft came back 56 words, shorter, with **no** trace of the feedback.

---

## 6. Follow-up engine (day 3 / day 7)

The office now closes the loop between *approved* and *sent*.

```
/sent L-0007               you actually pasted and sent it → starts the clock
/followups                 who is due, at which step, with the exact text
/followup-sent L-0007 3    you sent it by hand → next step scheduled
GET  /api/followups        the same queue for the UI
```

- Day 3: *"quick one — did my note reach you? Happy to send the fix notes either way."*
- Day 7: *"last message from me on this… reply A or B and I will stop following up."*
- Cadence configurable (`FOLLOWUP_DAYS_1=3`, `FOLLOWUP_DAYS_2=7`).
- Marking a lead sent **requires** `reviewStatus === 'Verified by human'` — this is how the
  approval gate survives into the real world.

Verified by backdating a real lead 7 days: `/followups` produced one day-3 entry with the
correct text and due date; marking it sent moved the record and scheduled day 7.

---

## 7. Scheduler: the office shows up on its own

`src/scheduler.js` — one tick a minute, no dependencies, no cron.

At `SCHEDULER_HOUR:SCHEDULER_MINUTE` in `Asia/Kolkata` it runs **once per day**:
1. builds the morning brief (stored, so the dashboard shows it),
2. builds the follow-up queue,
3. sends both to **you** on Telegram via `notifyOwner()`.

`notifyOwner()` can only send to `TELEGRAM_OWNER_CHAT_ID` — the chat id comes from config,
never from a lead record, so the scheduler **cannot** message a client.

Manual trigger: `POST /api/scheduler/run` → returns `{ followUps, notified, notes, brief }`.
Verified: `notes: ['brief generated', '1 follow-up(s) due', 'telegram: no TELEGRAM_BOT_TOKEN configured']` —
it degrades honestly instead of silently doing nothing.

---

## 8. `reset` can no longer destroy your data by accident

**Found while testing this very session:** `POST /api/reset` with an empty body wiped
15 leads and 4 clients. I triggered it myself with a stray command.

**Now** it refuses unless the body says so:
```json
{ "confirm": "DELETE EVERYTHING" }
```
The refusal returns your current counts so you can see what was almost lost, and the
successful reset writes `office.reset` with how many records were deleted.

---

## 9. Tests (`npm test`)

13 tests, `node --test`, zero dependencies, throwaway `DATA_DIR` so they never touch your
data. They lock in the four rules that matter:

1. an audit may only report what it saw,
2. a broken presence must outscore a perfect one,
3. revision feedback must never reach a message body,
4. a message never contains a price.

```
$ npm test
# tests 13   # pass 13   # fail 0
$ npm run check
30/30 checks passed.
```

---

## 10. UI additions

- **Lock screen** — appears only when a code is set; "Forget code" to re-enter.
- **Website audit panel** (Client Finder) — "Audit next 5 unaudited leads", per-lead
  findings with evidence, and Re-audit / Draft outreach / Mark sent buttons.
- **Follow-ups due panel** — day 3 / day 7 cards with *Copy message* and *Mark sent*.
- New styles are additive; nothing existing was restyled.

---

## What is still NOT done (so nobody is surprised)

| Gap | Why it is still open |
| --- | --- |
| Real mobile speed (Lighthouse) | needs a headless browser; findings are marked UNVERIFIED instead of guessed |
| Auto-send to clients | deliberately refused — that is the product's whole promise |
| SQLite | still `data/db.json`; fine to a few thousand leads, revisit after that |
| Multi-user / roles | `actor` is still a label, not an identity |
| Screenshot of the broken page | text evidence only; a screenshot service would make the pitch stronger |
| Deprecated: `summarise` unused warning | harmless; kept for the CRON-style summary path |
