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

  const keep = (r) => { const a = { token: r.token || G.acctToken(), email: r.account.email, full: !!r.account.full }; put(a); return a; };
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
    if (inst) inst.classList.toggle('hidden', !G.canInstall());
  };

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
    click('acct-install', async () => { if (!installEvt) return; installEvt.prompt(); await installEvt.userChoice.catch(() => null); installEvt = null; G.drawAcct(); });
    window.addEventListener('focus', () => { if (G.acctToken() && !G.isFull()) G.acct.refresh(); });

    const qs = new URLSearchParams(location.search);
    if (qs.has('paid')) {
      history.replaceState(null, '', location.pathname);
      if (qs.get('paid') === '1') { game.showPanel('acct'); G.drawAcct(); G.waitForPayment(); }
    } else G.acct.refresh();
    G.drawAcct();
  };
})();
