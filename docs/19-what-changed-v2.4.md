# v2.4 — from "finds clients" to "runs the deal"

The question that started this: **does this work the way a real one-person office works?**

It did not. Up to the first message the office was honest and complete. After that
it went quiet. Four hand-offs were missing, and all four were reproduced on a
clean database before anything was changed.

The test for every fix below: create the lead, send the message, promote, approve
the proposal, and see whether the app still knows what to do next **without being
told**.

---

## 1. Promoting a lead killed the chase

`/promote` set `nextFollowUp = null` and never wrote anything the follow-up queue
could measure from. So the moment a lead became a client, the day-3 and day-7
chase stopped existing — for the one deal in the whole pipeline that was actually
worth chasing.

**Now:** the send history (`sentAt`, `channel`) is carried onto the client record,
so the app knows you already messaged them. `lastTouchAt` is deliberately **not**
carried, because the client clock measures a *proposal*, and copying a DM date
would start a chase for a proposal nobody wrote.

## 2. Approving a proposal changed nothing else

A draft said `Approved` while its client sat at `Lead` forever. The board never
showed that a proposal existed, and nothing was ever due.

**Now:** approving a **proposal draft** moves the client from `Lead` to
`Proposal sent` and writes an audit row. Approving is still not sending — that
line has not moved. `proposalSentAt` stays empty until you say it went out.

## 3. `proposalSentAt` was read but never written

`metrics.js` measured the client follow-up queue from `client.proposalSentAt`, and
no code path in the whole repo ever set it. Dead branch: the client chase could
never fire.

**Now:** `/sent C-0005` marks the proposal as actually sent and sets the date.
`/sent L-0007` still marks the first DM. One verb, two halves of the same deal:

```
/sent L-0007   first message to a lead    → starts the day-3 clock
/sent C-0005   proposal to a client       → starts the day-3 clock
```

## 4. Work was not attributable to a client

Every task was anonymous, so "what did I do for Cakecstacy" and "is this retainer
actually profitable" had no answer.

**Now:** a task carries `clientId` and the client's name.

```
/task for C-0005 Make 3 Reels for the weekend menu
```

The id is stripped out of the work description, so the agent plans the work and
not the billing text. Admin work stays legal: no client id, no client.

---

## New: the money half

A client used to have one `value` and no sense of time, so the app could not
answer "who owes me money this month". A retainer fixes that.

```
/retainer C-0005 15000 monthly     → deal Won, first invoice due today
/invoice C-0005                    → log it, roll the date forward
/money                             → retainer total, invoiced, due, open pipeline
```

Three details that matter:

- **The first invoice is due the day the retainer starts**, not a month later.
  Otherwise signing a client today reports "nothing due" and hides the work.
- **Month-end does not drift.** 31 Jan + 1 month is 28/29 Feb, computed in UTC.
- **`/money` says out loud that it does not know whether they paid.** It counts
  invoices you logged. Payment stays outside the app rather than being faked.

The dashboard shows this without a fifth KPI box: the **Clients** card foot
becomes `₹15,000/month on retainer · 1 invoice due` once a retainer exists.

---

## Honesty fixes carried along

| Was | Now |
|---|---|
| `/promote` set the lead `Won` | set `Client` — a new stage, so win rate is not inflated by creating a record |
| Lost count would have caught clients | `Client` is its own stage in `LEAD_STAGES` and in the metrics by-stage breakdown |
| Lead jumped from `Contacted` to nothing | `Client` shows in the UI with its own colour |

## The rule that did not change

**Nothing is ever sent to a client.** Approving, logging an invoice, marking sent —
all of them record something *you* did outside the app. `/money` and `/invoice`
both say so in their own text.

## Still true, still not built

- No payment tracking, deliberately. Invoiced ≠ paid, and the app says that.
- No recurring task templates — a retainer does not yet spawn "3 Reels" every month.
- No delivery checklist per client.
- Profitability needs a cost number on the task, which does not exist yet.
  Attribution is now possible; the maths is not.

## Checks

```
npm test        40 passing  (was 31)
npm run check   39/39
```

Nine new tests, all of them regressions of the four gaps: the history survives
promotion, approval moves the board without faking the send, `/sent C-…` makes
the chase due, month-end maths holds, a task can be billed, and a retainer cannot
be created without an amount or a valid cycle.
