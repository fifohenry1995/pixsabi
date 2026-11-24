'use strict';
// Background photos for the game cards on the home screen (Naija, Universal, Word Search, Slide Puzzle).
// With no photo the game shows its own drawn scene. Saved as content/worldbg/naija.jpg etc.
const fs = require('fs');
const path = require('path');

const DIR = process.env.WORLDBG_DIR || path.join(__dirname, '..', 'content', 'worldbg');
const KEYS = ['naija', 'universal', 'wordsearch', 'slide'];
const fileOf = (key) => path.join(DIR, `${key}.jpg`);

function list() {
  const out = {};
  for (const key of KEYS) {
    let st;
    try { st = fs.statSync(fileOf(key)); } catch { continue; }
    if (st.isFile()) out[key] = `/wbg/${key}?v=${Math.floor(st.mtimeMs)}`;
  }
  return out;
}

module.exports = { DIR, KEYS, fileOf, list };
