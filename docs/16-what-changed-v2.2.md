# What changed — v2.2 (dead weight removed, evidence added)

Written 24 November 2026. Every claim below was verified by running it.

This release answers one question: **what in this repo is not earning its place?**
Answer: about 15% of it was guide residue that the code never touched. That is gone,
and the space was given back to the two jobs that actually close clients — *proof* and
*follow-up*.

---

## 1. Removed: n8n (dead since day one)

`n8n/` held 4 workflow JSON files (36 KB) plus a full n8n service in `docker-compose.yml`.

- **Zero references in the code.** `grep -rn "n8n" src/ server.js` matched exactly one
  place — a string inside an error message.
- The built-in `src/scheduler.js` already does the morning brief and follow-up queue.
- The n8n service made `docker compose up` pull a second container for nothing.

**Now:** `docker-compose.yml` runs one service (`office`) with a real healthcheck.
`npm start` needs nothing else.

## 2. Removed: `templates/` (never read)

Five CSV templates (20 KB). **Zero code references.** They existed to paste into Google
Sheets — which itself was broken (see below). `npm run backup` now writes real CSVs from
real data instead.

## 3. Removed: the Google Sheets write-back that never worked

`syncToSheets()` existed, was exported, and was **never called** from anywhere. If you had
called it, it would always have failed:

```
{ "ok": false, "reason": "Direct Sheets sync is not configured. Use the CSV export…" }
```

That is the worst kind of feature: it looks real, costs maintenance, and cannot succeed.
Removed: `syncToSheets`, the `sheets` config block, the `googleSheetId` /
`googleServiceAccount` secret rows, and the two docs pages that taught the broken path
(`docs/03-google-sheets.md`, `docs/06-n8n-workflows.md`).

**What remains, and is real:** CSV export (`/api/export/:tab`, `/api/export/all`) and
`npm run backup`.

## 4. Removed: dead code and dead CSS

| Item | Where |
| --- | --- |
| `stopScheduler` | `src/scheduler.js` |
| `stopTelegramPolling` | `src/channels/telegram.js` |
| `nextStage` | `src/agents/offline.js` |
| `syncToSheets` | `src/sheets.js` |
| 9 CSS classes (`.kind-*`, `.msg-system`, `.msg-user`, `.tag-amber/cyan/lime/rose`) | `public/styles.css` |

Net effect: **~15% fewer lines, and every remaining export is reachable.**

## 5. Fixed: the deployment checklist was lying

The Setup page had seven hardcoded `<li>` items — including *"Engine reachable (Ollama
running or a Gemini key set)"* — that rendered exactly the same whether the engine was
running or not. A checklist that cannot fail is not a checklist.

**Now** `renderDeployChecklist()` computes each row from the live state:

| Row | Computed from |
| --- | --- |
| AI engine reachable | `provider.ollama.reachable \|\| provider.gemini.configured` |
| Console is locked / NOT locked | `secrets.accessCode` (marked **fix this** when missing) |
| Telegram connected | `telegram.configured` + mode |
| Daily brief at HH:MM | `scheduler.enabled/hout/minute` |
| Backup freshness | `meta.lastBackupAt` → "no backup yet" / "Backup 12d old" (warns) |
| Leads audited | `leads` vs `leads with audit` |
| Approval gate active | always true — the one thing that is structural |

## 6. New: `/evidence` — proof without a screenshot

A screenshot is the ideal proof. A headless browser is not always possible (this sandbox
has no Chromium, and `storage.googleapis.com` is blocked), so instead of faking it, v2.2
adds a harvester that returns **verbatim strings from the client's own page**:

```
/evidence L-0006
POST /api/evidence  { "id": "L-0006" }
```

Verified against a local fixture (`test/fixtures/broken.html`):

```
EVIDENCE /broken → ok=true quotes=5
  [unfinished template text]        "…Lorem ipsum dolor sit amet, consectetur adipiscing elit…"
  [prices in dollars]               "…Signature cake $25.50 — celebration box $10.00…"
  [no booking or order wording]     "Page text never contains: book, appointment, order, cart…"
  [page title in search results]    "Baner Bakery"
  [the number behind Call button]   "tel:+18003568933"
```

Rules it follows, enforced by tests:
- every quote is verbatim — no paraphrase, no invented defect;
- if the page does not load, it returns **no quotes** and says why
  (`"Could not capture proof: fetch failed"`), and nothing is stored as evidence.

## 7. Fixed: network failures were inflating lead scores

Found while auditing the 20 Pune leads in a sandbox with no internet: every failed fetch
produced `severity: high`, so **all 20 leads tied at 74** and the ranking was noise.

`scoreLead` now requires a *credible* audit before it awards opportunity points:

```js
const checkedForReal = audit.reachable === true || audit.checks?.fetched === true;
```

If the auditor never reached the page, the finding is kept as history but **scores zero**,
and the reason says so out loud: `"audit could not reach the page — not counted"`.

Two tests lock this in: a failed fetch must score *identically* to no audit at all, while
a real audit must still move the score.

## 8. Better: `npm run backup` is now trustworthy

Before: copied `db.json`, wrote CSVs, printed a path.

Now it also:
- writes a **sha256 checksum** + `manifest.json` so a copy can be proven intact;
- reports **how old the previous backup was** — `"6 day(s) ago — good habit"` or, if stale,
  `"⚠ 34 day(s) ago — that gap is how data gets lost"`;
- says `"⚠ This is your FIRST backup. There was nothing to fall back on until now."`;
- reminds you that `backups/` is git-ignored **on purpose** (it holds client data).

First real run: `28 KB · 5 leads (0 audited) · 4 clients · 5 drafts · 6 tasks`.

## 9. Data: your 20 Pune leads are now in the app

They lived only in `docs/client-team-pune-pitchpack.md`. They are now imported
(`L-0006 … L-0025`) from a committed seed file:

```
data/seeds/pune-20.json
```

Regenerate any time (the importer refuses duplicates):

```bash
curl -X POST localhost:3000/api/source/import \
  -H 'content-type: application/json' -d @data/seeds/pune-20.json
```

The realistic ranking after the credibility fix — businesses with **no owned website** rise
to the top, because that is your strongest pitch:

```
L-0005  85  NO SITE   The Craft Room
L-0003  80  NO SITE   GreenLeaf Café
L-0025  74  NO SITE   The Little Hair Salon
```

## 10. Docs no longer promise things that do not exist

`docs/03-google-sheets.md` and `docs/06-n8n-workflows.md` deleted. The ten remaining docs
that mention n8n or Sheets now carry a header:

> **v2.2 note — n8n and Google Sheets were removed.** They were never referenced by the
> code… Any instruction below is **legacy from the original guide** — you do not need it.

README intro corrected the same way. `package.json` no longer lists `n8n` as a keyword.

---

## Verification

```
$ npm test
# tests 17   # pass 17   # fail 0
$ npm run check
30/30 checks passed
$ npm run backup
✅ Backup written  backups/2026-11-24T13-51-45 (28 KB) · sha256 e39bdfcf…
```

## Still NOT done (unchanged, on purpose)

| Gap | Honest status |
| --- | --- |
| Real screenshot of a broken page | needs a headless browser; `/evidence` gives verbatim quotes instead. **Do not fake this.** |
| Real page audits of the 20 leads | needs internet. In this sandbox every fetch fails, so audits were cleared rather than faked. **Run `/audit-all 20` on your own machine.** |
| Auto-send to clients | refused by design — the approval gate is the product |
| SQLite | still `data/db.json`; fine to a few thousand leads |
| Multi-user roles | `actor` is a label, not an identity |
