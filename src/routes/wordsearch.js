'use strict';
// Word Search: find the hidden words in a grid of letters. Levels go in order (see src/wordsearch.js).
const { save } = require('../db');
const { HttpError } = require('../util');
const WS = require('../wordsearch');
const Points = require('../points');

const LETTER_COST = 10;   // shows where one word starts
const WORD_COST = 30;     // finds one word for the player
const SOLVE_COINS = 10;
const CHEST_EVERY = 10;
const CHEST_COINS = 25;
const WORLD = 'Word Search'; // word search points have their own Ranks board; they also count toward the overall total and the weekly board

const stateOf = (u) => (u.ws = u.ws || { done: {}, cur: null });
const doneCount = (u) => WS.list.filter((p) => stateOf(u).done[p.id]).length;
const nextEntry = (u) => WS.list.find((p) => !stateOf(u).done[p.id]) || null;
const stats = (u) => ({ coins: u.coins, points: u.points });

// The player keeps the same puzzle (and what they already found) until they finish it.
function currentOf(u) {
  const entry = nextEntry(u);
  if (!entry) return null;
  const s = stateOf(u);
  if (!s.cur || s.cur.id !== entry.id) s.cur = { id: entry.id, found: {}, letters: [], revealed: [] };
  return entry;
}

function viewOf(u, entry) {
  const g = WS.grids(entry), cur = stateOf(u).cur;
  const found = [];
  for (const [word, [r, c, dr, dc]] of Object.entries(cur.found)) {
    if (!entry.words.includes(word)) continue;
    const here = WS.lineOf(g, r, c, r + dr * (word.length - 1), c + dc * (word.length - 1));
    if (here && here.text === word) found.push({ word, r, c, dr, dc });
    else { const s = g.spots[word]; if (s) found.push({ word, r: s.r, c: s.c, dr: s.dr, dc: s.dc }); }
  }
  const hinted = cur.letters.filter((w) => entry.words.includes(w) && !cur.found[w]).map((w) => [g.spots[w].r, g.spots[w].c]);
  return {
    id: entry.id, theme: entry.theme || '', size: g.size, rows: g.rows,
    words: entry.words.slice(), found, hinted,
    level: doneCount(u) + 1, total: WS.list.length,
    letterCost: LETTER_COST, wordCost: WORD_COST, secs: cur.secs || 0,
  };
}

function entryFor(ctx) {
  const entry = currentOf(ctx.user);
  if (!entry || entry.id !== String(ctx.body.id)) throw new HttpError(409, 'The admin just updated the word search. Loading the current one...');
  return entry;
}

// All words found: pay out and move on to the next level.
function complete(u, entry) {
  const s = stateOf(u), cur = s.cur;
  const base = 20 * entry.words.length;
  const earned = Math.max(Math.floor(base * 0.4), base - 10 * cur.letters.length - 20 * cur.revealed.length);
  s.done[entry.id] = earned;
  require('../stats').bump('solve:Word Search');
  Points.add(u, earned, WORLD);
  u.coins += SOLVE_COINS;
  s.cur = null;
  const done = doneCount(u);
  const chest = done % CHEST_EVERY === 0 ? CHEST_COINS : 0;
  u.coins += chest;
  const inviteBonus = require('./invites').firstSolve(u);
  return require('../premium').gate(u, {
    complete: true, earned, coins_earned: SOLVE_COINS + chest, level: done, theme: entry.theme || '', fact: entry.fact || '',
    words: entry.words.slice(), inviteBonus,
    chest: { opened: chest, every: CHEST_EVERY, bonus: CHEST_COINS, toGo: CHEST_EVERY - (done % CHEST_EVERY || CHEST_EVERY) || CHEST_EVERY },
    allDone: !nextEntry(u),
  });
}

// How long the player has spent on this level, so the clock carries on when they come back. Display only; it never changes points.
const keepSecs = (cur, v) => { const n = Math.floor(Number(v)); if (Number.isFinite(n) && n >= 0) cur.secs = Math.max(cur.secs || 0, Math.min(n, 86400)); };

module.exports = ({ route }) => {
  // Called when the player leaves the page, so the time up to that moment is kept.
  route('POST', '/api/ws/time', (ctx) => {
    const u = ctx.user, entry = currentOf(u);
    if (entry && entry.id === String(ctx.body.id)) { keepSecs(stateOf(u).cur, ctx.body.secs); save(); }
    return { ok: true };
  }, { auth: true });

  route('GET', '/api/ws/state', (ctx) => {
    const u = ctx.user;
    const entry = currentOf(u);
    if (!entry) return { done: true, empty: !WS.list.length, level: doneCount(u), total: WS.list.length, ...stats(u) };
    save();
    return { puzzle: viewOf(u, entry), ...stats(u) };
  }, { auth: true });

  route('POST', '/api/ws/select', (ctx) => {
    const u = ctx.user, entry = entryFor(ctx), cur = stateOf(u).cur;
    const b = ctx.body;
    const g = WS.grids(entry);
    keepSecs(cur, b.secs);
    const line = WS.lineOf(g, b.r1, b.c1, b.r2, b.c2);
    if (!line || line.len < 2) return { found: false };
    const rev = line.text.split('').reverse().join('');
    const word = entry.words.find((w) => !cur.found[w] && (w === line.text || w === rev));
    if (!word) return { found: false };
    // store the line from the first letter of the word to its last, whichever way the player dragged
    const forward = word === line.text;
    const r = forward ? b.r1 : b.r2, c = forward ? b.c1 : b.c2;
    const dr = forward ? line.dr : -line.dr, dc = forward ? line.dc : -line.dc;
    cur.found[word] = [r, c, dr, dc];
    const out = { found: true, word, r, c, dr, dc, left: entry.words.filter((w) => !cur.found[w]).length };
    if (!out.left) Object.assign(out, complete(u, entry));
    save();
    return { ...out, ...stats(u) };
  }, { auth: true });

  route('POST', '/api/ws/hint', (ctx) => {
    const u = ctx.user, entry = entryFor(ctx), cur = stateOf(u).cur;
    const g = WS.grids(entry);
    const open = entry.words.filter((w) => !cur.found[w]);
    if (!open.length) throw new HttpError(400, 'Every word is already found.');
    if (ctx.body.type === 'letter') {
      const fresh = open.filter((w) => !cur.letters.includes(w));
      if (!fresh.length) throw new HttpError(400, 'Every word that is left already has its first letter marked.');
      if (u.coins < LETTER_COST) throw new HttpError(402, `You need ${LETTER_COST} coins to mark a first letter.`);
      const word = fresh[Math.floor(Math.random() * fresh.length)];
      u.coins -= LETTER_COST;
      cur.letters.push(word);
      save();
      return { r: g.spots[word].r, c: g.spots[word].c, ...stats(u) };
    }
    if (ctx.body.type === 'word') {
      if (u.coins < WORD_COST) throw new HttpError(402, `You need ${WORD_COST} coins to reveal a word.`);
      const word = open[Math.floor(Math.random() * open.length)];
      const s = g.spots[word];
      u.coins -= WORD_COST;
      cur.found[word] = [s.r, s.c, s.dr, s.dc];
      if (!cur.revealed.includes(word)) cur.revealed.push(word);
      const out = { word, r: s.r, c: s.c, dr: s.dr, dc: s.dc, left: open.length - 1 };
      if (!out.left) Object.assign(out, complete(u, entry));
      save();
      return { ...out, ...stats(u) };
    }
    throw new HttpError(400, 'Unknown hint type.');
  }, { auth: true });
};

module.exports.progressOf = (u) => ({ level: doneCount(u) + 1, done: doneCount(u), total: WS.list.length });
module.exports.LETTER_COST = LETTER_COST;
module.exports.WORD_COST = WORD_COST;
