/* PixSabi themes. Loaded first (in the page head) so the right colours show before anything is drawn.
   The choice is kept on this phone. The default is the futuristic look from the login screen. */
(function () {
  var NS = typeof window !== 'undefined' ? (window.NS = window.NS || {}) : {};
  var KEY = 'ns_theme';
  var LIST = [
    { id: 'neon', name: 'Futuristic', note: 'Cyan glow on deep violet', bar: '#0a0220', swatch: ['#0a0220', '#5ee7ff', '#8a54ff'] },
    { id: 'naija', name: 'Naija Green', note: 'Green glass, green-white-green', bar: '#03120b', swatch: ['#03120b', '#2fcf8e', '#f5c542'] },
    { id: 'sunset', name: 'Sunset', note: 'Orange and pink glow', bar: '#1a0716', swatch: ['#1a0716', '#ff9f43', '#ff6aa8'] },
    { id: 'classic', name: 'Classic', note: 'The original violet and gold', bar: '#12062b', swatch: ['#12062b', '#f5c542', '#8a54ff'] },
  ];
  var DEFAULT = 'neon';
  function valid(id) { return LIST.some(function (t) { return t.id === id; }); }
  function get() {
    var id = DEFAULT;
    try { var s = localStorage.getItem(KEY); if (valid(s)) id = s; } catch (e) { /* storage blocked: use the default */ }
    return id;
  }
  function apply(id) {
    if (!valid(id)) id = DEFAULT;
    document.documentElement.setAttribute('data-theme', id);
    var t = LIST.filter(function (x) { return x.id === id; })[0];
    var m = document.querySelector('meta[name="theme-color"]');
    if (m && t) m.setAttribute('content', t.bar);
    return id;
  }
  function set(id) {
    if (!valid(id)) return get();
    try { localStorage.setItem(KEY, id); } catch (e) { /* kept for this visit only */ }
    return apply(id);
  }
  NS.theme = { list: LIST, get: get, set: set, apply: apply, valid: valid, DEFAULT: DEFAULT };
  if (typeof document !== 'undefined') apply(get());
})();
