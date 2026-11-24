'use strict';
// Buying coins with Paystack.
//  1. The player picks a pack and gives an email (Paystack needs one for the receipt).
//  2. We save an order, ask Paystack to start the payment, and send the player to Paystack's page.
//  3. When they finish, Paystack sends them back to /pay/return AND calls our webhook.
//     Both ask Paystack "did it really succeed?" and add the coins ONCE (the order flips to "paid" atomically).
const crypto = require('crypto');
const { db, orders, save, flush } = require('../db');
const { HttpError } = require('../util');
const paystack = require('../paystack');
const Premium = require('../premium');

// Change the packs and prices here. Prices are in naira (Paystack is charged in kobo = naira x 100).
const PACKS = [
  { id: 'c200', coins: 200, naira: 500 },
  { id: 'c600', coins: 600, naira: 1200 },
  { id: 'c1500', coins: 1500, naira: 2500 },
];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
const REF_RE = /^NS[0-9a-f]{20}$/;

function baseUrl(req) {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/+$/, '');
  const proto = (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-proto']) || 'http';
  return `${String(proto).split(',')[0].trim()}://${req.headers.host}`;
}

// Checks the payment with Paystack and gives the coins if it really succeeded.
// Returns { status: 'paid' | 'pending' | 'failed' | 'cancelled' | 'unknown' }.
async function fulfil(ref) {
  const order = orders.get(ref);
  if (!order) return { status: 'unknown' };
  if (order.status === 'paid') return { status: 'paid', already: true };
  let data;
  try { data = await paystack.verify(ref); } catch { return { status: 'pending' }; }

  if (data.status === 'success') {
    if (data.amount !== order.amount_kobo || (data.currency && data.currency !== 'NGN')) {
      console.error(`[coins] order ${ref}: amount mismatch (paid ${data.amount} ${data.currency}, expected ${order.amount_kobo}). No coins given.`);
      orders.setStatus(ref, 'mismatch');
      return { status: 'failed' };
    }
    const user = db.users[order.user_id];
    if (!user) { console.error(`[coins] order ${ref}: player ${order.user_id} not found`); return { status: 'pending' }; }
    if (orders.markPaid(ref)) {               // only the first caller gets here
      if (order.pack === 'premium') {
        const until = Premium.grant(user);
        flush();
        console.log(`[premium] ${order.user_id} paid for premium until ${new Date(until).toISOString()} (${ref})`);
      } else {
        user.coins += order.coins;
        flush();                                // saved to disk at once: this is real money
        console.log(`[coins] ${order.user_id} bought ${order.coins} coins (${ref})`);
      }
    }
    return { status: 'paid' };
  }
  if (data.status === 'failed' || data.status === 'reversed') { orders.setStatus(ref, 'failed'); return { status: 'failed' }; }
  if (data.status === 'abandoned') return { status: 'cancelled' };
  return { status: 'pending' };
}

module.exports = ({ route }) => {
  route('GET', '/api/coins/packs', () => ({
    enabled: paystack.enabled(),
    packs: PACKS.map((p) => ({ id: p.id, coins: p.coins, price: p.naira })),
  }), { auth: true });

  route('POST', '/api/coins/buy', async (ctx) => {
    if (!paystack.enabled()) throw new HttpError(503, 'Buying coins is not open yet.');
    const pack = PACKS.find((p) => p.id === String(ctx.body.pack || ''));
    if (!pack) throw new HttpError(400, 'Pick one of the coin packs.');
    const email = String(ctx.body.email || '').trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address. Paystack sends your receipt there.');

    const ref = 'NS' + crypto.randomBytes(10).toString('hex');
    orders.create({ ref, userId: ctx.user.id, pack: pack.id, coins: pack.coins, amountKobo: pack.naira * 100, email });
    try {
      const init = await paystack.initialize({
        email, amountKobo: pack.naira * 100, reference: ref,
        callbackUrl: `${baseUrl(ctx.req)}/pay/return`,
        metadata: { user: ctx.user.id, pack: pack.id, coins: pack.coins },
      });
      return { url: init.authorization_url, reference: ref };
    } catch (e) {
      orders.setStatus(ref, 'failed');
      throw e;
    }
  }, { auth: true, strict: true });

  // Premium: pay once for 30 days. Same payment flow as coins; the order's pack is 'premium'.
  route('GET', '/api/premium', (ctx) => ({
    open: Premium.isOpen(), enabled: Premium.isOpen() && paystack.enabled(), price: Premium.NAIRA, days: Premium.DAYS, email: ctx.user.email || '', ...Premium.info(ctx.user),
  }), { auth: true });

  route('POST', '/api/premium/buy', async (ctx) => {
    if (!Premium.isOpen() || !paystack.enabled()) throw new HttpError(503, 'Premium is not open yet.');
    const email = String(ctx.body.email || ctx.user.email || '').trim();
    if (email.length > 254 || !EMAIL_RE.test(email)) throw new HttpError(400, 'Enter a valid email address. Paystack sends your receipt there.');
    const ref = 'NS' + crypto.randomBytes(10).toString('hex');
    orders.create({ ref, userId: ctx.user.id, pack: 'premium', coins: 0, amountKobo: Premium.NAIRA * 100, email });
    try {
      const init = await paystack.initialize({
        email, amountKobo: Premium.NAIRA * 100, reference: ref,
        callbackUrl: `${baseUrl(ctx.req)}/pay/return`,
        metadata: { user: ctx.user.id, pack: 'premium', days: Premium.DAYS },
      });
      return { url: init.authorization_url, reference: ref };
    } catch (e) {
      orders.setStatus(ref, 'failed');
      throw e;
    }
  }, { auth: true, strict: true });

  // Paystack calls this by itself when a payment succeeds (set the URL in your Paystack dashboard).
  route('POST', '/api/paystack/webhook', async (ctx) => {
    if (!paystack.validSignature(ctx.rawBody || '', ctx.req.headers['x-paystack-signature'])) {
      throw new HttpError(401, 'Bad signature.');
    }
    const ev = ctx.body || {};
    const ref = ev.data && ev.data.reference;
    if (ev.event === 'charge.success' && typeof ref === 'string' && REF_RE.test(ref)) await fulfil(ref);
    return { ok: true };
  }, { maxBody: 100_000 });
};

// The page Paystack sends the player back to. Confirms the payment, then goes to the game with a note.
module.exports.payReturn = async function payReturn(req, res, url, headers) {
  const ref = url.searchParams.get('reference') || url.searchParams.get('trxref') || '';
  let status = 'unknown';
  if (REF_RE.test(ref)) {
    try { status = (await fulfil(ref)).status; } catch (e) { console.error('[coins] return check failed:', e.message); status = 'pending'; }
  }
  const order = REF_RE.test(ref) ? orders.get(ref) : null;
  const forWhat = order && order.pack === 'premium' ? '&for=premium' : '';
  res.writeHead(302, { Location: `/?paid=${status}${forWhat}`, 'Cache-Control': 'no-store', ...headers });
  res.end();
};
module.exports.PACKS = PACKS;
module.exports.fulfil = fulfil;
