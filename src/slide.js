'use strict';
// Sliding puzzle levels. The list lives in content/slide.json (or SLIDE_FILE on a host with a persistent disk).
// Each level is a picture the admin uploaded (saved as <id>.jpg in content/slide, or SLIDE_DIR), a title and a grid size.
// Boards are arrays of tile numbers: board[position] = tile. The finished board is [0, 1, 2, ...] and the last tile is the gap.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const P = require('./puzzles');

const FILE = process.env.SLIDE_FILE || path.join(__dirname, '..', 'content', 'slide.json');
const DIR = process.env.SLIDE_DIR || path.join(__dirname, '..', 'content', 'slide');
const SIZES = [3, 4, 5];
const BASE = { 3: 60, 4: 100, 5: 160 };   // points for finishing a level of that grid size
const PAR = { 3: 30, 4: 80, 5: 160 };     // finishing within this many slides earns a bonus

let list = [];
function reload() {
  try { list = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { list = []; }
  list = list.filter((p) => p && /^s[0-9a-f]{8}$/.test(p.id) && SIZES.includes(p.size));
  return list;
}
function save(next) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, FILE);
  reload();
}
const fileOf = (id) => path.join(DIR, `${id}.jpg`);
// A level either has its own uploaded picture, or borrows the picture of a Naija puzzle (entry.from = that puzzle's id), which costs no extra space.
function pictureFile(id) {
  const e = list.find((p) => p.id === id);
  if (e && e.from) { const pz = P.byId.get(e.from); return pz ? P.imageFile(pz) : null; }
  return fileOf(id);
}
const hasPicture = (id) => { const f = pictureFile(id); try { return !!f && fs.statSync(f).isFile(); } catch { return false; } };
const urlOf = (id) => { const f = pictureFile(id); try { return f ? `/sl/${id}?v=${Math.floor(fs.statSync(f).mtimeMs)}` : null; } catch { return null; } };
const newId = () => 's' + crypto.randomBytes(4).toString('hex');
const cleanText = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

// ---- boards ----
const solvedBoard = (size) => Array.from({ length: size * size }, (_, i) => i);
const isSolved = (board) => board.every((t, i) => t === i);

// Slides the tile at `pos` into the gap when it touches it. Returns true when something moved.
function slide(board, size, pos) {
  if (!Number.isInteger(pos) || pos < 0 || pos >= board.length) return false;
  const gap = board.indexOf(board.length - 1);
  const dr = Math.abs(Math.floor(pos / size) - Math.floor(gap / size));
  const dc = Math.abs((pos % size) - (gap % size));
  if (dr + dc !== 1) return false;
  board[gap] = board[pos]; board[pos] = board.length - 1;
  return true;
}

// A shuffled board that is always solvable: start from the finished picture and make many legal slides.
function shuffled(size, rand = Math.random) {
  for (;;) {
    const board = solvedBoard(size);
    let gap = board.length - 1, last = -1;
    const steps = size * size * 14;
    for (let i = 0; i < steps; i++) {
      const r = Math.floor(gap / size), c = gap % size, opts = [];
      if (r > 0) opts.push(gap - size);
      if (r < size - 1) opts.push(gap + size);
      if (c > 0) opts.push(gap - 1);
      if (c < size - 1) opts.push(gap + 1);
      const pick = opts.filter((p) => p !== last);
      const to = pick[Math.floor(rand() * pick.length)];
      board[gap] = board[to]; board[to] = board.length - 1; last = gap; gap = to;
    }
    if (!isSolved(board)) return board;
  }
}
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest().readUInt32LE(0);
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
// The same shuffle for the same seed: every racer in a race gets the same start.
const shuffledFor = (size, seed) => shuffled(size, rng(hash(seed)));

// Is this a real board for that grid size (the server keeps boards, but never trusts old data blindly)?
const validBoard = (board, size) => Array.isArray(board) && board.length === size * size && board.slice().sort((a, b) => a - b).every((t, i) => t === i);

// Points for a level: more for bigger grids, less for each peek, and a bonus for few slides.
function pointsFor(size, moves, peeks) {
  const base = BASE[size] || 60;
  const kept = Math.max(Math.floor(base * 0.4), base - 10 * (peeks | 0));
  const par = PAR[size] || 30;
  const bonus = moves <= par ? Math.floor(base * 0.2) : moves <= par * 2 ? Math.floor(base * 0.1) : 0;
  return kept + bonus;
}

reload();

module.exports = {
  get list() { return list; }, reload, save, newId, cleanText, fileOf, pictureFile, hasPicture, urlOf, DIR, FILE,
  SIZES, BASE, PAR, solvedBoard, isSolved, slide, shuffled, shuffledFor, validBoard, pointsFor,
  byId: (id) => list.find((p) => p.id === id),
};
