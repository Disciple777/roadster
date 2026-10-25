// util.js — shared helpers, procedural textures
window.G = window.G || {};
(function () {
  const T = THREE;

  G.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  G.lerp = (a, b, t) => a + (b - a) * t;
  G.damp = (a, b, k, dt) => a + (b - a) * (1 - Math.exp(-k * dt));
  G.rand = (a = 0, b = 1) => a + Math.random() * (b - a);
  G.pick = (arr) => arr[(Math.random() * arr.length) | 0];
  G.wrap = (s, L) => ((s % L) + L) % L;
  G.angDiff = (a, b) => {
    const d = b - a;
    if (!Number.isFinite(d)) return 0; // never spin forever on a blown-up value
    return d - Math.PI * 2 * Math.round(d / (Math.PI * 2));
  };
  G.dampAngle = (a, b, k, dt) => a + G.angDiff(a, b) * (1 - Math.exp(-k * dt));

  // deterministic RNG (mulberry32) so the city looks the same every load
  G.rng = function (seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };

  G.isTouch = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
  G.isMobile = G.isTouch && Math.min(screen.width, screen.height) < 900;

  G.store = {
    get(k, d) { try { const v = localStorage.getItem('rt_' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('rt_' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
  };

  G.canvasTexture = function (w, h, draw, { srgb = true, repeat = false } = {}) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    draw(ctx, w, h);
    const tex = new T.CanvasTexture(c);
    if (srgb) tex.colorSpace = T.SRGBColorSpace;
    if (repeat) tex.wrapS = tex.wrapT = T.RepeatWrapping;
    tex.anisotropy = G.maxAniso || 4;
    return tex;
  };

  G.softSprite = function () {
    return G.canvasTexture(64, 64, (ctx, w, h) => {
      const g = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
    });
  };

  // billowy cloud puff for steam
  G.puffTexture = function () {
    const r = G.rng(7);
    return G.canvasTexture(128, 128, (ctx, w, h) => {
      for (let i = 0; i < 34; i++) {
        const a = r() * Math.PI * 2, d = r() * 30;
        const x = w / 2 + Math.cos(a) * d, y = h / 2 + Math.sin(a) * d;
        const rad = 14 + r() * 26;
        const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
        const b = 200 + (r() * 55) | 0;
        g.addColorStop(0, `rgba(${b},${b},${b},0.35)`);
        g.addColorStop(1, `rgba(${b},${b},${b},0)`);
        ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
      }
      ctx.globalCompositeOperation = 'destination-in';
      const m = ctx.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2);
      m.addColorStop(0, 'rgba(0,0,0,1)');
      m.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = m; ctx.fillRect(0, 0, w, h);
    }, { srgb: false });
  };

  G.blobShadowTexture = function () {
    return G.canvasTexture(64, 128, (ctx, w, h) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
      const g = ctx.createRadialGradient(w / 2, h / 2, 4, w / 2, h / 2, w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.save(); ctx.scale(1, 2); ctx.fillStyle = g; ctx.fillRect(0, 0, w, h / 2); ctx.restore();
    }, { srgb: false });
  };

  G.fmtTime = function (t) {
    if (!isFinite(t)) return '--:--.--';
    const m = Math.floor(t / 60), s = t - m * 60;
    return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2);
  };
})();
