/* Install support: registers the service worker and shows a small "Install app" button. */
(function () {
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', function () { navigator.serviceWorker.register('/sw.js').catch(function () {}); });
  }

  // One shared install helper: the bottom bar, the Home card and the Settings button all use it, so the browser's install window opens only once.
  var NS = (window.NS = window.NS || {});
  var standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || window.navigator.standalone === true;
  function changed() { window.dispatchEvent(new Event('ns-install')); }
  NS.install = {
    event: null,
    ready: function () { return !!this.event; },
    // Opens the browser's own install window (only possible when the browser has offered it).
    ask: function () {
      var self = this, e = this.event;
      if (!e) return Promise.resolve(false);
      this.event = null;
      var bar = document.querySelector('.install-bar'); if (bar) bar.remove();
      changed();
      try { e.prompt(); } catch (x) { return Promise.resolve(false); }
      return e.userChoice.then(function (c) { return !!(c && c.outcome === 'accepted'); }, function () { return false; });
    }
  };
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); NS.install.event = e; changed(); });
  window.addEventListener('appinstalled', function () { NS.install.event = null; var b = document.querySelector('.install-bar'); if (b) b.remove(); remember(); changed(); });

  if (standalone) return;

  function remembered() { try { return localStorage.getItem('ns_install_dismissed') === '1'; } catch (e) { return false; } }
  function remember() { try { localStorage.setItem('ns_install_dismissed', '1'); } catch (e) { /* private mode */ } }
  if (remembered()) return;

  function bar(text, actionLabel, onAction) {
    var el = document.createElement('div');
    el.className = 'install-bar';
    var msg = document.createElement('span');
    msg.textContent = text;
    el.append(msg);
    if (actionLabel) {
      var go = document.createElement('button');
      go.type = 'button'; go.className = 'install-go'; go.textContent = actionLabel;
      go.addEventListener('click', function () { onAction(el); });
      el.append(go);
    }
    var no = document.createElement('button');
    no.type = 'button'; no.className = 'install-no'; no.setAttribute('aria-label', 'Close'); no.textContent = '×';
    no.addEventListener('click', function () { remember(); el.remove(); changed(); });
    el.append(no);
    document.body.append(el);
    changed();
  }

  // Android and desktop Chrome / Edge: the browser tells us the game can be installed.
  var shown = false;
  function offerBar() {
    if (shown || !NS.install.event) return;
    shown = true;
    bar('Install PixSabi on your phone', 'Install', function () { NS.install.ask(); });
  }
  window.addEventListener('beforeinstallprompt', offerBar);
  if (NS.install.event) offerBar();

  // iPhone / iPad Safari has no install button, so show how to do it by hand.
  var ua = navigator.userAgent || '';
  var iOS = /iphone|ipad|ipod/i.test(ua) && !/crios|fxios|edgios/i.test(ua);
  if (iOS) setTimeout(function () { bar('To install: tap Share, then "Add to Home Screen"'); }, 2500);
})();
