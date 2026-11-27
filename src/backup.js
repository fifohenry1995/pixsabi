'use strict';
// Admin backup and restore.
//  * A backup is ONE file (.pxbackup, a gzip-compressed bundle) holding the database (a safe snapshot), everything else
//    in DATA_DIR (profile photos, premium and income records, secrets...) and the whole content folder (puzzles, pictures,
//    adverts, pop-ups, slide, site texts, admin list).
//  * Restore unpacks an uploaded backup next to the live files, checks it, then restarts the game; src/restoreApply.js
//    swaps it in during the start and keeps the old files in DATA_DIR/before-restore.
// Bundle layout (before gzip): repeated [4 bytes: header length][header JSON {p: path, s: size}][s bytes of file], ended by 4 zero bytes.
// The first entry is _meta.json. Paths start with data/ or content/.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { HttpError } = require('./util');
const R = require('./restoreApply');

const MAX_MB = Number(process.env.BACKUP_MAX_MB) || 300;
const MAX_BYTES = MAX_MB * 1024 * 1024;
const MAX_UNPACKED = MAX_BYTES * 5;
const STATE_FILE = path.join(R.DATA_DIR, 'backup-state.json');
let busy = false;
let exitFn = (code) => process.exit(code);
const setExit = (fn) => { exitFn = fn; };

const state = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } };
function saveState(patch) {
  const next = { ...state(), ...patch };
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next));
  fs.renameSync(tmp, STATE_FILE);
}
function status() {
  const s = state();
  return { lastAt: s.lastAt || 0, lastFiles: s.lastFiles || 0, lastRestoreAt: s.lastRestoreAt || 0, maxMb: MAX_MB };
}

// One-time download links (the browser follows a plain link, so a big file never sits in memory)
const tokens = new Map();
function newToken(userId) {
  for (const [t, v] of tokens) if (v.exp < Date.now()) tokens.delete(t);
  const t = crypto.randomBytes(16).toString('hex');
  tokens.set(t, { userId, exp: Date.now() + 60_000 });
  return t;
}
function useToken(t, userId) {
  const v = tokens.get(String(t || ''));
  tokens.delete(String(t || ''));
  return !!v && v.exp >= Date.now() && v.userId === userId;
}

function listFiles() {
  const { CONTENT_DIR } = require('./paths');
  const out = [];
  const nested = path.resolve(CONTENT_DIR).startsWith(path.resolve(R.DATA_DIR) + path.sep);
  const walk = (abs, rel, top) => {
    let ents;
    try { ents = fs.readdirSync(abs, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (top && R.skipData(e.name)) continue;
      const a = path.join(abs, e.name);
      if (top && nested && path.resolve(a) === path.resolve(CONTENT_DIR)) continue;     // saved below, as content/
      if (e.isDirectory()) walk(a, rel + '/' + e.name, false);
      else if (e.isFile()) out.push({ abs: a, rel: rel + '/' + e.name });
    }
  };
  walk(R.DATA_DIR, 'data', true);
  walk(CONTENT_DIR, 'content', false);
  return out;
}

async function streamBackup(res) {
  if (busy) throw new HttpError(409, 'A backup or restore is already running. Try again in a minute.');
  busy = true;
  const { sql, flush } = require('./db');
  const tmpDb = path.join(R.DATA_DIR, 'backup-tmp-' + Date.now() + '.db');
  try {
    try { flush(); } catch { /* nothing waiting */ }
    sql.exec(`VACUUM INTO '${tmpDb.replace(/'/g, "''")}'`);
    const files = listFiles();
    const users = sql.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    const meta = { format: 1, app: 'pixsabi', version: require('../package.json').version, createdAt: new Date().toISOString(), users, files: files.length + 1 };
    const stamp = new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '');
    res.writeHead(200, {
      'Content-Type': 'application/gzip',
      'Content-Disposition': `attachment; filename="pixsabi-backup-${stamp}.pxbackup"`,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    const gz = zlib.createGzip({ level: 4 });
    gz.pipe(res);
    const write = (buf) => (gz.write(buf) ? Promise.resolve() : new Promise((r) => gz.once('drain', r)));
    const head = (p, s) => { const j = Buffer.from(JSON.stringify({ p, s })); const l = Buffer.alloc(4); l.writeUInt32BE(j.length); return Buffer.concat([l, j]); };
    const mb = Buffer.from(JSON.stringify(meta));
    await write(head('_meta.json', mb.length)); await write(mb);
    // the database snapshot is a still file, so it can be streamed
    const dbSize = fs.statSync(tmpDb).size;
    await write(head('data/pixsabi.db', dbSize));
    await new Promise((resolve, reject) => {
      const rs = fs.createReadStream(tmpDb);
      rs.on('data', (c) => { if (!gz.write(c)) { rs.pause(); gz.once('drain', () => rs.resume()); } });
      rs.on('end', resolve); rs.on('error', reject);
    });
    for (const f of files) {
      let buf;
      try { buf = fs.readFileSync(f.abs); } catch { continue; }      // a file removed while we work: skip it
      await write(head(f.rel, buf.length)); await write(buf);
    }
    await write(Buffer.alloc(4));
    await new Promise((r) => { res.once('finish', r); gz.end(); });
    saveState({ lastAt: Date.now(), lastFiles: meta.files });
  } catch (e) {
    if (res.headersSent) { res.destroy(); console.error('[backup] failed:', e.message); }
    else throw e;
  } finally {
    busy = false;
    fs.rmSync(tmpDb, { force: true });
  }
}

// ---- restore ----
const bad = (m) => new HttpError(400, m);
function safeRel(p) {
  if (typeof p !== 'string' || !/^(data|content)\//.test(p) || p.includes('\0') || p.includes('\\')) return null;
  const parts = p.split('/');
  if (parts.some((s) => !s || s === '.' || s === '..')) return null;
  return parts;
}

async function unpack(readable, stage) {
  let buf = Buffer.alloc(0), mode = 'len', need = 4, head = null, fd = null, left = 0, total = 0, meta = null, metaBuf = [], done = false, files = 0;
  const finishEntry = () => {
    if (fd != null) { fs.closeSync(fd); fd = null; }
    if (head.p === '_meta.json') { try { meta = JSON.parse(Buffer.concat(metaBuf).toString('utf8')); } catch { throw bad('That is not a PixSabi backup file.'); } }
    else files++;
  };
  for await (const chunk of readable) {
    buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
    for (;;) {
      if (done) break;
      if (mode === 'len') {
        if (buf.length < 4) break;
        need = buf.readUInt32BE(0); buf = buf.subarray(4);
        if (need === 0) { done = true; break; }
        if (need > 4096) throw bad('That is not a PixSabi backup file.');
        mode = 'head';
      } else if (mode === 'head') {
        if (buf.length < need) break;
        try { head = JSON.parse(buf.subarray(0, need).toString('utf8')); } catch { throw bad('That is not a PixSabi backup file.'); }
        buf = buf.subarray(need);
        if (!head || !Number.isInteger(head.s) || head.s < 0) throw bad('That is not a PixSabi backup file.');
        left = head.s; total += left;
        if (total > MAX_UNPACKED) throw bad('That backup is too large to restore here.');
        if (head.p === '_meta.json') { if (left > 1_000_000) throw bad('That is not a PixSabi backup file.'); metaBuf = []; }
        else {
          const parts = safeRel(head.p);
          if (!parts) throw bad('That backup contains a file name that is not allowed, so it was not restored.');
          const dest = path.join(stage, ...parts);
          fs.mkdirSync(path.dirname(dest), { recursive: true });
          fd = fs.openSync(dest, 'w');
        }
        mode = 'body';
      } else {
        if (left > 0 && !buf.length) break;
        const take = buf.subarray(0, Math.min(left, buf.length));
        if (head.p === '_meta.json') metaBuf.push(Buffer.from(take)); else if (take.length) fs.writeSync(fd, take);
        left -= take.length; buf = buf.subarray(take.length);
        if (left === 0) { finishEntry(); mode = 'len'; }
      }
    }
    if (done) break;
  }
  if (!done) throw bad('That backup file is incomplete or damaged (the upload may have been cut off).');
  if (!meta || meta.format !== 1 || meta.app !== 'pixsabi') throw bad('That is not a PixSabi backup file.');
  return { meta, files };
}

function checkStaged(stage) {
  const dbf = path.join(stage, 'data', 'pixsabi.db');
  if (!fs.existsSync(dbf)) throw bad('That backup has no player database in it.');
  const { DatabaseSync } = require('node:sqlite');
  let users = 0;
  try {
    const t = new DatabaseSync(dbf, { readOnly: true });
    const qc = t.prepare('PRAGMA quick_check').get();
    if (Object.values(qc)[0] !== 'ok') throw new Error('damaged');
    users = t.prepare('SELECT COUNT(*) AS c FROM users').get().c;
    t.close();
  } catch { throw bad('The player database inside that backup is damaged, so it was not restored.'); }
  return users;
}

async function receiveRestore(req, res) {
  if (busy) throw new HttpError(409, 'A backup or restore is already running. Try again in a minute.');
  const len = Number(req.headers['content-length'] || 0);
  if (len > MAX_BYTES) throw new HttpError(413, `That file is larger than the ${MAX_MB} MB limit.`);
  busy = true;
  const tmp = path.join(R.DATA_DIR, 'restore-upload.tmp');
  try {
    fs.rmSync(R.PENDING, { recursive: true, force: true });
    fs.mkdirSync(R.STAGE, { recursive: true });
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(tmp);
      let size = 0, failed = false;
      req.on('data', (c) => {
        size += c.length;
        if (size > MAX_BYTES && !failed) { failed = true; ws.destroy(); reject(new HttpError(413, `That file is larger than the ${MAX_MB} MB limit.`)); }
        else if (!failed && !ws.write(c)) { req.pause(); ws.once('drain', () => req.resume()); }
      });
      req.on('end', () => { if (!failed) ws.end(resolve); });
      req.on('error', (e) => { if (!failed) { failed = true; reject(e); } });
      ws.on('error', (e) => { if (!failed) { failed = true; reject(e); } });
    });
    let info;
    try { info = await unpack(fs.createReadStream(tmp).pipe(zlib.createGunzip()), R.STAGE); }
    catch (e) { if (e instanceof HttpError) throw e; throw bad('That file is not a PixSabi backup, or it is damaged.'); }
    const users = checkStaged(R.STAGE);
    fs.writeFileSync(R.READY, JSON.stringify({ at: Date.now(), meta: info.meta }));
    saveState({ lastRestoreAt: Date.now() });
    return { ok: true, users, files: info.files, createdAt: info.meta.createdAt, version: info.meta.version };
  } catch (e) {
    fs.rmSync(R.PENDING, { recursive: true, force: true });
    throw e;
  } finally {
    busy = false;
    fs.rmSync(tmp, { force: true });
  }
}

// The game restarts after a restore so every file is read fresh. (On Railway the service starts again by itself.)
function restartSoon(res) {
  const go = () => setTimeout(() => { console.log('[restore] restarting to finish the restore...'); exitFn(1); }, 400);
  if (res.writableEnded) go(); else res.once('finish', go);
}

module.exports = { status, newToken, useToken, streamBackup, receiveRestore, restartSoon, setExit, unpack, MAX_MB };
