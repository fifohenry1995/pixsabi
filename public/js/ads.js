// Shows the advert pictures (set on the admin page): three on the left and three on the right of the game.
// The panels only appear on wide screens (laptops); phones and tablets never see them.
// Builds a Google AdSense ad unit from the checked settings the server sends (never from pasted text).
window.NS_adsenseUnits = [];
// A fresh ad for a new screen. This replaces each visible AdSense ad with a new request, WITHOUT reloading the game.
// It is only called when the player really moves to something new (another page, or the next level), and never more
// than once every 60 seconds, so it is never a timed refresh. Direct adverts (pictures) are left alone.
var NS_lastAdRefresh = Date.now();
window.NS_refreshAds = function () {
  if (Date.now() - NS_lastAdRefresh < 60000) return;
  if (document.hidden) return;
  var keep = [];
  window.NS_adsenseUnits.forEach(function (w) {
    if (!w.isConnected) return;               // the screen it was on is gone
    if (w.classList.contains('ad-results')) { keep.push(w); return; }   // results page ads are made fresh with the page
    var r = w.getBoundingClientRect();
    if (!r.width || !r.height) { keep.push(w); return; }                // hidden (for example a side panel on a phone)
    var fresh = window.NS_adsenseUnit(w._g, w.className);
    w.replaceWith(fresh);
  });
  window.NS_adsenseUnits = window.NS_adsenseUnits.filter(function (w) { return w.isConnected; });
  NS_lastAdRefresh = Date.now();
};
window.addEventListener('hashchange', function () { window.NS_refreshAds(); });
window.NS_adsenseUnit = function (g, cls) {
  var wrap = document.createElement('div');
  wrap.className = cls || 'ad adsense';
  var ins = document.createElement('ins');
  ins.className = 'adsbygoogle';
  ins.style.display = g.w ? 'inline-block' : 'block';
  if (g.w) { ins.style.width = g.w + 'px'; ins.style.height = g.h + 'px'; }
  ins.setAttribute('data-ad-client', g.client);
  ins.setAttribute('data-ad-slot', g.slot);
  if (g.format) ins.setAttribute('data-ad-format', g.format);
  if (g.format && g.fullWidth) ins.setAttribute('data-full-width-responsive', 'true');
  var tag = document.createElement('span'); // a label above the ad, never on top of it
  tag.className = 'ad-label'; tag.textContent = 'Advertisement';
  wrap.append(tag, ins);
  wrap._g = g;
  if (window.NS_adsenseUnits) window.NS_adsenseUnits.push(wrap);
  // the AdSense script is loaded by the page itself when AdSense is on; asking it to fill this unit once it is in the page
  setTimeout(function () { try { (window.adsbygoogle = window.adsbygoogle || []).push({}); } catch (e) { /* blocked by an ad blocker: fine */ } }, 0);
  return wrap;
};
// The banner for the full-page race results: returns an element, or null when there is none, or AdSense is off.
window.NS_resultsAdEl = function () {
  if (!window.NS_resultsAd) return null;
  return window.NS_adsenseUnit(window.NS_resultsAd, 'ad adsense ad-results');
};
(function () {
  var left = document.getElementById('ads');
  var right = document.getElementById('ads-right');
  if (!left || !right) return;
  function fill(box, ads) {
    box.textContent = '';
    ads.forEach(function (a) {
      if (a.adsense) { box.append(window.NS_adsenseUnit(a.adsense, 'ad adsense')); return; }
      var img = document.createElement('img');
      img.src = a.image; img.alt = a.alt || 'Advert'; img.loading = 'lazy'; img.decoding = 'async';
      var tag = document.createElement('span');
      tag.className = 'ad-tag'; tag.textContent = 'Advert';
      var el;
      if (a.link) {
        el = document.createElement('a');
        el.href = a.link; el.target = '_blank'; el.rel = 'noopener noreferrer sponsored';
      } else {
        el = document.createElement('div');
      }
      el.className = 'ad';
      el.append(img, tag);
      box.append(el);
      // count a view once per page load, when at least half of the advert is on screen; count clicks on adverts with a link
      if (window.NS && NS.track) {
        if (a.link) el.addEventListener('click', function () { NS.track('ad', a.slot, 'click'); });
        if ('IntersectionObserver' in window) {
          var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (en) { if (en.isIntersecting) { NS.track('ad', a.slot, 'view'); io.disconnect(); } });
          }, { threshold: 0.5 });
          io.observe(el);
        }
      }
    });
    box.style.setProperty('--n', String(Math.max(1, ads.length))); // pictures get bigger when fewer are shown
    box.classList.toggle('has', ads.length > 0);
  }
  // Phones and tablets: one Google ad in a fixed header at the top (the side panels only fit on laptops).
  function fillMobile(g) {
    var box = document.getElementById('ads-mobile');
    if (!box || !g || window.innerWidth >= 1100) return;
    box.textContent = '';
    box.append(window.NS_adsenseUnit(g, 'ad adsense ad-mob'));
    box.classList.add('has');
  }
  fetch('/api/ads', { credentials: 'same-origin' })
    .then(function (r) { return r.ok ? r.json() : { ads: [] }; })
    .then(function (data) {
      window.NS_resultsAd = (data && data.results) || null;
      var ads = (data && data.ads) || [];
      fillMobile(data && data.mobile);
      fill(left, ads.filter(function (a) { return a.side !== 'right'; }));
      fill(right, ads.filter(function (a) { return a.side === 'right'; }));
    })
    .catch(function () { /* no adverts is fine */ });
})();
