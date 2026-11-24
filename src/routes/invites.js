'use strict';
// Invite a friend. Every player's invite link is  <your site>/?ref=<their username>.
// When the friend signs up through it and solves their first level, BOTH get coins.
//   * the friend gets INVITE_COINS once, on their first solved level (solo or daily)
//   * the inviter gets INVITE_COINS for each friend, up to MAX_REWARDED friends (so one player cannot farm coins)
//  GET /api/invite  -> how the player's invites are going
const { db, save } = require('../db');
const { notify } = require('../notify');
const Verify = require('../verify');

const INVITE_COINS = 50;
const MAX_REWARDED = 20;
const MAX_PER_DAY = 5;         // an inviter is paid for at most this many friends a day
const KEEP_LIST = 100;

// Called when a new account is made through someone's link.
function link(newUser, refName) {
  const ref = String(refName || '').trim().toLowerCase().slice(0, 20);
  if (!ref || ref === newUser.id) return;
  const inviter = db.users[ref];
  if (!inviter) return;
  newUser.invitedBy = inviter.id;
  inviter.invited = (inviter.invited || []).slice(-(KEEP_LIST - 1));
  inviter.invited.push({ id: newUser.id, username: newUser.username, done: false });
}

// Called when a player solves a level. Returns the coins the player just received (0 if none).
function firstSolve(u) {
  if (!u.invitedBy || u.inviteDone) return 0;
  if (Verify.pending(u)) return 0;                 // the friend must confirm their email first; they are paid on a later solve
  u.inviteDone = true;
  u.coins += INVITE_COINS;
  const inviter = db.users[u.invitedBy];
  if (inviter) {
    const row = (inviter.invited || []).find((x) => x.id === u.id);
    if (row) row.done = true;
    const day = new Date().toISOString().slice(0, 10);
    if (!inviter.inviteDay || inviter.inviteDay.d !== day) inviter.inviteDay = { d: day, n: 0 };
    if ((inviter.inviteRewarded || 0) < MAX_REWARDED && inviter.inviteDay.n < MAX_PER_DAY && !Verify.pending(inviter)) {
      inviter.inviteDay.n++;
      inviter.inviteRewarded = (inviter.inviteRewarded || 0) + 1;
      inviter.coins += INVITE_COINS;
      notify(inviter.id, { kind: 'invite', title: `${u.username} joined!`, body: `Your friend solved their first level. You both got ${INVITE_COINS} coins.`, url: '#/invite', from: u.id });
    }
  }
  return INVITE_COINS;
}

module.exports = ({ route }) => {
  route('GET', '/api/invite', (ctx) => {
    const u = ctx.user;
    const list = u.invited || [];
    return {
      username: u.username,
      reward: INVITE_COINS, max: MAX_REWARDED,
      joined: list.length, solved: list.filter((x) => x.done).length,
      rewarded: u.inviteRewarded || 0,
      friends: list.slice(-20).reverse().map((x) => ({ username: x.username, done: x.done })),
    };
  }, { auth: true });
};
module.exports.link = link;
module.exports.firstSolve = firstSolve;
module.exports.INVITE_COINS = INVITE_COINS;
module.exports.MAX_PER_DAY = MAX_PER_DAY;
