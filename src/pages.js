'use strict';
// The About, Privacy Policy and Disclaimer pages. The wording lives in pages/*.html. Your own details (business name,
// contact email, address, website and date) are filled in from content/site.json, so you only edit one small file.
// While the details still say "YOUR BUSINESS NAME" the pages show a yellow reminder at the top.
const fs = require('fs');
const path = require('path');

const PAGES_DIR = path.join(__dirname, '..', 'pages');
const SITE_FILE = process.env.SITE_FILE || path.join(require('./paths').CONTENT_DIR, 'site.json');
const PAGES = {
  about: 'About us',
  privacy: 'Privacy Policy',
  disclaimer: 'Disclaimer',
  'delete-account': 'Delete your account',
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function site() {
  let cfg = {};
  try { cfg = JSON.parse(fs.readFileSync(SITE_FILE, 'utf8')); } catch { /* use the defaults below */ }
  return {
    businessName: String(cfg.businessName || 'YOUR BUSINESS NAME'),
    contactEmail: String(cfg.contactEmail || 'hello@yourdomain.com'),
    address: String(cfg.address || 'YOUR ADDRESS, Nigeria'),
    website: String(cfg.website || 'https://yourdomain.com'),
    effectiveDate: String(cfg.effectiveDate || ''),
  };
}
const isDraft = (c) => /YOUR BUSINESS NAME|yourdomain\.com|YOUR ADDRESS/.test(`${c.businessName} ${c.contactEmail} ${c.address} ${c.website}`);

function render(name) {
  if (!PAGES[name]) return null;
  let body;
  try { body = fs.readFileSync(path.join(PAGES_DIR, `${name}.html`), 'utf8'); } catch { return null; }
  const c = site();
  const on = require('./adsense').live();
  const vals = { TRACKERS: on ? 'Some adverts are supplied by Google AdSense. Google and its partners may use cookies and similar technology to show and measure adverts, including adverts based on your earlier visits to this and other websites. You can manage this at adssettings.google.com and read more at policies.google.com/technologies/ads.' : 'We do not use advertising trackers.', ADS_SOURCE: on ? ' Some adverts are supplied by Google AdSense.' : '', BUSINESS_NAME: c.businessName, CONTACT_EMAIL: c.contactEmail, ADDRESS: c.address, WEBSITE: c.website, EFFECTIVE_DATE: c.effectiveDate };
  body = body.replace(/\{\{([A-Z_]+)\}\}/g, (m, k) => (k in vals ? esc(vals[k]) : m));
  const nav = Object.entries(PAGES).map(([k, label]) => `<a href="/${k}"${k === name ? ' aria-current="page"' : ''}>${label}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#12062b">
<title>${PAGES[name]} | PixSabi</title>
<link rel="stylesheet" href="/css/style.css">
<link rel="stylesheet" href="/css/pages.css">
</head>
<body class="doc-page">
<header class="doc-top"><a class="logo" href="/"><span class="orn" aria-hidden="true">✦</span>PIXSABI</a><a class="doc-back" href="/">Back to the game</a></header>
<main class="doc">
${isDraft(c) ? '<p class="doc-draft"><strong>Reminder for the site owner:</strong> your business details are not filled in yet. Open <code>content/site.json</code>, put in your real details and save. This reminder then disappears. Have a Nigerian lawyer read these pages before you launch.</p>' : ''}
<article>
${body}
</article>
</main>
<footer class="doc-foot"><nav aria-label="Pages">${nav}</nav><p>&copy; ${new Date().getFullYear()} ${esc(c.businessName)}</p></footer>
</body>
</html>`;
}

module.exports = { render, PAGES, site };
