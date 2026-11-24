'use strict';
// The watermark text the admin page burns into new pictures (bottom right). The admin's browser does the drawing when a picture
// is uploaded, so the stamp is part of the saved file and survives a download. This file only keeps the text and two dates.
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./db');

const FILE = path.join(DATA_DIR, 'watermark.json');
const clean = (s) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 30);

let state = null;
function load() {
  if (state) return state;
  try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); state = { text: clean(j.text), since: Number(j.since) || Date.now(), stampedAt: Number(j.stampedAt) || 0 }; }
  catch { state = { text: 'PixSabi', since: Date.now(), stampedAt: 0 }; persist(); }
  return state;
}
function persist() { try { fs.mkdirSync(DATA_DIR, { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(state)); } catch { /* best effort */ } }
const get = () => ({ ...load() });
// text: what to print ('' switches the watermark off). `since` is when the stamping began: pictures saved after it already carry the stamp.
function setText(text) { load().text = clean(text); persist(); return get(); }
function markStamped() { load().stampedAt = Date.now(); persist(); return get(); }
module.exports = { get, setText, markStamped };
