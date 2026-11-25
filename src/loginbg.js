'use strict';
// Background pictures for the login screen: they slide slowly behind the form, blurred.
// These are separate from the puzzle pictures on purpose (the login page is public, so puzzle pictures must never be shown there).
// Up to 8 pictures, saved as content/loginbg/1.jpg ... 8.jpg.
const fs = require('fs');
const path = require('path');

const DIR = process.env.LOGINBG_DIR || path.join(require('./paths').CONTENT_DIR, 'loginbg');
const SLOTS = [1, 2, 3, 4, 5, 6, 7, 8];
const fileOf = (slot) => path.join(DIR, `${slot}.jpg`);

function list() {
  const out = [];
  for (const slot of SLOTS) {
    let st;
    try { st = fs.statSync(fileOf(slot)); } catch { continue; }
    if (st.isFile()) out.push({ slot, image: `/bg/${slot}?v=${Math.floor(st.mtimeMs)}` });
  }
  return out;
}

module.exports = { DIR, SLOTS, fileOf, list };
