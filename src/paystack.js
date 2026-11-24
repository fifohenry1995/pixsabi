'use strict';
// Talks to Paystack (https://paystack.com) with Node's built-in fetch. No extra packages.
// Set PAYSTACK_SECRET_KEY (sk_test_... to try it, sk_live_... for real money).
// PAYSTACK_API_URL is only for tests (a fake Paystack on your own computer).
const crypto = require('crypto');
const { HttpError } = require('./util');

const API = () => (process.env.PAYSTACK_API_URL || 'https://api.paystack.co').replace(/\/+$/, '');
const secretKey = () => process.env.PAYSTACK_SECRET_KEY || '';
const enabled = () => !!secretKey();

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(API() + path, {
      method,
      headers: { Authorization: `Bearer ${secretKey()}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new HttpError(502, 'We could not reach the payment service. Try again in a moment.');
  }
  let json = null;
  try { json = await res.json(); } catch { /* not JSON */ }
  if (!res.ok || !json || json.status !== true) {
    console.error(`[paystack] ${method} ${path} failed (${res.status}): ${json && json.message}`);
    throw new HttpError(502, 'The payment service refused that. Try again, or contact the game owner.');
  }
  return json.data;
}

// Starts a payment. Returns { authorization_url, reference, ... }.
const initialize = ({ email, amountKobo, reference, callbackUrl, metadata }) =>
  call('POST', '/transaction/initialize', { email, amount: amountKobo, currency: 'NGN', reference, callback_url: callbackUrl, metadata });

// Asks Paystack what really happened to a payment. We trust only this answer, never the browser.
const verify = (reference) => call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);

// Paystack signs every webhook with HMAC-SHA512 of the raw body using your secret key.
function validSignature(rawBody, header) {
  if (!enabled() || typeof header !== 'string' || !/^[0-9a-f]{128}$/i.test(header)) return false;
  const expected = crypto.createHmac('sha512', secretKey()).update(rawBody).digest();
  return crypto.timingSafeEqual(expected, Buffer.from(header, 'hex'));
}

module.exports = { enabled, initialize, verify, validSignature };
