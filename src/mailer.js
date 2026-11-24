'use strict';
// Sends email through Resend (https://resend.com) with nothing to install.
// Set RESEND_API_KEY and MAIL_FROM (for example: PixSabi <hello@yourdomain.com>, on a domain you verified with Resend).
// Without them the game still works; password reset emails are simply not sent (the admin page can reset a password by hand).
const https = require('https');

const configured = () => !!(process.env.RESEND_API_KEY && process.env.MAIL_FROM);

// transport(payload) -> status code. Replaced in tests.
let transport = (payload) => new Promise((resolve, reject) => {
  const body = Buffer.from(JSON.stringify(payload));
  const req = https.request('https://api.resend.com/emails', {
    method: 'POST', timeout: 10_000,
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json', 'Content-Length': body.length },
  }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
  req.on('timeout', () => req.destroy(new Error('timeout')));
  req.on('error', reject);
  req.end(body);
});
const setTransport = (fn) => { transport = fn; };

// Returns true if the email service accepted the message.
async function send({ to, subject, text, html }) {
  if (!configured()) { console.warn('[mail] RESEND_API_KEY / MAIL_FROM are not set, so no email was sent.'); return false; }
  try {
    const status = await transport({ from: process.env.MAIL_FROM, to: [to], subject, text, html });
    if (status >= 200 && status < 300) return true;
    console.error('[mail] the email service refused the message (status ' + status + ')');
  } catch (e) { console.error('[mail] could not send:', e.message); }
  return false;
}

module.exports = { send, configured, setTransport };
