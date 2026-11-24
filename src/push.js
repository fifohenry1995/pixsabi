'use strict';
// Web Push (browser and phone notifications) with nothing to install: only Node's built-in crypto and https.
// It follows the standard rules (RFC 8030 push, RFC 8291 message encryption, RFC 8292 VAPID sign-in).
//  * The server has one "VAPID" key pair. It is created the first time and saved in DATA_DIR/.vapid.json
//    (or set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, both base64url, to keep the same keys on every server).
//    Keep that file: if it is lost, every player has to switch alerts on again.
//  * A player's browser gives us an "endpoint" web address. We only ever send to the real push services
//    (Google, Mozilla, Microsoft, Apple), so nobody can make the server call other addresses.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { DATA_DIR } = require('./db');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const fromB64u = (s) => Buffer.from(String(s), 'base64url');

// ---------- keys ----------
let keys = null;
function loadKeys() {
  if (keys) return keys;
  const file = path.join(DATA_DIR, '.vapid.json');
  let priv = process.env.VAPID_PRIVATE_KEY, pub = process.env.VAPID_PUBLIC_KEY;
  if (!priv || !pub) {
    try { ({ priv, pub } = JSON.parse(fs.readFileSync(file, 'utf8'))); } catch { /* make new keys below */ }
  }
  if (!priv || !pub) {
    const kp = crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    const jwk = kp.privateKey.export({ format: 'jwk' });
    priv = jwk.d;
    pub = b64u(Buffer.concat([Buffer.from([4]), fromB64u(jwk.x), fromB64u(jwk.y)]));
    fs.writeFileSync(file, JSON.stringify({ priv, pub }), { mode: 0o600 });
  }
  const raw = fromB64u(pub);
  const privateKey = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)) }, format: 'jwk' });
  keys = { pub, privateKey };
  return keys;
}
const publicKey = () => loadKeys().pub;

// ---------- who we are willing to send to ----------
const ALLOWED_HOSTS = ['.googleapis.com', '.mozilla.com', '.windows.com', '.apple.com'];
function endpointOk(endpoint) {
  let u;
  try { u = new URL(endpoint); } catch { return false; }
  if (u.protocol !== 'https:' || u.port || u.username || u.password || endpoint.length > 700) return false;
  return ALLOWED_HOSTS.some((d) => u.hostname.endsWith(d));
}
function keysOk(p256dh, auth) {
  try {
    const k = fromB64u(p256dh), a = fromB64u(auth);
    if (k.length !== 65 || k[0] !== 4 || a.length !== 16) return false;
    crypto.createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64u(k.subarray(1, 33)), y: b64u(k.subarray(33, 65)) }, format: 'jwk' }); // must be a real point on the curve
    return true;
  } catch { return false; }
}

// ---------- VAPID sign-in header ----------
function vapidHeader(endpoint) {
  const { pub, privateKey } = loadKeys();
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: process.env.VAPID_SUBJECT || 'mailto:admin@naijasabi.example' }));
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key: privateKey, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${pub}`;
}

// ---------- message encryption (aes128gcm) ----------
function encrypt(sub, payload) {
  const uaPub = fromB64u(sub.p256dh), authSecret = fromB64u(sub.auth);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const asPub = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPub);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, authSecret, Buffer.concat([Buffer.from('WebPush: info\0'), uaPub, asPub]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const data = Buffer.concat([c.update(Buffer.concat([Buffer.from(payload), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const rs = Buffer.alloc(4); rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPub.length]), asPub, data]);
}

// ---------- sending ----------
// transport(endpoint, headers, body) -> status code. Replaced in tests.
let transport = (endpoint, headers, body) => new Promise((resolve, reject) => {
  const req = https.request(endpoint, { method: 'POST', headers: { ...headers, 'Content-Length': body.length }, timeout: 10_000 }, (res) => {
    res.resume();
    res.on('end', () => resolve(res.statusCode));
  });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end(body);
});
const setTransport = (fn) => { transport = fn; };

// Returns 'ok', 'gone' (the browser dropped this subscription: delete it) or 'failed' (try again some other time).
async function send(sub, message) {
  if (!endpointOk(sub.endpoint)) return 'gone';
  try {
    const status = await transport(sub.endpoint, {
      Authorization: vapidHeader(sub.endpoint),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    }, encrypt(sub, JSON.stringify(message)));
    if (status >= 200 && status < 300) return 'ok';
    if (status === 404 || status === 410) return 'gone';
    return 'failed';
  } catch { return 'failed'; }
}

module.exports = { publicKey, endpointOk, keysOk, vapidHeader, encrypt, send, setTransport };
