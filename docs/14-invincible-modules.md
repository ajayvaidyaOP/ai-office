# The Invincible modules

The guide builds the approval loop. This repo adds the modules a working office actually
needs: a dashboard, a manager, a client finder, a CRM, proposals, a calendar and reports.

Everything below still obeys the one rule: **drafts are created, decisions are recorded,
nothing is sent.**

---

## 1. Dashboard

`GET /api/state → dashboard`

| Block | What it shows | Where the numbers come from |
| --- | --- | --- |
| Office health | 8–98 score with the reasons underneath | approvals, overdue tasks, verified leads, weekly target |
| Hero focus | greeting + the top blockers in plain language | mission list |
| KPIs | awaiting approvals, open pipeline, open tasks, clients | `metrics.overview()` |
| Focus today | ranked list: approvals → overdue → due today → follow-ups → verification | `missionToday()` |
| Pipeline | value per stage with win rate, average deal, monthly target | client records |
| Approval queue | the newest waiting drafts with inline approve | drafts |
| Activity | 14-day agent runs and drafts | `runs` + `drafts` |
| Follow-ups | clients and leads due now | `nextFollowUp` fields |
| Team | the eight agents and their run counts | `runs` |

The mission list is deterministic. A task only appears because it is overdue, due today, an
approval, a due follow-up, or an unverified lead — never because a model "felt" it was urgent.

---

## 2. AI Manager (console + `/brief`)

The console routes every command through `src/office.js`. Free text becomes `/task`.

`/brief` is the chief-of-staff agent: it receives *only* the computed context (mission,
approvals, pipeline, follow-ups) and returns:

```
☀️ INVINCIBLE BRIEF — 2026-10-28

Focus:
   1. Approve D-0001 — Reel caption — Instagram draft waiting since 2026-10-26
   2. Send proposal to GreenLeaf Café — overdue by 1 day
   3. Research 5 free AI tools — high priority, no deadline set

Waiting on you:
   • 2 drafts awaiting approval
   • 1 task overdue

Money:
   • Open pipeline ₹75,000 across 2 live deal(s)
   • Won this cycle ₹85,000 · 50% win rate

One suggestion:
   Clear the approval queue first — drafts do not earn anything sitting still.
```

Offline version is rule-based; with Ollama/Gemini the same context is written more naturally.
Either way it **cannot invent progress**, because it is given no other data.

---

## 3. Client Finder

Two modes. **Live search** fetches real businesses from a public dataset.
**Research plan** gives you the manual playbook when you want to do it by hand.

### 3a. Live search — real businesses, real sources

`POST /api/source { niche, location, limit, provider }`

| Provider | Cost | Needs a key | What you get |
| --- | --- | --- | --- |
| `osm` (default) | free | no | Business name, address, website, phone, opening hours, map link |
| `places` | paid per request | `GOOGLE_PLACES_API_KEY` | The above + rating, review count, live business status |

`provider: "auto"` picks Places when a key exists and OpenStreetMap otherwise.

**What actually happens**

1. The city name is geocoded (Nominatim) to a bounding box.
2. The niche is mapped to map tags — `cafes` → `amenity=cafe`, `dentists` →
   `amenity=dentist`, `gyms` → `leisure=fitness_centre`, and 20 more.
3. Businesses are fetched inside that box.
4. Rows without a name are dropped. Duplicate names are collapsed.
5. Every row is scored for **sales fit** (below), best first.

**Nothing is invented here.** Each row carries the exact URL it came from —
`openstreetmap.org/node/123` or a Google Maps link. If the upstream service is
unreachable, the call fails with a plain message. It never fills the gap with
plausible-looking fake businesses.

**The sales-fit score** — the point is to rank who to contact first:

| Signal | Points | Why |
| --- | --- | --- |
| No website | **+20** | Strongest pitch: they are invisible online |
| Phone published | **+10** | You can actually reach them |
| No phone | **−6** | An unreachable lead is a dead lead |
| 4.4★ or better | +14 | Customers like it — the offer lands |
| 200+ reviews | +14 | Established and busy |
| 50+ reviews | +11 | Active customer base |
| Opening hours published | +4 | Probably still operating |
| Address present | +3 | Verifiable |

So a 4.6★ business with 300 reviews, a phone number and **no website** scores
~81 — that is your first call. A business with a polished website and no
reviews scores ~39.

### 3b. Importing

`POST /api/source/import { niche, location, businesses[] }`

Tick the rows you want in the UI, then **Add selected as leads**.

- Rows are written with their **real** fields — nothing is regenerated.
- Every row lands as **"Needs human verification"**. A dataset cannot tell you
  the shop is still open, or that the owner is the decision maker.
- A business already saved (same name + city, or same website) is **refused**
  and reported back, so you never contact the same lead twice.
- Each import is written to the audit trail.

### 3c. Research plan (manual mode)

`POST /api/find { niche, location, notes }`

Returns a research plan, never a list of invented businesses:

- `summary` — where the best-fit clients probably are
- `queries` — 6–8 copy-pasteable searches (includes a city-specific and a `site:` variant)
- `directories` — maps, marketplaces, associations worth checking
- `checklist` — how to verify a business is real and relevant
- `red_flags` — signals this is a waste of time

Then you add rows with `/lead`, the finder form, or the live import. Each row stores:

| Field | Rule |
| --- | --- |
| `businessName` | from what you saw, not from the model's imagination |
| `sourceUrl` | **mandatory** — a lead without a source is rejected |
| `fitReason` | your observation, one specific sentence |
| `reviewStatus` | starts as *Needs human verification* |
| `stage` | New → Verified → Contacted → Replied → Won / Lost |
| `score` | 0–98 fit score with the reasons attached |

### Fit score

| Signal | Points |
| --- | --- |
| public source URL | +18 |
| website found | +14 |
| specific fit reason (20+ chars) | +12 |
| niche known | +8 |
| location known | +5 |
| verified by a human | +20 |
| already in conversation | +6 |
| notes present | +4 |
| missing source | −10 |
| marked lost | capped at 25 |

Base 18, clamped 4–98. The score is a prioritisation aid, never a reason to skip verification.

---

## 4. Clients CRM

`POST /api/clients`, `/api/clients/:id/stage`, `/api/clients/:id/notes`,
`/api/clients/:id/proposal`, `/api/clients/:id/followup`, `/api/leads/:id/promote`

- **Kanban** by stage: Lead → Proposal sent → Negotiation → Won (Lost kept visible).
- **Deal value** per client feeds the pipeline and win-rate numbers.
- **Drawer** with stage stepper, contact details, editable notes, proposals and follow-up date.
- **Promote** converts a verified lead into a client in one step and links both records.
- **Proposal** creates a *gated draft*, never an email.

Proposal prompt rules: no invented case studies, results, discounts or deadlines. The price is
either the deal value you typed or `[PRICE TBC]`, and anything uncertain is marked `[CONFIRM]`.

---

## 5. Calendar

Computed from real fields, not a separate database:

- task `deadline`
- client / lead `nextFollowUp`
- awaiting drafts (dated when created)

Rendered as a 21-day agenda with an overdue panel and a "waiting on you" panel. Set a
follow-up from the client drawer or `/follow C-0001 2026-11-02`.

---

## 6. Reports

| Tab | Contents |
| --- | --- |
| Daily log | one row per day: completed, pending, blocked, awaiting + the report text |
| Agent health | runs, success rate, average ms, engine, last run per agent |
| Model usage | calls per day per provider against the cap |

Agent runs are recorded automatically by `store.recordRun()` inside every agent call, so the
table is evidence, not a claim.

---

## 7. Audit and approvals

Every action writes an audit row: `task.created`, `draft.approved`, `lead.promoted`,
`client.stage`, `finder.plan`, `office.reset`… The Audit page shows the latest 200 with actor,
reference and level.

Draft kinds share one gate:

| Kind | Created by | Approval meaning |
| --- | --- | --- |
| `content` | `/draft`, Content Agent | you may publish it |
| `outreach` | `/outreach`, Outreach Agent | you may send it |
| `proposal` | `/proposal`, Proposal Agent | you may send the document |

Approve does **not** publish. It records reviewer + timestamp so the audit trail can answer
"who approved this, and when".

---

## 8. Design system

- **Tokens** — one file (`public/styles.css`), CSS variables for colour, radius, shadow, motion.
- **Type scale** — 10 / 11.5 / 12.5 / 14 / 19 / 26 / 32, tight tracking on numbers.
- **Colour as intent** — amber = waiting on you, lime = good/approved, rose = blocked/overdue,
  violet = AI and drafts, cyan = in-progress and time.
- **Surfaces** — glass cards on an obsidian gradient with a faint grid; one accent gradient
  (`violet → cyan`) reserved for primary actions.
- **Motion** — 160–340 ms, `cubic-bezier(.22,.8,.3,1)`; respects `prefers-reduced-motion`.
- **Keyboard** — `⌘K` / `Ctrl+K` palette, `↑ ↓ ↵` navigation, `Esc` to close.
- **Responsive** — sidebar becomes a bottom bar under 940 px; kanban collapses to one column;
  tables hide non-essential columns under 620 px.

Adding a screen: copy a `<section class="view" data-view="…">` block, add it to `PAGES` in
`public/app.js`, and add a `render*()` call in `renderAll()`.
