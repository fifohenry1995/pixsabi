'use strict';
// Pause / lock the public chat room (set by the admin). While it is locked, ordinary players can read the room but not
// write or edit in it. Admins can still write. Private messages are not affected. A lock can end by itself after a time.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'chatlock.json');
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);

let state = { locked: false, note: '', until: 0 };
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); state = { locked: !!j.locked, note: clean(j.note), until: Number(j.until) || 0 }; } catch { /* not set yet */ }

function current(now = Date.now()) {
  if (state.locked && state.until && now >= state.until) { state = { locked: false, note: '', until: 0 }; persist(); }
  return { locked: state.locked, note: state.note, until: state.locked ? state.until : 0 };
}
function persist() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); } catch { /* best effort */ } }
// minutes: 0 or missing = until the admin unlocks
function set(locked, note, minutes) {
  const m = Math.max(0, Math.min(Number(minutes) || 0, 60 * 24 * 14));
  state = locked ? { locked: true, note: clean(note), until: m ? Date.now() + m * 60_000 : 0 } : { locked: false, note: '', until: 0 };
  persist();
  return current();
}

module.exports = { current, set };
