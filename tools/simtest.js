// dev-only: headless-ish race simulation for tuning the AI rivals (never deployed)
(function () {
  const ready = () => new Promise((r) => { const c = () => (window.G && G.game && G.game.state && G.game.state !== 'loading') ? r() : setTimeout(c, 200); c(); });
  window.simStart = async (traffic = 'heavy', rivals = 5) => {
    await ready();
    const g = G.game; g.renderer.setAnimationLoop(null);
    g.settings.traffic = traffic; g.settings.rivals = rivals;
    g.startRace('race');
    window.__simT = performance.now();
    simRun(4.5);
    return g.state;
  };
  window.simRun = (secs, ctrl) => {
    const g = G.game, rend = g.render; g.render = () => {};
    const R = g.rivals, st = R ? R.list.map(() => ({ v: 0, n: 0, hits: 0, resets: 0, latErr: 0, ds: 0 })) : [];
    const oh = g.onRivalHit; g.onRivalHit = (r, h) => { if (h > 6) st[r.i].hits++; };
    const orr = R && R.reset; if (R) R.reset = (r) => { st[r.i].resets++; orr.call(R, r); };
    const s0 = R ? R.list.map((r) => r.s) : [];
    const n = Math.round(secs * 60);
    for (let i = 0; i < n; i++) {
      if (ctrl) ctrl(g, i);
      window.__simT += 16.7; g.frame(window.__simT);
      if (R) for (const r of R.list) { const s = st[r.i]; s.v += r.v; s.n++; s.latErr += Math.abs(r.b.near.lat - r.latT); }
    }
    g.render = rend; g.onRivalHit = oh; if (R) R.reset = orr;
    return st.map((s, i) => ({ v: Math.round(s.v / s.n), avg: Math.round((R.list[i].s - s0[i]) / secs), latErr: +(s.latErr / s.n).toFixed(1), hits: s.hits, resets: s.resets }));
  };
})();
