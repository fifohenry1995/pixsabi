/* Counts advert views, clicks and closes for the dashboard. Only totals are kept: the browser makes up a random
   visitor code for itself (no name, no email, no IP address is stored) so the dashboard can say how many different
   people saw an advert. Nothing here can break the game: every failure is ignored. */
(function () {
  var NS = (window.NS = window.NS || {});
  var vid = '';
  try {
    vid = localStorage.getItem('ns_vid') || '';
    if (!/^[a-f0-9]{16,32}$/.test(vid)) {
      var a = new Uint8Array(12);
      (window.crypto || window.msCrypto).getRandomValues(a);
      vid = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      localStorage.setItem('ns_vid', vid);
    }
  } catch (e) { /* private mode: no visitor code, so nothing is counted */ }
  // kind: 'ad' (side picture) or 'popup'; ev: 'view', 'click' or 'close'
  NS.track = function (kind, id, ev) {
    if (!vid) return;
    try {
      fetch('/api/track', {
        method: 'POST', keepalive: true, credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ vid: vid, events: [{ k: kind, id: String(id), e: ev }] }),
      }).catch(function () {});
    } catch (e) { /* ignore */ }
  };
})();
