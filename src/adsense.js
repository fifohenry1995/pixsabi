'use strict';
// Google AdSense. The owner pastes AdSense ad code on the Admin page. We never store or run the pasted text as it is:
// we pull out only the publisher ID, the ad slot number and the size settings, check each one, and rebuild the ad ourselves.
// Settings live in content/ads/adsense.json (next to the advert pictures), so they stay on the same Railway volume.
const fs = require('fs');
const path = require('path');
const { AD_DIR } = require('./adsPath');

const FILE = path.join(AD_DIR, 'adsense.json');
const PUB = /^ca-pub-\d{10,20}$/;
const SLOT = /^\d{6,15}$/;
const FORMATS = ['auto', 'rectangle', 'vertical', 'horizontal', 'fluid'];
const GOOGLE_ADS_TXT_ID = 'f08c47fec0942fa0'; // Google's fixed certification authority ID for ads.txt

function read() {
  let m = {};
  try { m = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { /* nothing saved yet */ }
  return { publisher: PUB.test(m.publisher || '') ? m.publisher : '', enabled: m.enabled === true, side: m.side && typeof m.side === 'object' ? m.side : {} };
}
function write(m) {
  fs.mkdirSync(AD_DIR, { recursive: true });
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(m, null, 1) + '\n');
  fs.renameSync(tmp, FILE);
}

// "pub-123..." or "ca-pub-123..." (or a whole snippet containing it) -> "ca-pub-123...", or '' when it is not valid.
function normalizePublisher(raw) {
  const m = /(?:ca-)?pub-(\d{10,20})/i.exec(String(raw || ''));
  return m ? `ca-pub-${m[1]}` : '';
}

// Read pasted AdSense ad-unit code (or just the slot number). Returns { ad: {client, slot, format, fullWidth, w, h} } or { error }.
function parseCode(text, fallbackClient) {
  const raw = String(text || '').trim();
  if (!raw) return { error: 'Paste your AdSense ad code first.' };
  if (raw.length > 6000) return { error: 'That is too long to be one AdSense ad. Paste only the ad unit code.' };
  if (/^\d{6,15}$/.test(raw)) {
    if (!fallbackClient) return { error: 'Save your AdSense publisher ID first (it starts with ca-pub-).' };
    return { ad: { client: fallbackClient, slot: raw, format: 'auto', fullWidth: true, w: 0, h: 0 } };
  }
  const attr = (name) => { const m = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(raw); return m ? m[1].trim() : ''; };
  const client = normalizePublisher(attr('data-ad-client') || (/client=([^"'&\s]+)/i.exec(raw) || [])[1] || '');
  const slot = attr('data-ad-slot');
  if (!/adsbygoogle|data-ad-slot/i.test(raw) || !slot) return { error: 'That does not look like AdSense ad unit code. In AdSense choose Ads > By ad unit, create a display ad, then copy the whole code box (it contains data-ad-slot).' };
  if (!client) return { error: 'The code has no publisher ID (data-ad-client="ca-pub-...").' };
  if (!SLOT.test(slot)) return { error: 'The ad slot number (data-ad-slot) in that code is not valid.' };
  if (fallbackClient && client !== fallbackClient) return { error: `That code belongs to ${client}, but your saved publisher ID is ${fallbackClient}.` };
  let format = attr('data-ad-format').toLowerCase();
  if (!FORMATS.includes(format)) format = '';
  const style = attr('style');
  const px = (k) => { const m = new RegExp(`${k}\\s*:\\s*(\\d{2,4})px`, 'i').exec(style); return m ? Number(m[1]) : 0; };
  const w = px('width'), h = px('height');
  const fixed = !format && w >= 50 && h >= 50 && w <= 1200 && h <= 1200; // a fixed-size ad: no data-ad-format, a pixel size in the style
  return { ad: { client, slot, format: fixed ? '' : format || 'auto', fullWidth: attr('data-full-width-responsive').toLowerCase() !== 'false', w: fixed ? w : 0, h: fixed ? h : 0 } };
}

const cleanAd = (a) => (a && PUB.test(a.client || '') && SLOT.test(String(a.slot || '')) ? { client: a.client, slot: String(a.slot), format: a.format || '', fullWidth: a.fullWidth !== false, w: Number(a.w) || 0, h: Number(a.h) || 0 } : null);

// The ads players' browsers may show: nothing unless AdSense is switched on and a publisher ID is saved.
const live = () => { const s = read(); return s.enabled && !!s.publisher; };
const publisher = () => read().publisher;
const sideAd = (slot) => (live() ? cleanAd(read().side[slot]) : null);
const mobileAd = () => (live() ? cleanAd(read().side.mobile) : null);   // the header ad on phones and tablets
const resultsAd = () => (live() ? cleanAd(read().side.results) : null);   // the banner on the full-page race results
const adsTxt = () => { const p = read().publisher; return p ? `google.com, ${p.replace(/^ca-/, '')}, DIRECT, ${GOOGLE_ADS_TXT_ID}\n` : ''; };

// Extra browser permissions, only while AdSense is on.
function csp(base) {
  if (!live()) return base;
  const scripts = 'https://pagead2.googlesyndication.com https://partner.googleadservices.com https://tpc.googlesyndication.com https://www.googletagservices.com https://*.adtrafficquality.google';
  return base
    .replace("script-src 'self'", `script-src 'self' ${scripts}`)
    .replace("style-src 'self'", "style-src 'self' 'unsafe-inline'")
    .replace("connect-src 'self'", "connect-src 'self' https://pagead2.googlesyndication.com https://*.g.doubleclick.net https://*.adtrafficquality.google https://*.google.com")
    .replace("font-src 'self';", "font-src 'self'; frame-src https://googleads.g.doubleclick.net https://tpc.googlesyndication.com https://*.safeframe.googlesyndication.com https://*.adtrafficquality.google https://www.google.com;");
}

// Put the AdSense verification tag (and, once switched on, the AdSense script) into the game's home page.
function injectHead(html) {
  const s = read();
  if (!s.publisher) return html;
  let tags = `<meta name="google-adsense-account" content="${s.publisher}">`;
  if (s.enabled) tags += `<script async src="https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${s.publisher}" crossorigin="anonymous"></script>`;
  return html.replace('</head>', `${tags}\n</head>`);
}

module.exports = { FILE, read, write, normalizePublisher, parseCode, cleanAd, live, publisher, sideAd, mobileAd, resultsAd, adsTxt, csp, injectHead };
