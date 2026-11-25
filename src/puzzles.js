'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { hashStr, mulberry32, shuffle } = require('./util');

// Puzzle pictures live OUTSIDE the public folder, so nobody can open them by file name.
// They are only handed out through /pic/<random id>, to logged-in players.
// (public/images is still read as a fallback so older setups keep working, but the
// server never serves that folder.)
const IMAGE_DIRS = process.env.IMAGE_DIR
  ? [process.env.IMAGE_DIR]
  : [path.join(require('./paths').CONTENT_DIR, 'images'), path.join(__dirname, '..', 'public', 'images')];
const IMAGE_DIR = IMAGE_DIRS[0];
const IMAGE_EXTS = ['.jpg', '.jpeg', '.png', '.webp'];

// The puzzle list lives in content/puzzles.json. The admin page edits that file and calls
// reload(), so changes show up without restarting the server. `puzzles` and `byId` are
// refilled IN PLACE, so every other file that already holds them keeps seeing the new list.
const PUZZLES_FILE = process.env.PUZZLES_FILE || path.join(require('./paths').CONTENT_DIR, 'puzzles.json');
const BACKUP_DIR = path.join(path.dirname(PUZZLES_FILE), 'backups');

// The game has exactly two categories ("worlds"). Anything else in puzzles.json counts as Naija.
const WORLDS = ['Naija', 'Universal'];
const worldOf = (c) => (String(c || '').trim().toLowerCase() === 'universal' ? 'Universal' : 'Naija');

const puzzles = [];
const byId = new Map();
let rawList = [];
let publicIds = null;
const poolCache = new Map();

function reload() {
  rawList = JSON.parse(fs.readFileSync(PUZZLES_FILE, 'utf8'));
  puzzles.length = 0;
  for (const p of rawList) {
    puzzles.push({
      id: p.a.toLowerCase(),    // private: used inside the server and the database, never sent to the browser
      answer: p.a.toUpperCase(),
      category: worldOf(p.c),
      img: p.img || null,       // optional: a different picture file name inside content/images
      tiles: p.t || null,       // optional emoji tiles, shown only when the puzzle has no picture
      clue: p.clue,
      fact: p.fact,
    });
  }
  byId.clear();
  for (const p of puzzles) byId.set(p.id, p);
  publicIds = null;
  poolCache.clear();
}
reload();

// The raw entries, exactly as stored in puzzles.json (the admin page edits these).
const rawPuzzles = () => rawList.map((x) => ({ ...x }));

// Save a new list: keep a dated backup of the old file, write the new one safely, reload.
function savePuzzles(list) {
  try {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.copyFileSync(PUZZLES_FILE, path.join(BACKUP_DIR, `puzzles-${stamp}.json`));
    const old = fs.readdirSync(BACKUP_DIR).filter((f) => /^puzzles-.*\.json$/.test(f)).sort();
    for (const f of old.slice(0, Math.max(0, old.length - 30))) fs.unlinkSync(path.join(BACKUP_DIR, f)); // keep the newest 30
  } catch (e) { console.error('Could not write a backup of puzzles.json:', e.message); }
  const tmp = PUZZLES_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(list, null, 1) + '\n');
  fs.renameSync(tmp, PUZZLES_FILE);
  reload();
}
// ---------- public ids ----------
// The browser never sees the real id (which is the answer in small letters). It gets a
// random-looking id that only this server can produce, because it is signed with the
// server secret. Nobody can work backwards from it to the answer.
function loadPublicIds() {
  if (publicIds) return publicIds;
  const secret = require('./db').getSecret();
  const toPublic = new Map();
  const fromPublicMap = new Map();
  for (const p of puzzles) {
    const pid = crypto.createHmac('sha256', secret).update('puzzle:' + p.id).digest('hex').slice(0, 16);
    toPublic.set(p.id, pid);
    fromPublicMap.set(pid, p);
  }
  publicIds = { toPublic, fromPublicMap };
  return publicIds;
}
const publicId = (p) => loadPublicIds().toPublic.get(p.id) || null;
const fromPublic = (pid) => loadPublicIds().fromPublicMap.get(String(pid || '')) || null;

// ---------- pictures ----------
// Each puzzle has ONE picture (your four photos already joined as a collage).
// Save it in content/images and name the file after the answer in small letters
// (jollof.jpg, supereagles.png). No editing of puzzles.json needed. A puzzle can
// also point at a different file with an "img" field. Capital letters in the file
// name do not matter, so Jollof.JPG works too.
function imageIndex() {
  const index = new Map();
  for (const dir of IMAGE_DIRS) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { /* folder does not exist yet */ }
    for (const name of names) {
      const key = name.toLowerCase();
      if (!index.has(key)) index.set(key, { name, file: path.join(dir, name) }); // earlier folders win
    }
  }
  return index;
}

// The picture file on disk for a puzzle, or null.
function imageFile(p, index = imageIndex()) {
  const explicit = p.img && !/^https?:\/\//i.test(p.img) ? path.basename(p.img).toLowerCase() : null;
  const wanted = explicit ? [explicit] : IMAGE_EXTS.map((ext) => p.id + ext);
  for (const w of wanted) {
    const hit = index.get(w);
    if (!hit) continue;
    try { if (fs.statSync(hit.file).isFile()) return hit.file; } catch { /* vanished */ }
  }
  return null;
}

// The link the browser uses. It carries only the random public id, never the file name.
// ?v= changes when you replace the picture, so players never see a stale one.
function imageUrl(p, index = imageIndex()) {
  const file = imageFile(p, index);
  if (!file) return null;
  const st = fs.statSync(file);
  return `/pic/${publicId(p)}?v=${Math.floor(st.mtimeMs)}`;
}

// ---------- letters ----------
const FILLERS = 'ABCDEFGHIKLMNOPRSTUWY';

// The jumbled letters shown to the player. Seeded so a puzzle always shows
// the same pool (reloading the page never reshuffles or leaks anything).
function poolFor(p) {
  if (poolCache.has(p.id)) return poolCache.get(p.id);
  const rnd = mulberry32(hashStr(p.id));
  const size = Math.max(12, p.answer.length + 2);
  const letters = p.answer.split('');
  while (letters.length < size) letters.push(FILLERS[Math.floor(rnd() * FILLERS.length)]);
  const pool = shuffle(letters, rnd);
  poolCache.set(p.id, pool);
  return pool;
}

// What the browser is allowed to see. Never includes the answer, the real id, the clue or the fact.
// `image` is the collage picture; `tiles` (emoji) is only sent when there is no picture.
function view(p, extra = {}) {
  const image = imageUrl(p);
  return {
    id: publicId(p),
    category: p.category,
    image,
    tiles: image ? null : p.tiles,
    length: p.answer.length,
    pool: poolFor(p),
    ...extra,
  };
}

const normalize = (g) => String(g || '').toUpperCase().replace(/[^A-Z]/g, '');
const isCorrect = (p, guess) => normalize(guess) === p.answer;

// Always both categories, in this order, even when one has no puzzles yet.
function categories() {
  return WORLDS.map((name) => ({ name, count: puzzles.filter((p) => p.category === name).length }));
}

module.exports = {
  puzzles, byId, view, reload, rawPuzzles, savePuzzles, PUZZLES_FILE, isCorrect, normalize, categories, WORLDS, worldOf,
  publicId, fromPublic,
  imageUrl, imageFile, imageIndex, IMAGE_DIR, IMAGE_DIRS, IMAGE_EXTS,
};
