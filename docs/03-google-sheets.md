# Google Sheets — the task database

The guide stores everything in a spreadsheet named **AI Digital Office** with four tabs.
This repo uses the same layout so you can move data between them either way.

## Create the spreadsheet

1. Create a new Google Sheet named `AI Digital Office`.
2. Add four tabs with these exact names: `Tasks`, `Drafts`, `Leads`, `Daily Log`.
3. Paste the header rows from `templates/*.csv`, or use **File → Import → Upload** and pick
   each CSV with *Insert new sheet(s)*.

## Tabs and columns (Chapter 14)

### Tasks

| Task ID | Created At | Request | Task | Priority | Owner | Deadline | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| T-0001 | 2026-10-27 16:05 | Plan a Reel about AI tools | Research 5 free AI tools | High | Research Agent | | Pending | Verify official sites |

Status values: `Pending`, `In Progress`, `Blocked`, `Done`.

### Drafts

| Draft ID | Task ID | Platform | Draft | Status | Reviewer | Decision At | Feedback |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-0001 | T-0001 | Instagram | Hook: … | Awaiting approval | | | |

Status values: `Awaiting approval`, `Approved`, `Revision requested`, `Rejected`.

### Leads

| Lead ID | Business Name | Website | Niche | Source URL | Fit Reason | Contact Status | Review Status | Next Action |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| L-0001 | Example Studio | https://example.com | Design agency | https://example.com | No visible content plan | Not contacted | Needs human verification | Manual review |

Rules that matter more than the columns:

- `Source URL` is **mandatory**. A lead without a source is not a lead.
- `Review Status` starts as `Needs human verification` — always.
- `Contact Status` starts as `Not contacted` — always.
- Never invent email, phone, revenue or employee counts.

### Daily Log

| Date | Completed | Pending | Blocked | Drafts Awaiting Approval | Notes |
| --- | --- | --- | --- | --- | --- |
| 2026-10-27 | 2 | 3 | 1 | 1 | Full report text… |

## Export from this app

- **Setup → Google Sheets** → four download links.
- Or directly: `/api/export/tasks`, `/api/export/drafts`, `/api/export/leads`,
  `/api/export/daily-log`.
- Everything at once: `GET /api/export/all` returns JSON keyed by tab.

CSV is UTF-8, quoted where needed, one row per record. Import with
*File → Import → Upload → Replace current sheet* to refresh an existing tab.

## Connect n8n with OAuth2 (Chapter 6)

1. In Google Cloud Console, create a project and enable **Google Sheets API**.
2. Configure the OAuth consent screen (External is fine for testing; add yourself as a test user).
3. Create **OAuth client ID → Web application**.
4. Add the redirect URI n8n shows in the credential dialog, typically
   `http://localhost:5678/rest/oauth2-credential/callback`.
5. In n8n: **Credentials → New → Google Sheets OAuth2 API**, paste client ID and secret,
   click *Sign in with Google*.
6. Grant the **narrowest scope you can**:
   - read + write only what you need: `https://www.googleapis.com/auth/spreadsheets`
   - avoid Drive-wide scopes unless a node truly needs them.

Test the credential with a *Get Rows* node on the Tasks tab before wiring the workflow.

### Troubleshooting OAuth

| Symptom | Fix |
| --- | --- |
| `redirect_uri_mismatch` | Copy the exact URI from n8n into Google Cloud, including port and path |
| `access_denied` / app not verified | Add your Google account as a test user on the consent screen |
| `The caller does not have permission` | Sheet not shared with the account, or wrong spreadsheet ID |
| `Unable to parse range` | Tab name mismatch — check spaces and capitalisation |
| Credential works in one node only | Re-authenticate; tokens expire or get revoked |

## Optional: direct sync from this app

`GOOGLE_SHEETS_ID` and `GOOGLE_SERVICE_ACCOUNT_FILE` can be set in `.env`, but write-back is
intentionally **manual** in this build. Reasons:

- least privilege — a service account with edit rights is a big key to leave on a laptop;
- the audit trail should stay in one place while you are learning;
- CSV import is fast enough for a daily routine.

If you enable it later, follow the same rule as every other integration: test on a copy of
the sheet first, and log the action in the audit trail.
