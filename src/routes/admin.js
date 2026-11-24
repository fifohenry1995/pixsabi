'use strict';
// Admin page API: add, edit and delete puzzles from the browser.
// Only the usernames you name as admins can use it (see isAdmin below). Everyone else
// gets a plain "Not found", as if these pages did not exist.
const fs = require('fs');
const path = require('path');
const { db, q, save, resetReq, orders } = require('../db');
const Recovery = require('../recovery');
const AccountDel = require('../accountDelete');
const Premium = require('../premium');
const { allLevelsOf } = require('./solo');
const { HttpError } = require('../util');
const P = require('../puzzles');
const Ads = require('../ads');
const Pop = require('../popups');
const Adsense = require('../adsense');
const Bg = require('../loginbg');
const WorldBg = require('../worldbg');
const WS = require('../wordsearch');
const SL = require('../slide');
const crypto = require('crypto');
const { hashPassword } = require('../util');

// Who is an admin? Either the ADMIN_USER environment variable (several names separated by
// commas) or the file content/admin.txt (one username per line). Names are not case sensitive.
const ADMIN_FILE = path.join(__dirname, '..', '..', 'content', 'admin.txt');
function adminNames() {
  const names = new Set();
  for (const n of String(process.env.ADMIN_USER || '').split(',')) if (n.trim()) names.add(n.trim().toLowerCase());
  try {
    for (const n of fs.readFileSync(ADMIN_FILE, 'utf8').split(/\r?\n/)) {
      const t = n.replace(/#.*$/, '').trim();
      if (t) names.add(t.toLowerCase());
    }
  } catch { /* no admin.txt */ }
  return names;
}
const isAdmin = (u) => !!u && adminNames().has(u.id);
function needAdmin(ctx) {
  if (!isAdmin(ctx.user)) throw new HttpError(404, 'Not found.');
}

const MAX_IMAGE = 1_500_000; // bytes, after the browser has shrunk the picture
const IMG_DIR = P.IMAGE_DIR;

const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);

function readFields(body) {
  const answer = String(body.answer || '').trim().toUpperCase();
  if (!/^[A-Z]{3,12}$/.test(answer)) throw new HttpError(400, 'The answer must be 3 to 12 letters A-Z, with no spaces, numbers or symbols.');
  const category = clean(body.category, 30);
  if (category !== 'Naija' && category !== 'Universal') throw new HttpError(400, 'Choose the category: Naija or Universal.');
  const clue = clean(body.clue, 200);
  if (!clue) throw new HttpError(400, 'Write a clue.');
  const fact = clean(body.fact, 400);
  if (!fact) throw new HttpError(400, 'Write a fun fact (shown after the player gets it right).');
  return { answer, category, clue, fact };
}

// The picture sent by the admin page is always a JPEG (the browser converts it).
// An advert may also be an animated GIF (up to 1.5 MB). Returns { buf, gif } or null.
function readAdImage(dataUrl) {
  if (dataUrl == null || dataUrl === '') return null;
  const m = /^data:image\/gif;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) return { buf: readImage(dataUrl, 600_000), gif: false };
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > 1_500_000) throw new HttpError(413, 'That GIF is too big. Keep it under 1.5 MB.');
  if (buf.length < 20 || !/^GIF8[79]a/.test(buf.toString('latin1', 0, 6))) throw new HttpError(400, 'That file is not a real GIF.');
  return { buf, gif: true };
}

function readImage(dataUrl, max = MAX_IMAGE) {
  if (dataUrl == null || dataUrl === '') return null;
  const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl));
  if (!m) throw new HttpError(400, 'The picture must be a JPEG. Choose the file again.');
  const buf = Buffer.from(m[1], 'base64');
  if (buf.length > max) throw new HttpError(413, 'That picture is too big. Use a smaller one.');
  if (buf.length < 200 || buf[0] !== 0xff || buf[1] !== 0xd8 || buf[2] !== 0xff) throw new HttpError(400, 'That file is not a real JPEG picture.');
  return buf;
}

// Existing file in content/images for this puzzle id (matching the name without caring about capitals).
function ownImage(id, ext) {
  let names = [];
  try { names = fs.readdirSync(IMG_DIR); } catch { return null; }
  const hit = names.find((n) => n.toLowerCase() === id + ext);
  return hit ? path.join(IMG_DIR, hit) : null;
}
function writePicture(id, buf) {
  fs.mkdirSync(IMG_DIR, { recursive: true });
  const target = ownImage(id, '.jpg') || path.join(IMG_DIR, id + '.jpg');
  fs.writeFileSync(target, buf);
}

const isRunning = (ch) => ch.status !== 'finished' && ch.status !== 'cancelled';
const challengesUsing = (id, onlyRunning) =>
  q.challengesMentioning(id).filter((ch) => (ch.puzzleIds || []).includes(id) && (!onlyRunning || isRunning(ch)));

// Same checks for every advert link: a normal web address only.
function readLink(raw) {
  const link = String(raw || '').trim();
  if (!link) return '';
  let ok = link.length <= 300;
  try { const u = new URL(link); ok = ok && (u.protocol === 'http:' || u.protocol === 'https:'); } catch { ok = false; }
  if (!ok) throw new HttpError(400, 'The link must start with http:// or https:// (for example https://yourshop.com).');
  return link;
}

function rowOf(raw, counts = q.solvedCounts()) {
  const id = raw.a.toLowerCase();
  const p = P.byId.get(id);
  const url = p ? P.imageUrl(p) : null;
  return {
    id, answer: raw.a, category: raw.c, clue: raw.clue, fact: raw.fact,
    image: url, hasPicture: !!url, emoji: !url && Array.isArray(raw.t) ? raw.t : null,
    solvedBy: counts.get(id) || 0,
  };
}


// What the admin can check against when someone says "this is my account". The recovery answer itself is never shown.
function accountFacts(u) {
  const paid = orders.recent(u.id, 20).filter((o) => o.status === 'paid').slice(0, 3);
  return {
    username: u.username, email: u.email || '', joined: u.createdAt, lastLogin: u.lastLoginAt || 0,
    coins: u.coins, points: u.points, levels: allLevelsOf(u), invited: (u.invited || []).length, premium: Premium.isPremium(u),
    purchases: paid.map((o) => ({ ref: o.ref, coins: o.coins, naira: Math.round(o.amount_kobo / 100), at: o.paid_at || o.created_at })),
    recoveryQuestion: Recovery.has(u) ? Recovery.textOf(u.recoveryQ) : '',
    deleteAt: AccountDel.pending(u) ? u.deleteAt : 0, isAdmin: isAdmin(u),
  };
}

module.exports = ({ route }) => {
  // Any logged-in player can ask "am I an admin?" (the app uses it to show the Admin link).
  route('GET', '/api/admin/status', (ctx) => ({ admin: isAdmin(ctx.user), resetRequests: isAdmin(ctx.user) ? resetReq.open() : 0 }), { auth: true });

  // ---------- advertisements (six picture slots: three on the left, three on the right) ----------
  // Public: the game asks for these when the page opens (even before login).
  route('GET', '/api/ads', () => ({ ads: Ads.list().map(({ advertiser, gif, ...rest }) => rest), mobile: Adsense.mobileAd(), results: Adsense.resultsAd() }));
  route('GET', '/api/admin/adsense', (ctx) => { needAdmin(ctx); return adsenseView(); }, { auth: true });

  // ---------- Google AdSense: paste ad code instead of uploading a picture ----------
  const adsenseView = () => {
    const s = Adsense.read();
    return { publisher: s.publisher, enabled: s.enabled, adsTxt: Adsense.adsTxt().trim(), mobile: Adsense.cleanAd(s.side.mobile), results: Adsense.cleanAd(s.side.results), side: Object.fromEntries(Object.entries(s.side).filter(([k]) => k !== 'mobile' && k !== 'results').map(([k, v]) => [k, Adsense.cleanAd(v)]).filter(([, v]) => v)) };
  };
  route('PUT', '/api/admin/adsense', (ctx) => {
    needAdmin(ctx);
    const raw = String(ctx.body.publisher || '').trim();
    const publisher = raw ? Adsense.normalizePublisher(raw) : '';
    if (raw && !publisher) throw new HttpError(400, 'The publisher ID looks like ca-pub-1234567890123456 (you find it in AdSense under Account > Account information).');
    const enabled = ctx.body.enabled === true;
    if (enabled && !publisher) throw new HttpError(400, 'Save your publisher ID before switching AdSense on.');
    const s = Adsense.read();
    if (s.publisher && publisher && s.publisher !== publisher) { for (const k of Object.keys(s.side)) delete s.side[k]; } // a new account: old ad codes no longer apply
    s.publisher = publisher; s.enabled = enabled;
    Adsense.write(s);
    console.log(`[admin] ${ctx.user.username} set AdSense: ${publisher || 'none'}, ${enabled ? 'on' : 'off'}`);
    return adsenseView();
  }, { auth: true });
  // The header ad shown at the top of the game on phones and tablets (the side panels only fit on laptops)
  route('PUT', '/api/admin/adsense/mobile', (ctx) => {
    needAdmin(ctx);
    const s = Adsense.read();
    if (!String(ctx.body.code || '').trim()) { delete s.side.mobile; Adsense.write(s); return adsenseView(); }
    const r = Adsense.parseCode(ctx.body.code, s.publisher);
    if (r.error) throw new HttpError(400, r.error);
    if (!s.publisher) s.publisher = r.ad.client;
    s.side.mobile = r.ad;
    Adsense.write(s);
    console.log(`[admin] ${ctx.user.username} set the AdSense phone header ad`);
    return adsenseView();
  }, { auth: true });
  // The banner at the bottom of the full-page race results (never in a pop-up)
  route('PUT', '/api/admin/adsense/results', (ctx) => {
    needAdmin(ctx);
    const s = Adsense.read();
    if (!String(ctx.body.code || '').trim()) { delete s.side.results; Adsense.write(s); return adsenseView(); }
    const r = Adsense.parseCode(ctx.body.code, s.publisher);
    if (r.error) throw new HttpError(400, r.error);
    if (!s.publisher) s.publisher = r.ad.client;
    s.side.results = r.ad;
    Adsense.write(s);
    console.log(`[admin] ${ctx.user.username} set the AdSense results-page ad`);
    return adsenseView();
  }, { auth: true });
  route('PUT', '/api/admin/adsense/slot/:slot', (ctx) => {
    needAdmin(ctx);
    const slot = Number(ctx.params.slot);
    if (!Ads.SLOTS.includes(slot)) throw new HttpError(404, 'There is no such advert slot.');
    const s = Adsense.read();
    if (!String(ctx.body.code || '').trim()) { delete s.side[slot]; Adsense.write(s); return adsenseView(); }
    const r = Adsense.parseCode(ctx.body.code, s.publisher);
    if (r.error) throw new HttpError(400, r.error);
    if (!s.publisher) s.publisher = r.ad.client; // the first pasted code teaches us the publisher ID
    s.side[slot] = r.ad;
    Adsense.write(s);
    console.log(`[admin] ${ctx.user.username} set AdSense code on advert ${slot}`);
    return adsenseView();
  }, { auth: true });

  const slotOf = (ctx) => {
    const slot = Number(ctx.params.slot);
    if (!Ads.SLOTS.includes(slot)) throw new HttpError(404, 'There is no such advert slot.');
    return slot;
  };

  route('GET', '/api/admin/ads', (ctx) => {
    needAdmin(ctx);
    return { ads: Ads.list(), slots: Ads.SLOTS };
  }, { auth: true });

  route('PUT', '/api/admin/ads/:slot', (ctx) => {
    needAdmin(ctx);
    const slot = slotOf(ctx);
    const img = readAdImage(ctx.body.image);
    if (!img && !Ads.list().some((a) => a.slot === slot)) throw new HttpError(400, 'Choose a picture for this advert.');
    let link = String(ctx.body.link || '').trim();
    if (link) {
      let ok = link.length <= 300;
      try { const u = new URL(link); ok = ok && (u.protocol === 'http:' || u.protocol === 'https:'); } catch { ok = false; }
      if (!ok) throw new HttpError(400, 'The link must start with http:// or https:// (for example https://yourshop.com).');
    }
    const meta = Ads.readMeta();
    meta[slot] = { link, alt: clean(ctx.body.alt, 60), advertiser: clean(ctx.body.advertiser, 40) };
    fs.mkdirSync(Ads.AD_DIR, { recursive: true });
    if (img) { Ads.clear(slot); fs.writeFileSync(Ads.pathFor(slot, img.gif ? 'gif' : 'jpg'), img.buf); }
    Ads.writeMeta(meta);
    console.log(`[admin] ${ctx.user.username} updated advert ${slot}`);
    return { ads: Ads.list() };
  }, { auth: true, maxBody: 2_200_000 });

  route('DELETE', '/api/admin/ads/:slot', (ctx) => {
    needAdmin(ctx);
    const slot = slotOf(ctx);
    Ads.clear(slot);
    const meta = Ads.readMeta(); delete meta[slot]; Ads.writeMeta(meta);
    console.log(`[admin] ${ctx.user.username} removed advert ${slot}`);
    return { ads: Ads.list() };
  }, { auth: true });

  // ---------- help a player who cannot log in ----------
  // Look a player up, and (if they cannot use the email reset) give them a temporary password to send them yourself.
  route('GET', '/api/admin/users/:username', (ctx) => {
    needAdmin(ctx);
    const u = db.users[String(ctx.params.username || '').toLowerCase()];
    if (!u) throw new HttpError(404, 'No player has that username.');
    return { user: accountFacts(u) };
  }, { auth: true });
  // Who tapped "Forgot password" (newest first, open ones first), so the admin can email them or give a temporary password.
  route('GET', '/api/admin/reset-requests', (ctx) => {
    needAdmin(ctx);
    return {
      open: resetReq.open(),
      items: resetReq.list().map((r) => {
        const u = db.users[r.user_id];
        return { id: r.id, username: u ? u.username : r.user_id, email: u ? (u.email || '') : '', at: r.at, outcome: r.outcome, done: !!r.done, facts: u && !r.done ? accountFacts(u) : null };
      }),
    };
  }, { auth: true });
  route('POST', '/api/admin/reset-requests/:id/done', (ctx) => {
    needAdmin(ctx);
    if (!resetReq.done(Number.parseInt(ctx.params.id, 10))) throw new HttpError(404, 'That request is already gone.');
    return { ok: true };
  }, { auth: true });
  // Delete a player's account now (after checking it is really them). If they are still inside a race that has not ended,
  // it is done automatically as soon as the race ends (within 3 days).
  route('POST', '/api/admin/users/:username/delete', (ctx) => {
    needAdmin(ctx);
    const u = db.users[String(ctx.params.username || '').toLowerCase()];
    if (!u) throw new HttpError(404, 'No player has that username.');
    if (isAdmin(u)) throw new HttpError(400, 'An admin account cannot be deleted here.');
    const r = AccountDel.removeNow(u);
    if (r.done) { console.log(`[admin] ${ctx.user.username} deleted the account of ${ctx.params.username}`); return { deleted: true }; }
    u.deleteAt = Date.now() - 1;               // the hourly check removes it as soon as their race has ended
    save();
    return { deleted: false, waiting: true };
  }, { auth: true, strict: true });

  // The player says their recovery answer; the admin types it here and sees only "matches" or not.
  route('POST', '/api/admin/users/:username/check-recovery', async (ctx) => {
    needAdmin(ctx);
    const u = db.users[String(ctx.params.username || '').toLowerCase()];
    if (!u) throw new HttpError(404, 'No player has that username.');
    if (!Recovery.has(u)) throw new HttpError(400, 'This player did not set a recovery question.');
    return { match: await Recovery.check(u, ctx.body.answer) };
  }, { auth: true, strict: true });
  route('POST', '/api/admin/users/:username/reset-password', async (ctx) => {
    needAdmin(ctx);
    const u = db.users[String(ctx.params.username || '').toLowerCase()];
    if (!u) throw new HttpError(404, 'No player has that username.');
    // Easy to read out and type: lowercase letters and digits with no look-alikes (no 0/o, 1/l/i).
    const ALPHA = 'abcdefghjkmnpqrstuvwxyz23456789';
    const temp = Array.from(crypto.randomBytes(10), (b) => ALPHA[b % ALPHA.length]).join('');
    u.passHash = await hashPassword(temp);
    u.pwv = (u.pwv || 0) + 1;
    u.mustChange = true;                          // they are asked to choose their own password after logging in
    resetReq.doneUser(u.id);                      // their "forgot password" request is dealt with
    save();
    console.log(`[admin] ${ctx.user.username} reset the password of ${u.username}`);
    return { username: u.username, temporaryPassword: temp };
  }, { auth: true, strict: true });

  // ---------- login screen background pictures (blurred, sliding; up to 8) ----------
  route('GET', '/api/loginbg', () => ({ pictures: Bg.list() }));

  const bgSlot = (ctx) => {
    const slot = Number(ctx.params.slot);
    if (!Bg.SLOTS.includes(slot)) throw new HttpError(404, 'There is no such background slot.');
    return slot;
  };
  route('GET', '/api/admin/loginbg', (ctx) => { needAdmin(ctx); return { pictures: Bg.list(), slots: Bg.SLOTS }; }, { auth: true });
  route('PUT', '/api/admin/loginbg/:slot', (ctx) => {
    needAdmin(ctx);
    const slot = bgSlot(ctx);
    const img = readImage(ctx.body.image, 700_000);
    if (!img) throw new HttpError(400, 'Choose a picture.');
    fs.mkdirSync(Bg.DIR, { recursive: true });
    fs.writeFileSync(Bg.fileOf(slot), img);
    console.log(`[admin] ${ctx.user.username} set login background ${slot}`);
    return { pictures: Bg.list() };
  }, { auth: true, maxBody: 1_000_000 });
  route('DELETE', '/api/admin/loginbg/:slot', (ctx) => {
    needAdmin(ctx);
    const slot = bgSlot(ctx);
    try { fs.unlinkSync(Bg.fileOf(slot)); } catch { /* already gone */ }
    return { pictures: Bg.list() };
  }, { auth: true });

  // ---------- game card photos on the home screen (Naija, Universal, Word Search) ----------
  route('GET', '/api/worldbg', () => ({ pictures: WorldBg.list() }));
  const wbgKey = (ctx) => {
    if (!WorldBg.KEYS.includes(ctx.params.key)) throw new HttpError(404, 'There is no such game.');
    return ctx.params.key;
  };
  route('GET', '/api/admin/worldbg', (ctx) => { needAdmin(ctx); return { pictures: WorldBg.list(), keys: WorldBg.KEYS }; }, { auth: true });
  route('PUT', '/api/admin/worldbg/:key', (ctx) => {
    needAdmin(ctx);
    const key = wbgKey(ctx);
    const img = readImage(ctx.body.image, 700_000);
    if (!img) throw new HttpError(400, 'Choose a picture.');
    fs.mkdirSync(WorldBg.DIR, { recursive: true });
    fs.writeFileSync(WorldBg.fileOf(key), img);
    console.log(`[admin] ${ctx.user.username} set the ${key} card photo`);
    return { pictures: WorldBg.list() };
  }, { auth: true, maxBody: 1_000_000 });
  route('DELETE', '/api/admin/worldbg/:key', (ctx) => {
    needAdmin(ctx);
    const key = wbgKey(ctx);
    try { fs.unlinkSync(WorldBg.fileOf(key)); } catch { /* already gone */ }
    return { pictures: WorldBg.list() };
  }, { auth: true });

  // ---------- pop-up adverts (picture, GIF or short video after every Nth level) ----------
  // Public: the game asks for these. Nothing is sent when pop-ups are off or no advert is active.
  // Premium members never see pop-up adverts.
  route('GET', '/api/popups', (ctx) => (ctx.user && Premium.isPremium(ctx.user) ? { enabled: false, every: 0, closeAfter: 0, items: [], premium: true } : { ...Pop.publicView(), premiumOpen: Premium.isOpen() }));

  const popView = () => {
    const { settings, items } = Pop.read();
    return { settings, max: Pop.MAX_ITEMS, adsenseOn: Adsense.live(), items: items.map((i) => ({ ...i, url: Pop.urlOf(i), missing: i.kind === 'adsense' ? false : !fs.existsSync(Pop.fileOf(i)) })) };
  };

  route('GET', '/api/admin/popups', (ctx) => { needAdmin(ctx); return popView(); }, { auth: true });

  route('PUT', '/api/admin/popups/settings', (ctx) => {
    needAdmin(ctx);
    const every = Number(ctx.body.every);
    const closeAfter = Number(ctx.body.closeAfter);
    if (!Number.isInteger(every) || every < 1 || every > 100) throw new HttpError(400, 'Show a pop-up every 1 to 100 levels.');
    if (!Number.isInteger(closeAfter) || closeAfter < 0 || closeAfter > 15) throw new HttpError(400, 'The Close button can wait 0 to 15 seconds.');
    const m = Pop.read();
    m.settings = { enabled: !!ctx.body.enabled, every, closeAfter };
    Pop.write(m);
    console.log(`[admin] ${ctx.user.username} changed pop-up settings`);
    return popView();
  }, { auth: true });

  route('POST', '/api/admin/popups', (ctx) => {
    needAdmin(ctx);
    const m = Pop.read();
    if (m.items.length >= Pop.MAX_ITEMS) throw new HttpError(400, `You can keep up to ${Pop.MAX_ITEMS} pop-up adverts. Delete one first.`);
    const raw = String(ctx.body.file || '');
    const comma = raw.indexOf(',');
    const head = raw.slice(0, comma);
    const mime = /^data:([a-z0-9.+/-]+);base64$/.exec(head);
    const type = mime && Pop.TYPES[mime[1]];
    if (!type) throw new HttpError(400, 'Use a JPG, PNG, GIF, MP4 or WEBM file.');
    const buf = Buffer.from(raw.slice(comma + 1), 'base64');
    if (buf.length < 200) throw new HttpError(400, 'That file looks empty.');
    if (buf.length > type.max) throw new HttpError(413, `That file is too big. Limit: ${Math.round(type.max / 100000) / 10} MB for ${type.kind === 'video' ? 'videos' : type.kind === 'gif' ? 'GIFs' : 'pictures'}.`);
    if (!type.magic(buf)) throw new HttpError(400, 'That file is not a real ' + mime[1].split('/')[1].toUpperCase() + ' file.');
    const item = {
      id: Pop.newId(), kind: type.kind, ext: type.ext, bytes: buf.length,
      title: clean(ctx.body.title, 60), link: readLink(ctx.body.link), advertiser: clean(ctx.body.advertiser, 40), active: ctx.body.active !== false, createdAt: Date.now(),
    };
    fs.mkdirSync(Pop.DIR, { recursive: true });
    fs.writeFileSync(Pop.fileOf(item), buf);
    m.items.push(item);
    Pop.write(m);
    console.log(`[admin] ${ctx.user.username} added a pop-up advert (${type.kind})`);
    return popView();
  }, { auth: true, maxBody: 6_000_000 });

  // Google's rules do not allow its ads in pop-ups, so this is refused (pop-ups carry your own adverts only).
  route('POST', '/api/admin/popups/adsense', (ctx) => {
    needAdmin(ctx);
    throw new HttpError(400, 'Google does not allow AdSense ads inside pop-ups, so this is switched off to protect your account. Put AdSense code in the side advert boxes instead, and use pop-ups for your own adverts.');
  }, { auth: true });

  route('PUT', '/api/admin/popups/:id', (ctx) => {
    needAdmin(ctx);
    const m = Pop.read();
    const item = m.items.find((i) => i.id === ctx.params.id);
    if (!item) throw new HttpError(404, 'That advert no longer exists. Reload the page.');
    item.title = clean(ctx.body.title, 60);
    if (item.kind !== 'adsense') { item.link = readLink(ctx.body.link); item.advertiser = clean(ctx.body.advertiser, 40); }
    item.active = !!ctx.body.active;
    Pop.write(m);
    return popView();
  }, { auth: true });

  route('DELETE', '/api/admin/popups/:id', (ctx) => {
    needAdmin(ctx);
    const m = Pop.read();
    const at = m.items.findIndex((i) => i.id === ctx.params.id);
    if (at < 0) throw new HttpError(404, 'That advert no longer exists. Reload the page.');
    const [gone] = m.items.splice(at, 1);
    try { fs.unlinkSync(Pop.fileOf(gone)); } catch { /* already gone */ }
    Pop.write(m);
    console.log(`[admin] ${ctx.user.username} removed a pop-up advert`);
    return popView();
  }, { auth: true });

  route('GET', '/api/admin/puzzles', (ctx) => {
    needAdmin(ctx);
    return { puzzles: (() => { const counts = q.solvedCounts(); return P.rawPuzzles().map((r) => rowOf(r, counts)); })(), categories: P.categories().map((c) => c.name) };
  }, { auth: true });

  route('POST', '/api/admin/puzzles', (ctx) => {
    needAdmin(ctx);
    const f = readFields(ctx.body);
    const id = f.answer.toLowerCase();
    if (P.byId.has(id)) throw new HttpError(409, `${f.answer} already exists. Edit it from the list instead.`);
    const img = readImage(ctx.body.image);
    if (!img && !P.imageFile({ id, img: null })) throw new HttpError(400, 'Add the collage picture for this puzzle.');
    if (img) writePicture(id, img);
    const list = P.rawPuzzles();
    list.push({ a: f.answer, c: f.category, clue: f.clue, fact: f.fact });
    P.savePuzzles(list);
    console.log(`[admin] ${ctx.user.username} added ${f.answer}`);
    return { puzzle: rowOf(list[list.length - 1]), total: P.puzzles.length };
  }, { auth: true, maxBody: 2_200_000 });

  // :id is the CURRENT answer in small letters. The body may carry a new answer.
  route('PUT', '/api/admin/puzzles/:id', (ctx) => {
    needAdmin(ctx);
    const oldId = String(ctx.params.id).toLowerCase();
    const list = P.rawPuzzles();
    const at = list.findIndex((x) => x.a.toLowerCase() === oldId);
    if (at < 0) throw new HttpError(404, 'That puzzle no longer exists. Reload the page.');
    const f = readFields(ctx.body);
    const newId = f.answer.toLowerCase();
    const renamed = newId !== oldId;
    if (renamed && P.byId.has(newId)) throw new HttpError(409, `${f.answer} already exists as another puzzle.`);
    const img = readImage(ctx.body.image);

    const entry = { ...list[at], a: f.answer, c: f.category, clue: f.clue, fact: f.fact };
    if (renamed) {
      // The picture file is named after the answer, so it moves with it.
      const hadFile = !entry.img && P.imageFile({ id: oldId, img: null });
      const oldFile = hadFile && path.dirname(hadFile) === IMG_DIR ? hadFile : null;
      if (hadFile && !oldFile) {
        // Old picture sits in the legacy public/images folder: copy it, never touch that folder.
        if (!ownImage(newId, path.extname(hadFile).toLowerCase())) { fs.mkdirSync(IMG_DIR, { recursive: true }); fs.copyFileSync(hadFile, path.join(IMG_DIR, newId + path.extname(hadFile).toLowerCase())); }
      } else if (oldFile) {
        const ext = path.extname(oldFile).toLowerCase();
        if (!ownImage(newId, ext)) fs.renameSync(oldFile, path.join(IMG_DIR, newId + ext));
      }
      // Players keep their credit: move every record of the old answer to the new one.
      for (const u of q.usersMentioning(oldId)) {
        if (u.solved && u.solved[oldId] != null) { u.solved[newId] = u.solved[oldId]; delete u.solved[oldId]; }
        if (u.progress && u.progress[oldId]) { u.progress[newId] = u.progress[oldId]; delete u.progress[oldId]; }
        for (const k of Object.keys(u.current || {})) if (u.current[k] === oldId) u.current[k] = newId;
      }
      if (SL.list.some((x) => x.from === oldId)) SL.save(SL.list.map((x) => ({ ...x, ...(x.from === oldId ? { from: newId } : {}) })));
      for (const ch of q.challengesMentioning(oldId)) {
        if (ch.puzzleIds) ch.puzzleIds = ch.puzzleIds.map((x) => (x === oldId ? newId : x));
      }
      save();
    }
    if (img) { writePicture(newId, img); delete entry.img; }
    list[at] = entry;
    P.savePuzzles(list);
    if (!P.imageFile(P.byId.get(newId))) console.log(`[admin] note: ${f.answer} has no picture yet`);
    console.log(`[admin] ${ctx.user.username} edited ${oldId}${renamed ? ' -> ' + newId : ''}`);
    return { puzzle: rowOf(entry), total: P.puzzles.length };
  }, { auth: true, maxBody: 2_200_000 });

  route('DELETE', '/api/admin/puzzles/:id', (ctx) => {
    needAdmin(ctx);
    const id = String(ctx.params.id).toLowerCase();
    const list = P.rawPuzzles();
    const at = list.findIndex((x) => x.a.toLowerCase() === id);
    if (at < 0) throw new HttpError(404, 'That puzzle no longer exists. Reload the page.');
    if (list.length <= 20) throw new HttpError(400, 'Keep at least 20 puzzles. Races need at least 20 puzzles.');
    const running = challengesUsing(id, true).length;
    if (running) throw new HttpError(409, `${running} challenge(s) still being played use this puzzle. Delete it after they finish.`);
    // Optionally remove the picture file too (for example when the picture's owner asks for it to be taken down).
    const wipe = [];
    if (ctx.body && ctx.body.deleteFile === true) {
      const [target] = list.slice(at, at + 1);
      const shared = target.img && list.some((x, i) => i !== at && x.img === target.img);
      if (!shared) {
        const named = target.img ? path.join(IMG_DIR, path.basename(String(target.img))) : null;
        if (named && fs.existsSync(named)) wipe.push(named);
        for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) { const f = ownImage(id, ext); if (f && !wipe.includes(f)) wipe.push(f); }
      }
    }
    const [gone] = list.splice(at, 1);
    P.savePuzzles(list);
    for (const f of wipe) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
    // Remove the old records so the players' levels stay correct (solved count = puzzles that still exist).
    for (const u of q.usersMentioning(id)) {
      if (u.solved) delete u.solved[id];
      if (u.progress) delete u.progress[id];
      for (const k of Object.keys(u.current || {})) if (u.current[k] === id) delete u.current[k];
    }
    save();
    console.log(`[admin] ${ctx.user.username} deleted ${gone.a} (${wipe.length ? 'picture file deleted' : 'picture file left in content/images'})`);
    return { ok: true, total: P.puzzles.length, fileDeleted: wipe.length > 0 };
  }, { auth: true });

  // Open or lock Premium for everybody (locked by default). Locked: no buying, fun facts free for all.
  route('GET', '/api/admin/premium', (ctx) => {
    needAdmin(ctx);
    const now = Date.now();
    return { open: Premium.isOpen(), members: Object.values(db.users).filter((u) => Number(u.premiumUntil) > now).length };
  }, { auth: true });
  route('PUT', '/api/admin/premium/settings', (ctx) => {
    needAdmin(ctx);
    Premium.setOpen(ctx.body.open === true);
    console.log(`[admin] ${ctx.user.username} ${Premium.isOpen() ? 'opened' : 'locked'} Premium`);
    return { open: Premium.isOpen() };
  }, { auth: true });

  // Give or take away premium by hand (for example to thank someone, or to fix a payment problem). days 0 removes it.
  route('POST', '/api/admin/premium', (ctx) => {
    needAdmin(ctx);
    const u = db.users[String(ctx.body.username || '').trim().toLowerCase()];
    if (!u) throw new HttpError(404, 'No player has that username.');
    const days = Number(ctx.body.days);
    if (!Number.isInteger(days) || days < 0 || days > 3650) throw new HttpError(400, 'Days must be a whole number from 0 to 3650. Use 0 to remove premium.');
    if (days === 0) Premium.remove(u); else Premium.grant(u, days);
    save();
    console.log(`[admin] ${ctx.user.username} set premium for ${u.username}: ${days} days`);
    return { username: u.username, ...Premium.info(u) };
  }, { auth: true });

  // ---- Watermark text burned into new pictures (the admin's browser draws it when a picture is uploaded) ----
  const Watermark = require('../watermark');
  route('GET', '/api/admin/watermark', (ctx) => { needAdmin(ctx); return Watermark.get(); }, { auth: true });
  route('PUT', '/api/admin/watermark', (ctx) => {
    needAdmin(ctx);
    const r = Watermark.setText(ctx.body.text);
    console.log(`[admin] ${ctx.user.username} set the watermark to "${r.text}"`);
    return r;
  }, { auth: true });
  route('POST', '/api/admin/watermark/stamped', (ctx) => { needAdmin(ctx); return Watermark.markStamped(); }, { auth: true });

  // ---- Sliding puzzle levels: a picture, a title and a grid size (3x3, 4x4 or 5x5) ----
  const slRow = (p, i) => ({ id: p.id, level: i + 1, title: p.title || '', size: p.size, fact: p.fact || '', image: SL.urlOf(p.id), missing: !SL.hasPicture(p.id), from: p.from || null });
  const slFields = (body) => {
    const title = SL.cleanText(body.title, 40);
    if (!title) throw new HttpError(400, 'Write a title for the picture, for example "Zuma Rock".');
    const size = Number(body.size);
    if (!SL.SIZES.includes(size)) throw new HttpError(400, 'Pick a grid of 3x3, 4x4 or 5x5.');
    return { title, size, fact: SL.cleanText(body.fact, 300) };
  };
  const slOut = () => ({ levels: SL.list.map(slRow), sizes: SL.SIZES });
  route('GET', '/api/admin/slide', (ctx) => { needAdmin(ctx); return slOut(); }, { auth: true });
  route('POST', '/api/admin/slide', (ctx) => {
    needAdmin(ctx);
    // Use the picture of a Naija puzzle: nothing new is stored. The title and fun fact default to that puzzle's answer and fact.
    if (ctx.body.from) {
      const from = String(ctx.body.from).toLowerCase();
      const pz = P.byId.get(from);
      if (!pz || !P.imageFile(pz)) throw new HttpError(400, 'That Naija puzzle has no picture.');
      if (SL.list.some((x) => x.from === from)) throw new HttpError(409, 'That picture is already a sliding puzzle.');
      const nice = pz.answer ? pz.answer.charAt(0) + pz.answer.slice(1).toLowerCase() : from;
      const f2 = slFields({ ...ctx.body, title: SL.cleanText(ctx.body.title, 40) || nice, fact: ctx.body.fact || pz.fact || '' });
      const entry2 = { id: SL.newId(), title: f2.title, size: f2.size, from, ...(f2.fact ? { fact: f2.fact } : {}) };
      SL.save(SL.list.map((x) => ({ ...x })).concat(entry2));
      console.log(`[admin] ${ctx.user.username} added sliding puzzle "${f2.title}" from the Naija picture ${from}`);
      return slOut();
    }
    const f = slFields(ctx.body);
    const img = readImage(ctx.body.image, 1_500_000);
    if (!img) throw new HttpError(400, 'Choose a picture.');
    const entry = { id: SL.newId(), title: f.title, size: f.size, ...(f.fact ? { fact: f.fact } : {}) };
    fs.mkdirSync(SL.DIR, { recursive: true });
    fs.writeFileSync(SL.fileOf(entry.id), img);
    SL.save(SL.list.map((x) => ({ ...x })).concat(entry));
    console.log(`[admin] ${ctx.user.username} added sliding puzzle "${f.title}" (${f.size}x${f.size})`);
    return slOut();
  }, { auth: true, maxBody: 2_200_000 });
  route('PUT', '/api/admin/slide/:id', (ctx) => {
    needAdmin(ctx);
    const f = slFields(ctx.body);
    const list = SL.list.map((x) => ({ ...x }));
    const at = list.findIndex((x) => x.id === ctx.params.id);
    if (at < 0) throw new HttpError(404, 'That sliding puzzle no longer exists. Reload the page.');
    if (ctx.body.image) {
      if (list[at].from) throw new HttpError(400, 'This level uses a Naija picture. To change the picture, delete the level and add another.');
      const img = readImage(ctx.body.image, 1_500_000);
      fs.mkdirSync(SL.DIR, { recursive: true });
      fs.writeFileSync(SL.fileOf(list[at].id), img);
    }
    list[at] = { id: list[at].id, title: f.title, size: f.size, ...(list[at].from ? { from: list[at].from } : {}), ...(f.fact ? { fact: f.fact } : {}) };
    SL.save(list);
    return slOut();
  }, { auth: true, maxBody: 2_200_000 });
  route('DELETE', '/api/admin/slide/:id', (ctx) => {
    needAdmin(ctx);
    const list = SL.list.map((x) => ({ ...x }));
    const at = list.findIndex((x) => x.id === ctx.params.id);
    if (at < 0) throw new HttpError(404, 'That sliding puzzle no longer exists. Reload the page.');
    const [gone] = list.splice(at, 1);
    SL.save(list);
    try { fs.unlinkSync(SL.fileOf(gone.id)); } catch { /* already gone */ }
    console.log(`[admin] ${ctx.user.username} deleted a sliding puzzle`);
    return slOut();
  }, { auth: true });

  // ---- Word Search levels: a theme plus the words to find (the server makes the letter grid) ----
  const wsRow = (p, i) => ({ id: p.id, level: i + 1, theme: p.theme || '', words: p.words, fact: p.fact || '' });
  const wsFields = (body) => {
    let words;
    try { words = WS.cleanWords(body.words); } catch (e) { throw new HttpError(400, e.message); }
    const theme = WS.cleanText(body.theme, 40);
    if (!theme) throw new HttpError(400, 'Write a theme, for example "Naija food".');
    return { theme, words, fact: WS.cleanText(body.fact, 300) };
  };
  route('GET', '/api/admin/wordsearch', (ctx) => { needAdmin(ctx); return { levels: WS.list.map(wsRow), limits: { min: WS.MIN_WORDS, max: WS.MAX_WORDS, minLen: WS.MIN_LEN, maxLen: WS.MAX_LEN } }; }, { auth: true });
  route('POST', '/api/admin/wordsearch', (ctx) => {
    needAdmin(ctx);
    const f = wsFields(ctx.body);
    const list = WS.list.map((x) => ({ ...x }));
    const entry = { id: 'w' + crypto.randomBytes(4).toString('hex'), theme: f.theme, words: f.words, ...(f.fact ? { fact: f.fact } : {}) };
    list.push(entry);
    WS.save(list);
    try { WS.grids(WS.byId(entry.id)); } catch { WS.save(list.slice(0, -1)); throw new HttpError(400, 'Those words do not fit together in a grid. Use fewer or shorter words.'); }
    console.log(`[admin] ${ctx.user.username} added word search "${f.theme}"`);
    return { levels: WS.list.map(wsRow) };
  }, { auth: true });
  route('PUT', '/api/admin/wordsearch/:id', (ctx) => {
    needAdmin(ctx);
    const f = wsFields(ctx.body);
    const list = WS.list.map((x) => ({ ...x }));
    const at = list.findIndex((x) => x.id === ctx.params.id);
    if (at < 0) throw new HttpError(404, 'That word search no longer exists. Reload the page.');
    const before = list[at];
    list[at] = { id: before.id, theme: f.theme, words: f.words, ...(f.fact ? { fact: f.fact } : {}) };
    WS.save(list);
    try { WS.grids(WS.byId(before.id)); } catch { list[at] = before; WS.save(list); throw new HttpError(400, 'Those words do not fit together in a grid. Use fewer or shorter words.'); }
    return { levels: WS.list.map(wsRow) };
  }, { auth: true });
  route('DELETE', '/api/admin/wordsearch/:id', (ctx) => {
    needAdmin(ctx);
    const list = WS.list.map((x) => ({ ...x }));
    const at = list.findIndex((x) => x.id === ctx.params.id);
    if (at < 0) throw new HttpError(404, 'That word search no longer exists. Reload the page.');
    if (list.length <= 1) throw new HttpError(400, 'Keep at least one word search.');
    list.splice(at, 1);
    WS.save(list);
    console.log(`[admin] ${ctx.user.username} deleted a word search`);
    return { levels: WS.list.map(wsRow) };
  }, { auth: true });
};

module.exports.isAdmin = isAdmin;
