'use strict';
// Leaderboards: one for each game (Naija, Universal, Word Search, Slide Puzzle), plus the weekly board behind the weekly prizes and an overall total.
//  GET /api/leaderboard?board=naija|universal|wordsearch|slide|weekly|overall
const { q, meta, avatarUrl } = require('../db');
const Points = require('../points');
const Weekly = require('../weekly');
const { tagOf } = require('../titles');

const BOARDS = ['overall', 'weekly', 'naija', 'universal', 'wordsearch', 'slide'];
const CAT_OF = { naija: 'Naija', universal: 'Universal', wordsearch: 'Word Search', slide: 'Slide Puzzle' };

module.exports = ({ route }) => {
  route('GET', '/api/leaderboard', (ctx) => {
    const me = ctx.user;
    const board = BOARDS.includes(ctx.query.board) ? ctx.query.board : 'overall';
    Points.ensure(me);
    const wk = Points.weekIdOf();
    let list, valueOf, rank, myPoints;
    if (board === 'overall') {
      list = q.topPlayers(25); valueOf = (u) => u.points;
      ({ rank } = q.rankOf(me)); myPoints = me.points;
    } else if (board === 'weekly') {
      list = q.topWeekly(wk, 1, 25); valueOf = (u) => u.week.pts;
      myPoints = me.week && me.week.id === wk ? me.week.pts : 0;
      rank = myPoints ? q.rankWeekly(wk, myPoints) : null;
    } else {
      const cat = CAT_OF[board];
      list = q.topIn(board, 25); valueOf = (u) => Points.ensure(u)[cat];
      myPoints = Points.ensure(me)[cat];
      rank = myPoints ? q.rankIn(board, myPoints) : null;
    }
    const out = {
      board,
      top: list.map((u, i) => ({
        rank: i + 1, username: u.username, points: valueOf(u), wins: u.stats.won, avatar: avatarUrl(u),
        you: u.id === me.id, ...tagOf(u.points),
      })),
      me: { rank, points: myPoints },
      players: q.userCount(),
    };
    if (board === 'weekly') {
      out.weekly = { endsAt: Points.weekEndsAt(), prizes: Weekly.PRIZES, min: Weekly.MIN_POINTS, last: Weekly.lastWinners() };
    }
    return out;
  }, { auth: true });
};
