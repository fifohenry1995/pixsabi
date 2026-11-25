'use strict';
// Word Search levels. The list of puzzles lives in content/wordsearch.json (or WORDSEARCH_FILE on a host
// with a persistent disk). Each puzzle is a theme plus the words to find. The letter grid is made by the server
// from the words (always the same grid for the same puzzle), so the admin only has to type the words.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.WORDSEARCH_FILE || path.join(require('./paths').CONTENT_DIR, 'wordsearch.json');
const MIN_WORDS = 4, MAX_WORDS = 14, MIN_LEN = 3, MAX_LEN = 12;

let list = [];
function reload() {
  try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { list = []; }
  list = list.filter((p) => p && p.id && Array.isArray(p.words));
  cache.clear();
  return list;
}
function save(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
  reload();
}

// ---- checking what the admin typed ----
function cleanWords(input) {
  const raw = Array.isArray(input) ? input : String(input || '').split(/[\s,;]+/);
  const out = [];
  for (const w of raw) {
    const word = String(w).trim().toUpperCase();
    if (!word) continue;
    if (!/^[A-Z]+$/.test(word)) throw new Error(`"${w}" has something other than letters A-Z. Write each word on its own, with no spaces or symbols.`);
    if (word.length < MIN_LEN || word.length > MAX_LEN) throw new Error(`"${word}" must be ${MIN_LEN} to ${MAX_LEN} letters long.`);
    if (!out.includes(word)) out.push(word);
  }
  if (out.length < MIN_WORDS || out.length > MAX_WORDS) throw new Error(`Use ${MIN_WORDS} to ${MAX_WORDS} different words.`);
  return out;
}
const cleanText = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

// ---- the grid maker ----
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest().readUInt32LE(0);
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// Early levels: words run right or down. Then slanted words appear, and later words can also run backwards.
const DIRS = [
  [[0, 1], [1, 0]],
  [[0, 1], [1, 0], [1, 1]],
  [[0, 1], [1, 0], [1, 1], [1, -1]],
  [[0, 1], [1, 0], [1, 1], [1, -1], [0, -1], [-1, 0], [-1, -1], [-1, 1]],
];
const tierOf = (index) => (index < 6 ? 0 : index < 14 ? 1 : index < 24 ? 2 : 3);
const sizeOf = (index, longest) => Math.max(longest, Math.min(12, 8 + Math.floor(index / 8)));
const FILL = 'EEEEAAAIIOONNRRTTLLSSUUDDGBCFHKMPWYJV';

const cache = new Map();
function build(entry, index) {
  const key = `${entry.id}|${index}|${entry.words.join(',')}`;
  if (cache.has(key)) return cache.get(key);
  const words = entry.words.slice().sort((a, b) => b.length - a.length);
  const dirs = DIRS[tierOf(index)];
  let size = sizeOf(index, words[0].length), result = null;
  for (let attempt = 0; attempt < 60 && !result; attempt++) {
    if (attempt && attempt % 15 === 0) size = Math.min(14, size + 1);
    const rand = rng(hash(key) + attempt * 7919);
    const grid = Array.from({ length: size }, () => Array(size).fill(''));
    const spots = {};
    let ok = true;
    for (const word of words) {
      let placed = false;
      for (let t = 0; t < 250 && !placed; t++) {
        const [dr, dc] = dirs[Math.floor(rand() * dirs.length)];
        const r = Math.floor(rand() * size), c = Math.floor(rand() * size);
        const er = r + dr * (word.length - 1), ec = c + dc * (word.length - 1);
        if (er < 0 || ec < 0 || er >= size || ec >= size) continue;
        let fits = true;
        for (let i = 0; i < word.length && fits; i++) { const cell = grid[r + dr * i][c + dc * i]; if (cell && cell !== word[i]) fits = false; }
        if (!fits) continue;
        for (let i = 0; i < word.length; i++) grid[r + dr * i][c + dc * i] = word[i];
        spots[word] = { r, c, dr, dc };
        placed = true;
      }
      if (!placed) { ok = false; break; }
    }
    if (!ok) continue;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (!grid[r][c]) grid[r][c] = FILL[Math.floor(rand() * FILL.length)];
    result = { size, rows: grid.map((row) => row.join('')), spots };
  }
  if (!result) throw new Error('Could not build a grid for ' + entry.id);
  cache.set(key, result);
  return result;
}

// The letters along a straight line (null when the line is not straight or leaves the grid).
function lineOf(g, r1, c1, r2, c2) {
  const nums = [r1, c1, r2, c2];
  if (!nums.every((n) => Number.isInteger(n) && n >= 0 && n < g.size)) return null;
  const dr = Math.sign(r2 - r1), dc = Math.sign(c2 - c1);
  const len = Math.max(Math.abs(r2 - r1), Math.abs(c2 - c1)) + 1;
  if (Math.abs(r2 - r1) !== 0 && Math.abs(c2 - c1) !== 0 && Math.abs(r2 - r1) !== Math.abs(c2 - c1)) return null;
  let s = '';
  for (let i = 0; i < len; i++) s += g.rows[r1 + dr * i][c1 + dc * i];
  return { text: s, dr, dc, len };
}

const grids = (entry) => build(entry, list.indexOf(entry));
reload();

module.exports = {
  get list() { return list; }, reload, save, cleanWords, cleanText, grids, lineOf, FILE,
  MIN_WORDS, MAX_WORDS, MIN_LEN, MAX_LEN,
  byId: (id) => list.find((p) => p.id === id),
};
