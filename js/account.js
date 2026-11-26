// account.js — the FULL GAME: accounts, buying it through PayPal, and what the free web demo leaves locked.
// The server (api/shop.php) is the truth: it says whether an account has the full game, and only ranks the full-game
// boards for those accounts. In the browser the state is cached in localStorage rt_acct { token, email, full }.
(function () {
  G.FULL_PRICE = '4.99'; // keep in step with SHOP_PRICE in api/shop.php
  // the free web demo (keep in step with FREE_TRACKS in api/index.php)
  G.FREE = { tracks: ['city', 'highway', 'canyon'], chalLevels: 5 };

  const get = () => G.store.get('acct', null);
  const put = (a) => { G.store.set('acct', a); G.acctChanged(); };
  G.account = () => get();
  G.isFull = () => { const a = get(); return !!(a && a.full); };
  G.trackOpen = (id) => G.isFull() || G.FREE.tracks.includes(id);
  G.acctToken = () => (get() || {}).token || '';
  // listeners (game.js) re-draw locks when the account changes
  const subs = [];
  G.onAcct = (fn) => subs.push(fn);
  G.acctChanged = () => subs.forEach((f) => { try { f(G.isFull()); } catch (e) { console.error(e); } });

  const keep = (r) => {
    if (r.token) { G.store.set('syncRev', 0); G.store.set('syncDirty', []); } // a new sign-in: the account's save is the starting point
    const a = { token: r.token || G.acctToken(), email: r.account.email, full: !!r.account.full }; put(a);
    if (r.token || (r.save_rev || 0) !== (G.store.get('syncRev', 0) || 0) || G.store.get('syncDirty', []).length) setTimeout(() => G.cloudSync && G.cloudSync(), 0);
    return a;
  };
  G.acct = {
    signup: (email, password) => G.api.account('signup', { email, password }).then(keep),
    login: (email, password) => G.api.account('login', { email, password }).then(keep),
    logout: () => {
      const t = G.acctToken();
      put(null);
      return t ? G.api.account('logout', { token: t }).catch(() => null) : Promise.resolve();
    },
    // ask the server again (after paying, on focus, at start); a dead token signs this browser out
    refresh: () => {
      const t = G.acctToken();
      if (!t) return Promise.resolve(null);
      return G.api.account('me', { token: t }).then(keep).catch((e) => { if (/signed out/i.test(e.message)) put(null); return get(); });
    },
    buy: () => G.api.account('buy', { token: G.acctToken() }).then((r) => r.url),
  };

  // ---------------- cloud save: settings, unlocked cars, records and courses follow the account ----------------
  // Every rt_ key in localStorage travels except these (the account itself, this browser's anonymous id, scratch state).
  const LOCAL_ONLY = ['acct', 'driverId', 'edClip', 'syncRev', 'syncDirty'];
  const synced = (k) => !LOCAL_ONLY.includes(k);
  const raw = { // localStorage without the change hook below
    get: (k) => { try { const v = localStorage.getItem('rt_' + k); return v == null ? undefined : JSON.parse(v); } catch (e) { return undefined; } },
    set: (k, v) => { try { localStorage.setItem('rt_' + k, JSON.stringify(v)); } catch (e) { /* full / private */ } },
  };
  const snapshot = () => {
    const o = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = (localStorage.key(i) || '').replace(/^rt_/, '');
      if (localStorage.key(i).startsWith('rt_') && synced(k)) { const v = raw.get(k); if (v !== undefined) o[k] = v; }
    }
    return o;
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])])];
  // progress never goes backwards: unlocked cars and goals are combined, records keep the best of both;
  // everything else (settings, volume…) keeps this browser's value if it changed it since the last sync, else the account's
  const mergeKey = (k, mine, theirs, dirty) => {
    if (mine === undefined) return theirs;
    if (theirs === undefined) return mine;
    if (k === 'unlockedCars') return union(mine, theirs);
    if (k === 'progress' && mine && theirs && typeof mine === 'object') {
      const o = Object.assign({}, theirs, mine);
      for (const f of Object.keys(o)) {
        const a = mine[f], b = theirs[f];
        if (Array.isArray(a) || Array.isArray(b)) o[f] = union(a, b);
        else if (typeof a === 'number' && typeof b === 'number') o[f] = Math.max(a, b);
        else if (a !== undefined && b !== undefined) o[f] = a || b;
      }
      return o;
    }
    if (/^(chalLvl_|chalBest$|courseBest_)/.test(k) && typeof mine === 'number' && typeof theirs === 'number') return Math.max(mine, theirs);
    if (/^bestLap/.test(k) && typeof mine === 'number' && typeof theirs === 'number') return Math.min(mine, theirs);
    if (k === 'myCourses' && Array.isArray(mine) && Array.isArray(theirs)) {
      const ids = new Set(theirs.map((c) => c && c.id));
      return theirs.concat(mine.filter((c) => c && !ids.has(c.id)));
    }
    return dirty.includes(k) ? mine : theirs;
  };
  const merge = (mine, theirs, dirty) => {
    const out = {};
    for (const k of new Set([...Object.keys(mine), ...Object.keys(theirs || {})])) { const v = mergeKey(k, mine[k], (theirs || {})[k], dirty); if (v !== undefined) out[k] = v; }
    return out;
  };

  const dirtyList = () => raw.get('syncDirty') || [];
  let pushT = null, syncing = null;
  // keep the merged save here; report whether this browser's save changed (the game reloads to pick it up)
  const adopt = (data, rev) => {
    const before = snapshot(), merged = merge(before, data, dirtyList());
    let changed = false;
    for (const [k, v] of Object.entries(merged)) if (!same(before[k], v)) { raw.set(k, v); changed = true; }
    raw.set('syncRev', rev);
    return { merged, changed };
  };
  // pull the account's save, merge, and push back whatever this browser adds
  G.cloudSync = () => {
    if (syncing) return syncing;
    const run = async () => {
      if (!G.acctToken()) return false;
      let r = await G.api.account('save_get', { token: G.acctToken() });
      let { merged, changed } = adopt(r.data || {}, r.rev);
      for (let tries = 0; tries < 3 && !same(merged, r.data || {}); tries++) {
        const w = await G.api.account('save_put', { token: G.acctToken(), rev: raw.get('syncRev') || 0, data: merged });
        if (!w.conflict) { raw.set('syncRev', w.rev); break; }
        r = w; const m = adopt(r.data || {}, r.rev); merged = m.merged; changed = changed || m.changed;
      }
      raw.set('syncDirty', []);
      if (changed && G.onCloudLoad) G.onCloudLoad();
      return changed;
    };
    syncing = run().catch((e) => { console.warn('cloud save:', e.message); return false; }).finally(() => { syncing = null; });
    return syncing;
  };
  // every save the game makes is marked and sent a few seconds later
  const storeSet = G.store.set;
  G.store.set = function (k, v) {
    let before = null; try { before = localStorage.getItem('rt_' + k); } catch (e) { /* ok */ }
    storeSet.call(G.store, k, v);
    if (!synced(k) || !G.acctToken()) return;
    try { if (localStorage.getItem('rt_' + k) === before) return; } catch (e) { /* ok */ } // the same value again: nothing to send
    const d = dirtyList(); if (!d.includes(k)) { d.push(k); raw.set('syncDirty', d); }
    clearTimeout(pushT); pushT = setTimeout(G.cloudSync, 3000);
  };
  // leaving the page with unsent changes: one last write that outlives the page
  window.addEventListener('pagehide', () => {
    if (!pushT || !G.acctToken() || !dirtyList().length) return;
    const url = (location.protocol === 'file:' || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))
      ? 'https://guatermelon.com/roadster/api/index.php' + (location.protocol === 'file:' ? '' : '?sandbox=1') : 'api/index.php';
    try { fetch(url, { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ a: 'save_put', token: G.acctToken(), rev: raw.get('syncRev') || 0, data: snapshot() }) }); } catch (e) { /* best effort */ }
  });

  // ---------------- the FULL GAME panel ----------------
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  let busy = false, poll = null;
  const status = (t, bad) => { const el = $('acct-status'); if (el) { el.textContent = t || ''; el.classList.toggle('bad', !!bad); } };

  G.drawAcct = () => {
    const a = get(), full = G.isFull();
    const out = $('acct-out'), inn = $('acct-in');
    if (!out) return;
    out.classList.toggle('hidden', !!a);
    inn.classList.toggle('hidden', !a);
    if (a) {
      $('acct-who').innerHTML = `Signed in as <b>${esc(a.email)}</b>`;
      $('acct-owned').classList.toggle('hidden', !full);
      $('acct-buy').classList.toggle('hidden', full);
      $('acct-check').classList.toggle('hidden', full);
    }
    $('acct-title').textContent = full ? 'FULL GAME ✓' : 'FULL GAME';
    document.body.classList.toggle('is-full', full);
    const m = $('btn-getfull');
    if (m) m.innerHTML = full ? `<span class="s1">&#10003; FULL GAME</span><span class="s2">${esc((a && a.email) || '')}</span>`
      : `<span class="s1">&#9733; GET THE FULL GAME · $${G.FULL_PRICE}</span><span class="s2">Every track, car and mode. Helps fund online multiplayer</span>`;
    const inst = $('acct-install');
    if (inst) inst.classList.toggle('hidden', full || !G.canInstall());
    const getBox = $('acct-get');
    if (getBox) {
      getBox.classList.toggle('hidden', !full);
      $('acct-get-how').innerHTML = installHow();
    }
  };

  // ---------------- installing the game (an app window of its own, offline-free) ----------------
  G.isApp = () => ['standalone', 'fullscreen', 'minimal-ui', 'window-controls-overlay'].some((m) => matchMedia(`(display-mode: ${m})`).matches) || navigator.standalone === true;
  const installHow = () => {
    const ua = navigator.userAgent;
    if (G.isApp()) return 'You are playing the installed game. To put it on another computer or phone, open <b>guatermelon.com/roadster</b> there and sign in.';
    if (installEvt) return 'Installs Roadster Thruster as an app with its own window and icon. Sign in there once and everything is unlocked.';
    if (/iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return 'On iPhone or iPad: open this page in <b>Safari</b>, tap <b>Share</b>, then <b>Add to Home Screen</b>.';
    if (/Android/.test(ua)) return 'On Android: open the browser menu <b>&#8942;</b> and tap <b>Install app</b> (or <b>Add to Home screen</b>).';
    if (/Firefox\//.test(ua)) return 'Firefox can’t install web games: open <b>guatermelon.com/roadster</b> in <b>Chrome</b> or <b>Edge</b> and install it from there.';
    if (/Safari\//.test(ua) && !/Chrome|Chromium|Edg\//.test(ua)) return 'In Safari: <b>File</b> &rarr; <b>Add to Dock</b>.';
    return 'Already installed? Open <b>Roadster Thruster</b> from your apps. If not: click the <b>install</b> icon at the right of the address bar, or open the browser menu <b>&#8942;</b> &rarr; <b>Cast, save and share</b> &rarr; <b>Install page as app</b>.';
  };
  // the installed app opens in a small window the first time: make it as big as the screen
  if (G.isApp() && !matchMedia('(display-mode: fullscreen)').matches && window.outerWidth < screen.availWidth * 0.75) {
    try { window.moveTo(screen.availLeft || 0, screen.availTop || 0); window.resizeTo(screen.availWidth, screen.availHeight); } catch (e) { /* not allowed here */ }
  }

  const form = () => [$('acct-email').value.trim(), $('acct-pw').value];
  const go = async (fn, okMsg) => {
    if (busy) return;
    busy = true; status('…');
    try { await fn(); status(okMsg || ''); }
    catch (e) { status(e.message === 'Failed to fetch' || e.name === 'AbortError' ? 'Can’t reach the server. Check your connection.' : e.message, true); }
    finally { busy = false; G.drawAcct(); }
  };

  // after PayPal sends the player back (?paid=1), ask every few seconds until the payment shows up
  G.waitForPayment = () => {
    clearInterval(poll);
    const t0 = Date.now();
    status('Waiting for PayPal to confirm the payment…');
    poll = setInterval(async () => {
      const a = await G.acct.refresh();
      if (a && a.full) { clearInterval(poll); status('Payment received. Thank you! Everything is unlocked.'); G.drawAcct(); }
      else if (Date.now() - t0 > 180000) { clearInterval(poll); status('PayPal hasn’t confirmed yet. It can take a few minutes: tap CHECK AGAIN later.', true); }
    }, 4000);
  };

  // installable app (PWA): the browser offers it, we keep the prompt for the INSTALL button
  let installEvt = null;
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; if (G.drawAcct) G.drawAcct(); });
  window.addEventListener('appinstalled', () => { installEvt = null; G.drawAcct(); });
  G.canInstall = () => !!installEvt;

  G.wireAcct = (game) => {
    const click = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', (e) => { G.audio.init(); G.audio.tone(700, 0.05, 0.08, 'triangle'); fn(e); }); };
    click('btn-getfull', () => { G.drawAcct(); status(''); game.showPanel('acct'); });
    click('acct-login', () => go(() => G.acct.login(...form()), 'Signed in.'));
    click('acct-signup', () => go(() => G.acct.signup(...form()), 'Account created.'));
    // typing an email must not drive the car or toggle fullscreen
    for (const id of ['acct-email', 'acct-pw']) $(id).addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter' && id === 'acct-pw') $('acct-login').click(); });
    click('acct-logout', () => go(() => G.acct.logout(), 'Signed out.'));
    click('acct-check', () => go(async () => { const a = await G.acct.refresh(); if (!a || !a.full) throw new Error('No payment on this account yet. PayPal can take a few minutes.'); }, 'Everything is unlocked.'));
    click('acct-buy', () => go(async () => {
      const url = await G.acct.buy();
      // a new tab keeps the game open; when PayPal sends you back, this tab notices on focus
      const w = window.open(url, '_blank');
      if (w) w.opener = null; else location.href = url;
      G.waitForPayment();
    }));
    const install = async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => null); installEvt = null; G.drawAcct(); };
    click('acct-install', install);
    click('acct-get-btn', () => { if (installEvt) install(); else { $('acct-get-how').classList.add('flash'); setTimeout(() => $('acct-get-how').classList.remove('flash'), 700); } });
    // another device saved newer settings or progress: reload to use them, once the player is back in the menu
    let reloadWanted = false;
    G.onCloudLoad = () => { reloadWanted = true; };
    setInterval(() => {
      if (!reloadWanted || game.state !== 'menu') return;
      try { sessionStorage.setItem('rt-cloud', '1'); } catch (e) { /* ok */ }
      location.reload();
    }, 800);
    try { if (sessionStorage.getItem('rt-cloud')) { sessionStorage.removeItem('rt-cloud'); setTimeout(() => game.toast && game.toast('SAVE LOADED FROM YOUR ACCOUNT'), 1200); } } catch (e) { /* ok */ }
    window.addEventListener('focus', () => { if (G.acctToken() && !G.isFull()) G.acct.refresh(); });

    const qs = new URLSearchParams(location.search);
    if (qs.has('paid')) {
      history.replaceState(null, '', location.pathname);
      if (qs.get('paid') === '1') { game.showPanel('acct'); G.drawAcct(); G.waitForPayment(); }
    } else G.acct.refresh();
    G.drawAcct();
  };
})();
