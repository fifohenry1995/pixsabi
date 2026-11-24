/* Pop-up adverts: after a player finishes every Nth level in solo play, show the next advert
   (picture, GIF or video). The advert can always be closed once the short wait is over.
   What to show, how often and how long to wait are set on the admin page. */
(function () {
  var NS = (window.NS = window.NS || {});
  var cfg = null;
  var loadedAt = 0;

  function load() {
    return fetch('/api/popups', { credentials: 'same-origin' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (d) { if (d) { cfg = d; loadedAt = Date.now(); } return cfg; })
      .catch(function () { return cfg; });
  }
  load();

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function show(item, wait, done) {
    var closed = false;
    var timer = null;
    var overlay = el('div', 'overlay popup-overlay');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Advert');
    var card = el('div', 'popup-card');

    var media;
    if (item.kind === 'adsense') {
      if (done) done(); return;   // Google ads are never shown in pop-ups (against AdSense rules)
    } else if (item.kind === 'video') {
      media = document.createElement('video');
      media.muted = true; media.defaultMuted = true; media.autoplay = true; media.loop = true;
      media.setAttribute('playsinline', ''); media.setAttribute('preload', 'auto');
      media.src = item.url;
    } else {
      media = document.createElement('img');
      media.alt = item.title || 'Advert';
      media.src = item.url;
    }
    if (item.kind !== 'adsense') media.className = 'popup-media';

    var frame;
    if (item.link) {
      frame = el('a', 'popup-frame');
      frame.href = item.link; frame.target = '_blank'; frame.rel = 'noopener noreferrer sponsored';
    } else {
      frame = el('div', 'popup-frame');
    }
    if (item.kind === 'adsense') frame.append(media); else frame.append(media, el('span', 'popup-tag', 'Advert'));

    var bar = el('div', 'popup-bar');
    var closeBtn = el('button', 'btn popup-close');
    closeBtn.type = 'button';
    bar.append(closeBtn);
    if (item.link) {
      var more = el('a', 'btn alt popup-more', 'Learn more');
      more.href = item.link; more.target = '_blank'; more.rel = 'noopener noreferrer sponsored';
      bar.prepend(more);
    }
    if (item.kind === 'video') {
      var sound = el('button', 'btn alt popup-sound', 'Sound off');
      sound.type = 'button';
      sound.addEventListener('click', function () {
        media.muted = !media.muted;
        sound.textContent = media.muted ? 'Sound off' : 'Sound on';
        if (media.paused) { var p = media.play(); if (p && p.catch) p.catch(function () {}); }
      });
      bar.prepend(sound);
    }
    card.append(frame);
    if (item.title) card.append(el('p', 'popup-title', item.title));
    card.append(bar);
    // Only once the owner has opened Premium on the admin page.
    var promo = null;
    if (cfg && cfg.premiumOpen) {
      promo = el('p', 'popup-prem');
      promo.append(document.createTextNode('Tired of adverts? '));
      var pl = el('a', 'popup-prem-link', 'Go Premium');
      pl.href = '#/premium';
      promo.append(pl, document.createTextNode(' for no pop-up adverts, fun facts and a gold crown by your name.'));
      card.append(promo);
    }
    overlay.append(card);
    // Tapping Go Premium closes the advert and opens the Premium page (it does not carry on to the next level).
    if (promo) promo.querySelector('a').addEventListener('click', function () { cleanup(); });

    function cleanup() {
      closed = true;
      if (timer) clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      if (media.pause) media.pause();
      overlay.remove();
    }
    function finish(byPlayer) { if (closed) return; cleanup(); if (byPlayer === true && NS.track) NS.track('popup', item.id, 'close'); done(); }

    var left = Math.max(0, Number(wait) || 0);
    function paint() {
      closeBtn.textContent = left > 0 ? 'Close (' + left + ')' : 'Close';
      closeBtn.disabled = left > 0;
    }
    paint();
    if (left > 0) {
      timer = setInterval(function () {
        if (!overlay.isConnected) { if (!closed) cleanup(); return; } // the player left this screen
        left--; paint();
        if (left <= 0) { clearInterval(timer); timer = null; closeBtn.focus(); }
      }, 1000);
    }
    function onKey(e) { if (e.key === 'Escape' && left <= 0) finish(true); }
    document.addEventListener('keydown', onKey);
    closeBtn.addEventListener('click', function () { finish(true); });
    if (promo) promo.querySelector('a').addEventListener('click', function () { cleanup(); }); // leave the advert and open the Premium page
    if (item.link && NS.track) {
      frame.addEventListener('click', function () { NS.track('popup', item.id, 'click'); });
      bar.querySelector('.popup-more').addEventListener('click', function () { NS.track('popup', item.id, 'click'); });
    }
    // A picture or video that will not load is skipped quietly instead of showing a broken box.
    media.addEventListener('error', finish);

    document.body.append(overlay);
    if (NS.track) NS.track('popup', item.id, 'view');
    if (left <= 0) closeBtn.focus();
  }

  // Called after the player taps "Next puzzle" on a solo win. `solved` = puzzles solved so far.
  NS.afterSolve = function (solved, next) {
    function go() {
      if (!cfg || !cfg.enabled || !cfg.items.length || !solved || solved % cfg.every !== 0) return next();
      var i = (solved / cfg.every - 1) % cfg.items.length; // adverts take turns, in order
      show(cfg.items[i], cfg.closeAfter, next);
    }
    if (Date.now() - loadedAt > 300000) load().then(go); else go();
  };
})();
