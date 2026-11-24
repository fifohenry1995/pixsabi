/* PixSabi front end: hash-routed single page app, no build step. */
(function () {
  const NS = (window.NS = window.NS || {});
  const app = document.getElementById('app');
  let me = null;

  // ---------- helpers ----------
  // A password box with a Show / Hide button on its right, so people can check what they typed.
  function pwWrap(input) {
    const b = h('button', { class: 'pw-toggle', type: 'button', 'aria-pressed': 'false', 'aria-label': 'Show password' }, 'Show');
    b.addEventListener('click', () => {
      const show = input.type === 'password';
      input.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-pressed', show ? 'true' : 'false');
      b.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
    });
    return h('div', { class: 'pw-wrap' }, input, b);
  }
  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return e;
  }


  // tiny SVG builder (SVG needs its own namespace)
  function S(tag, attrs, ...kids) {
    const e = document.createElementNS('http://www.w3.org/2000/svg', tag);
    for (const [k, v] of Object.entries(attrs || {})) if (v != null && v !== false) e.setAttribute(k, v);
    for (const kid of kids.flat()) if (kid != null && kid !== false) e.append(kid.nodeType ? kid : document.createTextNode(kid));
    return e;
  }
  function coinIcon(size) {
    return S('svg', { viewBox: '0 0 16 16', width: String(size), height: String(size), 'aria-hidden': 'true', class: 'coin-ico' },
      S('circle', { cx: 8, cy: 8, r: 7, fill: '#f5b82e' }), S('circle', { cx: 8, cy: 8, r: 4.5, fill: 'none', stroke: '#b9801a', 'stroke-width': 1.5 }));
  }
  function chestIcon(size) {
    return S('svg', { viewBox: '0 0 64 64', width: String(size), height: String(size), 'aria-hidden': 'true', class: 'chest-ico' },
      S('rect', { x: '8', y: '28', width: '48', height: '28', rx: '6', fill: '#b9801a' }),
      S('path', { d: 'M8 30a6 6 0 0 1 6-6h36a6 6 0 0 1 6 6v4H8z', fill: '#f5b82e' }),
      S('rect', { x: '28', y: '30', width: '8', height: '12', rx: '2', fill: '#2a1a00' }),
      S('path', { d: 'M14 24c0-8 8-14 18-14s18 6 18 14', fill: 'none', stroke: '#f5b82e', 'stroke-width': '4' }));
  }

  // An invite link looks like  https://yoursite/?ref=Ada . Remember who invited this visitor until they sign up.
  try {
    const ref = new URLSearchParams(location.search).get('ref');
    if (ref && /^[A-Za-z0-9_]{3,20}$/.test(ref)) {
      localStorage.setItem('ns_ref', ref);
      history.replaceState(null, '', location.pathname + location.hash);
    }
  } catch { /* private mode: the invite just will not be remembered */ }
  const savedRef = () => { try { return localStorage.getItem('ns_ref') || ''; } catch { return ''; } };
  const adminTag = () => h('span', { class: 'admin-tag', title: 'Game admin' }, 'ADMIN');

  // ---- Weak connection: a small banner, quiet retries, and nothing is lost ----
  const Net = (function () {
    let bar = null, bad = 0;
    function show(on) {
      if (on && !bar) { bar = h('div', { class: 'net-bar', role: 'status' }, 'Weak connection. Reconnecting... your progress is safe.'); document.body.append(bar); }
      if (!on && bar) { bar.remove(); bar = null; }
    }
    return {
      fail() { bad++; if (bad >= 2 || navigator.onLine === false) show(true); },
      ok() { bad = 0; show(false); },
    };
  })();
  window.addEventListener('offline', () => Net.fail());
  window.addEventListener('online', () => { Net.ok(); try { route(); } catch { /* ignore */ } });
  function clearPics() { try { if (navigator.serviceWorker && navigator.serviceWorker.controller) navigator.serviceWorker.controller.postMessage({ type: 'clear-pics' }); } catch { /* ignore */ } }
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    // Reading is safe to repeat, so it is retried quietly (3 tries). Sending an answer is never repeated by itself: the player
    // taps again, and the screen keeps what they typed.
    const tries = method === 'GET' ? 3 : 1;
    let res;
    for (let i = 0; ; i++) {
      try {
        res = await fetch('/api' + path, {
          method,
          headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
          body: method === 'GET' ? undefined : JSON.stringify(opts.body || {}),
          credentials: 'same-origin',
        });
        if (res.status >= 502 && res.status <= 504 && i < tries - 1) { await sleep(700 * (i + 1)); continue; }
        Net.ok();
        break;
      } catch (e) {
        Net.fail();
        if (i < tries - 1) { await sleep(700 * (i + 1)); continue; }
        const err = new Error('No connection right now. Your progress is safe. Try again in a moment.');
        err.offline = true;
        throw err;
      }
    }
    let data = {};
    try { data = await res.json(); } catch { /* empty body */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong. Check your connection and try again.');
      err.status = res.status;
      if (res.status === 401 && me) { me = null; route(); }
      // The admin removed or changed the puzzle this player has open: show a fresh one.
      if (res.status === 404 && /could not find that puzzle/i.test(err.message) && !api.refreshing) {
        api.refreshing = true;
        NS.toast('The admin just updated this puzzle. Loading a fresh one...');
        setTimeout(() => { api.refreshing = false; route(); }, 1200);
      }
      throw err;
    }
    return data;
  }

  NS.toast = function (text, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, text);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 3500);
  };

  function showDialog(content) {
    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'card dialog' }, content));
    document.body.append(overlay);
    const first = overlay.querySelector('button');
    if (first) first.focus();
    return () => overlay.remove();
  }

  const spinner = () => h('div', { class: 'spinner' }, 'Loading...');
  const go = (hash) => { location.hash = hash; };
  const profileLink = (name) => '#/u/' + encodeURIComponent(name);

  // A player's picked picture (or an old photo), or a coloured circle with their first letter when they have none.
  const AVATAR_COLORS = ['#0a7b45', '#2540c8', '#c8281c', '#7a3db8', '#b35a00', '#00758f'];
  function avatarEl(url, name, size, tier) {
    const cls = 'avatar' + (size ? ' ' + size : '') + (tier > 1 ? ' tier-' + tier : ''); // the frame colour follows the rank title
    if (url && url.startsWith('preset:')) {                  // a picked picture, drawn here (nothing to download)
      const art = NS.avatars ? NS.avatars.svg(url.slice(7)) : '';
      if (art) { const d = h('div', { class: cls + ' preset', 'aria-hidden': 'true' }); d.innerHTML = art; return d; }
      url = null;
    }
    if (url) {
      const img = h('img', { class: cls, src: url, alt: '', loading: 'lazy' });
      img.addEventListener('error', () => img.replaceWith(avatarEl(null, name, size, tier)));
      return img;
    }
    let hash = 0;
    for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const d = h('div', { class: cls + ' initial', 'aria-hidden': 'true' }, name.charAt(0));
    d.style.background = AVATAR_COLORS[hash % AVATAR_COLORS.length];
    return d;
  }

  const ordinal = (n) => {
    const s = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  };
  const timeAgo = (ts) => {
    const m = Math.floor((Date.now() - ts) / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m} min ago`;
    if (m < 1440) return `${Math.floor(m / 60)} hr ago`;
    return `${Math.floor(m / 1440)} day${m >= 2880 ? 's' : ''} ago`;
  };

  let prevView = '';   // which page the player was on before this one
  let curView = '';

  // ---------- live counts: registered players and players online ----------
  const live = { players: null, online: null };
  let liveEls = [];
  const fmt = (n) => Number(n).toLocaleString('en-NG');
  function paintLive() {
    for (const el of liveEls) {
      el.textContent = live.players == null ? ' ' : `👥 ${fmt(live.players)} players` + (live.online != null && me && me.isAdmin ? `   🟢 ${fmt(live.online)} online (only you see this)` : '');
    }
  }
  function setLive(r) {
    if (!r || r.players == null) return;
    live.players = r.players; live.online = r.online == null ? null : r.online;
    paintLive();
  }
  async function pingPresence() {
    if (!me || document.hidden) return;
    try { setLive(await api('/presence')); } catch { /* try again in a minute */ }
  }
  setInterval(pingPresence, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pingPresence(); });

  // ---------- alerts: the bell, in-app banners and phone/browser push ----------
  const alerts = { unread: 0, lastId: 0, first: true, enabled: true, push: false, badges: [] };
  function paintBell() {
    alerts.badges = alerts.badges.filter((b) => b.isConnected);
    for (const b of alerts.badges) { b.textContent = alerts.unread > 9 ? '9+' : String(alerts.unread); b.hidden = alerts.unread < 1; }
  }
  function alertBanner(title, body, url) {
    document.querySelectorAll('.alert-banner').forEach((n) => n.remove());
    const close = () => el.remove();
    const el = h('div', { class: 'alert-banner', role: 'alert' },
      h('button', { class: 'alert-main', type: 'button', onclick: () => { close(); if (url) go(url); } },
        h('strong', {}, title), body ? h('span', {}, body) : null),
      h('button', { class: 'alert-x', type: 'button', 'aria-label': 'Close', onclick: close }, '×'));
    document.body.append(el);
    NS.sound.play('alert');
    setTimeout(close, 9000);
  }
  async function pollAlerts() {
    if (!me || document.hidden) return null;
    try {
      const r = await api('/notifications');
      alerts.enabled = r.enabled; alerts.push = r.push;
      const fresh = r.items.filter((i) => !i.read && i.id > alerts.lastId);
      if (curView !== 'alerts') {
        if (alerts.first && r.unread > 0) {
          const top = r.items.find((i) => !i.read);
          if (r.unread === 1 && top) alertBanner(top.title, top.body, top.url);
          else alertBanner(`You have ${r.unread} new alerts`, 'Tap to see them', '#/alerts');
        } else if (!alerts.first) {
          fresh.slice(-2).forEach((i) => alertBanner(i.title, i.body, i.url));
        }
      }
      alerts.first = false;
      alerts.lastId = Math.max(alerts.lastId, ...r.items.map((i) => i.id), 0);
      alerts.unread = r.unread; paintBell();
      return r;
    } catch { return null; }
  }
  setInterval(pollAlerts, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollAlerts(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', (e) => {
    const d = e.data || {};
    if (d.type === 'alerts') pollAlerts();
    if (d.type === 'go' && typeof d.url === 'string' && d.url.startsWith('#/')) { go(d.url); pollAlerts(); }
  });

  const pushSupported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const isStandalone = () => (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const keyBytes = (k) => { const pad = '='.repeat((4 - (k.length % 4)) % 4); const raw = atob((k + pad).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(raw, (c) => c.charCodeAt(0)); };
  async function thisDeviceSub() {
    if (!pushSupported()) return null;
    try { return await (await navigator.serviceWorker.ready).pushManager.getSubscription(); } catch { return null; }
  }
  async function enablePush() {
    if (!pushSupported()) throw new Error('This browser cannot show alerts.');
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Alerts are blocked. Allow notifications for this site in your browser or phone settings, then try again.');
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await api('/push/key');
      sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
    }
    await api('/push/subscribe', { method: 'POST', body: sub.toJSON() });
    alerts.push = true; alerts.enabled = true;
  }
  async function disablePush() {
    const sub = await thisDeviceSub();
    if (sub) { const endpoint = sub.endpoint; await sub.unsubscribe().catch(() => {}); await api('/push/unsubscribe', { method: 'POST', body: { endpoint } }); }
  }
  // A small card on the Challenge page, until the player switches alerts on or says no thanks.
  function pushNudge() {
    let dismissed = false;
    try { dismissed = localStorage.getItem('ns_alert_nudge') === '1'; } catch { /* private mode */ }
    if (dismissed || alerts.push) return null;
    const ios = isIos() && !isStandalone();
    if (!ios && (!pushSupported() || Notification.permission === 'denied')) return null;
    const card = h('div', { class: 'card nudge' });
    const no = () => { try { localStorage.setItem('ns_alert_nudge', '1'); } catch { /* ignore */ } card.remove(); };
    card.append(h('div', { class: 'nudge-text' }, h('strong', {}, '🔔 Know when someone challenges you'),
      h('span', { class: 'muted' }, ios ? 'On iPhone: tap Share, then Add to Home Screen, open PixSabi from there and turn alerts on in Alerts.' : 'Get a notification on this device when a friend challenges you or a race starts.')));
    const row = h('div', { class: 'row' });
    if (!ios) row.append(h('button', { class: 'btn small', type: 'button', onclick: async (e) => {
      e.currentTarget.disabled = true;
      try { await enablePush(); NS.toast('Alerts are on'); card.remove(); } catch (ex) { NS.toast(ex.message, true); e.currentTarget.disabled = false; }
    } }, 'Turn on'));
    row.append(h('button', { class: 'btn alt small', type: 'button', onclick: no }, 'Not now'));
    card.append(row);
    return card;
  }

  async function viewAlerts() {
    const main = shell('alerts');
    main.classList.add('stack');
    main.append(spinner());
    const r = await pollAlerts() || await api('/notifications').catch(() => null);
    main.textContent = '';
    if (!r) { main.append(h('div', { class: 'card' }, 'Could not load your alerts. Try again.')); return; }
    const dev = await thisDeviceSub();
    const perm = pushSupported() ? Notification.permission : 'unsupported';
    const ios = isIos() && !isStandalone();

    const status = h('p', { class: 'muted' });
    const btn = h('button', { class: 'btn', type: 'button' });
    const paintDevice = (on) => {
      if (ios && !pushSupported()) { status.textContent = 'On iPhone, alerts need the app on your Home Screen: tap Share, then Add to Home Screen, then open PixSabi from there and come back to this page.'; btn.hidden = true; return; }
      if (!pushSupported()) { status.textContent = 'This browser cannot show alerts. You will still see them here and in the game when it is open.'; btn.hidden = true; return; }
      if (perm === 'denied' && !on) { status.textContent = 'Notifications are blocked for this site. Allow them in your browser or phone settings, then come back and tap Turn on.'; }
      else status.textContent = on ? 'This device gets a notification, even when the game is closed.' : 'Get a notification on this device even when the game is closed.';
      btn.textContent = on ? 'Turn off on this device' : 'Turn on for this device';
      btn.classList.toggle('alt', on);
      btn.onclick = async () => {
        btn.disabled = true;
        try { if (on) { await disablePush(); on = false; NS.toast('Alerts off on this device'); } else { await enablePush(); on = true; NS.toast('Alerts are on'); } paintDevice(on); }
        catch (e) { NS.toast(e.message, true); }
        btn.disabled = false;
      };
    };
    paintDevice(!!dev && r.push);

    const master = h('input', { type: 'checkbox', id: 'alerts-on', checked: r.enabled ? true : null });
    master.addEventListener('change', async () => {
      try { await api('/notifications/settings', { method: 'POST', body: { enabled: master.checked } }); NS.toast(master.checked ? 'Alerts are on' : 'All alerts are off'); if (!master.checked) { alerts.push = false; paintDevice(false); } }
      catch (e) { master.checked = !master.checked; NS.toast(e.message, true); }
    });

    const list = h('div', { class: 'alert-list' });
    for (const n of r.items) {
      list.append(h('a', { class: 'alert-item' + (n.read ? '' : ' unread'), href: n.url },
        h('strong', {}, n.title), h('span', {}, n.body), h('small', { class: 'muted' }, timeAgo(n.at))));
    }
    if (!r.items.length) list.append(h('p', { class: 'muted' }, 'Nothing yet. When a friend challenges you or a race starts, it shows up here.'));

    main.append(
      h('div', { class: 'card' }, h('h2', {}, 'Alerts'), status, btn,
        h('div', { class: 'field alert-check' }, master, h('label', { for: 'alerts-on' }, 'Send me alerts (challenges, race start, race result)'))),
      h('div', { class: 'card' }, h('h2', {}, 'Your alerts'), list));
    if (r.unread) { api('/notifications/read', { method: 'POST', body: {} }).then((x) => { alerts.unread = x.unread; paintBell(); }).catch(() => {}); }
  }

  // ---------- shell ----------
  let chips = {};
  function shell(active, opts) {
    document.body.classList.remove('is-auth');
    app.textContent = '';
    chips.coins = h('span', {}, String(me.coins));
    chips.points = h('span', {}, String(me.points));
    const top = h('header', { class: 'top' },
      h('a', { class: 'logo', href: '#/' }, h('span', { class: 'orn', 'aria-hidden': 'true' }, '✦'), 'PIXSABI'),
      h('div', { class: 'chips' },
        h('a', { class: 'chip gear', href: '#/settings', title: 'Settings', 'aria-label': 'Settings' }, gearIcon(18)),
        h('a', { class: 'chip bell', href: '#/alerts', title: 'Alerts', 'aria-label': 'Alerts' }, '🔔', (() => { const b = h('span', { class: 'badge-n' }); alerts.badges.push(b); return b; })()),
        h('button', { class: 'chip buy', type: 'button', title: 'Buy coins', 'aria-label': 'Buy coins', onclick: () => buyCoins() }, coinIcon(16), chips.coins, h('span', { class: 'plus', 'aria-hidden': 'true' }, '+')),
        h('span', { class: 'chip', title: 'Points' }, '⭐', chips.points)));
    const liveBar = h('div', { class: 'livebar', 'aria-live': 'off', title: 'Registered players' });
    liveEls = liveEls.filter((e) => e.isConnected); // forget the strips of pages that are gone
    liveEls.push(liveBar);
    paintLive();
    if (live.players == null || Date.now() - (live.at || 0) > 30000) { live.at = Date.now(); pingPresence(); }
    const main = h('main', { id: 'main' });
    { const add = main.append.bind(main); main.append = (...kids) => add(...kids.flat().filter((k) => k != null && k !== false)); } // never print the word "null"
    const item = (href, ico, label, key) =>
      h('a', { href, 'aria-current': active === key ? 'page' : null }, h('span', { class: 'ico' }, ico), label);
    const nav = h('nav', { class: 'nav', 'aria-label': 'Main' },
      h('div', { class: 'nav-inner' },
        item('#/', '🧩', 'Play', 'solo'),
        item('#/daily', '📅', 'Daily', 'daily'),
        item('#/challenges', '⚔️', 'Challenge', 'challenges'),
        item('#/chat', '💬', 'Chat', 'chat'),
        item('#/ranks', '🏆', 'Ranks', 'ranks'),
        item('#/me', '👤', 'Me', 'me')));
    app.append(top, ...(opts && opts.live ? [liveBar] : []), ...[verifyBar()].filter(Boolean), main, nav);   // (a missing bar must not print the word "null")
    paintBell();
    return main;
  }
  // A thin reminder for players who have not confirmed their email yet (only shown when the game can send emails).
  function verifyBar() {
    if (me && me.deleteAt) {
      const when = new Date(me.deleteAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
      const undo = h('button', { class: 'linkbtn', type: 'button' }, 'Cancel deletion');
      const bar = h('div', { class: 'verify-bar del-bar', role: 'status' }, `Your account will be deleted on ${when}. `, undo);
      undo.addEventListener('click', async () => {
        try { const r = await api('/me/delete/cancel', { method: 'POST', body: {} }); me = r.user; bar.remove(); NS.toast('Deletion cancelled'); } catch (e) { NS.toast(e.message, true); }
      });
      return bar;
    }
    if (me && me.mustChange) {
      return h('div', { class: 'verify-bar', role: 'status' }, 'You are using a temporary password. ', h('a', { class: 'linkbtn', href: '#/me' }, 'Choose your own password now'));
    }
    if (!me || !me.emailPending) return null;
    const msg = h('span', {}, 'Confirm your email to unlock weekly prizes and invite coins. Check your inbox and spam folder. ');
    const again = h('button', { class: 'linkbtn', type: 'button' }, 'Send the link again');
    again.addEventListener('click', async () => {
      again.disabled = true;
      try { await api('/auth/verify/resend', { method: 'POST' }); NS.toast('Confirmation email sent'); }
      catch (e) { NS.toast(e.message, true); }
      setTimeout(() => { again.disabled = false; }, 5000);
    });
    return h('div', { class: 'verify-bar', role: 'status' }, msg, again);
  }
  function setStats(s) {
    if (!s) return;
    if (s.coins != null) { me.coins = s.coins; chips.coins.textContent = s.coins; }
    if (s.points != null) { me.points = s.points; chips.points.textContent = s.points; }
  }

  // ---------- auth ----------
  // Email (for password recovery) and password change
  function accountCards() {
    const eErr = h('div', { class: 'error', role: 'alert' });
    const eNote = h('div', { class: 'lg-note', role: 'status' });
    const em = h('input', { type: 'email', id: 'acc-email', autocomplete: 'email', maxlength: '120', value: me.email || '', placeholder: 'you@example.com' });
    const ePw = h('input', { type: 'password', id: 'acc-epw', autocomplete: 'current-password', maxlength: '72' });
    const eBtn = h('button', { class: 'btn block', type: 'submit' }, 'Save email');
    const eForm = h('form', { novalidate: true },
      h('h3', {}, 'Email'),
      h('p', { class: 'muted' }, me.email ? (me.emailPending ? 'Not confirmed yet: open the link we emailed you (check spam).' : 'We use this only to send you a link if you forget your password.') : 'Add an email so you can get back in if you forget your password.'),
      h('div', { class: 'field' }, h('label', { for: 'acc-email' }, 'Email'), em),
      h('div', { class: 'field' }, h('label', { for: 'acc-epw' }, 'Your password (to confirm)'), pwWrap(ePw)),
      eErr, eNote, h('div', { class: 'field' }, eBtn));
    eForm.addEventListener('submit', async (e) => {
      e.preventDefault(); eErr.textContent = ''; eNote.textContent = ''; eBtn.disabled = true;
      try {
        const r = await api('/me/email', { method: 'POST', body: { email: em.value, password: ePw.value } });
        me = r.user; ePw.value = ''; eNote.textContent = 'Email saved.';
      } catch (ex) { eErr.textContent = ex.message; }
      eBtn.disabled = false;
    });
    // Optional recovery question (the admin can ask it if you ever cannot use the email reset)
    const rq = h('select', { id: 'acc-rq' }, h('option', { value: '' }, 'No recovery question'));
    const ra = h('input', { type: 'text', id: 'acc-ra', maxlength: '60', autocomplete: 'off', placeholder: 'Your answer' });
    const rpw = h('input', { type: 'password', id: 'acc-rpw', autocomplete: 'current-password', maxlength: '72' });
    const rErr = h('div', { class: 'error', role: 'alert' });
    const rNote = h('div', { class: 'lg-note', role: 'status' }, me.recoveryQuestion ? `Saved: ${me.recoveryQuestion}` : 'Not set.');
    api('/recovery/questions').then((r) => { for (const x of r.questions) rq.append(h('option', { value: x.id }, x.text)); }).catch(() => {});
    const rBtn = h('button', { class: 'btn block', type: 'submit' }, 'Save recovery question');
    const rForm = h('form', { novalidate: true },
      h('h3', {}, 'Recovery question (optional)'),
      h('p', { class: 'muted' }, 'If you ever cannot get the reset email, the admin can ask you this question to make sure the account is yours. Only you can know the answer: it is stored scrambled and nobody can read it.'),
      h('div', { class: 'field' }, h('label', { for: 'acc-rq' }, 'Question'), rq),
      h('div', { class: 'field' }, h('label', { for: 'acc-ra' }, 'Answer'), ra),
      h('div', { class: 'field' }, h('label', { for: 'acc-rpw' }, 'Your password (to confirm)'), pwWrap(rpw)),
      rErr, rNote, h('div', { class: 'field' }, rBtn));
    rForm.addEventListener('submit', async (e) => {
      e.preventDefault(); rErr.textContent = ''; rNote.textContent = ''; rBtn.disabled = true;
      try {
        const r = await api('/me/recovery', { method: 'POST', body: { question: rq.value, answer: ra.value, password: rpw.value } });
        me = r.user; ra.value = ''; rpw.value = '';
        rNote.textContent = me.recoveryQuestion ? `Saved: ${me.recoveryQuestion}` : 'Removed.';
      } catch (ex) { rErr.textContent = ex.message; }
      rBtn.disabled = false;
    });
    // Delete my account (removed after 3 days; can be cancelled)
    const dPw = h('input', { type: 'password', id: 'acc-dpw', autocomplete: 'current-password', maxlength: '72' });
    const dWord = h('input', { type: 'text', id: 'acc-dword', maxlength: '10', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'DELETE' });
    const dErr = h('div', { class: 'error', role: 'alert' });
    const dBox = h('div', {});
    const drawDelete = () => {
      dBox.textContent = '';
      if (me.deleteAt) {
        const cancel = h('button', { class: 'btn block', type: 'button' }, 'Cancel deletion');
        cancel.addEventListener('click', async () => {
          try { const r = await api('/me/delete/cancel', { method: 'POST', body: {} }); me = r.user; NS.toast('Deletion cancelled'); drawDelete(); const bar = document.querySelector('.verify-bar.del-bar'); if (bar) bar.remove(); }
          catch (ex) { dErr.textContent = ex.message; }
        });
        dBox.append(h('p', {}, `Your account will be deleted on ${new Date(me.deleteAt).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}. Until then you can keep playing, or cancel.`), cancel);
        return;
      }
      const go = h('button', { class: 'btn block danger', type: 'submit' }, 'Delete my account');
      const f = h('form', { novalidate: true },
        h('div', { class: 'field' }, h('label', { for: 'acc-dpw' }, 'Your password'), pwWrap(dPw)),
        h('div', { class: 'field' }, h('label', { for: 'acc-dword' }, 'Type DELETE to confirm'), dWord), dErr, h('div', { class: 'field' }, go));
      f.addEventListener('submit', async (e) => {
        e.preventDefault(); dErr.textContent = '';
        if (!window.confirm('Delete your account in 3 days? Your coins, points, levels and messages will be removed for good.')) return;
        go.disabled = true;
        try { const r = await api('/me/delete', { method: 'POST', body: { password: dPw.value, confirm: dWord.value } }); me = r.user; NS.toast('Deletion scheduled'); drawDelete(); }
        catch (ex) { dErr.textContent = ex.message; }
        go.disabled = false;
      });
      dBox.append(f);
    };
    drawDelete();
    const dForm = h('div', {},
      h('h3', {}, 'Delete my account'),
      h('p', { class: 'muted' }, 'Your account is deleted 3 days after you ask, and you can cancel before then. Your coins, points, levels, messages and picture are removed and cannot be brought back. If you are in a race that has not ended, deletion waits until it ends.'),
      dBox);
    const pErr = h('div', { class: 'error', role: 'alert' });
    const pNote = h('div', { class: 'lg-note', role: 'status' });
    const cur = h('input', { type: 'password', id: 'acc-cur', autocomplete: 'current-password', maxlength: '72' });
    const nxt = h('input', { type: 'password', id: 'acc-new', autocomplete: 'new-password', maxlength: '72' });
    const pBtn = h('button', { class: 'btn block', type: 'submit' }, 'Change password');
    const pForm = h('form', { novalidate: true },
      h('h3', {}, 'Password'),
      h('div', { class: 'field' }, h('label', { for: 'acc-cur' }, 'Current password'), pwWrap(cur)),
      h('div', { class: 'field' }, h('label', { for: 'acc-new' }, 'New password (6 or more characters)'), pwWrap(nxt)),
      pErr, pNote, h('div', { class: 'field' }, pBtn));
    pForm.addEventListener('submit', async (e) => {
      e.preventDefault(); pErr.textContent = ''; pNote.textContent = ''; pBtn.disabled = true;
      try {
        await api('/me/password', { method: 'POST', body: { current: cur.value, next: nxt.value } });
        cur.value = ''; nxt.value = ''; pNote.textContent = 'Password changed. Other devices were logged out.';
      } catch (ex) { pErr.textContent = ex.message; }
      pBtn.disabled = false;
    });
    return h('div', { class: 'card' }, eForm, h('hr', { class: 'acc-hr' }), pForm,
      h('hr', { class: 'acc-hr' }), rForm,
      h('hr', { class: 'acc-hr' }), dForm,
      h('hr', { class: 'acc-hr' }), legalLinks('legal-links'));
  }

  // About / Privacy / Disclaimer links (separate pages)
  function legalLinks(cls) {
    return h('nav', { class: cls || 'legal-links', 'aria-label': 'About and legal' },
      h('a', { href: '/about' }, 'About us'), h('a', { href: '/privacy' }, 'Privacy Policy'), h('a', { href: '/disclaimer' }, 'Disclaimer'), h('a', { href: '/delete-account' }, 'Delete account'));
  }

  // The page the "confirm deletion" email opens.
  async function renderDeleteConfirm(token) {
    NS.cleanup();
    app.textContent = '';
    document.body.classList.add('is-auth');
    const msg = h('p', { class: 'lg-note', role: 'status' }, 'Confirming...');
    app.append(h('div', { class: 'lg' }, h('form', { class: 'lg-sheet', novalidate: true }, h('h2', { class: 'lg-h2' }, 'Delete account'), msg,
      h('a', { class: 'btn block lg-go', href: '#/' }, 'Go to the game'))));
    try {
      const r = await api('/auth/delete-confirm', { method: 'POST', body: { token } });
      msg.textContent = `Done. The account ${r.username} will be deleted on ${r.when}. To keep it, log in before then and tap "Cancel deletion".`;
    } catch (e) { msg.className = 'error'; msg.textContent = e.message; }
  }

  // The page the confirmation email opens: it confirms the email and says so.
  async function renderVerify(token) {
    NS.cleanup();
    app.textContent = '';
    document.body.classList.add('is-auth');
    const msg = h('p', { class: 'lg-note', role: 'status' }, 'Confirming your email...');
    app.append(h('div', { class: 'lg' }, h('form', { class: 'lg-sheet', novalidate: true }, h('h2', { class: 'lg-h2' }, 'Email confirmation'), msg,
      h('a', { class: 'btn block lg-go', href: '#/' }, 'Go to the game'))));
    try {
      await api('/auth/verify', { method: 'POST', body: { token } });
      msg.textContent = 'Your email is confirmed. Weekly prizes and invite coins are now unlocked.';
      if (me) me.emailPending = false;
    } catch (e) { msg.className = 'error'; msg.textContent = e.message; }
  }

  // The page a reset email opens: choose a new password
  function renderReset(token) {
    NS.cleanup();
    app.textContent = '';
    document.body.classList.add('is-auth');
    const err = h('div', { class: 'error', role: 'alert' });
    const p1 = h('input', { type: 'password', id: 'np1', autocomplete: 'new-password', maxlength: '72', placeholder: 'New password (6 or more characters)' });
    const p2 = h('input', { type: 'password', id: 'np2', autocomplete: 'new-password', maxlength: '72', placeholder: 'Type it again' });
    const go2 = h('button', { class: 'btn block lg-go', type: 'submit' }, 'Save new password');
    const form = h('form', { class: 'lg-sheet', novalidate: true },
      h('h2', { class: 'lg-h2' }, 'Choose a new password'),
      h('div', { class: 'lg-field' }, h('label', { for: 'np1', class: 'lg-sr' }, 'New password'), pwWrap(p1)),
      h('div', { class: 'lg-field' }, h('label', { for: 'np2', class: 'lg-sr' }, 'New password again'), pwWrap(p2)),
      err, go2, h('a', { class: 'linkbtn lg-forgot', href: '#/' }, 'Back to log in'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      if (p1.value !== p2.value) { err.textContent = 'The two passwords are not the same.'; return; }
      go2.disabled = true;
      try {
        const r = await api('/auth/reset', { method: 'POST', body: { token, password: p1.value } });
        me = r.user;
        NS.toast('Password changed. You are logged in.');
        go('#/');
      } catch (ex) { err.textContent = ex.message; }
      go2.disabled = false;
    });
    app.append(h('div', { class: 'lg lg-solo' }, h('div', { class: 'lg-side lg-center' }, form, legalLinks('lg-legal'))));
  }

  // Players who joined before the 18+ box must confirm it once (and can add an email so they can recover their account).
  function adultGate() {
    if (document.querySelector('.age-gate')) return;
    const err = h('div', { class: 'error', role: 'alert' });
    const box = h('input', { type: 'checkbox', id: 'gate-adult' });
    const em = h('input', { type: 'email', id: 'gate-email', autocomplete: 'email', maxlength: '120', placeholder: 'Your email (to recover your account)' });
    const btn = h('button', { class: 'btn block', type: 'submit' }, 'Continue');
    const form = h('form', { novalidate: true },
      h('h2', {}, 'Before you continue'),
      h('p', {}, 'PixSabi is for players aged 18 and above. Please confirm, and add an email so you can get back in if you forget your password.'),
      h('div', { class: 'field' }, h('label', { for: 'gate-email' }, 'Email'), em),
      h('div', { class: 'lg-age' }, box, h('label', { for: 'gate-adult' }, 'I confirm that I am 18 years or older and I accept the ',
        h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Privacy Policy'), ' and ',
        h('a', { href: '/disclaimer', target: '_blank', rel: 'noopener' }, 'Disclaimer'), '.')),
      err, h('div', { class: 'field' }, btn),
      h('button', { class: 'linkbtn', type: 'button', onclick: async () => { try { await api('/auth/logout', { method: 'POST' }); clearPics(); } catch { /* ignore */ } me = null; location.hash = '#/'; route(); } }, 'I am under 18 (log out)'));
    form.addEventListener('submit', async (e) => {
      e.preventDefault(); err.textContent = '';
      if (!box.checked) { err.textContent = 'Tick the box to confirm you are 18 or older.'; return; }
      btn.disabled = true;
      try {
        const r = await api('/me/adult', { method: 'POST', body: { adult: true, email: em.value.trim() } });
        me = r.user;
        document.querySelectorAll('.age-gate').forEach((n) => n.remove());
        route();
      } catch (ex) { err.textContent = ex.message; }
      btn.disabled = false;
    });
    const overlay = h('div', { class: 'age-gate', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'card dialog' }, form));
    document.body.append(overlay);
  }

  function renderAuth() {
    NS.cleanup();
    app.textContent = '';
    Object.assign(alerts, { unread: 0, lastId: 0, first: true, push: false });
    document.body.classList.add('is-auth'); // wide, ad-free layout for the login page (removed again by shell())
    let mode = 'login';
    const err = h('div', { class: 'error', role: 'alert' });
    const icon = (paths) => {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('width', '20'); svg.setAttribute('height', '20');
      svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round'); svg.setAttribute('aria-hidden', 'true');
      svg.setAttribute('class', 'lg-ico');
      for (const d of paths) { const el = document.createElementNS('http://www.w3.org/2000/svg', d.t); for (const [k, v] of Object.entries(d.a)) el.setAttribute(k, v); svg.append(el); }
      return svg;
    };
    const user = h('input', { type: 'text', id: 'u', autocomplete: 'username', autocapitalize: 'none', maxlength: '20', placeholder: 'Username' });
    const email = h('input', { type: 'email', id: 'em', autocomplete: 'email', autocapitalize: 'none', maxlength: '120', placeholder: 'Email (to recover your account)' });
    const pass = h('input', { type: 'password', id: 'p', autocomplete: 'current-password', maxlength: '72', placeholder: 'Password' });
    const adult = h('input', { type: 'checkbox', id: 'adult' });
    const submit = h('button', { class: 'btn block lg-go', type: 'submit' }, 'Log in');
    const tabLogin = h('button', { class: 'lg-tab', type: 'button', role: 'tab', 'aria-selected': 'true' }, 'Log in');
    const tabReg = h('button', { class: 'lg-tab', type: 'button', role: 'tab', 'aria-selected': 'false' }, 'Create account');
    const note = h('div', { class: 'lg-note', role: 'status' });
    const ageRow = h('div', { class: 'lg-age hidden' }, adult,
      h('label', { for: 'adult' }, 'I confirm that I am 18 years or older and I accept the ',
        h('a', { href: '/privacy', target: '_blank', rel: 'noopener' }, 'Privacy Policy'), ' and ',
        h('a', { href: '/disclaimer', target: '_blank', rel: 'noopener' }, 'Disclaimer'), '.'));
    const regQ = h('select', { id: 'rq', 'aria-label': 'Recovery question' }, h('option', { value: '' }, 'Pick a question'));
    const regA = h('input', { type: 'text', id: 'ra', maxlength: '60', autocomplete: 'off', placeholder: 'Your answer' });
    api('/recovery/questions').then((r) => { for (const x of r.questions) regQ.append(h('option', { value: x.id }, x.text)); }).catch(() => {});
    const recRow = h('details', { class: 'lg-rec hidden' }, h('summary', {}, 'Add a recovery question (optional)'),
      h('p', { class: 'lg-note' }, 'Helps you get back in if you ever lose access to your email. Only you should know the answer.'), regQ, regA);
    const forgotLink = h('button', { class: 'linkbtn lg-forgot', type: 'button' }, 'Forgot your password?');
    const backLink = h('button', { class: 'linkbtn lg-forgot hidden', type: 'button' }, 'Back to log in');
    const userField = h('div', { class: 'lg-field' }, h('label', { for: 'u', class: 'lg-sr' }, 'Username'),
      icon([{ t: 'circle', a: { cx: '12', cy: '8', r: '4' } }, { t: 'path', a: { d: 'M4 21c0-4 4-6 8-6s8 2 8 6' } }]), user);
    const emailField = h('div', { class: 'lg-field hidden' }, h('label', { for: 'em', class: 'lg-sr' }, 'Email'),
      icon([{ t: 'rect', a: { x: '3', y: '5', width: '18', height: '14', rx: '2' } }, { t: 'path', a: { d: 'M3 7l9 6 9-6' } }]), email);
    // The padlock is a button: tap it to see the password you typed (open padlock), tap again to hide it.
    const lockShut = [{ t: 'rect', a: { x: '5', y: '11', width: '14', height: '10', rx: '2' } }, { t: 'path', a: { d: 'M8 11V8a4 4 0 0 1 8 0v3' } }];
    const lockOpen = [{ t: 'rect', a: { x: '5', y: '11', width: '14', height: '10', rx: '2' } }, { t: 'path', a: { d: 'M8 11V8a4 4 0 0 1 7.6-1.7' } }];
    const peek = h('button', { class: 'lg-peek', type: 'button', 'aria-label': 'Show password', 'aria-pressed': 'false', title: 'Show password' }, icon(lockShut));
    peek.addEventListener('click', () => {
      const show = pass.type === 'password';
      pass.type = show ? 'text' : 'password';
      peek.replaceChildren(icon(show ? lockOpen : lockShut));
      peek.setAttribute('aria-pressed', show ? 'true' : 'false');
      const label = show ? 'Hide password' : 'Show password';
      peek.setAttribute('aria-label', label); peek.title = label;
      pass.focus();
    });
    const passField = h('div', { class: 'lg-field' }, h('label', { for: 'p', class: 'lg-sr' }, 'Password'), peek, pass);
    const tabs = h('div', { class: 'lg-tabs', role: 'tablist' }, tabLogin, tabReg);
    // Cloudflare "I am human" check on sign-up (only when the owner has switched it on)
    const cfBox = h('div', { class: 'lg-cf hidden' });
    let cfToken = '', cfId = null, cfKey = null;
    const cfShow = () => {
      const on = !!cfKey && mode === 'register';
      cfBox.classList.toggle('hidden', !on);
      if (!on || cfId != null || !window.turnstile) return;
      cfId = window.turnstile.render(cfBox, { sitekey: cfKey, callback: (t) => { cfToken = t; }, 'expired-callback': () => { cfToken = ''; }, 'error-callback': () => { cfToken = ''; } });
    };
    const cfLoad = (key) => {
      cfKey = key;
      if (window.turnstile) return cfShow();
      const sc = document.createElement('script');
      sc.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      sc.async = true; sc.onload = cfShow;
      document.head.append(sc);
    };
    // modes: login, register, forgot (a reset link is emailed)
    const setMode = (m) => {
      mode = m; err.textContent = ''; note.textContent = '';
      tabLogin.setAttribute('aria-selected', m === 'login');
      tabReg.setAttribute('aria-selected', m === 'register');
      tabs.classList.toggle('hidden', m === 'forgot');
      emailField.classList.toggle('hidden', m !== 'register');
      ageRow.classList.toggle('hidden', m !== 'register');
      recRow.classList.toggle('hidden', m !== 'register');
      cfShow();
      passField.classList.toggle('hidden', m === 'forgot');
      forgotLink.classList.toggle('hidden', m !== 'login');
      backLink.classList.toggle('hidden', m !== 'forgot');
      submit.textContent = m === 'login' ? 'Log in' : m === 'register' ? 'Create account and play' : 'Send me a reset link';
      user.placeholder = m === 'forgot' ? 'Username or email' : 'Username';
      user.maxLength = m === 'forgot' ? 120 : 20;
      pass.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    };
    tabLogin.addEventListener('click', () => setMode('login'));
    tabReg.addEventListener('click', () => setMode('register'));
    forgotLink.addEventListener('click', () => setMode('forgot'));
    backLink.addEventListener('click', () => setMode('login'));

    const form = h('form', { class: 'lg-sheet', novalidate: true },
      tabs, userField, emailField, passField, recRow, ageRow, cfBox, err, note, submit, forgotLink, backLink);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      err.textContent = ''; note.textContent = ''; submit.disabled = true;
      try {
        if (mode === 'forgot') {
          const r = await api('/auth/forgot', { method: 'POST', body: { who: user.value } });
          note.textContent = r.message;
        } else {
          const body = { username: user.value, password: pass.value };
          if (mode === 'register') Object.assign(body, { email: email.value, adult: adult.checked, ref: savedRef(), cfToken, recoveryQ: regQ.value, recoveryA: regA.value });
          const r = await api(`/auth/${mode}`, { method: 'POST', body });
          me = r.user;
          const after = sessionStorage.getItem('ns_after');
          sessionStorage.removeItem('ns_after');
          if (after) go(after); else route();
        }
      } catch (ex) { err.textContent = ex.message; if (cfId != null && window.turnstile) { cfToken = ''; try { window.turnstile.reset(cfId); } catch { /* ignore */ } } }
      submit.disabled = false;
    });

    const authLive = h('p', { class: 'lg-live' }, ' ');
    const bgLayer = h('div', { class: 'lg-bg', 'aria-hidden': 'true' });
    app.append(h('div', { class: 'lg' }, bgLayer,
      h('section', { class: 'lg-hero' },
        h('div', { class: 'lg-brand' }, h('span', { class: 'orn', 'aria-hidden': 'true' }, '✦'), 'PIXSABI'),
        h('h1', { class: 'lg-title' }, h('span', {}, 'You think say'), h('b', {}, 'you sabi?')),
        h('p', { class: 'lg-sub' }, 'Play. Learn. Sabi.')),
      h('div', { class: 'lg-side' }, form, authLive, legalLinks('lg-legal')),
      h('div', { class: 'lg-stripe', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))));
    // blurred sliding pictures behind the login screen (set by the admin; none = plain green design)
    fetch('/api/loginbg').then((r) => r.json()).then((r) => {
      const pics = (r && r.pictures) || [];
      if (!pics.length || !bgLayer.isConnected) return;
      document.querySelector('.lg').classList.add('has-bg');
      const slides = pics.map((p) => { const d = h('div', { class: 'lg-slide' }); d.style.backgroundImage = `url("${p.image}")`; bgLayer.append(d); return d; });
      let i = 0; slides[0].classList.add('on');
      if (slides.length < 2 || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      const timer = setInterval(() => {
        if (!bgLayer.isConnected) return clearInterval(timer);
        if (document.hidden) return;
        slides[i].classList.remove('on'); i = (i + 1) % slides.length; slides[i].classList.add('on');
      }, 6000);
    }).catch(() => {});
    fetch('/api/stats').then((r) => r.json()).then((r) => {
      if (!r || r.players == null) return;
      authLive.textContent = `👥 ${fmt(r.players)} players`;
      if (r.turnstile) cfLoad(r.turnstile);
    }).catch(() => {});
  }

  // Confetti for a win: a few seconds of coloured paper over everything. Skipped for people who ask for less motion.
  function confetti(ms) {
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
    cv.width = innerWidth; cv.height = innerHeight;
    document.body.append(cv);
    const ctx = cv.getContext('2d');
    const colors = ['#f5c542', '#2fb85f', '#ffffff', '#e8453c', '#3aa0ff', '#ff8ad8'];
    const bits = Array.from({ length: 140 }, () => ({
      x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.6, w: 6 + Math.random() * 6, h: 8 + Math.random() * 8,
      vx: -1.5 + Math.random() * 3, vy: 2 + Math.random() * 4, r: Math.random() * 6, vr: -0.2 + Math.random() * 0.4, c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    (function tick(now) {
      const age = now - t0;
      ctx.clearRect(0, 0, cv.width, cv.height);
      ctx.globalAlpha = age > ms - 1200 ? Math.max(0, (ms - age) / 1200) : 1;
      for (const b of bits) {
        b.x += b.vx; b.y += b.vy; b.r += b.vr;
        if (b.y > cv.height + 20 && age < ms - 1500) { b.y = -20; b.x = Math.random() * cv.width; }
        ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h); ctx.restore();
      }
      if (age < ms) requestAnimationFrame(tick); else cv.remove();
    })(t0);
  }

  // ---------- result dialog ----------
  function resultDialog({ title, answer, fact, factLocked, extra, button, onNext, secondary, label, rewards, chest, share, picture }) {
    const parts = [];
    if (label) parts.push(h('div', { class: 'win-label' }, label));
    else parts.push(h('h2', {}, title));
    // The finished picture stays on show, with confetti, for as long as the player wants to enjoy it.
    if (picture) { parts.push(h('img', { class: 'win-pic', src: picture, alt: answer || 'The finished picture' })); confetti(7000); }
    parts.push(h('div', { class: 'answer-word' }, answer));
    if (rewards) {
      parts.push(h('div', { class: 'win-tiles' }, rewards.map((r) => h('div', { class: 'win-tile' }, h('b', {}, r.coin ? coinIcon(22) : null, r.big), h('span', {}, r.small)))));
    } else if (extra) parts.push(h('p', {}, extra));
    if (chest) {
      parts.push(h('div', { class: 'win-chest' },
        chestIcon(40),
        h('div', { class: 'grow' },
          h('b', {}, chest.opened ? ['Chest opened! +' + chest.opened + ' bonus ', coinIcon(16), ' coins'] : `Treasure chest at level ${chest.level}`),
          h('div', { class: 'win-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(chest.every), 'aria-valuenow': String(chest.every - chest.toGo) },
            (() => { const f = h('div', { class: 'win-fill' }); f.style.width = Math.round(((chest.every - chest.toGo) / chest.every) * 100) + '%'; return f; })()),
          h('span', { class: 'muted' }, `${chest.toGo} more level${chest.toGo === 1 ? '' : 's'} to the next chest`))));
    }
    if (fact) parts.push(h('div', { class: 'fact' }, fact));
    else if (factLocked) parts.push(h('a', { class: 'fact fact-locked', href: '#/premium' }, '🔒 There is a fun fact here. Fun facts are for Premium members. Tap to see Premium.'));
    const close = showDialog(h('div', { class: label ? 'win' : '' }, parts, [
      h('div', { class: 'row' },
        h('button', { class: 'btn grow', type: 'button', onclick: () => { close(); if (window.NS_refreshAds) window.NS_refreshAds(); onNext(); } }, button),
        secondary ? h('button', { class: 'btn alt grow', type: 'button', onclick: () => { close(); secondary.fn(); } }, secondary.label) : null),
      share ? h('a', { class: 'btn wa block', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(share) },
        S('svg', { viewBox: '0 0 24 24', width: '20', height: '20', 'aria-hidden': 'true' },
          S('path', { d: 'M4 20l1.4-4.6A8 8 0 1 1 8.6 18.6z', fill: 'none', stroke: '#fff', 'stroke-width': '2', 'stroke-linejoin': 'round' }),
          S('path', { d: 'M9 8.5c0 3.5 3 6.5 6.5 6.5l1-1.5-2-1-1 .8c-1-.4-2-1.4-2.4-2.4l.8-1-1-2z', fill: '#fff' })),
        'Share my score on WhatsApp') : null,
    ]));
  }

  // ---------- buy coins (Paystack) ----------
  const naira = (n) => '\u20A6' + Number(n).toLocaleString('en-NG');
  function savedEmail() { try { return localStorage.getItem('ns_email') || ''; } catch { return ''; } }
  function rememberEmail(v) { try { localStorage.setItem('ns_email', v); } catch { /* private mode: fine */ } }
  async function buyCoins() {
    let info;
    try { info = await api('/coins/packs'); } catch (e) { NS.toast(e.message, true); return; }
    let close = () => {};
    if (!info.enabled) {
      close = showDialog([
        h('h2', {}, 'Buy coins'),
        h('p', {}, 'Buying coins is not open yet. Please check back soon.'),
        h('button', { class: 'btn block', type: 'button', onclick: () => close() }, 'OK'),
      ]);
      return;
    }
    let chosen = info.packs[1] ? info.packs[1].id : info.packs[0].id;
    const buttons = info.packs.map((p) => {
      const b = h('button', { class: 'pack', type: 'button', 'aria-pressed': String(p.id === chosen) },
        h('span', { class: 'pack-coins' }, coinIcon(20), p.coins.toLocaleString('en-NG')),
        h('span', { class: 'pack-price' }, naira(p.price)));
      b.addEventListener('click', () => { chosen = p.id; buttons.forEach((x) => x.setAttribute('aria-pressed', String(x === b))); });
      return b;
    });
    const email = h('input', { type: 'email', id: 'pay-email', autocomplete: 'email', placeholder: 'you@example.com', maxlength: '254' });
    email.value = savedEmail();
    const err = h('div', { class: 'error', role: 'alert' });
    const pay = h('button', { class: 'btn block', type: 'button' }, 'Pay with Paystack');
    pay.addEventListener('click', async () => {
      err.textContent = ''; pay.disabled = true;
      try {
        rememberEmail(email.value.trim());
        const r = await api('/coins/buy', { method: 'POST', body: { pack: chosen, email: email.value } });
        pay.textContent = 'Opening Paystack...';
        location.href = r.url;                       // Paystack's own secure payment page
      } catch (e) { err.textContent = e.message; pay.disabled = false; }
    });
    close = showDialog([
      h('h2', {}, 'Buy coins'),
      h('p', { class: 'muted' }, 'Coins pay for hints and skips. Pay safely with your card, bank transfer or USSD on Paystack.'),
      h('div', { class: 'packs' }, buttons),
      h('label', { for: 'pay-email' }, 'Your email (for the receipt)'), email, err,
      h('div', { class: 'field' }, pay),
      h('button', { class: 'btn alt block', type: 'button', onclick: () => close() }, 'Not now'),
    ]);
  }
  NS.buyCoins = buyCoins;
  // Paystack sends the player back to /?paid=... : say what happened, then tidy the address bar.
  async function payNote() {
    const qs = new URLSearchParams(location.search);
    const paid = qs.get('paid'), forPremium = qs.get('for') === 'premium';
    if (!paid) return;
    try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* ignore */ }
    const say = {
      paid: [forPremium ? 'Payment received. You are now a Premium member!' : 'Payment received. Your coins are added!', false],
      pending: [forPremium ? 'We are still confirming your payment. Your Premium will start shortly.' : 'We are still confirming your payment. Your coins will show up shortly.', false],
      failed: ['The payment did not go through. You were not charged.', true],
      cancelled: ['Payment cancelled. You were not charged.', false],
    }[paid] || ['We could not find that payment. If you were charged, contact the game owner.', true];
    NS.toast(say[0], say[1]);
    await refreshMe();
  }


  // ---------- Premium ----------
  // A small gold crown beside the name of a premium member.
  function premiumMark() {
    return h('span', { class: 'prem-mark', title: 'Premium member', role: 'img', 'aria-label': 'Premium member' },
      S('svg', { viewBox: '0 0 24 18', width: '16', height: '12', 'aria-hidden': 'true' },
        S('path', { d: 'M2 15l-1-11 6 5 5-8 5 8 6-5-1 11z', fill: '#f5c542', stroke: '#b9861a', 'stroke-width': '1.2', 'stroke-linejoin': 'round' })));
  }
  async function viewPremium() {
    const main = shell('me');
    main.classList.add('stack');
    main.append(spinner());
    try {
      const r = await api('/premium');
      main.textContent = '';
      const ends = r.until ? new Date(r.until).toLocaleDateString('en-NG', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
      const email = h('input', { type: 'email', id: 'prem-email', autocomplete: 'email', placeholder: 'you@example.com', maxlength: '254' });
      email.value = r.email || savedEmail();
      const err = h('div', { class: 'error', role: 'alert' });
      const pay = h('button', { class: 'btn block big-play', type: 'button' }, r.premium ? `Add ${r.days} more days for ${naira(r.price)}` : `Go Premium for ${naira(r.price)}`);
      pay.addEventListener('click', async () => {
        err.textContent = ''; pay.disabled = true;
        try {
          rememberEmail(email.value.trim());
          const x = await api('/premium/buy', { method: 'POST', body: { email: email.value } });
          pay.textContent = 'Opening Paystack...';
          location.href = x.url;
        } catch (e) { err.textContent = e.message; pay.disabled = false; }
      });
      main.append(
        h('div', { class: 'card center stack prem-card' },
          h('div', { class: 'prem-crown' }, premiumMark()),
          h('h2', {}, 'PixSabi Premium'),
          r.premium
            ? h('p', { class: 'prem-status' }, `You are a Premium member. Your Premium ends on ${ends} (${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left).`)
            : h('p', { class: 'muted' }, `${naira(r.price)} for ${r.days} days. Pay again when it ends.`),
          h('ul', { class: 'prem-list' },
            h('li', {}, '🚫 No pop-up adverts'),
            h('li', {}, '💡 Fun facts after every level'),
            h('li', {}, '👑 A gold crown beside your name in chat and on your profile')),
          r.premium && r.daysLeft <= 3 ? h('p', { class: 'error' }, 'Your Premium ends soon. Add more days so you do not lose it.') : null,
          r.enabled ? h('div', { class: 'stack' }, h('label', { for: 'prem-email' }, 'Your email (for the receipt)'), email, err, pay) : h('p', { class: 'muted' }, 'Premium is not open for payment yet. Please check back soon.'),
          h('p', { class: 'muted' }, `Premium lasts ${r.days} days from the day you pay. It does not renew by itself and you are never charged again unless you pay again. Adding days early adds ${r.days} days to what is left. Payments are made safely on Paystack.`),
          h('a', { class: 'btn alt block', href: '#/me' }, 'Back to my profile')));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, viewPremium)); }
  }

  // ---------- solo ----------
  const worldIcon = (name) => (name === 'Universal' ? '🌍' : '🇳🇬');
  let soloCategory = 'Naija';
  const WS_TAB = 'Word Search';
  const SL_TAB = 'Slide Puzzle';
  try { const w = localStorage.getItem('ns_world'); if (w === 'Universal' || w === WS_TAB || w === SL_TAB) soloCategory = w; } catch { /* private mode */ }
  // The top of a game screen: just the name of the game being played, next to the level.
  const gameBar = (name, level) => h('div', { class: 'row between solo-bar' },
    h('span', { class: 'game-name' }, name),
    h('span', { class: 'round-pill' }, level));
  async function viewPlay() {
    if (soloCategory === WS_TAB) return viewWordSearch();
    if (soloCategory === SL_TAB) return viewSlide();
    const main = shell('solo');
    main.append(spinner());
    try {
      const r = await api(`/solo/next?category=${encodeURIComponent(soloCategory)}`);
      setStats(r);
      main.textContent = '';
      // Two categories, and anybody can switch between them at any time. Each has its own levels.
      main.append(gameBar(`${worldIcon(soloCategory)} ${soloCategory}`, r.done && !r.empty && r.solvedCount >= r.total ? 'All levels done' : `Level ${r.solvedCount + 1}`));

      if (r.done) {
        main.append(h('div', { class: 'card center stack' },
          h('h2', {}, r.empty ? `${soloCategory} puzzles are coming soon` : `You finished ${soloCategory}!`),
          h('p', {}, r.empty ? 'There are no puzzles here yet. Check back soon, or pick another game from Home.' : 'Wahala for who no sabi. Pick another game from Home, or challenge a friend.'),
          h('a', { class: 'btn', href: '#/challenges' }, 'Challenge a friend')));
        return;
      }
      const p = r.puzzle;
      const holder = h('div');
      main.append(h('div', { class: 'card' }, holder));
      NS.mountGame(holder, p, {
        onGuess: (guess) => api('/solo/guess', { method: 'POST', body: { id: p.id, guess } }),
        hints: {
          letterCost: 15, clueCost: 5,
          letter: async () => { const x = await api('/solo/hint', { method: 'POST', body: { id: p.id, type: 'letter' } }); setStats(x); return x; },
          clue: async () => { const x = await api('/solo/hint', { method: 'POST', body: { id: p.id, type: 'clue' } }); setStats(x); return x; },
        },
        skipCost: 20,
        onSkip: async () => {
          try {
            const x = await api('/solo/skip', { method: 'POST', body: { id: p.id, category: soloCategory } });
            setStats(x);
            viewPlay();
          } catch (e) { NS.toast(e.message, true); if (e.status === 402) buyCoins(); }
        },
        onCorrect: (x) => {
          setStats(x);
          if (x.inviteBonus) NS.toast(`Invite bonus! You got ${x.inviteBonus} coins for joining through a friend.`);
          const world = x.category || soloCategory;
          resultDialog({
            label: `${world.toUpperCase()} LEVEL ${x.solvedCount} COMPLETE`, answer: x.answer, fact: x.fact, factLocked: x.factLocked,
            rewards: [
              { big: '+' + x.earned, small: 'points' },
              { big: '+' + (x.coins_earned || 10), small: 'coins', coin: true },
              { big: String(x.solvedCount), small: 'levels done' },
            ],
            chest: { opened: x.chest.opened, every: x.chest.every, toGo: x.chest.toGo, level: x.solvedCount + x.chest.toGo },
            share: `I just finished ${world} level ${x.solvedCount} on PixSabi! Can you beat me? ${location.origin}`,
            button: 'Next level',
            // every Nth solved level (set on the admin page) a pop-up advert shows before the next puzzle
            onNext: () => NS.afterSolve(x.solvedCount, () => viewPlay()),
          });
        },
      });
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewPlay())); }
  }


  // ---------- Word Search ----------
  // The card on the home screen: a peek at the grid and a big Play button.
  function wsHomeCard(r) {
    if (r.done) {
      return h('div', { class: 'card center stack' },
        h('h2', {}, r.empty ? 'Word Search is coming soon' : 'You finished every word search!'),
        h('p', {}, r.empty ? 'There are no word searches yet. Check back soon.' : 'Wahala for who no sabi. New ones are added from time to time. Try Naija or Universal meanwhile.'));
    }
    const p = r.puzzle;
    const cols = Math.min(8, p.size), rows = Math.min(5, p.size);
    const peek = h('div', { class: 'ws-peek', 'aria-hidden': 'true' });
    peek.style.gridTemplateColumns = `repeat(${cols}, minmax(0, 1fr))`;
    for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) peek.append(h('div', { class: 'ws-peek-cell' }, p.rows[i][j]));
    return h('div', { class: 'stack' },
      h('div', { class: 'card ws-home' },
        h('div', { class: 'row between' },
          h('div', {}, h('div', { class: 'ws-home-title' }, `Word Search ${p.level}`), h('div', { class: 'muted' }, p.theme ? `Theme: ${p.theme}` : 'Find the hidden words')),
          h('span', { class: 'ws-count' }, `${p.words.length} words`)),
        peek,
        h('p', { class: 'muted center' }, 'Words hide across, down and slanted. Drag your finger over a word to find it.')),
      h('a', { class: 'btn block big-play', href: '#/play' }, `Play Word Search ${p.level}`));
  }

  // The grid, the word list and dragging. Used by the solo Word Search and by Word Search races.
  // o.select(r1, c1, r2, c2) asks the server about a dragged line and resolves with its answer.
  // o.onResult(x) runs after a found word is marked; o.onError(e) when the server refuses.
  // The clock shown on word search / sliding puzzle boards. It carries on from the time already spent (p.secs), stops while the
  // page is hidden, and tells the server how far it got when the player leaves, so coming back does not start from 0:00.
  function playClock(p, stamp, saveUrl) {
    let t0 = Date.now() - (Number(p.secs) || 0) * 1000, hiddenAt = 0;
    const elapsed = () => Math.max(0, Math.round(((hiddenAt || Date.now()) - t0) / 1000));
    const fmt = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
    const tick = setInterval(() => { if (!stamp.isConnected) { clearInterval(tick); return; } if (!hiddenAt) stamp.textContent = '\u23F1 ' + fmt(elapsed()); }, 1000);
    stamp.textContent = '\u23F1 ' + fmt(elapsed());
    const remember = () => {
      if (!saveUrl) return;
      try { fetch(saveUrl, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: p.id, secs: elapsed() }) }); } catch (e) { /* the next move saves it too */ }
    };
    const onVis = () => {
      if (!stamp.isConnected) { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('pagehide', onHide); return; }
      if (document.hidden) { if (!hiddenAt) { hiddenAt = Date.now(); remember(); } }
      else if (hiddenAt) { t0 += Date.now() - hiddenAt; hiddenAt = 0; }
    };
    const onHide = () => { if (!hiddenAt) remember(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('pagehide', onHide);
    return { elapsed, fmt };
  }

  function wsBoard(p, o) {
    const N = p.size;
    const cells = [];
    const found = new Map();      // word -> list of cell indexes
    const colorOf = (i) => 'f' + (i % 6);
    const grid = h('div', { class: 'ws-grid', role: 'group', 'aria-label': `Word search grid, ${N} by ${N} letters` });
    grid.style.gridTemplateColumns = `repeat(${N}, minmax(0, 1fr))`;
    grid.style.setProperty('--ws-font', (N <= 8 ? 1.5 : N <= 9 ? 1.35 : N <= 10 ? 1.2 : N <= 11 ? 1.1 : 1) + 'rem');
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const c = h('div', { class: 'ws-cell', 'data-r': String(i), 'data-c': String(j) }, p.rows[i][j]);
      cells.push(c); grid.append(c);
    }
    const at = (i, j) => cells[i * N + j];
    const chips = new Map();
    const left = h('span', { class: 'ws-left' });
    const stamp = h('span', { class: 'ws-timer' });
    const paintLeft = () => { left.textContent = `${found.size} of ${p.words.length} found`; };
    const lineCells = (r0, c0, dr, dc, len) => { const out = []; for (let k = 0; k < len; k++) out.push([r0 + dr * k, c0 + dc * k]); return out; };
    const board = { grid, left, stamp, busy: false, theme: p.theme };
    board.markFound = (f, quiet) => {
      if (found.has(f.word)) return;
      const idx = found.size;
      const list = lineCells(f.r, f.c, f.dr, f.dc, f.word.length);
      found.set(f.word, list);
      list.forEach(([i, j]) => { const c = at(i, j); c.classList.add('found', colorOf(idx)); c.classList.remove('hint'); });
      const chip = chips.get(f.word); if (chip) chip.classList.add('done');
      paintLeft();
      if (!quiet && NS.sound) NS.sound.play('correct');
    };
    board.markHint = (i, j) => at(i, j).classList.add('hint');
    p.words.forEach((w) => chips.set(w, h('span', { class: 'ws-word' }, w)));
    board.words = h('div', { class: 'ws-words' }, [...chips.values()]);

    // ---- dragging a finger (or the mouse) over letters ----
    let start = null, sel = [];
    const clearSel = () => { sel.forEach(([i, j]) => at(i, j).classList.remove('sel')); sel = []; };
    const cellAt = (x, y) => {
      const e = document.elementFromPoint(x, y);
      return e && e.classList && e.classList.contains('ws-cell') && grid.contains(e) ? [Number(e.dataset.r), Number(e.dataset.c)] : null;
    };
    // snap to the nearest of the 8 straight directions
    const snap = (r0, c0, r1, c1) => {
      let dr = r1 - r0, dc = c1 - c0;
      const ar = Math.abs(dr), ac = Math.abs(dc);
      if (ar * 2 < ac) dr = 0; else if (ac * 2 < ar) dc = 0;
      else { const m = Math.max(ar, ac); dr = Math.sign(dr) * m; dc = Math.sign(dc) * m; }
      const len = Math.max(Math.abs(dr), Math.abs(dc)) + 1;
      let k = len; // keep the line inside the grid
      while (k > 1 && (r0 + Math.sign(dr) * (k - 1) < 0 || r0 + Math.sign(dr) * (k - 1) >= N || c0 + Math.sign(dc) * (k - 1) < 0 || c0 + Math.sign(dc) * (k - 1) >= N)) k--;
      return { dr: Math.sign(dr), dc: Math.sign(dc), len: k };
    };
    grid.addEventListener('pointerdown', (e) => {
      if (board.busy) return;
      const c = cellAt(e.clientX, e.clientY);
      if (!c) return;
      e.preventDefault();
      start = { r: c[0], c: c[1], dr: 0, dc: 0, len: 1 };
      clearSel(); sel = [c]; at(c[0], c[1]).classList.add('sel');
    });
    grid.addEventListener('pointermove', (e) => {
      if (!start) return;
      const c = cellAt(e.clientX, e.clientY);
      if (!c) return;
      const s2 = snap(start.r, start.c, c[0], c[1]);
      clearSel();
      sel = lineCells(start.r, start.c, s2.dr, s2.dc, s2.len);
      sel.forEach(([i, j]) => at(i, j).classList.add('sel'));
      start.dr = s2.dr; start.dc = s2.dc; start.len = s2.len;
    });
    const release = async () => {
      if (!start) return;
      const s0 = start; start = null;
      const line = sel.slice();
      if (s0.len < 2) { clearSel(); return; }
      board.busy = true;
      const [r2, c2] = line[line.length - 1];
      try {
        const x = await o.select(s0.r, s0.c, r2, c2);
        clearSel();
        if (x.found) { board.markFound(x); o.onResult(x); }
        else { line.forEach(([i, j]) => { const c = at(i, j); c.classList.add('miss'); setTimeout(() => c.classList.remove('miss'), 280); }); if (NS.sound) NS.sound.play('wrong'); }
      } catch (e) { clearSel(); o.onError(e); }
      board.busy = false;
    };
    grid.addEventListener('pointerup', release);
    grid.addEventListener('pointercancel', () => { start = null; clearSel(); });
    grid.addEventListener('contextmenu', (e) => e.preventDefault());

    // timer (shown only, the server does not use it for points). Solo play remembers it; races show their own.
    const clk = playClock(p, stamp, o.timeUrl);
    board.elapsed = clk.elapsed; board.fmtTime = clk.fmt;
    p.found.forEach((f) => board.markFound(f, true));
    paintLeft();
    board.bar = h('div', { class: 'ws-bar' }, stamp, left, p.theme ? h('span', { class: 'ws-theme' }, p.theme) : null);
    board.card = h('div', { class: 'card ws-card' }, grid);
    return board;
  }

  async function viewWordSearch() {
    const main = shell('solo');
    main.append(spinner());
    try {
      const r = await api('/ws/state');
      setStats(r);
      main.textContent = '';
      main.append(gameBar('🔎 Word Search', r.done ? 'All levels done' : `Level ${r.puzzle.level}`));
      if (r.done) { main.append(wsHomeCard(r)); return; }
      const p = r.puzzle;
      const onApiError = (e) => {
        NS.toast(e.message, true);
        if (e.status === 402) buyCoins();
        if (e.status === 409) viewWordSearch();
      };
      let board;
      const finish = (x) => {
        setStats(x);
        if (x.inviteBonus) NS.toast(`Invite bonus! You got ${x.inviteBonus} coins for joining through a friend.`);
        const secs = board.elapsed();
        resultDialog({
          label: `WORD SEARCH ${x.level} COMPLETE`, answer: `${x.words.length} of ${x.words.length} found`, fact: x.fact, factLocked: x.factLocked,
          rewards: [
            { big: '+' + x.earned, small: 'points' },
            { big: '+' + x.coins_earned, small: 'coins', coin: true },
            { big: board.fmtTime(secs), small: 'time' },
          ],
          chest: { opened: x.chest.opened, every: x.chest.every, toGo: x.chest.toGo, level: x.level + x.chest.toGo },
          share: `I just finished Word Search level ${x.level} on PixSabi in ${board.fmtTime(secs)}! Can you beat me? ${location.origin}`,
          button: x.allDone ? 'Back to home' : 'Next word search',
          onNext: () => (x.allDone ? (location.hash = '#/') : NS.afterSolve(x.level, () => viewWordSearch())),
        });
      };
      board = wsBoard(p, {
        select: (r1, c1, r2, c2) => api('/ws/select', { method: 'POST', body: { id: p.id, r1, c1, r2, c2, secs: board.elapsed() } }),
        timeUrl: '/api/ws/time',
        onResult: (x) => { setStats(x); if (x.complete) finish(x); },
        onError: onApiError,
      });

      // ---- hints ----
      const hintBtn = (icon, label, cost, run) => {
        const b = h('button', { class: 'hint-btn', type: 'button', 'aria-label': `${label} (${cost} coins)` },
          h('span', { class: 'hint-ico', 'aria-hidden': 'true' }, icon), h('span', { class: 'hint-label' }, label),
          h('span', { class: 'hint-cost' }, coinIcon(12), String(cost)));
        b.addEventListener('click', async () => {
          if (board.busy) return;
          b.disabled = true; board.busy = true;
          try { await run(); } catch (e) { onApiError(e); }
          board.busy = false; b.disabled = false;
        });
        return b;
      };
      const letterBtn = hintBtn('💡', 'Mark a first letter', p.letterCost, async () => {
        const x = await api('/ws/hint', { method: 'POST', body: { id: p.id, type: 'letter' } });
        setStats(x); board.markHint(x.r, x.c);
      });
      const wordBtn = hintBtn('🔎', 'Reveal a word', p.wordCost, async () => {
        const x = await api('/ws/hint', { method: 'POST', body: { id: p.id, type: 'word' } });
        setStats(x); board.markFound(x, true);
        if (x.complete) finish(x);
      });

      p.hinted.forEach(([i, j]) => board.markHint(i, j));
      main.append(
        board.bar, board.card,
        h('p', { class: 'muted center' }, 'Drag your finger over a word. Words run across, down and slanted' + (p.level > 24 ? ', and some run backwards.' : '.')),
        board.words,
        h('div', { class: 'hint-bar' }, letterBtn, wordBtn));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewWordSearch())); }
  }


  // ---------- Sliding puzzle ----------
  // The board: a picture cut into N x N pieces with one gap. Tap (or swipe) a piece next to the gap to slide it.
  // p = { id, title, size, image, board, moves }. o.move(pos) asks the server and resolves with its answer;
  // o.onResult(x) runs when the puzzle is finished; o.onError(e) when the server refuses; o.peek() (optional) is asked before the picture shows.
  function slideBoard(p, o) {
    const N = p.size, total = N * N, gapTile = total - 1, pct = 100 / N;
    let board = p.board.slice(), moves = p.moves || 0, done = false, queue = Promise.resolve(), swipedAt = 0;
    const tiles = new Map();
    const wrap = h('div', { class: 'sl-board', role: 'group', tabindex: '0', 'aria-label': `Sliding puzzle, ${N} by ${N} pieces. Tap a piece next to the gap to slide it. Arrow keys also work.` });
    for (let t = 0; t < gapTile; t++) {
      const el = h('button', { class: 'sl-tile', type: 'button', tabindex: '-1', 'aria-label': `Piece ${t + 1}` });
      el.style.width = pct + '%'; el.style.height = pct + '%';
      el.style.backgroundImage = `url("${p.image}")`;
      el.style.backgroundSize = `${N * 100}% ${N * 100}%`;
      el.style.backgroundPosition = `${N > 1 ? ((t % N) * 100) / (N - 1) : 0}% ${N > 1 ? (Math.floor(t / N) * 100) / (N - 1) : 0}%`;
      tiles.set(t, el); wrap.append(el);
    }
    const movesEl = h('span', { class: 'ws-left' });
    const stamp = h('span', { class: 'ws-timer' });
    const paintMoves = () => { movesEl.textContent = `${moves} slide${moves === 1 ? '' : 's'}`; };
    const render = () => {
      board.forEach((t, pos) => {
        if (t === gapTile) return;
        const el = tiles.get(t);
        el.style.left = (pos % N) * pct + '%'; el.style.top = Math.floor(pos / N) * pct + '%';
        el.dataset.pos = String(pos);
      });
    };
    const api = { busy: false, grid: wrap };
    const tryMove = (pos) => {
      if (done) return;
      const gap = board.indexOf(gapTile);
      const dr = Math.abs(Math.floor(pos / N) - Math.floor(gap / N)), dc = Math.abs((pos % N) - (gap % N));
      if (!(pos >= 0 && pos < total) || dr + dc !== 1) return;
      board[gap] = board[pos]; board[pos] = gapTile;       // show it at once; the server confirms
      moves++; paintMoves(); render();
      queue = queue.then(() => o.move(pos)).then((x) => {
        if (x && x.moved === false && x.board) { board = x.board.slice(); moves = x.moves || moves; paintMoves(); render(); }
        if (x && (x.complete || x.levelDone)) { done = true; wrap.classList.add('solved'); o.onResult(x); }
      }).catch((e) => { o.onError(e); });
    };
    wrap.addEventListener('click', (e) => {
      if (Date.now() - swipedAt < 350) return;
      const el = e.target.closest && e.target.closest('.sl-tile');
      if (el && wrap.contains(el)) tryMove(Number(el.dataset.pos));
    });
    // a swipe on a piece slides it toward the gap
    let down = null;
    wrap.addEventListener('pointerdown', (e) => { const el = e.target.closest && e.target.closest('.sl-tile'); down = el ? { x: e.clientX, y: e.clientY, pos: Number(el.dataset.pos) } : null; });
    wrap.addEventListener('pointerup', (e) => {
      if (!down) return;
      const dx = e.clientX - down.x, dy = e.clientY - down.y, d = down; down = null;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 14) return;
      const gap = board.indexOf(gapTile);
      const horizontal = Math.abs(dx) > Math.abs(dy);
      const want = horizontal ? d.pos + Math.sign(dx) : d.pos + Math.sign(dy) * N;
      if (want === gap && (!horizontal || Math.floor(want / N) === Math.floor(d.pos / N))) { swipedAt = Date.now(); tryMove(d.pos); }
    });
    wrap.addEventListener('pointercancel', () => { down = null; });
    wrap.addEventListener('keydown', (e) => {
      const gap = board.indexOf(gapTile), r = Math.floor(gap / N), c = gap % N;
      const from = { ArrowLeft: c < N - 1 ? gap + 1 : -1, ArrowRight: c > 0 ? gap - 1 : -1, ArrowUp: r < N - 1 ? gap + N : -1, ArrowDown: r > 0 ? gap - N : -1 }[e.key];
      if (from == null) return;
      e.preventDefault();
      if (from >= 0) tryMove(from);
    });
    wrap.addEventListener('contextmenu', (e) => e.preventDefault());
    // the finished picture, shown for a moment
    api.peek = async () => {
      if (o.peek) await o.peek();
      const img = h('img', { class: 'sl-peek', src: p.image, alt: 'The finished picture' });
      wrap.append(img);
      setTimeout(() => img.remove(), 2600);
    };
    const clk = playClock(p, stamp, o.timeUrl);
    api.elapsed = clk.elapsed; api.fmtTime = clk.fmt;
    render(); paintMoves();
    api.bar = h('div', { class: 'ws-bar' }, stamp, movesEl, p.title ? h('span', { class: 'ws-theme' }, p.title) : null);
    api.card = h('div', { class: 'card ws-card' }, wrap);
    api.moves = () => moves;
    return api;
  }

  function slDoneCard(r) {
    return h('div', { class: 'card center stack' },
      h('h2', {}, r.empty ? 'Slide Puzzle is coming soon' : 'You finished every sliding puzzle!'),
      h('p', {}, r.empty ? 'There are no sliding puzzles yet. Check back soon.' : 'Wahala for who no sabi. New pictures are added from time to time. Try another game meanwhile.'));
  }

  // ---------- sliding puzzle: look at the picture first ----------
  const slSeenMem = new Set();
  const slSeen = (id) => { if (slSeenMem.has(id)) return true; try { return localStorage.getItem('ns_slseen_' + id) === '1'; } catch { return false; } };
  const slMarkSeen = (id) => { slSeenMem.add(id); try { localStorage.setItem('ns_slseen_' + id, '1'); } catch { /* storage blocked: fine */ } };
  function slPreview(p, onStart) {
    let left = 10, timer = null;
    const num = h('div', { class: 'sl-count', 'aria-hidden': 'true' }, String(left));
    const live = h('p', { class: 'sr-only', role: 'status' }, 'Memorise the picture. 10 seconds.');
    const img = h('img', { class: 'sl-pre-img', src: p.image, alt: 'The picture to rebuild. Memorise it.' });
    const stage = h('div', { class: 'sl-pre-stage' }, img, num);
    const title = h('p', { class: 'sl-pre-title' }, 'Memorise the picture!');
    const wrap = h('div', { class: 'card sl-pre' }, title, stage, live);
    timer = setInterval(() => {
      if (!wrap.isConnected) { clearInterval(timer); return; }
      left--;
      if (left > 0) { num.textContent = String(left); return; }
      clearInterval(timer);
      stage.classList.add('covered'); num.remove();
      title.textContent = 'Ready?';
      live.textContent = 'Ready? Press Start.';
      const go = h('button', { class: 'btn primary big', type: 'button' }, 'Start');
      go.addEventListener('click', () => { go.disabled = true; onStart(); });
      wrap.append(go); go.focus();
    }, 1000);
    return wrap;
  }

  async function viewSlide() {
    const main = shell('solo');
    main.append(spinner());
    try {
      const r = await api('/sl/state');
      setStats(r);
      main.textContent = '';
      main.append(gameBar('🧩 Slide Puzzle', r.done ? 'All levels done' : `Level ${r.puzzle.level}`));
      if (r.done) { main.append(slDoneCard(r)); return; }
      const p = r.puzzle;
      const onApiError = (e) => {
        NS.toast(e.message, true);
        if (e.status === 402) buyCoins();
        if (e.status === 409) viewSlide();
      };
      let board;
      const finish = (x) => {
        setStats(x);
        if (x.inviteBonus) NS.toast(`Invite bonus! You got ${x.inviteBonus} coins for joining through a friend.`);
        const secs = board.elapsed();
        resultDialog({
          label: `SLIDING PUZZLE ${x.level} COMPLETE`, picture: p.image, answer: x.title || 'Puzzle solved', fact: x.fact, factLocked: x.factLocked,
          rewards: [
            { big: '+' + x.earned, small: 'points' },
            { big: '+' + x.coins_earned, small: 'coins', coin: true },
            { big: String(x.moves), small: 'slides' },
          ],
          chest: { opened: x.chest.opened, every: x.chest.every, toGo: x.chest.toGo, level: x.level + x.chest.toGo },
          share: `I just solved sliding puzzle level ${x.level} on PixSabi in ${x.moves} slides and ${board.fmtTime(secs)}! Can you beat me? ${location.origin}`,
          button: x.allDone ? 'Back to home' : 'Next puzzle',
          onNext: () => (x.allDone ? (location.hash = '#/') : NS.afterSolve(x.level, () => viewSlide())),
        });
      };
      const startPlay = () => {
        board = slideBoard(p, {
          move: (pos) => api('/sl/move', { method: 'POST', body: { id: p.id, pos, secs: board.elapsed() } }),
          timeUrl: '/api/sl/time',
          onResult: (x) => { setStats(x); if (x.complete) finish(x); },
          onError: onApiError,
          peek: async () => { const x = await api('/sl/peek', { method: 'POST', body: { id: p.id } }); setStats(x); },
        });
        const peekBtn = h('button', { class: 'hint-btn', type: 'button', 'aria-label': `Peek at the picture (${p.peekCost} coins)` },
          h('span', { class: 'hint-ico', 'aria-hidden': 'true' }, '👁'), h('span', { class: 'hint-label' }, 'Peek at the picture'),
          h('span', { class: 'hint-cost' }, coinIcon(12), String(p.peekCost)));
        peekBtn.addEventListener('click', async () => {
          peekBtn.disabled = true;
          try { await board.peek(); } catch (e) { onApiError(e); }
          peekBtn.disabled = false;
        });
        main.append(board.bar, board.card,
          h('p', { class: 'muted center' }, `Tap a piece next to the gap to slide it. Rebuild the picture. ${p.size} by ${p.size} pieces.`),
          h('div', { class: 'hint-bar' }, peekBtn));
      };
      // First time on this puzzle: show the finished picture for 10 seconds, then "Ready?" and a Start button. The clock only starts at Start.
      // Coming back to a puzzle that was already started goes straight to the board (no countdown again).
      if (!p.moves && !(p.secs > 0) && !slSeen(p.id)) {
        slMarkSeen(p.id);
        const pre = slPreview(p, () => { pre.remove(); startPlay(); });
        main.append(pre);
      } else startPlay();
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewSlide())); }
  }

  // ---------- home: streak, level journey, big Play button ----------
  const MAP_SLOTS = [[70, 268], [200, 226], [90, 176], [220, 128], [100, 80], [230, 32]];
  function journeyMap(solved, total, every) {
    const level = solved + 1;                         // the level you are on
    const first = Math.max(1, level - 2);
    const nodes = [];
    for (let n = first; n < first + MAP_SLOTS.length && n <= total; n++) nodes.push({ n, xy: MAP_SLOTS[n - first] });
    let d = '';
    nodes.forEach((nd, i) => {
      const [x, y] = nd.xy;
      if (!i) { d = `M${x} ${y}`; return; }
      const [px, py] = nodes[i - 1].xy, my = (py + y) / 2;
      d += ` C${px} ${my}, ${x} ${my}, ${x} ${y}`;
    });
    const track = (cls) => S('path', { d, class: cls, fill: 'none', 'stroke-linecap': 'round' });
    const g = [track('map-track')];
    const els = nodes.map(({ n, xy: [x, y] }) => {
      const done = n < level, cur = n === level, chest = n % every === 0;
      if (cur) {
        return S('g', { class: 'map-node cur' },
          S('circle', { cx: x, cy: y, r: 30, fill: '#0f8a4b', stroke: '#fff', 'stroke-width': 4 }),
          S('text', { x, y: y + 10, 'text-anchor': 'middle', class: 'map-num' }, String(n)),
          S('text', { x: x + 40, y: y + 5, class: 'map-t gold' }, 'You are here'));
      }
      if (done) {
        return S('g', { class: 'map-node' },
          S('circle', { cx: x, cy: y, r: 20, fill: '#f5b82e' }),
          S('path', { d: `M${x - 8} ${y}l6 6 11-12`, fill: 'none', stroke: '#2a1a00', 'stroke-width': 3.5, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }),
          S('text', { x: x + 28, y: y + 5, class: 'map-t' }, `Level ${n}`));
      }
      if (chest) {
        return S('g', { class: 'map-node' },
          S('circle', { cx: x, cy: y, r: 24, fill: '#3d2290', stroke: '#f5b82e', 'stroke-width': 3 }),
          S('g', { transform: `translate(${x - 15} ${y - 15}) scale(0.47)` },
            S('rect', { x: 8, y: 28, width: 48, height: 28, rx: 6, fill: '#b9801a' }),
            S('path', { d: 'M8 30a6 6 0 0 1 6-6h36a6 6 0 0 1 6 6v4H8z', fill: '#f5b82e' }),
            S('rect', { x: 28, y: 30, width: 8, height: 12, rx: 2, fill: '#2a1a00' }),
            S('path', { d: 'M14 24c0-8 8-14 18-14s18 6 18 14', fill: 'none', stroke: '#f5b82e', 'stroke-width': 4 })),
          S('text', { x: x + 32, y: y + 5, class: 'map-t gold' }, `Chest at ${n}`));
      }
      return S('g', { class: 'map-node' },
        S('circle', { cx: x, cy: y, r: 20, fill: '#3d2290' }),
        S('rect', { x: x - 8, y, width: 16, height: 12, rx: 3, fill: '#b9a6ff' }),
        S('path', { d: `M${x - 5} ${y}v-4a5 5 0 0 1 10 0v4`, fill: 'none', stroke: '#b9a6ff', 'stroke-width': 2.5 }),
        S('text', { x: x + 28, y: y + 5, class: 'map-t' }, `Level ${n}`));
    });
    return S('svg', { viewBox: '0 0 358 300', class: 'map-svg', role: 'img', 'aria-label': `Level map. You are on level ${level}.` }, ...g, ...els);
  }

  // ---------- home: swipe between Naija, Universal and Word Search ----------
  const SCENES = {
    Naija: '<svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="gpn" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7fd6a4"/><stop offset=".55" stop-color="#f5b82e"/><stop offset="1" stop-color="#ff8a3d"/></linearGradient></defs><rect width="300" height="420" fill="url(#gpn)"/><circle cx="214" cy="150" r="48" fill="#fff4c2" opacity=".85"/><path d="M0 30Q150 90 300 30" fill="none" stroke="#fff" stroke-width="2"/><polygon points="21,41 39,41 30,58" fill="#0f8a4b"/><polygon points="61,52 79,52 70,69" fill="#fff"/><polygon points="101,58 119,58 110,75" fill="#0f8a4b"/><polygon points="141,60 159,60 150,77" fill="#fff"/><polygon points="181,58 199,58 190,75" fill="#0f8a4b"/><polygon points="221,52 239,52 230,69" fill="#fff"/><polygon points="261,41 279,41 270,58" fill="#0f8a4b"/><path d="M0 420V250H24V190H46V230H64V150H84V215H110V110H128V190H148V145H172V220H200V180H230V200H262V160H300V420Z" fill="#1d5c3a"/><rect x="70" y="215" width="120" height="46" rx="8" fill="#f5b82e"/><rect x="70" y="236" width="120" height="7" fill="#1a0b3d"/><rect x="80" y="222" width="22" height="11" rx="2" fill="#fff" opacity=".85"/><rect x="108" y="222" width="22" height="11" rx="2" fill="#fff" opacity=".85"/><rect x="136" y="222" width="22" height="11" rx="2" fill="#fff" opacity=".85"/><rect x="164" y="222" width="22" height="11" rx="2" fill="#fff" opacity=".85"/><circle cx="92" cy="262" r="9" fill="#12072b" stroke="#f5b82e" stroke-width="2"/><circle cx="172" cy="262" r="9" fill="#12072b" stroke="#f5b82e" stroke-width="2"/></svg>',
    Universal: '<svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="gpu" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1a0b3d"/><stop offset="1" stop-color="#4a2aa8"/></linearGradient></defs><rect width="300" height="420" fill="url(#gpu)"/><circle cx="40" cy="40" r="2" fill="#fff"/><circle cx="260" cy="60" r="2" fill="#fff"/><circle cx="90" cy="90" r="1.5" fill="#fff"/><circle cx="230" cy="20" r="1.5" fill="#fff"/><circle cx="150" cy="150" r="78" fill="#2f6fe0"/><path d="M105 120q20-25 45-10 10 20-10 30-20 10-35-20z" fill="#5fd38d"/><path d="M160 170q25-5 35 15-5 25-30 25-15-15-5-40z" fill="#5fd38d"/><ellipse cx="150" cy="150" rx="110" ry="26" transform="rotate(-20 150 150)" fill="none" stroke="#f5b82e" stroke-width="3"/><path d="M0 420V300H300V420Z" fill="#12072b"/><polygon points="20,300 70,230 120,300" fill="#12072b"/><polygon points="170,300 190,200 210,300" fill="#12072b"/></svg>',
    'Word Search': '<svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="gpw" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0f8a4b"/><stop offset="1" stop-color="#073d24"/></linearGradient></defs><rect width="300" height="420" fill="url(#gpw)"/>' +
      Array.from({ length: 6 }, (_, r) => Array.from({ length: 5 }, (_, c) => `<rect x="${c * 60 + 4}" y="${r * 60 + 4}" width="52" height="52" rx="10" fill="#fff" opacity=".1"/><text x="${c * 60 + 30}" y="${r * 60 + 40}" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="26" fill="#fff" opacity=".2">${'EKTMRNICPUDBOALHSYWFEGKTMRNICP'[r * 5 + c]}</text>`).join('')).join('') +
      [...'LAGOS'].map((ch, i) => `<rect x="${12 + i * 54}" y="150" width="50" height="50" rx="10" fill="#f5b82e"/><text x="${37 + i * 54}" y="184" text-anchor="middle" font-family="Georgia,serif" font-weight="700" font-size="30" fill="#2a1a00">${ch}</text>`).join('') +
      '<circle cx="215" cy="290" r="38" fill="none" stroke="#fff" stroke-width="8"/><circle cx="215" cy="290" r="31" fill="#fff" opacity=".15"/><path d="M243 318l34 34" stroke="#fff" stroke-width="10" stroke-linecap="round"/></svg>',
  };
  SCENES.Quiz = '<svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="gpq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7a1fa2"/><stop offset="1" stop-color="#2a0a45"/></linearGradient></defs><rect width="300" height="420" fill="url(#gpq)"/><text x="150" y="210" text-anchor="middle" font-family="Georgia,serif" font-weight="900" font-size="190" fill="#f5b82e" opacity=".9">?</text>'+[['A',40,270],['B',170,270],['C',40,330],['D',170,330]].map(([l,x,y])=>`<rect x="${x}" y="${y}" width="90" height="46" rx="12" fill="#fff" opacity=".18"/><text x="${x+45}" y="${y+31}" text-anchor="middle" font-weight="800" font-size="22" fill="#fff">${l}</text>`).join('')+'</svg>';
  SCENES['Slide Puzzle'] = '<svg viewBox="0 0 300 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><linearGradient id="gps" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b1a8f"/><stop offset="1" stop-color="#12062b"/></linearGradient></defs><rect width="300" height="420" fill="url(#gps)"/>' +
    [['#f5b82e', 0, 0], ['#0f8a4b', 1, 0], ['#ff8a3d', 2, 0], ['#6fa8ff', 0, 1], ['#fff', 1, 1], ['#e5484d', 2, 1], ['#0f8a4b', 0, 2], ['#f5b82e', 1, 2]]
      .map(([c, x, y]) => `<rect x="${30 + x * 82}" y="${70 + y * 82}" width="76" height="76" rx="12" fill="${c}" opacity="${c === '#fff' ? '.9' : '.85'}"/>`).join('') +
    '<rect x="194" y="234" width="76" height="76" rx="12" fill="none" stroke="#fff" stroke-width="3" stroke-dasharray="8 8" opacity=".6"/><path d="M168 272h16m-6-6l6 6-6 6" stroke="#fff" stroke-width="4" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  const WORLD_KEY = { Quiz: 'quiz', Naija: 'naija', Universal: 'universal', 'Word Search': 'wordsearch', 'Slide Puzzle': 'slide' };
  const WORLD_TAG = { Quiz: 'Test your school, group or church.', Naija: 'Pictures from home. Guess the word.', Universal: 'Pictures from the whole world.', 'Word Search': 'Find the hidden words in the letters.', 'Slide Puzzle': 'Slide the pieces to rebuild the picture.' };
  function sceneEl(name, photo) {
    const d = h('div', { class: 'gp-scene', 'aria-hidden': 'true' });
    if (photo) d.style.backgroundImage = `url("${photo}")`;
    else { const t = document.createElement('template'); t.innerHTML = SCENES[name]; d.append(t.content.firstElementChild); }
    return d;
  }

  // slides: [{ name, sub (e.g. "Level 24"), pct (0-100 or null) }]; onPick(name) runs when another game settles in the middle.
  function gameCarousel(slides, photos, activeName, onPick) {
    const n = slides.length;
    const track = h('div', { class: 'gp-track', role: 'region', 'aria-roledescription': 'carousel', 'aria-label': 'Choose a game. Swipe sideways.' });
    const dots = h('div', { class: 'gp-dots', 'aria-hidden': 'true' });
    const buildCard = (s, clone) => {
      const bar = s.pct == null ? null : h('div', { class: 'gp-bar' }, (() => { const i = h('i'); i.style.width = Math.max(4, Math.min(100, s.pct)) + '%'; return i; })());
      const card = h('div', { class: 'gp-card', role: 'group', 'aria-roledescription': 'slide', 'aria-label': s.name, ...(clone ? { 'aria-hidden': 'true' } : {}) },
        sceneEl(s.name, photos[WORLD_KEY[s.name]]),
        h('div', { class: 'gp-fade' }),
        h('div', { class: 'gp-info' },
          s.sub ? h('span', { class: 'gp-pill' }, s.sub) : null,
          h('div', { class: 'gp-title' }, s.name),
          h('div', { class: 'gp-tag' }, WORLD_TAG[s.name]),
          bar,
          h('a', { class: 'gp-play', href: s.href || '#/play', ...(clone ? { tabindex: '-1' } : {}), onclick: () => { if (s.href) return; soloCategory = s.name; try { localStorage.setItem('ns_world', s.name); } catch { /* ignore */ } } }, s.cta)));
      track.append(card);
      return card;
    };
    const cards = slides.map((s) => { dots.append(h('i')); return buildCard(s, false); });
    // To loop forever, the first two games are repeated after the last one. When the slide reaches a repeat,
    // the track quietly jumps back to the real card (it looks identical), so it keeps sliding the same way round and round.
    const all = n > 1 ? [...cards, buildCard(slides[0], true), buildCard(slides[1 % n], true)] : cards;
    const arrow = (dir) => h('button', { class: 'gp-arrow ' + (dir < 0 ? 'left' : 'right'), type: 'button', 'aria-label': dir < 0 ? 'Previous game' : 'Next game', onclick: () => {
      touched();
      if (dir < 0 && index === 0) jump(n); // slide 1 is at the far left: step to its repeat after the last, then slide back
      glide(posOf(index + dir), 700);
    } },
      S('svg', { viewBox: '0 0 20 20', width: '22', height: '22', 'aria-hidden': 'true' }, S('path', { d: dir < 0 ? 'M12 4l-6 6 6 6' : 'M8 4l6 6-6 6', fill: 'none', stroke: '#fff', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })));
    const wrap = h('div', { class: 'gp' }, h('div', { class: 'gp-stage' }, track, n > 1 ? arrow(-1) : null, n > 1 ? arrow(1) : null), h('div', { class: 'gp-foot' }, dots));
    const step = () => (all.length > 1 ? all[1].offsetLeft - all[0].offsetLeft : track.clientWidth);
    const posOf = (k) => k * step();
    let index = Math.max(0, slides.findIndex((s) => s.name === activeName));
    const mark = (i) => { [...dots.children].forEach((d, k) => d.classList.toggle('on', k === i)); all.forEach((c, k) => c.classList.toggle('on', k % n === i)); };
    mark(index);
    requestAnimationFrame(() => { track.scrollLeft = posOf(index); });
    let idle, pausedUntil = 0, animating = false, raf = 0;
    // Instant move with no animation and no fade (used for the quiet jump from a repeat back to the real card).
    const jump = (pos) => {
      track.classList.add('moving', 'nojump'); track.scrollLeft = posOf(pos);
      requestAnimationFrame(() => requestAnimationFrame(() => track.classList.remove('moving', 'nojump')));
    };
    const settle = () => {
      let k = Math.max(0, Math.min(all.length - 1, Math.round(track.scrollLeft / (step() || 1))));
      if (k >= n) { k -= n; jump(k); }
      if (k !== index) { index = k; mark(k); onPick(slides[k].name); } else mark(k);
    };
    track.addEventListener('scroll', () => { if (animating) return; clearTimeout(idle); idle = setTimeout(settle, 120); }, { passive: true });
    const touched = () => { pausedUntil = Date.now() + 4000; cancelAnimationFrame(raf); animating = false; track.classList.remove('moving'); };
    track.addEventListener('pointerdown', touched); track.addEventListener('wheel', touched, { passive: true }); track.addEventListener('keydown', touched);
    // slow, smooth glide to a position
    const glide = (to, D = 1600) => {
      cancelAnimationFrame(raf);
      const from = track.scrollLeft, dist = to - from, t0 = performance.now();
      animating = true; track.classList.add('moving');
      const tick = (now) => {
        if (!animating) return;
        const k = Math.min(1, (now - t0) / D), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
        track.scrollLeft = from + dist * e;
        if (k < 1) raf = requestAnimationFrame(tick);
        else { animating = false; track.classList.remove('moving'); settle(); }
      };
      raf = requestAnimationFrame(tick);
    };
    // every 4 seconds: slide 1, then 2, then 3, then 1 again, and so on, always moving the same way
    if (n > 1 && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const timer = setInterval(() => {
        if (!wrap.isConnected) return clearInterval(timer);
        if (document.hidden || animating || Date.now() < pausedUntil) return;
        glide(posOf(index + 1));
      }, 4000);
    }
    return wrap;
  }

  // ---------- sponsored races ----------
  // The sponsor's logo, name and prize. Tapping the link is counted for the sponsor's report.
  // "2h 5m", "14 min", "30 sec" until a time, or '' when it has passed.
  function countdownText(ms) {
    const left = Math.round((ms - Date.now()) / 1000);
    if (left <= 0) return '';
    const d = Math.floor(left / 86400), hh = Math.floor((left % 86400) / 3600), m = Math.floor((left % 3600) / 60);
    if (d) return `${d}d ${hh}h`;
    if (hh) return `${hh}h ${m}m`;
    if (m) return `${m} min ${left % 60 < 10 ? '0' : ''}${left % 60}s`;
    return `${left} sec`;
  }
  const timerWords = (min) => (min >= 60 ? `${min / 60} hour${min === 60 ? '' : 's'}` : `${min} minutes`);
  // Live "time left" line for a race with a timer. Calls onEnd once when it reaches zero.
  function raceClock(endsAt, onEnd) {
    const el = h('div', { class: 'race-clock', role: 'timer' });
    let t = 0, fired = false;
    const tick = () => {
      if (!el.isConnected && t) { clearInterval(t); return; }
      const left = Math.max(0, endsAt - Date.now());
      const sec = Math.ceil(left / 1000), hh = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), ss = sec % 60;
      el.textContent = '⏱ Time left ' + (hh ? `${hh}:${String(m).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`) + (hh ? ' h' : '');
      el.classList.toggle('low', left < 60000);
      if (left <= 0 && !fired) { fired = true; clearInterval(t); if (onEnd) onEnd(); }
    };
    tick(); t = setInterval(tick, 1000);
    return el;
  }
  const startClock = (ms) => new Date(ms).toLocaleString('en-NG', { weekday: 'short', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' });
  function sponsorBlock(sp, id) {
    if (!sp) return null;
    const open = (e) => { try { fetch(`/api/sponsored/${encodeURIComponent(id)}/tap`, { method: 'POST', keepalive: true, credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }); } catch (x) { /* not important */ } };
    return h('div', { class: 'sponsor-block' },
      sp.logo ? h('img', { class: 'sponsor-logo', src: sp.logo, alt: sp.name }) : null,
      h('div', { class: 'sponsor-text' },
        h('span', { class: 'sponsor-by' }, 'Sponsored by'),
        h('b', {}, sp.name),
        h('span', { class: 'sponsor-prize' }, `🏆 Prize: ${sp.prize}`),
        sp.startAt && sp.startAt > Date.now() ? h('span', { class: 'sponsor-start', 'data-start': String(sp.startAt) }, `⏰ Starts in ${countdownText(sp.startAt)} (${startClock(sp.startAt)})`) : null,
        sp.link ? h('a', { class: 'sponsor-link', href: sp.link, target: '_blank', rel: 'noopener noreferrer sponsored', onclick: open }, 'Visit sponsor') : null));
  }
  // Counts down every second on any sponsor box that carries a start time.
  setInterval(() => {
    for (const e of document.querySelectorAll('.sponsor-start[data-start]')) {
      const ms = Number(e.dataset.start), txt = countdownText(ms);
      e.textContent = txt ? `⏰ Starts in ${txt} (${startClock(ms)})` : '⏰ Starting now...';
    }
  }, 1000);
  // The card on the home screen for each open sponsored race.
  function sponsoredCard(r) {
    const gameName = r.game === 'wordsearch' ? 'Word Search' : r.game === 'slide' ? 'Slide Puzzle' : (r.category || 'Picture puzzle');
    return h('a', { class: 'card sponsored-home', href: `#/join/${r.id}` },
      r.sponsor.logo ? h('img', { class: 'sponsor-logo', src: r.sponsor.logo, alt: '' }) : h('span', { class: 'sponsored-trophy', 'aria-hidden': 'true' }, '🏆'),
      h('div', { class: 'grow' },
        h('div', { class: 'sponsor-by' }, `Sponsored race by ${r.sponsor.name}`),
        h('b', {}, `Win ${r.sponsor.prize}`),
        h('div', { class: 'muted' }, `${gameName}, ${r.rounds} levels. ${r.started ? 'Already started.' : r.joined ? 'You are in. Wait for the start.' : 'Free to join.'}`),
        !r.started && r.sponsor.startAt && r.sponsor.startAt > Date.now() ? h('div', { class: 'sponsor-start' }, `⏰ Starts in ${countdownText(r.sponsor.startAt)} (${startClock(r.sponsor.startAt)})`) : null,
        h('div', { class: 'muted' }, `${r.playerCount} player${r.playerCount === 1 ? '' : 's'} joined`)),
      h('span', { class: 'sponsored-go' }, r.joined ? 'Open' : r.started ? 'Watch' : 'Join'));
  }

  // ---------- install the game on the phone (a web app: icon on the home screen, opens full screen) ----------
  const isInstalled = () => { try { return window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true; } catch { return false; } };
  const isApple = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const installReady = () => !!(NS.install && NS.install.ready());
  const refreshInstallSlots = () => document.querySelectorAll('.install-slot').forEach((el) => fillInstallSlot(el));
  window.addEventListener('ns-install', refreshInstallSlots);
  window.addEventListener('appinstalled', () => { try { NS.toast('PixSabi is installed. Find it on your home screen.'); } catch { /* ignore */ } });
  function fillInstallSlot(slot) {
    const compact = slot.dataset.compact === '1';
    slot.textContent = '';
    if (isInstalled()) { if (!compact) slot.append(h('p', { class: 'muted' }, 'PixSabi is installed on this phone. Open it from your home screen.')); slot.classList.toggle('hide', compact); return; }
    // On Home the bottom install bar already asks; show this card only after that bar was closed.
    if (compact && document.querySelector('.install-bar')) { slot.classList.add('hide'); return; }
    slot.classList.remove('hide');
    const how = isApple()
      ? 'Tap the Share button in Safari, then "Add to Home Screen".'
      : 'Open your browser menu (the three dots) and tap "Install app" or "Add to Home screen".';
    const btn = h('button', { class: 'btn primary install-btn', type: 'button' }, 'Install PixSabi');
    btn.addEventListener('click', async () => {
      if (installReady()) {
        await NS.install.ask();
        refreshInstallSlots();
      } else {
        const tip = slot.querySelector('.install-how'); if (tip) { tip.hidden = false; tip.focus && tip.focus(); }
        NS.toast(how);
      }
    });
    slot.append(h('div', { class: 'install-row' },
      h('div', { class: 'grow' }, h('b', {}, compact ? 'Get the app' : 'Add it to your home screen'), h('div', { class: 'muted' }, 'An icon on your home screen. Opens full screen, like an app.')),
      btn),
      h('p', { class: 'muted install-how', hidden: installReady() ? true : null, tabindex: '-1' }, how));
  }
  function installSlot(compact) {
    const slot = h('div', { class: 'install-slot' + (compact ? ' card install-home' : '') });
    if (compact) slot.dataset.compact = '1';
    fillInstallSlot(slot);
    return slot;
  }

  async function viewHome() {
    const main = shell('solo');
    main.append(spinner());
    try {
      const [cats, daily, news, ws, sl, photos, sponsored] = await Promise.all([
        api('/categories'), api('/daily'),
        api('/announcements').catch(() => ({ items: [], unseen: 0 })),
        api('/ws/state'),
        api('/sl/state'),
        fetch('/api/worldbg').then((r) => r.json()).then((r) => (r && r.pictures) || {}).catch(() => ({})),
        api('/sponsored').catch(() => ({ races: [] })),
      ]);
      const maps = {};
      await Promise.all(cats.categories.map(async (c) => { maps[c.name] = await api(`/solo/map?category=${encodeURIComponent(c.name)}`); }));
      if (soloCategory !== WS_TAB && soloCategory !== SL_TAB && !maps[soloCategory]) soloCategory = (cats.categories[0] && cats.categories[0].name) || WS_TAB;
      main.textContent = '';
      main.classList.add('stack');
      const next = me.title && me.title.next;
      const helloEl = h('div', { class: 'home-hello' },
        avatarEl(me.avatar, me.username, 'big', me.title ? me.title.tier : undefined),
        h('div', { class: 'grow' },
          h('div', { class: 'home-name' }, `Welcome back, ${me.username}`, me.premium ? ' ' : null, me.premium ? premiumMark() : null),
          h('div', { class: 'muted' }, me.title ? `${me.title.icon} ${me.title.name}` + (next ? ` · ${next.min - me.points} points to ${next.name}` : '') : '')));
      main.append(helloEl);

      const latest = news.items[0];
      if (latest) {
        main.append(h('a', { class: 'card news-home' + (news.unseen ? ' new' : ''), href: '#/news' },
          megaphone(26),
          h('div', { class: 'grow' }, h('div', { class: 'news-home-top' }, adminTag(), news.unseen ? h('span', { class: 'news-new' }, `${news.unseen} new`) : null),
            h('b', {}, latest.title), h('div', { class: 'muted news-snip' }, latest.body))));
      }
      const slides = cats.categories.map((c) => {
        const m = maps[c.name];
        const done = m.total && m.solved >= m.total;
        return { name: c.name, sub: !m.total ? 'Coming soon' : done ? 'All done' : `Level ${m.solved + 1}`, pct: m.total ? (m.solved / m.total) * 100 : null, cta: !m.total ? 'Open' : done ? 'Look back' : `Play ${c.name}` };
      });
      slides.push({ name: WS_TAB, sub: ws.done ? (ws.empty ? 'Coming soon' : 'All done') : `Level ${ws.puzzle.level}`, pct: ws.done || !ws.puzzle.total ? null : ((ws.puzzle.level - 1) / ws.puzzle.total) * 100, cta: ws.done ? 'Open' : `Play ${WS_TAB}` });
      slides.push({ name: SL_TAB, sub: sl.done ? (sl.empty ? 'Coming soon' : 'All done') : `Level ${sl.puzzle.level}`, pct: sl.done || !sl.puzzle.total ? null : ((sl.puzzle.level - 1) / sl.puzzle.total) * 100, cta: sl.done ? 'Open' : `Play ${SL_TAB}` });
      if (me.quizOpen || me.quizAdmin) slides.push({ name: 'Quiz', sub: me.quizOpen ? 'Enter a code' : 'Locked: only you see this', pct: null, cta: me.canHostQuiz ? 'Play or host' : 'Join a quiz', href: '#/quiz' });
      const carouselEl = gameCarousel(slides, photos, soloCategory, (name) => {
        if (name === 'Quiz') return;
        soloCategory = name; try { localStorage.setItem('ns_world', name); } catch { /* ignore */ }
      });
      helloEl.after(carouselEl);
      let lastEl = carouselEl;
      for (const r of (sponsored.races || [])) { const c = sponsoredCard(r); lastEl.after(c); lastEl = c; }
      main.append(h('a', { class: 'card invite-home', href: '#/invite' }, h('div', { class: 'grow' }, h('b', {}, 'Invite a friend'), h('div', { class: 'muted' }, ['You both get ', coinIcon(13), ' 50 coins when they solve a level'])), h('span', { class: 'invite-go', 'aria-hidden': 'true' }, '›')));
      main.append(installSlot(true));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewHome())); }
  }

  // ---------- announcements from the admin ----------
  const when = (ms) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  function megaphone(size) {
    return S('svg', { viewBox: '0 0 24 24', width: String(size), height: String(size), 'aria-hidden': 'true' },
      S('path', { d: 'M3 10v4h4l7 5V5L7 10z', fill: '#f5b82e' }), S('path', { d: 'M17 8.5a5 5 0 0 1 0 7', fill: 'none', stroke: '#f5b82e', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  }
  async function viewNews() {
    const main = shell('solo');
    main.classList.add('stack');
    main.append(spinner());
    try {
      const r = await api('/announcements');
      main.textContent = '';
      main.append(h('div', { class: 'row' }, megaphone(28), h('h2', {}, 'Announcements')));
      if (!r.items.length) main.append(h('div', { class: 'card center' }, h('p', { class: 'muted' }, 'Nothing yet. Announcements from the admin will show here.')));
      for (const a of r.items) {
        main.append(h('div', { class: 'card news-card' },
          h('div', { class: 'news-head' }, avatarEl(a.avatar, a.by, 'small'), h('b', {}, a.by), adminTag(), h('span', { class: 'muted news-time' }, when(a.at))),
          h('h3', {}, a.title),
          h('p', { class: 'news-body' }, a.body),
          me && me.isAdmin ? h('button', { class: 'btn small alt', type: 'button', onclick: async (ev) => {
            if (!window.confirm('Delete this announcement for everybody?')) return;
            try { await api('/admin/announcements/' + a.id, { method: 'DELETE' }); NS.toast('Announcement deleted'); viewNews(); } catch (e) { NS.toast(e.message, true); }
          } }, 'Delete announcement') : null));
      }
      main.append(h('a', { class: 'btn alt block', href: '#/' }, 'Back to home'));
      if (r.unseen) api('/announcements/seen', { method: 'POST' }).catch(() => {});
    } catch (e) { main.textContent = ''; main.append(errorCard(e, viewNews)); }
  }

  // ---------- invite a friend ----------
  async function viewInvite() {
    const main = shell('me');
    main.classList.add('stack');
    main.append(spinner());
    try {
      const r = await api('/invite');
      main.textContent = '';
      const link = `${location.origin}/?ref=${encodeURIComponent(r.username)}`;
      const box = h('input', { type: 'text', readonly: true, value: link, id: 'inv-link', 'aria-label': 'Your invite link' });
      const copy = h('button', { class: 'btn', type: 'button' }, 'Copy link');
      copy.addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(link); NS.toast('Link copied'); }
        catch { box.select(); NS.toast('Press and hold the link to copy it'); }
      });
      const msg = `Come play PixSabi with me! Sign up with my link and we both get ${r.reward} coins when you solve your first level: ${link}`;
      main.append(
        h('h2', {}, 'Invite a friend'),
        h('div', { class: 'card stack' },
          h('p', {}, `Share your link. When your friend signs up and solves their first level, you both get `, coinIcon(14), ` ${r.reward} coins.`),
          h('div', { class: 'field' }, h('label', { for: 'inv-link' }, 'Your invite link'), box),
          h('div', { class: 'row' }, copy,
            h('a', { class: 'btn wa grow', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(msg) }, 'Share on WhatsApp')),
          h('p', { class: 'muted' }, `You can earn this for up to ${r.max} friends.`)),
        h('div', { class: 'card' },
          h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('b', {}, String(r.joined)), h('span', {}, 'Joined')),
            h('div', { class: 'stat' }, h('b', {}, String(r.solved)), h('span', {}, 'Solved a level')),
            h('div', { class: 'stat' }, h('b', {}, String(r.rewarded * r.reward)), h('span', {}, 'Coins earned')))),
        r.friends.length ? h('div', { class: 'card' }, h('h3', {}, 'Your friends'),
          h('ul', { class: 'list' }, r.friends.map((f) => h('li', {}, h('div', { class: 'grow' }, h('a', { href: profileLink(f.username) }, f.username)),
            h('span', { class: 'muted' }, f.done ? 'Solved a level' : 'Not yet'))))) : '',
        h('a', { class: 'btn alt block', href: '#/me' }, 'Back'));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, viewInvite)); }
  }

  function errorCard(e, retry) {
    return h('div', { class: 'card center stack' },
      h('h2', {}, 'Could not load this'),
      h('p', {}, e.message),
      h('button', { class: 'btn', type: 'button', onclick: retry }, 'Try again'));
  }

  // ---------- daily ----------
  async function viewDaily() {
    const main = shell('daily');
    main.append(spinner());
    try {
      const r = await api('/daily');
      main.textContent = '';
      const head = h('div', { class: 'row between' },
        h('h2', {}, 'Daily puzzle'),
        h('span', { class: 'chip' }, `🔥 ${r.streak}-day streak`));
      main.append(head);
      if (r.solved) {
        main.append(h('div', { class: 'card center' },
          h('h2', {}, 'Done for today!'),
          h('div', { class: 'answer-word' }, r.answer),
          r.fact ? h('div', { class: 'fact' }, r.fact) : (r.factLocked ? h('a', { class: 'fact fact-locked', href: '#/premium' }, '🔒 There is a fun fact here. Fun facts are for Premium members. Tap to see Premium.') : null),
          h('p', { class: 'muted' }, 'A new puzzle drops at midnight, Lagos time. Come back tomorrow to keep your streak.'),
          h('a', { class: 'btn', href: '#/' }, 'Play more puzzles')));
        return;
      }
      main.append(h('p', { class: 'muted' }, 'Same puzzle for everyone. No hints. Keep your streak to earn bonus points.'));
      const holder = h('div');
      main.append(h('div', { class: 'card' }, holder));
      NS.mountGame(holder, r.puzzle, {
        onGuess: (guess) => api('/daily/guess', { method: 'POST', body: { guess } }),
        onCorrect: (x) => {
          setStats(x);
          if (x.inviteBonus) NS.toast(`Invite bonus! You got ${x.inviteBonus} coins for joining through a friend.`);
          resultDialog(x.already
            ? { title: 'Correct! You sabi!', answer: x.answer, fact: x.fact, factLocked: x.factLocked, extra: 'You already solved this today.', button: 'Done', onNext: viewDaily }
            : {
              label: 'DAILY PUZZLE COMPLETE', answer: x.answer, fact: x.fact, factLocked: x.factLocked,
              rewards: [{ big: '+' + x.earned, small: 'points' }, { big: '+25', small: 'coins', coin: true }, { big: String(x.streak), small: 'day streak' }],
              share: `I solved today's PixSabi puzzle and I'm on a ${x.streak}-day streak! Can you beat me? ${location.origin}`,
              button: 'Done', onNext: viewDaily,
            });
        },
      });
    } catch (e) { main.textContent = ''; main.append(errorCard(e, viewDaily)); }
  }

  // ---------- challenges ----------
  // "Food", "Mix of everything", or "Food (12 of 20 levels, the rest mixed)" when the category is small.
  function categoryText(category, inCat, rounds) {
    if (!category) return 'Mix of everything';
    return inCat != null && rounds && inCat < rounds ? `${category} (${inCat} of ${rounds} levels, the rest mixed)` : category;
  }
  const raceTitle = (game, n) => (game === 'wordsearch' ? `${n} word search race` : game === 'slide' ? `${n} sliding puzzle race` : `${n}-level race`);
  function shareLink(code, group, levels, stake, category, split) {
    const url = `${location.origin}/#/join/${code}`;
    const n = levels || 20;
    const cat = category ? ` Category: ${category}.` : '';
    const bet = stake ? ` Stake: ${stake} coins each, ${split ? 'top 3 share the pot' : 'winner takes the pot'}.` : '';
    const text = group
      ? `Join my PixSabi group race! Look, think, answer: ${n} levels. First to finish all ${n} wins.${cat}${bet} Use code ${code} or open: ${url}`
      : `I dey challenge you for PixSabi! Look, think, answer. Race me over ${n} levels, first to finish all ${n} wins.${cat}${bet} Use code ${code} or open: ${url}`;
    return { url, text, wa: `https://wa.me/?text=${encodeURIComponent(text)}` };
  }
  function watchShare(code, rounds, stake) {
    const url = `${location.origin}/#/watch/${code}`;
    const text = `I am in a live Contest in PixSabi. Come watch the Match and show support. ${url}`;
    return { url, text, wa: `https://wa.me/?text=${encodeURIComponent(text)}` };
  }
  const watchingText = (n) => (n > 0 ? `👀 ${n} watching` : '');
  function watchButtons(s) {
    const w = watchShare(s.id, s.rounds, s.stake);
    return h('div', { class: 'row' },
      h('a', { class: 'btn alt grow', href: w.wa, target: '_blank', rel: 'noopener' }, 'Share watch link'),
      h('button', { class: 'btn alt grow', type: 'button', onclick: () => copyText(w.text) }, 'Copy watch link'));
  }
  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); NS.toast('Copied'); }
    catch { NS.toast('Could not copy. Select the text and copy it yourself.', true); }
  }

  function raceLabel(c) {
    const lv = `${c.rounds} levels, ${c.category || 'Mix'}${c.stake ? `, ${c.stake} coin stake` : ''}`;
    if (c.status === 'cancelled') return { text: `Race, ${lv}`, badge: [c.stake ? 'Cancelled, refunded' : 'Cancelled', ''] };
    if (c.status === 'finished') {
      const base = c.group ? `Group of ${c.playerCount}, ${lv}` : `vs ${c.opponent}, ${lv}`;
      if (c.result === 'won') return { text: base, badge: [c.stake ? 'You won the pot' : 'You won', 'win'] };
      if (c.myPrize) return { text: `${base}: you cleared ${c.mySolved}`, badge: [`${ordinal(c.myPlace)}, won ${c.myPrize} coins`, 'win'] };
      return { text: `${base}: you cleared ${c.mySolved}`, badge: [c.group ? `${ordinal(c.myPlace)} place` : 'You lost', 'lose'] };
    }
    if (!c.started) {
      const who = c.group ? `${c.playerCount} of ${c.maxPlayers} joined` : c.opponent ? `vs ${c.opponent}` : 'waiting for a friend';
      return { text: `Race, ${lv}: ${who}`, badge: [c.createdBy ? 'Lobby' : '', 'go'] };
    }
    return { text: `Race, ${lv}: you are on ${c.mySolved}`, badge: ['Race on', 'go'] };
  }

  function challengeLabel(c) {
    if (c.needsJoin) return { text: `${c.createdBy} challenged you${c.race ? ` (${c.rounds}-level race)` : ''}`, badge: ['Join', 'go'] };
    if (c.race) return raceLabel(c);

    if (c.status === 'finished') {
      if (c.group) {
        const text = `Group of ${c.playerCount}: you scored ${c.myScore}`;
        if (c.result === 'won') return { text, badge: ['You won', 'win'] };
        if (c.result === 'draw') return { text, badge: ['Tied first', ''] };
        return { text, badge: [`${ordinal(c.myPlace)} place`, 'lose'] };
      }
      return {
        text: `vs ${c.opponent}: ${c.myScore} to ${c.oppScore}`,
        badge: c.result === 'won' ? ['You won', 'win'] : c.result === 'lost' ? ['You lost', 'lose'] : ['Draw', ''],
      };
    }

    if (c.group) {
      const joined = `Group: ${c.playerCount} of ${c.maxPlayers} joined`;
      if (!c.myDone) return { text: joined, badge: ['Play now', 'go'] };
      return { text: c.closed ? 'Group: waiting for everyone to finish' : `${joined}, still open`, badge: ['View', ''] };
    }
    if (!c.myDone) return { text: c.opponent ? `vs ${c.opponent}` : 'Waiting for a friend to join', badge: ['Play now', 'go'] };
    if (c.status === 'waiting') return { text: 'Waiting for a friend to join', badge: ['Share code', ''] };
    return { text: `Waiting for ${c.opponent} to finish`, badge: ['Waiting', ''] };
  }

  async function viewChallenges() {
    const main = shell('challenges');
    main.append(spinner());
    try {
      const [cats, list, wsInfo, slInfo] = await Promise.all([api('/categories'), api('/challenges'), api('/ws/state').catch(() => null), api('/sl/state').catch(() => null)]);
      const slTotal = slInfo ? slInfo.ready || 0 : 0;
      const wsTotal = wsInfo ? (wsInfo.puzzle ? wsInfo.puzzle.total : wsInfo.total || 0) : 0;
      main.textContent = '';
      main.classList.add('stack');
      const nudge = pushNudge();
      if (nudge) main.append(nudge);

      // Create
      const opp = h('input', { type: 'text', id: 'opp', autocapitalize: 'none', autocomplete: 'off', placeholder: 'Leave empty to share a code', maxlength: '20' });
      const sugg = h('div', { class: 'muted' });
      let t;
      opp.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          if (opp.value.trim().length < 2) { sugg.textContent = ''; return; }
          try {
            const r = await api('/users/search?q=' + encodeURIComponent(opp.value.trim()));
            sugg.textContent = '';
            if (r.users.length) sugg.append('Players: ', r.users.map((n) =>
              h('button', { class: 'badge', type: 'button', onclick: () => { opp.value = n; sugg.textContent = ''; } }, n)));
          } catch { /* ignore */ }
        }, 250);
      });
      const size = h('select', { id: 'size' },
        h('option', { value: '2' }, '2 players (head to head)'),
        Array.from({ length: 18 }, (_, i) => i + 3).map((n) => h('option', { value: String(n) }, `${n} players (group)`)));
      const sizeHint = h('div', { class: 'muted' });
      const oppField = h('div', { class: 'field' }, h('label', { for: 'opp' }, 'Friend\'s username'), opp, sugg);
      size.addEventListener('change', () => {
        const group = Number(size.value) > 2;
        oppField.classList.toggle('hidden', group);
        if (group) { opp.value = ''; sugg.textContent = ''; }
        sizeHint.textContent = group
          ? 'Everyone joins with the same code. When at least 2 people are in, you press Start race.'
          : '';
      });
      // The race is played in one category (Naija or Universal). A category needs at least 20 puzzles for a race.
      const raceable = (c) => c.count >= 20;
      const cat = h('select', { id: 'chcat' },
        cats.categories.map((c) => h('option', { value: c.name, disabled: raceable(c) ? null : true }, raceable(c) ? `${worldIcon(c.name)} ${c.name} (${c.count} levels)` : `${worldIcon(c.name)} ${c.name} (coming soon)`)),
        h('option', { value: WS_TAB, disabled: wsTotal >= 3 ? null : true }, wsTotal >= 3 ? `${WS_TAB} (${wsTotal} word searches)` : `${WS_TAB} (coming soon)`),
        h('option', { value: SL_TAB, disabled: slTotal >= 3 ? null : true }, slTotal >= 3 ? `${SL_TAB} (${slTotal} puzzles)` : `${SL_TAB} (coming soon)`));
      const first = cats.categories.find((c) => c.name === soloCategory && raceable(c)) || cats.categories.find(raceable);
      if (first) cat.value = first.name;
      if (soloCategory === WS_TAB && wsTotal >= 3) cat.value = WS_TAB;
      if (soloCategory === SL_TAB && slTotal >= 3) cat.value = SL_TAB;
      const levels = h('input', { type: 'number', id: 'levels', inputmode: 'numeric', min: '20', step: '1', value: '20' });
      const levelsLabel = h('label', { for: 'levels' }, 'How many levels?');
      const levelChips = h('div', { class: 'row chips' });
      let wasWs = null;
      const syncCat = () => {
        const isSlRace = cat.value === SL_TAB;
        const isWsRace = cat.value === WS_TAB || isSlRace;      // word searches and sliding puzzles are quicker, so their races are shorter
        const c = cat.value === WS_TAB ? { count: wsTotal } : isSlRace ? { count: slTotal } : (cats.categories.find((x) => x.name === cat.value) || { count: 0 });
        const most = c.count;
        const least = isWsRace ? 3 : 20;
        levels.min = String(least);
        levels.max = String(most);
        if (wasWs !== isWsRace) levels.value = String(isWsRace ? Math.min(5, most) : Math.min(20, most)); // a word search is quicker, so the race is shorter
        wasWs = isWsRace;
        if (Number(levels.value) > most) levels.value = String(Math.max(least, most));
        levelsLabel.textContent = isSlRace ? `How many sliding puzzles? (3 to ${most})` : isWsRace ? `How many word searches? (3 to ${most})` : `How many levels? (20 to ${most})`;
        levelChips.textContent = '';
        for (const n of (isWsRace ? [5, 10, 20] : [20, 50, 100]).filter((x) => x <= most).concat(most > 100 ? [most] : [])) {
          levelChips.append(h('button', { class: 'badge', type: 'button', onclick: () => { levels.value = String(n); } }, n === most && n > 100 ? `All ${n}` : String(n)));
        }
      };
      cat.addEventListener('change', syncCat);
      syncCat();
      const timer = h('select', { id: 'timer' }, h('option', { value: '0' }, 'No timer (first to finish wins)'), [5, 10, 15, 20, 30, 45, 60, 120, 180, 360, 720, 1440].map((n) => h('option', { value: String(n) }, timerWords(n))));
      const timerHint = h('div', { class: 'muted' }, 'The timer starts when you press Start. When it runs out the race ends, and the player who cleared the most levels wins (a tie is settled by points).');
      timer.addEventListener('change', () => { timerHint.hidden = timer.value === '0'; });
      timerHint.hidden = true;
      const err = h('div', { class: 'error', role: 'alert' });
      const create = h('button', { class: 'btn block', type: 'submit' }, 'Create race');
      const form = h('form', { class: 'card', novalidate: true },
        h('h2', {}, 'Challenge your friends'),
        h('p', { class: 'muted' }, 'A live race. Everybody gets the same levels, you start together, and the first to finish them all wins.'),
        h('div', { class: 'field' }, h('label', { for: 'chcat' }, 'Category'), cat),
        h('div', { class: 'field' }, levelsLabel, levels, levelChips),
        h('div', { class: 'field' }, h('label', { for: 'size' }, 'How many players?'), size, sizeHint),
        h('div', { class: 'field' }, h('label', { for: 'timer' }, 'Race timer (optional)'), timer, timerHint),
        oppField,
        err, h('div', { class: 'field' }, create));
      form.addEventListener('submit', async (e) => {
        e.preventDefault(); err.textContent = ''; create.disabled = true;
        try {
          const r = await api('/challenges', { method: 'POST', body: { opponent: opp.value, category: cat.value, maxPlayers: Number(size.value), levels: Number(levels.value), timeLimit: Number(timer.value) } });
          setStats({ coins: r.coins });
          go('/c/' + r.id);
        } catch (ex) { err.textContent = ex.message; if (ex.status === 402) buyCoins(); }
        create.disabled = false;
      });

      // Join
      const code = h('input', { type: 'text', id: 'code', autocapitalize: 'characters', autocomplete: 'off', maxlength: '6', placeholder: '6-letter code' });
      const jerr = h('div', { class: 'error', role: 'alert' });
      const joinForm = h('form', { class: 'card', novalidate: true },
        h('h2', {}, 'Got a code?'),
        h('div', { class: 'field' }, h('label', { for: 'code' }, 'Challenge code'), code),
        jerr,
        h('div', { class: 'field' }, h('button', { class: 'btn alt block', type: 'submit' }, 'Join challenge')));
      joinForm.addEventListener('submit', async (e) => {
        e.preventDefault(); jerr.textContent = '';
        try { const c = code.value.trim().toUpperCase(); if (!c) throw new Error('Type the 6-letter code.'); go('/join/' + c); }
        catch (ex) { jerr.textContent = ex.message; }
      });

      // List
      const listCard = h('div', { class: 'card' }, h('h2', {}, 'Your challenges'));
      if (!list.challenges.length) {
        listCard.append(h('p', { class: 'muted' }, 'Nothing yet. Create a challenge above and send the code to your friends.'));
      } else {
        listCard.append(h('ul', { class: 'list' }, list.challenges.map((c) => {
          const l = challengeLabel(c);
          return h('li', {},
            h('div', { class: 'grow' }, h('div', { class: 'name' }, l.text), h('div', { class: 'muted' }, `${c.id} · ${timeAgo(c.createdAt)}`)),
            h('a', { class: 'btn small alt', href: c.needsJoin ? `#/join/${c.id}` : `#/c/${c.id}` }, l.badge[0]));
        })));
      }
      main.append(form, joinForm, listCard);
    } catch (e) { main.textContent = ''; main.append(errorCard(e, viewChallenges)); }
  }

  async function viewJoin(code) {
    const main = shell('challenges');
    main.append(spinner());
    const fail = (e) => {
      main.textContent = '';
      main.append(h('div', { class: 'card center stack' },
        h('h2', {}, 'Could not join'), h('p', {}, e.message),
        h('a', { class: 'btn', href: '#/challenges' }, 'Back to challenges')));
    };
    try {
      const pv = await api('/challenge-preview/' + encodeURIComponent(String(code || '').toUpperCase()));
      // Old-style challenges, ones you are already in, and ones that cannot be joined: straight through.
      // Every race asks first, so you can see the category, levels and stake before you commit.
      // A race that is already running or over cannot be joined: send latecomers to the watch page, so they see the live progress or the final positions.
      if (pv.race && !pv.alreadyIn && (pv.status === 'finished' || pv.status === 'cancelled' || pv.started)) return go('/watch/' + pv.id);
      if (!pv.race || pv.alreadyIn || pv.status === 'finished' || pv.status === 'cancelled' || pv.started) {
        const r = await api('/challenges/join', { method: 'POST', body: { code: pv.id } });
        return go('/c/' + r.id);
      }
      main.textContent = '';
      main.classList.add('stack');
      const enough = pv.coins >= pv.stake;
      const err = h('div', { class: 'error', role: 'alert' });
      const joinBtn = (label) => h('button', { class: 'btn block', type: 'button', onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await api('/challenges/join', { method: 'POST', body: { code: pv.id } }); await refreshMe(); go('/c/' + r.id); }
        catch (ex) { err.textContent = ex.message; e.target.disabled = false; }
      } }, label);
      main.append(h('div', { class: 'card center stack' },
        h('h2', {}, pv.sponsor ? `${pv.sponsor.name} sponsored race` : `${pv.host} invited you to a race`),
        sponsorBlock(pv.sponsor, pv.id),
        h('div', { class: 'facts' },
          h('div', {}, h('span', {}, 'Category'), h('b', {}, categoryText(pv.category, pv.inCategory, pv.rounds))),
          h('div', {}, h('span', {}, 'Levels'), h('b', {}, String(pv.rounds))),
          pv.timeLimitMin ? h('div', {}, h('span', {}, 'Timer'), h('b', {}, timerWords(pv.timeLimitMin))) : null,
          h('div', {}, h('span', {}, 'Players'), h('b', {}, `${pv.playerCount} of ${pv.maxPlayers} joined`)),
          h('div', {}, h('span', {}, 'Prize'), h('b', {}, pv.stake ? `${pv.stake} coins each` : 'Bragging rights'))),
        h('p', { class: 'muted' }, 'First to finish all the levels wins.' + (pv.stake ? ` ${pv.split ? 'The top 3 share the pot: 60% to the winner, 25% and 15% to the next two players who cleared the most levels' : 'The winner takes the whole pot'}${pv.pot ? ` (${pv.pot} coins so far)` : ''}. You get your coins back if the race is cancelled or you leave before it starts.` : '')),
        pv.stake ? h('p', { class: 'muted' }, `You have ${pv.coins} coins.`) : null,
        err,
        enough
          ? joinBtn(pv.stake ? `Join and stake ${pv.stake} coins` : 'Join race')
          : h('button', { class: 'btn block', type: 'button', onclick: () => buyCoins() }, `You need ${pv.stake - pv.coins} more coins. Buy coins`),
        h('a', { class: 'btn alt block', href: '#/challenges' }, 'No thanks')));
    } catch (e) { fail(e); }
  }

  // The strip above the puzzle: who is racing. Scores stay hidden until you finish, because
  // friends play at different times, so we show how far along everyone is instead.
  function racerEl(name, avatar, line, opts = {}) {
    return h('div', { class: 'racer' + (opts.end ? ' end' : '') + (opts.you ? ' you' : '') },
      avatar, h('div', { class: 'who' }, h('b', {}, name), h('span', {}, line)));
  }
  function raceHeader(s) {
    const progress = (p) => (s.race ? (p.done ? 'Finished!' : `${p.solved} of ${s.rounds}`) : p.done ? 'Finished' : `Round ${Math.min(p.idx + 1, s.rounds)}`);
    const self = s.players.find((p) => p.you);
    if (s.group) {
      return h('div', { class: 'race group' },
        h('div', { class: 'race-label' }, (s.race ? `GROUP RACE: ${s.rounds} LEVELS` : 'GROUP RACE') + (watchingText(s.watching) ? ' · ' + watchingText(s.watching) : '')),
        h('div', { class: 'racers' }, (() => {
          let list = s.players;
          let more = 0;
          if (s.race && list.length > 8) {
            // a big race: live leaderboard, the top 5 plus you
            list = [...list].sort((a, b) => (b.done - a.done) || (b.solved - a.solved) || (b.score - a.score));
            const top = list.slice(0, 5), mine = list.find((p) => p.you);
            more = list.length - top.length - (mine && !top.includes(mine) ? 1 : 0);
            list = mine && !top.includes(mine) ? [...top, mine] : top;
          }
          const rows = list.map((p) => racerEl(p.you ? 'You' : p.username, avatarEl(p.avatar, p.username, 'small', p.tier), progress(p), { you: p.you }));
          if (more > 0) rows.push(h('div', { class: 'muted center racers-more' }, `+ ${more} more racing`));
          return rows;
        })()));
    }
    const other = s.players.find((p) => !p.you);
    return h('div', { class: 'race' },
      racerEl('You', avatarEl(self.avatar, self.username, 'race'), s.race ? progress(self) : `${s.me.score} pts`, { you: true }),
      h('div', { class: 'race-mid' }, h('div', { class: 'bolt', 'aria-hidden': 'true' }, '⚡'), h('b', {}, 'VS'), h('small', {}, s.race ? `${s.rounds} LEVELS` : 'RACE MODE'), watchingText(s.watching) ? h('small', {}, watchingText(s.watching)) : null),
      other
        ? racerEl(other.username, avatarEl(other.avatar, other.username, 'race'), progress(other), { end: true })
        : racerEl('Waiting', avatarEl(null, '?', 'race'), 'for a friend', { end: true }));
  }

  // Waiting room for a race: see who has joined, then the host starts everybody together.
  function renderLobby(main, s) {
    main.classList.add('stack');
    const share = shareLink(s.id, s.group, s.rounds, s.stake, s.category, s.split);
    const card = h('div', { class: 'card center stack' },
      h('h2', {}, raceTitle(s.game, s.rounds)),
      sponsorBlock(s.sponsor, s.id),
      h('p', { class: 'cat-line' }, '🏷️ Category: ', h('b', {}, categoryText(s.category, s.inCategory, s.rounds))),
      s.timeLimitMin ? h('p', { class: 'cat-line' }, '⏱ Timer: ', h('b', {}, timerWords(s.timeLimitMin)), h('div', { class: 'muted' }, 'Starts when the host presses Start. When it runs out, whoever cleared the most levels wins.')) : null,
      s.stake ? h('div', { class: 'code-box' }, `${s.stake} coins each, pot ${s.pot}`) : null,
      s.stake ? h('p', { class: 'muted' }, (s.split ? 'The top 3 share the pot: 60% to the winner, 25% and 15% to the next two players who cleared the most levels. ' : 'The winner takes the whole pot. ') + 'Stakes are refunded if the race is cancelled or not started within 24 hours. A started race ends after 3 days: most levels cleared wins the pot (a tie refunds everyone).') : null,
      h('p', { class: 'muted' }, (s.game === 'wordsearch' ? 'Everybody gets the same word searches. First to find every word in all of them wins. ' : s.game === 'slide' ? 'Everybody gets the same pictures with the same shuffle. First to rebuild all of them wins. ' : 'First to finish all the levels wins. ') + 'Everybody starts at the same time, and the race ends the moment someone finishes.'));
    const list = h('ul', { class: 'list' });
    const fill = (players) => {
      list.textContent = '';
      for (const p of players) list.append(h('li', { class: p.you ? 'you' : '' },
        avatarEl(p.avatar, p.username, 'small'),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, p.you ? `${p.username} (you)` : p.username))));
    };
    fill(s.players);
    card.append(h('h3', {}, `${s.playerCount} of ${s.maxPlayers} in the lobby`), list);
    const watchLine = h('p', { class: 'muted' }, watchingText(s.watching));
    card.append(watchLine, h('p', { class: 'muted' }, 'Friends without a place in the race can watch it live with a watch link.'), watchButtons(s));
    if (s.playerCount < s.maxPlayers) {
      card.append(h('div', { class: 'code-box' }, s.id),
        h('div', { class: 'row' },
          h('a', { class: 'btn green grow', href: share.wa, target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'),
          h('button', { class: 'btn alt grow', type: 'button', onclick: () => copyText(share.text) }, 'Copy invite')));
    }
    if (s.canStart) {
      card.append(h('button', { class: 'btn block', type: 'button', onclick: async () => {
        if (!window.confirm('Start the race now? Nobody else will be able to join.')) return;
        try { await api(`/challenges/${s.id}/start`, { method: 'POST' }); viewChallenge(s.id); }
        catch (e) { NS.toast(e.message, true); }
      } }, 'Start race'));
    } else if (s.host === me.username) {
      card.append(h('p', { class: 'muted' }, 'You can start as soon as one friend has joined.'));
    } else {
      card.append(h('p', { class: 'muted' }, `Waiting for ${s.host} to start the race. This page updates by itself.`));
    }
    if (s.canCancel) {
      card.append(h('button', { class: 'btn alt block', type: 'button', onclick: async () => {
        if (!window.confirm(s.stake ? 'Cancel this race? Everyone gets their stake back.' : 'Cancel this race?')) return;
        try { await api(`/challenges/${s.id}/cancel`, { method: 'POST' }); await refreshMe(); go('/challenges'); }
        catch (e) { NS.toast(e.message, true); }
      } }, s.stake ? 'Cancel race and refund' : 'Cancel race'));
    }
    if (s.canLeave) {
      card.append(h('button', { class: 'btn alt block', type: 'button', onclick: async () => {
        if (!window.confirm(s.stake ? 'Leave this race? You get your stake back.' : 'Leave this race?')) return;
        try { await api(`/challenges/${s.id}/leave`, { method: 'POST' }); await refreshMe(); go('/challenges'); }
        catch (e) { NS.toast(e.message, true); }
      } }, s.stake ? 'Leave and get my coins back' : 'Leave race'));
    }
    main.append(card);
    const timer = setInterval(async () => {
      if (!main.isConnected) { clearInterval(timer); return; }
      try {
        const r = await api(`/challenges/${s.id}/progress`);
        if (r.status === 'cancelled') { clearInterval(timer); refreshMe(); viewChallenge(s.id); return; }
        if (r.started || r.playerCount !== s.playerCount) { clearInterval(timer); viewChallenge(s.id); return; }
        fill(r.players);
        watchLine.textContent = watchingText(r.watching);
      } catch { /* try again next time */ }
    }, 3000);
  }

  // Watch a race you are not in (opened from a shared watch link). Shows progress only.
  async function viewWatch(code) {
    const main = shell('challenges');
    main.classList.add('stack');
    main.append(spinner());
    const code6 = String(code || '').toUpperCase();
    let timer = null;
    const draw = (w) => {
      main.textContent = '';
      const status = w.cancelled ? 'This race was cancelled.'
        : w.finished ? `${w.winnerName || 'Someone'} won the race!`
        : !w.started ? 'Waiting for the host to start the race.'
        : 'The race is live. First to clear every level wins.';
      const list = h('ul', { class: 'list' });
      w.players.forEach((p, i) => list.append(h('li', {},
        h('div', { class: 'rank' }, w.finished ? String(i + 1) : ''),
        avatarEl(p.avatar, p.username, 'small', p.tier),
        h('div', { class: 'grow' }, h('div', { class: 'name' }, p.username),
          h('div', { class: 'muted' }, p.done ? 'Finished!' : w.started ? `${p.solved} of ${w.rounds} levels` : 'In the lobby')),
        w.finished && p.prize ? h('b', {}, `+${p.prize} coins`) : null)));
      main.append(h('div', { class: 'card center stack' },
        h('h2', {}, raceTitle(w.game, w.rounds)),
        h('p', { class: 'cat-line' }, '🏷️ Category: ', h('b', {}, categoryText(w.category, w.inCategory, w.rounds))),
        h('h3', {}, status),
        w.stake ? h('p', { class: 'muted' }, `${w.stake} coins each, pot ${w.pot}${w.split ? ', top 3 share it' : ''}`) : null,
        watchingText(w.watching) ? h('p', { class: 'muted' }, watchingText(w.watching)) : null,
        h('h3', {}, `${w.playerCount} racing`), list,
        h('p', { class: 'muted' }, 'You are watching. You can only see how far everyone has got.'),
        !w.started && !w.cancelled && w.playerCount < w.maxPlayers ? h('a', { class: 'btn block', href: `#/join/${w.id}` }, 'Join this race instead') : null,
        h('a', { class: 'btn alt block', href: '#/' }, 'Back to home')));
    };
    const load = async () => {
      try {
        const w = await api('/watch/' + encodeURIComponent(code6));
        if (w.participant) { clearInterval(timer); return go('/c/' + w.id); }
        draw(w);
        if (w.finished || w.cancelled) clearInterval(timer);
      } catch (e) {
        clearInterval(timer);
        main.textContent = '';
        main.append(h('div', { class: 'card center stack' }, h('h2', {}, 'Cannot watch this race'), h('p', {}, e.message), h('a', { class: 'btn', href: '#/' }, 'Back to home')));
      }
    };
    await load();
    timer = setInterval(() => { if (!main.isConnected) { clearInterval(timer); return; } load(); }, 4000);
  }

  async function viewChallenge(id) {
    const main = shell('challenges');
    main.append(spinner());
    try {
      const s = await api('/challenges/' + encodeURIComponent(id));
      main.textContent = '';
      if (s.cancelled) {
        refreshMe();
        main.classList.add('stack');
        return main.append(h('div', { class: 'card center stack' },
          h('h2', {}, s.timedOut ? 'Time ran out' : 'This race was cancelled'),
          h('p', {}, s.timedOut ? 'Nobody was clearly ahead when the timer ended' + (s.stake ? ', so everyone got their stake back.' : '.') : s.stake ? 'Everyone got their stake back.' : 'Nobody played.'),
          h('a', { class: 'btn', href: '#/challenges' }, 'Back to challenges')));
      }
      if (s.race && !s.started) return renderLobby(main, s);
      if (s.me.done) return renderChallengeResults(main, s);

      let sub;
      if (s.game === 'slide') sub = `Live sliding puzzle race${s.stake ? `, pot ${s.pot} coins` : ''}. Same pictures and same shuffle for everybody, no hints and no skipping. First to rebuild them all wins.`;
      else if (s.game === 'wordsearch') sub = `Live word search race${s.stake ? `, pot ${s.pot} coins` : ''}. Same word searches for everybody, no hints and no skipping. First to finish them all wins.`;
      else if (s.race) sub = `Live race${s.stake ? `, pot ${s.pot} coins` : ''}. Skipped levels come back at the end. First to clear all levels wins.`;
      else if (s.group) sub = `${s.playerCount} of ${s.maxPlayers} joined. Scores show when you finish.`;
      else if (s.opponent) sub = 'Scores show when you finish.';
      else sub = 'Your friend has not joined yet. You can start now.';
      const pill = h('div', { class: 'round-pill' }, s.race ? `Level ${s.round}/${s.rounds}` : `Round ${s.round}/${s.rounds}`);
      const headHolder = h('div', {}, raceHeader(s));
      main.append(pill, s.race && s.endsAt ? raceClock(s.endsAt, () => setTimeout(() => viewChallenge(id), 800)) : null, headHolder, h('p', { class: 'muted center note' }, sub));
      if (s.race) main.append(watchButtons(s));
      const holder = h('div');
      if (s.game !== 'wordsearch' && s.game !== 'slide') main.append(h('div', { class: 'card' }, holder));
      const next = () => viewChallenge(id);

      // In a race, keep everyone's progress fresh and notice when somebody else wins.
      if (s.race) {
        const timer = setInterval(async () => {
          if (!main.isConnected) { clearInterval(timer); return; }
          try {
            const r = await api(`/challenges/${id}/progress`);
            if (r.finished || r.cancelled) { clearInterval(timer); NS.toast(r.cancelled ? 'Time ran out.' : r.timedOut ? `Time ran out. ${r.winnerName || 'Someone'} won with the most levels.` : `${r.winnerName || 'Someone'} finished first!`); viewChallenge(id); return; }
            headHolder.textContent = '';
            headHolder.append(raceHeader({ ...s, players: r.players, watching: r.watching, me: { ...s.me, score: s.me.score } }));
          } catch { /* try again next time */ }
        }, 4000);
      }
      const raceOver = (e) => { if (e.status === 409) { NS.toast(e.message, true); setTimeout(next, 1500); } };
      if (s.game === 'wordsearch') {
        const w = s.wordsearch;
        const board = wsBoard(w, {
          select: async (r1, c1, r2, c2) => {
            try { return await api(`/challenges/${id}/ws-select`, { method: 'POST', body: { id: w.id, r1, c1, r2, c2 } }); }
            catch (e) { raceOver(e); throw e; }
          },
          onResult: (x) => {
            if (!x.levelDone) return;
            setStats({ points: me.points });
            if (x.won) setTimeout(() => NS.sound.play('win'), 350);
            resultDialog({ title: x.won ? 'You won the race!' : 'Word search done!', answer: x.theme || 'All words found', fact: x.fact, factLocked: x.factLocked, extra: `+${x.points} points`, button: x.finished ? 'See results' : 'Next word search', onNext: next });
          },
          onError: (e) => NS.toast(e.message, true),
        });
        main.append(board.bar, board.card, board.words);
        return;
      }
      if (s.game === 'slide') {
        const w = s.slide;
        const board = slideBoard(w, {
          move: async (pos) => {
            try { return await api(`/challenges/${id}/sl-move`, { method: 'POST', body: { id: w.id, pos } }); }
            catch (e) { raceOver(e); throw e; }
          },
          onResult: (x) => {
            if (!x.levelDone) return;
            setStats({ points: me.points });
            if (x.won) setTimeout(() => NS.sound.play('win'), 350);
            resultDialog({ title: x.won ? 'You won the race!' : 'Puzzle done!', answer: x.title || 'Picture rebuilt', fact: x.fact, factLocked: x.factLocked, extra: `+${x.points} points`, button: x.finished ? 'See results' : 'Next puzzle', onNext: next });
          },
          onError: (e) => NS.toast(e.message, true),
        });
        const peekBtn = h('button', { class: 'hint-btn', type: 'button', 'aria-label': 'Peek at the picture' }, h('span', { class: 'hint-ico', 'aria-hidden': 'true' }, '👁'), h('span', { class: 'hint-label' }, 'Peek at the picture'));
        peekBtn.addEventListener('click', () => board.peek());
        main.append(board.bar, board.card, h('div', { class: 'hint-bar' }, peekBtn));
        return;
      }
      NS.mountGame(holder, s.puzzle, {
        onGuess: async (guess) => {
          try { return await api(`/challenges/${id}/guess`, { method: 'POST', body: { guess } }); }
          catch (e) { raceOver(e); throw e; }
        },
        onSkip: async () => {
          try {
            const x = await api(`/challenges/${id}/skip`, { method: 'POST' });
            resultDialog({ title: 'Skipped', answer: x.answer, fact: x.fact, factLocked: x.factLocked, extra: s.race ? '10 points off. This level comes back at the end.' : '10 points taken off for skipping.', button: x.finished ? 'See results' : s.race ? 'Next level' : 'Next round', onNext: next });
          } catch (e) { NS.toast(e.message, true); raceOver(e); }
        },
        skipNote: s.race ? '-10 points, comes back' : '-10 points',
        onCorrect: (x) => {
          setStats({ points: me.points });
          if (x.won) setTimeout(() => NS.sound.play('win'), 350);
          resultDialog({ title: x.won ? 'You won the race!' : 'Correct!', answer: x.answer, fact: x.fact, factLocked: x.factLocked, extra: `+${x.points} points`, button: x.finished ? 'See results' : s.race ? 'Next level' : 'Next round', onNext: next });
        },
      });
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewChallenge(id))); }
  }

  function roundsCard(title, rounds, collapsed) {
    const wrap = (table) => (collapsed
      ? h('details', {}, h('summary', {}, `${title} (${rounds.length} tries)`), table)
      : [h('h3', {}, title), table]);
    return h('div', { class: 'card' },
      ...[].concat(wrap(h('table', { class: 'results-table' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Word'), h('th', {}, 'Time'), h('th', { class: 'num' }, 'Points'))),
        h('tbody', {}, rounds.map((r) => h('tr', {},
          h('td', {}, r.answer), h('td', {}, r.solved ? `${r.seconds}s` : 'Skipped'), h('td', { class: 'num' }, String(r.points)))))))));
  }

  function renderChallengeResults(main, s) {
    main.classList.add('stack');
    const finished = s.status === 'finished';
    const oppName = s.opponent ? s.opponent.username : null;

    let title;
    if (s.race) {
      if (s.winner === 'me') title = 'You won the race!';
      else title = s.group ? `${s.winnerName} won. You came ${ordinal(s.place)} of ${s.playerCount}` : `${s.winnerName} won the race`;
    } else if (!finished) title = 'You finished!';
    else if (s.winner === 'me') title = 'You won!';
    else if (s.winner === 'draw') title = s.group ? 'You tied for first!' : 'It is a draw';
    else title = s.group ? `You came ${ordinal(s.place)} of ${s.playerCount}` : `${oppName} won this one`;
    refreshMe();

    const card = h('div', { class: 'card center' }, h('h2', {}, title), sponsorBlock(s.sponsor, s.id));
    if (s.sponsor && finished && s.sponsor.prizeStatus && s.sponsor.prizeStatus !== 'none') {
      const ps = s.sponsor.prizeStatus, sp = s.sponsor;
      if (sp.prizeYou) card.append(h('p', { class: 'sponsor-win' },
        ps === 'paid' ? `Your ${sp.name} prize has been sent: ${sp.prize}. Enjoy!`
          : ps === 'approved' ? `Your entry is approved. The ${sp.name} prize (${sp.prize}) is being sent to you.`
            : `You are the winner of the ${sp.name} prize: ${sp.prize}. We are checking your entry first and will contact you by email, so make sure the email on your profile is correct.`));
      else card.append(h('p', { class: 'sponsor-win' }, `${sp.prizeToName} won the ${sp.name} prize (${sp.prize}). ${ps === 'paid' ? 'The prize has been sent.' : ps === 'approved' ? 'The prize is being sent.' : 'The winner is being checked.'}`));
    } else if (s.sponsor && finished && s.winner === 'me' && s.sponsor.prizeStatus === 'none') card.append(h('p', { class: 'sponsor-win' }, 'Your win could not be approved for the sponsor prize.'));
    if (s.race) {
      card.append(h('p', {}, s.winner === 'me'
        ? `You cleared all ${s.rounds} levels first.${s.prize ? ` You won ${s.split ? 'the biggest share of the pot' : 'the pot'}: ${s.prize} coins (${s.prize - s.youStaked >= 0 ? '+' : ''}${s.prize - s.youStaked} coins).` : ''}`
        : s.prize
          ? `You cleared ${s.me.solved} of ${s.rounds} levels and came ${ordinal(s.place)}. You won ${s.prize} coins from the pot (${s.prize - s.youStaked >= 0 ? '+' : ''}${s.prize - s.youStaked} coins).`
          : `You cleared ${s.me.solved} of ${s.rounds} levels.${s.youStaked ? ` You lost your ${s.youStaked}-coin stake.` : ''}`));
    } else if (!s.group && s.opponent) {
      card.append(h('div', { class: 'versus' },
        h('div', {}, h('b', {}, String(s.me.score)), 'You'),
        h('div', { class: 'vs' }, 'vs'),
        h('div', {}, h('b', {}, s.opponent.score == null ? '?' : String(s.opponent.score)), oppName)));
    } else {
      card.append(h('p', {}, `You scored ${s.me.score}.`));
    }
    if (s.race && finished && s.split && s.prizes.length) card.append(h('p', { class: 'muted' }, 'Prizes: ' + s.prizes.map((p) => `${p.username} ${p.coins} coins`).join(', ')));
    main.append(card);

    // Group standings: final ranking when finished, live progress before that.
    if (s.group || s.race) {
      main.append(h('div', { class: 'card' },
        h('h3', {}, finished ? 'Final standings' : 'Standings so far'),
        h('ul', { class: 'list' }, s.players.map((p, i) => h('li', { class: p.you ? 'you' : '' },
          h('span', { class: 'rank' }, finished ? String(i + 1) : '•'),
          avatarEl(p.avatar, p.username, 'small', p.tier),
          h('div', { class: 'grow' }, h('div', { class: 'name' }, h('a', { href: profileLink(p.username) }, p.you ? `${p.username} (you)` : p.username))),
          s.race
            ? (p.done ? h('b', {}, 'Finished first') : h('span', { class: 'muted' }, `${p.solved} of ${s.rounds} levels`))
            : p.done
              ? h('b', {}, `${p.score} pts`)
              : h('span', { class: 'muted' }, `playing ${Math.min(p.idx + 1, s.rounds)} of ${s.rounds}`))))));
    }

    // One banner on the finished results page (a full page, never a pop-up), with clear space around it.
    if (finished && window.NS_resultsAdEl) { const ra = window.NS_resultsAdEl(); if (ra) main.append(h('div', { class: 'results-ad' }, ra)); }

    if (!finished && !s.race) {
      const share = shareLink(s.id, s.group, s.rounds);
      const wait = h('div', { class: 'card center stack' });
      if (s.group) {
        wait.append(h('h3', {}, s.closed ? 'Waiting for everyone to finish' : `${s.playerCount} of ${s.maxPlayers} players have joined`));
        if (!s.closed) {
          wait.append(
            h('div', { class: 'code-box' }, s.id),
            h('p', { class: 'muted' }, 'More friends can join with this code until the group is full or locked.'),
            h('div', { class: 'row' },
              h('a', { class: 'btn green grow', href: share.wa, target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'),
              h('button', { class: 'btn alt grow', type: 'button', onclick: () => copyText(share.text) }, 'Copy invite')));
        }
        if (s.canLock) {
          wait.append(h('button', { class: 'btn block', type: 'button', onclick: async () => {
            if (!window.confirm('Lock the group? Nobody else will be able to join.')) return;
            try { await api(`/challenges/${s.id}/lock`, { method: 'POST' }); viewChallenge(s.id); }
            catch (e) { NS.toast(e.message, true); }
          } }, 'Lock group and finish'));
        }
        wait.append(h('button', { class: 'btn alt', type: 'button', onclick: () => viewChallenge(s.id) }, 'Refresh'));
      } else if (!s.opponent) {
        wait.append(h('h3', {}, 'Send this code to a friend'), h('div', { class: 'code-box' }, s.id),
          h('div', { class: 'row' },
            h('a', { class: 'btn green grow', href: share.wa, target: '_blank', rel: 'noopener' }, 'Share on WhatsApp'),
            h('button', { class: 'btn alt grow', type: 'button', onclick: () => copyText(share.text) }, 'Copy invite')));
      } else {
        wait.append(h('h3', {}, `Waiting for ${oppName} to finish`),
          h('p', { class: 'muted' }, `${oppName} has played ${s.opponent.idx} of ${s.rounds} rounds. Check back soon.`),
          h('button', { class: 'btn alt', type: 'button', onclick: () => viewChallenge(s.id) }, 'Refresh'));
      }
      main.append(wait);
    }

    main.append(roundsCard('Your levels', s.results.me, s.race));
    for (const o of s.results.others || []) main.append(roundsCard(`${o.username}'s levels`, o.rounds, s.race));

    main.append(h('div', { class: 'row' },
      h('a', { class: 'btn grow', href: '#/challenges' }, 'More challenges'),
      !s.group && oppName ? h('button', { class: 'btn alt grow', type: 'button', onclick: async () => {
        try { const r = await api('/challenges', { method: 'POST', body: s.race ? { opponent: oppName, levels: s.rounds, ...(s.game === 'wordsearch' ? { category: WS_TAB } : s.game === 'slide' ? { category: SL_TAB } : {}) } : { opponent: oppName } }); go('/c/' + r.id); }
        catch (e) { NS.toast(e.message, true); }
      } }, 'Rematch') : null));
  }

  async function refreshMe() {
    try { const r = await api('/me'); me = r.user; setStats(me); } catch { /* ignore */ }
  }


  // ---------- chat: the group room, private messages, @mentions, edit and delete ----------
  const MENTION_RE = /(@[A-Za-z0-9_]{3,20})/g;
  // Message text as DOM nodes (never HTML). @name of a real player is highlighted.
  function chatTextNodes(text, mentions) {
    const real = new Set((mentions || []).map((n) => n.toLowerCase()));
    return text.split(MENTION_RE).map((part) => {
      if (part[0] === '@' && real.has(part.slice(1).toLowerCase())) return h('span', { class: 'mention' + (part.slice(1).toLowerCase() === me.username.toLowerCase() ? ' me' : '') }, part);
      return part;
    });
  }
  function chatTabs(active, unread) {
    return h('div', { class: 'chat-tabs', role: 'tablist' },
      h('a', { class: 'chat-tab', role: 'tab', 'aria-selected': active === 'room' ? 'true' : 'false', href: '#/chat' }, 'Everyone'),
      h('a', { class: 'chat-tab', role: 'tab', 'aria-selected': active === 'dm' ? 'true' : 'false', href: '#/chat/dm' }, 'Private', unread ? h('span', { class: 'chat-unread' }, String(unread)) : null));
  }

  // One conversation: the group room (to = null) or a private thread with player `to`.
  async function chatPane(main, to) {
    const base = to ? `/chat/dm/${encodeURIComponent(to)}` : '/chat';
    const log = h('div', { class: 'chat-log', role: 'log', 'aria-live': 'polite', 'aria-label': to ? `Private messages with ${to}` : 'Chat messages' });
    const input = h('input', { type: 'text', id: 'chatmsg', maxlength: '300', autocomplete: 'off', placeholder: to ? `Message ${to}...` : 'Say something to everybody... (use @name to call someone)', 'aria-label': 'Your message' });
    const send = h('button', { class: 'btn', type: 'submit' }, 'Send');
    const idleNote = to ? 'Only you and ' + to + ' can see this. No links allowed.' : 'Be kind. No links allowed, but you can share a challenge code.';
    const note = h('div', { class: 'muted chat-note' }, idleNote);
    const suggest = h('div', { class: 'chat-suggest', hidden: true });
    const form = h('form', { class: 'chat-form', novalidate: true }, input, send);
    const pinBar = h('div', { class: 'chat-pins hidden' });
    main.append(h('div', { class: 'card chat-card' }, pinBar, log, suggest, form, note));

    let lastId = 0, isAdminUser = false;
    const rows = new Map();
    const names = new Map();       // lower-case -> name, of the people seen in this chat (for @ suggestions)
    const timeOf = (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const note2 = (m) => { names.set(m.username.toLowerCase(), m.username); };

    function insertMention(name) {
      input.value = (input.value.replace(/@[A-Za-z0-9_]*$/, '') + '@' + name + ' ').slice(0, 300);
      suggest.hidden = true; input.focus();
    }
    input.addEventListener('input', () => {
      const m = /@([A-Za-z0-9_]*)$/.exec(input.value);
      suggest.textContent = '';
      if (!m || to) { suggest.hidden = true; return; }
      const q = m[1].toLowerCase();
      const hits = [...names].filter(([k, n]) => k.startsWith(q) && k !== me.username.toLowerCase()).slice(0, 5);
      for (const [, n] of hits) suggest.append(h('button', { class: 'chat-sug', type: 'button', onclick: () => insertMention(n) }, '@' + n));
      suggest.hidden = !hits.length;
    });

    function startEdit(m, el) {
      const textEl = el.querySelector('.chat-text');
      const box = h('input', { type: 'text', class: 'chat-edit', maxlength: '300', value: m.text, 'aria-label': 'Edit your message' });
      const save = h('button', { class: 'btn small', type: 'button' }, 'Save');
      const cancel = h('button', { class: 'btn small alt', type: 'button' }, 'Cancel');
      const bar = h('div', { class: 'chat-edit-bar' }, box, save, cancel);
      textEl.replaceWith(bar); box.focus();
      const done = () => bar.replaceWith(textEl);
      cancel.addEventListener('click', done);
      const commit = async () => {
        const text = box.value.trim();
        if (!text || text === m.text) return done();
        save.disabled = true;
        try { const r = await api('/chat/' + m.id, { method: 'PUT', body: { text } }); refresh(r.message); }
        catch (e) { NS.toast(e.message, true); save.disabled = false; }
      };
      save.addEventListener('click', commit);
      box.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); commit(); } else if (e.key === 'Escape') done(); });
    }

    function resultEl(m) {
      const who = (n) => h('span', { class: 'rs-p' }, h('a', { class: 'chat-name', href: profileLink(n) }, n), h('span', { class: 'rs-face party', 'aria-hidden': 'true' }, '\u{1F389}'));
      const size = m.result.players > 1 ? ` against ${m.result.players - 1} other player${m.result.players === 2 ? '' : 's'}` : '';
      const del = isAdminUser && !to ? h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
        try { await api('/chat/' + m.id, { method: 'DELETE' }); drop(m.id); } catch (e) { NS.toast(e.message, true); }
      } }, 'Delete') : null;
      let off = false; try { off = localStorage.getItem('ns_hide_results') === '1'; } catch { /* ignore */ }
      return h('div', { class: 'chat-msg chat-result', hidden: off ? true : null, 'data-id': String(m.id), role: 'status' },
        h('div', { class: 'rs-line' }, who(m.result.winner), ' just won a race' + size + '!', h('span', { class: 'chat-time' }, timeOf(m.at)), del));
    }
    function rowEl(m) {
      if (m.result) return resultEl(m);
      note2(m);
      const name = h('a', { class: 'chat-name', href: profileLink(m.username) }, m.username);
      const btn = (label, fn) => h('button', { class: 'linkbtn', type: 'button', onclick: fn }, label);
      const del = () => btn('Delete', async () => {
        if (!window.confirm('Delete this message?')) return;
        try { await api('/chat/' + m.id, { method: 'DELETE' }); drop(m.id); } catch (e) { NS.toast(e.message, true); }
      });
      const pin = () => btn(m.pinned ? 'Unpin' : 'Pin', async () => {
        try { await api(`/chat/${m.id}/pin`, { method: 'POST', body: { pinned: !m.pinned } }); load(false); } catch (e) { NS.toast(e.message, true); }
      });
      const canPin = isAdminUser && m.admin && !to;
      let tools = null;
      if (m.mine) {
        tools = h('span', { class: 'chat-tools' }, ...(canPin ? [pin()] : []), btn('Edit', () => startEdit(m, rows.get(m.id))), del());
      } else if (!to) {
        tools = h('span', { class: 'chat-tools' },
          btn('Reply', () => { input.value = (input.value + (input.value && !input.value.endsWith(' ') ? ' ' : '') + '@' + m.username + ' ').slice(0, 300); input.focus(); }),
          h('a', { class: 'linkbtn', href: '#/chat/dm/' + encodeURIComponent(m.username) }, 'Message'),
          ...(isAdminUser ? [...(canPin ? [pin()] : []), del(), btn('Mute 24h', async () => {
            if (!window.confirm(`Mute ${m.username} for 24 hours and delete this message?`)) return;
            try { await api(`/chat/${m.id}/mute`, { method: 'POST' }); drop(m.id); NS.toast(`${m.username} muted for 24 hours`); } catch (e) { NS.toast(e.message, true); }
          })] : []));
      }
      const tagged = m.mentions && m.mentions.some((n) => n.toLowerCase() === me.username.toLowerCase());
      return h('div', { class: 'chat-msg' + (m.mine ? ' mine' : '') + (m.admin ? ' admin-msg' : '') + (tagged ? ' tagged' : ''), 'data-id': String(m.id) },
        h('a', { class: 'chat-ava', href: profileLink(m.username), 'aria-label': `See ${m.username}'s profile` }, avatarEl(m.avatar, m.username, 'small', m.tier)),
        h('div', { class: 'chat-body' },
          h('div', { class: 'chat-head' }, name, m.pinned ? h('span', { class: 'pin-tag' }, 'Pinned') : null, m.premium ? premiumMark() : null, m.admin ? adminTag() : null, m.icon ? h('span', { class: 'title-mini', title: m.title }, m.icon) : null, h('span', { class: 'chat-time' }, timeOf(m.at) + (m.edited ? ' (edited)' : '')), tools),
          h('div', { class: 'chat-text' }, ...chatTextNodes(m.text, m.mentions)),
          m.challenge ? h('a', { class: 'btn small chat-join', href: '#/join/' + m.challenge.id },
            `Join race ${m.challenge.id}: ${m.challenge.category || 'Mix'}, ${m.challenge.rounds} levels(${m.challenge.players}/${m.challenge.maxPlayers})`) : null));
    }
    function drop(id) { const el = rows.get(id); if (el) { el.remove(); rows.delete(id); } }
    function refresh(m) { const old = rows.get(m.id); if (!old) return; const el = rowEl(m); old.replaceWith(el); rows.set(m.id, el); }
    function add(list) {
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 90;
      for (const m of list) {
        if (rows.has(m.id)) continue;
        const el = rowEl(m);
        rows.set(m.id, el);
        log.append(el);
        lastId = Math.max(lastId, m.id);
      }
      while (log.children.length > 200) { const first = log.firstElementChild; rows.delete(Number(first.dataset.id)); first.remove(); }
      if (nearBottom || list.some((m) => m.mine)) log.scrollTop = log.scrollHeight;
    }
    function drawPins(list) {
      pinBar.textContent = '';
      pinBar.classList.toggle('hidden', !list.length);
      for (const m of list) {
        pinBar.append(h('div', { class: 'chat-pin' },
          h('span', { class: 'pin-tag' }, 'Pinned'), h('b', {}, m.username), adminTag(), h('div', { class: 'chat-pin-text' }, ...chatTextNodes(m.text, m.mentions)),
          isAdminUser ? h('button', { class: 'linkbtn', type: 'button', onclick: async () => {
            try { await api(`/chat/${m.id}/pin`, { method: 'POST', body: { pinned: false } }); load(false); } catch (e) { NS.toast(e.message, true); }
          } }, 'Unpin') : null));
      }
    }
    let editing = false;
    async function load(first) {
      try {
        const r = await api(base + (lastId ? `?after=${lastId}` : ''));
        if (r.admin != null) isAdminUser = r.admin;
        if (!to) setLive(r);
        for (const id of r.removed || []) drop(id);
        if (r.pinned) drawPins(r.pinned);
        if (!editing) for (const m of r.edited || []) { const old = rows.get(m.id); if (old && !old.querySelector('.chat-edit')) refresh(m); }
        if (first && !r.messages.length) log.append(h('p', { class: 'muted center chat-empty' }, to ? `No messages yet. Say hello to ${to}!` : 'No messages yet. Say hello!'));
        if (r.messages.length) { log.querySelector('.chat-empty')?.remove(); add(r.messages); }
        const paused = !to && !!(r.lock && r.lock.locked) && !r.admin;
        input.disabled = r.muted || paused; send.disabled = r.muted || paused;
        note.textContent = r.muted ? 'A moderator has muted you for a while.'
          : paused ? 'Chat is paused by the admin' + (r.lock.note ? ': ' + r.lock.note : '.') + (r.lock.until ? ' It reopens about ' + timeOf(r.lock.until) + '.' : '')
          : (!to && r.lock && r.lock.locked) ? 'Chat is paused for players. You can still write as admin.' : idleNote;
      } catch (e) { if (first) { main.textContent = ''; main.append(errorCard(e, () => route())); } }
    }
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      send.disabled = true;
      try {
        const r = await api('/chat', { method: 'POST', body: to ? { text, to } : { text } });
        input.value = ''; suggest.hidden = true;
        log.querySelector('.chat-empty')?.remove();
        add([r.message]);
      } catch (ex) { NS.toast(ex.message, true); }
      send.disabled = false;
      input.focus();
    });

    await load(true);
    log.scrollTop = log.scrollHeight;
    const timer = setInterval(() => {
      if (!main.isConnected) { clearInterval(timer); return; }
      if (!document.hidden) load(false);
    }, 3000);
  }

  async function viewChat() {
    const main = shell('chat', { live: true });   // the player count shows only above the public chat
    main.classList.add('chat-page');
    let unread = 0;
    try { unread = (await api('/chat/dm')).unread; } catch { /* the tab just shows no number */ }
    main.append(chatTabs('room', unread));
    await chatPane(main, null);
  }

  async function viewDmList() {
    const main = shell('chat');
    main.classList.add('chat-page');
    const box = h('div', { class: 'stack' });
    const who = h('input', { type: 'text', maxlength: '20', placeholder: 'Player username', 'aria-label': 'Username to message' });
    const start = h('form', { class: 'chat-form dm-new', novalidate: true }, who, h('button', { class: 'btn', type: 'submit' }, 'Message'));
    start.addEventListener('submit', (e) => { e.preventDefault(); const n = who.value.trim(); if (n) go('/chat/dm/' + encodeURIComponent(n)); });
    main.append(box);
    const draw = async () => {
      try {
        const r = await api('/chat/dm');
        box.textContent = '';
        box.append(chatTabs('dm', r.unread), h('div', { class: 'card' }, h('div', { class: 'muted' }, 'Start a private chat with any player:'), start));
        if (!r.conversations.length) box.append(h('p', { class: 'muted center' }, 'No private messages yet. You can also tap Message under anybody in the group chat or on their profile.'));
        for (const c of r.conversations) {
          box.append(h('a', { class: 'card dm-row' + (c.unread ? ' unread' : ''), href: '#/chat/dm/' + encodeURIComponent(c.username) },
            avatarEl(c.avatar, c.username, 'small', c.tier),
            h('div', { class: 'grow dm-mid' }, h('b', {}, c.username, c.online ? ' 🟢' : ''), h('div', { class: 'muted dm-last' }, (c.last.mine ? 'You: ' : '') + c.last.text)),
            c.unread ? h('span', { class: 'chat-unread' }, String(c.unread)) : null));
        }
      } catch (e) { box.textContent = ''; box.append(errorCard(e, () => viewDmList())); }
    };
    await draw();
    const timer = setInterval(() => { if (!main.isConnected) return clearInterval(timer); if (!document.hidden && document.activeElement !== who) draw(); }, 8000);
  }

  async function viewDm(name) {
    const main = shell('chat');
    main.classList.add('chat-page');
    main.append(h('div', { class: 'dm-head' },
      h('a', { class: 'btn small alt', href: '#/chat/dm' }, '‹ Private'),
      h('a', { class: 'chat-name dm-with', href: profileLink(name) }, name)));
    await chatPane(main, name);
  }

  // ---------- leaderboard ----------
  // ---------- rank titles and badges ----------
  function titleChip(t) { return h('span', { class: 'title-chip tier-t' + t.tier, title: t.name }, `${t.icon} ${t.name}`); }
  function badgeGrid(badges, onlyEarned) {
    const list = onlyEarned ? badges.filter((b) => b.earned) : badges;
    if (!list.length) return h('p', { class: 'muted' }, 'No badges yet.');
    return h('div', { class: 'badge-grid' }, list.map((b) => h('div', { class: 'pbadge' + (b.earned ? '' : ' locked'), title: b.desc },
      h('span', { class: 'pbadge-ico', 'aria-hidden': 'true' }, b.icon), h('span', { class: 'pbadge-name' }, b.name),
      h('span', { class: 'pbadge-desc muted' }, b.earned ? 'Earned' : b.desc))));
  }
  const countdown = (ms) => {
    const left = Math.max(0, ms - Date.now());
    const d = Math.floor(left / 86400000), hr = Math.floor((left % 86400000) / 3600000), m = Math.floor((left % 3600000) / 60000);
    return d ? `${d}d ${hr}h` : hr ? `${hr}h ${m}m` : `${m}m`;
  };
  let rankBoard = 'naija';
  async function viewRanks() {
    const main = shell('ranks');
    main.append(spinner());
    try {
      const loadBoards = () => Promise.all([api('/leaderboard?board=' + rankBoard), api('/leaderboard?board=weekly')]);
      const [first, firstWeek] = await loadBoards();
      main.textContent = '';
      main.classList.add('stack');
      const names = { naija: '🇳🇬 Naija', universal: '🌍 Universal', wordsearch: 'Word Search', slide: 'Slide Puzzle' };
      const tabs = h('div', { class: 'rank-tabs four', role: 'tablist', 'aria-label': 'Leaderboard' },
        Object.entries(names).map(([k, label]) => h('button', {
          class: 'rank-tab', type: 'button', role: 'tab', 'aria-selected': k === rankBoard ? 'true' : 'false',
          onclick: () => { rankBoard = k; viewRanks(); },
        }, label)));
      const body = h('div', { class: 'stack' });
      main.append(h('div', { class: 'card' }, tabs), body);

      const paint = (r, wk) => {
        const mine = r.me.rank
          ? `You are number ${r.me.rank} with ${r.me.points} points.`
          : rankBoard === 'wordsearch' ? 'Finish a word search to get on this board.' : rankBoard === 'slide' ? 'Solve a sliding puzzle to get on this board.' : 'Solve a puzzle here to get on this board.';
        const podiumCol = (p, place) => h('div', { class: `pod pod-${place}` },
          place === 1 ? S('svg', { viewBox: '0 0 30 24', width: '30', height: '24', 'aria-hidden': 'true' }, S('path', { d: 'M3 20L1 6l7 6 7-10 7 10 7-6-2 14z', fill: '#f5b82e' })) : null,
          avatarEl(p.avatar, p.username, place === 1 ? 'big' : 'small', p.tier),
          h('a', { class: 'pod-name', href: profileLink(p.username) }, p.username),
          h('div', { class: 'muted' }, `${p.points} pts`),
          h('div', { class: 'pod-step' }, h('b', {}, String(place))));
        const top3 = r.top.slice(0, 3);
        const podium = top3.length
          ? h('div', { class: 'podium' }, [top3[1] ? podiumCol(top3[1], 2) : h('div'), podiumCol(top3[0], 1), top3[2] ? podiumCol(top3[2], 3) : h('div')])
          : null;
        const cards = [h('div', { class: 'card' },
          h('h2', {}, `Top ${names[rankBoard].replace(/^[^A-Za-z]+/, '')} players`),
          h('p', { class: 'muted' }, mine),
          podium,
          r.top.length > 3 ? h('ul', { class: 'list' }, r.top.slice(3).map((p) => h('li', { class: p.you ? 'you' : '' },
            h('span', { class: 'rank' }, String(p.rank)),
            avatarEl(p.avatar, p.username, 'small', p.tier),
            h('div', { class: 'grow' }, h('div', { class: 'name' }, h('a', { href: profileLink(p.username) }, p.username), ' ', h('span', { class: 'title-mini', title: p.title }, p.icon)),
              h('div', { class: 'muted' }, `${p.title} · ${p.wins} challenge win${p.wins === 1 ? '' : 's'}`)),
            h('b', {}, String(p.points))))) : (r.top.length ? null : h('p', { class: 'muted' }, 'Nobody here yet. Be the first!')),
          h('p', { class: 'muted center' }, 'This list updates by itself when somebody passes another player.'))];
        // The weekly prizes still run: the top 3 of the week (points from every game) win coins.
        if (wk && wk.weekly) {
          const w = wk.weekly;
          cards.push(h('div', { class: 'card' },
            h('div', { class: 'row between' }, h('h3', {}, '🏆 Weekly prizes'), h('span', { class: 'chip' }, `⏳ Ends in ${countdown(w.endsAt)}`)),
            h('p', {}, `Points from every game count. Top 3 each week win coins: 🥇 ${w.prizes[0]}  🥈 ${w.prizes[1]}  🥉 ${w.prizes[2]}. You need at least ${w.min} points to qualify.`),
            wk.top.length
              ? h('ol', { class: 'wk-top' }, wk.top.slice(0, 3).map((p) => h('li', { class: p.you ? 'you' : '' }, `${p.username}: ${p.points} pts`)))
              : h('p', { class: 'muted' }, 'Nobody has points this week yet.'),
            h('p', { class: 'muted' }, wk.me.rank ? `You are number ${wk.me.rank} this week with ${wk.me.points} points.` : 'Earn points this week to get on the weekly board.'),
            w.last && w.last.winners.length ? h('p', { class: 'muted' }, 'Last week: ' + w.last.winners.map((x, i) => `${['🥇', '🥈', '🥉'][i]} ${x.username}`).join('  ')) : null,
            h('p', { class: 'muted' }, 'The week ends on Monday at 12am, Lagos time.')));
        }
        body.textContent = '';
        body.append(...cards);
      };
      paint(first, firstWeek);

      // Keep the board fresh: when somebody passes another player the list changes on its own.
      const timer = setInterval(async () => {
        if (!main.isConnected || document.hidden) { if (!main.isConnected) clearInterval(timer); return; }
        try { const [r, wk] = await loadBoards(); if (main.isConnected) paint(r, wk); } catch { /* try again next time */ }
      }, 20000);
    } catch (e) { main.textContent = ''; main.append(errorCard(e, viewRanks)); }
  }

  // ---------- profile ----------
  async function viewMe() {
    await refreshMe();
    const main = shell('me');
    main.classList.add('stack');
    const s = me.stats;

    const bioText = h('p', { class: 'bio' }, me.bio || '');
    if (!me.bio) bioText.classList.add('hidden');

    // Display picture: pick one from the set (nothing is uploaded)
    const picker = h('div', { class: 'ava-picker hidden' });
    const choose = async (key) => {
      try { await api('/profile/avatar', { method: 'POST', body: { key } }); NS.toast(key ? 'Picture changed' : 'Picture removed'); viewMe(); }
      catch (e) { NS.toast(e.message, true); }
    };
    const group = (title, keys) => {
      picker.append(h('div', { class: 'ava-title' }, title));
      picker.append(h('div', { class: 'ava-grid' }, keys.map((k) => h('button', { class: 'ava-pick' + (me.avatar === 'preset:' + k ? ' on' : ''), type: 'button', 'aria-label': 'Use this picture', onclick: () => choose(k) }, avatarEl('preset:' + k, '?', 'big')))));
    };
    if (NS.avatars) {
      group('Men', NS.avatars.people.filter((k) => k[0] === 'm'));
      group('Women', NS.avatars.people.filter((k) => k[0] === 'f'));
      group('Animated faces', NS.avatars.faces);
    }
    const changeBtn = h('button', { class: 'btn small', type: 'button' }, me.avatar ? 'Change picture' : 'Choose a picture');
    changeBtn.addEventListener('click', () => picker.classList.toggle('hidden'));
    const removeBtn = me.avatar ? h('button', { class: 'btn small alt', type: 'button', onclick: () => choose(null) }, 'Remove picture') : null;

    // About me
    const bio = h('textarea', { id: 'bio', maxlength: '160', rows: '3', placeholder: 'Tell people about yourself: your area, your favourite food, how you sabi...' });
    bio.value = me.bio || '';
    const count = h('div', { class: 'muted right' }, `${[...bio.value].length}/160`);
    bio.addEventListener('input', () => { count.textContent = `${[...bio.value].length}/160`; });
    const bioErr = h('div', { class: 'error', role: 'alert' });
    const saveBtn = h('button', { class: 'btn block', type: 'submit' }, 'Save description');
    const bioForm = h('form', { novalidate: true },
      h('label', { for: 'bio' }, 'About me'), bio, count, bioErr, h('div', { class: 'field' }, saveBtn));
    bioForm.addEventListener('submit', async (e) => {
      e.preventDefault(); bioErr.textContent = ''; saveBtn.disabled = true;
      try {
        const r = await api('/profile', { method: 'POST', body: { bio: bio.value } });
        me.bio = r.bio; bio.value = r.bio;
        count.textContent = `${[...r.bio].length}/160`;
        bioText.textContent = r.bio;
        bioText.classList.toggle('hidden', !r.bio);
        NS.toast('Saved');
      } catch (ex) { bioErr.textContent = ex.message; }
      saveBtn.disabled = false;
    });

    main.append(
      h('div', { class: 'card' },
        h('div', { class: 'profile-head' },
          avatarEl(me.avatar, me.username, 'big', me.title.tier),
          h('div', { class: 'grow stack' }, h('h2', {}, me.username, me.premium ? ' ' : null, me.premium ? premiumMark() : null), h('div', { class: 'row' }, changeBtn, removeBtn))),
        picker,
        bioText,
        !me.premium && !me.premiumOpen ? null : h('a', { class: 'prem-link' + (me.premium ? ' on' : ''), href: '#/premium' }, me.premium ? `👑 Premium member, ${me.premiumDaysLeft} day${me.premiumDaysLeft === 1 ? '' : 's'} left` : '👑 Go Premium: no pop-up adverts, fun facts and a gold crown'),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', {}, String(me.points)), h('span', {}, 'Points')),
          h('div', { class: 'stat' }, h('b', {}, String(me.levels.Naija)), h('span', {}, '🇳🇬 Naija level')),
          h('div', { class: 'stat' }, h('b', {}, String(me.levels.Universal)), h('span', {}, '🌍 Universal level')),
          h('div', { class: 'stat' }, h('b', {}, String(me.levels['Word Search'])), h('span', {}, '🔎 Word Search level')),
          h('div', { class: 'stat' }, h('b', {}, String(me.levels['Slide Puzzle'])), h('span', {}, '🧩 Slide level')),
          h('div', { class: 'stat' }, h('b', {}, String(me.bestStreak)), h('span', {}, 'Best streak')))),
      h('div', { class: 'card' },
        h('h3', {}, 'Your rank'),
        h('p', { class: 'rank-title' }, titleChip(me.title)),
        me.title.next
          ? h('div', {}, h('div', { class: 'xp' }, (() => { const f = h('div', { class: 'xp-fill' }); f.style.width = me.title.progress + '%'; return f; })()),
            h('p', { class: 'muted' }, `${me.points} of ${me.title.next.min} points to ${me.title.next.icon} ${me.title.next.name}`))
          : h('p', { class: 'muted' }, 'You reached the top title. Respect!'),
        h('p', { class: 'muted' }, 'Points never go down and cannot be spent. Your title shows as a coloured frame around your picture.')),
      h('div', { class: 'card' },
        h('h3', {}, `Badges (${me.badges.filter((b) => b.earned).length} of ${me.badges.length})`),
        badgeGrid(me.badges, false)),
      h('div', { class: 'card' },
        h('h3', {}, 'Coins'),
        h('p', {}, `You have ${me.coins} coins. Coins pay for hints and skips.`),
        h('button', { class: 'btn block', type: 'button', onclick: () => buyCoins() }, 'Buy coins')),
      h('div', { class: 'card' },
        h('h3', {}, 'Friends and news'),
        h('a', { class: 'btn block', href: '#/invite' }, 'Invite a friend (50 coins each)'),
        h('div', { class: 'field' }, h('a', { class: 'btn alt block', href: '#/news' }, 'Announcements'))),
      accountCards(),
      h('div', { class: 'card' }, bioForm),
      h('div', { class: 'card' },
        h('h3', {}, 'Challenges'),
        h('div', { class: 'stats' },
          h('div', { class: 'stat' }, h('b', {}, String(s.won)), h('span', {}, 'Won')),
          h('div', { class: 'stat' }, h('b', {}, String(s.lost)), h('span', {}, 'Lost')),
          h('div', { class: 'stat' }, h('b', {}, String(s.drawn)), h('span', {}, 'Draws')))),
      h('div', { class: 'card' },
        h('h3', {}, 'How scoring works'),
        h('p', {}, 'Solo: 100 points per puzzle, minus 20 for each letter you reveal and 10 for the clue (never below 40). Each solve earns 10 coins.'),
        h('p', {}, 'Races (2 to 8 players, 20 levels or more): everybody plays the same levels at the same time and the first to finish them all wins. Each level is worth up to 100 points, minus 1 for every second and 5 for every wrong guess (never below 20). Skipping a level takes off 10 points and it comes back at the end, so you must still solve it.'),
        h('p', {}, 'Races are free and played for fun: no coins are paid in or won. When a race ends, the winner is announced in the public chat room with a party face. Other players are not named.'),
        me.premiumOpen ? h('h3', {}, 'Premium') : null,
        me.premiumOpen ? h('p', {}, 'Premium costs \u20A61,000 for 30 days and does not renew by itself. It removes pop-up adverts, shows fun facts after levels and puts a gold crown by your name. Paying again before it ends adds 30 days to what is left. Premium payments are not refunded once paid.') : null),
      h('button', { class: 'btn alt block', type: 'button', onclick: async () => {
        await api('/auth/logout', { method: 'POST' }).catch(() => {}); clearPics();
        me = null; go('/'); route();
      } }, 'Log out'));
    // Admins get a shortcut to the puzzle manager. Everyone else sees nothing.
    api('/admin/status').then((r) => {
      if (r.admin && main.isConnected) main.insertBefore(h('a', { class: 'btn alt block', href: '/admin.html' }, 'Admin: manage puzzles' + (r.resetRequests ? ` (${r.resetRequests} password help request${r.resetRequests === 1 ? '' : 's'})` : '')), main.lastElementChild);
    }).catch(() => {});
  }

  // Any player's public profile (tap a name on Ranks or in a challenge).
  async function viewPlayer(name) {
    const cameFromChat = prevView === 'chat';
    const main = shell(name.toLowerCase() === me.username.toLowerCase() ? 'me' : cameFromChat ? 'chat' : 'ranks');
    main.append(spinner());
    try {
      const { player: p } = await api('/players/' + encodeURIComponent(name));
      main.textContent = '';
      main.classList.add('stack');
      main.append(
        h('div', { class: 'card' },
          h('div', { class: 'profile-head' },
            avatarEl(p.avatar, p.username, 'big', p.title.tier),
            h('div', { class: 'grow' }, h('h2', {}, p.username, p.premium ? ' ' : null, p.premium ? premiumMark() : null), titleChip(p.title), h('div', { class: 'muted' }, `Rank ${p.rank} of ${p.players}`,
              p.online ? h('span', { class: 'online-tag' }, ' 🟢 Online now') : null))),
          p.bio ? h('p', { class: 'bio' }, p.bio) : h('p', { class: 'muted' }, p.you ? 'You have not added a description yet.' : 'No description yet.'),
          h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('b', {}, String(p.points)), h('span', {}, 'Points')),
            h('div', { class: 'stat' }, h('b', {}, String(p.levels.Naija)), h('span', {}, '🇳🇬 Naija level')),
            h('div', { class: 'stat' }, h('b', {}, String(p.levels.Universal)), h('span', {}, '🌍 Universal level')),
            h('div', { class: 'stat' }, h('b', {}, String(p.levels['Word Search'])), h('span', {}, '🔎 Word Search level')),
            h('div', { class: 'stat' }, h('b', {}, String(p.levels['Slide Puzzle'])), h('span', {}, '🧩 Slide level')),
            h('div', { class: 'stat' }, h('b', {}, String(p.bestStreak)), h('span', {}, 'Best streak')))),
        p.badges.some((b) => b.earned) ? h('div', { class: 'card' }, h('h3', {}, 'Badges'), badgeGrid(p.badges, true)) : '',
        h('div', { class: 'card' },
          h('h3', {}, 'Challenges'),
          h('div', { class: 'stats' },
            h('div', { class: 'stat' }, h('b', {}, String(p.stats.won)), h('span', {}, 'Won')),
            h('div', { class: 'stat' }, h('b', {}, String(p.stats.lost)), h('span', {}, 'Lost')),
            h('div', { class: 'stat' }, h('b', {}, String(p.stats.drawn)), h('span', {}, 'Draws')))),
        p.you
          ? h('a', { class: 'btn block', href: '#/me' }, 'Edit my profile')
          : h('button', { class: 'btn block', type: 'button', onclick: async () => {
            try { const r = await api('/challenges', { method: 'POST', body: { opponent: p.username } }); go('/c/' + r.id); }
            catch (e) { NS.toast(e.message, true); }
          } }, `Challenge ${p.username}`),
        p.you ? null : h('a', { class: 'btn alt block', href: '#/chat/dm/' + encodeURIComponent(p.username) }, `Message ${p.username}`),
        h('a', { class: 'btn alt block', href: cameFromChat ? '#/chat' : '#/ranks' }, cameFromChat ? 'Back to chat' : 'Back to ranks'));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewPlayer(name))); }
  }

  // ---------- Settings: sound, and how to reach or follow PixSabi ----------
  const gearIcon = (px) => { const ns = 'http://www.w3.org/2000/svg'; const s = document.createElementNS(ns, 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', px); s.setAttribute('height', px); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS(ns, 'path'); p.setAttribute('fill', 'currentColor'); p.setAttribute('d', 'M19.4 13a7.9 7.9 0 0 0 0-2l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.9 7.9 0 0 0 0 2l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5c.1.2.4.3.6.2l2.5-1c.5.4 1.1.7 1.7 1l.4 2.6c0 .2.3.4.5.4h4c.2 0 .5-.2.5-.4l.4-2.6c.6-.3 1.2-.6 1.7-1l2.5 1c.2.1.5 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6L19.4 13ZM12 15.5A3.5 3.5 0 1 1 12 8.500a3.5 3.5 0 0 1 0 7Z'); s.append(p); return s; };
  // Simple stand-in icons (plain shapes and letters). To use the official ones, put files named contact, channel, x, instagram, tiktok, facebook
  // (.svg) in public/img/social/ and they replace these automatically.
  const SOCIAL = {
    contact: { glyph: 'WA', cls: 'wa', title: () => 'Contact us on WhatsApp', sub: (l) => `Adverts, partnerships or any problem · ${l.label}` },
    channel: { glyph: 'CH', cls: 'wa', title: () => 'Join our WhatsApp channel', sub: () => 'News, new games and prizes' },
    x: { glyph: 'X', cls: 'x', title: (l) => `Follow ${l.label} on X`, sub: () => 'X (Twitter)' },
    instagram: { glyph: 'IG', cls: 'ig', title: (l) => `Follow ${l.label} on Instagram`, sub: () => 'Instagram' },
    tiktok: { glyph: '♪', cls: 'tt', title: (l) => `Follow ${l.label} on TikTok`, sub: () => 'TikTok' },
    facebook: { glyph: 'f', cls: 'fb', title: (l) => (l.label ? `Follow ${l.label} on Facebook` : 'Follow us on Facebook'), sub: () => 'Facebook' },
  };
  function socialIcon(kind) {
    const d = SOCIAL[kind];
    const box = h('span', { class: 'soc-ico ' + d.cls, 'aria-hidden': 'true' }, d.glyph);
    const img = h('img', { src: `/img/social/${kind}.svg`, alt: '', width: '28', height: '28', class: 'soc-img' });
    img.addEventListener('load', () => { box.textContent = ''; box.classList.add('has-img'); box.append(img); }, { once: true });
    return box;
  }
  async function viewSettings() {
    const main = shell('me');
    main.classList.add('stack');
    main.append(h('h2', {}, 'Settings'),
      h('div', { class: 'card' }, h('h3', {}, 'Install the game'), installSlot(false)),
      h('div', { class: 'card' },
        h('h3', {}, 'Sound'),
        h('div', { class: 'field alert-check' },
          h('input', { type: 'checkbox', id: 'snd', checked: NS.sound.isOn() ? true : null, onchange: (e) => { NS.sound.setOn(e.target.checked); if (e.target.checked) NS.sound.play('correct'); } }),
          h('label', { for: 'snd' }, 'Sound effects (taps, right and wrong answers, wins)')),
        NS.music ? h('div', { class: 'field alert-check' },
          h('input', { type: 'checkbox', id: 'mus', checked: NS.music.isOn() ? true : null, onchange: (e) => NS.music.setOn(e.target.checked) }),
          h('label', { for: 'mus' }, 'Theme song (afro rap beat)')) : null,
        h('p', { class: 'muted' }, 'These choices are kept on this phone.')),
      h('div', { class: 'card' },
        h('h3', {}, 'Chat'),
        h('div', { class: 'field alert-check' },
          h('input', { type: 'checkbox', id: 'rsl', checked: (() => { try { return localStorage.getItem('ns_hide_results') !== '1'; } catch { return true; } })() ? true : null, onchange: (e) => { try { localStorage.setItem('ns_hide_results', e.target.checked ? '0' : '1'); } catch { /* ignore */ } } }),
          h('label', { for: 'rsl' }, 'Show race winners in the chat ("Ada just won a race!")'))));
    const holder = h('div');
    main.append(holder);
    try {
      const r = await api('/social');
      if (!r.links.length) return;
      holder.append(h('div', { class: 'card stack' }, h('h3', {}, 'Contact and follow us'),
        h('div', { class: 'soc-list' }, r.links.filter((l) => SOCIAL[l.kind]).map((l) => {
          const d = SOCIAL[l.kind];
          return h('a', { class: 'soc-row', href: l.url, target: '_blank', rel: 'noopener noreferrer' }, socialIcon(l.kind), h('span', { class: 'grow soc-text' }, h('b', {}, d.title(l)), h('span', { class: 'muted' }, d.sub(l))), h('span', { class: 'invite-go', 'aria-hidden': 'true' }, '›'));
        }))));
    } catch { /* the sound settings still work without the links */ }
  }

  // ---------- Quiz: hosts write questions, players race through them with a code ----------
  const quizLink = (code) => `${location.origin}/#/quiz/${code}`;
  const quizWhen = (ms) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const quizSecs = (ms) => (ms / 1000).toFixed(1) + 's';
  const quizHead = (title, back) => h('div', { class: 'row quiz-head' }, h('a', { class: 'btn alt small', href: back || '#/quiz' }, '‹ Back'), h('h2', { class: 'grow' }, title));
  function quizList(items, empty, mark) {
    if (!items.length) return h('p', { class: 'muted' }, empty);
    return h('div', { class: 'quiz-list' }, items.map((q) => h('a', { class: 'quiz-item', href: `#/quiz/${q.code}` },
      h('div', { class: 'grow' }, h('b', {}, q.title), h('div', { class: 'muted' }, [q.topic ? q.topic + ' · ' : '', `${q.count} questions · ${q.players} player${q.players === 1 ? '' : 's'}`, q.status === 'closed' ? ' · closed' : ''].join(''))),
      mark ? h('span', { class: 'quiz-mark' }, mark(q)) : h('span', { class: 'invite-go', 'aria-hidden': 'true' }, '›'))));
  }

  async function viewQuizHub() {
    const main = shell('solo');
    main.classList.add('stack');
    main.append(spinner());
    try {
      const r = await api('/quiz');
      main.textContent = '';
      const code = h('input', { type: 'text', maxlength: '6', autocomplete: 'off', autocapitalize: 'characters', placeholder: 'Enter quiz code', 'aria-label': 'Quiz code', class: 'quiz-code-in' });
      const go = () => { const c = code.value.trim().toUpperCase(); if (c) location.hash = `#/quiz/${c}`; };
      code.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
      main.append(h('div', { class: 'row' }, h('a', { class: 'btn alt small', href: '#/' }, '‹ Back'), h('h2', { class: 'grow' }, '🎯 Quiz')),
        h('div', { class: 'card stack' }, h('p', { class: 'muted' }, 'Got a code from your school, group or church? Type it here.'), h('div', { class: 'row' }, code, h('button', { class: 'btn', type: 'button', onclick: go }, 'Join'))),
        r.canHost ? h('a', { class: 'btn block big-play', href: '#/quiz/new' }, '＋ Make a quiz') : null,
        r.listed.length ? h('div', { class: 'card stack' }, h('h3', {}, 'Open to everyone'), quizList(r.listed, '')) : null,
        r.mine.length ? h('div', { class: 'card stack' }, h('h3', {}, 'Quizzes I made'), quizList(r.mine, '')) : null,
        h('div', { class: 'card stack' }, h('h3', {}, 'Quizzes I played'), quizList(r.played, 'None yet. Enter a code above.', (q) => (q.myFinished ? `${q.myScore} pts` : 'Continue'))));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewQuizHub())); }
  }

  // Turn pasted text into questions. A question line, then answer lines; the right one ends with * or (correct).
  function parseQuizText(text) {
    const out = []; let cur = null;
    const push = () => { if (cur && cur.q) out.push(cur); cur = null; };
    for (let line of String(text).split(/\r?\n/)) {
      line = line.trim();
      if (!line) { continue; }
      const opt = line.match(/^(?:[-•]|\(?[A-Da-d][).:])\s+(.*)$/);
      if (opt && cur) {
        let t = opt[1].trim(), right = false;
        if (/(\*|\(correct\))\s*$/i.test(t)) { right = true; t = t.replace(/\s*(\*|\(correct\))\s*$/i, '').trim(); }
        if (right) cur.answer = cur.options.length;
        cur.options.push(t);
      } else if (/^(answer|explain|explanation)\s*:/i.test(line) && cur) {
        if (/^answer/i.test(line)) { const m = line.match(/:\s*([A-Da-d])\b/); if (m) cur.answer = m[1].toUpperCase().charCodeAt(0) - 65; } else cur.explain = line.replace(/^[^:]*:\s*/, '');
      } else { push(); cur = { q: line.replace(/^\d+[).:]\s*/, ''), options: [], answer: -1, explain: '' }; }
    }
    push();
    return out;
  }

  async function viewQuizEditor(code) {
    const main = shell('solo');
    main.classList.add('stack');
    main.append(spinner());
    try {
      const info = code ? await api(`/quiz/${code}`) : null;
      const lim = (await api('/quiz')).limits;
      main.textContent = '';
      let qs = info && info.questions ? info.questions.map((x) => ({ ...x, options: [...x.options] })) : [];
      const locked = info && !info.editable;
      const title = h('input', { type: 'text', maxlength: String(lim.title), placeholder: 'Quiz title, e.g. Sunday School Quiz', 'aria-label': 'Quiz title', value: info ? info.title : '' });
      const topic = h('input', { type: 'text', maxlength: String(lim.topic), placeholder: 'Topic (optional), e.g. Bible, Biology', 'aria-label': 'Topic', value: info ? info.topic : '' });
      const secs = h('input', { type: 'number', min: String(lim.minSecs), max: String(lim.maxSecs), value: String(info ? info.secs : 20), 'aria-label': 'Seconds per question', disabled: locked });
      const closes = h('input', { type: 'datetime-local', 'aria-label': 'Closing time' });
      if (info && info.closesAt) { const d = new Date(info.closesAt - new Date().getTimezoneOffset() * 60000); closes.value = d.toISOString().slice(0, 16); }
      const err = h('div', { class: 'error', role: 'alert' });
      const list = h('div', { class: 'stack' });
      const count = h('p', { class: 'muted' });
      const paint = () => {
        list.textContent = '';
        count.textContent = `${qs.length} question${qs.length === 1 ? '' : 's'} (${lim.minQ} to ${lim.maxQ}). Tap the circle next to the right answer.`;
        qs.forEach((x, i) => {
          const q = h('input', { type: 'text', maxlength: String(lim.question), value: x.q, placeholder: 'Question', 'aria-label': `Question ${i + 1}`, disabled: locked });
          q.addEventListener('input', () => { x.q = q.value; });
          const opts = x.options.map((o, k) => {
            const t = h('input', { type: 'text', maxlength: String(lim.option), value: o, placeholder: `Answer ${String.fromCharCode(65 + k)}`, 'aria-label': `Question ${i + 1} answer ${k + 1}`, disabled: locked });
            t.addEventListener('input', () => { x.options[k] = t.value; });
            const r = h('input', { type: 'radio', name: `right-${i}`, 'aria-label': 'This is the right answer', checked: x.answer === k, disabled: locked });
            r.addEventListener('change', () => { x.answer = k; });
            const del = x.options.length > 2 && !locked ? h('button', { class: 'btn alt small', type: 'button', 'aria-label': 'Remove this answer', onclick: () => { x.options.splice(k, 1); if (x.answer === k) x.answer = -1; else if (x.answer > k) x.answer--; paint(); } }, '✕') : null;
            return h('div', { class: 'row quiz-opt' }, r, t, del);
          });
          const ex = h('input', { type: 'text', maxlength: String(lim.explain), value: x.explain || '', placeholder: 'Short explanation (optional)', 'aria-label': `Question ${i + 1} explanation`, disabled: locked });
          ex.addEventListener('input', () => { x.explain = ex.value; });
          list.append(h('div', { class: 'card stack quiz-q' }, h('div', { class: 'row' }, h('b', { class: 'grow' }, `Question ${i + 1}`), locked ? null : h('button', { class: 'btn alt small', type: 'button', onclick: () => { qs.splice(i, 1); paint(); } }, 'Delete')), q, opts,
            !locked && x.options.length < lim.maxOpt ? h('button', { class: 'btn alt small', type: 'button', onclick: () => { x.options.push(''); paint(); } }, '＋ Add answer') : null, ex));
        });
      };
      const bulk = h('textarea', { rows: '8', maxlength: '40000', placeholder: 'Paste many questions at once:\n\nWho wrote Things Fall Apart?\nA) Chinua Achebe *\nB) Wole Soyinka\nC) Chimamanda Adichie\n\nWhat is the capital of Nigeria?\nA) Lagos\nB) Abuja *\nC) Kano', 'aria-label': 'Paste questions' });
      const bulkGo = h('button', { class: 'btn alt', type: 'button' }, 'Add these questions');
      bulkGo.addEventListener('click', () => {
        const got = parseQuizText(bulk.value);
        if (!got.length) { NS.toast('Could not find any questions in that text.', true); return; }
        qs = qs.filter((x) => x.q.trim() || x.options.some((o) => o.trim())).concat(got).slice(0, lim.maxQ); bulk.value = ''; paint();
        const noAns = got.filter((g) => g.answer < 0 || g.answer >= g.options.length).length;
        NS.toast(`Added ${got.length}.` + (noAns ? ` Mark the right answer on ${noAns}.` : ''), noAns > 0);
      });
      const save = h('button', { class: 'btn block big-play', type: 'button' }, info ? 'Save changes' : 'Make the quiz');
      save.addEventListener('click', async () => {
        err.textContent = ''; save.disabled = true;
        try {
          const body = { title: title.value, topic: topic.value, secs: Number(secs.value), closesAt: closes.value ? new Date(closes.value).getTime() : 0, questions: qs };
          const r = info ? await api(`/quiz/${info.code}`, { method: 'PUT', body }) : await api('/quiz', { method: 'POST', body });
          location.hash = `#/quiz/${info ? info.code : r.code}`;
        } catch (e) { err.textContent = e.message; save.disabled = false; }
      });
      main.append(quizHead(info ? 'Edit quiz' : 'Make a quiz', info ? `#/quiz/${info.code}` : '#/quiz'),
        locked ? h('p', { class: 'card muted' }, 'Players have started, so the questions and the time cannot change. You can still change the title and closing time.') : null,
        h('div', { class: 'card stack' }, title, topic, h('label', { class: 'muted' }, 'Seconds for each question'), secs, h('label', { class: 'muted' }, 'Closing time (optional)'), closes),
        locked ? null : h('details', { class: 'card stack' }, h('summary', {}, 'Paste many questions at once'), h('p', { class: 'muted' }, 'One question per block. Put a * after the right answer.'), bulk, bulkGo),
        count, list,
        locked ? null : h('button', { class: 'btn alt block', type: 'button', onclick: () => { if (qs.length < lim.maxQ) { qs.push({ q: '', options: ['', ''], answer: -1, explain: '' }); paint(); } } }, '＋ Add a question'),
        err, save);
      if (!qs.length && !locked) qs.push({ q: '', options: ['', ''], answer: -1, explain: '' });
      paint();
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewQuizEditor(code))); }
  }

  async function viewQuizRoom(code) {
    const main = shell('solo');
    main.classList.add('stack');
    main.append(spinner());
    try {
      const r = await api(`/quiz/${code}`);
      main.textContent = '';
      const link = quizLink(r.code);
      const msg = `Join my quiz "${r.title}" on PixSabi. Code: ${r.code}\n${link}`;
      const m = r.mine;
      const pill = (t) => h('span', { class: 'gp-pill' }, t);
      main.append(quizHead(r.title),
        h('div', { class: 'card stack center' },
          h('div', { class: 'quiz-codebox' }, h('span', { class: 'muted' }, 'Code'), h('b', { class: 'quiz-code' }, r.code)),
          h('div', { class: 'muted' }, [r.topic ? r.topic + ' · ' : '', `${r.count} questions · ${r.secs}s each · by ${r.host}`].join('')),
          h('div', { class: 'row center' }, pill(`${r.players} started`), pill(`${r.finished} finished`), pill(r.status === 'closed' ? 'Closed' : r.closesAt ? `Closes ${quizWhen(r.closesAt)}` : 'Open')),
          m.finished ? h('div', { class: 'quiz-done' }, h('b', {}, `You scored ${m.score}`), h('div', { class: 'muted' }, `${m.correct} of ${r.count} right · rank ${m.rank} · ${quizSecs(m.ms)}`))
            : r.status === 'closed' ? h('p', { class: 'muted' }, 'This quiz is closed.')
              : h('a', { class: 'btn block big-play', href: `#/quiz/${r.code}/play` }, m.started ? `Continue (question ${m.answered + 1})` : 'Start the quiz'),
          h('div', { class: 'row' },
            h('a', { class: 'btn wa grow', target: '_blank', rel: 'noopener', href: 'https://wa.me/?text=' + encodeURIComponent(msg) }, 'Share on WhatsApp'),
            h('button', { class: 'btn alt grow', type: 'button', onclick: () => copyText(msg) }, 'Copy link'))),
        r.isHost ? (() => {
          const bar = h('div', { class: 'card stack' }, h('h3', {}, 'Host controls'), h('div', { class: 'row quiz-tools' },
            h('a', { class: 'btn alt', href: `#/quiz/${r.code}/edit` }, 'Edit'),
            h('a', { class: 'btn alt', href: `#/quiz/${r.code}/results` }, 'Results'),
            h('button', { class: 'btn alt', type: 'button', onclick: async () => { try { downloadQuizReport(await api(`/quiz/${r.code}/results`)); } catch (e) { NS.toast(e.message, true); } } }, '⬇ Report sheet'),
            h('button', { class: 'btn alt', type: 'button', onclick: async () => { try { await api(`/quiz/${r.code}/status`, { method: 'POST', body: { status: r.status === 'closed' ? 'open' : 'closed' } }); viewQuizRoom(code); } catch (e) { NS.toast(e.message, true); } } }, r.status === 'closed' ? 'Reopen' : 'Close'),
            r.canList ? h('button', { class: 'btn alt', type: 'button', onclick: async () => { try { await api(`/admin/quiz/${r.code}/listed`, { method: 'POST', body: { listed: !r.listed } }); NS.toast(r.listed ? 'Removed from the public list' : 'Added to the public list'); viewQuizRoom(code); } catch (e) { NS.toast(e.message, true); } } }, r.listed ? 'Unlist' : 'List publicly') : null,
            h('button', { class: 'btn alt danger', type: 'button', onclick: async () => { if (!confirm('Delete this quiz and all its scores?')) return; try { await api(`/quiz/${r.code}`, { method: 'DELETE' }); location.hash = '#/quiz'; } catch (e) { NS.toast(e.message, true); } } }, 'Delete')));
          return bar;
        })() : null,
        h('div', { class: 'card stack' }, h('h3', {}, 'Leaderboard'),
          r.leaderboard.length ? h('ol', { class: 'quiz-board' }, r.leaderboard.map((x) => h('li', { class: x.id === me.id ? 'me' : '' }, h('span', { class: 'quiz-rank' }, String(x.rank)), avatarEl(x.avatar, x.name, 'small'), h('b', { class: 'grow' }, x.name), h('span', {}, `${x.score} pts`), h('span', { class: 'muted' }, `${x.correct}/${r.count}`))))
            : h('p', { class: 'muted' }, 'Nobody has finished yet.')));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewQuizRoom(code))); }
  }

  async function viewQuizPlay(code) {
    const main = shell('solo');
    main.classList.add('stack');
    main.append(spinner());
    let timer = 0;
    const alive = () => main.isConnected && /^#\/quiz\/[^/]+\/play/i.test(location.hash);
    const stop = () => { clearInterval(timer); timer = 0; };
    const load = async () => {
      stop();
      let q;
      try { q = await api(`/quiz/${code}/play`); } catch (e) { main.textContent = ''; main.append(errorCard(e, load), h('a', { class: 'btn alt block', href: `#/quiz/${code}` }, 'Back to the quiz')); return; }
      if (q.finished) { location.hash = `#/quiz/${code}`; return; }
      main.textContent = '';
      const bar = h('i'); const barWrap = h('div', { class: 'quiz-timer' }, bar);
      const left = h('span', { class: 'quiz-left' });
      const note = h('div', { class: 'quiz-note', 'aria-live': 'polite' });
      const next = h('button', { class: 'btn block big-play', type: 'button', hidden: true }, q.idx + 1 >= q.total ? 'See my score' : 'Next question');
      let done = false;
      const btns = q.options.map((o, i) => h('button', { class: 'quiz-opt-btn', type: 'button', onclick: () => send(i) }, h('span', { class: 'quiz-letter' }, String.fromCharCode(65 + i)), o));
      const send = async (idx) => {
        if (done) return; done = true; stop();
        btns.forEach((b) => { b.disabled = true; });
        try {
          const a = await api(`/quiz/${code}/answer`, { method: 'POST', body: { q: q.idx, idx } });
          if (idx >= 0) btns[idx].classList.add(a.ok ? 'right' : 'wrong');
          btns[a.correctIndex].classList.add('right');
          if (NS.sound) NS.sound.play(a.ok ? 'correct' : 'wrong');
          note.textContent = (idx < 0 ? 'Time up! ' : a.ok ? `Correct! +${a.points}. ` : 'Not quite. ') + (a.explain || '');
          next.hidden = false;
          next.onclick = () => { if (a.done) location.hash = `#/quiz/${code}`; else load(); };
          next.focus();
        } catch (e) { note.textContent = e.message; next.hidden = false; next.textContent = 'Reload'; next.onclick = load; }
      };
      main.append(h('div', { class: 'row' }, h('b', { class: 'grow' }, `Question ${q.idx + 1} of ${q.total}`), h('span', { class: 'quiz-score' }, `⭐ ${q.score}`), left),
        barWrap, h('div', { class: 'card quiz-question' }, h('h3', {}, q.q)), h('div', { class: 'quiz-opts' }, btns), note, next);
      const end = Date.now() + q.remainingMs, total = q.secs * 1000;
      const tick = () => {
        if (!alive()) { stop(); return; }
        const ms = Math.max(0, end - Date.now());
        bar.style.width = (ms / total) * 100 + '%'; left.textContent = Math.ceil(ms / 1000) + 's';
        barWrap.classList.toggle('low', ms < 5000);
        if (ms <= 0 && !done) send(-1);
      };
      tick(); timer = setInterval(tick, 100);
    };
    load();
  }

  // The host's report sheet: one row per player (rank, score, time, and right/wrong for every question), then how each question went.
  // Opens in Excel, Google Sheets or any spreadsheet app.
  function downloadQuizReport(r) {
    const cell = (v) => { let t = String(v == null ? '' : v); if (/^[=+\-@\t\r]/.test(t)) t = "'" + t; return '"' + t.replace(/"/g, '""') + '"'; };
    const qn = r.questions.map((_, i) => 'Q' + (i + 1));
    const rows = [
      [r.title], ['Quiz code', r.code], ['Players', r.players.length], ['Finished', r.players.filter((p) => p.finished).length], [],
      ['Rank', 'Player', 'Finished', 'Questions answered', 'Score', 'Correct', 'Total seconds', ...qn],
      ...r.players.map((p) => [p.rank || '', p.name, p.finished ? 'yes' : 'no', p.answered, p.score, p.correct, (p.ms / 1000).toFixed(1), ...r.questions.map((_, i) => (i < p.marks.length ? (p.marks[i] ? 'Right' : 'Wrong') : ''))]),
      [], ['Question', 'Text', 'Players who got it right', 'Players who reached it', 'Percent right'],
      ...r.questions.map((x, i) => ['Q' + (i + 1), x.q, x.right, x.seen, x.seen ? Math.round((x.right / x.seen) * 100) + '%' : '']),
    ];
    const blob = new Blob(['\ufeff' + rows.map((x) => x.map(cell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const link = h('a', { href: URL.createObjectURL(blob), download: `quiz-${r.code}-report.csv` });
    document.body.append(link); link.click(); link.remove();
  }

  async function viewQuizResults(code) {
    const main = shell('solo');
    main.classList.add('stack');
    main.append(spinner());
    try {
      const r = await api(`/quiz/${code}/results`);
      main.textContent = '';
      const csv = () => downloadQuizReport(r);
      main.append(quizHead('Results', `#/quiz/${r.code}`), h('p', { class: 'muted' }, r.title),
        h('button', { class: 'btn alt block', type: 'button', onclick: csv }, 'Download report sheet (opens in Excel)'),
        h('div', { class: 'card stack' }, h('h3', {}, `Players (${r.players.length})`),
          r.players.length ? h('ol', { class: 'quiz-board' }, r.players.map((p) => h('li', {}, h('span', { class: 'quiz-rank' }, p.rank ? String(p.rank) : '–'), h('b', { class: 'grow' }, p.name), h('span', {}, p.finished ? `${p.score} pts` : `on question ${p.answered + 1}`), h('span', { class: 'muted' }, `${p.correct}/${r.total}`)))) : h('p', { class: 'muted' }, 'No players yet.')),
        h('div', { class: 'card stack' }, h('h3', {}, 'How each question went'), r.questions.map((x, i) => h('div', { class: 'quiz-qstat' }, h('div', {}, `${i + 1}. ${x.q}`), h('div', { class: 'muted' }, x.seen ? `${x.right} of ${x.seen} got it right (${Math.round((x.right / x.seen) * 100)}%)` : 'Nobody has reached this yet')))));
    } catch (e) { main.textContent = ''; main.append(errorCard(e, () => viewQuizResults(code))); }
  }

  function viewQuiz(parts) {
    const code = (parts[1] || '').toUpperCase();
    if (!code) return viewQuizHub();
    if (code === 'NEW') return viewQuizEditor(null);
    if (parts[2] === 'play') return viewQuizPlay(code);
    if (parts[2] === 'edit') return viewQuizEditor(code);
    if (parts[2] === 'results') return viewQuizResults(code);
    return viewQuizRoom(code);
  }

  // ---------- router ----------
  async function route() {
    NS.cleanup();
    document.querySelectorAll('.overlay').forEach((o) => o.remove()); // close any open result popup
    const parts = (location.hash.slice(1) || '/').split('/').filter(Boolean);
    if (parts[0] === 'reset' && parts[1]) return renderReset(decodeURIComponent(parts[1]));
    if (parts[0] === 'verify' && parts[1]) return renderVerify(decodeURIComponent(parts[1]));
    if (parts[0] === 'delete' && parts[1]) return renderDeleteConfirm(decodeURIComponent(parts[1]));
    if (!me) { try { me = (await api('/me')).user; } catch { me = null; } }
    if (!me) {
      if (parts[0] === 'join' || parts[0] === 'c' || parts[0] === 'watch' || parts[0] === 'quiz') sessionStorage.setItem('ns_after', location.hash.slice(1));
      return renderAuth();
    }
    payNote();
    if (!me.adultConfirmed) adultGate();
    prevView = curView;
    curView = parts[0] || '';
    document.body.classList.toggle('no-ads', curView === 'chat');   // no adverts beside the chat (Google does not allow ads on chat screens)
    switch (parts[0]) {
      case 'daily': return viewDaily();
      case 'challenges': return viewChallenges();
      case 'join': return viewJoin(parts[1]);
      case 'c': return viewChallenge(parts[1]);
      case 'watch': return viewWatch(parts[1]);
      case 'chat': return parts[1] === 'dm' ? (parts[2] ? viewDm(decodeURIComponent(parts[2])) : viewDmList()) : viewChat();
      case 'alerts': return viewAlerts();
      case 'ranks': return viewRanks();
      case 'me': return viewMe();
      case 'premium': return viewPremium();
      case 'settings': return viewSettings();
      case 'quiz': return viewQuiz(parts.map((x) => decodeURIComponent(x)));
      case 'u': return viewPlayer(decodeURIComponent(parts[1] || ''));
      case 'play': return viewPlay();
      case 'news': return viewNews();
      case 'invite': return viewInvite();
      default: return viewHome();
    }
  }
  window.addEventListener('hashchange', route);
  route();
})();
