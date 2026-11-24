'use strict';
const { db, q, save, newUser, avatarUrl, resets, resetReq } = require('../db');
const Mailer = require('../mailer');
const Premium = require('../premium');
const Quiz = require('../quiz');
const Verify = require('../verify');
const Recovery = require('../recovery');
const AccountDel = require('../accountDelete');
const Turnstile = require('../turnstile');
const { hashPassword, verifyPassword, HttpError } = require('../util');
const { puzzles } = require('../puzzles');
const { allLevelsOf } = require('./solo');
const { titleOf, badgesOf } = require('../titles');

const USERNAME_RE = /^[A-Za-z0-9_]{3,20}$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const RESET_TTL_MS = 60 * 60 * 1000;    // a reset link works for one hour
const RESET_GAP_MS = 5 * 60 * 1000;     // and a player can ask for one every 5 minutes
const lastReset = new Map();

function cleanEmail(raw) {
  const email = String(raw == null ? '' : raw).trim().toLowerCase();
  if (!email || email.length > 120 || !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address, like name@example.com.');
  return email;
}
function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto']) || 'http';
  return `${String(proto).split(',')[0].trim()}://${req.headers.host}`;
}
function checkPassword(password) {
  if (password.length < 6 || password.length > 72) throw new HttpError(400, 'Password must be 6 to 72 characters.');
}
let dummyHash = null; // used so unknown usernames take as long as wrong passwords

function publicUser(u) {
  return {
    username: u.username,
    bio: u.bio || '',
    avatar: avatarUrl(u),
    email: u.email || '',
    emailPending: Verify.pending(u),
    mustChange: !!u.mustChange,
    deleteAt: AccountDel.pending(u) ? u.deleteAt : 0,
    recoveryQuestion: Recovery.has(u) ? Recovery.textOf(u.recoveryQ) : '',
    adultConfirmed: !!u.adultAt,
    points: u.points,
    coins: u.coins,
    solvedCount: Object.keys(u.solved).length,
    levels: allLevelsOf(u),
    title: titleOf(u.points),
    badges: badgesOf(u),
    totalPuzzles: puzzles.length,
    streak: u.daily.streak,
    bestStreak: u.daily.best,
    stats: u.stats,
    premium: Premium.isPremium(u),
    premiumUntil: Premium.isPremium(u) ? u.premiumUntil : null,
    premiumDaysLeft: Premium.daysLeft(u),
    premiumOpen: Premium.isOpen(),
    quizOpen: Quiz.isOpen(),
    quizAdmin: require('./admin').isAdmin(u),
    isAdmin: require('./admin').isAdmin(u),
    canHostQuiz: Quiz.canHost(u, require('./admin').isAdmin(u)),
  };
}

module.exports = ({ route, sessionCookie, clearCookie }) => {
  route('POST', '/api/auth/register', async (ctx) => {
    const username = String(ctx.body.username || '').trim();
    const password = String(ctx.body.password || '');
    if (!USERNAME_RE.test(username)) {
      throw new HttpError(400, 'Username must be 3 to 20 letters, numbers or underscores.');
    }
    checkPassword(password);
    const email = cleanEmail(ctx.body.email);
    let human = false;
    try { human = await Turnstile.check(ctx.body.cfToken, ctx.ip); } catch { throw new HttpError(503, 'Could not run the human check right now. Try again in a minute.'); }
    if (!human) throw new HttpError(400, 'Please complete the "I am human" check and try again.');
    if (ctx.body.adult !== true) throw new HttpError(400, 'You must be 18 or older, and tick the box to confirm it, to create an account.');
    if (db.users[username.toLowerCase()]) throw new HttpError(409, 'That username is taken. Try another.');
    if (q.userByEmail(email)) throw new HttpError(409, 'That email already has an account. Log in instead, or use "Forgot password".');
    const user = newUser(username, await hashPassword(password));
    user.email = email;
    user.adultAt = Date.now();   // when they confirmed they are 18 or older and accepted the privacy policy and disclaimer
    require('./invites').link(user, ctx.body.ref);   // signed up through a friend's invite link
    if (ctx.body.recoveryQ) {                         // optional recovery question picked at sign-up
      const bad = Recovery.problem(ctx.body.recoveryQ, ctx.body.recoveryA);
      if (bad) throw new HttpError(400, bad);
      await Recovery.set(user, ctx.body.recoveryQ, ctx.body.recoveryA);
    }
    user.lastLoginAt = Date.now();
    db.users[user.id] = user;
    Verify.start(user, baseUrl(ctx.req));   // emails the confirmation link (when email sending is set up)
    save();
    ctx.headers['Set-Cookie'] = sessionCookie(user.id, user.pwv);
    return { user: publicUser(user) };
  }, { strict: true });

  route('POST', '/api/auth/login', async (ctx) => {
    const username = String(ctx.body.username || '').trim().toLowerCase();
    const password = String(ctx.body.password || '');
    const user = db.users[username];
    if (!dummyHash) dummyHash = await hashPassword('not-a-real-password');
    let ok = await verifyPassword(password, user ? user.passHash : dummyHash);
    // A temporary password from the admin is all lowercase, but phones often add a capital or a space when it is pasted or copied.
    if (!ok && user && user.mustChange) ok = await verifyPassword(password.trim().toLowerCase(), user.passHash);
    if (!user || !ok) throw new HttpError(401, 'Wrong username or password.');
    user.lastLoginAt = Date.now();
    ctx.headers['Set-Cookie'] = sessionCookie(user.id, user.pwv);
    return { user: publicUser(user) };
  }, { strict: true });

  // ---- forgot password: a link is emailed to the address on the account ----
  // The answer is always the same, so nobody can use this to find out which usernames or emails exist.
  route('POST', '/api/auth/forgot', async (ctx) => {
    const who = String(ctx.body.who || '').trim().toLowerCase().slice(0, 120);
    if (!who) throw new HttpError(400, 'Type your username or the email you registered with.');
    const user = who.includes('@') ? q.userByEmail(who) : db.users[who];
    const origin = baseUrl(ctx.req);
    if (user && Date.now() - (lastReset.get(user.id) || 0) >= RESET_GAP_MS) {
      lastReset.set(user.id, Date.now());
      if (!user.email) {
        resetReq.add(user.id, 'no-email');          // nothing can be emailed: the admin sees this request and can help by hand
      } else {
        const token = resets.create(user.id, RESET_TTL_MS);
        const link = `${origin}/#/reset/${token}`;
        const rid = resetReq.add(user.id, 'sending');
        Mailer.send({
          to: user.email,
          subject: 'Reset your PixSabi password',
          text: `Hi ${user.username},\n\nSomeone asked to reset the password for your PixSabi account. To choose a new password, open this link within 1 hour:\n\n${link}\n\nIf this was not you, ignore this email. Your password stays the same.\n\nPixSabi`,
          html: `<p>Hi ${user.username},</p><p>Someone asked to reset the password for your PixSabi account. To choose a new password, open this link within 1 hour:</p><p><a href="${link}">Choose a new password</a></p><p>If this was not you, ignore this email. Your password stays the same.</p><p>PixSabi</p>`,
        }).then((ok) => resetReq.setOutcome(rid, ok ? 'sent' : 'mail-failed')).catch(() => resetReq.setOutcome(rid, 'mail-failed'));
      }
    }
    return { ok: true, message: 'If that account has an email address on file, we have sent a reset link to it. Check your inbox and your spam folder. The link works for 1 hour.' };
  }, { strict: true });

  route('POST', '/api/auth/reset', async (ctx) => {
    const password = String(ctx.body.password || '');
    checkPassword(password);
    const id = resets.consume(String(ctx.body.token || ''));
    const user = id && db.users[id];
    if (!user) throw new HttpError(400, 'This reset link is not valid any more. Ask for a new one.');
    user.passHash = await hashPassword(password);
    user.mustChange = false;
    user.pwv = (user.pwv || 0) + 1;      // logs out every other device
    save();
    ctx.headers['Set-Cookie'] = sessionCookie(user.id, user.pwv);
    return { user: publicUser(user) };
  }, { strict: true });

  route('POST', '/api/auth/logout', async (ctx) => {
    ctx.headers['Set-Cookie'] = clearCookie();
    return { ok: true };
  });

  route('GET', '/api/me', (ctx) => ({ user: publicUser(ctx.user) }), { auth: true });

  // Players who joined before the 18+ box existed confirm it once (and may add an email at the same time).
  route('POST', '/api/me/adult', async (ctx) => {
    const u = ctx.user;
    if (ctx.body.adult !== true) throw new HttpError(400, 'You must be 18 or older to keep playing.');
    if (ctx.body.email) {
      const email = cleanEmail(ctx.body.email);
      const other = q.userByEmail(email);
      if (other && other.id !== u.id) throw new HttpError(409, 'That email already belongs to another account.');
      if (u.email !== email) { u.email = email; Verify.start(u, baseUrl(ctx.req)); }
    }
    u.adultAt = u.adultAt || Date.now();
    save();
    return { user: publicUser(u) };
  }, { auth: true, strict: true });

  // Set, change or remove the recovery question (asks for the password so a borrowed phone cannot change it).
  route('GET', '/api/recovery/questions', () => ({ questions: Recovery.QUESTIONS }));
  route('POST', '/api/me/recovery', async (ctx) => {
    const u = ctx.user;
    if (!(await verifyPassword(String(ctx.body.password || ''), u.passHash))) throw new HttpError(401, 'That password is not right.');
    if (!ctx.body.question) { Recovery.clear(u); save(); return { user: publicUser(u) }; }
    const bad = Recovery.problem(ctx.body.question, ctx.body.answer);
    if (bad) throw new HttpError(400, bad);
    await Recovery.set(u, ctx.body.question, ctx.body.answer);
    save();
    return { user: publicUser(u) };
  }, { auth: true, strict: true });

  // ---- delete my account: removed 3 days after the request; can be cancelled until then ----
  route('POST', '/api/me/delete', async (ctx) => {
    const u = ctx.user;
    if (require('./admin').isAdmin(u)) throw new HttpError(400, 'The admin account cannot be deleted here.');
    if (!(await verifyPassword(String(ctx.body.password || ''), u.passHash))) throw new HttpError(401, 'That password is not right.');
    if (String(ctx.body.confirm || '').trim().toUpperCase() !== 'DELETE') throw new HttpError(400, 'Type the word DELETE to confirm.');
    AccountDel.schedule(u);
    return { user: publicUser(u) };
  }, { auth: true, strict: true });
  route('POST', '/api/me/delete/cancel', (ctx) => { AccountDel.cancel(ctx.user); return { user: publicUser(ctx.user) }; }, { auth: true });

  // For someone who cannot log in (public page /delete-account). The answer is always the same. If the account has an email we
  // send a confirmation link; opening it starts the 3-day countdown. The admin also sees the request (no email: they check by hand).
  const lastDelAsk = new Map();
  route('POST', '/api/auth/delete-request', async (ctx) => {
    const who = String(ctx.body.who || '').trim().toLowerCase().slice(0, 120);
    if (!who) throw new HttpError(400, 'Type your username or the email you registered with.');
    const user = who.includes('@') ? q.userByEmail(who) : db.users[who];
    if (user && !require('./admin').isAdmin(user) && Date.now() - (lastDelAsk.get(user.id) || 0) >= RESET_GAP_MS) {
      lastDelAsk.set(user.id, Date.now());
      if (!user.email) resetReq.add(user.id, 'delete-no-email');
      else {
        resetReq.add(user.id, 'delete-emailed');
        const link = `${baseUrl(ctx.req)}/#/delete/${AccountDel.makeToken(user)}`;
        Mailer.send({
          to: user.email, subject: 'Confirm that you want to delete your PixSabi account',
          text: `Hi ${user.username},\n\nSomeone asked to delete the PixSabi account "${user.username}". To confirm that it was you, open this link. Your account is then deleted 3 days later, and you can still cancel until then:\n\n${link}\n\nIf this was not you, ignore this email and nothing changes.\n\nPixSabi`,
        }).catch(() => {});
      }
    }
    return { ok: true, message: 'If we found that account, we have started the process. If it has an email address on file we sent a confirmation link to it. If it has none, we will contact you through the details on our contact page once we have checked the account is yours.' };
  }, { strict: true });
  route('POST', '/api/auth/delete-confirm', (ctx) => {
    const id = AccountDel.readToken(ctx.body.token);
    const u = id && db.users[id];
    if (!u || require('./admin').isAdmin(u)) throw new HttpError(400, 'This link is not valid any more. Ask for a new one on the delete account page.');
    const at = AccountDel.schedule(u);
    return { ok: true, username: u.username, when: AccountDel.dateWords(at) };
  }, { strict: true });

  // Change the email used for password recovery (asks for the password so a borrowed phone cannot change it).
  route('POST', '/api/me/email', async (ctx) => {
    const u = ctx.user;
    if (!(await verifyPassword(String(ctx.body.password || ''), u.passHash))) throw new HttpError(401, 'That password is not right.');
    const email = cleanEmail(ctx.body.email);
    const other = q.userByEmail(email);
    if (other && other.id !== u.id) throw new HttpError(409, 'That email already belongs to another account.');
    if (u.email !== email) { u.email = email; Verify.start(u, baseUrl(ctx.req)); }   // a new address must be confirmed again
    save();
    return { user: publicUser(u) };
  }, { auth: true, strict: true });

  // The page the confirmation email opens (#/verify/<token>) calls this. The link itself proves the email is theirs.
  route('POST', '/api/auth/verify', (ctx) => {
    const t = Verify.readToken(ctx.body.token);
    const u = t && db.users[t.id];
    if (!u || !Verify.confirm(u, ctx.body.token)) throw new HttpError(400, 'This confirmation link is not valid any more. Log in and tap "Send the link again".');
    return { ok: true, username: u.username };
  }, { strict: true });

  const lastVerifyMail = new Map();
  route('POST', '/api/auth/verify/resend', async (ctx) => {
    const u = ctx.user;
    if (!Verify.pending(u)) return { ok: true, already: true };
    if (Date.now() - (lastVerifyMail.get(u.id) || 0) < 60_000) throw new HttpError(429, 'We just sent one. Wait a minute, then check your inbox and spam folder.');
    lastVerifyMail.set(u.id, Date.now());
    const sent = await Verify.start(u, baseUrl(ctx.req));
    save();
    if (!sent) throw new HttpError(503, 'We could not send the email right now. Try again later.');
    return { ok: true };
  }, { auth: true, strict: true });

  route('POST', '/api/me/password', async (ctx) => {
    const u = ctx.user;
    if (!(await verifyPassword(String(ctx.body.current || ''), u.passHash))) throw new HttpError(401, 'Your current password is not right.');
    const next = String(ctx.body.next || '');
    checkPassword(next);
    u.passHash = await hashPassword(next);
    u.pwv = (u.pwv || 0) + 1;            // other devices are logged out; this one stays logged in
    u.mustChange = false;
    save();
    ctx.headers['Set-Cookie'] = sessionCookie(u.id, u.pwv);
    return { ok: true };
  }, { auth: true, strict: true });

  // Find a friend to challenge by typing the start of their username.
  route('GET', '/api/users/search', (ctx) => {
    const term = String(ctx.query.q || '').trim().toLowerCase();
    if (term.length < 2) return { users: [] };
    const users = q.searchUsers(term, ctx.user.id, 6).map((u) => u.username);
    return { users };
  }, { auth: true });
};

module.exports.publicUser = publicUser;
