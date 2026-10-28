# Sheet templates

Import these into the Google Sheet named **AI Invincible Office** (Chapter 14 of the guide).

| File | Tab name | Notes |
| --- | --- | --- |
| `Tasks.csv` | `Tasks` | one row = one task |
| `Drafts.csv` | `Drafts` | every draft needs a decision |
| `Leads.csv` | `Leads` | Source URL is mandatory, review status defaults to "Needs human verification" |
| `Daily-Log.csv` | `Daily Log` | one row per day, written by the reporting agent |

Use **File → Import → Upload → Insert new sheet(s)** in Google Sheets, then delete the
example row before you start.

Column order must match `src/sheets.js` — the app's CSV export uses exactly the same headers.
