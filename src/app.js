'use strict';
// Minimal HTTP framework: routing, JSON bodies, cookie auth, rate limits,
// static files and security headers, using only Node built-ins.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { db, getSecret, AVATAR_DIR } = require('./db');
const { signToken, verifyToken, parseCookies, createLimiter, HttpError } = require('./util');
const P = require('./puzzles');
const Ads = require('./ads');
const Compress = require('./compress');
const Adsense = require('./adsense');
const Turnstile = require('./turnstile');
const Bg = require('./loginbg');
const WorldBg = require('./worldbg');
const Slide = require('./slide');
const Pages = require('./pages');
const Pop = require('./popups');
const Presence = require('./presence');
const Stats = require('./stats');

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const SECRET = getSecret();
const COOKIE = 'ns_token';
const SESSION_DAYS = 30;
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
const DEFAULT_BODY_LIMIT = 10_000;

const routes = [];
// opts: auth (login required), strict (tight rate limit), maxBody (bytes, for uploads)
function route(method, pattern, handler, opts = {}) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler, auth: !!opts.auth, strict: !!opts.strict, maxBody: opts.maxBody || DEFAULT_BODY_LIMIT });
}

const apiLimit = createLimiter({ windowMs: 60_000, max: 300 });
const authLimit = createLimiter({ windowMs: 10 * 60_000, max: Number(process.env.AUTH_LIMIT) || 25 });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
};

const CSP_BASE =
    "default-src 'self'; img-src 'self' data: https:; style-src 'self'; script-src 'self'; " +
    "font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
// A getter, so the browser permissions for Google AdSense appear only while the owner has AdSense switched on (spreading reads it fresh each time).
const SECURITY_HEADERS = {
  get 'Content-Security-Policy'() { return Turnstile.csp(Adsense.csp(CSP_BASE)); },
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
};

let warnedProxy = false;
function clientIp(req) {
  if (!TRUST_PROXY && !warnedProxy && req.headers['x-forwarded-for']) {
    warnedProxy = true;
    console.warn('[security] Requests arrive through a proxy but TRUST_PROXY is not set, so every player looks like one visitor and the login limit is shared by everybody. Set TRUST_PROXY=1 on Railway.');
  }
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

function sendJson(res, status, data, extraHeaders = {}) {
  const raw = Buffer.from(JSON.stringify(data));
  const { body, encoding } = Compress.dynamic(res.req, 'application/json', raw);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Vary': 'Accept-Encoding',
    ...(encoding ? { 'Content-Encoding': encoding } : {}),
    'Content-Length': body.length,
    ...SECURITY_HEADERS,
    ...extraHeaders,
  });
  res.end(res.req && res.req.method === 'HEAD' ? undefined : body);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    let failed = false;
    const chunks = [];
    req.on('data', (c) => {
      if (failed) return;
      size += c.length;
      if (size > limit) { failed = true; reject(new HttpError(413, 'That upload is too large.')); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (failed) return;
      if (!chunks.length) return resolve({});
      const text = Buffer.concat(chunks).toString('utf8');
      req.rawBody = text; // exactly what was sent (the payment webhook signature is checked against it)
      try { resolve(JSON.parse(text)); }
      catch { reject(new HttpError(400, 'That request was not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  const payload = verifyToken(token, SECRET);
  const user = payload ? db.users[payload.u] || null : null;
  // A password change or reset logs out every older session (they carry the old password version).
  return user && (payload.v | 0) === (user.pwv | 0) ? user : null;
}

function sessionCookie(userId, pwv = 0) {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const token = signToken({ u: userId, exp, v: pwv | 0 }, SECRET);
  return `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}${SECURE_COOKIE ? '; Secure' : ''}`;
}
const clearCookie = () => `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${SECURE_COOKIE ? '; Secure' : ''}`;

async function handleApi(req, res, url) {
  const ip = clientIp(req);
  if (!apiLimit(ip)) throw new HttpError(429, 'Too many requests. Wait a minute and try again.');

  const match = routes.find((r) => r.method === req.method && r.re.test(url.pathname));
  if (!match) throw new HttpError(404, 'Not found.');
  if (match.strict && !authLimit(ip)) {
    throw new HttpError(429, 'Too many attempts. Wait a few minutes and try again.');
  }

  let body = {};
  if (req.method !== 'GET') {
    // Requiring JSON blocks cross-site form posts (a simple CSRF defence).
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      throw new HttpError(415, 'Send JSON.');
    }
    body = await readBody(req, match.maxBody);
  }

  const m = url.pathname.match(match.re);
  const params = {};
  match.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });

  const user = currentUser(req);
  if (match.auth && !user) throw new HttpError(401, 'Log in to continue.');
  if (user) { Presence.touch(user.id); Stats.active(user.id); } // counts as online, and as active today

  const ctx = { req, res, ip, rawBody: req.rawBody, params, query: Object.fromEntries(url.searchParams), body, user, headers: {} };
  const result = await match.handler(ctx);
  sendJson(res, 200, result === undefined ? { ok: true } : result, ctx.headers);
}

// Profile photos. Only logged-in players can load them, and the file name is
// restricted to a username, so nobody can reach other files through this route.
function serveAvatar(req, res, id) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  if (!currentUser(req)) return sendJson(res, 401, { error: 'Log in to continue.' });
  const file = path.join(AVATAR_DIR, `${id}.jpg`);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': st.size,
      'Cache-Control': 'private, max-age=86400', // the ?v= number in the link changes when the photo does
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// Puzzle pictures. The browser asks for /pic/<random id>; the file name (which is the
// answer) never leaves the server. Only logged-in players can load them.
function servePicture(req, res, pid) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  if (!currentUser(req)) return sendJson(res, 401, { error: 'Log in to continue.' });
  const puzzle = P.fromPublic(pid);
  const file = puzzle && P.imageFile(puzzle);
  if (!file) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': 'private, max-age=86400', // the ?v= number in the link changes when the picture does
      'Content-Disposition': 'inline',           // no file name is sent, so "Save image" gets a neutral name
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// Advert pictures are public (shown before login too). Only the six fixed slots can be asked for.
function serveAd(req, res, slot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  const file = Ads.fileOf(slot);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, {
      'Content-Type': file.endsWith('.gif') ? 'image/gif' : 'image/jpeg', 'Content-Length': st.size,
      'Cache-Control': 'public, max-age=86400', // the ?v= number in the link changes when the admin replaces the picture
      ...SECURITY_HEADERS,
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// Login background pictures are public (the login page is shown before login). Only slots 1 to 8.
function serveBg(req, res, slot) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  fs.stat(Bg.fileOf(slot), (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400', ...SECURITY_HEADERS });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(Bg.fileOf(slot)).pipe(res);
  });
}

// Game card photos for the home screen. Public, three fixed names.
function serveWorldBg(req, res, key) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  fs.stat(WorldBg.fileOf(key), (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': 'public, max-age=86400', ...SECURITY_HEADERS });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(WorldBg.fileOf(key)).pipe(res);
  });
}

// Sliding puzzle pictures (public: the game draws the tiles from them).
function serveSlide(req, res, id) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  const entry = Slide.byId(id);
  if (entry && entry.from && !currentUser(req)) return sendJson(res, 401, { error: 'Log in to continue.' });   // Naija pictures are for logged-in players only
  const file = Slide.pictureFile(id);
  if (!file) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'image/jpeg', 'Content-Length': st.size, 'Cache-Control': entry && entry.from ? 'private, max-age=86400' : 'public, max-age=86400', ...SECURITY_HEADERS });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

// The private report page for advertisers and investors. The secret is in the link; the page asks the server for the numbers.
function serveReport(req, res, page = 'report.html') {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  fs.readFile(path.join(PUBLIC_DIR, page), (err, buf) => {
    if (err) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow', ...SECURITY_HEADERS, 'Referrer-Policy': 'no-referrer' });
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

// Pop-up advert files (picture, GIF or video). Public. Videos need Range support so phones can play them.
function servePopup(req, res, id) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405, SECURITY_HEADERS); return res.end(); }
  const item = Pop.find(id);
  const file = item && Pop.fileOf(item);
  if (!file) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    const type = Pop.MIME_BY_EXT[item.ext];
    const headers = {
      'Content-Type': type, 'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable', // every upload gets a new id, so a cached copy is never stale
      ...SECURITY_HEADERS,
    };
    let start = 0; let end = st.size - 1; let status = 200;
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range || ''));
    if (range && (range[1] || range[2])) {
      if (range[1]) { start = Number(range[1]); if (range[2]) end = Math.min(Number(range[2]), end); }
      else { start = Math.max(0, st.size - Number(range[2])); } // "last N bytes"
      if (start > end || start >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, ...SECURITY_HEADERS }); return res.end(); }
      status = 206;
      headers['Content-Range'] = `bytes ${start}-${end}/${st.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(status, headers);
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, SECURITY_HEADERS); return res.end();
  }
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  // Older setups kept puzzle pictures in public/images. Never serve that folder: its file names are the answers.
  if (/^\/images(\/|$)/i.test(rel)) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep) || path.basename(file).startsWith('.')) {
    res.writeHead(403, SECURITY_HEADERS); return res.end('Forbidden');
  }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
    const ext = path.extname(file).toLowerCase();
    if (file === path.join(PUBLIC_DIR, 'index.html') && Adsense.publisher()) {
      // the home page carries the AdSense verification tag (and the AdSense script when it is switched on)
      return fs.readFile(file, 'utf8', (e2, html) => {
        if (e2) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
        const { body, encoding } = Compress.dynamic(req, MIME['.html'], Buffer.from(Adsense.injectHead(html)));
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding', ...(encoding ? { 'Content-Encoding': encoding } : {}), 'Content-Length': body.length, ...SECURITY_HEADERS });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    }
    // The game's own files (pages, scripts, styles, service worker, manifest) are always re-checked with the
    // server, so an update reaches every player at once. The check is cheap: if nothing changed the server
    // answers "304 not modified" and the browser keeps its copy. Pictures and icons may be kept for an hour.
    const appFile = ['.html', '.js', '.css', '.webmanifest'].includes(ext);
    const type = MIME[ext] || 'application/octet-stream';
    const enc = Compress.textType(type) && st.size >= Compress.MIN_SIZE ? Compress.accepted(req) : null;   // smaller text for slow connections
    const stamp = `${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}`;
    const etag = `"${stamp}${enc ? '-' + enc : ''}"`;
    if (appFile && req.headers['if-none-match'] === etag) {
      res.writeHead(304, { ETag: etag, 'Cache-Control': 'no-cache', 'Vary': 'Accept-Encoding', ...SECURITY_HEADERS });
      return res.end();
    }
    const headers = {
      'Content-Type': type,
      ...(appFile ? { ETag: etag, 'Cache-Control': 'no-cache' } : { 'Cache-Control': 'public, max-age=3600' }),
      'Vary': 'Accept-Encoding',
      ...SECURITY_HEADERS,
    };
    if (enc) {
      return fs.readFile(file, (e3, raw) => {
        if (e3) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
        const body = Compress.staticPacked(`${file}|${stamp}`, () => raw, enc);
        res.writeHead(200, { ...headers, 'Content-Encoding': enc, 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
      });
    }
    res.writeHead(200, { ...headers, 'Content-Length': st.size });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

require('./routes/auth')({ route, sessionCookie, clearCookie });
require('./routes/profile')({ route });
require('./routes/solo')({ route });
require('./routes/daily')({ route });
require('./routes/wordsearch')({ route });
require('./routes/slide')({ route });
require('./routes/challenges')({ route });
require('./routes/leaderboard')({ route });
require('./routes/admin')({ route });
require('./routes/dashboard')({ route });
require('./routes/chat')({ route });
require('./routes/alerts')({ route });
require('./routes/announce')({ route });
require('./routes/invites')({ route });
require('./routes/quiz')({ route });
require('./routes/social')({ route });
require('./points').migrate(); // one time: category points for existing players
require('./weekly').start();   // weekly leaderboard prizes
require('./accountDelete').start();   // removes accounts whose 3-day deletion wait is over
const coins = require('./routes/coins');
coins({ route });

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/health') return sendJson(res, 200, { ok: true });
    if (url.pathname === '/ads.txt') {
      const txt = Adsense.adsTxt();
      if (!txt) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
      return res.end(req.method === 'HEAD' ? undefined : txt);
    }
    if (url.pathname === '/pay/return') return await coins.payReturn(req, res, url, SECURITY_HEADERS);
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    const av = url.pathname.match(/^\/avatars\/([a-z0-9_]{3,20})\.jpg$/);
    if (av) return serveAvatar(req, res, av[1]);
    const ad = url.pathname.match(/^\/ad\/([1-6])$/);
    if (ad) return serveAd(req, res, Number(ad[1]));
    const page = url.pathname.match(/^\/(about|privacy|disclaimer|delete-account)\/?$/);
    if (page) {
      const html = Pages.render(page[1]);
      if (!html) { res.writeHead(404, SECURITY_HEADERS); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache', ...SECURITY_HEADERS });
      return res.end(req.method === 'HEAD' ? undefined : html);
    }
    const bg = url.pathname.match(/^\/bg\/([1-8])$/);
    if (bg) return serveBg(req, res, Number(bg[1]));
    if (/^\/r\/[A-Za-z0-9_-]{16,64}$/.test(url.pathname)) return serveReport(req, res);
    if (/^\/s\/[a-f0-9]{16,64}$/.test(url.pathname)) return serveReport(req, res, 'sponsor-report.html');   // sponsor report link
    const wbg = url.pathname.match(/^\/wbg\/(naija|universal|wordsearch|slide)$/);
    if (wbg) return serveWorldBg(req, res, wbg[1]);
    const slp = url.pathname.match(/^\/sl\/(s[0-9a-f]{8})$/);
    if (slp) return serveSlide(req, res, slp[1]);
    const pop = url.pathname.match(/^\/popup\/([0-9a-f]{10})$/);
    if (pop) return servePopup(req, res, pop[1]);
    const pic = url.pathname.match(/^\/pic\/([0-9a-f]{16})$/);
    if (pic) return servePicture(req, res, pic[1]);
    return serveStatic(req, res, url);
  } catch (e) {
    if (e instanceof HttpError) return sendJson(res, e.status, { error: e.message });
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: 'Something went wrong on our side. Try again.' });
  }
});

module.exports = server;
