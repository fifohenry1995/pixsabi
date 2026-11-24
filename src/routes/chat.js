'use strict';
// The chat room (one room for everybody) and the live player counts.
//
//  * GET  /api/stats            public: how many players are registered and how many are online
//  * GET  /api/presence         "I am here" ping from the open game (also returns the counts)
//  * GET  /api/chat             recent messages, or only the new ones with ?after=<id>
//  * POST /api/chat             send a message (no links, only challenge codes; admins may post links)
//  * PUT    /api/chat/:id       the author edits their own message
//  * DELETE /api/chat/:id       the author deletes their own message (admins can delete anybody's room message)
//  * GET  /api/chat/dm          private conversations (who, last message, unread)
//  * GET  /api/chat/dm/:name    one private thread (?after=<id> for only the new ones)
//  * POST /api/chat with { to: "name", text }  sends a private message
//  * @name in a room message alerts that player
//  * PUT  /api/admin/chat-lock  admin: pause or reopen the public room (optionally for a set time, with a note)
//  * POST /api/chat/:id/mute    admin: remove the message and stop that player chatting for 24 hours
//
// Links of any kind are refused (spam and scams). A challenge code is fine, and is shown as a Join button.
// Messages are plain text only (the game page never treats them as HTML), they are limited in
// length, rate limited, and only the newest 200 are kept (pinned admin messages stay).
const { db, q, chat, save, avatarUrl } = require('../db');
const { HttpError } = require('../util');
const Premium = require('../premium');
const { notify } = require('../notify');
const Presence = require('../presence');
const P = require('../puzzles');
const { tagOf } = require('../titles');
const ChatLock = require('../chatlock');

const MAX_LEN = 300;
const KEEP = 200;
const MAX_PINNED = 3;
const FIRST_LOAD = 50;
const MIN_GAP_MS = process.env.CHAT_MIN_GAP_MS != null ? Number(process.env.CHAT_MIN_GAP_MS) : 1500; // at least this long between two messages from one player
const PER_MINUTE = 15;        // and no more than this many in a minute
const DUPLICATE_MS = 60_000;  // the same text twice within this time is refused
const MUTE_MS = 24 * 3600 * 1000;
const REMOVED_MEMORY_MS = 10 * 60_000;

const lastPost = new Map();   // player id -> { at, text, times: [ms] }
const removed = [];           // { id, at } of messages deleted recently, so open chats can drop them
const editedRecent = [];      // { id, at } of messages edited recently, so open chats can refresh them
let posts = 0;

// Counts of registered players are cached for 5 seconds (cheap, and the number need not be exact).
let cachedTotal = { n: 0, at: 0 };
// Only the admin is told how many are online (investors see it in their report); everybody else just sees how many registered.
function totals(viewer) {
  if (Date.now() - cachedTotal.at > 5_000) cachedTotal = { n: q.userCount(), at: Date.now() };
  const online = Presence.count();
  const out = { players: Math.max(cachedTotal.n, online) }; // never fewer players than people online
  if (viewer && require('./admin').isAdmin(viewer)) out.online = online;
  return out;
}

// ---- links are not allowed (spam and scams), but challenge codes are ----
const TLDS = 'com|net|org|info|biz|xyz|io|me|co|ng|link|app|site|online|shop|store|club|top|click|live|vip|bet|cc|tk|ml|ga|cf|gq|ly|gl|ws|us|uk|tv|in|ru|cn|ink|page|fun|win|work|today|world|life|pro|dev|cloud|tech|website|space|icu|buzz|cam|gg|sh|to';
const LINK_RES = [
  /(https?|ftp|wss?):|\/\//i,                                         // http://, https://, //site
  /\bwww\s*\./i,                                                    // www.site
  new RegExp(`[a-z0-9-](\\.|\\s*[\\(\\[\\{]\\s*\\.\\s*[\\)\\]\\}]\\s*|\\s+dot\\s+)(${TLDS})\\b`, 'i'), // site.com, site(.)com, site dot com
  /[a-z0-9._%+-]+\s*(@|\(at\)|\[at\])\s*[a-z0-9-]+\s*\.\s*[a-z]{2,}/i,    // emails
  /\b(t|wa)\.me\b|\bbit\.ly\b|\btinyurl\b|\bwhatsapp\s*group\b|\bchat\.whatsapp\b/i, // short links and group invites
];
const hasLink = (text) => LINK_RES.some((re) => re.test(text));
const CODE_RE = /\b[A-HJ-KM-NP-Za-hj-km-np-z2-9]{6}\b/g; // same letters the game uses for challenge codes

// A challenge code in a message becomes a "Join" button, but only when it is a real race that can still be joined.
function challengeIn(text) {
  for (const token of (text.match(CODE_RE) || []).slice(0, 3)) {
    const ch = db.challenges[token.toUpperCase()];
    if (!ch || !ch.race || ch.status !== 'waiting' || ch.startedAt) continue;
    if (Object.keys(ch.players).length >= (ch.maxPlayers || 2)) continue;
    return {
      id: ch.id, rounds: ch.rounds, stake: ch.stake || 0, category: ch.category || null,
      host: db.users[ch.createdBy] ? db.users[ch.createdBy].username : ch.createdBy,
      players: Object.keys(ch.players).length, maxPlayers: ch.maxPlayers || 2,
    };
  }
  return null;
}

// Plain, single-spaced text: no control characters, no invisible direction tricks.
function clean(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁩﻿]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Real players tagged with @name in a message (up to 3).
function mentionsIn(text) {
  const out = [];
  for (const m of text.matchAll(/@([A-Za-z0-9_]{3,20})/g)) {
    const u = db.users[m[1].toLowerCase()];
    if (u && !out.some((x) => x.id === u.id)) out.push(u);
    if (out.length >= 3) break;
  }
  return out;
}

function resultView(row) {
  let r; try { r = JSON.parse(row.text.slice(1)); } catch { r = { w: '?', n: 0 }; }
  const text = `${r.w} just won a race${r.n > 1 ? ` against ${r.n - 1} other player${r.n === 2 ? '' : 's'}` : ''}!`;
  return { id: row.id, username: 'PixSabi', avatar: null, title: '', icon: '', tier: 1, admin: false, premium: false, text, at: row.created_at, mine: false, pinned: false, edited: false, mentions: [], challenge: null, result: { winner: r.w, players: r.n || 0 } };
}

function view(row, me) {
  if (row.text.charCodeAt(0) === 1) return resultView(row);
  const u = db.users[row.user_id];
  return {
    edited: !!row.edited_at, mentions: mentionsIn(row.text).map((x) => x.username),
    id: row.id, username: u ? u.username : row.username, avatar: u ? avatarUrl(u) : null,
    ...(u ? tagOf(u.points) : { title: '', icon: '', tier: 1 }),
    admin: !!u && require('./admin').isAdmin(u),
    premium: !!u && Premium.isPremium(u),
    text: row.text, at: row.created_at, mine: row.user_id === me.id, pinned: !!row.pinned,
    challenge: challengeIn(row.text),
  };
}

function needAdmin(ctx) {
  if (!require('./admin').isAdmin(ctx.user)) throw new HttpError(404, 'Not found.');
}
function touchedEdit(id) {
  editedRecent.push({ id, at: Date.now() });
  const cutoff = Date.now() - REMOVED_MEMORY_MS;
  while (editedRecent.length && editedRecent[0].at < cutoff) editedRecent.shift();
}
function forget(id) {
  removed.push({ id, at: Date.now() });
  const cutoff = Date.now() - REMOVED_MEMORY_MS;
  while (removed.length && removed[0].at < cutoff) removed.shift();
}

module.exports = ({ route }) => {
  module.exports.hasLink = hasLink;
  route('GET', '/api/stats', (ctx) => ({ ...totals(ctx.user), categories: P.categories().map((c) => c.name), turnstile: require('../turnstile').siteKey() }));
  route('GET', '/api/presence', (ctx) => totals(ctx.user), { auth: true }); // being authenticated already marked the player online

  route('GET', '/api/chat', (ctx) => {
    const me = ctx.user;
    const after = Number.parseInt(ctx.query.after, 10);
    const rows = Number.isInteger(after) && after > 0 ? chat.since(after, 100) : chat.recent(FIRST_LOAD);
    const cutoff = Date.now() - REMOVED_MEMORY_MS;
    return {
      messages: rows.map((r) => view(r, me)),
      removed: removed.filter((r) => r.at >= cutoff).map((r) => r.id),
      edited: editedRecent.filter((r) => r.at >= cutoff).map((r) => chat.get(r.id)).filter((r) => r && !r.to_id).map((r) => view(r, me)),
      pinned: chat.pinned().map((r) => view(r, me)),
      muted: (me.chatMutedUntil || 0) > Date.now(),
      lock: ChatLock.current(),
      admin: require('./admin').isAdmin(me),
      ...totals(),
    };
  }, { auth: true });

  // The rules for any message a player writes (room or private): not muted, plain text, no links, not too fast, not repeated.
  function checkText(u, raw, { count = true } = {}) {
    if ((u.chatMutedUntil || 0) > Date.now()) throw new HttpError(403, 'You cannot send messages right now. A moderator has muted you for a while.');
    const text = clean(raw);
    if (!text) throw new HttpError(400, 'Type a message first.');
    if (text.length > MAX_LEN) throw new HttpError(400, `Keep messages to ${MAX_LEN} letters or fewer.`);
    if (!require('./admin').isAdmin(u) && hasLink(text)) {
      throw new HttpError(400, 'Links are not allowed in chat. You can share a challenge code instead.');
    }
    if (!count) return text;
    const now = Date.now();
    const rec = lastPost.get(u.id) || { at: 0, text: '', times: [] };
    if (now - rec.at < MIN_GAP_MS) throw new HttpError(429, 'Slow down a little.');
    rec.times = rec.times.filter((t) => now - t < 60_000);
    if (rec.times.length >= PER_MINUTE) throw new HttpError(429, 'You are sending messages too fast. Wait a moment.');
    if (text.toLowerCase() === rec.text && now - rec.at < DUPLICATE_MS) throw new HttpError(400, 'You just sent that.');
    rec.at = now; rec.text = text.toLowerCase(); rec.times.push(now);
    lastPost.set(u.id, rec);
    return text;
  }

  // The public room can be paused by the admin: everybody else can read but not write.
  function roomOpen(u) {
    const l = ChatLock.current();
    if (l.locked && !require('./admin').isAdmin(u)) throw new HttpError(403, l.note ? `The chat room is paused: ${l.note}` : 'The chat room is paused by the admin for now. You can still read it.');
  }
  route('GET', '/api/admin/chat-lock', (ctx) => { if (!require('./admin').isAdmin(ctx.user)) throw new HttpError(404, 'Not found.'); return ChatLock.current(); }, { auth: true });
  route('PUT', '/api/admin/chat-lock', (ctx) => {
    if (!require('./admin').isAdmin(ctx.user)) throw new HttpError(404, 'Not found.');
    return ChatLock.set(!!ctx.body.locked, ctx.body.note, ctx.body.minutes);
  }, { auth: true });

  route('POST', '/api/chat', (ctx) => {
    const u = ctx.user;
    let to = null;
    if (ctx.body.to != null && ctx.body.to !== '') {
      to = db.users[String(ctx.body.to).toLowerCase()];
      if (!to) throw new HttpError(404, 'No player has that username.');
      if (to.id === u.id) throw new HttpError(400, 'You cannot message yourself.');
    }
    if (!to) roomOpen(u);
    const text = checkText(u, ctx.body.text);
    const id = chat.add(u, text, to && to.id);
    require('../stats').bump(to ? 'dm' : 'chat');
    if (++posts % 50 === 0) chat.prune(KEEP);
    if (to) {
      notify(to.id, { kind: 'dm', from: u.id, title: `${u.username} sent you a message`, body: text, url: `#/chat/dm/${u.username}` });
    } else {
      for (const m of mentionsIn(text)) {
        notify(m.id, { kind: 'mention', from: u.id, title: `${u.username} mentioned you in chat`, body: text, url: '#/chat' });
      }
    }
    return { message: view(chat.get(id), u) };
  }, { auth: true });

  route('PUT', '/api/chat/:id', (ctx) => {
    const u = ctx.user;
    const row = chat.get(Number.parseInt(ctx.params.id, 10));
    if (!row || row.user_id !== u.id) throw new HttpError(404, 'That message is not yours or is already gone.');
    if (!row.to_id) roomOpen(u);
    const text = checkText(u, ctx.body.text, { count: false });
    if (text !== row.text) { chat.edit(row.id, text); touchedEdit(row.id); }
    return { message: view(chat.get(row.id), u) };
  }, { auth: true });

  // ---- private messages ----
  const partnerOf = (ctx) => {
    const p = db.users[String(ctx.params.name || '').toLowerCase()];
    if (!p || p.id === ctx.user.id) throw new HttpError(404, 'No player has that username.');
    return p;
  };
  const seenOf = (u) => (u.dmSeen || (u.dmSeen = {}));

  route('GET', '/api/chat/dm', (ctx) => {
    const me = ctx.user, seen = seenOf(me);
    const byPartner = new Map();
    for (const r of chat.mine(me.id)) {            // newest first
      const other = r.user_id === me.id ? r.to_id : r.user_id;
      let c = byPartner.get(other);
      if (!c) { c = { last: r, unread: 0 }; byPartner.set(other, c); }
      if (r.user_id !== me.id && r.id > (seen[other] || 0)) c.unread++;
    }
    const conversations = [...byPartner].map(([id, c]) => {
      const p = db.users[id];
      return p ? { username: p.username, avatar: avatarUrl(p), ...tagOf(p.points), online: Presence.isOnline ? Presence.isOnline(p.id) : false,
        last: { text: c.last.text, at: c.last.created_at, mine: c.last.user_id === me.id }, unread: c.unread } : null;
    }).filter(Boolean);
    return { conversations, unread: conversations.reduce((n, c) => n + c.unread, 0) };
  }, { auth: true });

  route('GET', '/api/chat/dm/:name', (ctx) => {
    const me = ctx.user, p = partnerOf(ctx);
    const after = Number.parseInt(ctx.query.after, 10);
    const rows = Number.isInteger(after) && after > 0 ? chat.threadSince(me.id, p.id, after, 100) : chat.thread(me.id, p.id, FIRST_LOAD);
    const cutoff = Date.now() - REMOVED_MEMORY_MS;
    const seen = seenOf(me);
    const top = rows.reduce((m, r) => Math.max(m, r.id), seen[p.id] || 0);
    if (top !== (seen[p.id] || 0)) { seen[p.id] = top; save(); }
    const mine = (r) => r && r.to_id && ((r.user_id === me.id && r.to_id === p.id) || (r.user_id === p.id && r.to_id === me.id));
    return {
      with: { username: p.username, avatar: avatarUrl(p), ...tagOf(p.points) },
      messages: rows.map((r) => view(r, me)),
      removed: removed.filter((r) => r.at >= cutoff).map((r) => r.id),
      edited: editedRecent.filter((r) => r.at >= cutoff).map((r) => chat.get(r.id)).filter(mine).map((r) => view(r, me)),
      muted: (me.chatMutedUntil || 0) > Date.now(),
    };
  }, { auth: true });

  route('DELETE', '/api/chat/:id', (ctx) => {
    const id = Number.parseInt(ctx.params.id, 10);
    const row = Number.isInteger(id) ? chat.get(id) : null;
    if (!row) throw new HttpError(404, 'That message is already gone.');
    // anybody can delete their own message; an admin can delete anybody's message in the room (never a private one)
    if (row.user_id !== ctx.user.id) {
      needAdmin(ctx);
      if (row.to_id) throw new HttpError(404, 'That message is already gone.');
    }
    if (!chat.remove(id)) throw new HttpError(404, 'That message is already gone.');
    forget(id);
    return { ok: true };
  }, { auth: true });

  // An admin can pin any admin message in the room (up to 3). Pinned messages show at the top of the chat and are never cleared.
  route('POST', '/api/chat/:id/pin', (ctx) => {
    needAdmin(ctx);
    const row = chat.get(Number.parseInt(ctx.params.id, 10));
    if (!row || row.to_id) throw new HttpError(404, 'That message is already gone.');
    const on = ctx.body.pinned !== false;
    if (on) {
      const author = db.users[row.user_id];
      if (!author || !require('./admin').isAdmin(author)) throw new HttpError(400, 'Only admin messages can be pinned.');
      if (!row.pinned && chat.pinned().length >= MAX_PINNED) throw new HttpError(400, `You can pin up to ${MAX_PINNED} messages. Unpin one first.`);
    }
    chat.pin(row.id, on);
    touchedEdit(row.id);
    return { ok: true, pinned: on };
  }, { auth: true });

  route('POST', '/api/chat/:id/mute', (ctx) => {
    needAdmin(ctx);
    const row = chat.get(Number.parseInt(ctx.params.id, 10));
    if (!row || row.to_id) throw new HttpError(404, 'That message is already gone.');
    const target = db.users[row.user_id];
    if (target && require('./admin').isAdmin(target)) throw new HttpError(400, 'You cannot mute an admin.');
    if (target) { target.chatMutedUntil = Date.now() + MUTE_MS; save(); }
    forget(row.id);
    chat.remove(row.id);
    console.log(`[chat] ${ctx.user.username} muted ${row.username} for 24 hours`);
    return { ok: true };
  }, { auth: true });
};
