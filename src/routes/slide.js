'use strict';
// Sliding puzzle: slide the pieces of a picture into place. Levels go in order (see src/slide.js).
// The server keeps the board and checks every slide, so nobody can skip ahead.
const { save } = require('../db');
const { HttpError } = require('../util');
const SL = require('../slide');
const Points = require('../points');
const Premium = require('../premium');

const PEEK_COST = 5;
const SOLVE_COINS = 10;
const CHEST_EVERY = 10;
const CHEST_COINS = 25;
const WORLD = 'Slide Puzzle';

const stateOf = (u) => (u.sl = u.sl || { done: {}, cur: null });
const doneCount = (u) => SL.list.filter((p) => stateOf(u).done[p.id] != null).length;
const nextEntry = (u) => SL.list.find((p) => stateOf(u).done[p.id] == null && SL.hasPicture(p.id)) || null;
const ready = () => SL.list.filter((e) => SL.hasPicture(e.id)).length;
const stats = (u) => ({ coins: u.coins, points: u.points, ready: ready() });

// The player keeps the same board until they finish the level.
function currentOf(u) {
  const entry = nextEntry(u);
  if (!entry) return null;
  const s = stateOf(u);
  if (!s.cur || s.cur.id !== entry.id || !SL.validBoard(s.cur.board, entry.size)) s.cur = { id: entry.id, board: SL.shuffled(entry.size), moves: 0, peeks: 0 };
  return entry;
}
const viewOf = (u, entry) => {
  const cur = stateOf(u).cur;
  return { id: entry.id, title: entry.title || '', size: entry.size, image: SL.urlOf(entry.id), board: cur.board.slice(), moves: cur.moves, secs: cur.secs || 0, level: doneCount(u) + 1, total: SL.list.length, peekCost: PEEK_COST };
};
function entryFor(ctx) {
  const entry = currentOf(ctx.user);
  if (!entry || entry.id !== String(ctx.body.id)) throw new HttpError(409, 'The admin just updated the sliding puzzle. Loading the current one...');
  return entry;
}

function complete(u, entry) {
  const s = stateOf(u), cur = s.cur;
  const earned = SL.pointsFor(entry.size, cur.moves, cur.peeks);
  s.done[entry.id] = earned;
  require('../stats').bump('solve:Slide Puzzle');
  Points.add(u, earned, WORLD);
  u.coins += SOLVE_COINS;
  const moves = cur.moves;
  s.cur = null;
  const done = doneCount(u);
  const chest = done % CHEST_EVERY === 0 ? CHEST_COINS : 0;
  u.coins += chest;
  const inviteBonus = require('./invites').firstSolve(u);
  return Premium.gate(u, {
    complete: true, earned, moves, coins_earned: SOLVE_COINS + chest, level: done, title: entry.title || '', fact: entry.fact || '', inviteBonus,
    chest: { opened: chest, every: CHEST_EVERY, bonus: CHEST_COINS, toGo: CHEST_EVERY - (done % CHEST_EVERY || CHEST_EVERY) || CHEST_EVERY },
    allDone: !nextEntry(u),
  });
}

// How long the player has spent on this level, so the clock carries on when they come back. Display only; it never changes points.
const keepSecs = (cur, v) => { const n = Math.floor(Number(v)); if (Number.isFinite(n) && n >= 0) cur.secs = Math.max(cur.secs || 0, Math.min(n, 86400)); };

module.exports = ({ route }) => {
  // Called when the player leaves the page, so the time up to that moment is kept.
  route('POST', '/api/sl/time', (ctx) => {
    const u = ctx.user, entry = currentOf(u);
    if (entry && entry.id === String(ctx.body.id)) { keepSecs(stateOf(u).cur, ctx.body.secs); save(); }
    return { ok: true };
  }, { auth: true });

  route('GET', '/api/sl/state', (ctx) => {
    const u = ctx.user;
    const entry = currentOf(u);
    if (!entry) return { done: true, empty: !SL.list.length, level: doneCount(u), total: SL.list.length, ...stats(u) };
    save();
    return { puzzle: viewOf(u, entry), ...stats(u) };
  }, { auth: true });

  route('POST', '/api/sl/move', (ctx) => {
    const u = ctx.user, entry = entryFor(ctx), cur = stateOf(u).cur;
    const pos = ctx.body.pos;
    keepSecs(cur, ctx.body.secs);
    if (!SL.slide(cur.board, entry.size, pos)) return { moved: false, board: cur.board.slice(), moves: cur.moves };
    cur.moves++;
    const out = { moved: true, board: cur.board.slice(), moves: cur.moves };
    if (SL.isSolved(cur.board)) Object.assign(out, complete(u, entry));
    save();
    return { ...out, ...stats(u) };
  }, { auth: true });

  // Peek at the finished picture. It costs a few coins and a few points off this level.
  route('POST', '/api/sl/peek', (ctx) => {
    const u = ctx.user, entry = entryFor(ctx), cur = stateOf(u).cur;
    if (u.coins < PEEK_COST) throw new HttpError(402, `You need ${PEEK_COST} coins to peek at the picture.`);
    u.coins -= PEEK_COST;
    cur.peeks++;
    save();
    return { ok: true, ...stats(u) };
  }, { auth: true });
};

module.exports.progressOf = (u) => ({ level: doneCount(u) + 1, done: doneCount(u), total: SL.list.length });
module.exports.PEEK_COST = PEEK_COST;
