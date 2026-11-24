'use strict';
// The dashboard: numbers about players and adverts, for the owner and (through private read-only links) for
// advertisers and investors.
//
//  * POST /api/track                    public: the game reports that an advert was seen, clicked or closed
//  * GET  /api/admin/dash?days=30       admin: the full report
//  * GET  /api/admin/dash/links         admin: the share links
//  * POST /api/admin/dash/links         admin: make a link { kind: 'investor' | 'advertiser', advertiser, label }
//  * POST /api/admin/dash/links/:token/revoke   admin: switch a link off
//  * DELETE /api/admin/dash/links/:token        admin: delete a link
//  * GET  /api/report/:token?days=30    public, needs the secret link: an investor sees everything (no names or emails),
//                                       an advertiser sees only their own adverts plus the audience size
const { HttpError } = require('../util');
const Stats = require('../stats');
const Pop = require('../popups');
const Ads = require('../ads');

const isAdmin = (u) => require('./admin').isAdmin(u);
const needAdmin = (ctx) => { if (!isAdmin(ctx.user)) throw new HttpError(404, 'Not found.'); };

module.exports = ({ route }) => {
  route('POST', '/api/track', (ctx) => {
    const list = Array.isArray(ctx.body.events) ? ctx.body.events.slice(0, 10) : [];
    const ua = String(ctx.req.headers['user-agent'] || '');
    let n = 0;
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const kind = e.k === 'popup' ? 'popup' : e.k === 'ad' ? 'ad' : null;
      const ref = String(e.id == null ? '' : e.id);
      if (!kind || !['view', 'click', 'close'].includes(e.e)) continue;
      if (kind === 'ad' && !(Ads.SLOTS.map(String).includes(ref))) continue;
      if (kind === 'popup' && !Pop.find(ref)) continue;
      if (kind === 'ad' && e.e === 'close') continue;
      if (Stats.adEvent(kind, ref, e.e, String(ctx.body.vid || ''), ua)) n++;
    }
    return { ok: true, n };
  }, { maxBody: 2000 });

  route('GET', '/api/admin/dash', (ctx) => { needAdmin(ctx); return Stats.overview(ctx.query.days); }, { auth: true });

  // ---------- income tracker (owner only; never in the investor or advertiser links) ----------
  const Income = require('../income');
  const incomeView = (months) => ({ months: Income.summary(months), entries: Income.entries(100) });
  route('GET', '/api/admin/income', (ctx) => { needAdmin(ctx); return incomeView(ctx.query.months); }, { auth: true });
  route('POST', '/api/admin/income', (ctx) => {
    needAdmin(ctx);
    const r = Income.add(ctx.body);
    if (r.error) throw new HttpError(400, r.error);
    console.log(`[admin] ${ctx.user.username} added income: ${r.entry.kind} ${r.entry.month} N${r.entry.naira}`);
    return incomeView();
  }, { auth: true });
  route('DELETE', '/api/admin/income/:id', (ctx) => {
    needAdmin(ctx);
    if (!Income.remove(ctx.params.id)) throw new HttpError(404, 'That entry is already gone.');
    return incomeView();
  }, { auth: true });

  route('GET', '/api/admin/dash/links', (ctx) => {
    needAdmin(ctx);
    return { links: Stats.links.list(), advertisers: Stats.overview(30).advertisers };
  }, { auth: true });

  route('POST', '/api/admin/dash/links', (ctx) => {
    needAdmin(ctx);
    const kind = ctx.body.kind === 'advertiser' ? 'advertiser' : ctx.body.kind === 'investor' ? 'investor' : null;
    if (!kind) throw new HttpError(400, 'Choose investor or advertiser.');
    const clean = (s, max) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
    let advertiser = clean(ctx.body.advertiser, 40);
    if (kind === 'advertiser') {
      if (!advertiser) throw new HttpError(400, 'Type the advertiser name exactly as you wrote it on their adverts.');
      const known = Stats.advertList().some((a) => a.advertiser.toLowerCase() === advertiser.toLowerCase());
      if (!known) throw new HttpError(400, 'No advert has that advertiser name yet. Add the name to the advert first (Adverts or Pop-up adverts section).');
    } else advertiser = '';
    const token = Stats.links.create(kind, advertiser, clean(ctx.body.label, 60));
    console.log(`[admin] ${ctx.user.username} made a ${kind} dashboard link`);
    return { token, links: Stats.links.list() };
  }, { auth: true });

  route('POST', '/api/admin/dash/links/:token/revoke', (ctx) => {
    needAdmin(ctx);
    if (!Stats.links.revoke(ctx.params.token)) throw new HttpError(404, 'That link is already gone.');
    return { links: Stats.links.list() };
  }, { auth: true });

  route('DELETE', '/api/admin/dash/links/:token', (ctx) => {
    needAdmin(ctx);
    if (!Stats.links.remove(ctx.params.token)) throw new HttpError(404, 'That link is already gone.');
    return { links: Stats.links.list() };
  }, { auth: true });

  route('GET', '/api/report/:token', (ctx) => {
    const link = /^[A-Za-z0-9_-]{16,64}$/.test(ctx.params.token) ? Stats.links.get(ctx.params.token) : null;
    if (!link || link.revoked) throw new HttpError(404, 'This report link is not valid any more. Ask PixSabi for a new one.');
    Stats.links.seen(link.token);
    if (link.kind === 'advertiser') return { kind: 'advertiser', label: link.label || '', ...Stats.advertiserView(link.advertiser, ctx.query.days) };
    // investors see everything except what could point to a person: nothing personal is in the numbers anyway.
    return { kind: 'investor', label: link.label || '', ...Stats.overview(ctx.query.days) };
  });
};
