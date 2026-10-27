import fs from 'node:fs';
import path from 'node:path';
import { store } from './store.js';

/**
 * Google Sheets export layer.
 *
 * The guide uses Google Sheets as the task database (Chapters 4, 8, 14).
 * This module produces the exact tab layouts from Chapter 14 as CSV, so you can
 * import them into a sheet named "AI Invincible Office" with tabs
 * Tasks / Drafts / Leads / Daily Log — or paste a single row straight in.
 *
 * No OAuth is required for export. Direct write-back is opt-in and documented
 * in docs/03-google-sheets.md.
 */

export const TABS = {
  Tasks: ['Task ID', 'Created At', 'Request', 'Task', 'Priority', 'Owner', 'Deadline', 'Status', 'Notes'],
  Drafts: ['Draft ID', 'Task ID', 'Platform', 'Draft', 'Status', 'Reviewer', 'Decision At', 'Feedback'],
  Leads: [
    'Lead ID',
    'Business Name',
    'Website',
    'Niche',
    'Source URL',
    'Fit Reason',
    'Contact Status',
    'Review Status',
    'Next Action',
  ],
  'Daily Log': ['Date', 'Completed', 'Pending', 'Blocked', 'Drafts Awaiting Approval', 'Notes'],
  Clients: ['Client ID', 'Company', 'Contact', 'Email', 'Phone', 'Niche', 'Stage', 'Value', 'Next Follow Up', 'Notes'],
};

const cell = (value) => {
  if (value === null || value === undefined) return '';
  const text = String(value).replace(/\r?\n/g, ' ').replace(/"/g, '""');
  return /[",\n]/.test(text) ? `"${text}"` : text;
};

export const toCsv = (headers, rows) =>
  [headers.map(cell).join(','), ...rows.map((row) => headers.map((header) => cell(row[header])).join(','))].join('\n');

export function tabRows(tab, db = store.db) {
  switch (tab) {
    case 'Tasks':
      return db.tasks.map((task) => ({
        'Task ID': task.id,
        'Created At': task.createdAt?.slice(0, 16).replace('T', ' '),
        Request: task.request,
        Task: task.task,
        Priority: task.priority,
        Owner: task.owner,
        Deadline: task.deadline,
        Status: task.status,
        Notes: task.notes,
      }));
    case 'Drafts':
      return db.drafts.map((draft) => ({
        'Draft ID': draft.id,
        'Task ID': draft.taskId,
        Platform: draft.platform,
        Draft: draft.draft,
        Status: draft.status,
        Reviewer: draft.reviewer,
        'Decision At': draft.decisionAt ? String(draft.decisionAt).slice(0, 16).replace('T', ' ') : '',
        Feedback: draft.feedback,
      }));
    case 'Leads':
      return db.leads.map((lead) => ({
        'Lead ID': lead.id,
        'Business Name': lead.businessName,
        Website: lead.website,
        Niche: lead.niche,
        'Source URL': lead.sourceUrl,
        'Fit Reason': lead.fitReason,
        'Contact Status': lead.contactStatus,
        'Review Status': lead.reviewStatus,
        'Next Action': lead.nextAction,
      }));
    case 'Clients':
      return db.clients.map((client) => ({
        'Client ID': client.id,
        Company: client.company,
        Contact: client.contact,
        Email: client.email,
        Phone: client.phone,
        Niche: client.niche,
        Stage: client.stage,
        Value: client.value,
        'Next Follow Up': client.nextFollowUp || '',
        Notes: client.notes,
      }));
    case 'Daily Log':
      return db.dailyLog.map((row) => ({
        Date: row.date,
        Completed: row.completed,
        Pending: row.pending,
        Blocked: row.blocked,
        'Drafts Awaiting Approval': row.draftsAwaitingApproval,
        Notes: row.notes,
      }));
    default:
      return [];
  }
}

export function tabCsv(tab, db = store.db) {
  if (!TABS[tab]) throw new Error(`Unknown tab: ${tab}`);
  return toCsv(TABS[tab], tabRows(tab, db));
}

/** Write all four tabs as CSV files into a folder (default: exports/sheets). */
export function exportAllCsv(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true });
  const written = [];
  for (const tab of Object.keys(TABS)) {
    const file = path.join(targetDir, `${tab.replace(/\s+/g, '-').toLowerCase()}.csv`);
    fs.writeFileSync(file, tabCsv(tab));
    written.push(file);
  }
  return written;
}

/**
 * Optional direct sync. Requires a service account JSON and GOOGLE_SHEETS_ID.
 * Disabled by default; returns a clear reason instead of failing silently.
 */
export async function syncToSheets() {
  const id = process.env.GOOGLE_SHEETS_ID;
  const keyFile = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;
  if (!id || !keyFile || !fs.existsSync(keyFile)) {
    return {
      ok: false,
      reason: 'Direct Sheets sync is not configured. Use the CSV export or n8n Google Sheets node (docs/03-google-sheets.md).',
    };
  }
  return {
    ok: false,
    reason: 'Direct sync is intentionally manual in this build: verify OAuth scopes (Chapter 9 least privilege) before enabling write-back.',
    spreadsheetId: id,
  };
}
