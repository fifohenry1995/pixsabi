'use strict';
// Cloudflare Turnstile: a free, friendly "are you human" check on the sign-up form (stops bots making accounts).
// Off until both TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are set (from your Cloudflare dashboard).
const https = require('https');
const enabled = () => !!(process.env.TURNSTILE_SITE_KEY && process.env.TURNSTILE_SECRET_KEY);
const siteKey = () => (enabled() ? process.env.TURNSTILE_SITE_KEY : null);

// transport(body string) -> parsed JSON from Cloudflare. Replaced in tests.
let transport = (body) => new Promise((resolve, reject) => {
  const req = https.request('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST', timeout: 8000,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
  }, (res) => { let d = ''; res.on('data', (c) => { d += c; if (d.length > 20000) req.destroy(); }); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(e); } }); });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end(body);
});
const setTransport = (fn) => { transport = fn; };

// true if Turnstile is off, or the visitor passed. If Cloudflare cannot be reached the sign-up is refused (fail closed) with a clear message.
async function check(token, ip) {
  if (!enabled()) return true;
  const t = String(token || '');
  if (!t || t.length > 2048) return false;
  const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: t, ...(ip && ip !== 'unknown' ? { remoteip: ip } : {}) }).toString();
  const r = await transport(body);
  return !!(r && r.success === true);
}
// Browser permissions for the widget (added only while Turnstile is on).
function csp(base) {
  if (!enabled()) return base;
  const host = 'https://challenges.cloudflare.com';
  let out = base
    .replace("script-src 'self'", `script-src 'self' ${host}`)
    .replace("connect-src 'self'", `connect-src 'self' ${host}`);
  out = out.includes('frame-src ') ? out.replace('frame-src ', `frame-src ${host} `) : out.replace("frame-ancestors 'none'", `frame-src ${host}; frame-ancestors 'none'`);
  return out;
}
module.exports = { enabled, siteKey, check, csp, setTransport };
