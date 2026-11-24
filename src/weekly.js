'use strict';
// Weekly leaderboard prizes. Every Monday (Lagos time) the top 3 players of the week that just ended get coins.
// Needs at least MIN_POINTS that week to qualify, so a single lucky tap does not win. Paid once per week (the
// week is recorded in the database), even if the server restarts. If the server was off for more than a week, only
// the most recent finished week can be paid, because older weekly points have already been replaced.
const { db, q, meta, save } = require('./db');
const Points = require('./points');
const { notify } = require('./notify');
const Verify = require('./verify');

const PRIZES = [200, 100, 50];
const MIN_POINTS = 100;
const ORD = ['1st', '2nd', '3rd'];

function settle(now = new Date()) {
  const prev = Points.prevWeekIdOf(now);
  if (meta.get('weekly_paid') === prev) return null;
  meta.set('weekly_paid', prev); // claimed first, so nothing can ever be paid twice
  const winners = [];
  q.topWeekly(prev, MIN_POINTS, PRIZES.length).forEach((u, i) => {
    if (Verify.pending(u)) {   // an unconfirmed email cannot collect coin prizes
      notify(u.id, { kind: 'weekly', from: 'system', title: `You finished ${ORD[i]} on last week's leaderboard!`, body: 'Confirm your email (Me page) so you can collect weekly prizes. This week\'s prize was not paid.', url: '#/me' });
      return;
    }
    u.coins += PRIZES[i];
    if (i === 0) u.weeklyWins = (u.weeklyWins || 0) + 1;
    winners.push({ username: u.username, points: u.week.pts, prize: PRIZES[i] });
    notify(u.id, { kind: 'weekly', from: 'system', title: `You finished ${ORD[i]} on last week's leaderboard!`, body: `${PRIZES[i]} coins have been added to your wallet.`, url: '#/ranks' });
  });
  meta.set('weekly_last', JSON.stringify({ week: prev, winners }));
  if (winners.length) { save(); console.log(`[weekly] week of ${prev}: paid ${winners.map((w) => `${w.username} ${w.prize}`).join(', ')}`); }
  return winners;
}

function lastWinners() {
  try { return JSON.parse(meta.get('weekly_last') || 'null'); } catch { return null; }
}

function start() {
  Points.setRollHook(() => settle());
  try { settle(); } catch (e) { console.error('[weekly]', e.message); }
  const t = setInterval(() => { try { settle(); } catch (e) { console.error('[weekly]', e.message); } }, 10 * 60_000);
  if (t.unref) t.unref();
}

module.exports = { settle, lastWinners, start, PRIZES, MIN_POINTS };
