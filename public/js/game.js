/* The 4-pics-1-word widget. Used by solo, daily and challenge screens.
   NS.mountGame(root, puzzle, options) -> { destroy() }
   The puzzle shows ONE picture (puzzle.image, your collage). Puzzles without a
   picture fall back to four emoji tiles (puzzle.tiles).
   options: onGuess(guess) -> Promise<{correct}>, onCorrect(result),
            hints: { letterCost, clueCost, letter(): Promise<{index, letter}>, clue(): Promise<{clue}> } | null,
            onSkip: fn | null, skipCost: coins the Skip button costs (omit for none), skipNote: text shown under Skip when it has no coin cost (default "Free") */
(function () {
  const NS = (window.NS = window.NS || {});
  let destroyCurrent = null;
  NS.cleanup = () => { if (destroyCurrent) destroyCurrent(); destroyCurrent = null; };

  const IMG_RE = /^(https?:\/\/|\/).+\.(png|jpe?g|webp|gif|svg|avif)$/i;
  const seg = window.Intl && Intl.Segmenter ? new Intl.Segmenter() : null;
  const glyphCount = (s) => (seg ? [...seg.segment(s)].length : [...s].length);

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function tileNode(t, i) {
    const d = el('div', 'tile t' + (i % 4));
    if (IMG_RE.test(t)) {
      const img = el('img');
      img.src = t; img.alt = ''; img.loading = 'lazy';
      d.append(img);
    } else {
      d.textContent = t;
      const n = glyphCount(t);
      if (n === 2) d.classList.add('two');
      else if (n > 2) d.classList.add('many');
      d.setAttribute('role', 'img');
    }
    return d;
  }

  // ---------- zoom viewer: pinch, scroll wheel, double-tap, drag ----------
  function openZoom(src) {
    const MAX = 5;
    let s = 1, tx = 0, ty = 0;
    const img = el('img', 'zoom-img');
    img.alt = 'The puzzle picture, zoomed in';
    img.src = src;
    img.draggable = false;
    const stage = el('div', 'zoom-stage');
    stage.append(img);
    const btn = (text, label, fn) => {
      const b = el('button', 'zoom-btn', text);
      b.type = 'button'; b.setAttribute('aria-label', label);
      b.addEventListener('click', (e) => { e.stopPropagation(); fn(); });
      return b;
    };
    const overlay = el('div', 'overlay zoom');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Zoomed picture');
    overlay.tabIndex = -1;
    const close = () => overlay.remove();
    const bar = el('div', 'zoom-bar');
    bar.append(btn('\u2212', 'Zoom out', () => zoomTo(s / 1.5)), btn('+', 'Zoom in', () => zoomTo(s * 1.5)), btn('\u2715', 'Close', close));
    const hint = el('div', 'zoom-hint', 'Pinch, scroll or double-tap to zoom. Drag to move.');
    overlay.append(stage, bar, hint);
    document.body.append(overlay);
    overlay.focus();

    function apply() {
      // keep the picture on screen: it can only be moved as far as its zoomed edges allow
      const w = img.offsetWidth * s, h = img.offsetHeight * s;
      const mx = Math.max(0, (w - stage.clientWidth) / 2), my = Math.max(0, (h - stage.clientHeight) / 2);
      tx = Math.max(-mx, Math.min(mx, tx)); ty = Math.max(-my, Math.min(my, ty));
      img.style.transform = `translate(${tx}px, ${ty}px) scale(${s})`;
      stage.classList.toggle('zoomed', s > 1.001);
    }
    // zoom to a new level, keeping the point (cx, cy) (relative to the stage centre) under the finger
    function zoomTo(ns, cx = 0, cy = 0) {
      ns = Math.max(1, Math.min(MAX, ns));
      const k = ns / s;
      tx = cx - (cx - tx) * k; ty = cy - (cy - ty) * k;
      s = ns;
      if (s === 1) { tx = 0; ty = 0; }
      apply();
    }
    const centre = (e) => { const r = stage.getBoundingClientRect(); return [e.clientX - r.left - r.width / 2, e.clientY - r.top - r.height / 2]; };

    const pts = new Map();
    let last = null, pinch = null, lastTap = 0;
    stage.addEventListener('pointerdown', (e) => {
      stage.setPointerCapture(e.pointerId);
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, s };
      }
      last = [e.clientX, e.clientY];
      const now = Date.now();
      if (pts.size === 1 && now - lastTap < 300) { const [cx, cy] = centre(e); zoomTo(s > 1.2 ? 1 : 2.5, cx, cy); lastTap = 0; }
      else lastTap = now;
    });
    stage.addEventListener('pointermove', (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1;
        const r = stage.getBoundingClientRect();
        zoomTo(pinch.s * d / pinch.d, (a[0] + b[0]) / 2 - r.left - r.width / 2, (a[1] + b[1]) / 2 - r.top - r.height / 2);
      } else if (pts.size === 1 && s > 1) {
        tx += e.clientX - last[0]; ty += e.clientY - last[1];
        apply();
      }
      last = [e.clientX, e.clientY];
    });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; const rest = [...pts.values()][0]; if (rest) last = rest; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => {
      e.preventDefault();
      const [cx, cy] = centre(e);
      zoomTo(s * Math.exp(-e.deltaY * 0.0020), cx, cy);
    }, { passive: false });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') close();
      else if (e.key === '+' || e.key === '=') zoomTo(s * 1.5);
      else if (e.key === '-') zoomTo(s / 1.5);
      else if (e.key === 'ArrowLeft') { tx += 40; apply(); } else if (e.key === 'ArrowRight') { tx -= 40; apply(); }
      else if (e.key === 'ArrowUp') { ty += 40; apply(); } else if (e.key === 'ArrowDown') { ty -= 40; apply(); }
    });
    // tapping the dark area outside the picture closes it (only when not zoomed in)
    stage.addEventListener('click', (e) => {
      if (s !== 1) return;
      const r = img.getBoundingClientRect();
      const inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) close();
    });
    window.addEventListener('resize', apply, { once: true });
  }

  // The puzzle picture: one collage image, shown whole (never cropped).
  function collageNode(src) {
    const box = el('div', 'collage');
    box.setAttribute('role', 'button');
    box.tabIndex = 0;
    box.setAttribute('aria-label', 'The puzzle picture. Look at it, think, and answer. Press to zoom in.');
    box.title = 'Tap to zoom';
    const open = () => { if (!box.classList.contains('failed')) openZoom(src); };
    box.addEventListener('click', open);
    box.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
    const img = el('img');
    img.alt = '';
    img.decoding = 'async';
    img.addEventListener('error', () => {
      box.textContent = 'The picture could not load. Check your connection and reload the page.';
      box.classList.add('failed');
    });
    img.src = src;
    box.append(img);
    return box;
  }

  // A drawn coin (the coin emoji shows as an empty box on some phones and PCs)
  function coinSvg(size) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('width', size); svg.setAttribute('height', size);
    svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('class', 'coin-ico');
    const a = document.createElementNS(ns, 'circle'); a.setAttribute('cx', 8); a.setAttribute('cy', 8); a.setAttribute('r', 7); a.setAttribute('fill', '#f5b82e');
    const b = document.createElementNS(ns, 'circle'); b.setAttribute('cx', 8); b.setAttribute('cy', 8); b.setAttribute('r', 4.5); b.setAttribute('fill', 'none'); b.setAttribute('stroke', '#b9801a'); b.setAttribute('stroke-width', 1.5);
    svg.append(a, b);
    return svg;
  }

  // A round hint button: icon, short label, and the coin cost (or "Free").
  function hintBtn(icon, label, cost, note, full) {
    const b = el('button', 'hint-btn');
    b.type = 'button';
    const costText = cost == null ? (note || 'Free') : String(cost);
    b.setAttribute('aria-label', `${full || label} (${cost == null ? costText.toLowerCase() : cost + ' coins'})`);
    const costEl = el('span', cost != null ? 'hint-cost' : note ? 'hint-cost note' : 'hint-cost free');
    if (cost != null) costEl.append(coinSvg(12));
    costEl.append(costText);
    b.append(el('span', 'hint-ico', icon), el('span', 'hint-label', label), costEl);
    return b;
  }

  NS.mountGame = function mountGame(root, p, o) {
    NS.cleanup();
    const n = p.length;
    const slots = new Array(n).fill(-1);       // slot -> pool index
    const used = new Array(p.pool.length).fill(false);
    const locked = new Set();                  // slots filled by a paid hint
    const half = Math.ceil(p.pool.length / 2);
    let busy = false;
    let finished = false;

    root.textContent = '';
    const board = el('div', 'board');   // the game name already shows at the top of the screen, next to the level
    let tiles;
    if (p.image) {
      tiles = collageNode(p.image);
    } else {
      tiles = el('div', 'tiles');
      tiles.setAttribute('aria-label', 'The puzzle picture. Look at it, think, and answer.');
      (p.tiles || []).forEach((t, i) => tiles.append(tileNode(t, i)));
    }
    const clueBox = el('div', 'clue-box hidden');
    const slotsRow = el('div', 'slots');
    const msg = el('div', 'game-msg');
    msg.setAttribute('aria-live', 'polite');
    const orn = el('div', 'ornament', '✦');
    const keys = el('div', 'keys');
    keys.style.gridTemplateColumns = `repeat(${half}, 1fr)`;
    const hintBar = el('div', 'hint-bar');
    root.append(board, tiles, clueBox, slotsRow, msg, orn, keys, hintBar);

    const slotEls = [];
    for (let i = 0; i < n; i++) {
      const b = el('button', 'slot');
      b.type = 'button';
      b.addEventListener('click', () => removeAt(i));
      slotEls.push(b); slotsRow.append(b);
    }
    const keyEls = p.pool.map((letter, i) => {
      const b = el('button', 'key', letter);
      b.type = 'button';
      b.setAttribute('aria-label', 'Letter ' + letter);
      b.addEventListener('click', () => place(i));
      return b;
    });

    // Lay the letter tiles out in two rows: the first row violet, the second gold.
    function layoutKeys(order) {
      keys.textContent = '';
      order.forEach((pi, pos) => {
        keyEls[pi].classList.toggle('gold', pos >= half);
        keys.append(keyEls[pi]);
      });
    }
    layoutKeys(p.pool.map((_, i) => i));

    function shuffleKeys() {
      const order = p.pool.map((_, i) => i);
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
      layoutKeys(order);
    }

    function render() {
      slotEls.forEach((b, i) => {
        b.textContent = slots[i] >= 0 ? p.pool[slots[i]] : '';
        b.classList.toggle('filled', slots[i] >= 0 && !locked.has(i));
        b.classList.toggle('locked', locked.has(i));
        b.setAttribute('aria-label', slots[i] >= 0 ? `Slot ${i + 1}: ${p.pool[slots[i]]}` : `Slot ${i + 1}: empty`);
      });
      keyEls.forEach((b, i) => b.classList.toggle('used', used[i]));
    }

    function place(pi) {
      if (busy || finished || used[pi]) return;
      const s = slots.indexOf(-1);
      if (s < 0) return;
      slots[s] = pi; used[pi] = true;
      msg.textContent = ''; msg.className = 'game-msg';
      render();
      if (slots.every((x) => x >= 0)) submit();
    }
    function removeAt(s) {
      if (busy || finished || locked.has(s) || slots[s] < 0) return;
      used[slots[s]] = false; slots[s] = -1;
      render();
    }
    function backspace() {
      for (let s = n - 1; s >= 0; s--) if (slots[s] >= 0 && !locked.has(s)) { removeAt(s); return; }
    }
    function lockLetter(index, letter) {
      if (slots[index] >= 0) { used[slots[index]] = false; slots[index] = -1; }
      let pi = p.pool.findIndex((l, i) => l === letter && !used[i]);
      if (pi < 0) { // every copy is on the board: take it back from an unlocked slot
        const s = slots.findIndex((x, si) => x >= 0 && p.pool[x] === letter && !locked.has(si));
        if (s >= 0) { used[slots[s]] = false; slots[s] = -1; }
        pi = p.pool.findIndex((l, i) => l === letter && !used[i]);
      }
      if (pi < 0) return;
      slots[index] = pi; used[pi] = true; locked.add(index);
    }

    async function submit() {
      busy = true;
      const guess = slots.map((i) => p.pool[i]).join('');
      try {
        const r = await o.onGuess(guess);
        if (r.correct) {
          finished = true;
          slotEls.forEach((b) => { b.classList.remove('filled', 'locked'); b.classList.add('win'); });
          if (NS.sound) NS.sound.play('correct');
          o.onCorrect(r);
        } else {
          if (NS.sound) NS.sound.play('wrong');
          slotsRow.classList.remove('shake'); void slotsRow.offsetWidth; slotsRow.classList.add('shake');
          slotEls.forEach((b, i) => { if (!locked.has(i)) b.classList.add('bad'); });
          msg.textContent = 'No be am. Try again.'; msg.className = 'game-msg bad';
          setTimeout(() => {
            for (let s = 0; s < n; s++) {
              if (!locked.has(s) && slots[s] >= 0) { used[slots[s]] = false; slots[s] = -1; }
            }
            slotEls.forEach((b) => b.classList.remove('bad'));
            busy = false; render();
          }, 650);
          return;
        }
      } catch (e) {
        NS.toast(e.message, true);
      }
      busy = false;
    }

    // Hints (solo only): reveal a letter and show the clue cost coins. Shuffle is always free.
    let letterBtn = null;
    let clueBtn = null;
    if (o.hints) {
      letterBtn = hintBtn('💡', 'Reveal', o.hints.letterCost, null, 'Reveal a letter');
      clueBtn = hintBtn('👁️', 'Clue', o.hints.clueCost, null, 'Show clue');
      letterBtn.addEventListener('click', async () => {
        if (busy || finished) return;
        letterBtn.disabled = true;
        try {
          const r = await o.hints.letter();
          lockLetter(r.index, r.letter);
          msg.textContent = ''; msg.className = 'game-msg';
          render();
          if (slots.every((x) => x >= 0)) submit();
        } catch (e) { NS.toast(e.message, true); if (e.status === 402 && NS.buyCoins) NS.buyCoins(); }
        letterBtn.disabled = false;
      });
      clueBtn.addEventListener('click', async () => {
        if (finished) return;
        clueBtn.disabled = true;
        try { showClue((await o.hints.clue()).clue); } catch (e) { NS.toast(e.message, true); clueBtn.disabled = false; if (e.status === 402 && NS.buyCoins) NS.buyCoins(); }
      });
    }
    function showClue(text) {
      clueBox.textContent = 'Clue: ' + text; clueBox.classList.remove('hidden');
      if (clueBtn) clueBtn.classList.add('hidden');
    }
    const shuffleBtn = hintBtn('🔀', 'Shuffle', null, null, 'Shuffle letters');
    shuffleBtn.addEventListener('click', () => { if (!finished) shuffleKeys(); });
    if (letterBtn) hintBar.append(letterBtn);
    hintBar.append(shuffleBtn);
    if (clueBtn) hintBar.append(clueBtn);
    if (o.hints && p.clue) showClue(p.clue);

    if (o.onSkip) {
      const skip = hintBtn('⏭️', 'Skip', o.skipCost == null ? null : o.skipCost, o.skipNote, 'Skip this puzzle');
      skip.addEventListener('click', () => { if (!busy && !finished) o.onSkip(); });
      hintBar.append(skip);
    }

    // Physical keyboard support
    function onKey(e) {
      if (e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.overlay')) return;
      if (/^[a-z]$/i.test(e.key)) {
        const L = e.key.toUpperCase();
        const pi = p.pool.findIndex((l, i) => l === L && !used[i]);
        if (pi >= 0) place(pi);
      } else if (e.key === 'Backspace') { backspace(); }
    }
    document.addEventListener('keydown', onKey);

    for (const [idx, letter] of Object.entries(p.revealed || {})) lockLetter(Number(idx), letter);
    render();

    destroyCurrent = () => document.removeEventListener('keydown', onKey);
    return { destroy: NS.cleanup };
  };
})();
