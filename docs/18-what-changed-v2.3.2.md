# v2.3.2 — the check that found five blank screens

You asked: *"check kar ke de muje sab kuch proper work ho raha ki nahi"*. This is the
answer, and it is not a happy one about v2.3.1.

## What was actually broken

v2.3.1 was verified with `node --check` and a 38-check suite. Both passed. And the
console was **broken anyway**:

```
public/app.js   2,947 lines → 1,670 lines
10 render functions deleted
```

`renderClients`, `renderFinder`, `renderCalendar`, `renderReports`, `renderAudit`,
`renderSetup`, `renderAuditPanel`, `renderFollowUps`, `renderFinderPlan`, `renderPalette`
— gone. Clicking Clients, Client Finder, Calendar, Reports, Audit or Setup in that build
threw a ReferenceError and left the panel empty. The sidebar worked, Today worked, and
every test was green, because **a syntax check cannot see a missing function** and the
self-check only ever fetched `/` and `/api/state`.

Root cause: a patch that used `"    .join('');\n}"` as its closing anchor. That string
occurs more than once in the file; the first match was in a different function, so
everything between was cut.

### What changed so this cannot ship again

`test/ui-smoke.mjs` boots a throwaway office on port 3199, loads the **real**
`public/app.js` into a DOM stand-in, calls `setView()` for all eleven screens, and
asserts each screen's main container actually received HTML.

Verified that it catches the original bug — `renderClients` was deleted on purpose and
the test failed immediately with:

```
#${id} stayed empty — its render function may be missing
```

```
npm test  → 31/31   (30 unit + 1 UI smoke)
```

The smoke test also kills its own server on both success and failure; the first version
left a listener on 3199 behind.

## Real bugs found by running every command by hand

| Command | What happened | Now |
|---|---|---|
| `/lead Test Biz \| cafe \| Pune \| URL \| x` | saved a lead named **"Test Biz \| cafe"** — the pipe-split reader treated slot 1 as the niche | slot 1 is the business name when a later slot looks like a niche |
| `/lead …` with no notes | fit reason was literally **"Listed on https://example.com"** | a real sentence: what you saw, or that there is no content plan |
| `/audit L-0007` (no internet) | stored `severity: high` + **"site did not open"** as an audit finding, and printed "Nothing here is a guess" | `📵 COULD NOT AUDIT — nothing was saved`. A failed fetch is not a finding about the business |
| `/audit-all 2` | counted 2 "audited" while both had failed | counts only real audits, says `NO LEAD COULD BE AUDITED` and why |
| `/stage L-0007 Contacted` | stage changed but no send date → the day-3 follow-up could **never** become due | stamps `sentAt`, replies with the day-3 date |
| `/promote L-0007` | marked the lead **Won**, inflating win rate and won value the moment you made a client record | client starts at `Lead`; win count and won value unchanged (test asserts this) |
| `/proposal L-0007` | printed usage text | says a lead is not a client, offers the `/promote` button |

## Honest scoreboard

```
24/27 commands answered correctly on a clean database
3 remaining "failures" were my own test regex, re-verified by hand as correct
```

```
npm test      31/31
npm run check 38/38
restart      data survives (9 leads, 5 clients, 10 tasks after a kill -9 and restart)
```

## What is still broken, and I am not fixing it by pretending

| Item | Status |
|---|---|
| Audits of real businesses | needs internet. `/audit` now refuses rather than lying. |
| Screenshot proof | no headless browser here. `/evidence` quotes the page instead. |
| SQLite | still `data/db.json`, single-writer. Fine for one person, wrong for two. |
| Real logins | one shared access code; `actor` is a label. |
| Auto-send | never. The approval gate is the product. |


---

## Follow-up: the HTML was broken too

After restoring the render functions, a UI smoke test that actually executed the
render path still mattered — so the markup was parsed the way a browser does it:

```
BEFORE
  div balance       -1     one stray </div>
  details balance    0     but the Setup fold closed too early
```

That single extra `</div>` put the palette, modal, drawer and lock screen **inside**
the `.app` layout grid (a two-column grid, so they became stray grid items), and it
closed the Setup fold before the exports and data panels — which is why Setup still
showed three panels after the "declutter" pass.

```
AFTER
  div 0 · details 0 · section 0 · aside 0 · main 0
  duplicate ids: none
```

Panels on first paint now:

| Page | Panels | Folded |
|---|---|---|
| Dashboard | 1 | 2 |
| Setup | 1 | 5 |
| Calendar | 1 | 2 |
| My Team | 1 | – |
| Client Finder | 2 per step | – |
| Audit | 1 | – |
| Everything else | single list | – |

Guard added, and proven to catch it:

```
❌ HTML nesting is unbalanced    div -1      (one extra </div> inserted on purpose)
✅ HTML nesting is balanced      div · details · section · aside · main
```

```
npm test      31/31
npm run check 39/39
```

## One more, found at the end

`npm run backup` runs in its own process and stamps `meta.lastBackupAt` in its own
copy of `data/db.json`. The long-running server never re-read that file, so after a
**successful** backup the Setup checklist still said *"No backup yet"* and invited you
to run one you had just run.

`store.reloadMeta()` now refreshes that single field from disk on each `/api/state`
call. Verified: `lastBackupAt now: 2026-11-24T17:37:25.308Z` immediately after a
backup, with no server restart.
