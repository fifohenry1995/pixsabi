'use strict';
// Makes a safe copy of the database (works while the game is running).
// Usage: npm run backup        -> data/backups/pixsabi-YYYY-MM-DD-HHMM.db (newest 14 kept)
const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const src = path.join(DATA_DIR, 'pixsabi.db');
if (!fs.existsSync(src)) { console.error('No database found at ' + src); process.exit(1); }
const dir = path.join(DATA_DIR, 'backups');
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
const out = path.join(dir, `pixsabi-${stamp}.db`);
const sql = new DatabaseSync(src);
sql.exec(`VACUUM INTO '${out.replace(/'/g, "''")}'`);
sql.close();
const old = fs.readdirSync(dir).filter((f) => f.endsWith('.db')).sort().slice(0, -14);
for (const f of old) fs.rmSync(path.join(dir, f));
console.log('Backup saved: ' + out + '  (also copy data/avatars and content/ somewhere safe)');
