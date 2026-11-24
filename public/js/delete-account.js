/* The form on /delete-account for people who cannot log in. */
(function () {
  var form = document.getElementById('del-form');
  if (!form) return;
  var who = document.getElementById('del-who');
  var msg = document.getElementById('del-msg');
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    msg.textContent = '';
    var v = who.value.trim();
    if (!v) { msg.textContent = 'Type your username or email first.'; return; }
    fetch('/api/auth/delete-request', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ who: v }) })
      .then(function (r) { return r.json().then(function (d) { return { ok: r.ok, d: d }; }); })
      .then(function (x) { msg.textContent = x.ok ? x.d.message : (x.d.error || x.d.message || 'Something went wrong. Try again.'); })
      .catch(function () { msg.textContent = 'We could not reach the server. Try again.'; });
  });
})();
