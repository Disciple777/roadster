// board.js — online leaderboard & ghost storage (talks to api/index.php on the game's own server)
(function () {
  // local development talks to the live API but writes to its sandbox tables, so tests never reach the real board
  const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const URL_ = LOCAL ? 'https://guatermelon.com/roadster/api/index.php?sandbox=1' : 'api/index.php';
  const q = (o) => Object.entries(o).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  // anonymous driver id: random, kept in this browser (the server stores only a hash of it)
  let id = G.store.get('driverId', '');
  if (!/^[a-f0-9]{32}$/.test(id)) {
    const b = new Uint8Array(16);
    crypto.getRandomValues(b);
    id = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
    G.store.set('driverId', id);
  }

  async function call(params, body) {
    const url = URL_ + (URL_.includes('?') ? '&' : '?') + q(params);
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), body ? 15000 : 8000);
    try {
      const r = await fetch(url, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal } : { signal: ctl.signal });
      const j = await r.json().catch(() => null);
      if (!j || !j.ok) throw new Error((j && (j.message || j.error)) || 'HTTP ' + r.status);
      return j;
    } finally { clearTimeout(to); }
  }

  G.OFFICIAL_LAPS = { race: 2, course: 1 };
  G.api = {
    top: (track, mode) => call({ a: 'top', track, mode, id }),
    submit: (run) => call({}, Object.assign({ a: 'submit', id }, run)),
    ghosts: (track, course = 'street') => call({ a: 'ghosts', track, course, id }),
  };
})();
