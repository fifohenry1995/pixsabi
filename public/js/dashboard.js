/* The owner's dashboard (admins only): the full report, and the private links for investors and advertisers. */
(function () {
  var root = document.getElementById('dash');
  var days = 30;
  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in (attrs || {})) { if (attrs[k] == null || attrs[k] === false) continue; if (k === 'class') el.className = attrs[k]; else if (k === 'onclick') el.addEventListener('click', attrs[k]); else el.setAttribute(k, attrs[k]); }
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (Array.isArray(c)) c.forEach(function (x) { if (x != null) el.append(x.nodeType ? x : document.createTextNode(String(x))); }); else if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return el;
  }
  function toast(msg, bad) {
    var box = document.getElementById('toasts'), t = h('div', { class: 'toast' + (bad ? ' bad' : '') }, msg);
    box.append(t); setTimeout(function () { t.remove(); }, 3500);
  }
  function api(path, opts) {
    opts = opts || {};
    return fetch('/api' + path, { method: opts.method || 'GET', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: (opts.method || 'GET') === 'GET' ? undefined : JSON.stringify(opts.body || {}) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Something went wrong.'); e.status = r.status; throw e; } return j; }); });
  }
  function copy(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { toast('Link copied'); }, function () { toast('Copy it by hand: ' + text, true); });
    else toast('Copy it by hand: ' + text, true);
  }

  function linksSection(box, data) {
    box.textContent = '';
    var kind = h('select', { id: 'lk-kind', 'aria-label': 'Who is this link for' }, h('option', { value: 'investor' }, 'Investor (sees everything)'), h('option', { value: 'advertiser' }, 'Advertiser (sees only their adverts)'));
    var who = h('select', { id: 'lk-who', 'aria-label': 'Advertiser' }, data.advertisers.map(function (n) { return h('option', { value: n }, n); }));
    var whoField = h('div', { class: 'field dash-hide' }, h('label', { for: 'lk-who' }, 'Advertiser'), who);
    var label = h('input', { type: 'text', id: 'lk-label', maxlength: '60', placeholder: 'Who is it for? (a note only you see)' });
    kind.addEventListener('change', function () { whoField.classList.toggle('dash-hide', kind.value !== 'advertiser'); });
    var make = h('button', { class: 'dash-btn primary', type: 'button', onclick: function () {
      api('/admin/dash/links', { method: 'POST', body: { kind: kind.value, advertiser: kind.value === 'advertiser' ? who.value : '', label: label.value } })
        .then(function (r) { toast('Link made'); copy(location.origin + '/r/' + r.token); data.links = r.links; linksSection(box, data); })
        .catch(function (e) { toast(e.message, true); });
    } }, 'Make a private link');
    box.append(h('h2', {}, 'Private links for investors and advertisers'),
      h('p', { class: 'dash-hint' }, 'Anyone with a link can see its report, no login needed, so send it only to the right person. Switch a link off at any time. An advertiser link shows only the adverts that have that advertiser name (set it in the admin page, in Adverts and Pop-up adverts).'),
      h('div', { class: 'dash-form' }, h('div', { class: 'field' }, h('label', { for: 'lk-kind' }, 'Link for'), kind), whoField, h('div', { class: 'field' }, h('label', { for: 'lk-label' }, 'Note'), label), make));
    if (!data.advertisers.length) box.append(h('p', { class: 'dash-hint' }, 'No advertiser names yet. Type one on an advert in the admin page to make advertiser links.'));
    if (!data.links.length) { box.append(h('p', { class: 'dash-hint' }, 'No links yet.')); return; }
    box.append(h('div', { class: 'dash-tablewrap' }, h('table', { class: 'dash-table' },
      h('thead', {}, h('tr', {}, ['For', 'Note', 'Made', 'Last opened', 'Status', ''].map(function (x) { return h('th', {}, x); }))),
      h('tbody', {}, data.links.map(function (l) {
        var url = location.origin + '/r/' + l.token;
        return h('tr', {},
          h('th', { scope: 'row' }, l.kind === 'investor' ? 'Investor' : 'Advertiser: ' + (l.advertiser || '')),
          h('td', {}, l.label || ''), h('td', {}, new Date(l.created_at).toLocaleDateString()), h('td', {}, l.last_seen ? new Date(l.last_seen).toLocaleString() : 'never'),
          h('td', {}, l.revoked ? 'Switched off' : 'On'),
          h('td', { class: 'dash-actions' },
            l.revoked ? null : h('button', { class: 'dash-btn', type: 'button', onclick: function () { copy(url); } }, 'Copy link'),
            l.revoked ? null : h('button', { class: 'dash-btn', type: 'button', onclick: function () { api('/admin/dash/links/' + l.token + '/revoke', { method: 'POST', body: {} }).then(function (r) { data.links = r.links; linksSection(box, data); }).catch(function (e) { toast(e.message, true); }); } }, 'Switch off'),
            h('button', { class: 'dash-btn danger', type: 'button', onclick: function () { if (!confirm('Delete this link for good?')) return; api('/admin/dash/links/' + l.token, { method: 'DELETE' }).then(function (r) { data.links = r.links; linksSection(box, data); }).catch(function (e) { toast(e.message, true); }); } }, 'Delete')));
      })))));
  }

  // ---------- Income (owner only) ----------
  function naira(n) { return '\u20a6' + Number(n || 0).toLocaleString('en-NG', { maximumFractionDigits: 0 }); }
  var KIND = { adsense: 'AdSense', sponsor: 'Sponsored races', other: 'Other' };
  function monthName(m) { var p = m.split('-'); return new Date(Number(p[0]), Number(p[1]) - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }); }
  function incomeSection(box, data) {
    box.textContent = '';
    var now = new Date(), thisMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    var month = h('input', { type: 'month', id: 'in-month', value: thisMonth, 'aria-label': 'Month' });
    var kind = h('select', { id: 'in-kind', 'aria-label': 'Where from' }, Object.keys(KIND).map(function (k) { return h('option', { value: k }, KIND[k]); }));
    var amount = h('input', { type: 'number', id: 'in-amt', min: '0', step: '0.01', inputmode: 'decimal', placeholder: 'Amount', 'aria-label': 'Amount' });
    var cur = h('select', { id: 'in-cur', 'aria-label': 'Currency' }, h('option', { value: 'NGN' }, 'Naira'), h('option', { value: 'USD' }, 'Dollars'));
    var rate = h('input', { type: 'number', id: 'in-rate', min: '1', step: '0.01', inputmode: 'decimal', placeholder: 'Naira per $1', 'aria-label': 'Naira for one dollar' });
    var rateField = h('div', { class: 'field dash-hide' }, h('label', { for: 'in-rate' }, 'Naira for $1'), rate);
    cur.addEventListener('change', function () { rateField.classList.toggle('dash-hide', cur.value !== 'USD'); });
    var note = h('input', { type: 'text', id: 'in-note', maxlength: '80', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    var add = h('button', { class: 'dash-btn primary', type: 'button', onclick: function () {
      add.disabled = true;
      api('/admin/income', { method: 'POST', body: { month: month.value, kind: kind.value, amount: amount.value, currency: cur.value, rate: rate.value, note: note.value } })
        .then(function (r) { toast('Saved'); incomeSection(box, r); })
        .catch(function (e) { toast(e.message, true); add.disabled = false; });
    } }, 'Add income');
    var top = data.months[0], prev = data.months[1];
    var change = top && prev && prev.total > 0 ? Math.round(((top.total - prev.total) / prev.total) * 100) : null;
    box.append(h('h2', {}, 'Income'),
      h('p', { class: 'dash-hint' }, 'Coin and premium sales are filled in by themselves from the payments. AdSense, sponsored races and anything else you type in below (the game cannot read your AdSense account, so copy the amount from it). Only you can see this section; it is never in the investor or advertiser links.'),
      top ? h('p', { class: 'dash-hint' }, monthName(top.month) + ': ', h('b', {}, naira(top.total)), change == null ? '' : ' (' + (change >= 0 ? '+' : '') + change + '% compared with ' + monthName(prev.month) + ')') : h('p', { class: 'dash-hint' }, 'No income yet.'),
      h('div', { class: 'dash-form' },
        h('div', { class: 'field' }, h('label', { for: 'in-month' }, 'Month'), month),
        h('div', { class: 'field' }, h('label', { for: 'in-kind' }, 'From'), kind),
        h('div', { class: 'field' }, h('label', { for: 'in-amt' }, 'Amount'), amount),
        h('div', { class: 'field' }, h('label', { for: 'in-cur' }, 'In'), cur), rateField,
        h('div', { class: 'field' }, h('label', { for: 'in-note' }, 'Note'), note), add));
    if (data.months.length) box.append(h('div', { class: 'dash-tablewrap' }, h('table', { class: 'dash-table' },
      h('thead', {}, h('tr', {}, ['Month', 'Coin sales', 'Premium', 'AdSense', 'Sponsored races', 'Other', 'Total'].map(function (x) { return h('th', {}, x); }))),
      h('tbody', {}, data.months.map(function (m) {
        return h('tr', {}, h('th', { scope: 'row' }, monthName(m.month)), h('td', {}, naira(m.coins)), h('td', {}, naira(m.premium)), h('td', {}, naira(m.adsense)), h('td', {}, naira(m.sponsor)), h('td', {}, naira(m.other)), h('td', {}, h('b', {}, naira(m.total))));
      })))));
    if (data.entries.length) box.append(h('h3', {}, 'What you typed in'), h('div', { class: 'dash-tablewrap' }, h('table', { class: 'dash-table' },
      h('thead', {}, h('tr', {}, ['Month', 'From', 'Amount', 'Note', ''].map(function (x) { return h('th', {}, x); }))),
      h('tbody', {}, data.entries.map(function (e) {
        return h('tr', {}, h('th', { scope: 'row' }, monthName(e.month)), h('td', {}, KIND[e.kind] || e.kind),
          h('td', {}, e.currency === 'USD' ? '$' + e.amount + ' at ' + naira(e.rate) + ' = ' + naira(e.naira) : naira(e.naira)), h('td', {}, e.note || ''),
          h('td', { class: 'dash-actions' }, h('button', { class: 'dash-btn danger', type: 'button', onclick: function () {
            if (!confirm('Delete this entry?')) return;
            api('/admin/income/' + e.id, { method: 'DELETE' }).then(function (r) { incomeSection(box, r); }).catch(function (x) { toast(x.message, true); });
          } }, 'Delete')));
      })))));
  }

  var reportBox = h('div'), incomeBox = h('section', { class: 'dash-sec dash-income' }), linksBox = h('section', { class: 'dash-sec dash-links' });
  function load() {
    return api('/admin/dash?days=' + days).then(function (d) {
      DASH.renderOverview(reportBox, d, { title: 'PixSabi dashboard', fileName: 'naija-sabi-report-' + d.to, reload: function (n) { days = n; load(); } });
    }).catch(fail);
  }
  function fail(e) {
    root.textContent = '';
    root.append(h('div', { class: 'dash-msg' }, h('h1', {}, e.status === 401 ? 'Log in first' : 'Not found'),
      h('p', {}, e.status === 401 ? 'Log in to the game with the admin account, then open this page again.' : 'There is nothing here.'), h('a', { class: 'dash-btn', href: '/' }, 'Go to the game')));
  }
  root.append(h('nav', { class: 'dash-nav' }, h('a', { href: '/admin.html' }, 'Admin page'), h('a', { href: '/' }, 'Back to the game')), reportBox, incomeBox, linksBox);
  load().then(function () { return api('/admin/income').then(function (d) { incomeSection(incomeBox, d); }).then(function () { return api('/admin/dash/links'); }); }).then(function (d) { linksSection(linksBox, d); }).catch(function () { /* the failure message is already shown */ });
})();
