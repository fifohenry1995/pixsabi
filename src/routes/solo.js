'use strict';
const { db, save } = require('../db');
const { HttpError } = require('../util');
const P = require('../puzzles');
const Points = require('../points');

const LETTER_COST = 15;
const CLUE_COST = 5;
const SKIP_COST = 20;
const SOLVE_COINS = 10;
// A treasure chest every 10th level you finish in a category: bonus coins.
const CHEST_EVERY = 10;
const CHEST_COINS = 25;

// Inside the server a puzzle is identified by its private id. The browser only ever
// sees (and sends back) the random public id, so the answer never appears in a request.
const progressOf = (u, id) => (u.progress[id] = u.progress[id] || { letters: {}, clue: false });
// Levels are counted separately for each category (Naija and Universal).
const solvedIn = (u, cat) => Object.keys(u.solved).filter((id) => { const p = P.byId.get(id); return p && (!cat || p.category === cat); }).length;
const levelsOf = (u) => ({ Naija: solvedIn(u, 'Naija') + 1, Universal: solvedIn(u, 'Universal') + 1 });
const statsOf = (u, cat) => ({
  coins: u.coins,
  points: u.points,
  solvedCount: solvedIn(u, cat || null),
  total: cat ? P.puzzles.filter((p) => p.category === cat).length : P.puzzles.length,
});

// Letters and clue the player already paid for are returned with the puzzle,
// so reloading the page never loses (or double-charges) a hint.
function soloView(u, p) {
  const prog = progressOf(u, p.id);
  return P.view(p, { revealed: prog.letters, clue: prog.clue ? p.clue : null });
}

const solvePoints = (prog) =>
  Math.max(40, 100 - 20 * Object.keys(prog.letters).length - (prog.clue ? 10 : 0));

function getPuzzle(publicId) {
  const p = P.fromPublic(publicId);
  if (!p) throw new HttpError(404, 'We could not find that puzzle.');
  return p;
}

module.exports = ({ route }) => {
  route('GET', '/api/solo/map', (ctx) => {
    const cat = P.worldOf(ctx.query.category);
    return { category: cat, solved: solvedIn(ctx.user, cat), total: P.puzzles.filter((p) => p.category === cat).length, chestEvery: CHEST_EVERY, chestCoins: CHEST_COINS };
  }, { auth: true });

  route('GET', '/api/categories', () => ({ categories: P.categories() }), { auth: true });

  // Which puzzles this player can still get in this category (Naija or Universal; anything else means Naija).
  const poolFor = (u, cat) => P.puzzles.filter((p) => !u.solved[p.id] && p.category === cat);

  route('GET', '/api/solo/next', (ctx) => {
    const u = ctx.user;
    const cat = P.worldOf(ctx.query.category);
    const pool = poolFor(u, cat);
    if (!pool.length) {
      return { done: true, category: cat, empty: !P.puzzles.some((p) => p.category === cat), ...statsOf(u, cat) };
    }
    // The player keeps the same puzzle until they solve it or skip it, so leaving the Play
    // screen and coming back (or refreshing the page) never swaps the puzzle. One current
    // puzzle is remembered per category.
    u.current = u.current || {};
    let p = P.byId.get(u.current[cat]);
    if (!p || !pool.includes(p)) p = pool[Math.floor(Math.random() * pool.length)];
    u.current[cat] = p.id;
    save();
    return { puzzle: soloView(u, p), category: cat, ...statsOf(u, cat) };
  }, { auth: true });

  // Skipping costs coins. The server picks the next puzzle, so the only way to a new puzzle is to pay.
  route('POST', '/api/solo/skip', (ctx) => {
    const u = ctx.user;
    const p = getPuzzle(ctx.body.id);
    const cat = p.category; // the puzzle decides which category it belongs to
    if (ctx.body.category && !P.WORLDS.includes(ctx.body.category)) throw new HttpError(400, 'Pick Naija or Universal.');
    if (u.solved[p.id]) throw new HttpError(409, 'You already solved this one.');
    u.current = u.current || {};
    if (u.current[cat] !== p.id) throw new HttpError(409, 'That is not the puzzle you are playing now. Reload the page.');
    if (u.coins < SKIP_COST) throw new HttpError(402, `You need ${SKIP_COST} coins to skip. Solve a puzzle to earn 10.`);
    const pool = poolFor(u, cat);
    const others = pool.filter((q) => q !== p);
    u.coins -= SKIP_COST;
    if (others.length) u.current[cat] = others[Math.floor(Math.random() * others.length)].id; // last one left stays
    save();
    return { skipped: true, ...statsOf(u, cat) };
  }, { auth: true });

  route('POST', '/api/solo/guess', (ctx) => {
    const u = ctx.user;
    const p = getPuzzle(ctx.body.id);
    if (u.solved[p.id]) throw new HttpError(409, 'You already solved this one.');
    if (!P.isCorrect(p, ctx.body.guess)) return { correct: false };
    const prog = progressOf(u, p.id);
    const earned = solvePoints(prog);
    u.solved[p.id] = earned;
    require('../stats').bump('solve:' + p.category);
    Points.add(u, earned, p.category);
    u.coins += SOLVE_COINS;
    delete u.progress[p.id];
    for (const k of Object.keys(u.current || {})) if (u.current[k] === p.id) delete u.current[k];
    const done = solvedIn(u, p.category);
    const chest = done % CHEST_EVERY === 0 ? CHEST_COINS : 0;
    u.coins += chest;
    const inviteBonus = require('./invites').firstSolve(u);
    save();
    return require('../premium').gate(u, {
      correct: true, answer: p.answer, fact: p.fact, earned, coins_earned: SOLVE_COINS + chest,
      chest: { opened: chest, every: CHEST_EVERY, bonus: CHEST_COINS, toGo: CHEST_EVERY - (done % CHEST_EVERY || CHEST_EVERY) || CHEST_EVERY },
      category: p.category, inviteBonus, ...statsOf(u, p.category),
    });
  }, { auth: true });

  route('POST', '/api/solo/hint', (ctx) => {
    const u = ctx.user;
    const p = getPuzzle(ctx.body.id);
    if (u.solved[p.id]) throw new HttpError(409, 'You already solved this one.');
    const prog = progressOf(u, p.id);

    if (ctx.body.type === 'clue') {
      if (prog.clue) return { clue: p.clue, ...statsOf(u, p.category) };
      if (u.coins < CLUE_COST) throw new HttpError(402, `You need ${CLUE_COST} coins for a clue.`);
      u.coins -= CLUE_COST;
      prog.clue = true;
      save();
      return { clue: p.clue, ...statsOf(u, p.category) };
    }

    if (ctx.body.type === 'letter') {
      const open = [];
      for (let i = 0; i < p.answer.length; i++) if (!(i in prog.letters)) open.push(i);
      if (!open.length) throw new HttpError(400, 'Every letter is already showing.');
      if (u.coins < LETTER_COST) throw new HttpError(402, `You need ${LETTER_COST} coins to reveal a letter.`);
      const index = open[Math.floor(Math.random() * open.length)];
      u.coins -= LETTER_COST;
      prog.letters[index] = p.answer[index];
      save();
      return { index, letter: p.answer[index], ...statsOf(u, p.category) };
    }
    throw new HttpError(400, 'Unknown hint type.');
  }, { auth: true });
};

module.exports.statsOf = statsOf;
module.exports.levelsOf = levelsOf;
// Current level in all four games, for profiles. (Required inside the function to avoid a loading loop between route files.)
module.exports.allLevelsOf = (u) => ({
  ...levelsOf(u),
  'Word Search': require('./wordsearch').progressOf(u).level,
  'Slide Puzzle': require('./slide').progressOf(u).level,
});
