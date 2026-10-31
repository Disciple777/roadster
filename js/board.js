// board.js — online leaderboard & ghost storage (talks to api/index.php on the game's own server)
(function () {
  // the page opened straight from disk (file://) can't reach a relative api/, so it talks to the live server;
  // a local dev server (localhost) does too, but writes to the sandbox tables so tests never reach the real board
  const LIVE = 'https://guatermelon.com/roadster/api/index.php';
  const DEV = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  const URL_ = location.protocol === 'file:' ? LIVE : DEV ? LIVE + '?sandbox=1' : 'api/index.php';
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
  // a ranked street race is run on the same setup by everyone (the server checks it too)
  G.OFFICIAL_RACE = { traffic: 'heavy', rivals: 7, difficulty: 'pro' };
  // what keeps a run off the leaderboard, in words (empty: it's official)
  G.unofficial = (mode, laps, S) => {
    const miss = [];
    if (laps !== G.OFFICIAL_LAPS[mode]) miss.push(`${G.OFFICIAL_LAPS[mode]} lap${G.OFFICIAL_LAPS[mode] > 1 ? 's' : ''}`);
    if (mode === 'race') {
      const O = G.OFFICIAL_RACE;
      if (S.traffic !== O.traffic) miss.push(O.traffic.toUpperCase() + ' traffic');
      if (S.rivals !== O.rivals) miss.push(O.rivals + ' rivals');
      if (S.difficulty !== O.difficulty) miss.push(O.difficulty.toUpperCase() + ' skill');
    }
    return miss;
  };
  G.api = {
    top: (track, mode) => call({ a: 'top', track, mode, id }),
    submit: (run) => call({}, Object.assign({ a: 'submit', id }, run)),
    ghosts: (track, course = 'street') => call({ a: 'ghosts', track, course, id }),
    // obstacle courses: the official layout per circuit (null = the built-in one), shared player courses by code
    official: (track) => call({ a: 'official', track }),
    share: (c) => call({}, Object.assign({ a: 'share', id }, c)),
    shared: (code) => call({ a: 'shared', code }),
    sharedList: () => call({ a: 'shared_list' }),
    // race control (the passkey travels in the POST body, never in the URL)
    admin: (a, key, body) => call({}, Object.assign({ a, key }, body)),
  };
})();
