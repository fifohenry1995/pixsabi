'use strict';
// Alerts API (all for the logged-in player):
//  * GET  /api/notifications            the inbox, the unread count and the player's alert settings
//  * POST /api/notifications/read       mark everything (or one alert, {id}) as read
//  * POST /api/notifications/settings   { enabled: true|false } switch all alerts on or off
//  * GET  /api/push/key                 the public key the browser needs to subscribe
//  * POST /api/push/subscribe           save this browser or phone for push alerts
//  * POST /api/push/unsubscribe         stop push alerts on this browser or phone
const { db, inbox, pushSubs, save } = require('../db');
const { HttpError } = require('../util');
const Push = require('../push');

const MAX_DEVICES = 5;

module.exports = ({ route }) => {
  route('GET', '/api/notifications', (ctx) => {
    const u = ctx.user;
    return {
      enabled: !u.alertsOff,
      push: pushSubs.count(u.id) > 0,
      unread: inbox.unread(u.id),
      items: inbox.list(u.id, 30).map((n) => ({ id: n.id, kind: n.kind, title: n.title, body: n.body, url: n.url, at: n.created_at, read: !!n.read })),
    };
  }, { auth: true });

  route('POST', '/api/notifications/read', (ctx) => {
    const id = ctx.body.id;
    if (id != null) inbox.readOne(ctx.user.id, Number(id) || 0); else inbox.readAll(ctx.user.id);
    return { unread: inbox.unread(ctx.user.id) };
  }, { auth: true });

  route('POST', '/api/notifications/settings', (ctx) => {
    if (typeof ctx.body.enabled !== 'boolean') throw new HttpError(400, 'Say whether alerts should be on or off.');
    ctx.user.alertsOff = !ctx.body.enabled;
    if (ctx.user.alertsOff) pushSubs.removeAll(ctx.user.id);
    save();
    return { enabled: !ctx.user.alertsOff };
  }, { auth: true });

  route('GET', '/api/push/key', () => ({ key: Push.publicKey() }), { auth: true });

  route('POST', '/api/push/subscribe', (ctx) => {
    const b = ctx.body || {};
    const keys = b.keys || {};
    const endpoint = String(b.endpoint || '');
    if (!Push.endpointOk(endpoint)) throw new HttpError(400, 'This browser is not supported for alerts.');
    if (!Push.keysOk(String(keys.p256dh || ''), String(keys.auth || ''))) throw new HttpError(400, 'The alert details from your browser were not valid. Try again.');
    if (ctx.user.alertsOff) { ctx.user.alertsOff = false; save(); }
    pushSubs.put(ctx.user.id, { endpoint, p256dh: keys.p256dh, auth: keys.auth }); // a phone that switches player replaces the old owner
    pushSubs.trim(ctx.user.id, MAX_DEVICES);
    return { push: true };
  }, { auth: true, maxBody: 4000 });

  route('POST', '/api/push/unsubscribe', (ctx) => {
    const endpoint = String(ctx.body.endpoint || '');
    if (endpoint) pushSubs.removeMine(ctx.user.id, endpoint); else pushSubs.removeAll(ctx.user.id);
    return { push: pushSubs.count(ctx.user.id) > 0 };
  }, { auth: true });
};
