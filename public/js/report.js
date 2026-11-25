/* The private report for an investor or an advertiser. The secret is the last part of the link. */
(function () {
  var root = document.getElementById('dash');
  var token = location.pathname.split('/').pop();
  var days = 30;
  function load() {
    fetch('/api/report/' + encodeURIComponent(token) + '?days=' + days, { credentials: 'omit' })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'This report is not available.'); return j; }); })
      .then(function (d) {
        var o = { reload: function (n) { days = n; load(); }, fileName: 'pixsabi-' + (d.kind === 'advertiser' ? 'advertising' : 'report') + '-' + d.to };
        if (d.kind === 'advertiser') DASH.renderAdvertiser(root, d, o); else DASH.renderOverview(root, d, Object.assign(o, { title: 'PixSabi: player and advert report' }));
      })
      .catch(function (e) {
        root.textContent = '';
        var box = document.createElement('div'); box.className = 'dash-msg';
        var t = document.createElement('h1'); t.textContent = 'Report not available';
        var p = document.createElement('p'); p.textContent = e.message;
        box.append(t, p); root.append(box);
      });
  }
  load();
})();
