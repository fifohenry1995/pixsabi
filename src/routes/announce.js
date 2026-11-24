'use strict';
// Announcements from the admin.
//  * GET    /api/announcements        everybody: the latest announcements and how many are new to this player
//  * POST   /api/announcements/seen   mark them all as seen
//  * POST   /api/admin/announcements  admin: { title, body, chat: bool, alert: bool }  post one (optionally also in chat / as an alert to everyone)
//  * DELETE /api/admin/announcements/:id   admin: remove one
const { db, chat, announce, save, avatarUrl } = require('../db');
const { HttpError } = require('../util');
const Notify = require('../notify');

const TITLE_MAX = 60;
const BODY_MAX = 600;
const KEEP_SHOWN = 30;
const clean = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max);

const isAdmin = (u) => require('./admin').isAdmin(u);
function needAdmin(ctx) { if (!isAdmin(ctx.user)) throw new HttpError(404, 'Not found.'); }

const view = (r) => {
  const a = db.users[r.user_id];
  return { id: r.id, title: r.title, body: r.body, at: r.created_at, by: a ? a.username : 'Admin', avatar: a ? avatarUrl(a) : null };
};

module.exports = ({ route }) => {
  route('GET', '/api/announcements', (ctx) => {
    const u = ctx.user;
    return { items: announce.list(KEEP_SHOWN).map(view), unseen: announce.newerThan(u.annSeen || 0) };
  }, { auth: true });

  route('POST', '/api/announcements/seen', (ctx) => {
    ctx.user.annSeen = announce.latestId();
    save();
    return { unseen: 0 };
  }, { auth: true });

  route('POST', '/api/admin/announcements', async (ctx) => {
    needAdmin(ctx);
    const title = clean(ctx.body.title, TITLE_MAX).replace(/\n/g, ' ');
    const body = clean(ctx.body.body, BODY_MAX);
    if (!title) throw new HttpError(400, 'Give the announcement a title.');
    if (!body) throw new HttpError(400, 'Write the message.');
    const id = announce.add(ctx.user.id, title, body);
    ctx.user.annSeen = id; save();                       // the admin has seen their own post
    if (ctx.body.chat === true) {
      const text = `${title} - ${body.replace(/\s+/g, ' ')}`;
      chat.add(ctx.user, text.length > 300 ? text.slice(0, 297) + '...' : text);
    }
    let alerted = 0;
    if (ctx.body.alert === true) {
      alerted = await Notify.broadcast({ kind: 'announce', title: `Admin: ${title}`, body, url: '#/news', from: ctx.user.id });
    }
    console.log(`[announce] ${ctx.user.username} posted "${title}"${ctx.body.chat === true ? ' (also in chat)' : ''}${alerted ? ` (alert to ${alerted} players)` : ''}`);
    return { id, alerted };
  }, { auth: true, strict: true });

  route('DELETE', '/api/admin/announcements/:id', (ctx) => {
    needAdmin(ctx);
    if (!announce.remove(Number.parseInt(ctx.params.id, 10))) throw new HttpError(404, 'That announcement is already gone.');
    return { ok: true };
  }, { auth: true });
};
