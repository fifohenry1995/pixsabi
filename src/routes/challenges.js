'use strict';
// Challenges for 2 to 20 players.
//
// RACES (every new challenge): the creator picks how many levels to race (20 up to the
// number of puzzles in the game). Everyone gets the same levels. Players join the lobby, the
// creator taps "Start race", and then everybody plays at the same time. The first player to
// finish ALL the levels wins and the race ends right there. A skipped level costs points
// and comes back at the end of your list, so you cannot "finish" by skipping everything.
//
// STAKES (optional): the creator sets one coin stake that every player pays when they join.
// The coins are held in the race's pot. The winner takes the whole pot (or, if the host chose it in a race of 9+ players, the top 3 share it 60/25/15). If the host cancels, a
// player leaves the lobby, or nobody starts the race within 24 hours, stakes are refunded.
// Once the race has started there are no refunds.
//
// OLDER challenges (made before races existed, 5 puzzles each) keep working the old way:
// everyone plays on their own time and the highest score wins once all players are done.
const crypto = require('crypto');
const { db, q, save, avatarUrl } = require('../db');
const Verify = require('../verify');
const { HttpError, shuffle } = require('../util');
const P = require('../puzzles');
const { notify } = require('../notify');
const Points = require('../points');
const { tagOf } = require('../titles');
const WS = require('../wordsearch');
const WS_CATEGORY = 'Word Search';
const SL = require('../slide');
const Premium = require('../premium');
const SL_CATEGORY = 'Slide Puzzle';
const SL_MIN = 3;            // a sliding puzzle race needs at least this many levels
const WS_POINTS = 20;        // points per word found in a word search race

const ROUNDS = 5;            // old-style challenges
const MIN_LEVELS = 20;       // races
const DEFAULT_LEVELS = 20;
const MAX_STAKE = 1000;      // coins per player
const STALE_MS = 24 * 3600 * 1000; // an unstarted staked race is refunded after this long
const LOBBY_MS = 48 * 3600 * 1000;      // an unstarted free race lobby is closed after this long
const KEEP_DAYS = Math.max(1, Number(process.env.RACE_KEEP_DAYS) || 5); // finished / cancelled races are deleted this many days after they end
const KEEP_MS = KEEP_DAYS * 24 * 3600 * 1000;
const ABANDON_MS = 3 * 24 * 3600 * 1000; // a started race is ended this long after it started
const WS_MIN = 3;
const MAX_PLAYERS = 20;
const SPLIT_MIN_PLAYERS = 9;   // the host may share the pot between the top 3 in races that allow more than 8 players
const SPLIT_SHARES = { 1: [100], 2: [70, 30], 3: [60, 25, 15] };
const OPEN_LIMIT = 10;
const SPONSOR_MAX = 200;   // a sponsored race can take many more players than a friends' race
const SKIP_PENALTY = 10; // points taken off for skipping a puzzle
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function makeCode() {
  for (;;) {
    let c = '';
    for (let i = 0; i < 6; i++) c += CODE_CHARS[crypto.randomInt(CODE_CHARS.length)];
    if (!db.challenges[c]) return c;
  }
}

const isRace = (ch) => !!ch.race;
const isWs = (ch) => ch.game === 'wordsearch';
const isSl = (ch) => ch.game === 'slide';
const gameOf = (ch) => (isWs(ch) ? 'wordsearch' : isSl(ch) ? 'slide' : 'pictures');
const roundsOf = (ch) => ch.rounds || ROUNDS;

// queue = positions (into ch.puzzleIds) still to solve, in play order. Skipped ones go to the back.
const newPlayer = (u, ch) => ({
  username: u.username, idx: 0, startedAt: null, wrong: 0,
  score: 0, results: [], finishedAt: null,
  ...(ch && isRace(ch) ? { solved: 0, queue: Array.from({ length: ch.rounds }, (_, i) => i) } : {}),
});

// How many of this challenge's levels come from its chosen category (a small category is topped up from others).
function inCategory(ch) {
  if (!ch.category || isWs(ch) || isSl(ch)) return roundsOf(ch);
  return (ch.puzzleIds || []).filter((id) => { const p = P.byId.get(id); return p && p.category === ch.category; }).length;
}

// ---- stakes ----
const stakeOf = (ch) => ch.stake || 0;
const potOf = (ch) => ch.pot || 0;
// Takes the stake from a player (throws 402 if they cannot afford it) and puts it in the pot.
function takeStake(ch, u, player) {
  const stake = stakeOf(ch);
  if (!stake) return;
  if (Verify.pending(u)) throw new HttpError(403, 'Confirm your email first (open the link we sent you) to play staked races.');
  if (u.coins < stake) throw new HttpError(402, `You need ${stake} coins to join this race. You have ${u.coins}.`);
  u.coins -= stake;
  ch.pot = potOf(ch) + stake;
  player.staked = stake;
}
// Gives one player's stake back (only ever once: staked goes to 0).
function refundPlayer(ch, id) {
  const p = ch.players[id];
  if (!p || !p.staked) return;
  const u = db.users[id];
  if (u) u.coins += p.staked;
  ch.pot = Math.max(0, potOf(ch) - p.staked);
  p.staked = 0;
}
function cancelRace(ch) {
  for (const id of Object.keys(ch.players)) refundPlayer(ch, id);
  ch.status = 'cancelled';
  ch.closed = true;
  ch.endedAt = Date.now();
}
// Housekeeping, run hourly: nobody's coins stay stuck and forgotten lobbies stop counting as "open".
//  - staked race nobody started for 24 hours: everyone refunded
//  - free race nobody started for 48 hours: closed
//  - started race still running 3 days after the start: ended (see endAbandonedRace)
function sweepStale() {
  const now = Date.now();
  let refunded = 0, closedLobbies = 0, ended = 0;
  for (const ch of q.staleWaiting(now - STALE_MS)) {
    if (!isRace(ch) || ch.startedAt || ch.status !== 'waiting' || ch.sponsor) continue;   // a sponsored lobby waits for the admin to start or cancel it
    const staked = stakeOf(ch) > 0;
    if (!staked && (ch.createdAt || 0) > now - LOBBY_MS) continue;
    cancelRace(ch);
    for (const id of Object.keys(ch.players)) notify(id, { kind: 'finish', title: 'Race closed', body: staked ? 'Nobody started the race in time, so your stake was refunded.' : 'Nobody started the race in time, so it was closed.', url: `#/c/${ch.id}` });
    if (staked) refunded++; else closedLobbies++;
  }
  for (const ch of q.activeRaces()) {
    if (!isRace(ch) || ch.status !== 'active' || !ch.startedAt || ch.startedAt > now - ABANDON_MS) continue;
    endAbandonedRace(ch);
    ended++;
  }
  let removed = 0;
  for (const ch of q.finishedBefore(now - KEEP_MS)) {
    if (ch.sponsor) continue;                                       // sponsored races stay: advertiser and investor reports use them
    if ((ch.endedAt || ch.createdAt || 0) > now - KEEP_MS) continue;
    delete db.challenges[ch.id];
    removed++;
  }
  if (removed) console.log(`[races] clean-up: ${removed} old finished race(s) deleted`);
  if (refunded || closedLobbies || ended) {
    save();
    console.log(`[races] sweep: ${refunded} unstarted staked refunded, ${closedLobbies} free lobbies closed, ${ended} timed-out races ended`);
  }
}
// A race nobody finished in 3 days: the player who cleared the most levels wins the pot.
// If the top spot is shared, or nobody cleared a level, everyone gets their stake back.
const TIME_CHOICES = [5, 10, 15, 20, 30, 45, 60, 120, 180, 360, 720, 1440]; // minutes the host may choose for the race timer
const deadlineOf = (ch) => (isRace(ch) && ch.startedAt && ch.timeLimitMin ? ch.startedAt + ch.timeLimitMin * 60000 : 0);
// The host's race timer: when it runs out the race ends. Most levels cleared wins (ties are settled by points; a full tie refunds everybody).
// Returns true if it ended the race, so the caller can save.
function endIfTimeUp(ch) {
  const d = deadlineOf(ch);
  if (!d || ch.status !== 'active' || Date.now() < d) return false;
  endAbandonedRace(ch, 'timer');
  return true;
}
function endTimedRaces() {
  let n = 0;
  for (const ch of q.activeRaces()) if (endIfTimeUp(ch)) n++;
  if (n) { save(); console.log(`[races] ${n} race(s) ended by their timer`); }
}
function endAbandonedRace(ch, why) {
  const ids = Object.keys(ch.players).sort((a, b) => solvedOf(ch.players[b]) - solvedOf(ch.players[a]) || ch.players[b].score - ch.players[a].score);
  const best = ids.length ? ch.players[ids[0]] : null;
  const second = ids.length > 1 ? ch.players[ids[1]] : null;
  const clearWinner = best && solvedOf(best) > 0 && !(second && solvedOf(second) === solvedOf(best) && second.score === best.score);
  if (clearWinner) { finishRace(ch, ids[0], why || true); return; }
  cancelRace(ch);
  ch.timedOut = true;
  for (const id of ids) notify(id, { kind: 'finish', title: 'Race timed out', body: why === 'timer' ? 'The race timer ran out and there was no clear leader' + (stakeOf(ch) ? ', so stakes were refunded.' : '.') : 'Nobody finished in 3 days and there was no clear leader, so stakes were refunded.', url: `#/c/${ch.id}` });
}

// Sliding puzzle race: a random pick of the pictures, earliest levels (the admin's order) first.
function pickSlides(count) {
  const ready = SL.list.filter((e) => SL.hasPicture(e.id));
  const order = new Map(ready.map((e, i) => [e.id, i]));
  return shuffle(ready.map((e) => e.id)).slice(0, count).sort((a, b) => order.get(a) - order.get(b));
}

// Word search race: a random pick of the word searches, easiest (earliest in the admin's list) first.
function pickWordSearches(count) {
  const order = new Map(WS.list.map((e, i) => [e.id, i]));
  return shuffle(WS.list.map((e) => e.id)).slice(0, count).sort((a, b) => order.get(a) - order.get(b));
}

// Levels from the chosen category first; if the category is too small, the rest are filled from everything else.
function pickPuzzles(category, count) {
  const inCat = category ? P.puzzles.filter((p) => p.category === category) : P.puzzles;
  const rest = category ? P.puzzles.filter((p) => p.category !== category) : [];
  return shuffle(inCat).concat(shuffle(rest)).slice(0, count).map((p) => p.id);
}

function getChallenge(code) {
  const ch = db.challenges[String(code || '').toUpperCase()];
  if (!ch) throw new HttpError(404, 'We could not find a challenge with that code.');
  if (endIfTimeUp(ch)) save();
  return ch;
}
function getMine(ctx) {
  const ch = getChallenge(ctx.params.id);
  const me = ch.players[ctx.user.id];
  if (!me) throw new HttpError(403, 'Join this challenge first.');
  return { ch, me };
}

// Older challenges have no maxPlayers field: they were always head to head.
const maxOf = (ch) => ch.maxPlayers || 2;
const countOf = (ch) => Object.keys(ch.players).length;

// Watchers: logged-in players looking at a race from a watch link. Kept in memory only.
// Someone counts as watching if their screen checked in during the last 20 seconds.
const WATCH_MS = 20_000;
const watchers = new Map(); // race code -> Map(player id -> last seen ms)
function watchSeen(code, id) {
  if (!watchers.has(code)) watchers.set(code, new Map());
  watchers.get(code).set(id, Date.now());
}
function watchCount(code) {
  const m = watchers.get(code);
  if (!m) return 0;
  const cutoff = Date.now() - WATCH_MS;
  for (const [id, t] of m) if (t < cutoff) m.delete(id);
  if (!m.size) { watchers.delete(code); return 0; }
  return m.size;
}
const isGroup = (ch) => maxOf(ch) > 2;
const isClosed = (ch) => ch.status === 'finished' || !!ch.closed || countOf(ch) >= maxOf(ch);

// The single opponent, only for head-to-head challenges that have both players.
const opponentOf = (ch, uid) => {
  if (isGroup(ch) || countOf(ch) !== 2) return null;
  const id = Object.keys(ch.players).find((k) => k !== uid);
  return id ? ch.players[id] : null;
};

// Points for one solved puzzle: start at 100, lose 1 per second and 5 per wrong guess (floor 20).
const roundPoints = (ms, wrong) => Math.max(20, 100 - Math.floor(ms / 1000) - 5 * wrong);
const totalMs = (p) => p.results.reduce((s, r) => s + r.ms, 0);
const solvedOf = (p) => (p.solved != null ? p.solved : p.results.filter((r) => r.solved).length);
const isStarted = (ch) => !isRace(ch) || !!ch.startedAt;
// Has this player nothing more to do? (In a finished race, everybody is done.)
const doneFor = (ch, p) => p.finishedAt != null || (isRace(ch) && ch.status === 'finished');

// Finished players ranked best first: higher score, then less total time.
// topIds holds everyone sharing the best score and time (more than one means a draw at the top).
function standingsOf(ch) {
  if (isRace(ch)) {
    // Race: the winner finished first; everyone else is ranked by how many levels they cleared.
    const ids = Object.keys(ch.players).sort((a, b) => {
      const A = ch.players[a], B = ch.players[b];
      if (ch.winner && (a === ch.winner || b === ch.winner)) return a === ch.winner ? -1 : 1;   // a race ended by the 3-day limit names its winner
      if ((A.finishedAt != null) !== (B.finishedAt != null)) return A.finishedAt != null ? -1 : 1;
      if (A.finishedAt != null) return A.finishedAt - B.finishedAt;
      return solvedOf(B) - solvedOf(A) || B.score - A.score;
    });
    const first = ids.length && (ch.players[ids[0]].finishedAt != null || ids[0] === ch.winner) ? ids[0] : null;
    return { ids: first ? ids : [], topIds: first ? [first] : [] };
  }
  const ids = Object.keys(ch.players)
    .filter((id) => ch.players[id].finishedAt != null)
    .sort((a, b) => ch.players[b].score - ch.players[a].score || totalMs(ch.players[a]) - totalMs(ch.players[b]));
  const best = ids.length ? ch.players[ids[0]] : null;
  const topIds = best
    ? ids.filter((id) => ch.players[id].score === best.score && totalMs(ch.players[id]) === totalMs(best))
    : [];
  return { ids, topIds };
}

function resultFor(ch, uid) {
  const { topIds } = standingsOf(ch);
  if (!topIds.includes(uid)) return 'lost';
  return topIds.length > 1 ? 'draw' : 'won';
}

// Who gets what from the pot. Winner takes all, unless the host chose the top-3 split:
// the winner plus the players who had cleared the most levels when the race ended (ties share a place's money).
// With fewer than 3 players who cleared a level the split is 70/30 or all to the winner. Any leftover coin goes to first place.
function prizesFor(ch, winnerId) {
  const pot = potOf(ch);
  if (!pot) return {};
  if (ch.split !== 'top3') return { [winnerId]: pot };
  const others = Object.keys(ch.players).filter((id) => id !== winnerId && solvedOf(ch.players[id]) > 0)
    .sort((a, b) => solvedOf(ch.players[b]) - solvedOf(ch.players[a]) || ch.players[b].score - ch.players[a].score);
  const elig = [winnerId, ...others];
  const k = Math.min(3, elig.length);
  const amounts = SPLIT_SHARES[k].map((pct) => Math.floor(pot * pct / 100));
  amounts[0] += pot - amounts.reduce((a, b) => a + b, 0);
  const key = (id) => `${solvedOf(ch.players[id])}/${ch.players[id].score}`;
  const out = {};
  out[winnerId] = amounts[0];
  for (let i = 1; i < elig.length;) {
    let j = i;
    while (j + 1 < elig.length && key(elig[j + 1]) === key(elig[i])) j++;       // elig[i..j] share a place
    let pool = 0;
    for (let place = i; place <= j && place < k; place++) pool += amounts[place];
    if (pool > 0) {
      const each = Math.floor(pool / (j - i + 1));
      for (let m = i; m <= j; m++) out[elig[m]] = each;
      out[elig[i]] += pool - each * (j - i + 1);
    }
    i = j + 1;
  }
  return out;
}

// Tells the public chat who won (only the winner is named; the other players are never shown).
function announceResult(ch, winnerId) {
  try {
    if (!winnerId || winnerId === 'draw' || !ch.players[winnerId]) return;
    const n = Object.keys(ch.players).length;
    if (n < 2) return;
    const name = db.users[winnerId] ? db.users[winnerId].username : (ch.players[winnerId].username || 'Deleted player');
    require('../db').chat.addResult({ w: name, n });
  } catch (e) { console.log('[races] result announcement failed:', e.message); }
}

// A race ends the moment somebody clears every level.
function finishRace(ch, winnerId, timedOut) {
  require('../stats').bump('race:finished');
  ch.status = 'finished';
  ch.winner = winnerId;
  if (timedOut) ch.timedOut = true;
  ch.endedAt = Date.now();
  ch.payout = potOf(ch);
  ch.prizes = prizesFor(ch, winnerId);
  for (const [id, coins] of Object.entries(ch.prizes)) if (db.users[id]) db.users[id].coins += coins;
  ch.pot = 0;
  for (const id of Object.keys(ch.players)) {
    const u = db.users[id];
    if (!u) continue;
    Points.add(u, ch.players[id].score, ch.category); // overall points never go down because of a race
    u.stats.played++;
    if (id === winnerId) u.stats.won++; else u.stats.lost++;
  }
  if (ch.sponsor) {
    pickPrizeWinner(ch);
    notify(ch.createdBy, { kind: 'finish', title: 'Sponsored race finished', body: `Check the winner before paying the ${ch.sponsor.prize} prize (Admin page, Sponsored race).`, url: '/admin.html' });
  }
  announceResult(ch, winnerId);
  const wName = db.users[winnerId] ? db.users[winnerId].username : 'Someone';
  if (timedOut && ch.players[winnerId]) notify(winnerId, { kind: 'finish', title: 'You won the race', body: `Time ran out and you had cleared the most levels.` + (ch.payout ? ` You took ${ch.prizes[winnerId] || 0} coins.` : ''), url: `#/c/${ch.id}` });
  for (const id of Object.keys(ch.players)) {
    if (id === winnerId) continue;
    const mine = ch.prizes[id] || 0;
    const tail = ch.split === 'top3' && ch.payout ? (mine ? ` You won ${mine} coins from the pot.` : ` The pot was shared between the top players.`) : (ch.payout ? ` They took ${ch.payout} coins.` : '');
    notify(id, { kind: 'finish', from: winnerId, title: mine ? `${wName} won, and you won ${mine} coins` : `${wName} won the race`, body: (timedOut === 'timer' ? `The race timer ran out and ${wName} had cleared the most levels.` : timedOut ? `Time ran out after 3 days and ${wName} had cleared the most levels.` : `${wName} cleared every level first.`) + tail, url: `#/c/${ch.id}` });
  }
}

function finalizeIfAllDone(ch) {
  if (isRace(ch)) return;
  if (ch.status === 'finished' || !isClosed(ch)) return;
  const ids = Object.keys(ch.players);
  if (ids.length < 2 || ids.some((id) => ch.players[id].finishedAt == null)) return;
  const { topIds } = standingsOf(ch);
  ch.status = 'finished';
  ch.winner = topIds.length > 1 ? 'draw' : topIds[0];
  for (const id of ids) {
    const u = db.users[id];
    if (!u) continue;
    u.stats.played++;
    if (topIds.includes(id)) {
      if (topIds.length > 1) u.stats.drawn++; else u.stats.won++;
    } else {
      u.stats.lost++;
    }
  }
  if (topIds.length === 1) announceResult(ch, topIds[0]);
}

function completeRound(ch, ctx, me, entry) {
  if (isRace(ch)) return completeRaceLevel(ch, ctx, me, entry);
  me.results.push(entry);
  me.score += entry.points;
  me.idx++;
  me.startedAt = null;
  me.wrong = 0;
  if (me.idx >= roundsOf(ch)) {
    me.finishedAt = Date.now();
    Points.add(ctx.user, me.score, ch.category); // overall points never go down because of a bad challenge
    finalizeIfAllDone(ch);
  }
  save();
}

// One level in a race. A correct answer removes it from my list; a skip sends it to the back.
function completeRaceLevel(ch, ctx, me, entry) {
  const pos = me.queue.shift();
  entry.pi = pos;
  me.results.push(entry);
  me.score += entry.points;
  me.startedAt = null;
  me.wrong = 0;
  if (entry.solved) me.solved++; else me.queue.push(pos);
  me.idx = me.solved;
  if (!me.queue.length) {
    me.finishedAt = Date.now();
    finishRace(ch, ctx.user.id);
  }
  save();
}

function roundsView(ch, player) {
  return player.results.map((r, i) => {
    if (isWs(ch)) { const e = WS.byId(ch.puzzleIds[i]); return { answer: e ? (e.theme || 'Word search') : '(removed)', category: WS_CATEGORY, solved: r.solved, points: r.points, seconds: Math.round(r.ms / 100) / 10 }; }
    if (isSl(ch)) { const e = SL.byId(ch.puzzleIds[i]); return { answer: e ? (e.title || 'Sliding puzzle') : '(removed)', category: SL_CATEGORY, solved: r.solved, points: r.points, seconds: Math.round(r.ms / 100) / 10 }; }
    const p = P.byId.get(ch.puzzleIds[r.pi != null ? r.pi : i]);
    if (!p) return { answer: '(puzzle removed)', category: '', solved: r.solved, points: r.points, seconds: Math.round(r.ms / 100) / 10 };
    return { answer: p.answer, category: p.category, solved: r.solved, points: r.points, seconds: Math.round(r.ms / 100) / 10 };
  });
}

// Live progress of everyone, used by the race header. Safe to show: it is only counts.
function playersView(ch, u, order, meDone) {
  return order.map((id) => {
    const p = ch.players[id];
    return {
      username: p.username, avatar: avatarUrl(db.users[id]), tier: db.users[id] ? tagOf(db.users[id].points).tier : 1, idx: p.idx, solved: solvedOf(p),
      done: p.finishedAt != null,
      score: isRace(ch) || meDone || id === u.id ? p.score : null, you: id === u.id,
    };
  });
}

function stateView(ch, u) {
  const me = ch.players[u.id];
  const race = isRace(ch);
  const meDone = doneFor(ch, me);
  const opp = opponentOf(ch, u.id);
  const finished = ch.status === 'finished';
  const { ids: ranked, topIds } = finished ? standingsOf(ch) : { ids: [], topIds: [] };
  const result = finished ? resultFor(ch, u.id) : null;

  let order = Object.keys(ch.players);
  if (finished) order = ranked;
  else if (!race && meDone) order = order.sort((a, b) => ch.players[b].score - ch.players[a].score);

  const out = {
    id: ch.id,
    status: ch.status,
    race,
    rounds: roundsOf(ch),
    started: isStarted(ch),
    category: ch.category,
    game: gameOf(ch),
    inCategory: inCategory(ch),
    group: isGroup(ch),
    maxPlayers: maxOf(ch),
    playerCount: countOf(ch),
    watching: watchCount(ch.id),
    closed: isClosed(ch),
    canLock: !race && ch.createdBy === u.id && !isClosed(ch) && countOf(ch) >= 2,
    canStart: race && ch.createdBy === u.id && !ch.startedAt && countOf(ch) >= 2,
    host: db.users[ch.createdBy]?.username || ch.createdBy,
    sponsor: sponsorView(ch, u),
    stake: stakeOf(ch),
    pot: finished ? (ch.payout || 0) : potOf(ch),
    youStaked: me.staked || (finished && stakeOf(ch) ? stakeOf(ch) : 0),
    split: ch.split || null,
    prize: finished ? ((ch.prizes && ch.prizes[u.id]) || 0) : 0,
    prizes: finished && ch.prizes ? Object.entries(ch.prizes).filter(([, c]) => c > 0).sort((a, b) => b[1] - a[1]).map(([id, c]) => ({ username: db.users[id] ? db.users[id].username : id, coins: c })) : [],
    canCancel: race && ch.createdBy === u.id && !ch.startedAt && ch.status === 'waiting',
    canLeave: race && ch.createdBy !== u.id && !ch.startedAt && ch.status === 'waiting',
    cancelled: ch.status === 'cancelled',
    timeLimitMin: ch.timeLimitMin || 0,
    endsAt: deadlineOf(ch),
    timedOut: !!ch.timedOut,
    invited: ch.invited ? db.users[ch.invited]?.username || ch.invited : null,
    me: { score: me.score, idx: me.idx, solved: solvedOf(me), done: meDone, finishedFirst: me.finishedAt != null },
    opponent: opp ? { username: opp.username, idx: opp.idx, solved: solvedOf(opp), done: doneFor(ch, opp), score: race || meDone ? opp.score : null } : null,
    // Everyone in the challenge. In old-style challenges scores stay hidden until you have finished.
    players: playersView(ch, u, order, meDone),
    winner: result ? (result === 'won' ? 'me' : result === 'draw' ? 'draw' : 'opponent') : null,
    winnerName: finished && ch.players[ch.winner] ? ch.players[ch.winner].username : null,
    place: finished ? (topIds.includes(u.id) ? 1 : ranked.indexOf(u.id) + 1) : null,
  };
  if (race && !ch.startedAt) return out; // still in the lobby: no puzzle yet
  if (!meDone) {
    if (!me.startedAt) { me.startedAt = Date.now(); save(); }
    if (isWs(ch)) {
      const entry = wsCurrent(ch, me, u);
      if (!entry || ch.status === 'finished' || me.finishedAt != null) return stateView(ch, u); // finished while loading
      out.round = solvedOf(me) + 1;
      out.wordsearch = wsView(entry, me);
    } else if (isSl(ch)) {
      const entry = slCurrent(ch, me, u);
      if (!entry || ch.status === 'finished' || me.finishedAt != null) return stateView(ch, u); // finished while loading
      out.round = solvedOf(me) + 1;
      out.slide = slView(ch, entry, me);
    } else if (race) {
      out.round = solvedOf(me) + 1;
      out.puzzle = P.view(P.byId.get(ch.puzzleIds[me.queue[0]]));
    } else {
      out.round = me.idx + 1;
      out.puzzle = P.view(P.byId.get(ch.puzzleIds[me.idx]));
    }
  } else {
    out.results = {
      me: roundsView(ch, me),
      others: Object.keys(ch.players)
        .filter((id) => id !== u.id && (ch.players[id].finishedAt != null || (race && finished)))
        .map((id) => ({ username: ch.players[id].username, score: ch.players[id].score, rounds: roundsView(ch, ch.players[id]) })),
    };
    if (opp && (opp.finishedAt != null || (race && finished))) out.results.opponent = roundsView(ch, opp);
  }
  return out;
}

function summary(ch, u) {
  const me = ch.players[u.id];
  const opp = opponentOf(ch, u.id);
  const finished = ch.status === 'finished';
  let myPlace = null;
  if (finished && me) {
    const { ids, topIds } = standingsOf(ch);
    myPlace = topIds.includes(u.id) ? 1 : ids.indexOf(u.id) + 1;
  }
  return {
    id: ch.id,
    status: ch.status,
    race: isRace(ch),
    rounds: roundsOf(ch),
    started: isStarted(ch),
    stake: stakeOf(ch),
    category: ch.category || null,
    game: gameOf(ch),
    inCategory: inCategory(ch),
    group: isGroup(ch),
    playerCount: countOf(ch),
    maxPlayers: maxOf(ch),
    closed: isClosed(ch),
    opponent: opp ? opp.username : null,
    invited: ch.invited ? db.users[ch.invited]?.username || ch.invited : null,
    myDone: me ? doneFor(ch, me) : false,
    mySolved: me ? solvedOf(me) : 0,
    needsJoin: !me,
    createdBy: db.users[ch.createdBy]?.username || ch.createdBy,
    result: finished && me ? resultFor(ch, u.id) : null,
    myScore: me ? me.score : null,
    oppScore: finished && opp ? opp.score : null,
    myPlace,
    myPrize: finished && ch.prizes ? (ch.prizes[u.id] || 0) : 0,
    split: ch.split || null,
    createdAt: ch.createdAt,
  };
}

// Guess/skip are only allowed while it is my turn to play in a race that is running.
function needPlayable(ch, me) {
  if (isRace(ch)) {
    if (ch.status === 'finished') {
      const w = ch.players[ch.winner];
      throw new HttpError(409, `The race is over${w ? `. ${w.username} finished first` : ''}.`);
    }
    if (ch.status === 'cancelled') throw new HttpError(409, 'The race is over. The timer ran out with no clear winner.');
    if (!ch.startedAt) throw new HttpError(409, 'The race has not started yet. Wait for the host to start it.');
  }
  if (me.finishedAt != null) throw new HttpError(409, 'You already finished this challenge.');
}
const currentPuzzle = (ch, me) => P.byId.get(ch.puzzleIds[isRace(ch) ? me.queue[0] : me.idx]);


// ---- word search races: everybody gets the same word searches, in the same order ----
// The race holds the ids of the word searches. A player is on level (solved + 1) and keeps their found words in me.wsFound.
function wsCurrent(ch, me, user) {
  // a word search the admin deleted counts as done for everybody, so nobody is ever stuck
  while (me.finishedAt == null && solvedOf(me) < ch.rounds && !WS.byId(ch.puzzleIds[solvedOf(me)])) {
    me.solved = solvedOf(me) + 1; me.idx = me.solved; me.wsFound = {};
    if (me.solved >= ch.rounds && ch.status !== 'finished') { me.finishedAt = Date.now(); finishRace(ch, user.id); }
  }
  save();
  return WS.byId(ch.puzzleIds[solvedOf(me)]) || null;
}
function wsView(entry, me) {
  const g = WS.grids(entry);
  me.wsFound = me.wsFound || {};
  const found = [];
  for (const [word, [r, c, dr, dc]] of Object.entries(me.wsFound)) if (entry.words.includes(word)) found.push({ word, r, c, dr, dc });
  return { id: entry.id, theme: entry.theme || '', size: g.size, rows: g.rows, words: entry.words.slice(), found };
}

// ---- sliding puzzle races: everybody gets the same pictures in the same order, and the same shuffle ----
// A player is on level (solved + 1). Their board and slide count are kept on their own record.
function slCurrent(ch, me, user) {
  // a picture the admin deleted counts as done for everybody, so nobody is ever stuck
  while (me.finishedAt == null && solvedOf(me) < ch.rounds && !(SL.byId(ch.puzzleIds[solvedOf(me)]) && SL.hasPicture(ch.puzzleIds[solvedOf(me)]))) {
    me.solved = solvedOf(me) + 1; me.idx = me.solved; me.slBoard = null; me.slMoves = 0;
    if (me.solved >= ch.rounds && ch.status !== 'finished') { me.finishedAt = Date.now(); finishRace(ch, user.id); }
  }
  save();
  return SL.byId(ch.puzzleIds[solvedOf(me)]) || null;
}
function slView(ch, entry, me) {
  if (!SL.validBoard(me.slBoard, entry.size)) { me.slBoard = SL.shuffledFor(entry.size, ch.id + ':' + entry.id); me.slMoves = 0; save(); }
  return { id: entry.id, title: entry.title || '', size: entry.size, image: SL.urlOf(entry.id), board: me.slBoard.slice(), moves: me.slMoves || 0 };
}


// ---- sponsored races: a free race the admin sets up for a brand ----
// The sponsor's name, logo, link and prize are shown on the home card, the lobby and the finish screen.
function cleanSponsor(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  const name = String(s.name || '').trim().slice(0, 40);
  if (!name) throw new HttpError(400, 'Type the sponsor name.');
  let link = String(s.link || '').trim().slice(0, 300);
  if (link && !/^https?:\/\/[^\s]+$/i.test(link)) throw new HttpError(400, 'The sponsor link must start with http:// or https://');
  const prize = String(s.prize || '').trim().slice(0, 120);
  if (!prize) throw new HttpError(400, 'Type the prize, for example "N5,000 airtime".');
  let logo = String(s.logo || '');
  if (logo) {
    if (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo)) throw new HttpError(400, 'The logo must be a PNG, JPG or WEBP picture.');
    if (logo.length > 160000) throw new HttpError(400, 'The logo is too big. Use a smaller picture.');
  }
  let startAt = 0;
  if (s.startAt != null && s.startAt !== '' && s.startAt !== 0) {
    startAt = Number(s.startAt);
    if (!Number.isFinite(startAt) || startAt < Date.now() - 60000 || startAt > Date.now() + 90 * 24 * 3600 * 1000) throw new HttpError(400, 'The start time must be in the future, within 90 days.');
  }
  return { name, link, prize, logo, views: 0, taps: 0, seen: {}, startAt, reportToken: crypto.randomBytes(12).toString('hex'), prizeStatus: 'none', prizeTo: null, rejected: {}, note: '' };
}
const sponsorView = (ch, u) => {
  const s = ch.sponsor;
  if (!s) return null;
  const out = { name: s.name, link: s.link || '', prize: s.prize, logo: s.logo || '', startAt: s.startAt || 0 };
  if (ch.status === 'finished') {
    // Only a winner who has been checked is shown as paid. "checking" and "approved" are shown as they are.
    out.prizeStatus = s.prizeStatus || 'none';
    out.prizeYou = !!(u && s.prizeTo && s.prizeTo === u.id);
    out.prizeToName = s.prizeTo && db.users[s.prizeTo] ? db.users[s.prizeTo].username : null;
  }
  return out;
};

// Start the race (the host's Start button and the automatic start both use this).
function beginRace(ch, hostName) {
  ch.startedAt = Date.now();
  ch.closed = true;
  ch.status = 'active';
  save();
  for (const id of Object.keys(ch.players)) {
    if (id !== ch.createdBy) notify(id, { kind: 'start', from: ch.createdBy, title: 'The race has started!', body: `${hostName || 'The host'} started the race. Go go go!`, url: `#/c/${ch.id}` });
  }
}
// A sponsored race with a start time starts by itself once the time has come and at least one player has joined.
function startDueSponsored() {
  const now = Date.now();
  for (const ch of Object.values(db.challenges)) {
    if (!ch.sponsor || !ch.race || ch.startedAt || ch.status !== 'waiting' || !ch.sponsor.startAt || ch.sponsor.startAt > now) continue;
    if (countOf(ch) < 2) continue;
    beginRace(ch, 'The sponsored race');
    console.log(`[races] sponsored race ${ch.id} started by itself`);
  }
}

// Who gets the sponsor's prize: the first finisher who is not the host and was not rejected.
function pickPrizeWinner(ch) {
  const s = ch.sponsor;
  const ids = standingsOf(ch).ids.filter((id) => id !== ch.createdBy && !s.rejected[id] && (ch.players[id].finishedAt != null || id === ch.winner));
  s.prizeTo = ids[0] || null;
  s.prizeStatus = s.prizeTo ? 'checking' : 'none';
  if (s.prizeTo) notify(s.prizeTo, { kind: 'finish', title: 'You won the sponsored race!', body: `Prize: ${s.prize}. We are checking your entry and will email you.`, url: `#/c/${ch.id}` });
}
// What the admin looks at before the prize is paid.
function winnerSignals(ch, id) {
  const u = db.users[id], me = ch.players[id];
  if (!u || !me) return null;
  const flags = [];
  const perLevel = me.finishedAt && ch.startedAt ? Math.round((me.finishedAt - ch.startedAt) / 1000 / Math.max(1, roundsOf(ch))) : null;
  const floor = isWs(ch) ? 20 : isSl(ch) ? 10 : 6;
  if (u.createdAt > ch.createdAt) flags.push('Account was created after this race was announced.');
  else if (u.createdAt > Date.now() - 24 * 3600 * 1000) flags.push('Account is less than a day old.');
  if (perLevel != null && perLevel < floor) flags.push(`Very fast: about ${perLevel} seconds per level.`);
  const email = String(u.email || '').toLowerCase();
  const sameEmail = email ? Object.values(db.users).filter((x) => x.id !== u.id && String(x.email || '').toLowerCase() === email).length : 0;
  if (sameEmail) flags.push(`${sameEmail} other account${sameEmail === 1 ? '' : 's'} use the same email.`);
  if (!email) flags.push('No email on file, so you cannot contact this player.');
  return {
    username: u.username, email: u.email || '', accountDays: Math.floor((Date.now() - u.createdAt) / 86400000),
    points: u.points || 0, racesPlayed: (u.stats && u.stats.played) || 0, secondsPerLevel: perLevel, flags,
  };
}


module.exports = ({ route }) => {
  route('POST', '/api/challenges', (ctx) => {
    const u = ctx.user;
    let sponsor = null;
    if (ctx.body.sponsor) {
      if (!require('./admin').isAdmin(u)) throw new HttpError(403, 'Only the admin can set up a sponsored race.');
      sponsor = cleanSponsor(ctx.body.sponsor);
    }
    const category = ctx.body.category == null || ctx.body.category === '' ? 'Naija' : String(ctx.body.category);
    const wsRace = category === WS_CATEGORY;
    const slRace = category === SL_CATEGORY;
    if (!wsRace && !slRace && !P.categories().some((c) => c.name === category)) {
      throw new HttpError(400, 'Pick Naija, Universal, Word Search or Slide Puzzle.');
    }
    const rawMax = ctx.body.maxPlayers;
    const maxPlayers = rawMax == null || rawMax === '' ? 2 : Number(rawMax);
    if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > (sponsor ? SPONSOR_MAX : MAX_PLAYERS)) {
      throw new HttpError(400, `Pick between 2 and ${sponsor ? SPONSOR_MAX : MAX_PLAYERS} players.`);
    }
    const rawLevels = ctx.body.levels;
    const levels = rawLevels == null || rawLevels === '' ? (category === WS_CATEGORY || category === SL_CATEGORY ? 5 : DEFAULT_LEVELS) : Number(rawLevels);
    const slReady = SL.list.filter((e) => SL.hasPicture(e.id));
    const most = wsRace ? WS.list.length : slRace ? slReady.length : P.puzzles.filter((p) => p.category === category).length;
    if (slRace) {
      const rawSl = ctx.body.levels == null || ctx.body.levels === '' ? 5 : Number(ctx.body.levels);
      if (!Number.isInteger(rawSl) || rawSl < SL_MIN) throw new HttpError(400, `A sliding puzzle race needs at least ${SL_MIN} puzzles.`);
      if (rawSl > most) throw new HttpError(400, most < SL_MIN ? 'There are not enough sliding puzzles for a race yet.' : `There are only ${most} sliding puzzles for now, so ${most} is the most you can race.`);
    } else if (wsRace) {
      // a word search takes a minute or two, so a word search race is shorter: 3 or more word searches
      const rawWs = ctx.body.levels == null || ctx.body.levels === '' ? 5 : Number(ctx.body.levels);
      if (!Number.isInteger(rawWs) || rawWs < WS_MIN) throw new HttpError(400, `A word search race needs at least ${WS_MIN} word searches.`);
      if (rawWs > most) throw new HttpError(400, `There are only ${most} word searches for now, so ${most} is the most you can race.`);
    } else {
      if (!Number.isInteger(levels) || levels < MIN_LEVELS) throw new HttpError(400, `A race needs at least ${MIN_LEVELS} levels.`);
      if (most < MIN_LEVELS) throw new HttpError(400, `${category} does not have enough puzzles for a race yet (${most} of ${MIN_LEVELS}). Try the other category.`);
      if (levels > most) throw new HttpError(400, `${category} only has ${most} puzzles for now, so ${most} is the most you can race.`);
    }
    // Staking has been removed (no coins are paid in or won in races). Any stake or split an old client sends is ignored.
    const stake = 0;
    const rawSplit = 'winner';
    const rawTime = ctx.body.timeLimit == null || ctx.body.timeLimit === '' ? 0 : Number(ctx.body.timeLimit);
    if (rawTime !== 0 && !TIME_CHOICES.includes(rawTime)) throw new HttpError(400, 'Choose a race timer from the list, or no timer.');
    let invited = null;
    const oppName = String(ctx.body.opponent || '').trim().toLowerCase();
    if (oppName) {
      if (maxPlayers > 2) throw new HttpError(400, 'Group challenges are joined with a code. Leave the friend name empty and share the code.');
      if (oppName === u.id) throw new HttpError(400, 'You cannot challenge yourself. Pick a friend.');
      if (!db.users[oppName]) throw new HttpError(404, 'No player has that username.');
      invited = oppName;
    }
    const open = q.openChallengesBy(u.id);
    if (!sponsor && open >= OPEN_LIMIT) throw new HttpError(429, `You have ${OPEN_LIMIT} challenges still open. Finish some of those first.`);

    const ch = {
      id: makeCode(), createdBy: u.id, invited, category, maxPlayers, closed: false,
      race: true, rounds: levels, startedAt: null, stake, pot: 0,
      ...(rawSplit === 'top3' ? { split: 'top3' } : {}),
      ...(rawTime ? { timeLimitMin: rawTime } : {}),
      ...(sponsor ? { sponsor } : {}),
      ...(wsRace ? { game: 'wordsearch' } : slRace ? { game: 'slide' } : {}),
      puzzleIds: wsRace ? pickWordSearches(levels) : slRace ? pickSlides(levels) : pickPuzzles(category, levels), createdAt: Date.now(),
      status: 'waiting', players: {}, winner: null,
    };
    ch.players[u.id] = newPlayer(u, ch);
    takeStake(ch, u, ch.players[u.id]);
    db.challenges[ch.id] = ch;
    require('../stats').bump('race:created');
    save();
    if (invited) {
      notify(invited, { kind: 'challenge', from: u.id, title: `${u.username} challenged you`,
        body: `${levels}-level race` + (category ? ` · ${category}` : '') + (stake ? ` · ${stake} coin stake` : ''), url: `#/join/${ch.id}` });
    }
    return { id: ch.id, coins: u.coins };
  }, { auth: true });

  route('POST', '/api/challenges/join', (ctx) => {
    const u = ctx.user;
    const ch = getChallenge(ctx.body.code);
    if (ch.players[u.id]) return { id: ch.id };
    if (ch.status === 'finished') throw new HttpError(409, 'This challenge is already over.');
    if (isRace(ch) && ch.startedAt) throw new HttpError(409, 'This race has already started.');
    if (isClosed(ch)) {
      throw new HttpError(409, isGroup(ch) ? 'This challenge is full or has been locked.' : 'Someone already joined this challenge.');
    }
    if (ch.invited && ch.invited !== u.id) {
      throw new HttpError(403, `This challenge is only for ${db.users[ch.invited]?.username || 'another player'}.`);
    }
    const mine = newPlayer(u, ch);
    takeStake(ch, u, mine); // throws 402 before anything changes if they cannot afford it
    ch.players[u.id] = mine;
    require('../stats').bump('race:joined');
    if (countOf(ch) >= 2 && !isRace(ch)) ch.status = 'active';
    save();
    if (ch.sponsor) startDueSponsored();   // the start time may already have passed
    return { id: ch.id, coins: u.coins };
  }, { auth: true });

  // Race: the creator starts everybody at the same moment.
  route('POST', '/api/challenges/:id/start', (ctx) => {
    const { ch } = getMine(ctx);
    if (!isRace(ch)) throw new HttpError(400, 'This is an older challenge. Just play it.');
    if (ch.createdBy !== ctx.user.id) throw new HttpError(403, 'Only the person who created this race can start it.');
    if (ch.startedAt) return { ok: true };
    if (ch.status !== 'waiting') throw new HttpError(409, ch.status === 'cancelled' ? 'This race was cancelled.' : 'This race is already over.');
    if (countOf(ch) < 2) throw new HttpError(400, 'Wait for at least one friend to join before you start.');
    beginRace(ch, ctx.user.username);
    return { ok: true };
  }, { auth: true });

  // Host cancels a race that has not started: everybody gets their stake back.
  route('POST', '/api/challenges/:id/cancel', (ctx) => {
    const { ch } = getMine(ctx);
    if (!isRace(ch)) throw new HttpError(400, 'Only races can be cancelled.');
    if (ch.createdBy !== ctx.user.id) throw new HttpError(403, 'Only the person who created this race can cancel it.');
    if (ch.startedAt || ch.status !== 'waiting') throw new HttpError(409, ch.status === 'cancelled' ? 'This race is already cancelled.' : 'The race has already started, so it cannot be cancelled.');
    cancelRace(ch);
    save();
    return { ok: true };
  }, { auth: true });

  // A player (not the host) walks out of the lobby before the start and gets their stake back.
  route('POST', '/api/challenges/:id/leave', (ctx) => {
    const { ch } = getMine(ctx);
    if (!isRace(ch)) throw new HttpError(400, 'Only races have a lobby to leave.');
    if (ch.createdBy === ctx.user.id) throw new HttpError(400, 'You created this race. Cancel it instead.');
    if (ch.startedAt || ch.status !== 'waiting') throw new HttpError(409, 'The race has already started, so you cannot leave it.');
    refundPlayer(ch, ctx.user.id);
    delete ch.players[ctx.user.id];
    save();
    return { ok: true };
  }, { auth: true });

  // What a join code is for, shown BEFORE the player pays a stake.
  // ---- sponsored races ----
  // Open sponsored races for the home card. Each player who sees the card is counted once for the sponsor report.
  route('GET', '/api/sponsored', (ctx) => {
    const u = ctx.user;
    startDueSponsored();
    const list = Object.values(db.challenges)
      .filter((c) => c.sponsor && c.race && (c.status === 'waiting' || c.status === 'active'))
      .sort((a, b) => b.createdAt - a.createdAt).slice(0, 3);
    let changed = false;
    for (const c of list) {
      if (u && !c.sponsor.seen[u.id]) { c.sponsor.seen[u.id] = 1; c.sponsor.views = (c.sponsor.views || 0) + 1; changed = true; }
    }
    if (changed) save();
    return {
      races: list.map((c) => ({
        id: c.id, sponsor: sponsorView(c), game: gameOf(c), category: c.category || null, rounds: roundsOf(c),
        playerCount: Math.max(0, countOf(c) - 1), maxPlayers: Math.max(2, maxOf(c) - 1), started: isStarted(c), joined: !!(u && c.players[u.id]),
      })),
    };
  });

  // A player tapped the sponsor's link.
  route('POST', '/api/sponsored/:id/tap', (ctx) => {
    const ch = db.challenges[String(ctx.params.id).toUpperCase()];
    if (ch && ch.sponsor) { ch.sponsor.taps = (ch.sponsor.taps || 0) + 1; save(); }
    return { ok: true };
  });

  // The sponsor report for the admin page: how many players saw it, joined, finished, and who won.
  route('GET', '/api/admin/sponsored', (ctx) => {
    if (!require('./admin').isAdmin(ctx.user)) throw new HttpError(404, 'Not found.');
    return {
      races: Object.values(db.challenges).filter((c) => c.sponsor).sort((a, b) => b.createdAt - a.createdAt).map((c) => {
        const ids = Object.keys(c.players).filter((id) => id !== c.createdBy);
        const winner = c.winner && c.players[c.winner] && c.winner !== c.createdBy ? c.players[c.winner].username : null;
        return {
          id: c.id, sponsor: { name: c.sponsor.name, prize: c.sponsor.prize, link: c.sponsor.link, hasLogo: !!c.sponsor.logo },
          status: c.status, game: gameOf(c), rounds: roundsOf(c), maxPlayers: maxOf(c), createdAt: c.createdAt,
          views: c.sponsor.views || 0, taps: c.sponsor.taps || 0, joined: ids.length,
          finished: ids.filter((id) => c.players[id].finishedAt != null).length, winner,
          startAt: c.sponsor.startAt || 0, reportToken: c.sponsor.reportToken,
          prize: c.status === 'finished' ? { status: c.sponsor.prizeStatus, note: c.sponsor.note || '', winner: c.sponsor.prizeTo ? winnerSignals(c, c.sponsor.prizeTo) : null } : null,
        };
      }),
    };
  }, { auth: true });

  // Admin: check the winner, then approve, mark as paid, or reject (the prize passes to the next finisher).
  route('POST', '/api/admin/sponsored/:id/prize', (ctx) => {
    if (!require('./admin').isAdmin(ctx.user)) throw new HttpError(404, 'Not found.');
    const ch = db.challenges[String(ctx.params.id).toUpperCase()];
    if (!ch || !ch.sponsor) throw new HttpError(404, 'No sponsored race with that code.');
    if (ch.status !== 'finished') throw new HttpError(409, 'The race is not over yet.');
    const s = ch.sponsor, action = String(ctx.body.action || '');
    if (!s.prizeTo) throw new HttpError(409, 'There is no winner to check.');
    if (s.prizeStatus === 'paid') throw new HttpError(409, 'This prize is already marked as paid.');
    const to = s.prizeTo;
    if (typeof ctx.body.note === 'string') s.note = ctx.body.note.trim().slice(0, 200);
    if (action === 'approve') {
      s.prizeStatus = 'approved';
      notify(to, { kind: 'finish', title: 'Your prize is approved', body: `${s.prize} from ${s.name}. We will send it to you soon.`, url: `#/c/${ch.id}` });
    } else if (action === 'paid') {
      s.prizeStatus = 'paid';
      notify(to, { kind: 'finish', title: 'Your prize has been sent', body: `${s.prize} from ${s.name} is on its way to you. Enjoy!`, url: `#/c/${ch.id}` });
    } else if (action === 'reject') {
      s.rejected[to] = true;
      notify(to, { kind: 'finish', title: 'Prize not approved', body: 'We could not approve your entry for the sponsor prize. Your points and rank are not changed.', url: `#/c/${ch.id}` });
      pickPrizeWinner(ch);
    } else throw new HttpError(400, 'Choose approve, paid or reject.');
    save();
    return { ok: true, status: s.prizeStatus, prizeTo: s.prizeTo };
  }, { auth: true, strict: true });

  // Read-only sponsor report: the admin sends this link to the sponsor. No emails, no logins.
  route('GET', '/api/sponsor-report/:token', (ctx) => {
    const ch = Object.values(db.challenges).find((c) => c.sponsor && c.sponsor.reportToken === String(ctx.params.token));
    if (!ch) throw new HttpError(404, 'This report link is not valid.');
    const ids = Object.keys(ch.players).filter((id) => id !== ch.createdBy);
    const s = ch.sponsor;
    const winner = s.prizeTo && ch.players[s.prizeTo] ? ch.players[s.prizeTo].username : null;
    return {
      sponsor: s.name, prize: s.prize, game: gameOf(ch), rounds: roundsOf(ch), status: ch.status,
      startAt: s.startAt || 0, createdAt: ch.createdAt, endedAt: ch.endedAt || 0, logo: s.logo || '',
      views: s.views || 0, taps: s.taps || 0, joined: ids.length, finished: ids.filter((id) => ch.players[id].finishedAt != null).length,
      winner: ch.status === 'finished' && s.prizeStatus !== 'none' ? winner : null,
      prizeStatus: ch.status === 'finished' ? s.prizeStatus : 'none',
    };
  });

  route('GET', '/api/challenge-preview/:code', (ctx) => {
    const ch = getChallenge(ctx.params.code);
    return {
      id: ch.id, race: isRace(ch), rounds: roundsOf(ch), stake: stakeOf(ch), pot: potOf(ch),
      category: ch.category || null, game: gameOf(ch), inCategory: inCategory(ch),
      host: db.users[ch.createdBy]?.username || ch.createdBy, playerCount: ch.sponsor ? Math.max(0, countOf(ch) - 1) : countOf(ch), maxPlayers: ch.sponsor ? Math.max(2, maxOf(ch) - 1) : maxOf(ch), split: ch.split || null, timeLimitMin: ch.timeLimitMin || 0,
      alreadyIn: !!ch.players[ctx.user.id], status: ch.status, started: isStarted(ch),
      coins: ctx.user.coins, sponsor: sponsorView(ch, ctx.user),
    };
  }, { auth: true });

  // The creator closes the lobby so the group can finish without waiting for more people (older challenges).
  route('POST', '/api/challenges/:id/lock', (ctx) => {
    const { ch } = getMine(ctx);
    if (ch.createdBy !== ctx.user.id) throw new HttpError(403, 'Only the person who created this challenge can lock it.');
    if (isRace(ch)) throw new HttpError(400, 'Races start with the Start race button.');
    if (ch.status === 'finished') throw new HttpError(409, 'This challenge is already over.');
    if (isClosed(ch)) return { ok: true };
    if (countOf(ch) < 2) throw new HttpError(400, 'Wait for at least one friend to join before you lock it.');
    ch.closed = true;
    finalizeIfAllDone(ch);
    save();
    return { ok: true };
  }, { auth: true });

  // Watch a race from a shared link. Needs an account, but not a place in the race. Watchers only see
  // how far everyone has got: never the pictures, the words or the answers.
  route('GET', '/api/watch/:code', (ctx) => {
    const ch = getChallenge(ctx.params.code);
    if (!isRace(ch)) throw new HttpError(404, 'Only races can be watched.');
    if (ch.players[ctx.user.id]) return { id: ch.id, participant: true };
    watchSeen(ch.id, ctx.user.id);
    const finished = ch.status === 'finished';
    const order = finished ? standingsOf(ch).ids : Object.keys(ch.players);
    const players = order.map((id) => {
      const p = ch.players[id];
      return {
        username: p.username, avatar: avatarUrl(db.users[id]), tier: db.users[id] ? tagOf(db.users[id].points).tier : 1,
        solved: solvedOf(p), done: p.finishedAt != null, score: finished ? p.score : null,
        prize: finished && ch.prizes ? (ch.prizes[id] || 0) : 0,
      };
    });
    if (!finished) players.sort((a, b) => (b.done - a.done) || (b.solved - a.solved));
    return {
      id: ch.id, participant: false, status: ch.status, started: isStarted(ch), finished, cancelled: ch.status === 'cancelled',
      game: gameOf(ch), rounds: roundsOf(ch), category: ch.category || null, inCategory: inCategory(ch),
      stake: stakeOf(ch), pot: finished ? (ch.payout || 0) : potOf(ch), split: ch.split || null,
      host: db.users[ch.createdBy]?.username || ch.createdBy, playerCount: countOf(ch), maxPlayers: maxOf(ch),
      winnerName: finished && ch.players[ch.winner] ? ch.players[ch.winner].username : null,
      watching: watchCount(ch.id), players,
    };
  }, { auth: true });

  route('GET', '/api/challenges', (ctx) => {
    const u = ctx.user;
    sweepStale();
    const mine = q.challengesFor(u.id, 50).map((c) => summary(c, u));
    return { challenges: mine };
  }, { auth: true });

  route('GET', '/api/challenges/:id', (ctx) => {
    const { ch } = getMine(ctx);
    return stateView(ch, ctx.user);
  }, { auth: true });

  // Light check used while racing and in the lobby: who has cleared how many levels, and has anything changed.
  route('GET', '/api/challenges/:id/progress', (ctx) => {
    const { ch } = getMine(ctx);
    const u = ctx.user;
    const finished = ch.status === 'finished';
    const order = finished ? standingsOf(ch).ids : Object.keys(ch.players);
    return {
      status: ch.status, started: isStarted(ch), finished, cancelled: ch.status === 'cancelled', timedOut: !!ch.timedOut, endsAt: deadlineOf(ch), rounds: roundsOf(ch),
      playerCount: countOf(ch), watching: watchCount(ch.id), winnerName: finished && ch.players[ch.winner] ? ch.players[ch.winner].username : null,
      players: playersView(ch, u, order, true),
    };
  }, { auth: true });

  // Word search race: drag over a word. Same checks as solo, but no hints and no skipping.
  route('POST', '/api/challenges/:id/ws-select', (ctx) => {
    const { ch, me } = getMine(ctx);
    if (!isWs(ch)) throw new HttpError(400, 'This race is not a word search race.');
    needPlayable(ch, me);
    const entry = wsCurrent(ch, me, ctx.user);
    if (me.finishedAt != null || !entry) return { found: false, finished: true, won: ch.winner === ctx.user.id };
    if (String(ctx.body.id) !== entry.id) throw new HttpError(409, 'The word search changed. Loading the current one...');
    me.wsFound = me.wsFound || {};
    const b = ctx.body;
    const g = WS.grids(entry);
    const line = WS.lineOf(g, b.r1, b.c1, b.r2, b.c2);
    if (!line || line.len < 2) return { found: false };
    const rev = line.text.split('').reverse().join('');
    const word = entry.words.find((w) => !me.wsFound[w] && (w === line.text || w === rev));
    if (!word) return { found: false };
    if (!me.startedAt) me.startedAt = Date.now();
    const forward = word === line.text;
    const r = forward ? b.r1 : b.r2, c = forward ? b.c1 : b.c2;
    const dr = forward ? line.dr : -line.dr, dc = forward ? line.dc : -line.dc;
    me.wsFound[word] = [r, c, dr, dc];
    const out = { found: true, word, r, c, dr, dc, left: entry.words.filter((w) => !me.wsFound[w]).length };
    if (!out.left) {
      const points = WS_POINTS * entry.words.length;
      const ms = Date.now() - me.startedAt;
      me.results.push({ id: entry.id, solved: true, points, ms });
      me.score += points;
      me.solved = solvedOf(me) + 1; me.idx = me.solved;
      me.wsFound = {}; me.startedAt = null;
      Object.assign(out, { levelDone: true, points, theme: entry.theme || '', fact: entry.fact || '' });
      Premium.gate(ctx.user, out);
      if (me.solved >= ch.rounds) { me.finishedAt = Date.now(); finishRace(ch, ctx.user.id); out.finished = true; out.won = true; }
      else out.finished = false;
    }
    save();
    return out;
  }, { auth: true });

  // Sliding puzzle race: slide a piece next to the gap. The server keeps the board; no hints and no skipping.
  route('POST', '/api/challenges/:id/sl-move', (ctx) => {
    const { ch, me } = getMine(ctx);
    if (!isSl(ch)) throw new HttpError(400, 'This race is not a sliding puzzle race.');
    needPlayable(ch, me);
    const entry = slCurrent(ch, me, ctx.user);
    if (me.finishedAt != null || !entry) return { moved: false, finished: true, won: ch.winner === ctx.user.id };
    if (String(ctx.body.id) !== entry.id) throw new HttpError(409, 'The puzzle changed. Loading the current one...');
    const v = slView(ch, entry, me);                 // makes sure the player has a board
    if (!me.startedAt) me.startedAt = Date.now();
    if (!SL.slide(me.slBoard, entry.size, ctx.body.pos)) return { moved: false, board: me.slBoard.slice(), moves: me.slMoves || 0 };
    me.slMoves = (me.slMoves || 0) + 1;
    const out = { moved: true, board: me.slBoard.slice(), moves: me.slMoves };
    void v;
    if (SL.isSolved(me.slBoard)) {
      const points = SL.BASE[entry.size] || 60;
      const ms = Date.now() - me.startedAt;
      me.results.push({ id: entry.id, solved: true, points, ms });
      me.score += points;
      me.solved = solvedOf(me) + 1; me.idx = me.solved;
      me.slBoard = null; me.slMoves = 0; me.startedAt = null;
      Object.assign(out, { levelDone: true, points, title: entry.title || '', fact: entry.fact || '' });
      Premium.gate(ctx.user, out);
      if (me.solved >= ch.rounds) { me.finishedAt = Date.now(); finishRace(ch, ctx.user.id); out.finished = true; out.won = true; }
      else out.finished = false;
    }
    save();
    return out;
  }, { auth: true });

  route('POST', '/api/challenges/:id/guess', (ctx) => {
    const { ch, me } = getMine(ctx);
    if (isWs(ch)) throw new HttpError(400, 'This is a word search race. Drag over the words in the grid.');
    if (isSl(ch)) throw new HttpError(400, 'This is a sliding puzzle race. Slide the pieces into place.');
    needPlayable(ch, me);
    const p = currentPuzzle(ch, me);
    if (!me.startedAt) me.startedAt = Date.now();
    if (!P.isCorrect(p, ctx.body.guess)) {
      me.wrong++;
      save();
      return { correct: false };
    }
    const ms = Date.now() - me.startedAt;
    const points = roundPoints(ms, me.wrong);
    completeRound(ch, ctx, me, { id: p.id, solved: true, points, ms });
    return Premium.gate(ctx.user, { correct: true, answer: p.answer, fact: p.fact, points, finished: me.finishedAt != null, won: isRace(ch) && ch.winner === ctx.user.id });
  }, { auth: true });

  route('POST', '/api/challenges/:id/skip', (ctx) => {
    const { ch, me } = getMine(ctx);
    if (isWs(ch)) throw new HttpError(400, 'Word search races have no skip.');
    if (isSl(ch)) throw new HttpError(400, 'Sliding puzzle races have no skip.');
    needPlayable(ch, me);
    const p = currentPuzzle(ch, me);
    const ms = me.startedAt ? Date.now() - me.startedAt : 0;
    completeRound(ch, ctx, me, { id: p.id, solved: false, points: -SKIP_PENALTY, ms });
    return Premium.gate(ctx.user, { answer: p.answer, fact: p.fact, points: -SKIP_PENALTY, finished: me.finishedAt != null, comesBack: isRace(ch) });
  }, { auth: true });

  setInterval(() => { try { endTimedRaces(); } catch (e) { console.error('[races] timer check failed:', e.message); } }, 10 * 1000).unref();
  setInterval(() => { try { startDueSponsored(); } catch (e) { console.error('[races] sponsored start failed:', e.message); } }, 20 * 1000).unref();
  setInterval(() => { try { sweepStale(); } catch (e) { console.error('[races] sweep failed:', e.message); } }, 3600 * 1000).unref();
};
module.exports.sweepStale = sweepStale;
module.exports.endTimedRaces = endTimedRaces;
module.exports.sweepStale = sweepStale;
module.exports.startDueSponsored = startDueSponsored;
module.exports.cancelWaiting = (ch) => cancelRace(ch);   // used by account deletion for a lobby that only invited the deleted player
