// ghost.js — record the player's obstacle-course run and replay saved runs as see-through cars
(function () {
  const T = THREE;
  const STEP = 0.1;      // seconds between recorded frames
  const N = 8;           // numbers per frame: t, x, y, z, qx, qy, qz, qw
  const OPACITY = 0.35;
  const KINDS = { mine: { color: 0x2ad4ff, label: 'YOUR BEST' }, other: { color: 0xff9a1f, label: '' } };

  // ---------- recording ----------
  class GhostRecorder {
    constructor() { this.data = []; this.next = 0; }
    reset() { this.data.length = 0; this.next = 0; }
    sample(t, p) {
      if (t < this.next) return;
      this.next = t + STEP;
      const r2 = (v) => Math.round(v * 100) / 100, r3 = (v) => Math.round(v * 1000) / 1000;
      this.data.push(r2(t), r2(p.pos.x), r2(p.pos.y), r2(p.pos.z), r3(p.q.x), r3(p.q.y), r3(p.q.z), r3(p.q.w));
    }
  }

  function tag(text, color) {
    const tex = G.canvasTexture(256, 64, (ctx, w, h) => {
      ctx.font = '700 30px Orbitron, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.strokeText(text, w / 2, h / 2);
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.fillText(text, w / 2, h / 2);
    });
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false }));
    sp.scale.set(3.2, 0.8, 1); sp.position.y = 2.4;
    return sp;
  }

  // ---------- playback ----------
  class GhostCar {
    constructor(game, kind, run) {
      const k = KINDS[kind];
      this.f = run.frames; this.n = this.f.length / N; this.i = 0;
      this.name = run.name; this.kind = kind;
      this.model = G.buildRoadster(k.color, { shadows: false });
      const g = (this.group = this.model.group);
      // every material its own see-through copy, tinted toward the ghost's colour
      const tint = new T.Color(k.color);
      g.traverse((o) => {
        if (!o.isMesh || !o.material) return;
        o.castShadow = false; o.receiveShadow = false;
        const own = (m) => {
          const c = m.clone();
          c.transparent = true; c.opacity = OPACITY * (m.opacity ?? 1); c.depthWrite = false;
          if (c.color && !c.isShaderMaterial) c.color.lerp(tint, 0.35);
          return c;
        };
        o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material);
      });
      for (const w of this.model.wheels) w.pivot.position.y = 0.25;
      this.label = tag(k.label || run.name, k.color);
      g.add(this.label);
      g.visible = false;
      game.scene.add(g);
      this.game = game;
      this._qa = new T.Quaternion(); this._qb = new T.Quaternion();
    }
    // pose at race time t (seconds); hidden once the run is over
    update(t, dt) {
      const f = this.f, n = this.n, g = this.group;
      if (t > f[(n - 1) * N] + 0.5) { g.visible = false; return; }
      g.visible = true;
      if (t < f[this.i * N]) this.i = 0;
      while (this.i < n - 2 && f[(this.i + 1) * N] <= t) this.i++;
      const a = this.i * N, b = Math.min(n - 1, this.i + 1) * N;
      const span = f[b] - f[a];
      const k = span > 0 ? G.clamp((t - f[a]) / span, 0, 1) : 0;
      g.position.set(G.lerp(f[a + 1], f[b + 1], k), G.lerp(f[a + 2], f[b + 2], k), G.lerp(f[a + 3], f[b + 3], k));
      g.quaternion.copy(this._qa.set(f[a + 4], f[a + 5], f[a + 6], f[a + 7]).normalize()).slerp(this._qb.set(f[b + 4], f[b + 5], f[b + 6], f[b + 7]).normalize(), k);
      const sp = span > 0 ? Math.hypot(f[b + 1] - f[a + 1], f[b + 3] - f[a + 3]) / span : 0;
      for (const w of this.model.wheels) w.spin.rotation.x -= sp * dt / 0.36;
    }
    dispose() {
      this.game.scene.remove(this.group);
      this.group.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose()); });
      this.label.material.map.dispose();
    }
  }

  // the set shown in one run: at most your own best and the best by someone else
  class Ghosts {
    constructor(game) { this.game = game; this.cars = []; this.req = 0; }
    async load(track) {
      const req = ++this.req;
      this.clear();
      let res;
      try { res = await G.api.ghosts(track); } catch (e) { return; } // offline: race without ghosts
      if (req !== this.req) return; // a newer run started meanwhile
      for (const kind of ['mine', 'other']) {
        const run = res[kind];
        if (run && Array.isArray(run.frames) && run.frames.length >= N * 2) this.cars.push(new GhostCar(this.game, kind, run));
      }
    }
    update(t, dt) { for (const c of this.cars) c.update(t, dt); }
    clear() { for (const c of this.cars) c.dispose(); this.cars.length = 0; }
    dispose() { this.req++; this.clear(); }
  }

  G.GhostRecorder = GhostRecorder;
  G.Ghosts = Ghosts;
})();
