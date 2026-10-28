#!/usr/bin/env node
/**
 * Backup — the weekly checklist item from Chapter 10.
 *
 * Copies data/db.json and writes the four Sheets CSVs into
 *   backups/<timestamp>/
 *
 * Run: npm run backup
 * Then copy that folder somewhere off the machine (private GitHub repo, drive,
 * encrypted archive). The backup itself is git-ignored by design.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const target = path.join(root, 'backups', stamp);

try {
  const { config } = await import('../src/config.js');
  const { store } = await import('../src/store.js');
  const { exportAllCsv } = await import('../src/sheets.js');

  fs.mkdirSync(target, { recursive: true });
  const dbSource = path.join(config.dataDir, 'db.json');

  if (!fs.existsSync(dbSource)) {
    console.error(`No database found at ${dbSource}. Start the office once first.`);
    process.exit(1);
  }

  fs.copyFileSync(dbSource, path.join(target, 'db.json'));
  const csvFiles = exportAllCsv(path.join(target, 'sheets'));

  const summary = {
    createdAt: new Date().toISOString(),
    tasks: store.db.tasks.length,
    drafts: store.db.drafts.length,
    leads: store.db.leads.length,
    dailyLog: store.db.dailyLog.length,
    auditEvents: store.db.audit.length,
    files: ['db.json', ...csvFiles.map((file) => path.relative(target, file))],
  };
  fs.writeFileSync(path.join(target, 'manifest.json'), JSON.stringify(summary, null, 2));
  store.db.meta.lastBackupAt = summary.createdAt;
  store.save();

  console.log(`\n  ✅ Backup written to backups/${stamp}`);
  console.log(`     ${summary.tasks} tasks · ${summary.drafts} drafts · ${summary.leads} leads · ${summary.dailyLog} log rows`);
  console.log('     Copy this folder somewhere off the machine.\n');
} catch (error) {
  console.error('Backup failed:', error.message);
  process.exit(1);
}
