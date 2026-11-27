'use strict';
// PixSabi Radio: one audio (news, music or a podcast) that plays like a live radio station.
// The admin uploads it; from that moment it is "on air" and loops. Everybody hears the same moment of it:
// the position is worked out from the server clock, so a listener who comes back later joins where the broadcast is now.
// It replaces the built-in theme song for every player whose sound setting is on.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { TYPES, MIME_BY_EXT, typeOf } = require('./commentary');

const DIR = process.env.RADIO_DIR || path.join(require('./paths').CONTENT_DIR, 'radio');
const META = path.join(DIR, 'radio.json');
const MAX_BYTES = 40_000_000;              // about 83 minutes at 64 kbps (fine for speech), or 2.7 hours at 32 kbps
const MIN_SECONDS = 5;
const MAX_SECONDS = 3 * 3600;

function read() {
  try { const m = JSON.parse(fs.readFileSync(META, 'utf8')); return m && m.id ? m : null; } catch { return null; }
}
function write(m) {
  fs.mkdirSync(DIR, { recursive: true });
  if (!m) { try { fs.unlinkSync(META); } catch { /* none */ } return; }
  const tmp = META + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1) + '\n');
  fs.renameSync(tmp, META);
}
const newId = () => crypto.randomBytes(5).toString('hex');
const fileOf = (r) => path.join(DIR, `${r.id}.${r.ext}`);
const find = (id) => { const r = read(); return r && r.id === id ? r : null; };

// What every device needs. "now" lets a phone with a wrong clock still find the right moment.
function publicView() {
  const r = read();
  if (!r || !r.active || !fs.existsSync(fileOf(r))) return { on: false, now: Date.now() };
  return { on: true, id: r.id, url: `/radio/${r.id}`, title: r.title || '', duration: r.duration, startedAt: r.startedAt, now: Date.now() };
}
function adminView() {
  const r = read();
  return { max: MAX_BYTES, radio: r ? { ...r, url: `/radio/${r.id}`, missing: !fs.existsSync(fileOf(r)) } : null, now: Date.now() };
}
module.exports = { DIR, MAX_BYTES, MIN_SECONDS, MAX_SECONDS, TYPES, MIME_BY_EXT, typeOf, read, write, newId, fileOf, find, publicView, adminView };
