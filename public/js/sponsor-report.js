/* The sponsor's own report for one sponsored race. The secret is the last part of the link. */
(function () {
  var root = document.getElementById('sp');
  var token = location.pathname.split('/').pop();
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function kpi(label, value) { var k = el('div', 'dash-kpi'); k.append(el('div', 'dash-kpi-n', String(value)), el('div', 'dash-kpi-l', label)); return k; }
  function when(ms) { return ms ? new Date(ms).toLocaleString('en-NG', { dateStyle: 'medium', timeStyle: 'short' }) : ''; }
  var STATUS = { waiting: 'Waiting for players', active: 'Race is on', finished: 'Finished', cancelled: 'Cancelled' };
  var GAME = { pictures: 'Picture puzzles', wordsearch: 'Word Search', slide: 'Slide Puzzle' };
  fetch('/api/sponsor-report/' + encodeURIComponent(token), { credentials: 'omit' })
    .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'This report is not available.'); return j; }); })
    .then(function (d) {
      root.textContent = '';
      var head = el('div', 'sp-head');
      if (d.logo) { var img = el('img', 'sponsor-logo'); img.src = d.logo; img.alt = d.sponsor; head.append(img); }
      var box = el('div', ''); box.append(el('h1', '', d.sponsor), el('p', 'dash-hint', 'Sponsored race report from PixSabi')); head.append(box);
      var info = el('div', 'dash-sec');
      info.append(el('p', '', 'Prize: ' + d.prize), el('p', '', (GAME[d.game] || 'Race') + ', ' + d.rounds + ' levels'),
        el('p', '', 'Status: ' + (STATUS[d.status] || d.status)));
      if (d.startAt) info.append(el('p', '', 'Start time: ' + when(d.startAt)));
      if (d.endedAt) info.append(el('p', '', 'Finished: ' + when(d.endedAt)));
      var grid = el('div', 'dash-grid-kpi');
      grid.append(kpi('Players who saw the race card', d.views), kpi('Taps on your link', d.taps), kpi('Players who joined', d.joined), kpi('Players who finished', d.finished));
      root.append(head, info, grid);
      if (d.status === 'finished') {
        var w = el('div', 'dash-sec');
        if (d.winner) w.append(el('h2', '', 'Winner: ' + d.winner), el('p', '', d.prizeStatus === 'paid' ? 'The prize has been sent.' : d.prizeStatus === 'approved' ? 'The winner is approved and the prize is being sent.' : 'We are checking the winner before the prize is sent.'));
        else w.append(el('h2', '', 'No winner'), el('p', '', 'Nobody qualified for the prize.'));
        root.append(w);
      }
      root.append(el('p', 'dash-hint', 'This page updates every time you open it. Keep the link private.'));
    })
    .catch(function (e) {
      root.textContent = '';
      var b = el('div', 'dash-msg'); b.append(el('h1', '', 'Report not available'), el('p', '', e.message)); root.append(b);
    });
})();
