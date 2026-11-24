'use strict';
// Email confirmation for new accounts. It switches itself on only when email sending is set up (RESEND_API_KEY + MAIL_FROM);
// set EMAIL_VERIFY=off to turn it off. A new (or changed) email is "pending" until the player opens the link we send.
// Pending players can play, but cannot win weekly coin prizes, or earn or give invite coins.
// That is what stops one person farming coins with many fake accounts.
const crypto = require('crypto');
const { getSecret, save } = require('./db');
const Mailer = require('./mailer');

const TTL_MS = 3 * 24 * 3600 * 1000;
const enabled = () => process.env.EMAIL_VERIFY !== 'off' && Mailer.configured();
const pending = (u) => !!(u && u.emailPending);
const sign = (payload) => crypto.createHmac('sha256', getSecret()).update('verify:' + payload).digest('base64url');

function makeToken(u, now = Date.now()) {
  const payload = Buffer.from(JSON.stringify({ u: u.id, e: u.email || '', x: now + TTL_MS })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
// Returns { id, email } for a good, unexpired token, else null.
function readToken(token, now = Date.now()) {
  const [payload, sig] = String(token || '').split('.');
  if (!payload || !sig) return null;
  const want = Buffer.from(sign(payload)), got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return null;
  try {
    const d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return d && d.x > now ? { id: String(d.u), email: String(d.e) } : null;
  } catch { return null; }
}
// Marks the account pending (when the feature is on) and emails the link. Never throws.
async function start(u, origin) {
  if (!enabled() || !u.email) { u.emailPending = false; return false; }
  u.emailPending = true;
  const link = `${origin}/#/verify/${makeToken(u)}`;
  return Mailer.send({
    to: u.email,
    subject: 'Confirm your email for PixSabi',
    text: `Hi ${u.username},\n\nTap this link to confirm your email and unlock weekly prizes and invite coins. It works for 3 days:\n\n${link}\n\nIf you did not sign up for PixSabi, ignore this email.\n\nPixSabi`,
    html: `<p>Hi ${u.username},</p><p>Tap the link to confirm your email and unlock weekly prizes and invite coins. It works for 3 days:</p><p><a href="${link}">Confirm my email</a></p><p>If you did not sign up for PixSabi, ignore this email.</p><p>PixSabi</p>`,
  }).catch(() => false);
}
function confirm(user, token) {
  const t = readToken(token);
  if (!t || !user || t.id !== user.id || t.email !== (user.email || '')) return false;   // an old link for an old email stops working
  user.emailPending = false;
  user.emailOkAt = Date.now();
  save();
  return true;
}
module.exports = { enabled, pending, makeToken, readToken, start, confirm, TTL_MS };
