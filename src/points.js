'use strict';
// Points: one place that adds them, so the total, the per-category totals and this week's points always agree.
// Points never go down and cannot be spent. They decide rank titles, photo frames and the leaderboards.
const { db, q, meta, save } = require('./db');
const P = require('./puzzles');
const { notify } = require('./notify');

const WORD_SEARCH = 'Word Search';
const SLIDE = 'Slide Puzzle';
const BOARD_OF = { Naija: 'naija', Universal: 'universal', [WORD_SEARCH]: 'wordsearch', [SLIDE]: 'slide' };
const LABEL_OF = { Naija: 'Naija', Universal: 'Universal', [WORD_SEARCH]: 'Word Search', [SLIDE]: 'Slide Puzzle' };
const PASS_GAP_MS = 24 * 3600 * 1000; // a player hears about being passed once a day per board
const PASS_MAX = 5;                   // and one big jump alerts at most the 5 closest players

// ---- the weekly leaderboard runs Monday 00:00 to Sunday 23:59 Lagos time ----
const lagosYmd = (d) => d.toLocaleDateString('en-CA', { timeZone: 'Africa/Lagos' });
function weekIdOf(now = new Date()) {
  const [y, m, d] = lagosYmd(now).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7)); // back to Monday
  return dt.toISOString().slice(0, 10);
}
const prevWeekIdOf = (now = new Date()) => weekIdOf(new Date(now.getTime() - 7 * 86_400_000));
// When the current week ends (next Monday 00:00 Lagos, which is UTC+1 all year), in ms since 1970.
function weekEndsAt(now = new Date()) {
  const [y, m, d] = weekIdOf(now).split('-').map(Number);
  return Date.UTC(y, m - 1, d + 7) - 3600_000;
}

// ---- per-category totals; players from before this update are worked out from what they already solved ----
function ensure(u) {
  if (u.pts) return u.pts;
  let uni = 0;
  for (const [id, earned] of Object.entries(u.solved || {})) {
    const p = P.byId.get(id);
    if (p && p.category === 'Universal') uni += earned | 0;
  }
  u.pts = { Naija: Math.max(0, (u.points | 0) - uni), Universal: uni };
  return u.pts;
}

let rollHook = null; // set by weekly.js: pays last week's prizes before anybody starts a new week
const setRollHook = (fn) => { rollHook = fn; };

function add(u, amount, category) {
  amount = Math.max(0, Math.floor(Number(amount) || 0));
  if (!amount) return 0;
  const pts = ensure(u);
  const cat = category === WORD_SEARCH || category === SLIDE ? category : P.worldOf(category);
  const before = pts[cat] | 0;
  u.points += amount;
  pts[cat] = before + amount;
  const wk = weekIdOf();
  if (!u.week || u.week.id !== wk) {
    if (rollHook) { try { rollHook(); } catch (e) { console.error('[weekly]', e.message); } }
    u.week = { id: wk, pts: 0 };
  }
  u.week.pts += amount;
  try { alertPassed(u, cat, before, pts[cat]); } catch (e) { console.error('[ranks]', e.message); }
  return amount;
}

// Somebody just moved above other players on a board: tell them (the alert also shows on the Ranks page next time it loads).
function alertPassed(u, cat, before, after) {
  const board = BOARD_OF[cat];
  if (!board || !before) return;       // nobody can be passed by a player's very first points
  const now = Date.now();
  for (const v of q.passedBy(board, before, after, u.id, PASS_MAX)) {
    const mine = (ensure(v)[cat] | 0);
    v.passAlert = v.passAlert || {};
    if (now - (v.passAlert[board] || 0) < PASS_GAP_MS) continue;
    v.passAlert[board] = now;
    notify(v.id, { kind: 'rank', from: u.id, title: `${u.username} passed you in ${LABEL_OF[cat]} ranks`, body: `They now have ${after} points and you have ${mine}. Play to take your place back!`, url: '#/ranks' });
  }
}

// One-time: give every existing player their category points (so the Naija and Universal boards are right from day one).
function migrate() {
  if (meta.get('points_migrated') !== '1') {
    for (const id of q.allUserIds()) { const u = db.users[id]; if (u) ensure(u); }
    save();
    meta.set('points_migrated', '1');
  }
  // one time: Word Search got its own board. Points players already earned in solo word searches move there from Naija.
  if (meta.get('ws_points_migrated') !== '1') {
    for (const id of q.allUserIds()) {
      const u = db.users[id];
      if (!u || !u.ws || !u.ws.done) continue;
      const sum = Object.values(u.ws.done).reduce((a, b) => a + (b | 0), 0);
      if (!sum) continue;
      const pts = ensure(u);
      const move = Math.min(sum, pts.Naija | 0);
      pts.Naija = (pts.Naija | 0) - move;
      pts[WORD_SEARCH] = (pts[WORD_SEARCH] | 0) + move;
    }
    save();
    meta.set('ws_points_migrated', '1');
  }
}

module.exports = { add, ensure, migrate, weekIdOf, prevWeekIdOf, weekEndsAt, setRollHook };
