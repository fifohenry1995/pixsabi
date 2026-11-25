/* Draws the dashboard report (the owner's page, the investors' link and the advertisers' link all use this).
   Everything is built with textContent and SVG, so nothing from the data can run as code. */
(function () {
  var D = (window.DASH = {});
  var SVGNS = 'http://www.w3.org/2000/svg';

  function h(tag, attrs) {
    var el = document.createElement(tag);
    for (var k in (attrs || {})) { if (attrs[k] == null || attrs[k] === false) continue; if (k === 'class') el.className = attrs[k]; else if (k === 'onclick') el.addEventListener('click', attrs[k]); else el.setAttribute(k, attrs[k]); }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  }
  function add(el, c) { if (c == null || c === false) return; if (Array.isArray(c)) c.forEach(function (x) { add(el, x); }); else el.append(c.nodeType ? c : document.createTextNode(String(c))); }
  function s(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    for (var k in (attrs || {})) if (attrs[k] != null) el.setAttribute(k, attrs[k]);
    for (var i = 2; i < arguments.length; i++) { var c = arguments[i]; if (c != null) el.append(c.nodeType ? c : document.createTextNode(String(c))); }
    return el;
  }
  var fmt = function (n) { return Number(n || 0).toLocaleString('en-US'); };
  var naira = function (n) { return '₦' + fmt(n); };
  var short = function (d) { var p = d.split('-'); return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(p[1]) - 1] + ' ' + Number(p[2]); };
  D.fmt = fmt; D.naira = naira;

  function nice(max) {
    if (max <= 4) return 4;
    var p = Math.pow(10, Math.floor(Math.log10(max))), f = max / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p;
  }

  // series: [{ name, cls, data: [{ day, n }] }]  type: 'line' | 'bar'
  function chart(series, o) {
    o = o || {};
    var W = 640, H = 210, L = 44, R = 10, T = 12, B = 26;
    var days = series[0].data.map(function (p) { return p.day; });
    var max = nice(Math.max.apply(null, [1].concat(series.map(function (x) { return Math.max.apply(null, x.data.map(function (p) { return p.n; })); }))));
    var X = function (i) { return L + (days.length === 1 ? 0 : (i * (W - L - R)) / (days.length - 1)); };
    var Y = function (v) { return T + (1 - v / max) * (H - T - B); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'dash-chart', role: 'img', 'aria-label': o.label || 'Chart' });
    for (var g = 0; g <= 4; g++) {
      var v = (max * g) / 4, y = Y(v);
      svg.append(s('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'dash-grid' }), s('text', { x: L - 6, y: y + 4, class: 'dash-axis', 'text-anchor': 'end' }, o.money ? naira(v) : fmt(v)));
    }
    [0, Math.floor((days.length - 1) / 2), days.length - 1].forEach(function (i, k) {
      if (days[i]) svg.append(s('text', { x: X(i), y: H - 6, class: 'dash-axis', 'text-anchor': k === 0 ? 'start' : k === 2 ? 'end' : 'middle' }, short(days[i])));
    });
    if (o.type === 'bar') {
      var bw = Math.max(2, ((W - L - R) / days.length) * 0.7);
      series[0].data.forEach(function (p, i) {
        var y = Y(p.n);
        var r = s('rect', { x: X(i) - bw / 2 + (days.length === 1 ? bw / 2 : 0), y: y, width: bw, height: Math.max(0, H - B - y), class: 'dash-bar ' + (series[0].cls || 'c1') });
        r.append(s('title', {}, short(p.day) + ': ' + (o.money ? naira(p.n) : fmt(p.n))));
        svg.append(r);
      });
    } else {
      series.forEach(function (sr) {
        var pts = sr.data.map(function (p, i) { return X(i) + ',' + Y(p.n); }).join(' ');
        svg.append(s('polyline', { points: pts, class: 'dash-line ' + sr.cls }));
        if (days.length <= 45) sr.data.forEach(function (p, i) {
          var c = s('circle', { cx: X(i), cy: Y(p.n), r: 2.6, class: 'dash-dot ' + sr.cls });
          c.append(s('title', {}, sr.name + ', ' + short(p.day) + ': ' + fmt(p.n)));
          svg.append(c);
        });
      });
    }
    var wrap = h('div', { class: 'dash-chartbox' });
    if (series.length > 1) wrap.append(h('div', { class: 'dash-legend' }, series.map(function (sr) { return h('span', {}, h('i', { class: 'dash-key ' + sr.cls }), sr.name); })));
    wrap.append(svg);
    return wrap;
  }

  function kpi(label, value, sub) { return h('div', { class: 'dash-kpi' }, h('div', { class: 'dash-kpi-n' }, value), h('div', { class: 'dash-kpi-l' }, label), sub ? h('div', { class: 'dash-kpi-s' }, sub) : null); }
  function section(title, hint) { var sec = h('section', { class: 'dash-sec' }, h('h2', {}, title)); if (hint) sec.append(h('p', { class: 'dash-hint' }, hint)); return sec; }
  function grid(kids) { return h('div', { class: 'dash-grid-kpi' }, kids); }
  function table(head, rows) {
    return h('div', { class: 'dash-tablewrap' }, h('table', { class: 'dash-table' },
      h('thead', {}, h('tr', {}, head.map(function (x) { return h('th', {}, x); }))),
      h('tbody', {}, rows.map(function (r) { return h('tr', {}, r.map(function (c, i) { return h(i === 0 ? 'th' : 'td', { scope: i === 0 ? 'row' : null }, c); })); }))));
  }
  var sumOf = function (a) { return a.reduce(function (t, p) { return t + p.n; }, 0); };
  var pct = function (x) { return x + '%'; };

  function toolbar(d, o) {
    var sel = h('select', { 'aria-label': 'Time range' }, [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [365, 'Last year']].map(function (x) { return h('option', { value: String(x[0]), selected: x[0] === d.days ? 'selected' : null }, x[1]); }));
    sel.addEventListener('change', function () { o.reload(Number(sel.value)); });
    return h('div', { class: 'dash-tools' }, sel,
      h('button', { class: 'dash-btn', type: 'button', onclick: function () { D.download(o.fileName || 'pixsabi', D.csv(d)); } }, 'Download spreadsheet (CSV)'),
      h('button', { class: 'dash-btn', type: 'button', onclick: function () { window.print(); } }, 'Print or save as PDF'));
  }

  // ---------- spreadsheet export ----------
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  D.csv = function (d) {
    var rows = [];
    if (d.kind === 'advertiser') {
      rows.push(['Advertiser', d.advertiser], ['From', d.from], ['To', d.to], []);
      rows.push(['Advert', 'Type', 'Views', 'Different visitors', 'Clicks', 'Click rate %', 'Closed by player']);
      d.adverts.forEach(function (a) { rows.push([a.label, a.kind === 'popup' ? 'Pop-up' : 'Side picture', a.views, a.uniques, a.clicks, a.ctr, a.closes]); });
      rows.push([], ['Day', 'Views', 'Clicks']);
      d.adverts.length && d.adverts[0].series.forEach(function (p, i) {
        rows.push([p.day, d.adverts.reduce(function (t, a) { return t + a.series[i].views; }, 0), d.adverts.reduce(function (t, a) { return t + a.series[i].clicks; }, 0)]);
      });
    } else {
      var S = d.series;
      rows.push(['Day', 'New players', 'Active players', 'Naija levels solved', 'Universal levels solved', 'Word searches done', 'Sliding puzzles done', 'Daily puzzles', 'Races created', 'Race joins', 'Races finished', 'Chat messages', 'Private messages', 'Coin sales (NGN)', 'Coin purchases', 'Advert views', 'Advert clicks']);
      S.signups.forEach(function (p, i) {
        rows.push([p.day, p.n, S.active[i].n, S.solveNaija[i].n, S.solveUniversal[i].n, S.solveWordSearch[i].n, S.solveSlide[i].n, S.daily[i].n, S.raceCreated[i].n, S.raceJoined[i].n, S.raceFinished[i].n, S.chat[i].n, S.dm[i].n, S.revenue[i].n, S.revenue[i].buys,
          d.adverts.reduce(function (t, a) { return t + a.series[i].views; }, 0), d.adverts.reduce(function (t, a) { return t + a.series[i].clicks; }, 0)]);
      });
      rows.push([], ['Advert', 'Advertiser', 'Type', 'Views', 'Different visitors', 'Clicks', 'Click rate %', 'Closed by player']);
      d.adverts.forEach(function (a) { rows.push([a.label, a.advertiser, a.kind === 'popup' ? 'Pop-up' : 'Side picture', a.views, a.uniques, a.clicks, a.ctr, a.closes]); });
    }
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  };
  D.download = function (name, text) {
    var a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })), download: name + '.csv' });
    document.body.append(a); a.click(); setTimeout(function () { a.remove(); URL.revokeObjectURL(a.href); }, 500);
  };

  function adTable(adverts, withWho) {
    if (!adverts.length) return h('p', { class: 'dash-hint' }, 'No adverts yet.');
    var head = ['Advert'].concat(withWho ? ['Advertiser'] : [], ['Views', 'Visitors', 'Clicks', 'Click rate', 'Closed']);
    return table(head, adverts.map(function (a) {
      return [h('span', { class: 'dash-adname' }, a.label, a.active === false ? h('em', {}, ' (off)') : null)].concat(withWho ? [a.advertiser || '(no name)'] : [], [fmt(a.views), fmt(a.uniques), fmt(a.clicks), pct(a.ctr), a.kind === 'popup' ? fmt(a.closes) : '-']);
    }));
  }
  function adTotals(adverts) {
    var views = 0, clicks = 0;
    adverts.forEach(function (a) { views += a.views; clicks += a.clicks; });
    return { views: views, clicks: clicks, ctr: views ? Math.round((clicks / views) * 10000) / 100 : 0 };
  }
  function adSeries(adverts, key, days) {
    return days.map(function (p, i) { return { day: p.day, n: adverts.reduce(function (t, a) { return t + a.series[i][key]; }, 0) }; });
  }

  // ---------- the owner's / investors' report ----------
  D.renderOverview = function (root, d, o) {
    d.kind = d.kind || 'investor';
    root.textContent = '';
    var A = d.audience, S = d.series, G = d.games, M = d.money, R = d.retention;
    root.append(h('header', { class: 'dash-head' },
      h('div', {}, h('h1', {}, o.title || 'PixSabi: player and advert report'), h('p', { class: 'dash-hint' }, short(d.from) + ' to ' + short(d.to) + '. Updated ' + new Date(d.generatedAt).toLocaleString() + '.')),
      toolbar(d, o)));

    var a = section('Players');
    a.append(grid([
      kpi('Registered players', fmt(A.players)), kpi('New in this period', fmt(A.newInRange)),
      kpi('Active today', fmt(A.dau)), kpi('Active this week', fmt(A.wau)), kpi('Active this month', fmt(A.mau)),
      kpi('Daily / monthly active', pct(A.stickiness), 'how often players come back'),
      kpi('Online right now', fmt(A.online)),
      kpi('Played at least one level', pct(A.activatedPct), fmt(A.activated) + ' players'),
      kpi('Average levels per player', String(A.avgLevels)),
      kpi('Come back next day', R.d1 ? pct(R.d1.rate) : 'Collecting', R.d1 ? 'of ' + fmt(R.d1.cohort) + ' new players' : 'needs a full day of data'),
      kpi('Come back after a week', R.d7 ? pct(R.d7.rate) : 'Collecting', R.d7 ? 'of ' + fmt(R.d7.cohort) + ' new players' : 'needs a full week of data'),
    ]));
    a.append(h('h3', {}, 'New players per day'), chart([{ name: 'New players', cls: 'c1', data: S.signups }], { type: 'bar', label: 'New players per day' }));
    a.append(h('h3', {}, 'Active players per day'), chart([{ name: 'Active players', cls: 'c2', data: S.active }], { label: 'Active players per day' }));
    if (!d.tracking.activitySince) a.append(h('p', { class: 'dash-hint' }, 'Daily activity has not been recorded yet. It starts building from the first day this version runs.'));
    else a.append(h('p', { class: 'dash-hint' }, 'Daily activity has been recorded since ' + short(d.tracking.activitySince) + '. Earlier days show zero because that data did not exist yet; sign-up numbers go back to the first player.'));
    root.append(a);

    var b = section('What players play');
    b.append(grid([
      kpi('Naija levels solved', fmt(G.playsInRange.Naija), 'this period'), kpi('Universal levels solved', fmt(G.playsInRange.Universal), 'this period'),
      kpi('Word searches done', fmt(G.playsInRange['Word Search']), 'this period'), kpi('Sliding puzzles done', fmt(G.playsInRange['Slide Puzzle']), 'this period'), kpi('Daily puzzles solved', fmt(G.playsInRange.Daily), 'this period'),
      kpi('All time: Naija', fmt(G.levelsTotal.Naija)), kpi('All time: Universal', fmt(G.levelsTotal.Universal)), kpi('All time: Word Search', fmt(G.levelsTotal['Word Search'])), kpi('All time: Sliding puzzle', fmt(G.levelsTotal['Slide Puzzle'])),
    ]));
    b.append(chart([{ name: 'Naija', cls: 'c1', data: S.solveNaija }, { name: 'Universal', cls: 'c2', data: S.solveUniversal }, { name: 'Word Search', cls: 'c3', data: S.solveWordSearch }, { name: 'Sliding puzzle', cls: 'c4', data: S.solveSlide }], { label: 'Levels solved per day' }));
    b.append(h('p', { class: 'dash-hint' }, 'Puzzles in the game: ' + G.puzzles.map(function (p) { return p.name + ' ' + fmt(p.count); }).join(', ') + '.'));
    root.append(b);

    var c = section('Races and chat');
    c.append(grid([
      kpi('Races created', fmt(G.races.created)), kpi('Players joined races', fmt(G.races.joined)), kpi('Races finished', fmt(G.races.finished)),
      kpi('Chat messages', fmt(G.chat.room)), kpi('Private messages', fmt(G.chat.private)),
    ]));
    c.append(chart([{ name: 'Races created', cls: 'c1', data: S.raceCreated }, { name: 'Race joins', cls: 'c2', data: S.raceJoined }, { name: 'Chat messages', cls: 'c3', data: S.chat }], { label: 'Races and chat per day' }));
    root.append(c);

    var m = section('Money', 'Coin and Premium sales through Paystack (only paid orders).');
    m.append(grid([
      kpi('Sales in this period', naira(M.rangeNaira), fmt(M.rangePurchases) + ' purchases'), kpi('Sales, all time', naira(M.totalNaira), fmt(M.purchases) + ' purchases'),
      kpi('Players who bought coins', fmt(M.buyers), pct(M.buyersPct) + ' of all players'), kpi('Average coin purchase', naira(M.avgOrderNaira)),
    ]));
    m.append(grid([kpi('Premium sales, all time', naira(M.premiumNaira), fmt(M.premiumPurchases) + ' purchases'), kpi('Premium members now', fmt(M.premiumActive))]));
    m.append(chart([{ name: 'Sales', cls: 'c4', data: S.revenue }], { type: 'bar', money: true, label: 'Coin sales per day' }));
    root.append(m);

    var t = adTotals(d.adverts);
    var ad = section('Adverts', 'Side pictures (laptops and big screens) and pop-ups. A view counts when the advert is on screen; a click when someone taps its link.');
    ad.append(grid([kpi('Advert views', fmt(t.views)), kpi('Advert clicks', fmt(t.clicks)), kpi('Click rate', pct(t.ctr))]));
    if (d.adverts.length) ad.append(chart([{ name: 'Views', cls: 'c1', data: adSeries(d.adverts, 'views', S.signups) }, { name: 'Clicks', cls: 'c3', data: adSeries(d.adverts, 'clicks', S.signups) }], { label: 'Advert views and clicks per day' }));
    ad.append(adTable(d.adverts, true));
    ad.append(h('p', { class: 'dash-hint' }, d.tracking.adsSince ? 'Advert counting has run since ' + short(d.tracking.adsSince) + '.' : 'Advert counting starts when this version runs. Views and clicks will appear here.'));
    root.append(ad);

    root.append(h('p', { class: 'dash-foot' }, 'All numbers are totals. No player names, emails or IP addresses are shown or stored in this report.'));
  };

  // ---------- one advertiser's report ----------
  D.renderAdvertiser = function (root, d, o) {
    d.kind = 'advertiser';
    root.textContent = '';
    root.append(h('header', { class: 'dash-head' },
      h('div', {}, h('h1', {}, 'Advertising report: ' + d.advertiser), h('p', { class: 'dash-hint' }, 'PixSabi. ' + short(d.from) + ' to ' + short(d.to) + '. Updated ' + new Date(d.generatedAt).toLocaleString() + '.')),
      toolbar(d, o)));
    var a = section('Your results');
    a.append(grid([kpi('Times your adverts were seen', fmt(d.totals.views)), kpi('Clicks to your link', fmt(d.totals.clicks)), kpi('Click rate', pct(d.totals.ctr))]));
    if (d.adverts.length) {
      var days = d.adverts[0].series;
      a.append(chart([{ name: 'Views', cls: 'c1', data: adSeries(d.adverts, 'views', days) }, { name: 'Clicks', cls: 'c3', data: adSeries(d.adverts, 'clicks', days) }], { label: 'Views and clicks per day' }));
    }
    a.append(adTable(d.adverts, false));
    a.append(h('p', { class: 'dash-hint' }, d.since ? 'Counting started ' + short(d.since) + '. Visitors means different phones or computers; one person on two devices counts twice.' : 'Counting has not started yet. Numbers appear after your advert is shown.'));
    root.append(a);
    var b = section('Who you reach', 'PixSabi players who open the game.');
    b.append(grid([kpi('Registered players', fmt(d.audience.players)), kpi('Active today', fmt(d.audience.dau)), kpi('Active this week', fmt(d.audience.wau)), kpi('Active this month', fmt(d.audience.mau))]));
    root.append(b);
    if (d.adverts.length) {
      var p = section('Your adverts');
      p.append(h('div', { class: 'dash-previews' }, d.adverts.map(function (a2) {
        var media = a2.media === 'video' ? h('video', { src: a2.image, muted: 'muted', loop: 'loop', playsinline: '', autoplay: 'autoplay' }) : h('img', { src: a2.image, alt: a2.alt || 'Advert', loading: 'lazy' });
        return h('figure', {}, media, h('figcaption', {}, a2.label));
      })));
      root.append(p);
    }
    root.append(h('p', { class: 'dash-foot' }, 'All numbers are totals. No player information is shown.'));
  };
})();
