'use strict';
//  * GET /api/social          public: the contact and follow links the owner has filled in
//  * GET /api/admin/social    admin: the raw values typed in
//  * PUT /api/admin/social    admin: { contact, channel, x, instagram, tiktok, facebook } (empty clears one)
const { HttpError } = require('../util');
const Social = require('../social');
const needAdmin = (ctx) => { if (!require('./admin').isAdmin(ctx.user)) throw new HttpError(404, 'Not found.'); };

module.exports = ({ route }) => {
  route('GET', '/api/social', () => ({ links: Social.publicLinks() }));
  route('GET', '/api/admin/social', (ctx) => { needAdmin(ctx); return { values: Social.read(), links: Social.publicLinks() }; }, { auth: true });
  route('PUT', '/api/admin/social', (ctx) => {
    needAdmin(ctx);
    const next = {};
    for (const k of Social.KINDS) {
      const raw = Social.clean(ctx.body[k], 200);
      const r = Social.normalize(k, raw);
      if (r && r.error) throw new HttpError(400, r.error);
      next[k] = raw;
    }
    Social.write(next);
    console.log(`[admin] ${ctx.user.username} updated the social links`);
    return { values: Social.read(), links: Social.publicLinks() };
  }, { auth: true });
};
