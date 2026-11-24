#!/usr/bin/env node
/**
 * Backup — v2.2
 *
 * Writes a self-contained snapshot of the office into backups/<timestamp>/:
 *   db.json        the whole database
 *   sheets/*.csv   the four human-readable exports
 *   manifest.json  counts + a checksum so you can prove the copy is intact
 *
 * Then it tells you, honestly, how safe you actually are:
 *   - how old the previous backup was (weekly habit check)
 *   - whether the backups folder is inside the repo (it is git-ignored)
 *   - which copy is newest
 *
 * Run: npm run backup
 * Copy that folder somewhere OFF the machine. A backup on the same disk is
 * not a backup, it is a second copy waiting to die with the laptop.
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(root, 'backups', stamp);

const bold = (text) => `\x1b[1m${text}\x1b[0m`;
const dim = (text) => `\x1b[2m${text}\x1b[0m`;
const green = (text) => `\x1b[32m${text}\x1b[0m`;
const amber = (text) => `\x1b[33m${text}\x1b[0m`;
const red = (text) => `\x1b[31m${text}\x1b[0m`;

/** The most recent backup folder before this run, or null. */
function previousBackup() {
  const dir = path.join(root, 'backups');
  if (!fs.existsSync(dir)) return null;
  const runs = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  return runs.length ? runs[runs.length - 1] : null;
}

/** Total bytes of every file under a directory. */
function dirSize(dir) {
  let total = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    total += entry.isDirectory() ? dirSize(full) : fs.statSync(full).size;
  }
  return total;
}

const humanBytes = (bytes) =>
  bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

try {
  const { config } = await import('../src/config.js');
  const { store } = await import('../src/store.js');
  const { exportAllCsv } = await import('../src/sheets.js');

  const dbSource = path.join(config.dataDir, 'db.json');
  if (!fs.existsSync(dbSource)) {
    console.error(red('No database found at ') + dbSource);
    console.error(dim('  Start the office once (npm start) so it can create the database.'));
    process.exit(1);
  }

  const before = previousBackup();
  fs.mkdirSync(target, { recursive: true });

  /* 1. the database, copied byte-for-byte */
  fs.copyFileSync(dbSource, path.join(target, 'db.json'));

  /* 2. readable CSVs, so the data survives even if the app never runs again */
  const csvFiles = exportAllCsv(path.join(target, 'sheets'));

  /* 3. checksum + manifest, so a copy can be verified later */
  const checksum = crypto.createHash('sha256').update(fs.readFileSync(path.join(target, 'db.json'))).digest('hex');
  const summary = {
    createdAt: new Date().toISOString(),
    appVersion: config.version,
    checksumSha256: checksum,
    counts: {
      tasks: store.db.tasks.length,
      drafts: store.db.drafts.length,
      leads: store.db.leads.length,
      leadsAudited: store.db.leads.filter((lead) => lead.audit).length,
      clients: (store.db.clients || []).length,
      dailyLog: store.db.dailyLog.length,
      auditEvents: store.db.audit.length,
    },
    files: ['db.json', ...csvFiles.map((file) => path.relative(target, file))],
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(summary, null, 2));

  /* record it in the office so the Setup page can show the real age */
  store.db.meta.lastBackupAt = summary.createdAt;
  store.save();

  /* ── report, with the honest caveats ─────────────────── */
  const size = dirSize(target);
  console.log('');
  console.log(`  ${green('✅ Backup written')}  backups/${stamp}  ${dim(`(${humanBytes(size)})`)}`);
  console.log(
    `     ${summary.counts.leads} leads (${summary.counts.leadsAudited} audited) · ${summary.counts.clients} clients · ` +
      `${summary.counts.drafts} drafts · ${summary.counts.tasks} tasks`,
  );
  console.log(`     ${dim('sha256')} ${checksum.slice(0, 16)}…`);

  if (before) {
    const ageMs = Date.now() - fs.statSync(path.join(root, 'backups', before)).mtimeMs;
    const ageDays = Math.floor(ageMs / 86_400_000);
    const label = ageDays === 0 ? 'earlier today' : `${ageDays} day(s) ago`;
    if (ageDays <= 7) {
      console.log(`  ${dim('Previous backup:')} ${before} ${dim(`(${label}) — good habit, keep it weekly.`)}`);
    } else {
      console.log(`  ${amber('⚠ Previous backup:')} ${before} ${amber(`(${label}) — that gap is how data gets lost.`)}`);
    }
  } else {
    console.log(`  ${amber('⚠ This is your FIRST backup.')} There was nothing to fall back on until now.`);
  }

  console.log('');
  console.log(`  ${bold('Now move it off this machine.')} A backup on the same disk is not a backup.`);
  console.log(`  ${dim('e.g. copy the folder to Drive / Dropbox, or:')} cp -r backups/${stamp} ~/Dropbox/office-backups/`);
  console.log(`  ${dim('backups/ is git-ignored on purpose — it holds client data. Never commit it.')}`);
  console.log('');
} catch (error) {
  console.error(red('Backup failed: ') + error.message);
  process.exit(1);
}
