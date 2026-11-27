/* Contest commentary: a male-sounding announcer for races.
   - The voice is made on the listener's own phone or computer (the browser's speech voice). Nothing is downloaded. A male voice
     is picked when the device has one, and the pitch is lowered a little; the listener can choose another voice.
   - It follows the script: welcome, who is racing, who is leading, a quick look at each player, a commercial break (an audio
     advert you upload on the admin page), "welcome back", the latest standings, lead changes, finishers and the final result.
   - Browsers only allow speech after the listener has tapped something, so the panel has a start button.
   - It stops by itself when the listener leaves the race screen. */
(function () {
  var NS = typeof window !== "undefined" ? (window.NS = window.NS || {}) : {};

  // ---------- small helpers ----------
  var rand = function (list) { return list[Math.floor(Math.random() * list.length)]; };
  var lv = function (n) { return n + (n === 1 ? ' level' : ' levels'); };
  // A name as it should be spoken: "ada_99" -> "ada 99"
  var say = function (name) { return String(name || '').replace(/[_.\-]+/g, ' ').replace(/(\d+)/g, ' $1 ').replace(/\s+/g, ' ').trim() || 'a player'; };
  // A profile description made safe to read aloud: no links, no symbols or emoji, short.
  function speakableBio(text) {
    var t = String(text || '').replace(/https?:\/\/\S+|www\.\S+/gi, ' ').replace(/[^\p{L}\p{N}\s.,'!?-]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (t.length < 3) return '';
    if (t.length > 110) t = t.slice(0, 110).replace(/\s+\S*$/, '');
    return t.replace(/[.!?,\s-]+$/, '');
  }
  function listOf(names) {
    if (names.length <= 1) return names.join('');
    if (names.length <= 6) return names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
    return names.slice(0, 5).join(', ') + ' and ' + (names.length - 5) + ' more players';
  }
  function ranked(players) {
    return players.slice().sort(function (a, b) { return ((b.done ? 1 : 0) - (a.done ? 1 : 0)) || (b.solved - a.solved); });
  }

  // ---------- what the announcer says (pure text, so it can be tested) ----------
  var CTA = "If you haven't signed up already, sign up, start playing, or take on your friends in a contest of your own. Time to show your Sabi Power!";

  // "Right now, A is leading with 5 levels cleared, followed by B with 3 and C with 2."
  function standing(players) {
    var r = ranked(players);
    if (!r.length) return '';
    var top = r[0];
    if (!top.solved && !top.done) return rand(['Nobody has cleared a level yet. It is anybody\'s game!', 'We are still waiting for the first level to fall. It is wide open!']);
    var second = r[1], third = r[2];
    var s;
    if (second && second.solved === top.solved && !top.done) s = say(top.username) + ' and ' + say(second.username) + ' are neck and neck with ' + lv(top.solved) + ' each';
    else s = say(top.username) + ' is leading with ' + lv(top.solved) + ' cleared';
    if (second && !(second.solved === top.solved && !top.done)) {
      s += ', followed by ' + say(second.username) + ' with ' + second.solved;
      if (third) s += ', and ' + say(third.username) + ' with ' + third.solved;
    } else if (third) s += ', and ' + say(third.username) + ' is next with ' + third.solved;
    return s + '.';
  }

  function bios(players, readBios) {
    var out = [];
    var list = players.slice(0, 4);
    list.forEach(function (p) {
      var line = say(p.username);
      if (p.title) line += ', a ' + p.title;
      if (p.wins) line += ', with ' + p.wins + (p.wins === 1 ? ' race win' : ' race wins');
      line += '.';
      var b = readBios ? speakableBio(p.bio) : '';
      if (b) line += ' ' + b + '.';
      out.push(line);
    });
    if (players.length > list.length) out.push('And ' + (players.length - list.length) + ' more players are in this one.');
    return out.join(' ');
  }

  function lobbyLine(players) {
    var names = players.map(function (p) { return say(p.username); });
    return 'Welcome to the PixSabi contest lobby. ' + (names.length ? listOf(names) + (names.length === 1 ? ' is' : ' are') + ' here, waiting for the host to press start.' : 'We are waiting for the players to arrive.');
  }

  function introLines(snap, opts) {
    var names = snap.players.map(function (p) { return say(p.username); });
    var text = "It's a beautiful day today and this match is between " + listOf(names) + '. Who is going to win this contest? Right now, ' + standing(snap.players).replace(/^(\S)/, function (m) { return m; }) + " Let's quickly dive into each player's bio. " + bios(snap.players, opts.readBios);
    if (opts.hasAds) text += ' We will be going on a commercial break.';
    return text;
  }

  function afterBreakLines(snap, opts) {
    var names = snap.players.map(function (p) { return say(p.username); });
    return (opts.hasAds ? 'Welcome back! ' : '') + "It's a tough contest between " + listOf(names) + '. ' + standing(snap.players) + ' ' + CTA;
  }

  function statusLine(snap) {
    var lines = ['Let us check the scoreboard. ', 'Quick update from the track. ', 'Here is where we stand. '];
    return rand(lines) + standing(snap.players);
  }

  function leadChangeLine(name) {
    return rand(['What a move! ' + say(name) + ' takes the lead!', 'And there is a change at the top! ' + say(name) + ' is now in front!', say(name) + ' storms into the lead!']);
  }

  function finishLine(name) {
    return rand([say(name) + ' has cleared every level!', 'And ' + say(name) + ' is across the line!']);
  }

  function finalLines(snap) {
    var r = snap.players; // already in finishing order when the race is over
    var winner = snap.winnerName || (r[0] && r[0].username) || '';
    var s = "And that's the final whistle! ";
    if (winner) s += say(winner) + ' wins the contest' + (snap.rounds ? ', with ' + lv(snap.rounds) + ' cleared' : '') + '. ';
    var rest = r.filter(function (p) { return p.username !== winner; });
    if (rest[0]) s += say(rest[0].username) + ' takes second place' + (rest[1] ? ', and ' + say(rest[1].username) + ' finishes third' : '') + '. ';
    s += 'Congratulations to everyone who took part. ' + CTA;
    return s;
  }

  // ---------- the voice ----------
  var FEMALE = /female|woman|zira|susan|samantha|hazel|aria|jenny|karen|moira|tessa|fiona|victoria|serena|allison|ava|kate|libby|sonia|natasha|catherine|linda|heera|eva|helen/i;
  var MALE = /\bmale\b|david|mark|george|james|daniel|alex|guy|ryan|fred|tom|oliver|thomas|arthur|rishi|richard|aaron|google uk english male|microsoft.*(guy|ryan|mark|david|james)/i;
  function pickVoice(voices, savedName) {
    if (!voices || !voices.length) return null;
    if (savedName) { var s = voices.filter(function (v) { return v.name === savedName; })[0]; if (s) return s; }
    var en = voices.filter(function (v) { return /^en/i.test(v.lang); });
    var pool = en.length ? en : voices;
    var rank = function (v) {
      var n = (/-NG$/i.test(v.lang) ? 3 : /-(GB|ZA|US|AU|IN)$/i.test(v.lang) ? 1 : 0);
      if (FEMALE.test(v.name)) n -= 10;
      if (MALE.test(v.name)) n += 6;
      return n;
    };
    return pool.slice().sort(function (a, b) { return rank(b) - rank(a); })[0];
  }
  var looksMale = function (v) { return !!v && MALE.test(v.name) && !FEMALE.test(v.name); };

  // ---------- one commentary per race ----------
  var current = null;
  var store = {
    get: function (k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set: function (k, v) { try { localStorage.setItem(k, v); } catch (e) { /* private mode */ } },
  };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  var supported = function () { return !!(window.speechSynthesis && window.SpeechSynthesisUtterance); };

  // Keep the radio / theme beat out of the announcer's way: quiet while it speaks, back when it has finished.
  function hold(on) { try { if (window.NS && NS.music && NS.music.hold) NS.music.hold(on); } catch (e) { /* ignore */ } }

  function Session(id, kind, me) {
    this.id = String(id).toUpperCase();
    this.kind = kind;                                  // 'watch' (listeners) or 'race' (players)
    this.me = me || {};
    this.prefKey = 'ns_comm_' + kind;
    var saved = store.get(this.prefKey);
    this.on = saved === 'on' || (saved == null && kind === 'watch');
    this.queue = []; this.busy = false; this.needTap = false;
    this.introDone = false; this.lobbyDone = false; this.finalDone = false; this.leader = ''; this.finishers = {};
    this.lastStatusAt = 0; this.lastBreakAt = 0; this.snap = null; this.cfg = null; this.cfgAt = 0;
    this.listeners = []; this.panelEl = null; this.gen = 0;
    var self = this;
    this.watchdog = setInterval(function () { if (location.hash.toUpperCase().indexOf(self.id) < 0) self.stop(); }, 1000);
    this.loadConfig();
  }
  Session.prototype.loadConfig = function () {
    var self = this;
    return fetch('/api/commentary', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (c) { self.cfg = c; self.refresh(); if (self.snap) self.feed(self.snap); }).catch(function () { /* try again later */ });
  };
  Session.prototype.refresh = function () { var self = this; this.listeners.forEach(function (f) { f(self); }); };
  Session.prototype.available = function () { return supported() && !(this.cfg && this.cfg.enabled === false); };

  Session.prototype.toggle = function () {
    this.on = !this.on;
    store.set(this.prefKey, this.on ? 'on' : 'off');
    this.needTap = false;
    if (!this.on) this.silence(); else if (this.snap) this.feed(this.snap);
    this.refresh();
  };
  Session.prototype.silence = function () {
    this.gen++;                                         // anything already scheduled belongs to the old run
    this.queue = []; this.busy = false;
    hold(false);
    if (supported()) { try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
    if (this.audio) { try { this.audio.pause(); } catch (e) { /* ignore */ } this.audio = null; }
  };
  Session.prototype.stop = function () {
    clearInterval(this.watchdog);
    this.silence();
    if (current === this) current = null;
  };

  Session.prototype.push = function (item, front) {
    if (item.t === 'say' && this.queue.length > 3) this.queue = this.queue.filter(function (q) { return q.keep; }).slice(0, 3);
    if (front) this.queue.unshift(item); else this.queue.push(item);
    this.pump();
  };
  Session.prototype.pump = function () {
    if (this.busy || !this.on || !this.queue.length) return;
    var item = this.queue.shift();
    var self = this, gen = this.gen, finished = false;
    this.busy = true;
    hold(true);
    var done = function () { if (finished || gen !== self.gen) return; finished = true; self.busy = false; if (!self.queue.length) hold(false); self.pump(); };
    if (item.t === 'ad') this.playAd(done); else this.speak(item.text, done, gen);
  };

  // Speak a text a sentence or two at a time (long speech gets cut off by some browsers)
  Session.prototype.speak = function (text, done, gen) {
    var self = this;
    var parts = String(text).match(/[^.!?]+[.!?]*/g) || [text];
    var chunks = [], cur = '';
    parts.forEach(function (p) { if ((cur + p).length > 170 && cur) { chunks.push(cur); cur = p; } else cur += p; });
    if (cur.trim()) chunks.push(cur);
    var voices = window.speechSynthesis.getVoices();
    var voice = pickVoice(voices, store.get('ns_comm_voice'));
    var next = function () {
      if (gen !== self.gen) return;
      var t = chunks.shift();
      if (!t) return done();
      var u = new window.SpeechSynthesisUtterance(t.trim());
      if (voice) { u.voice = voice; u.lang = voice.lang; } else u.lang = 'en-GB';
      u.pitch = looksMale(voice) ? 0.9 : 0.7;          // a lower pitch when the voice is not clearly male
      u.rate = 1.03; u.volume = 1;
      var over = false, guard = setTimeout(function () { if (!over) { over = true; next(); } }, 20000);
      var fin = function () { if (over) return; over = true; clearTimeout(guard); next(); };
      u.onend = fin;
      u.onerror = function (e) {
        if (e && e.error === 'not-allowed') { over = true; clearTimeout(guard); self.blocked(); return; }
        fin();
      };
      try { window.speechSynthesis.speak(u); } catch (e) { fin(); }
    };
    next();
  };
  // The browser refused to speak (the listener has not tapped anything yet): wait for the start button.
  Session.prototype.blocked = function () {
    this.queue = []; this.busy = false; this.needTap = true; hold(false);
    this.introDone = false; this.lobbyDone = false;
    this.refresh();
  };

  Session.prototype.playAd = function (done) {
    var self = this, gen = this.gen, finished = false;
    var end = function () { if (finished) return; finished = true; clearTimeout(guard); self.audio = null; done(); };
    var guard = setTimeout(end, 70000);
    fetch('/api/commentary/ad', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : {}; }).then(function (r) {
      if (gen !== self.gen) return;
      if (!r.ad) return end();
      var a = new Audio(r.ad.url);
      self.audio = a;
      a.onended = end; a.onerror = end;
      var p = a.play();
      if (p && p.catch) p.catch(end);
    }).catch(end);
  };

  // Called with the latest numbers every few seconds. snap: { started, finished, cancelled, rounds, winnerName, players: [{username, solved, done, bio, title, wins}] }
  Session.prototype.feed = function (snap) {
    this.snap = snap;
    if (!this.on || !this.available() || !this.cfg) return;
    if (this.needTap) return;
    if (window.navigator.userActivation && !window.navigator.userActivation.hasBeenActive) { this.needTap = true; this.refresh(); return; }
    var opts = { hasAds: !!this.cfg.hasAds, readBios: !!this.cfg.readBios };
    var now = Date.now();
    var players = snap.players || [];
    if (snap.cancelled) { this.silence(); return; }
    if (snap.finished) {
      if (this.finalDone) return;
      this.finalDone = true;
      this.queue = []; if (this.busy) { this.silence(); }
      this.push({ t: 'say', text: finalLines(snap), keep: true });
      return;
    }
    if (!snap.started) {
      if (!this.lobbyDone && players.length) { this.lobbyDone = true; this.push({ t: 'say', text: lobbyLine(players), keep: true }); }
      return;
    }
    if (!this.introDone) {
      this.introDone = true;
      this.lastStatusAt = this.lastBreakAt = now;
      var r0 = ranked(players)[0]; this.leader = r0 && r0.solved > 0 ? r0.username : '';
      this.push({ t: 'say', text: introLines(snap, opts), keep: true });
      if (opts.hasAds) this.push({ t: 'ad', keep: true });
      this.push({ t: 'say', text: afterBreakLines(snap, opts), keep: true });
      return;
    }
    var self = this;
    players.forEach(function (p) {
      if (p.done && !self.finishers[p.username]) { self.finishers[p.username] = true; self.push({ t: 'say', text: finishLine(p.username) }); }
    });
    var r = ranked(players), top = r[0], second = r[1];
    if (top && top.solved > 0 && !top.done && (!second || top.solved > second.solved) && top.username !== this.leader) {
      var hadLeader = !!this.leader;
      this.leader = top.username;
      if (hadLeader) this.push({ t: 'say', text: leadChangeLine(top.username) });
    }
    if (!this.busy && !this.queue.length) {
      if (opts.hasAds && now - this.lastBreakAt >= (this.cfg.breakEvery || 3) * 60000) {
        this.lastBreakAt = this.lastStatusAt = now;
        this.push({ t: 'say', text: 'Time for a quick commercial break. Do not go anywhere.', keep: true });
        this.push({ t: 'ad', keep: true });
        this.push({ t: 'say', text: afterBreakLines(snap, opts), keep: true });
      } else if (now - this.lastStatusAt >= 50000) {
        this.lastStatusAt = now;
        this.push({ t: 'say', text: statusLine(snap) });
      }
    }
  };

  // The control card shown on the watch page and the race screen. The same element is reused every time the page redraws.
  Session.prototype.panel = function () {
    if (this.panelEl) return this.panelEl;
    var self = this;
    var card = el('div', 'card stack cm-panel');
    var head = el('h3', '', '🎙 Live commentary');
    var line = el('p', 'muted');
    var btn = el('button', 'btn block');
    btn.type = 'button';
    var voiceBox = el('details', 'cm-voice');
    var sum = el('summary', '', 'Voice');
    var sel = el('select'); sel.setAttribute('aria-label', 'Announcer voice');
    var test = el('button', 'btn alt small', 'Test voice'); test.type = 'button';
    voiceBox.append(sum, sel, test);
    card.append(head, line, btn, voiceBox);
    var fillVoices = function () {
      if (!supported()) return;
      var all = window.speechSynthesis.getVoices();
      var en = all.filter(function (v) { return /^en/i.test(v.lang); });
      var list = en.length ? en : all;
      var cur = pickVoice(all, store.get('ns_comm_voice'));
      sel.textContent = '';
      list.forEach(function (v) { var o = el('option', '', v.name + ' (' + v.lang + ')' + (looksMale(v) ? ' - male' : '')); o.value = v.name; if (cur && cur.name === v.name) o.selected = true; sel.append(o); });
      voiceBox.hidden = list.length < 2;
    };
    if (supported()) { fillVoices(); window.speechSynthesis.addEventListener && window.speechSynthesis.addEventListener('voiceschanged', fillVoices); }
    sel.addEventListener('change', function () { store.set('ns_comm_voice', sel.value); });
    test.addEventListener('click', function () {
      if (!supported()) return;
      var gen = ++self.gen;
      try { window.speechSynthesis.cancel(); } catch (e) { /* ignore */ }
      self.queue = []; self.busy = false;
      hold(true);
      self.speak('Welcome to PixSabi. Who is going to win this contest? Time to show your Sabi Power!', function () { if (!self.busy) hold(false); }, gen);
    });
    btn.addEventListener('click', function () {
      if (!self.on || self.needTap) { self.on = true; store.set(self.prefKey, 'on'); self.needTap = false; self.refresh(); if (self.snap) self.feed(self.snap); }
      else self.toggle();
    });
    var paint = function () {
      if (!supported()) { card.hidden = false; line.textContent = 'This phone or browser cannot speak commentary. Try Chrome or Safari.'; btn.hidden = true; voiceBox.hidden = true; return; }
      if (self.cfg && self.cfg.enabled === false) { card.hidden = true; return; }
      card.hidden = false; btn.hidden = false;
      if (self.on && !self.needTap) { line.textContent = 'Your announcer is calling this contest. Keep this screen open.'; btn.textContent = 'Mute commentary'; btn.className = 'btn alt block'; }
      else if (self.on && self.needTap) { line.textContent = 'Tap to hear your announcer call this contest live.'; btn.textContent = 'Start commentary'; btn.className = 'btn block'; }
      else { line.textContent = self.kind === 'race' ? 'Want an announcer calling the race? You can listen while you play.' : 'Turn on a live announcer for this contest.'; btn.textContent = 'Start commentary'; btn.className = 'btn block'; }
    };
    this.listeners.push(paint);
    paint();
    this.panelEl = card;
    return card;
  };

  NS.commentary = {
    // One session per race: asking again for the same race returns the running one.
    session: function (id, kind, me) {
      var key = String(id).toUpperCase();
      if (current && current.id === key && current.kind === kind) return current;
      if (current) current.stop();
      current = new Session(key, kind, me);
      return current;
    },
    stop: function () { if (current) current.stop(); },
    // exposed for the tests
    script: { introLines: introLines, afterBreakLines: afterBreakLines, finalLines: finalLines, statusLine: statusLine, standing: standing, bios: bios, leadChangeLine: leadChangeLine, finishLine: finishLine, lobbyLine: lobbyLine, speakableBio: speakableBio, say: say, listOf: listOf, pickVoice: pickVoice, looksMale: looksMale, CTA: CTA },
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = NS.commentary;
})();
