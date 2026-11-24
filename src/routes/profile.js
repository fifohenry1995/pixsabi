'use strict';
// Player profiles: a short bio, a display picture picked from a fixed set, and a public view of any player.
const fs = require('fs');
const path = require('path');
const { db, q, save, avatarUrl, AVATAR_DIR } = require('../db');
const Premium = require('../premium');
const Avatars = require('../avatars');
const { HttpError } = require('../util');
const { puzzles } = require('../puzzles');
const Presence = require('../presence');
const { allLevelsOf } = require('./solo');
const { titleOf, badgesOf } = require('../titles');

const BIO_MAX = 160;

const fileFor = (u) => path.join(AVATAR_DIR, `${u.id}.jpg`);

module.exports = ({ route }) => {
  route('POST', '/api/profile', (ctx) => {
    const u = ctx.user;
    // One paragraph, no control characters, so it always displays cleanly.
    const bio = String(ctx.body.bio == null ? '' : ctx.body.bio)
      .replace(/[\u0000-\u001F\u007F]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if ([...bio].length > BIO_MAX) throw new HttpError(400, `Keep your description to ${BIO_MAX} characters or fewer.`);
    u.bio = bio;
    save();
    return { bio: u.bio };
  }, { auth: true });

  // Pick a display picture from the fixed set (drawn in the browser, so nothing is stored). Send { key: null } to go back to the letter.
  route('POST', '/api/profile/avatar', (ctx) => {
    const u = ctx.user;
    const key = ctx.body.key;
    if (key != null && !Avatars.valid(key)) throw new HttpError(400, 'Pick one of the pictures on the list.');
    try { fs.unlinkSync(fileFor(u)); } catch { /* no old photo */ }   // an old uploaded photo is no longer needed
    u.avatarV = 0;
    u.avatarKey = key || '';
    save();
    return { avatar: avatarUrl(u) };
  }, { auth: true, strict: true });

  // Public view of any player. Never includes the password hash or private details.
  route('GET', '/api/players/:username', (ctx) => {
    const u = db.users[String(ctx.params.username || '').toLowerCase()];
    if (!u) throw new HttpError(404, 'No player has that username.');
    const { rank, players } = q.rankOf(u);
    return {
      player: {
        username: u.username,
        bio: u.bio || '',
        avatar: avatarUrl(u),
        points: u.points,
        solvedCount: Object.keys(u.solved).length,
        levels: allLevelsOf(u),
        title: titleOf(u.points),
        badges: badgesOf(u),
        totalPuzzles: puzzles.length,
        bestStreak: u.daily.best,
        stats: u.stats,
        rank, players,
        you: u.id === ctx.user.id,
        online: Presence.isOnline(u.id),
        joined: u.createdAt,
        premium: Premium.isPremium(u),
      },
    };
  }, { auth: true });
};
