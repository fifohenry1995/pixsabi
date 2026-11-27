'use strict';
// Finishes a "Restore backup" on the next start. The admin page unpacks the uploaded backup into
// DATA_DIR/restore-pending/stage and writes a READY file, then the game restarts. This file runs FIRST (db.js
// requires it before the database is opened), swaps the unpacked files in, and keeps what was there before in
// DATA_DIR/before-restore, so a restore can be undone by hand.
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const PENDING = path.join(DATA_DIR, 'restore-pending');
const STAGE = path.join(PENDING, 'stage');
const READY = path.join(PENDING, 'READY');
const BEFORE = path.join(DATA_DIR, 'before-restore');
// Never part of a backup (and never swapped out by a restore)
const DATA_SKIP = new Set(['restore-pending', 'before-restore', 'backups', 'restore-upload.tmp']);
const skipData = (name) => DATA_SKIP.has(name) || /^pixsabi\.db(-wal|-shm)?$/.test(name) || /^naija-sabi\.db(-wal|-shm)?$/.test(name) || /^backup-tmp-/.test(name);

function move(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try { fs.renameSync(from, to); }
  catch (e) {
    if (e.code !== 'EXDEV') throw e;
    fs.cpSync(from, to, { recursive: true });
    fs.rmSync(from, { recursive: true, force: true });
  }
}

function apply() {
  if (!fs.existsSync(READY)) return false;
  const { CONTENT_DIR } = require('./paths');
  const nested = path.resolve(CONTENT_DIR).startsWith(path.resolve(DATA_DIR) + path.sep);
  const done = [];   // [from, to] pairs, so a failure can be rolled back
  const mv = (a, b) => { move(a, b); done.push([a, b]); };
  try {
    fs.rmSync(BEFORE, { recursive: true, force: true });
    fs.mkdirSync(BEFORE, { recursive: true });
    // 1. put what is there now aside
    for (const name of fs.readdirSync(DATA_DIR)) {
      if (DATA_SKIP.has(name) && name !== 'backups') continue;     // keep 'backups' (npm run backup copies) where they are
      if (name === 'backups') continue;
      mv(path.join(DATA_DIR, name), path.join(BEFORE, 'data', name));
    }
    if (!nested && fs.existsSync(CONTENT_DIR)) mv(CONTENT_DIR, path.join(BEFORE, 'content'));
    // 2. bring the backup in
    const sd = path.join(STAGE, 'data'), sc = path.join(STAGE, 'content');
    if (fs.existsSync(sd)) for (const name of fs.readdirSync(sd)) mv(path.join(sd, name), path.join(DATA_DIR, name));
    fs.mkdirSync(CONTENT_DIR, { recursive: true });
    if (fs.existsSync(sc)) for (const name of fs.readdirSync(sc)) mv(path.join(sc, name), path.join(CONTENT_DIR, name));
    fs.rmSync(PENDING, { recursive: true, force: true });
    console.log('[restore] backup restored. The files from before are kept in', BEFORE);
    return true;
  } catch (e) {
    console.error('[restore] FAILED, putting the old files back:', e.message);
    for (const [a, b] of done.reverse()) { try { if (fs.existsSync(b) && !fs.existsSync(a)) move(b, a); } catch { /* best effort */ } }
    try { fs.rmSync(READY, { force: true }); } catch { /* ignore */ }
    return false;
  }
}

module.exports = { apply, DATA_DIR, PENDING, STAGE, READY, BEFORE, DATA_SKIP, skipData, move };
