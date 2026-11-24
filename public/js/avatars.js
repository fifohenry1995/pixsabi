/* Display pictures: vector people and animated faces drawn right in the browser. Nothing is uploaded or stored on the server;
   the player's choice is just a short key (like "m2" or "a-cool"). Keep the key list in step with src/avatars.js. */
(function () {
  var NS = (window.NS = window.NS || {});
  var PEOPLE = {
    m1: { g: 'm', skin: '#8d5524', hair: '#1b1b1b', bg: '#0a7b45', shirt: '#f5c542' },
    m2: { g: 'm', skin: '#c68642', hair: '#2b1b0e', bg: '#2540c8', shirt: '#ffffff' },
    m3: { g: 'm', skin: '#5c3a1e', hair: '#111111', bg: '#7a3db8', shirt: '#0a7b45' },
    m4: { g: 'm', skin: '#e0ac69', hair: '#4a2c12', bg: '#b35a00', shirt: '#2540c8' },
    f1: { g: 'f', skin: '#8d5524', hair: '#1b1b1b', bg: '#c8281c', shirt: '#f5c542' },
    f2: { g: 'f', skin: '#c68642', hair: '#2b1b0e', bg: '#00758f', shirt: '#ffffff' },
    f3: { g: 'f', skin: '#5c3a1e', hair: '#111111', bg: '#0a7b45', shirt: '#7a3db8' },
    f4: { g: 'f', skin: '#e0ac69', hair: '#6b3a12', bg: '#7a3db8', shirt: '#c8281c' },
  };
  function person(p) {
    var back = p.g === 'f' ? '<path d="M27 46Q24 16 50 16Q76 16 73 46L76 74Q62 72 60 62L40 62Q38 72 24 74Z" fill="' + p.hair + '"/>' : '';
    var top = p.g === 'f'
      ? '<path d="M30 42Q32 22 50 22Q68 22 70 42Q58 30 50 33Q42 30 30 42Z" fill="' + p.hair + '"/>'
      : '<path d="M30 40Q28 18 50 18Q72 18 70 40Q62 29 50 29Q38 29 30 40Z" fill="' + p.hair + '"/>';
    return '<svg viewBox="0 0 100 100" aria-hidden="true"><rect width="100" height="100" fill="' + p.bg + '"/>' + back +
      '<path d="M16 100Q50 60 84 100Z" fill="' + p.shirt + '"/><rect x="43" y="56" width="14" height="14" fill="' + p.skin + '"/>' +
      '<circle cx="50" cy="42" r="19" fill="' + p.skin + '"/>' + top +
      '<circle cx="43" cy="44" r="2.2" fill="#1b1b1b"/><circle cx="57" cy="44" r="2.2" fill="#1b1b1b"/>' +
      '<path d="M43 52Q50 58 57 52" fill="none" stroke="#1b1b1b" stroke-width="2" stroke-linecap="round"/></svg>';
  }
  var HEART = 'M0 -3C-6 -10-13 -2 0 9C13 -2 6 -10 0 -3Z';
  var STAR = '0,-9 2.6,-3 9,-2.6 4,1.6 5.6,8 0,4.6 -5.6,8 -4,1.6 -9,-2.6 -2.6,-3';
  var FACE = '<circle cx="50" cy="50" r="46" fill="#ffd23f" stroke="#e8a900" stroke-width="3"/>';
  var MOUTH = '<path d="M30 60Q50 80 70 60" fill="none" stroke="#5a3a00" stroke-width="4" stroke-linecap="round"/>';
  var FACES = {
    'a-happy': '<g class="av-bob">' + FACE + '<ellipse class="av-blink" cx="36" cy="42" rx="5" ry="7" fill="#3b2400"/><ellipse class="av-blink" cx="64" cy="42" rx="5" ry="7" fill="#3b2400"/>' + MOUTH + '</g>',
    'a-cool': '<g class="av-bob">' + FACE + '<rect x="20" y="34" width="60" height="6" rx="3" fill="#111"/><rect x="22" y="36" width="26" height="18" rx="7" fill="#111"/><rect x="52" y="36" width="26" height="18" rx="7" fill="#111"/><path d="M30 66Q50 78 70 66" fill="none" stroke="#5a3a00" stroke-width="4" stroke-linecap="round"/></g>',
    'a-laugh': '<g class="av-shake">' + FACE + '<path d="M26 44Q36 32 46 44M54 44Q64 32 74 44" fill="none" stroke="#3b2400" stroke-width="4" stroke-linecap="round"/><path d="M28 56Q50 92 72 56Z" fill="#7a1f1f"/><path d="M34 60Q50 70 66 60" fill="#fff"/></g>',
    'a-love': '<g class="av-bob">' + FACE + '<path class="av-pulse" transform="translate(35 43) scale(1.1)" d="' + HEART + '" fill="#e0245e"/><path class="av-pulse" transform="translate(65 43) scale(1.1)" d="' + HEART + '" fill="#e0245e"/>' + MOUTH + '</g>',
    'a-star': '<g class="av-bob">' + FACE + '<polygon class="av-twinkle" transform="translate(35 42) scale(1.2)" points="' + STAR + '" fill="#2540c8"/><polygon class="av-twinkle" transform="translate(65 42) scale(1.2)" points="' + STAR + '" fill="#2540c8"/>' + MOUTH + '</g>',
    'a-wink': '<g class="av-bob">' + FACE + '<ellipse cx="36" cy="42" rx="5" ry="7" fill="#3b2400"/><path class="av-wink" d="M56 43Q64 36 72 43" fill="none" stroke="#3b2400" stroke-width="4" stroke-linecap="round"/>' + MOUTH + '</g>',
  };
  var KEYS = Object.keys(PEOPLE).concat(Object.keys(FACES));
  // The drawing for a key as a small SVG string (made only from the fixed tables above), or '' for an unknown key.
  function svg(key) {
    if (PEOPLE[key]) return person(PEOPLE[key]);
    if (FACES[key]) return '<svg viewBox="0 0 100 100" aria-hidden="true">' + FACES[key] + '</svg>';
    return '';
  }
  NS.avatars = { keys: KEYS, svg: svg, people: Object.keys(PEOPLE), faces: Object.keys(FACES) };
})();
