# v2.3 — "My Team", realtime, and buttons that explain themselves

You asked three fair questions. This release answers them in code, not in a doc.

> "mere employee nah dikhte yaha" · "kon kya kam krra kch pta nh" · "itne sare buttons kis kam ke"

---

## 1. You could not see your employees → now there is a **My Team** page

Before: the only trace of the eight agents was a "runs · ok%" chip on the dashboard,
and the Reports tab buried the real numbers three clicks deep. Nothing told you what
an agent was *holding* or what it was *waiting on you* for.

Now: **My Team** in the sidebar, one card per agent, built from stored facts only.

Each card shows:

| Field | What it means |
|---|---|
| status dot | green = worked, amber = worked on local rules, red = failed, grey = never used |
| Doing now | the actual drafts / leads / tasks in its hands, named |
| Waiting on you | work that cannot move until you approve or verify |
| runs · ok% · finished | real counts from the run log |
| idle | "ran today", "ran yesterday", "idle 4 days", **"never run"** |

Below the cards: **"What the team still needs from you"** — every approval, unverified
lead and untouched audit, each with an *open* button that jumps to the right screen.

### The bug that made your team look broken

Every agent call that fell back to the built-in offline engine was recorded as a
**failure**. So the Client Finder showed **0% success** and Quality showed **33%**, even
though both had completed the work. That was a reporting lie, not a working system.

Fixed in three places:

- `src/agents/index.js` — a provider miss now records `ok: true, fallback: true` with the
  note `offline fallback — …`. Real errors (`model returned garbage`, a page that 500s)
  still record `ok: false`.
- `src/store.js` — old rows are relabelled **once, at load**, in place. Nothing is deleted:
  `[store] Relabelled 6 run(s) that fell back to the offline engine.`
- `src/team.js` — `repairLegacyRuns()` holds that rule, and it has its own tests.

Result on your data: finder **0% → 100%**, content **67% → 100%**, quality **33% → 67%**,
and the one genuine error is still visible as a red row.

---

## 2. "Will it work in realtime?" → yes, it is a live stream now

Before: the browser polled `/api/state` every 30 seconds. Approve something from
Telegram and the console could sit stale for half a minute.

Now: `GET /api/stream` is a Server-Sent Events channel.

- `src/store.js` — `store.onChange()` fires on every write, coalesced to one notification
  per 60 ms so a single command cannot spam the client.
- `server.js` — `/api/stream` sends `hello` on connect, a `state` event per write, and a
  `: ping` comment every 25 s so proxies do not drop an idle connection. It is gated by
  the same `authorised()` check as `/api/state`; the code may arrive as `?code=` because
  EventSource cannot set headers.
- `public/app.js` — `startLiveStream()` repaints **only the view you are looking at**, and
  skips the repaint while `ui.busy` so a live update never wipes a form you are typing in.

The 30-second poll **stays** as a fallback, and the new pill in the top bar tells you
which one you are on — the light is green only while the stream is genuinely open:

- **live** (green) — SSE connected
- **connecting** (amber) — opening
- **polling** (rose) — the stream failed, so you are on the 30 s timer

Verified by the self-check: it opens the stream, runs a command, and asserts a `state`
event arrives (`Live stream pushes state after a write`).

**Honest limits.** The scheduler runs in-process, so the brief fires at 09:00 only while
`npm start` is running. The stream is one-way (server → browser); commands still go over
normal POSTs. And if you put this behind a proxy that buffers responses, SSE degrades to
the poll — the pill will say `polling` when that happens.

---

## 3. "Itne sare buttons kis kam ke" → 58 buttons, now explained in place

The audit found 11 screens and 58 buttons with no explanation anywhere. Two real problems
behind the feeling of clutter:

**a) The Client Finder was five panels stacked on one page** — find, pipeline, live search,
audit, follow-ups, manual entry, all at once. Now it is four numbered steps:

`1 · Find` → `2 · Leads` (pipeline + live search) → `3 · Audit` (audit + follow-ups) →
`4 · Add manually`

Each step has a one-line hint saying what it is for, and the tab shows the live counts.

**b) Nothing told you what a screen wanted from you.** Now there is a **`?` button** in the
top bar (and the `?` key) that opens a plain-language panel for the current page:

- what the page is for, in one sentence
- the 2–4 buttons that matter and what each does
- one **"Watch out"** line — the mistake that actually costs you

Example, Approvals: *"Approve means 'I checked this', not 'publish this'."*

Two duplicate element IDs were also found and fixed (`followup-list`, `audit-count` were
each used twice, so one of them was silently rendering into the wrong panel).

---

## Also fixed in this release

- **Failed audits were still scored.** Five leads carried `reachable: false` audits from a
  network-less run; the credibility guard ignored them for scoring but they were still
  stored and shown as `high` severity. They are now cleared, and the backup tells the
  truth: **0 audited**, not 5.
- `meta.lastBackupAt` was read by the deployment checklist but the server never sent it —
  the backup row always said "No backup yet" even after a successful backup.
- `npm run backup` no longer reports a phantom "5 audited".

---

## Verified

```
npm test        → 23/23   (was 17; +6 for the team view and history repair)
npm run check   → 34/34   (was 30; +4 for team payload, honest ok-rate, live stream, console)
npm run backup  → backups/2026-11-24T14-46-15 · 76 KB · sha256 71d05bc290395b09…
live store      → 25 leads · 0 audited · 4 clients · 6 tasks · 5 drafts
```

## What is still not done — no dressing up

| Missing | Why it is still missing |
|---|---|
| Real audits of the 20 Pune leads | this sandbox has no outbound internet. Run `/audit-all 20` on your machine. |
| A real screenshot as proof | no headless browser here. `/evidence <lead>` is the shipped substitute. |
| SQLite | still `data/db.json`. Fine for one user, not for two. |
| Real user roles | `actor` is a label, not a login. The access code is one shared password. |
| Auto-send to clients | refused on purpose. The approval gate is the product. |

---

# v2.3.1 — clutter pass

Your words: *"bahot hi kich kich lgra hai"*. Fair. Here is exactly what was on screen
before, and what is on screen now.

## Panels visible before you click anything

| Page | v2.3 | v2.3.1 | What changed |
|---|---|---|---|
| Dashboard | 6 panels | **1 + fold** | approvals, follow-ups and the agent list were three boxes saying the same thing as the task list. One ranked list now, rest folded. |
| Setup | 5 panels | **1 + fold** | "Is this office ready?" is what you open it for. Everything you touch once moved into a fold. |
| Calendar | 3 panels | **1 + fold** | the agenda includes overdue; the two side lists are detail now. |
| My Team | 8 cards | **8 rows** | eight equal cards was a wall. Same facts as a list you scan in one pass; click a row for detail. |
| Client Finder | 5 panels | **2 per step** | already tabbed in v2.3, now with per-pane counting enforced by the self-check. |

## Sidebar

12 flat items → 12 items in **4 named groups**: *Do the work · Find clients · Know what is
happening · Set up once*. The duplicate Setup/Guide links at the bottom were removed
(they were in the nav already). On a phone the bottom bar now shows the six used daily
instead of squeezing twelve.

## Two behaviour fixes hiding in the noise

- **"Clear my queue"** always jumped to Approvals, even when the top item was an overdue
  task or a lead needing verification. It now reads the top of the ranked list and goes
  where the work actually is.
- Clicking an approval on the dashboard used to open the Approvals tab and leave you to
  find the draft. It now scrolls to that exact draft and flashes it.

## A guard so it cannot creep back

Four new self-check assertions, so the next feature cannot quietly add a sixth panel:

```
✅ No page opens with more than three panels
✅ No page shows more than eight buttons at once
✅ Sidebar stays at a readable size                    12 items in 4 groups
✅ The dashboard no longer repeats the same data in three boxes

38/38 checks passed
```

The density check counts **per pane** on tabbed pages, so Client Finder is measured by
its busiest single step, not the sum of all four.

`npm test` 23/23 · `npm run check` 38/38.
