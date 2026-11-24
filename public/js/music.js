/* The PixSabi theme: an original afro rap beat played by the phone itself (Web Audio). No audio file to download.
   - Log-drum bass, kick, clap, shaker and hi-hats, a clave pattern and a kalimba-style hook that loops over four bars.
   - OFF until the player turns it on (the 🎵 button at the top, or Me > Sound). The choice is remembered on that device.
   - To make the music start ON for new players, change DEFAULT_ON to true. It then still waits for the first tap (browsers insist on that).
   - It stops when the app is hidden or the phone is locked. */
(function () {
  var NS = (window.NS = window.NS || {});
  var DEFAULT_ON = false;
  var BPM = 94, SWING = 0.14, VOLUME = 0.45;
  var ctx = null, master = null, echo = null, noise = null;
  var timer = null, step = 0, nextAt = 0, running = false, scheduled = 0;

  function pref() { try { var v = localStorage.getItem('ns_music'); return v == null ? DEFAULT_ON : v === 'on'; } catch (e) { return DEFAULT_ON; } }
  function save(on) { try { localStorage.setItem('ns_music', on ? 'on' : 'off'); } catch (e) { /* private mode */ } }

  // Builds the mixing chain (master volume plus the echo) and the noise used for claps and hats.
  function build(c) {
    ctx = c;
    master = c.createGain(); master.gain.value = 0.0001; master.connect(c.destination);
    echo = c.createDelay(1); echo.delayTime.value = 60 / BPM * 0.75;       // dotted-eighth echo
    var fb = c.createGain(); fb.gain.value = 0.32; echo.connect(fb); fb.connect(echo);
    var wet = c.createGain(); wet.gain.value = 0.4; echo.connect(wet); wet.connect(master);
    var len = c.sampleRate, buf = c.createBuffer(1, len, c.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    noise = buf;
  }
  function audio() {
    if (!ctx) {
      var AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { build(new AC()); } catch (e) { ctx = null; return null; }
    }
    if (ctx.state === 'suspended') { try { ctx.resume(); } catch (e) { /* ignore */ } }
    return ctx;
  }

  function env(g, t, vol, len) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
  }
  function tone(type, f0, f1, t, len, vol, send) {
    var o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + len * 0.7);
    env(g, t, vol, len);
    o.connect(g); g.connect(master); if (send) g.connect(echo);
    o.start(t); o.stop(t + len + 0.03);
  }
  function hiss(t, len, vol, filter, freq) {
    var s = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    s.buffer = noise; f.type = filter; f.frequency.value = freq;
    env(g, t, vol, len);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t, Math.random() * 0.5); s.stop(t + len + 0.03);
  }

  var kick = function (t, v) { tone('sine', 150, 42, t, 0.28, 0.9 * v); };
  var clap = function (t) { hiss(t, 0.14, 0.5, 'bandpass', 1800); hiss(t + 0.012, 0.1, 0.3, 'bandpass', 2400); tone('triangle', 220, 160, t, 0.1, 0.18); };
  var hat = function (t, v) { hiss(t, 0.04, 0.18 * v, 'highpass', 7500); };
  var shaker = function (t, v) { hiss(t, 0.06, 0.1 * v, 'highpass', 5200); };
  var clave = function (t) { tone('sine', 1250, 1100, t, 0.06, 0.16); };
  var logdrum = function (t, f, len) { tone('sine', f * 1.9, f, t, len, 0.75); tone('triangle', f * 2, f * 2, t, len * 0.5, 0.1); };
  var pluck = function (t, f, len) { tone('triangle', f, f, t, len, 0.17, true); tone('sine', f * 2, f * 2, t, len * 0.5, 0.06, true); };

  // A minor pentatonic. Bass roots per bar and the log-drum rhythm (16th-note steps inside a bar).
  var A = { A1: 55, C2: 65.41, D2: 73.42, E2: 82.41, G2: 98 };
  var ROOT = [A.A1, A.A1, A.D2, A.E2];
  var BASS_STEPS = [0, 3, 6, 8, 11, 14];
  var KICKS = [[0, 7, 10], [0, 7, 10], [0, 6, 10], [0, 6, 10, 13]];
  var CLAVE = [0, 3, 6, 10, 12];
  // The hook: [bar, step, frequency, length in steps]
  var N = { A4: 440, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99 };
  var HOOK = [
    [0, 0, N.E5, 3], [0, 3, N.D5, 3], [0, 6, N.C5, 2], [0, 8, N.D5, 2], [0, 10, N.E5, 5],
    [1, 0, N.G5, 3], [1, 3, N.E5, 3], [1, 6, N.D5, 4], [1, 10, N.C5, 2], [1, 12, N.A4, 4],
    [2, 0, N.E5, 3], [2, 3, N.D5, 3], [2, 6, N.C5, 2], [2, 8, N.D5, 2], [2, 10, N.E5, 5],
    [3, 0, N.G5, 2], [3, 2, N.E5, 2], [3, 4, N.D5, 2], [3, 6, N.C5, 2], [3, 8, N.D5, 4], [3, 12, N.A4, 4],
  ];

  function playStep(i, t) {
    var bar = Math.floor(i / 16) % 4, s = i % 16, sixteenth = 60 / BPM / 4;
    if (KICKS[bar].indexOf(s) >= 0) kick(t, s === 0 ? 1 : 0.8);
    if (s === 4 || s === 12) clap(t);
    if (bar === 3 && s === 15) clap(t + 0.0);
    if (s % 2 === 0) hat(t, s % 4 === 0 ? 1 : 0.7); else hat(t, 0.35);
    if (bar === 3 && (s === 13 || s === 14)) hat(t + sixteenth / 2, 0.8);          // little roll at the end of the loop
    if (s % 4 === 2) shaker(t, 1);
    if (CLAVE.indexOf(s) >= 0) clave(t);
    if (BASS_STEPS.indexOf(s) >= 0) logdrum(t, s === 14 ? ROOT[bar] * 2 : ROOT[bar], sixteenth * (s === 0 ? 3 : 2.2));
    for (var k = 0; k < HOOK.length; k++) if (HOOK[k][0] === bar && HOOK[k][1] === s) pluck(t, HOOK[k][2], sixteenth * HOOK[k][3] * 1.1);
    scheduled++;
  }

  // Looks a little way ahead and books the next notes, so the beat stays steady even if the phone is busy.
  function tick() {
    if (!ctx || !running) return;
    var sixteenth = 60 / BPM / 4;
    while (nextAt < ctx.currentTime + 0.2) {
      var swing = step % 2 === 1 ? sixteenth * SWING : 0;
      playStep(step, nextAt + swing);
      nextAt += sixteenth;
      step = (step + 1) % 64;
    }
  }

  function start() {
    if (running) return;
    var c = audio();
    if (!c) return;
    running = true; step = 0; nextAt = c.currentTime + 0.08;
    master.gain.cancelScheduledValues(c.currentTime);
    master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), c.currentTime);
    master.gain.exponentialRampToValueAtTime(VOLUME, c.currentTime + 0.6);
    tick(); timer = setInterval(tick, 40);
  }
  function stop() {
    if (!running) return;
    running = false;
    clearInterval(timer); timer = null;
    if (ctx) {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(Math.max(master.gain.value, 0.0001), ctx.currentTime);
      master.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    }
  }

  var buttons = [];
  function paintOne(b) { b.textContent = pref() ? '🎵' : '🔇'; b.setAttribute('aria-pressed', pref() ? 'true' : 'false'); b.title = pref() ? 'Turn the theme song off' : 'Play the theme song'; }
  function paint() { buttons.forEach(paintOne); }
  function setOn(on) { save(on); if (on) start(); else stop(); paint(); var box = document.getElementById('mus'); if (box) box.checked = on; }
  function toggle() { setOn(!pref()); }
  // The little button in the top bar. Several pages can each have one; they all stay in step.
  function button(h) {
    var b = h('button', { class: 'chip music', type: 'button', 'aria-label': 'Theme song', onclick: toggle });
    buttons = buttons.filter(function (x) { return x.isConnected; });   // forget the buttons of pages that are gone
    buttons.push(b); paintOne(b);
    return b;
  }

  // Browsers only allow sound after a tap, so a remembered "on" starts at the first tap.
  function firstTap() { if (pref()) start(); }
  document.addEventListener('pointerdown', firstTap, { once: true, capture: true });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { stop(); } else if (pref() && ctx) { start(); }
  });

  // Writes the beat into a sound file in memory (used to make a sample .wav; the game never calls this).
  function render(seconds) {
    var saved = { ctx: ctx, master: master, echo: echo, noise: noise };
    build(new OfflineAudioContext(2, Math.floor(44100 * seconds), 44100));
    master.gain.value = VOLUME;
    var sixteenth = 60 / BPM / 4, i = 0, t = 0.05;
    while (t < seconds - 0.5) { playStep(i % 64, t + (i % 2 === 1 ? sixteenth * SWING : 0)); t += sixteenth; i++; }
    var c = ctx;
    return c.startRendering().then(function (b) { ctx = saved.ctx; master = saved.master; echo = saved.echo; noise = saved.noise; return b; });
  }

  NS.music = { render: render, isOn: pref, setOn: setOn, toggle: toggle, button: button, stats: function () { return { running: running, scheduled: scheduled }; } };
})();
