/* Sound effects. Nothing to download: every sound is made on the phone with the browser's own audio (Web Audio).
   - Every button, tab and menu link gets a soft tap; letter tiles, coin buttons, right and wrong answers, wins and alerts have their own sounds.
   - Players can switch sounds off on the Me page. The choice is remembered on that device.
   - Sounds only start after the player has tapped something (browsers insist on that), and they are short and quiet. */
(function () {
  var NS = (window.NS = window.NS || {});
  var ctx = null;
  var lastAt = 0;
  var played = 0; // how many sounds have been played (used by the tests)

  function isOn() { try { return localStorage.getItem('ns_sound') !== 'off'; } catch (e) { return true; } }
  function setOn(on) { try { localStorage.setItem('ns_sound', on ? 'on' : 'off'); } catch (e) { /* private mode */ } }

  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx;
  }

  // One short note: frequency (Hz), start offset (s), length (s), wave shape, loudness. `to` slides the pitch.
  function note(c, freq, at, len, type, vol, to) {
    var o = c.createOscillator(), g = c.createGain(), t = c.currentTime + at;
    o.type = type || 'sine';
    o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + len);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.06, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + len + 0.02);
  }

  var SOUNDS = {
    tap: function (c) { note(c, 760, 0, 0.05, 'sine', 0.05, 520); },
    key: function (c) { note(c, 620, 0, 0.04, 'triangle', 0.05, 880); },
    nav: function (c) { note(c, 520, 0, 0.05, 'sine', 0.05, 700); },
    coin: function (c) { note(c, 1318, 0, 0.07, 'square', 0.03); note(c, 1760, 0.07, 0.14, 'square', 0.03); },
    correct: function (c) { note(c, 523, 0, 0.1, 'triangle', 0.07); note(c, 659, 0.09, 0.1, 'triangle', 0.07); note(c, 784, 0.18, 0.1, 'triangle', 0.07); note(c, 1046, 0.27, 0.22, 'triangle', 0.07); },
    wrong: function (c) { note(c, 220, 0, 0.2, 'sawtooth', 0.04, 130); },
    skip: function (c) { note(c, 600, 0, 0.08, 'sine', 0.05, 420); note(c, 420, 0.08, 0.1, 'sine', 0.05, 300); },
    win: function (c) { [523, 659, 784, 1046, 784, 1046, 1318].forEach(function (f, i) { note(c, f, i * 0.11, 0.18, 'triangle', 0.07); }); },
    alert: function (c) { note(c, 880, 0, 0.1, 'sine', 0.07); note(c, 1175, 0.12, 0.18, 'sine', 0.07); },
  };

  function play(name) {
    if (!isOn() || !SOUNDS[name]) return;
    var now = Date.now();
    if (name === 'tap' || name === 'key' || name === 'nav') { if (now - lastAt < 45) return; } // fast tapping never stacks up
    lastAt = now;
    var c = audio();
    if (!c) return;
    try { SOUNDS[name](c); played++; } catch (e) { /* a sound must never break the game */ }
  }

  // Every button and menu item, including ones added later, through one listener.
  var TAPPABLE = 'button, a.btn, a.nav-link, nav a, .logo, [role="tab"], [role="button"], .badge, .chip, summary, input[type="checkbox"], input[type="radio"], select';
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest(TAPPABLE) : null;
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return;
    if (el.matches('.key, .slot')) play('key');
    else if (el.matches('.buy, .chip.buy')) play('coin');
    else if (el.closest('.nav')) play('nav');
    else play('tap');
  }, true);

  NS.sound = { play: play, isOn: isOn, setOn: setOn, count: function () { return played; } };
})();
