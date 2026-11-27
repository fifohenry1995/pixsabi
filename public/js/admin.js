/* PixSabi admin page: add, edit and delete puzzles. Talks to /api/admin/*. */
(function () {
  const root = document.getElementById('adm');
  let puzzles = [];
  let categories = [];
  const filter = { Naija: '', Universal: '' };   // the search box of each puzzle section

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) {
      if (kid == null || kid === false) continue;
      e.append(kid.nodeType ? kid : document.createTextNode(kid));
    }
    return e;
  }

  async function api(path, opts = {}) {
    const method = opts.method || 'GET';
    const res = await fetch('/api' + path, {
      method,
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json' },
      body: method === 'GET' ? undefined : JSON.stringify(opts.body || {}),
      credentials: 'same-origin',
    });
    let data = {};
    try { data = await res.json(); } catch { /* empty */ }
    if (!res.ok) {
      const err = new Error(data.error || 'Something went wrong. Check your connection and try again.');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function toast(text, bad) {
    const t = h('div', { class: 'toast' + (bad ? ' bad' : ''), role: 'status' }, text);
    document.getElementById('toasts').append(t);
    setTimeout(() => t.remove(), 4000);
  }

  // ---------- picture: any image the admin picks is shrunk and saved as a JPEG ----------
  // opts.square: crop the middle square (adverts are square). opts.max: longest side in pixels. opts.maxLen: size limit.
  let wm = { text: '', since: 0, stampedAt: 0 };   // the watermark text (set in the "Watermark" section)
  function paintWatermark(g, w, hgt, text) {
    const size = Math.max(11, Math.round(w * 0.04)), m = Math.round(size * 0.6);
    g.save();
    g.font = `700 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
    g.textAlign = 'right'; g.textBaseline = 'bottom';
    g.shadowColor = 'rgba(0,0,0,0.75)'; g.shadowBlur = Math.round(size * 0.3); g.shadowOffsetX = 0; g.shadowOffsetY = 1;
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillText(text, w - m, hgt - m);
    g.restore();
  }
  function fileToJpegDataUrl(file, opts) {
    const o = Object.assign({ square: false, max: 1200, maxLen: 1_900_000 }, opts || {});
    return new Promise((resolve, reject) => {
      if (!/^image\//.test(file.type)) return reject(new Error('Choose a picture file (JPG, PNG or WEBP).'));
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read that file.'));
      fr.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('Could not open that picture.'));
        img.onload = () => {
          let sx = 0, sy = 0, sw = img.width, sh = img.height;
          if (o.square) { const m = Math.min(sw, sh); sx = Math.floor((sw - m) / 2); sy = Math.floor((sh - m) / 2); sw = sh = m; }
          const k = Math.min(1, o.max / Math.max(sw, sh));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(sw * k));
          c.height = Math.max(1, Math.round(sh * k));
          const g = c.getContext('2d');
          g.fillStyle = '#fff';
          g.fillRect(0, 0, c.width, c.height);
          g.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
          if (o.watermark && wm.text) paintWatermark(g, c.width, c.height, wm.text);
          let q = o.q0 || 0.86;
          let out = c.toDataURL('image/jpeg', q);
          while (out.length > o.maxLen && q > 0.3) { q -= 0.1; out = c.toDataURL('image/jpeg', q); }
          if (out.length > o.maxLen) return reject(new Error('That picture is too detailed. Try a smaller one.'));
          resolve(out);
        };
        img.src = fr.result;
      };
      fr.readAsDataURL(file);
    });
  }

  // ---------- dialogs ----------
  function openDialog(content) {
    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' },
      h('div', { class: 'card dialog adm-dialog' }, content));
    document.body.append(overlay);
    return () => overlay.remove();
  }

  function puzzleForm(existing, presetCat) {
    const editing = !!existing;
    let imageData = null;
    const answer = h('input', { type: 'text', id: 'f-answer', maxlength: '12', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', value: existing ? existing.answer : '' });
    answer.addEventListener('input', () => { answer.value = answer.value.toUpperCase().replace(/[^A-Z]/g, ''); renameNote(); });
    const category = h('select', { id: 'f-cat' }, ['Naija', 'Universal'].map((c) => h('option', { value: c, selected: (existing ? existing.category : presetCat) === c ? true : null }, c)));
    const clue = h('input', { type: 'text', id: 'f-clue', maxlength: '200', value: existing ? existing.clue : '' });
    const fact = h('textarea', { id: 'f-fact', maxlength: '400' });
    fact.value = existing ? existing.fact : '';
    const preview = h('img', { class: 'adm-form-img hidden', alt: 'Picture preview' });
    if (existing && existing.image) { preview.src = existing.image; preview.classList.remove('hidden'); }
    const file = h('input', { type: 'file', id: 'f-file', accept: 'image/*' });
    const picNote = h('p', { class: 'adm-hint' }, editing
      ? (existing.hasPicture ? 'Leave this empty to keep the current picture.' : 'This puzzle has no picture yet. Add one.')
      : 'Upload your collage (the four pictures already joined into one).');
    const rename = h('p', { class: 'adm-note hidden' }, 'You changed the answer. Players who already solved it keep their credit, and the picture file is renamed to match.');
    function renameNote() { rename.classList.toggle('hidden', !(editing && answer.value && answer.value !== existing.answer)); }
    file.addEventListener('change', async () => {
      const f = file.files[0];
      if (!f) return;
      try {
        imageData = await fileToJpegDataUrl(f, { watermark: true });
        preview.src = imageData; preview.classList.remove('hidden');
      } catch (e) { imageData = null; file.value = ''; toast(e.message, true); }
    });
    const saveBtn = h('button', { class: 'btn', type: 'button' }, editing ? 'Save changes' : 'Add puzzle');
    const cancelBtn = h('button', { class: 'btn alt', type: 'button' }, 'Cancel');
    const close = openDialog([
      h('h2', {}, editing ? `Edit ${existing.answer}` : 'Add a puzzle'),
      h('div', { class: 'field' }, h('label', { for: 'f-answer' }, 'Answer (3 to 12 letters)'), answer, rename),
      h('div', { class: 'field' }, h('label', { for: 'f-cat' }, 'Category'), category),
      h('div', { class: 'field' }, h('label', { for: 'f-clue' }, 'Clue (players can pay coins to see it)'), clue),
      h('div', { class: 'field' }, h('label', { for: 'f-fact' }, 'Fun fact (shown after a correct answer)'), fact),
      h('div', { class: 'field' }, h('label', { for: 'f-file' }, 'Collage picture'), file, picNote, preview),
      h('div', { class: 'row-end' }, cancelBtn, saveBtn),
    ]);
    cancelBtn.addEventListener('click', close);
    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      try {
        const body = { answer: answer.value, category: category.value, clue: clue.value, fact: fact.value };
        if (imageData) body.image = imageData;
        if (editing) await api('/admin/puzzles/' + encodeURIComponent(existing.id), { method: 'PUT', body });
        else await api('/admin/puzzles', { method: 'POST', body });
        close();
        toast(editing ? 'Saved' : 'Puzzle added');
        await load();
      } catch (e) { toast(e.message, true); saveBtn.disabled = false; }
    });
    answer.focus();
  }

  function confirmDelete(p) {
    const wipe = h('input', { type: 'checkbox', id: 'del-file' });
    const yes = h('button', { class: 'btn danger', type: 'button' }, 'Delete it');
    const no = h('button', { class: 'btn alt', type: 'button' }, 'Keep it');
    const close = openDialog([
      h('h2', {}, `Delete ${p.answer}?`),
      h('p', {}, p.solvedBy ? `${p.solvedBy} player(s) already solved it. Their level will go down by one.` : 'No player has solved it yet.'),
      h('p', { class: 'adm-hint' }, 'The puzzle disappears for every player straight away (a player who has it open sees a fresh puzzle on their next tap). A backup of the puzzle list is saved first.'),
      h('div', { class: 'field adm-check' }, wipe, h('label', { for: 'del-file' }, 'Also delete the picture file from the server (tick this if the picture owner asked for it to come down)')),
      h('div', { class: 'row-end' }, no, yes),
    ]);
    no.addEventListener('click', close);
    yes.addEventListener('click', async () => {
      yes.disabled = true;
      try { const r = await api('/admin/puzzles/' + encodeURIComponent(p.id), { method: 'DELETE', body: { deleteFile: wipe.checked } }); close(); toast(r.fileDeleted ? 'Deleted, picture file removed' : 'Deleted'); await load(); }
      catch (e) { toast(e.message, true); yes.disabled = false; }
    });
  }

  // ---------- social and contact links ----------
  let social = { values: {}, links: [] };
  let chatLock = { locked: false, note: '', until: 0 };
  function chatLockSection() {
    const note = h('input', { type: 'text', id: 'cl-note', maxlength: '140', placeholder: 'Optional message players will see, e.g. Back in 1 hour', value: chatLock.note || '', 'aria-label': 'Message for players' });
    const mins = h('select', { id: 'cl-min', 'aria-label': 'How long' }, [['15', '15 minutes'], ['60', '1 hour'], ['360', '6 hours'], ['1440', '1 day'], ['0', 'Until I open it']].map(([v, t]) => h('option', { value: v }, t)));
    const set = async (locked) => { try { chatLock = await api('/admin/chat-lock', { method: 'PUT', body: { locked, note: note.value, minutes: Number(mins.value) } }); toast(locked ? 'Chat is paused' : 'Chat is open'); draw(); } catch (e) { toast(e.message, true); } };
    const lock = h('button', { class: 'btn danger', type: 'button' }, chatLock.locked ? 'Update pause' : 'Pause chat');
    const open = h('button', { class: 'btn', type: 'button' }, 'Open chat again');
    lock.addEventListener('click', () => set(true)); open.addEventListener('click', () => set(false));
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Public chat room'),
      h('p', { class: 'adm-hint' }, 'Pause the room when there is spam or trouble. Players can still read it but cannot write; you can still write. Private messages keep working.'),
      h('p', { class: 'adm-hint' }, h('strong', {}, chatLock.locked ? 'The chat is PAUSED' + (chatLock.until ? ' until ' + new Date(chatLock.until).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ' until you open it') + '.' : 'The chat is open.')),
      h('div', { class: 'card stack' }, h('div', { class: 'field' }, h('label', { for: 'cl-note' }, 'Message'), note), h('div', { class: 'field' }, h('label', { for: 'cl-min' }, 'Pause for'), mins), h('div', { class: 'adm-actions' }, lock, chatLock.locked ? open : null)));
  }
  function socialSection() {
    const F = [
      ['contact', 'WhatsApp number for contact (adverts and problems)', 'e.g. 2348012345678'],
      ['channel', 'WhatsApp channel link (join our channel)', 'https://whatsapp.com/channel/...'],
      ['x', 'X (Twitter) handle', '@yourhandle'],
      ['instagram', 'Instagram handle', '@yourhandle'],
      ['tiktok', 'TikTok handle', '@yourhandle'],
      ['facebook', 'Facebook page name or link', 'yourpage or https://facebook.com/yourpage'],
    ];
    const inputs = {};
    const save = h('button', { class: 'btn', type: 'button' }, 'Save links');
    const rows = F.map(([k, label, ph]) => { inputs[k] = h('input', { type: 'text', id: 'soc-' + k, maxlength: '200', placeholder: ph, value: social.values[k] || '', 'aria-label': label }); return h('div', { class: 'field' }, h('label', { for: 'soc-' + k }, label), inputs[k]); });
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { social = await api('/admin/social', { method: 'PUT', body: Object.fromEntries(F.map(([k]) => [k, inputs[k].value])) }); toast('Saved'); draw(); }
      catch (e) { toast(e.message, true); save.disabled = false; }
    });
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Contact and social links'),
      h('p', { class: 'adm-hint' }, 'These show on the players\' Settings page (the gear at the top) as clickable rows that open your pages. Type a handle, a number or a link; leave a box empty to hide that row. Players only ever get links to these websites.'),
      h('div', { class: 'card stack' }, rows, h('div', { class: 'adm-actions' }, save)),
      social.links.length ? h('p', { class: 'adm-hint' }, 'Players will see: ', social.links.map((l, i) => [i ? ' · ' : '', h('a', { href: l.url, target: '_blank', rel: 'noopener noreferrer' }, l.kind)])) : h('p', { class: 'adm-hint' }, 'Nothing is filled in yet, so players see no contact section.'));
  }

  // ---------- Backup and restore ----------
  let backupInfo = { lastAt: 0, maxMb: 300 };
  function backupSection() {
    const ago = (t) => { const d = Math.floor((Date.now() - t) / 86400000); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; };
    const stale = !backupInfo.lastAt || Date.now() - backupInfo.lastAt > 7 * 86400000;
    const last = h('p', { class: stale ? 'adm-hint adm-warn' : 'adm-hint' },
      backupInfo.lastAt ? `Last backup downloaded: ${new Date(backupInfo.lastAt).toLocaleString()} (${ago(backupInfo.lastAt)}).${stale ? ' Time for a new one.' : ''}` : 'No backup has been downloaded yet. Download one now.');
    const dl = h('button', { class: 'btn', type: 'button' }, 'Download backup');
    dl.addEventListener('click', async () => {
      dl.disabled = true;
      try {
        const r = await api('/admin/backup/start', { method: 'POST' });
        const a = h('a', { href: r.url, download: '' }); document.body.append(a); a.click(); a.remove();
        toast('Your backup is downloading. It can take a moment.');
        setTimeout(async () => { try { backupInfo = await api('/admin/backup'); draw(); } catch { /* ignore */ } }, 6000);
      } catch (e) { toast(e.message, true); }
      setTimeout(() => { dl.disabled = false; }, 4000);
    });
    const file = h('input', { type: 'file', accept: '.pxbackup,.gz,application/gzip', 'aria-label': 'Backup file to restore' });
    const word = h('input', { type: 'text', placeholder: 'Type RESTORE', maxlength: '10', autocomplete: 'off', 'aria-label': 'Type RESTORE to confirm' });
    const go = h('button', { class: 'btn danger', type: 'button', disabled: true }, 'Restore from this file');
    const bar = h('p', { class: 'adm-hint', role: 'status' });
    const check = () => { go.disabled = !(file.files[0] && word.value.trim() === 'RESTORE'); };
    file.addEventListener('change', check); word.addEventListener('input', check);
    go.addEventListener('click', () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > backupInfo.maxMb * 1048576) { toast(`That file is larger than the ${backupInfo.maxMb} MB limit.`, true); return; }
      if (!confirm('This REPLACES every player, coin, puzzle, picture and advert on the live game with what is in this file. Continue?')) return;
      go.disabled = true; file.disabled = true; word.disabled = true;
      const x = new XMLHttpRequest();
      x.open('POST', '/api/admin/restore');
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.setRequestHeader('X-Confirm', 'RESTORE');
      x.upload.onprogress = (e) => { if (e.lengthComputable) bar.textContent = `Uploading... ${Math.round(e.loaded / e.total * 100)}%`; };
      x.onerror = () => { bar.textContent = 'The upload failed. Check your connection and try again.'; file.disabled = false; word.disabled = false; check(); };
      x.onload = () => {
        let d = {}; try { d = JSON.parse(x.responseText); } catch { /* empty */ }
        if (x.status !== 200) { bar.textContent = d.error || 'The restore did not work. Nothing was changed.'; file.disabled = false; word.disabled = false; check(); return; }
        bar.textContent = `Backup accepted (${d.users} players). The game is restarting... this page reloads by itself. If it stays offline for more than two minutes, press Redeploy in Railway.`;
        const wait = async () => { try { const r = await fetch('/health', { cache: 'no-store' }); if (r.ok) { location.reload(); return; } } catch { /* still restarting */ } setTimeout(wait, 3000); };
        setTimeout(wait, 4000);
      };
      bar.textContent = 'Uploading... 0%';
      x.send(f);
    });
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Backup and restore'),
      h('p', { class: 'adm-hint' }, 'One file with all your players (accounts, coins, levels, chat), payment records, and everything you uploaded here: puzzles, pictures, adverts, pop-ups, slide and site texts. Download one every week and keep it safe (it also holds private keys, so never share it). If the game\'s disk is ever lost, put the game back online, create your admin account, and restore this file.'),
      h('div', { class: 'card stack' }, last, h('div', { class: 'adm-actions' }, dl)),
      h('div', { class: 'card stack' }, h('h3', {}, 'Restore a backup'),
        h('p', { class: 'adm-hint' }, `This REPLACES everything on the live game with the file's contents, then the game restarts (about a minute). What was there before is kept aside on the server in a folder called before-restore. The file can be up to ${backupInfo.maxMb} MB.`),
        file, word, h('div', { class: 'adm-actions' }, go), bar));
  }

  // ---------- Google AdSense ----------
  let adsense = { publisher: '', enabled: false, adsTxt: '', side: {} };
  function adsenseSection() {
    const pub = h('input', { type: 'text', id: 'gads-pub', maxlength: '40', placeholder: 'ca-pub-1234567890123456', value: adsense.publisher, 'aria-label': 'AdSense publisher ID' });
    const on = h('input', { type: 'checkbox', id: 'gads-on' }); on.checked = adsense.enabled;
    const save = h('button', { class: 'btn', type: 'button' }, 'Save AdSense settings');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { adsense = await api('/admin/adsense', { method: 'PUT', body: { publisher: pub.value, enabled: on.checked } }); toast(adsense.enabled ? 'AdSense is ON' : 'Saved (AdSense is off)'); draw(); }
      catch (e) { toast(e.message, true); save.disabled = false; }
    });
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Google AdSense'),
      h('p', { class: 'adm-hint' }, 'Use this after you have applied for AdSense. Step 1: type your publisher ID below (AdSense > Account > Account information) and save with the switch OFF. The game then adds the verification tag and the ads.txt file that Google checks. Step 2: once Google approves the site, create display ad units in AdSense (Ads > By ad unit) and paste each ad code into an advert box below (not into a pop-up: Google does not allow that). Step 3: tick "Show Google ads" and save.'),
      h('div', { class: 'card stack' },
        h('div', { class: 'field' }, h('label', { for: 'gads-pub' }, 'Publisher ID'), pub),
        h('div', { class: 'field adm-check' }, on, h('label', { for: 'gads-on' }, 'Show Google ads (turn on only after Google approves the site)')),
        h('div', { class: 'adm-actions' }, save)),
      mobileBox(),
      resultsBox(),
      adsense.adsTxt ? h('p', { class: 'adm-hint' }, 'Your ads.txt file (served at /ads.txt for you): ', h('code', {}, adsense.adsTxt)) : null,
      h('p', { class: 'adm-hint' }, 'While AdSense is ON: an advert slot that has AdSense code shows the Google ad instead of its picture, the Privacy Policy page mentions Google AdSense by itself, and the game allows Google\'s scripts. Google decides what ads appear and pays you; Google ads are not counted in the Dashboard advert report. Google\'s rules apply: never ask players to tap ads or click them yourself. Google can refuse or switch off ads in pop-ups, so test with side slots first.'));
  }
  // The header ad for phones and tablets
  function mobileBox() {
    const cur = adsense.mobile;
    const code = h('textarea', { rows: '3', maxlength: '6000', placeholder: 'Paste AdSense ad code for the phone header', 'aria-label': 'AdSense code for the phone header' });
    const go = h('button', { class: 'btn small', type: 'button' }, 'Save phone header ad');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try { adsense = await api('/admin/adsense/mobile', { method: 'PUT', body: { code: code.value } }); toast('Phone header ad saved'); draw(); }
      catch (e) { toast(e.message, true); go.disabled = false; }
    });
    const rm = h('button', { class: 'btn small danger', type: 'button' }, 'Remove');
    rm.addEventListener('click', async () => {
      try { adsense = await api('/admin/adsense/mobile', { method: 'PUT', body: { code: '' } }); toast('Phone header ad removed'); draw(); } catch (e) { toast(e.message, true); }
    });
    return h('div', { class: 'card stack' }, h('h3', {}, 'Phone header ad'),
      h('p', { class: 'adm-hint' }, 'The side adverts only fit on laptops. This one ad sits in a fixed strip at the top of the game on phones and tablets. In AdSense make a Display ad (a small horizontal banner such as 320x50 or 320x100 works best) and paste its code here. It is never placed over the buttons.'),
      cur ? h('p', { class: 'adm-hint' }, `AdSense unit ${cur.slot} saved${adsense.enabled ? ' and showing' : ' (shows once AdSense is switched on)'}.`) : null,
      code, h('div', { class: 'adm-actions' }, go, cur ? rm : null));
  }
  // The banner at the bottom of the full-page race results
  function resultsBox() {
    const cur = adsense.results;
    const code = h('textarea', { rows: '3', maxlength: '6000', placeholder: 'Paste AdSense ad code for the race results page', 'aria-label': 'AdSense code for the race results page' });
    const go = h('button', { class: 'btn small', type: 'button' }, 'Save results page ad');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try { adsense = await api('/admin/adsense/results', { method: 'PUT', body: { code: code.value } }); toast('Results page ad saved'); draw(); }
      catch (e) { toast(e.message, true); go.disabled = false; }
    });
    const rm = h('button', { class: 'btn small danger', type: 'button' }, 'Remove');
    rm.addEventListener('click', async () => {
      try { adsense = await api('/admin/adsense/results', { method: 'PUT', body: { code: '' } }); toast('Results page ad removed'); draw(); } catch (e) { toast(e.message, true); }
    });
    return h('div', { class: 'card stack' }, h('h3', {}, 'Race results page ad'),
      h('p', { class: 'adm-hint' }, 'One banner on the full page players see when a race has finished, below the standings and away from the buttons. It is not shown in pop-ups or on the level-complete box. Use a Display ad (a responsive or 300x250 rectangle works well).'),
      cur ? h('p', { class: 'adm-hint' }, `AdSense unit ${cur.slot} saved${adsense.enabled ? ' and showing' : ' (shows once AdSense is switched on)'}.`) : null,
      code, h('div', { class: 'adm-actions' }, go, cur ? rm : null));
  }
  function adsenseBox(slot) {
    const cur = adsense.side[slot];
    const code = h('textarea', { rows: '3', maxlength: '6000', placeholder: 'Or paste AdSense ad code here', 'aria-label': `AdSense code for advert ${adName(slot)}` });
    const go = h('button', { class: 'btn small', type: 'button' }, 'Save AdSense code');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try { adsense = await api('/admin/adsense/slot/' + slot, { method: 'PUT', body: { code: code.value } }); ads = (await api('/admin/ads')).ads; toast(`AdSense code saved for ${adName(slot)}`); draw(); }
      catch (e) { toast(e.message, true); go.disabled = false; }
    });
    const rm = h('button', { class: 'btn small danger', type: 'button' }, 'Remove AdSense');
    rm.addEventListener('click', async () => {
      try { adsense = await api('/admin/adsense/slot/' + slot, { method: 'PUT', body: { code: '' } }); ads = (await api('/admin/ads')).ads; toast('AdSense code removed'); draw(); }
      catch (e) { toast(e.message, true); }
    });
    return h('div', { class: 'field adm-gads' },
      cur ? h('p', { class: 'adm-hint' }, `AdSense unit ${cur.slot} saved${adsense.enabled ? ' and showing' : ' (shows once AdSense is switched on)'}.`) : null,
      code, h('div', { class: 'adm-actions' }, go, cur ? rm : null));
  }

  // ---------- adverts ----------
  let ads = [];
  const adName = (slot) => (slot <= 3 ? `Left ${slot}` : `Right ${slot - 3}`);
  function adCard(slot) {
    const cur = ads.find((a) => a.slot === slot);
    let data = null;
    const preview = h('div', { class: 'adm-ad-prev' });
    const showPreview = (src) => { preview.textContent = ''; if (src) preview.append(h('img', { src, alt: '' })); else preview.textContent = 'Empty'; };
    showPreview(cur && cur.image ? cur.image : null);
    if (cur && cur.adsense) preview.textContent = 'Google AdSense ad';
    const file = h('input', { type: 'file', accept: 'image/*', 'aria-label': `Picture for advert ${adName(slot)}` });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        if (f.type === 'image/gif') { // animated GIFs are sent as they are (cropping would stop the animation)
          if (f.size > 1_500_000) throw new Error('That GIF is too big. Keep it under 1.5 MB.');
          data = await readAsDataUrl(f);
        } else data = await fileToJpegDataUrl(f, { square: true, max: 600, maxLen: 250_000, q0: 0.78 });
        showPreview(data);
      }
      catch (e) { data = null; file.value = ''; toast(e.message, true); }
    });
    const link = h('input', { type: 'text', placeholder: 'https://… (optional: where the picture takes people)', maxlength: '300', value: cur ? cur.link : '', 'aria-label': `Link for advert ${adName(slot)}` });
    const alt = h('input', { type: 'text', placeholder: 'Short description (optional)', maxlength: '60', value: cur ? cur.alt : '', 'aria-label': `Description for advert ${adName(slot)}` });
    const who = h('input', { type: 'text', placeholder: 'Advertiser name (for the dashboard report)', maxlength: '40', value: cur ? cur.advertiser || '' : '', 'aria-label': `Advertiser name for advert ${adName(slot)}` });
    const save = h('button', { class: 'btn small', type: 'button' }, 'Save advert');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const body = { link: link.value, alt: alt.value, advertiser: who.value };
        if (data) body.image = data;
        const r = await api('/admin/ads/' + slot, { method: 'PUT', body });
        ads = r.ads; toast(`Advert ${adName(slot)} saved`); draw();
      } catch (e) { toast(e.message, true); save.disabled = false; }
    });
    const remove = h('button', { class: 'btn small danger', type: 'button' }, 'Remove');
    remove.addEventListener('click', async () => {
      try { const r = await api('/admin/ads/' + slot, { method: 'DELETE' }); ads = r.ads; toast(`Advert ${adName(slot)} removed`); draw(); }
      catch (e) { toast(e.message, true); }
    });
    return h('div', { class: 'card adm-ad' },
      h('div', { class: 'adm-answer' }, adName(slot)), preview,
      h('div', { class: 'field' }, file), h('div', { class: 'field' }, link), h('div', { class: 'field' }, alt), h('div', { class: 'field' }, who),
      h('div', { class: 'adm-actions' }, save, cur && !cur.adsense ? remove : null),
      adsenseBox(slot));
  }
  // ---- sections that fold away, so the page is short. What you left open is remembered on this device. ----
  const OPEN_KEY = 'ns_adm_open';
  let openSet = new Set();
  try { openSet = new Set(JSON.parse(localStorage.getItem(OPEN_KEY) || '[]')); } catch { /* private mode: fine */ }
  const saveOpen = () => { try { localStorage.setItem(OPEN_KEY, JSON.stringify([...openSet])); } catch { /* ignore */ } };
  let folds = [];
  function fold(key, section) {
    const head = section.querySelector('h2');
    const title = head.textContent;
    const kids = [...section.children].filter((k) => k !== head);
    const body = h('div', { class: 'adm-body' }, kids);
    const btn = h('button', { class: 'adm-fold', type: 'button' }, h('span', { class: 'adm-arrow', 'aria-hidden': 'true' }), title);
    const set = (open, remember) => {
      body.hidden = !open;
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      btn.classList.toggle('open', open);
      if (remember) { if (open) openSet.add(key); else openSet.delete(key); saveOpen(); }
    };
    btn.addEventListener('click', () => set(body.hidden, true));
    head.textContent = '';
    head.append(btn);
    section.append(body);
    set(openSet.has(key), false);
    folds.push({ set, section });
    return section;
  }

  function premiumSection() {
    const who = h('input', { type: 'text', maxlength: '30', placeholder: 'Username', 'aria-label': 'Username' });
    const days = h('input', { type: 'number', min: '0', max: '3650', value: '30', 'aria-label': 'Days' });
    const out = h('p', { class: 'adm-hint' }, 'Give a player Premium by hand (for a gift or a payment you got another way). Days are added on top of what they have. Put 0 to remove Premium.');
    const go = h('button', { class: 'btn', type: 'button' }, 'Save');
    go.addEventListener('click', async () => {
      go.disabled = true;
      try {
        const r = await api('/admin/premium', { method: 'POST', body: { username: who.value.trim(), days: Number(days.value) } });
        out.textContent = r.premium ? `${r.username} is Premium, ${r.daysLeft} day${r.daysLeft === 1 ? '' : 's'} left.` : `${r.username} is not Premium.`;
        toast('Saved');
      } catch (e) { toast(e.message, true); }
      go.disabled = false;
    });
    const sw = h('input', { type: 'checkbox', id: 'prem-open' });
    const swNote = h('p', { class: 'adm-hint' }, 'Loading...');
    const paintSw = (r) => { sw.checked = r.open; swNote.textContent = r.open ? `Premium is OPEN: players can buy it and fun facts are only for members. ${r.members} member${r.members === 1 ? '' : 's'} now.` : `Premium is LOCKED: nobody can buy it, fun facts show for everybody and the Go Premium bar is hidden. ${r.members} member${r.members === 1 ? '' : 's'} keep what they have.`; };
    api('/admin/premium').then(paintSw).catch(() => {});
    sw.addEventListener('change', async () => {
      try { const r = await api('/admin/premium/settings', { method: 'PUT', body: { open: sw.checked } }); const s = await api('/admin/premium'); paintSw(s); toast(r.open ? 'Premium is open' : 'Premium is locked'); }
      catch (e) { toast(e.message, true); sw.checked = !sw.checked; }
    });
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Premium members'),
      h('label', { class: 'adm-check', for: 'prem-open' }, sw, ' Premium is open to players'), swNote,
      h('div', { class: 'adm-tools' }, who, days, go), out);
  }
  // ---------- quiz section ----------
  function quizSection() {
    const sw = h('input', { type: 'checkbox', id: 'quiz-open' });
    const ev = h('input', { type: 'checkbox', id: 'quiz-every' });
    const note = h('p', { class: 'adm-hint' }, 'Loading...');
    const hostsEl = h('div', { class: 'adm-hint' });
    const recent = h('div', { class: 'stack' });
    const who = h('input', { type: 'text', maxlength: '30', placeholder: 'Username to approve as a host', 'aria-label': 'Username' });
    const paint = (r) => {
      sw.checked = r.open; ev.checked = r.everyone;
      note.textContent = r.open ? `Quiz is OPEN: players see the Quiz card and can join with a code. ${r.total} quiz${r.total === 1 ? '' : 'zes'} made so far.` : `Quiz is LOCKED: players do not see it. Only you (the admin) can see and try it. ${r.total} quiz${r.total === 1 ? '' : 'zes'} made so far.`;
      hostsEl.textContent = '';
      hostsEl.append(r.everyone ? 'Every player can host quizzes.' : r.hosts.length ? 'Approved hosts: ' : 'No approved hosts yet. Only you can host.');
      if (!r.everyone) r.hosts.forEach((x) => hostsEl.append(h('button', { class: 'btn small alt', type: 'button', title: 'Remove this host', onclick: async () => { try { await api('/admin/quiz/hosts', { method: 'POST', body: { username: x.name, add: false } }); load(); } catch (e) { toast(e.message, true); } } }, x.name + ' ✕'), ' '));
      recent.textContent = '';
      r.recent.forEach((q) => recent.append(h('div', { class: 'row' },
        h('a', { class: 'grow', href: `/#/quiz/${q.code}`, target: '_blank', rel: 'noopener' }, `${q.code} · ${q.title} (${q.host}, ${q.count}Q, ${q.players} players${q.status === 'closed' ? ', closed' : ''})`),
        h('button', { class: 'btn small alt', type: 'button', onclick: async () => { try { await api(`/admin/quiz/${q.code}/listed`, { method: 'POST', body: { listed: !q.listed } }); load(); } catch (e) { toast(e.message, true); } } }, q.listed ? 'Unlist' : 'List'),
        h('button', { class: 'btn small alt', type: 'button', onclick: async () => { if (!confirm(`Delete quiz ${q.code}?`)) return; try { await api(`/quiz/${q.code}`, { method: 'DELETE' }); load(); } catch (e) { toast(e.message, true); } } }, 'Delete'))));
    };
    const load = () => api('/admin/quiz').then(paint).catch(() => {});
    load();
    const put = async (box) => { try { await api('/admin/quiz/settings', { method: 'PUT', body: { open: sw.checked, everyone: ev.checked } }); toast('Saved'); load(); } catch (e) { toast(e.message, true); box.checked = !box.checked; } };
    sw.addEventListener('change', () => put(sw)); ev.addEventListener('change', () => put(ev));
    const add = h('button', { class: 'btn', type: 'button' }, 'Approve host');
    add.addEventListener('click', async () => { try { await api('/admin/quiz/hosts', { method: 'POST', body: { username: who.value.trim() } }); who.value = ''; load(); } catch (e) { toast(e.message, true); } });
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Quiz'),
      h('label', { class: 'adm-check', for: 'quiz-open' }, sw, ' Quiz is open to players'), note,
      h('label', { class: 'adm-check', for: 'quiz-every' }, ev, ' Let every player host quizzes (leave off to approve hosts one by one)'), hostsEl,
      h('div', { class: 'adm-tools' }, who, add),
      h('p', { class: 'adm-hint' }, 'Quizzes made so far. "List" shows a quiz to everybody on the Quiz page; otherwise players need its code.'), recent);
  }
  // ---------- sponsored races ----------
  function sponsorSection() {
    const name = h('input', { type: 'text', maxlength: '40', placeholder: 'Sponsor name, e.g. Mama Put Foods', 'aria-label': 'Sponsor name' });
    const prize = h('input', { type: 'text', maxlength: '120', placeholder: 'Prize, e.g. N5,000 airtime', 'aria-label': 'Prize' });
    const link = h('input', { type: 'text', maxlength: '300', placeholder: 'https://… (optional: the sponsor page)', 'aria-label': 'Sponsor link' });
    const game = h('select', { 'aria-label': 'Game' }, ['Naija', 'Universal', 'Word Search', 'Slide Puzzle'].map((g) => h('option', { value: g }, g)));
    const levels = h('input', { type: 'text', inputmode: 'numeric', maxlength: '3', value: '20', 'aria-label': 'Levels' });
    // picture races need at least 20 levels; word search and sliding puzzle races are shorter
    game.addEventListener('change', () => { levels.value = game.value === 'Word Search' || game.value === 'Slide Puzzle' ? '5' : '20'; });
    const max = h('input', { type: 'text', inputmode: 'numeric', maxlength: '3', value: '50', 'aria-label': 'Most players' });
    let logo = '';
    const logoInfo = h('p', { class: 'adm-hint' }, 'Logo (optional): a square picture works best. It is shrunk for you.');
    const file = h('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp', 'aria-label': 'Sponsor logo' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; logo = ''; if (!f) return;
      try { logo = await fileToJpegDataUrl(f, { max: 200, maxLen: 120000 }); logoInfo.textContent = `Logo ready: ${f.name}`; }
      catch (e) { file.value = ''; logoInfo.textContent = e.message; toast(e.message, true); }
    });
    const startAt = h('input', { type: 'datetime-local', 'aria-label': 'Start time' });
    const announce = h('input', { type: 'checkbox', id: 'sp-announce', checked: true });
    const out = h('div', {});
    const report = h('div', { class: 'adm-list' });
    const go = h('button', { class: 'btn', type: 'button' }, 'Create sponsored race');
    const paintReport = async () => {
      try {
        const r = await api('/admin/sponsored');
        report.textContent = '';
        if (!r.races.length) report.append(h('p', { class: 'adm-hint' }, 'No sponsored races yet.'));
        for (const x of r.races) {
          const act = async (action) => {
            if (action === 'reject' && !window.confirm('Reject this winner? The prize goes to the next player who finished.')) return;
            try { await api(`/admin/sponsored/${x.id}/prize`, { method: 'POST', body: { action } }); toast('Saved'); paintReport(); }
            catch (e) { toast(e.message, true); }
          };
          const reportUrl = `${location.origin}/s/${x.reportToken}`;
          const pw = x.prize && x.prize.winner;
          report.append(h('div', { class: 'card' },
            h('div', { class: 'adm-answer' }, x.sponsor.name, h('span', { class: 'adm-pill' }, x.status.toUpperCase())),
            h('div', { class: 'adm-line' }, `Prize: ${x.sponsor.prize}`),
            h('div', { class: 'adm-line' }, `${x.game === 'wordsearch' ? 'Word Search' : x.game === 'slide' ? 'Slide Puzzle' : 'Picture puzzles'}, ${x.rounds} levels. Code ${x.id}`),
            x.startAt ? h('div', { class: 'adm-line' }, `Start time: ${new Date(x.startAt).toLocaleString()}`) : null,
            h('div', { class: 'adm-line' }, `Saw the card: ${x.views}. Tapped the sponsor link: ${x.taps}. Joined: ${x.joined}. Finished: ${x.finished}.`),
            x.status === 'finished' ? (pw
              ? h('div', { class: 'adm-check-box' },
                h('div', { class: 'adm-answer' }, `Winner to check: ${pw.username}`, h('span', { class: 'adm-pill' }, { checking: 'BEING CHECKED', approved: 'APPROVED', paid: 'PAID', none: '' }[x.prize.status] || x.prize.status)),
                h('div', { class: 'adm-line' }, `Email: ${pw.email || 'none'}`),
                h('div', { class: 'adm-line' }, `Account is ${pw.accountDays} day${pw.accountDays === 1 ? '' : 's'} old. ${pw.points} points. ${pw.racesPlayed} races played.` + (pw.secondsPerLevel != null ? ` About ${pw.secondsPerLevel} seconds per level.` : '')),
                pw.flags.length ? h('ul', { class: 'adm-flags' }, pw.flags.map((f) => h('li', {}, '⚠️ ' + f))) : h('div', { class: 'adm-line' }, '✅ No warning signs.'),
                h('div', { class: 'adm-actions' },
                  x.prize.status === 'checking' ? h('button', { class: 'btn small', type: 'button', onclick: () => act('approve') }, 'Approve') : null,
                  x.prize.status !== 'paid' ? h('button', { class: 'btn small', type: 'button', onclick: () => act('paid') }, 'Mark as paid') : null,
                  x.prize.status !== 'paid' ? h('button', { class: 'btn small alt', type: 'button', onclick: () => act('reject') }, 'Reject, next player') : null))
              : h('div', { class: 'adm-line' }, 'No winner to pay.')) : null,
            h('div', { class: 'adm-actions' },
              x.status === 'waiting' || x.status === 'active' ? h('a', { class: 'btn small', href: `/#/c/${x.id}` }, 'Open the race lobby') : null,
              h('button', { class: 'btn small alt', type: 'button', onclick: () => navigator.clipboard.writeText(reportUrl).then(() => toast('Sponsor report link copied')).catch(() => window.prompt('Copy this link', reportUrl)) }, 'Copy sponsor report link'))));
        }
      } catch (e) { report.textContent = e.message; }
    };
    go.addEventListener('click', async () => {
      go.disabled = true; out.textContent = '';
      try {
        const r = await api('/challenges', { method: 'POST', body: {
          category: game.value, levels: Number(levels.value), maxPlayers: Number(max.value) + 1,
          sponsor: { name: name.value, prize: prize.value, link: link.value, logo, startAt: startAt.value ? new Date(startAt.value).getTime() : 0 },
        } });
        if (announce.checked) {
          const when = startAt.value ? ` It starts ${new Date(startAt.value).toLocaleString('en-NG', { weekday: 'long', hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'long' })}.` : '';
          await api('/admin/announcements', { method: 'POST', body: { title: `Sponsored race: win ${prize.value}`, body: `${name.value} is sponsoring a free race. Join it on the home screen.${when}`, chat: true, alert: true } }).catch((e) => toast('The race is created but the announcement failed: ' + e.message, true));
        }
        toast('Sponsored race created');
        out.append(h('p', { class: 'adm-note' }, `Created! Code ${r.id}. Players see it on their home screen now. When enough people have joined, open the lobby and press Start race. Do not play it yourself: you are only the host.`),
          h('a', { class: 'btn small', href: `/#/c/${r.id}` }, 'Open the race lobby'));
        paintReport();
      } catch (e) { toast(e.message, true); }
      go.disabled = false;
    });
    paintReport();
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Sponsored race'),
      h('p', { class: 'adm-hint' }, 'A free race for a brand. It shows on every player\'s home screen with the sponsor\'s logo, name and prize. You are the host: you press Start race when enough players have joined (you need one player at least). You hand over the prize yourself, so check the winner first.'),
      h('div', { class: 'card' },
        h('div', { class: 'field' }, name), h('div', { class: 'field' }, prize), h('div', { class: 'field' }, link),
        h('div', { class: 'field' }, logoInfo, file),
        h('div', { class: 'field' }, h('label', {}, 'Game'), game),
        h('div', { class: 'field' }, h('label', {}, 'Levels'), levels),
        h('div', { class: 'field' }, h('label', {}, 'Most players that can join'), max),
        h('div', { class: 'field' }, h('label', {}, 'Start time (optional). It starts by itself at this time once at least one player has joined. Leave empty to press Start yourself.'), startAt),
        h('label', { class: 'adm-check', for: 'sp-announce' }, announce, ' Tell everybody (announcement, chat and alert)'),
        h('div', { class: 'adm-actions' }, go), out),
      h('h3', {}, 'Sponsor report'), report);
  }

  function announceSection() {
    const title = h('input', { type: 'text', maxlength: '60', placeholder: 'Title, e.g. New puzzles added!', 'aria-label': 'Announcement title' });
    const body = h('textarea', { rows: '4', maxlength: '600', placeholder: 'Your message to all players (up to 600 letters)', 'aria-label': 'Announcement message' });
    const inChat = h('input', { type: 'checkbox', id: 'an-chat' }); inChat.checked = true;
    const alertAll = h('input', { type: 'checkbox', id: 'an-alert' });
    const post = h('button', { class: 'btn', type: 'button' }, 'Post announcement');
    const list = h('div', { class: 'adm-ann-list' });
    const draw = (items) => {
      list.textContent = '';
      if (!items.length) { list.append(h('p', { class: 'adm-hint' }, 'No announcements yet.')); return; }
      for (const a of items) {
        const del = h('button', { class: 'btn small alt', type: 'button' }, 'Delete');
        del.addEventListener('click', async () => {
          if (!confirm('Delete this announcement?')) return;
          try { await api('/admin/announcements/' + a.id, { method: 'DELETE' }); toast('Deleted'); load(); } catch (e) { toast(e.message, true); }
        });
        list.append(h('div', { class: 'adm-ann' }, h('div', {}, h('b', {}, a.title), h('div', { class: 'adm-hint' }, new Date(a.at).toLocaleString())), del));
      }
    };
    const load = async () => { try { draw((await api('/announcements')).items); } catch { /* ignore */ } };
    post.addEventListener('click', async () => {
      post.disabled = true;
      try {
        const r = await api('/admin/announcements', { method: 'POST', body: { title: title.value, body: body.value, chat: inChat.checked, alert: alertAll.checked } });
        toast(r.alerted ? `Posted, and an alert went to ${r.alerted} players` : 'Posted');
        title.value = ''; body.value = ''; load();
      } catch (e) { toast(e.message, true); }
      post.disabled = false;
    });
    load();
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Announcements'),
      h('p', { class: 'adm-hint' }, 'Shows on the Announcements page and on every player\'s home screen, with an ADMIN tag next to your name. You can also post it in the chat and send an alert (bell and phone notification) to everyone.'),
      h('div', { class: 'field' }, title), h('div', { class: 'field' }, body),
      h('div', { class: 'field adm-check' }, inChat, h('label', { for: 'an-chat' }, 'Also post in the chat room')),
      h('div', { class: 'field adm-check' }, alertAll, h('label', { for: 'an-alert' }, 'Send an alert to everyone')),
      post, h('h3', { class: 'adm-h3' }, 'Recent announcements'), list);
  }

  function wordSearchSection() {
    const theme = h('input', { type: 'text', maxlength: '40', placeholder: 'Theme, e.g. Naija food', 'aria-label': 'Word search theme' });
    const words = h('textarea', { rows: '3', placeholder: 'The words to find, separated by spaces or commas. Letters only, 3 to 12 letters each, 4 to 14 words. Example: JOLLOF SUYA AMALA AKARA EBA YAM', 'aria-label': 'Words to find' });
    const fact = h('input', { type: 'text', maxlength: '300', placeholder: 'Optional fun fact shown when the player finishes', 'aria-label': 'Fun fact' });
    const save = h('button', { class: 'btn', type: 'button' }, 'Add word search');
    const cancel = h('button', { class: 'btn alt', type: 'button', hidden: true }, 'Cancel edit');
    const list = h('div', { class: 'adm-ann-list' });
    const note = h('p', { class: 'adm-hint' });
    let editing = null;
    const reset = () => { editing = null; theme.value = ''; words.value = ''; fact.value = ''; save.textContent = 'Add word search'; cancel.hidden = true; };
    const draw = (levels) => {
      list.textContent = '';
      note.textContent = `${levels.length} word searches. Players play them in this order. New ones go to the end.`;
      for (const l of levels) {
        const edit = h('button', { class: 'btn small alt', type: 'button' }, 'Edit');
        edit.addEventListener('click', () => { editing = l.id; theme.value = l.theme; words.value = l.words.join(' '); fact.value = l.fact; save.textContent = 'Save changes'; cancel.hidden = false; theme.scrollIntoView({ block: 'center' }); });
        const del = h('button', { class: 'btn small alt', type: 'button' }, 'Delete');
        del.addEventListener('click', async () => {
          if (!confirm(`Delete word search ${l.level} (${l.theme})? Players on it move to the next one, and levels after it shift up by one.`)) return;
          try { draw((await api('/admin/wordsearch/' + l.id, { method: 'DELETE' })).levels); toast('Deleted'); } catch (e) { toast(e.message, true); }
        });
        list.append(h('div', { class: 'adm-ann' }, h('div', {}, h('b', {}, `${l.level}. ${l.theme}`), h('div', { class: 'adm-hint' }, l.words.join(', '))), h('div', { class: 'row' }, edit, del)));
      }
    };
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        const body = { theme: theme.value, words: words.value, fact: fact.value };
        const r = editing ? await api('/admin/wordsearch/' + editing, { method: 'PUT', body }) : await api('/admin/wordsearch', { method: 'POST', body });
        toast(editing ? 'Saved' : 'Added. Players see it straight away.');
        draw(r.levels); reset();
      } catch (e) { toast(e.message, true); }
      save.disabled = false;
    });
    cancel.addEventListener('click', reset);
    api('/admin/wordsearch').then((r) => draw(r.levels)).catch(() => {});
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Word Search'),
      h('p', { class: 'adm-hint' }, 'Type a theme and the words players must find. The game builds the letter grid by itself. Bigger grids and backwards words come at higher levels.'),
      h('div', { class: 'field' }, theme), h('div', { class: 'field' }, words), h('div', { class: 'field' }, fact),
      h('div', { class: 'row' }, save, cancel), note, list);
  }

  // Players who tapped "Forgot password": the admin sees them here and can email them or give a temporary password.
  // What to check a "this is my account" claim against, plus the recovery question when they set one.
  function factsBlock(f) {
    const when = (t) => (t ? new Date(t).toLocaleString() : 'not recorded');
    const lv = Object.entries(f.levels || {}).map(([k, v]) => `${k} ${v}`).join(', ');
    const rows = [
      ['Joined', new Date(f.joined).toLocaleDateString()],
      ['Last login', when(f.lastLogin)],
      ['Email on file', f.email || 'none'],
      ['Levels', lv || '-'],
      ['Coins / points', `${f.coins} / ${f.points}`],
      ['Friends invited', String(f.invited)],
      ['Premium', f.premium ? 'yes' : 'no'],
      ['Coin purchases', f.purchases.length ? f.purchases.map((o) => `${o.coins} coins, N${o.naira}, ${new Date(o.at).toLocaleDateString()}, ref ${o.ref}`).join(' | ') : 'none'],
    ];
    const box = h('div', { class: 'adm-facts' }, ...rows.map(([k, v]) => h('p', {}, h('b', {}, k + ': '), v)));
    if (f.recoveryQuestion) {
      const ans = h('input', { type: 'text', maxlength: '60', placeholder: 'What they tell you', 'aria-label': 'Their recovery answer' });
      const go = h('button', { class: 'btn small', type: 'button' }, 'Check their answer');
      const out = h('span', { class: 'adm-hint' });
      go.addEventListener('click', async () => {
        try {
          const r = await api(`/admin/users/${encodeURIComponent(f.username)}/check-recovery`, { method: 'POST', body: { answer: ans.value } });
          out.textContent = r.match ? ' Matches.' : ' Does not match.';
          out.className = r.match ? 'adm-hint ok' : 'adm-hint error';
        } catch (e) { toast(e.message, true); }
      });
      box.append(h('p', {}, h('b', {}, 'Recovery question: '), f.recoveryQuestion), h('div', { class: 'row' }, ans, go, out));
    } else box.append(h('p', { class: 'adm-hint' }, 'No recovery question set.'));
    if (f.deleteAt) box.append(h('p', { class: 'adm-hint' }, 'Deletion is scheduled for ' + new Date(f.deleteAt).toLocaleDateString() + '.'));
    if (!f.isAdmin) {
      const del = h('button', { class: 'btn small danger', type: 'button' }, 'Delete this account now');
      del.addEventListener('click', async () => {
        if (!confirm(`Delete the account ${f.username} for good? Their coins, points, levels and messages are removed and cannot be brought back. Only do this after checking the account is really theirs.`)) return;
        del.disabled = true;
        try {
          const r = await api(`/admin/users/${encodeURIComponent(f.username)}/delete`, { method: 'POST', body: {} });
          toast(r.deleted ? 'Account deleted' : 'They are in a race that has not ended: it will be deleted as soon as the race ends');
        } catch (e) { toast(e.message, true); del.disabled = false; }
      });
      box.append(h('div', { class: 'row' }, del));
    }
    return box;
  }

  // Shows a temporary password in a clear box with a Copy button (so it is not mistyped or copied with extra words).
  function showTemp(into, t) {
    into.textContent = '';
    const code = h('code', { class: 'adm-temp' }, t.temporaryPassword);
    const copy = h('button', { class: 'btn small', type: 'button' }, 'Copy password');
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(t.temporaryPassword); toast('Copied'); } catch { toast('Select it and copy by hand', true); }
    });
    into.append(`Temporary password for ${t.username}: `, code, ' ', copy, h('br'),
      'Send only the password. It is all lowercase with no look-alike letters. They log in with their username and this password, then are asked to choose their own.');
  }
  function resetRequestsSection() {
    const list = h('div', { class: 'adm-reqs' });
    const OUTCOME = { 'delete-emailed': 'Asked to DELETE their account: a confirmation email was sent to them', 'delete-no-email': 'Asked to DELETE their account: no email on file, check the account is theirs first', sent: 'Reset email sent', 'no-email': 'No email on file: help them by hand', 'mail-failed': 'The reset email could not be sent', sending: 'Sending the email...' };
    const draw = (data) => {
      list.textContent = '';
      if (!data.items.length) { list.append(h('p', { class: 'adm-hint' }, 'No requests yet.')); return; }
      for (const r of data.items) {
        const res = h('p', { class: 'adm-hint' });
        const row = h('div', { class: 'adm-req' + (r.done ? ' done' : '') },
          h('p', {}, h('b', {}, r.username), ` | ${r.email || 'no email'} | ${new Date(r.at).toLocaleString()}`),
          h('p', { class: 'adm-hint' }, (OUTCOME[r.outcome] || r.outcome) + (r.done ? ' (done)' : '')),
          ...(r.facts ? [factsBlock(r.facts)] : []));
        if (!r.done) {
          const temp = h('button', { class: 'btn small', type: 'button' }, 'Give a temporary password');
          temp.addEventListener('click', async () => {
            if (!confirm(`Reset the password of ${r.username}? Their old password stops working.`)) return;
            temp.disabled = true;
            try {
              const t = await api(`/admin/users/${encodeURIComponent(r.username)}/reset-password`, { method: 'POST', body: {} });
              showTemp(res, t);
            } catch (e) { toast(e.message, true); temp.disabled = false; }
          });
          const done = h('button', { class: 'btn small alt', type: 'button' }, 'Mark done');
          done.addEventListener('click', async () => { try { await api(`/admin/reset-requests/${r.id}/done`, { method: 'POST', body: {} }); load(); } catch (e) { toast(e.message, true); } });
          row.append(h('div', { class: 'row' }, temp, done), res);
        }
        list.append(row);
      }
    };
    const load = async () => { try { draw(await api('/admin/reset-requests')); } catch { /* ignore */ } };
    load();
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Password help requests'),
      h('p', { class: 'adm-hint' }, 'Players who tapped "Forgot password". If the reset email was sent they can sort it out themselves; if they have no email on file, or the email failed, give them a temporary password after checking they own the account. Requests are kept for 30 days.'),
      h('button', { class: 'btn small alt', type: 'button', onclick: load }, 'Refresh'), list);
  }

  function helpSection() {
    const who = h('input', { type: 'text', maxlength: '20', placeholder: 'Username', 'aria-label': 'Player username' });
    const find = h('button', { class: 'btn small', type: 'button' }, 'Find player');
    const out = h('div', { class: 'adm-help-out' });
    find.addEventListener('click', async () => {
      out.textContent = '';
      try {
        const r = (await api('/admin/users/' + encodeURIComponent(who.value.trim()))).user;
        const reset = h('button', { class: 'btn small', type: 'button' }, 'Give a temporary password');
        const res = h('p', { class: 'adm-hint' });
        reset.addEventListener('click', async () => {
          if (!confirm(`Reset the password of ${r.username}? Their old password stops working.`)) return;
          reset.disabled = true;
          try {
            const t = await api(`/admin/users/${encodeURIComponent(r.username)}/reset-password`, { method: 'POST', body: {} });
            showTemp(res, t);
          } catch (e) { toast(e.message, true); reset.disabled = false; }
        });
        out.append(h('p', {}, h('b', {}, r.username)), factsBlock(r), reset, res);
      } catch (e) { out.append(h('p', { class: 'error' }, e.message)); }
    });
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Help a player'),
      h('p', { class: 'adm-hint' }, 'For a player who has no email on file or cannot get the reset email. Check they really own the account first (for example, they message you from the email on file).'),
      h('div', { class: 'field' }, who), find, out);
  }

  function adsSection() {
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Adverts'),
      h('p', { class: 'adm-hint' }, 'Up to six pictures beside the game on laptops and big screens (not on phones): three on the left and three on the right. Square pictures work best, about 600 x 600. A JPG or PNG is cropped to a square. An animated GIF (under 1.5 MB) is kept as it is and keeps moving; make it square too. Leave a slot empty to hide it; fewer pictures on a side are shown bigger. Type the advertiser\'s name on each advert: the Dashboard uses it to make a private report link for that advertiser.'),
      h('h3', { class: 'adm-h3' }, 'Left side'),
      h('div', { class: 'adm-ad-grid' }, adCard(1), adCard(2), adCard(3)),
      h('h3', { class: 'adm-h3' }, 'Right side'),
      h('div', { class: 'adm-ad-grid' }, adCard(4), adCard(5), adCard(6)));
  }

  // ---------- login background pictures ----------
  let bgs = [];
  function bgCard(slot) {
    const cur = bgs.find((b) => b.slot === slot);
    const file = h('input', { type: 'file', accept: 'image/*', 'aria-label': `Login background picture ${slot}` });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        const data = await fileToJpegDataUrl(f, { max: 1280, maxLen: 640_000 });
        const r = await api('/admin/loginbg/' + slot, { method: 'PUT', body: { image: data } });
        bgs = r.pictures; toast(`Background ${slot} saved`); draw();
      } catch (e) { file.value = ''; toast(e.message, true); }
    });
    const remove = h('button', { class: 'btn small danger', type: 'button' }, 'Remove');
    remove.addEventListener('click', async () => {
      try { bgs = (await api('/admin/loginbg/' + slot, { method: 'DELETE' })).pictures; toast(`Background ${slot} removed`); draw(); }
      catch (e) { toast(e.message, true); }
    });
    return h('div', { class: 'card adm-ad' },
      h('div', { class: 'adm-answer' }, `Picture ${slot}`),
      h('div', { class: 'adm-ad-prev' }, cur ? h('img', { src: cur.image, alt: '' }) : 'Empty'),
      h('div', { class: 'field' }, file),
      h('div', { class: 'adm-actions' }, cur ? remove : null));
  }
  function bgSection() {
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Login screen background'),
      h('p', { class: 'adm-hint' }, 'Up to 8 pictures that slide slowly, blurred, behind the login screen. Wide pictures work best (landscape, about 1280 wide): Nigerian streets, food, markets, landmarks. These are shown to everyone before they log in, so do not use puzzle pictures here. With no pictures, the plain green design shows. Choosing a file saves it straight away.'),
      h('div', { class: 'adm-ad-grid' }, ...[1, 2, 3, 4, 5, 6, 7, 8].map(bgCard)));
  }

  // ---------- watermark ----------
  function watermarkSection() {
    const text = h('input', { type: 'text', id: 'wm-text', maxlength: '30', placeholder: 'e.g. PixSabi or @pixsabi', value: wm.text, 'aria-label': 'Watermark text' });
    const save = h('button', { class: 'btn', type: 'button' }, 'Save watermark');
    const status = h('p', { class: 'adm-hint' });
    const prev = h('canvas', { width: '320', height: '140', class: 'wm-prev', 'aria-label': 'Watermark preview' });
    const paintPrev = () => {
      const g = prev.getContext('2d');
      const grad = g.createLinearGradient(0, 0, 320, 140); grad.addColorStop(0, '#2b7a4b'); grad.addColorStop(1, '#e8c547');
      g.fillStyle = grad; g.fillRect(0, 0, 320, 140);
      if (text.value.trim()) paintWatermark(g, 320, 140, text.value.trim().slice(0, 30));
    };
    text.addEventListener('input', paintPrev); paintPrev();
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { wm = await api('/admin/watermark', { method: 'PUT', body: { text: text.value } }); toast(wm.text ? 'Watermark saved. New pictures will carry it.' : 'Watermark switched off'); }
      catch (e) { toast(e.message, true); }
      save.disabled = false;
    });
    // Old pictures: stamp every picture that was saved before the watermark began, once.
    const go = h('button', { class: 'btn alt', type: 'button' }, 'Add the watermark to my existing pictures');
    const stop = h('button', { class: 'btn small alt', type: 'button', style: 'display:none' }, 'Stop');
    let stopped = false;
    stop.addEventListener('click', () => { stopped = true; });
    const vOf = (u) => { try { return Number(new URL(u, location.origin).searchParams.get('v')) || 0; } catch { return 0; } };
    const fetchAsFile = async (u) => { const r = await fetch(u, { credentials: 'same-origin' }); if (!r.ok) throw new Error('Could not load a picture.'); const b = await r.blob(); return new File([b], 'p', { type: b.type || 'image/jpeg' }); };
    go.addEventListener('click', async () => {
      if (!wm.text) { toast('Save a watermark text first.', true); return; }
      if (wm.stampedAt && !confirm('You already did this once. Running it again would stamp every picture a second time. Only do this if you know the pictures are clean. Continue?')) return;
      if (!confirm(`This puts "${wm.text}" on every Naija and Universal puzzle picture and every sliding puzzle picture that was saved before today (the originals are replaced). It can take a few minutes. Keep this page open. Continue?`)) return;
      go.disabled = true; stop.style.display = ''; stopped = false;
      const todo = puzzles.filter((p) => p.hasPicture && p.image && vOf(p.image) < wm.since);
      let slides = [];
      try { slides = (await api('/admin/slide')).levels.filter((l) => l.image && !l.from && !l.missing && vOf(l.image) < wm.since); } catch { /* none */ }
      const total = todo.length + slides.length; let n = 0, failed = 0;
      for (const p of todo) {
        if (stopped) break;
        status.textContent = `Stamping ${++n} of ${total}...`;
        try { const data = await fileToJpegDataUrl(await fetchAsFile(p.image), { max: 1200, maxLen: 1_900_000, watermark: true }); await api('/admin/puzzles/' + encodeURIComponent(p.id), { method: 'PUT', body: { answer: p.answer, category: p.category, clue: p.clue, fact: p.fact, image: data } }); }
        catch (e) { failed++; }
      }
      for (const l of slides) {
        if (stopped) break;
        status.textContent = `Stamping ${++n} of ${total}...`;
        try { const data = await fileToJpegDataUrl(await fetchAsFile(l.image), { square: true, max: 720, maxLen: 380_000, q0: 0.78, watermark: true }); await api('/admin/slide/' + l.id, { method: 'PUT', body: { title: l.title, size: l.size, fact: l.fact, image: data } }); }
        catch (e) { failed++; }
      }
      if (!stopped) { try { wm = await api('/admin/watermark/stamped', { method: 'POST', body: {} }); } catch { /* ignore */ } }
      status.textContent = stopped ? `Stopped after ${n - 1} of ${total}. Pictures already done keep their watermark; run it again to finish the rest.` : `Done. ${total - failed} picture${total - failed === 1 ? '' : 's'} stamped${failed ? `, ${failed} could not be stamped` : ''}. Reload the page to see them.`;
      go.disabled = false; stop.style.display = 'none';
    });
    return h('section', { class: 'adm-ads' }, h('h2', {}, 'Watermark'),
      h('p', { class: 'adm-hint' }, 'Your text is printed small in the bottom right corner of every picture you upload here (puzzle pictures, sliding puzzle pictures and the game card photos), so it stays on the picture even if someone saves it. Leave it empty to switch the watermark off. Sponsor adverts, pop-ups and login backgrounds are left clean. Changing the text affects new pictures only.'),
      h('div', { class: 'card stack' }, h('div', { class: 'field' }, h('label', { for: 'wm-text' }, 'Watermark text'), text), prev, h('div', { class: 'adm-actions' }, save)),
      h('div', { class: 'card stack' }, h('div', { class: 'adm-answer' }, 'Existing pictures'), h('p', { class: 'adm-hint' }, 'Pictures uploaded before the watermark was switched on do not have it yet. Do this once. A picture that already carries the watermark is skipped.'), h('div', { class: 'adm-actions' }, go, stop), status));
  }

  // ---------- game card photos (home screen) ----------
  let wbgs = {};
  function slideSection() {
    const title = h('input', { type: 'text', maxlength: '40', placeholder: 'Title, e.g. Zuma Rock', 'aria-label': 'Sliding puzzle title' });
    const size = h('select', { 'aria-label': 'Grid size' },
      h('option', { value: '3' }, '3 x 3 (easy, 8 pieces)'), h('option', { value: '4' }, '4 x 4 (medium, 15 pieces)'), h('option', { value: '5' }, '5 x 5 (hard, 24 pieces)'));
    const fact = h('input', { type: 'text', maxlength: '300', placeholder: 'Optional fun fact shown when the player finishes', 'aria-label': 'Fun fact' });
    const file = h('input', { type: 'file', accept: 'image/*', 'aria-label': 'Picture' });
    const prev = h('div', { class: 'adm-ad-prev' }, 'No picture chosen');
    const save = h('button', { class: 'btn', type: 'button' }, 'Add sliding puzzle');
    const cancel = h('button', { class: 'btn alt', type: 'button', hidden: true }, 'Cancel edit');
    const list = h('div', { class: 'adm-ann-list' });
    const note = h('p', { class: 'adm-hint' });
    let editing = null, picture = null, editImage = null;
    const showPrev = (src) => { prev.textContent = ''; if (src) prev.append(h('img', { src, alt: '' })); else prev.append('No picture chosen'); };
    const reset = () => { editing = null; picture = null; editImage = null; title.value = ''; fact.value = ''; size.value = '3'; file.value = ''; showPrev(null); save.textContent = 'Add sliding puzzle'; cancel.hidden = true; };
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try { picture = await fileToJpegDataUrl(f, { square: true, max: 720, maxLen: 380_000, q0: 0.78, watermark: true }); showPrev(picture); }
      catch (e) { file.value = ''; picture = null; toast(e.message, true); }
    });
    let draw = (levels) => {
      list.textContent = '';
      note.textContent = `${levels.length} sliding puzzles. Players play them in this order. New ones go to the end. The picture is cut into a square, so the middle of your photo is used.`;
      for (const l of levels) {
        const edit = h('button', { class: 'btn small alt', type: 'button' }, 'Edit');
        edit.addEventListener('click', () => { editing = l.id; picture = null; editImage = l.image; title.value = l.title; fact.value = l.fact; size.value = String(l.size); file.value = ''; showPrev(l.image); save.textContent = 'Save changes'; cancel.hidden = false; title.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
        const del = h('button', { class: 'btn small alt', type: 'button' }, 'Delete');
        del.addEventListener('click', async () => {
          if (!confirm(`Delete sliding puzzle ${l.level} (${l.title})? Players on it move to the next one, and levels after it shift up by one.`)) return;
          try { draw((await api('/admin/slide/' + l.id, { method: 'DELETE' })).levels); toast('Deleted'); } catch (e) { toast(e.message, true); }
        });
        const thumb = h('div', { class: 'adm-thumb' }, l.image ? h('img', { src: l.image, alt: '' }) : 'No picture');
        list.append(h('div', { class: 'adm-ann' }, thumb, h('div', { class: 'grow' }, h('b', {}, `${l.level}. ${l.title}`), h('div', { class: 'adm-hint' }, `${l.size} x ${l.size}${l.from ? ' (Naija picture)' : ''}${l.missing ? ' (picture missing: players skip this one until you upload it again)' : ''}`)), h('div', { class: 'row' }, edit, del)));
      }
    };
    save.addEventListener('click', async () => {
      save.disabled = true;
      try {
        if (!editing && !picture) throw new Error('Choose a picture first.');
        const body = { title: title.value, size: Number(size.value), fact: fact.value, ...(picture ? { image: picture } : {}) };
        const r = editing ? await api('/admin/slide/' + editing, { method: 'PUT', body }) : await api('/admin/slide', { method: 'POST', body });
        toast(editing ? 'Saved' : 'Added. Players see it straight away.');
        draw(r.levels); reset();
      } catch (e) { toast(e.message, true); }
      save.disabled = false;
    });
    cancel.addEventListener('click', reset);
    // Use a picture from the Naija game (no extra storage used)
    const pickIn = h('input', { type: 'text', list: 'sl-naija-list', placeholder: 'Type a Naija answer, e.g. JOLLOF', autocomplete: 'off', 'aria-label': 'Naija puzzle to use' });
    const pickList = h('datalist', { id: 'sl-naija-list' });
    const pickSize = h('select', { 'aria-label': 'Grid size for the Naija picture' }, h('option', { value: '3' }, '3 x 3'), h('option', { value: '4' }, '4 x 4'), h('option', { value: '5' }, '5 x 5'));
    const pickPrev = h('div', { class: 'adm-ad-prev' }, 'Pick a picture');
    const pickAdd = h('button', { class: 'btn', type: 'button' }, 'Use this picture');
    let used = new Set();
    const fillPicks = () => { pickList.textContent = ''; puzzles.filter((p) => p.category === 'Naija' && p.hasPicture && !used.has(p.id)).forEach((p) => pickList.append(h('option', { value: p.answer }))); };
    const chosen = () => puzzles.find((p) => p.category === 'Naija' && p.hasPicture && p.answer === pickIn.value.trim().toUpperCase());
    pickIn.addEventListener('input', () => { const p = chosen(); pickPrev.textContent = ''; if (p) pickPrev.append(h('img', { src: p.image, alt: '' })); else pickPrev.append('Pick a picture'); });
    pickAdd.addEventListener('click', async () => {
      const p = chosen(); if (!p) { toast('Pick a picture from the list (type the answer).', true); return; }
      pickAdd.disabled = true;
      try { const r = await api('/admin/slide', { method: 'POST', body: { from: p.id, size: Number(pickSize.value) } }); toast('Added. Players see it straight away.'); pickIn.value = ''; pickPrev.textContent = 'Pick a picture'; draw(r.levels); }
      catch (e) { toast(e.message, true); }
      pickAdd.disabled = false;
    });
    const origDraw = draw;
    draw = (levels) => { used = new Set(levels.filter((l) => l.from).map((l) => l.from)); fillPicks(); origDraw(levels); };
    api('/admin/slide').then((r) => draw(r.levels)).catch((e) => { note.textContent = e.message; });
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Sliding puzzle'),
      h('p', { class: 'adm-hint' }, 'Upload a picture, give it a title and pick how many pieces it is cut into. Players slide the pieces to rebuild it. Clear, colourful pictures work best, and start with 3 x 3 for the first levels. You need at least 3 pictures before sliding puzzle races can be created.'),
      h('div', { class: 'card adm-form' },
        h('div', { class: 'field' }, h('label', {}, 'Title'), title),
        h('div', { class: 'field' }, h('label', {}, 'Grid size'), size),
        h('div', { class: 'field' }, h('label', {}, 'Fun fact (optional)'), fact),
        h('div', { class: 'field' }, h('label', {}, 'Picture'), file, prev),
        h('div', { class: 'adm-actions' }, save, cancel)),
      h('div', { class: 'card adm-form' }, h('div', { class: 'adm-answer' }, 'Or use a picture from the Naija game'),
        h('p', { class: 'adm-hint' }, 'Saves space: the picture is shared with the Naija puzzle, nothing new is stored. The title and fun fact are filled in from that puzzle; you can edit them after. If you delete that Naija puzzle, this level is skipped.'),
        h('div', { class: 'field' }, h('label', {}, 'Naija picture'), pickIn, pickList, pickPrev),
        h('div', { class: 'field' }, h('label', {}, 'Grid size'), pickSize),
        h('div', { class: 'adm-actions' }, pickAdd)),
      note, list);
  }

  const WBG_NAMES = [['naija', 'Naija'], ['universal', 'Universal'], ['wordsearch', 'Word Search'], ['slide', 'Slide Puzzle']];
  function wbgCard(key, label) {
    const cur = wbgs[key];
    const file = h('input', { type: 'file', accept: 'image/*', 'aria-label': `${label} card photo` });
    file.addEventListener('change', async () => {
      const f = file.files[0]; if (!f) return;
      try {
        const data = await fileToJpegDataUrl(f, { max: 1000, maxLen: 640_000, watermark: true });
        const r = await api('/admin/worldbg/' + key, { method: 'PUT', body: { image: data } });
        wbgs = r.pictures; toast(`${label} photo saved`); draw();
      } catch (e) { file.value = ''; toast(e.message, true); }
    });
    const remove = h('button', { class: 'btn small danger', type: 'button' }, 'Use the drawn scene');
    remove.addEventListener('click', async () => {
      try { wbgs = (await api('/admin/worldbg/' + key, { method: 'DELETE' })).pictures; toast(`${label} photo removed`); draw(); }
      catch (e) { toast(e.message, true); }
    });
    return h('div', { class: 'card adm-ad' },
      h('div', { class: 'adm-answer' }, label),
      h('div', { class: 'adm-ad-prev' }, cur ? h('img', { src: cur, alt: '' }) : 'Drawn scene'),
      h('div', { class: 'field' }, file),
      h('div', { class: 'adm-actions' }, cur ? remove : null));
  }
  function worldBgSection() {
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Game card photos'),
      h('p', { class: 'adm-hint' }, 'The big cards players swipe between on the home screen. Each shows a drawn scene until you upload a photo. Tall or square pictures work best (about 1000 pixels); the middle of the picture stays visible and the bottom is darkened so the words are easy to read. Choosing a file saves it straight away.'),
      h('div', { class: 'adm-ad-grid' }, ...WBG_NAMES.map(([k, l]) => wbgCard(k, l))));
  }

  // ---------- pop-up adverts ----------
  let popups = { settings: { enabled: true, every: 10, closeAfter: 4 }, items: [], max: 10 };
  const POP_LIMITS = { 'image/gif': 2_500_000, 'video/mp4': 4_000_000, 'video/webm': 4_000_000 };
  const fmtMB = (n) => (n < 100_000 ? Math.max(1, Math.round(n / 1000)) + ' KB' : (n / 1_000_000).toFixed(1) + ' MB');

  function readAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onerror = () => reject(new Error('Could not read that file.'));
      fr.onload = () => resolve(fr.result);
      fr.readAsDataURL(file);
    });
  }
  // Pictures are shrunk here (PNG stays PNG when it fits). GIFs and videos are sent as they are.
  async function popupFileToDataUrl(file) {
    const t = file.type;
    if (t === 'image/jpeg') return fileToJpegDataUrl(file, { max: 1000, maxLen: 1_050_000 });
    if (t === 'image/png') {
      const src = await readAsDataUrl(file);
      const png = await new Promise((resolve) => {
        const img = new Image();
        img.onerror = () => resolve(null);
        img.onload = () => {
          const k = Math.min(1, 1000 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL('image/png'));
        };
        img.src = src;
      });
      if (png && png.length <= 1_050_000) return png;
      return fileToJpegDataUrl(file, { max: 1000, maxLen: 1_050_000 }); // too heavy as PNG: save as JPEG
    }
    if (POP_LIMITS[t]) {
      if (file.size > POP_LIMITS[t]) throw new Error(`That file is ${fmtMB(file.size)}. The limit is ${fmtMB(POP_LIMITS[t])} for ${t.startsWith('video') ? 'videos' : 'GIFs'}. Make it smaller or shorter.`);
      return readAsDataUrl(file);
    }
    throw new Error('Use a JPG, PNG, GIF, MP4 or WEBM file.');
  }

  function popPreview(i) {
    if (i.kind === 'adsense') return h('div', { class: 'adm-ad-prev wide' }, `Google AdSense unit ${i.adsense ? i.adsense.slot : ''}`);
    if (i.missing) return h('div', { class: 'adm-ad-prev' }, 'File missing');
    if (i.kind === 'video') {
      const v = h('video', { src: i.url, controls: true, muted: true, playsinline: true, preload: 'metadata' });
      v.muted = true;
      return h('div', { class: 'adm-ad-prev wide' }, v);
    }
    return h('div', { class: 'adm-ad-prev wide' }, h('img', { src: i.url, alt: '' }));
  }

  function popupItem(i, n) {
    const title = h('input', { type: 'text', maxlength: '60', value: i.title || '', placeholder: 'Title (optional)', 'aria-label': 'Title' });
    const link = h('input', { type: 'text', maxlength: '300', value: i.link || '', placeholder: 'https://… (optional)', 'aria-label': 'Link' });
    const who = h('input', { type: 'text', maxlength: '40', value: i.advertiser || '', placeholder: 'Advertiser name (for the dashboard report)', 'aria-label': 'Advertiser name' });
    const active = h('input', { type: 'checkbox', id: 'act-' + i.id });
    active.checked = !!i.active;
    const save = h('button', { class: 'btn small', type: 'button' }, 'Save');
    const del = h('button', { class: 'btn small danger', type: 'button' }, 'Delete');
    save.addEventListener('click', async () => {
      save.disabled = true;
      try { popups = await api('/admin/popups/' + i.id, { method: 'PUT', body: { title: title.value, link: link.value, advertiser: who.value, active: active.checked } }); toast('Saved'); draw(); }
      catch (e) { toast(e.message, true); save.disabled = false; }
    });
    del.addEventListener('click', async () => {
      if (!confirm('Delete this pop-up advert?')) return;
      try { popups = await api('/admin/popups/' + i.id, { method: 'DELETE' }); toast('Deleted'); draw(); }
      catch (e) { toast(e.message, true); }
    });
    return h('div', { class: 'card adm-pop' },
      h('div', { class: 'adm-answer' }, `#${n}`, h('span', { class: 'adm-pill' }, i.kind.toUpperCase()), h('span', { class: 'adm-pill' }, fmtMB(i.bytes || 0))),
      popPreview(i),
      h('div', { class: 'field' }, title), h('div', { class: 'field' }, link), h('div', { class: 'field' }, who),
      h('div', { class: 'field adm-check' }, active, h('label', { for: 'act-' + i.id }, 'Active (shown to players)')),
      h('div', { class: 'adm-actions' }, save, del));
  }

  function popupsSection() {
    const st = popups.settings;
    const on = h('input', { type: 'checkbox', id: 'pop-on' }); on.checked = !!st.enabled;
    const every = h('input', { type: 'text', inputmode: 'numeric', id: 'pop-every', maxlength: '3', value: String(st.every) });
    const wait = h('input', { type: 'text', inputmode: 'numeric', id: 'pop-wait', maxlength: '2', value: String(st.closeAfter) });
    const saveSet = h('button', { class: 'btn small', type: 'button' }, 'Save settings');
    saveSet.addEventListener('click', async () => {
      saveSet.disabled = true;
      try {
        popups = await api('/admin/popups/settings', { method: 'PUT', body: { enabled: on.checked, every: Number(every.value), closeAfter: Number(wait.value) } });
        toast('Settings saved'); draw();
      } catch (e) { toast(e.message, true); saveSet.disabled = false; }
    });

    let fileData = null;
    const info = h('p', { class: 'adm-hint' }, 'Pictures: JPG or PNG (shrunk for you). GIF: up to 2.5 MB. Video: MP4 or WEBM, up to 4 MB (about 15 seconds).');
    const file = h('input', { type: 'file', id: 'pop-file', accept: 'image/jpeg,image/png,image/gif,video/mp4,video/webm' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; fileData = null; if (!f) return;
      info.textContent = 'Preparing…';
      try { fileData = await popupFileToDataUrl(f); info.textContent = `Ready: ${f.name} (${f.type.split('/')[1].toUpperCase()}, ${fmtMB(Math.round(fileData.length * 0.75))})`; }
      catch (e) { file.value = ''; info.textContent = e.message; toast(e.message, true); }
    });
    const nTitle = h('input', { type: 'text', maxlength: '60', placeholder: 'Title (optional)', 'aria-label': 'New advert title' });
    const nLink = h('input', { type: 'text', maxlength: '300', placeholder: 'https://… (optional: where a tap takes people)', 'aria-label': 'New advert link' });
    const nWho = h('input', { type: 'text', maxlength: '40', placeholder: 'Advertiser name (for the dashboard report)', 'aria-label': 'New advert advertiser' });
    const add = h('button', { class: 'btn', type: 'button' }, 'Add pop-up advert');
    add.addEventListener('click', async () => {
      if (!fileData) return toast('Choose a picture, GIF or video first.', true);
      add.disabled = true;
      try { popups = await api('/admin/popups', { method: 'POST', body: { file: fileData, title: nTitle.value, link: nLink.value, advertiser: nWho.value, active: true } }); toast('Advert added'); draw(); }
      catch (e) { toast(e.message, true); add.disabled = false; }
    });

    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Pop-up adverts'),
      h('p', { class: 'adm-hint' }, 'Shown after a player finishes every Nth level in solo play (never in challenges or the Daily puzzle). The adverts take turns in the order below. Players can always close one after the short wait.'),
      h('div', { class: 'card' },
        h('div', { class: 'field adm-check' }, on, h('label', { for: 'pop-on' }, 'Show pop-up adverts')),
        h('div', { class: 'field' }, h('label', { for: 'pop-every' }, 'Show one after every … levels'), every),
        h('div', { class: 'field' }, h('label', { for: 'pop-wait' }, 'Close button appears after … seconds (0 to 15)'), wait),
        h('div', { class: 'adm-actions' }, saveSet)),
      h('div', { class: 'adm-ad-grid' }, popups.items.map((i, n) => popupItem(i, n + 1))),
      popups.items.length >= popups.max
        ? h('p', { class: 'adm-note' }, `You have ${popups.max} adverts, the most allowed. Delete one to add another.`)
        : h('div', { class: 'card' },
          h('div', { class: 'adm-answer' }, 'Add an advert'),
          h('div', { class: 'field' }, h('label', { for: 'pop-file' }, 'Picture, GIF or video'), file, info),
          h('div', { class: 'field' }, nTitle), h('div', { class: 'field' }, nLink), h('div', { class: 'field' }, nWho),
          h('div', { class: 'adm-actions' }, add),
          h('p', { class: 'adm-hint' }, 'Pop-ups are for your own adverts only. Google does not allow its AdSense ads inside pop-ups.')));
  }

  // ---------- PixSabi Radio ----------
  let radioInfo = { max: 8000000, radio: null, now: Date.now() };
  const fmtDur = (sec) => { sec = Math.round(sec); const m = Math.floor(sec / 60), r = sec % 60; return `${m}:${String(r).padStart(2, '0')}`; };
  function audioDuration(file) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const a = new Audio();
      const done = (fn, v) => { URL.revokeObjectURL(url); fn(v); };
      a.preload = 'metadata';
      a.onloadedmetadata = () => (isFinite(a.duration) && a.duration > 0 ? done(resolve, a.duration) : done(reject, new Error('The length of that audio could not be read.')));
      a.onerror = () => done(reject, new Error('This browser cannot play that file. Use MP3, M4A, OGG or WAV.'));
      a.src = url;
    });
  }
  function radioSection() {
    const cur = radioInfo.radio;
    let chosen = null, duration = 0;
    const info = h('p', { class: 'adm-hint' }, `MP3, M4A, OGG or WAV, up to ${fmtMB(radioInfo.max)}. A 64 kbps MP3 is about 0.5 MB a minute, so you get around ${Math.round(radioInfo.max / 500000)} minutes (a 32 kbps mono MP3 is plenty for speech and doubles that). It goes on air the moment it is added.`);
    const file = h('input', { type: 'file', id: 'rd-file', accept: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav' });
    file.addEventListener('change', async () => {
      chosen = null; const f = file.files[0]; if (!f) return;
      if (f.size > radioInfo.max) { file.value = ''; info.textContent = `That file is too big. The limit is ${fmtMB(radioInfo.max)}.`; return; }
      info.textContent = 'Reading the length…';
      try { duration = await audioDuration(f); chosen = f; info.textContent = `Ready: ${f.name} (${fmtMB(f.size)}, ${fmtDur(duration)})`; }
      catch (e) { file.value = ''; info.textContent = e.message; toast(e.message, true); }
    });
    const nTitle = h('input', { type: 'text', maxlength: '80', placeholder: 'Title, e.g. Friday news (shown on the sound button)', 'aria-label': 'Radio title' });
    const add = h('button', { class: 'btn', type: 'button' }, cur ? 'Replace and go on air' : 'Put on air');
    // The file goes up as it is (not wrapped in text), with a progress figure, so a long audio does not time out.
    const send = (f) => new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', '/api/admin/radio/upload');
      x.withCredentials = true;
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.setRequestHeader('X-Duration', String(duration));
      x.setRequestHeader('X-Title', encodeURIComponent(nTitle.value));
      x.upload.onprogress = (e) => { if (e.lengthComputable) add.textContent = `Uploading… ${Math.round((e.loaded / e.total) * 100)}%`; };
      x.onload = () => { let d = {}; try { d = JSON.parse(x.responseText); } catch { /* not JSON */ } x.status === 200 ? resolve(d) : reject(new Error(d.error || `The upload failed (${x.status}).`)); };
      x.onerror = () => reject(new Error('The upload was cut off. Check your connection and try again.'));
      x.send(f);
    });
    add.addEventListener('click', async () => {
      if (!chosen) return toast('Choose a sound file first.', true);
      if (cur && !confirm('This replaces what is on air now. Continue?')) return;
      add.disabled = true;
      try { radioInfo = await send(chosen); toast('On air'); draw(); }
      catch (e) { toast(e.message, true); add.disabled = false; add.textContent = cur ? 'Replace and go on air' : 'Put on air'; }
    });
    let now = null;
    if (cur) {
      const title = h('input', { type: 'text', maxlength: '80', value: cur.title || '', 'aria-label': 'On-air title' });
      const active = h('input', { type: 'checkbox', id: 'rd-act' }); active.checked = !!cur.active;
      const call = async (body, msg) => { try { radioInfo = await api('/admin/radio', { method: 'PUT', body }); toast(msg); draw(); } catch (e) { toast(e.message, true); } };
      const save = h('button', { class: 'btn small', type: 'button' }, 'Save');
      save.addEventListener('click', () => call({ title: title.value, active: active.checked }, 'Saved'));
      const restart = h('button', { class: 'btn small alt', type: 'button' }, 'Start again from the beginning');
      restart.addEventListener('click', () => { if (confirm('Everyone listening will jump back to the start. Continue?')) call({ restart: true }, 'Restarted'); });
      const del = h('button', { class: 'btn small danger', type: 'button' }, 'Take off air and delete');
      del.addEventListener('click', async () => {
        if (!confirm('Delete this audio? Players will hear the theme song again.')) return;
        try { radioInfo = await api('/admin/radio', { method: 'DELETE' }); toast('Deleted'); draw(); } catch (e) { toast(e.message, true); }
      });
      const into = Math.max(0, ((Date.now() - cur.startedAt) / 1000) % cur.duration);
      now = h('div', { class: 'card' },
        h('div', { class: 'adm-answer' }, cur.active ? 'On air now' : 'Switched off (players hear the theme song)'),
        cur.missing ? h('p', { class: 'adm-warn' }, 'The sound file is missing. Delete this and upload it again.') : h('audio', { controls: '', preload: 'none', src: cur.url }),
        h('p', { class: 'adm-hint' }, `${cur.ext.toUpperCase()}, ${fmtMB(cur.bytes)}, ${fmtDur(cur.duration)} long, loops all day. Right now the broadcast is at ${fmtDur(into)}.`),
        h('div', { class: 'field' }, title),
        h('div', { class: 'field adm-check' }, active, h('label', { for: 'rd-act' }, 'On air (replaces the theme song)')),
        h('div', { class: 'adm-actions' }, save, restart, del));
    }
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'PixSabi Radio'),
      h('p', { class: 'adm-hint' }, 'Put a news bulletin, music or podcast on air. It replaces the theme song for every player whose sound is on. It plays like a live radio: everybody hears the same moment, and someone who comes back later joins where the broadcast is now, not from the start. It repeats until you upload the next one. Upload a new one each day.'),
      now,
      h('div', { class: 'card' },
        h('div', { class: 'adm-answer' }, cur ? 'Replace it' : 'Add audio'),
        h('div', { class: 'field' }, h('label', { for: 'rd-file' }, 'Sound file'), file, info),
        h('div', { class: 'field' }, nTitle),
        h('div', { class: 'adm-actions' }, add)));
  }

  // ---------- contest commentary ----------
  let comm = { settings: { enabled: true, breakEvery: 3, readBios: true }, max: 8, maxBytes: 900000, ads: [] };
  function commentarySection() {
    const st = comm.settings;
    const on = h('input', { type: 'checkbox', id: 'cm-on' }); on.checked = !!st.enabled;
    const bios = h('input', { type: 'checkbox', id: 'cm-bios' }); bios.checked = !!st.readBios;
    const every = h('input', { type: 'text', inputmode: 'numeric', id: 'cm-every', maxlength: '2', value: String(st.breakEvery) });
    const saveSet = h('button', { class: 'btn small', type: 'button' }, 'Save settings');
    saveSet.addEventListener('click', async () => {
      saveSet.disabled = true;
      try { comm = await api('/admin/commentary/settings', { method: 'PUT', body: { enabled: on.checked, readBios: bios.checked, breakEvery: Number(every.value) } }); toast('Settings saved'); draw(); }
      catch (e) { toast(e.message, true); saveSet.disabled = false; }
    });
    const adItem = (a) => {
      const label = h('input', { type: 'text', maxlength: '60', value: a.label || '', 'aria-label': 'Audio advert label' });
      const who = h('input', { type: 'text', maxlength: '40', value: a.advertiser || '', 'aria-label': 'Audio advert advertiser' });
      const active = h('input', { type: 'checkbox', id: 'cma-' + a.id }); active.checked = !!a.active;
      const save = h('button', { class: 'btn small', type: 'button' }, 'Save');
      save.addEventListener('click', async () => {
        save.disabled = true;
        try { comm = await api('/admin/commentary/ads/' + a.id, { method: 'PUT', body: { label: label.value, advertiser: who.value, active: active.checked } }); toast('Saved'); draw(); }
        catch (e) { toast(e.message, true); save.disabled = false; }
      });
      const del = h('button', { class: 'btn small danger', type: 'button' }, 'Delete');
      del.addEventListener('click', async () => {
        if (!confirm('Delete this audio advert?')) return;
        try { comm = await api('/admin/commentary/ads/' + a.id, { method: 'DELETE' }); toast('Deleted'); draw(); } catch (e) { toast(e.message, true); }
      });
      return h('div', { class: 'card' },
        a.missing ? h('p', { class: 'adm-warn' }, 'The sound file is missing. Delete this and add it again.') : h('audio', { controls: '', preload: 'none', src: a.url }),
        h('p', { class: 'adm-hint' }, `${a.ext.toUpperCase()}, ${fmtMB(a.bytes)}, played ${a.plays || 0} time${a.plays === 1 ? '' : 's'}`),
        h('div', { class: 'field' }, label), h('div', { class: 'field' }, who),
        h('div', { class: 'field adm-check' }, active, h('label', { for: 'cma-' + a.id }, 'Active (played in the break)')),
        h('div', { class: 'adm-actions' }, save, del));
    };
    let fileData = null;
    const info = h('p', { class: 'adm-hint' }, `MP3, M4A, OGG or WAV, up to ${fmtMB(comm.maxBytes)} (about 30 to 60 seconds).`);
    const file = h('input', { type: 'file', id: 'cm-file', accept: 'audio/mpeg,audio/mp4,audio/ogg,audio/wav,.mp3,.m4a,.ogg,.wav' });
    file.addEventListener('change', async () => {
      const f = file.files[0]; fileData = null; if (!f) return;
      if (f.size > comm.maxBytes) { file.value = ''; info.textContent = `That file is too big. The limit is ${fmtMB(comm.maxBytes)}.`; return; }
      try {
        const d = await readAsDataUrl(f);
        const ext = (f.name.split('.').pop() || '').toLowerCase();
        const mime = { mp3: 'audio/mpeg', m4a: 'audio/mp4', ogg: 'audio/ogg', wav: 'audio/wav' }[ext] || f.type || 'audio/mpeg';
        fileData = d.replace(/^data:[^;,]*/, 'data:' + mime);
        info.textContent = `Ready: ${f.name} (${fmtMB(f.size)})`;
      } catch (e) { file.value = ''; info.textContent = e.message; }
    });
    const nLabel = h('input', { type: 'text', maxlength: '60', placeholder: 'Label (for you)', 'aria-label': 'New audio advert label' });
    const nWho = h('input', { type: 'text', maxlength: '40', placeholder: 'Advertiser name (for the dashboard report)', 'aria-label': 'New audio advert advertiser' });
    const add = h('button', { class: 'btn', type: 'button' }, 'Add audio advert');
    add.addEventListener('click', async () => {
      if (!fileData) return toast('Choose a sound file first.', true);
      add.disabled = true;
      try { comm = await api('/admin/commentary/ads', { method: 'POST', body: { file: fileData, label: nLabel.value, advertiser: nWho.value, active: true } }); toast('Advert added'); draw(); }
      catch (e) { toast(e.message, true); add.disabled = false; }
    });
    return h('section', { class: 'adm-ads' },
      h('h2', {}, 'Contest commentary'),
      h('p', { class: 'adm-hint' }, 'A spoken announcer for races. Each listener hears it in the voice of their own phone or computer. At the commercial break one of the audio adverts below plays. Premium players do not hear the break.'),
      h('div', { class: 'card' },
        h('div', { class: 'field adm-check' }, on, h('label', { for: 'cm-on' }, 'Offer live commentary in races')),
        h('div', { class: 'field adm-check' }, bios, h('label', { for: 'cm-bios' }, 'Read each player\'s profile description aloud')),
        h('div', { class: 'field' }, h('label', { for: 'cm-every' }, 'Commercial break every … minutes (1 to 15)'), every),
        h('div', { class: 'adm-actions' }, saveSet)),
      h('div', { class: 'adm-ad-grid' }, comm.ads.map(adItem)),
      comm.ads.length >= comm.max
        ? h('p', { class: 'adm-note' }, `You have ${comm.max} audio adverts, the most allowed. Delete one to add another.`)
        : h('div', { class: 'card' },
          h('div', { class: 'adm-answer' }, 'Add an audio advert'),
          h('div', { class: 'field' }, h('label', { for: 'cm-file' }, 'Sound file'), file, info),
          h('div', { class: 'field' }, nLabel), h('div', { class: 'field' }, nWho),
          h('div', { class: 'adm-actions' }, add)));
  }

  // ---------- list ----------
  function matches(p, cat) {
    if (p.category !== cat) return false;
    const q = filter[cat].trim().toLowerCase();
    return !q || [p.answer, p.clue, p.fact].some((x) => String(x).toLowerCase().includes(q));
  }

  function itemEl(p) {
    const thumb = h('div', { class: 'adm-thumb' });
    if (p.image) thumb.append(h('img', { src: p.image, alt: '', loading: 'lazy' }));
    else thumb.textContent = p.emoji ? 'Emoji only: add a picture' : 'No picture yet';
    return h('div', { class: 'card adm-item' }, thumb, h('div', {},
      h('div', { class: 'adm-answer' }, p.answer, h('span', { class: 'adm-pill' }, p.category)),
      h('div', { class: 'adm-line' }, h('b', {}, 'Clue: '), p.clue),
      h('div', { class: 'adm-line' }, h('b', {}, 'Fact: '), p.fact),
      h('div', { class: 'adm-line' }, `Solved by ${p.solvedBy} player${p.solvedBy === 1 ? '' : 's'}`),
      h('div', { class: 'adm-actions' },
        h('button', { class: 'btn small', type: 'button', onclick: () => puzzleForm(p) }, 'Edit'),
        h('button', { class: 'btn small danger', type: 'button', onclick: () => confirmDelete(p) }, 'Delete'))));
  }

  function draw() {
    root.textContent = '';
    folds = [];
    const refreshers = [];
    // One foldable section for each puzzle category, each with its own search, count and Add button.
    const puzzleSectionFor = (cat) => {
      const search = h('input', { type: 'text', placeholder: 'Search answer, clue or fact', 'aria-label': `Search ${cat} puzzles`, value: filter[cat] });
      const list = h('div', { class: 'adm-list' });
      const summary = h('div', { class: 'adm-summary' });
      const refresh = () => {
        const mine = puzzles.filter((p) => p.category === cat);
        const shown = mine.filter((p) => matches(p, cat));
        list.textContent = '';
        shown.forEach((p) => list.append(itemEl(p)));
        if (!shown.length) list.append(h('div', { class: 'adm-msg muted' }, mine.length ? 'No puzzles match.' : `No ${cat} puzzles yet.`));
        const noPic = mine.filter((p) => !p.hasPicture).length;
        summary.textContent = `${mine.length} ${cat} puzzle${mine.length === 1 ? '' : 's'}` + (noPic ? `, ${noPic} without a picture` : '') + (shown.length !== mine.length ? ` (showing ${shown.length})` : '');
      };
      refreshers.push(refresh);
      search.addEventListener('input', () => { filter[cat] = search.value; refresh(); });
      return h('section', { class: 'adm-ads' },
        h('h2', {}, `${cat} puzzles`),
        h('div', { class: 'adm-tools' }, search, h('button', { class: 'btn', type: 'button', onclick: () => puzzleForm(null, cat) }, `Add ${cat} puzzle`)),
        summary, list);
    };
    const naijaSection = puzzleSectionFor('Naija'), universalSection = puzzleSectionFor('Universal');
    root.append(
      h('div', { class: 'adm-top' }, h('h1', {}, 'PixSabi Admin'), h('span', { class: 'adm-toplinks' }, h('a', { class: 'btn small', href: '/dashboard.html' }, 'Dashboard'), h('a', { href: '/' }, 'Back to the game'))),
      h('div', { class: 'adm-foldbar' },
        h('button', { class: 'btn small alt', type: 'button', onclick: () => folds.forEach((f) => f.set(true, true)) }, 'Open all'),
        h('button', { class: 'btn small alt', type: 'button', onclick: () => folds.forEach((f) => f.set(false, true)) }, 'Close all')),
      fold('backup', backupSection()),
      fold('radio', radioSection()),
      fold('resets', resetRequestsSection()),
      fold('announce', announceSection()),
      fold('sponsor', sponsorSection()),
      fold('premium', premiumSection()),
      fold('quiz', quizSection()),
      fold('wordsearch', wordSearchSection()),
      fold('watermark', watermarkSection()),
      fold('slide', slideSection()),
      fold('help', helpSection()),
      fold('chatlock', chatLockSection()),
      fold('social', socialSection()),
      fold('gads', adsenseSection()),
      fold('ads', adsSection()),
      fold('bg', bgSection()),
      fold('worldbg', worldBgSection()),
      fold('popups', popupsSection()),
      fold('commentary', commentarySection()),
      fold('puzzles-naija', naijaSection),
      fold('puzzles-universal', universalSection));
    refreshers.forEach((f) => f());
  }

  function message(title, text, link) {
    root.textContent = '';
    root.append(h('div', { class: 'card adm-msg' }, h('h2', {}, title), h('p', {}, text),
      link ? h('a', { class: 'btn', href: '/' }, link) : null));
  }

  async function load() {
    const r = await api('/admin/puzzles');
    puzzles = r.puzzles; categories = r.categories;
    ads = (await api('/admin/ads')).ads;
    bgs = (await api('/admin/loginbg')).pictures;
    wbgs = (await api('/admin/worldbg')).pictures;
    popups = await api('/admin/popups');
    try { radioInfo = await api('/admin/radio'); } catch { /* keep default */ }
    try { comm = await api('/admin/commentary'); } catch { /* keep default */ }
    adsense = await api('/admin/adsense');
    social = await api('/admin/social');
    try { wm = await api('/admin/watermark'); } catch { /* keep default */ }
    chatLock = await api('/admin/chat-lock');
    try { backupInfo = await api('/admin/backup'); } catch { /* keep default */ }
    draw();
  }

  (async function start() {
    try {
      const s = await api('/admin/status');
      if (!s.admin) return message('Not found', 'There is nothing here.', 'Back to the game');
      await load();
    } catch (e) {
      if (e.status === 401) message('Log in first', 'Open the game, log in with your admin account, then come back to this page.', 'Go to the game');
      else message('Could not load', e.message);
    }
  })();
})();
