// challenge.js — STUNT CHALLENGE: fifteen hand-built stunt levels in three acts (rooftops, yards, avenues, garages,
// loops, beams, crushers, a skyline), each its own little world with its own sky and light, built when the level loads.
// One run = the levels back to back on shared lives; each level has a fixed N₂ budget (no recharge).
// How runs are cut is set in RUN below: one 15-level run, or three 5-level courses, each with its own leaderboard.
(function () {
  const T = THREE;
  const $ = (id) => document.getElementById(id);

  // ---------------------------------------------------------------- times of day
  const TODS = {
    night: G.TOD.night,
    sunset: Object.assign({}, G.TOD.sunset, { fogDensity: 0.0012 }),
    day: {
      zenith: 0x3a6fb8, horizon: 0xbfd3e6, glow: 0xe8eef5, fog: 0xa9bccd, fogDensity: 0.0016,
      hemiSky: 0xcfe3ff, hemiGround: 0x5a5048, hemi: 1.1, moon: 0xfff1dc, moonI: 3.2,
      sunDir: [0.5, 0.75, 0.35], env: 1.0, litRatio: 0.05, win: 0.15, stars: 0, exposure: 0.85,
    },
    dusk: {
      zenith: 0x101a3a, horizon: 0xd06a4a, glow: 0xff9a60, fog: 0x4a4058, fogDensity: 0.0024,
      hemiSky: 0x9a88b0, hemiGround: 0x201a22, hemi: 0.8, moon: 0xffa070, moonI: 1.6,
      sunDir: [-0.7, 0.08, -0.7], env: 0.7, litRatio: 0.3, win: 1.1, stars: 0, exposure: 1.0,
    },
  };
  TODS.nightRoof = Object.assign({}, G.TOD.night, { fogDensity: 0.0011 });

  // ---------------------------------------------------------------- procedural textures (built once, shared)
  const TX = {};
  const noiseFill = (ctx, W, H, R, n, base, spread, a, sz = 2) => {
    for (let i = 0; i < n; i++) { const g = base + (R() - 0.5) * spread | 0; ctx.fillStyle = `rgba(${g},${g},${g},${a})`; ctx.fillRect(R() * W, R() * H, sz, sz); }
  };
  const blotches = (ctx, W, H, R, n, dark, a) => {
    for (let i = 0; i < n; i++) {
      const x = R() * W, y = R() * H, r = 20 + R() * 90, gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      const c = dark ? '0,0,0' : '255,255,255';
      gr.addColorStop(0, `rgba(${c},${a * R()})`); gr.addColorStop(1, `rgba(${c},0)`);
      ctx.fillStyle = gr; ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  };
  function textures() {
    if (TX.ready) return TX;
    const R = G.rng(777);
    TX.concrete = G.canvasTexture(512, 512, (ctx, W, H) => {
      ctx.fillStyle = '#8f8c86'; ctx.fillRect(0, 0, W, H);
      blotches(ctx, W, H, R, 40, true, 0.12); blotches(ctx, W, H, R, 25, false, 0.08);
      noiseFill(ctx, W, H, R, 26000, 140, 70, 0.35, 2);
      ctx.strokeStyle = 'rgba(40,38,34,0.35)'; ctx.lineWidth = 1;
      for (let i = 0; i < 7; i++) { ctx.beginPath(); let x = R() * W, y = R() * H; ctx.moveTo(x, y); for (let k = 0; k < 8; k++) { x += (R() - 0.5) * 50; y += (R() - 0.5) * 50; ctx.lineTo(x, y); } ctx.stroke(); }
      ctx.fillStyle = 'rgba(30,30,30,0.5)'; ctx.fillRect(0, 0, W, 2); ctx.fillRect(0, 0, 2, H); // slab joints
    }, { repeat: true });
    TX.asphalt = G.canvasTexture(512, 512, (ctx, W, H) => {
      ctx.fillStyle = '#2b2c2f'; ctx.fillRect(0, 0, W, H);
      blotches(ctx, W, H, R, 30, true, 0.25); blotches(ctx, W, H, R, 14, false, 0.05);
      noiseFill(ctx, W, H, R, 40000, 60, 60, 0.55, 2);
      noiseFill(ctx, W, H, R, 3000, 120, 40, 0.4, 1);
    }, { repeat: true });
    TX.roof = G.canvasTexture(512, 512, (ctx, W, H) => {
      ctx.fillStyle = '#9d9b96'; ctx.fillRect(0, 0, W, H);
      blotches(ctx, W, H, R, 30, true, 0.18);
      noiseFill(ctx, W, H, R, 20000, 150, 50, 0.3, 2);
      ctx.fillStyle = 'rgba(60,58,55,0.45)';
      for (let y = 0; y < H; y += 128) ctx.fillRect(0, y, W, 3); // membrane sheet seams
      for (let x = 0; x < W; x += 256) for (let y = 0; y < H; y += 128) ctx.fillRect(x + ((y / 128) % 2) * 128, y, 3, 128);
    }, { repeat: true });
    TX.corr = G.canvasTexture(256, 256, (ctx, W, H) => {
      for (let x = 0; x < W; x++) { const v = 150 + 70 * Math.sin((x / W) * Math.PI * 2 * 12) | 0; ctx.fillStyle = `rgb(${v},${v},${v})`; ctx.fillRect(x, 0, 1, H); }
      blotches(ctx, W, H, R, 20, true, 0.25);
      ctx.fillStyle = 'rgba(90,50,20,0.25)'; for (let i = 0; i < 400; i++) ctx.fillRect(R() * W, R() * H, 1 + R() * 3, 2 + R() * 10); // rust streaks
    }, { repeat: true });
    TX.plate = G.canvasTexture(256, 256, (ctx, W, H) => {
      ctx.fillStyle = '#7d8084'; ctx.fillRect(0, 0, W, H);
      noiseFill(ctx, W, H, R, 8000, 130, 40, 0.3, 2);
      for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
        const cx = x * 32 + (y % 2) * 16 + 8, cy = y * 32 + 16;
        ctx.save(); ctx.translate(cx, cy); ctx.rotate((y % 2 ? 1 : -1) * 0.7);
        ctx.fillStyle = 'rgba(220,222,226,0.7)'; ctx.fillRect(-9, -2, 18, 4);
        ctx.fillStyle = 'rgba(30,30,30,0.6)'; ctx.fillRect(-9, 2, 18, 2);
        ctx.restore();
      }
    }, { repeat: true });
    TX.hazard = G.canvasTexture(128, 128, (ctx, W, H) => {
      ctx.fillStyle = '#e8b81a'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#151515';
      for (let k = -2; k < 4; k++) { ctx.beginPath(); ctx.moveTo(k * 64, H); ctx.lineTo(k * 64 + 32, H); ctx.lineTo(k * 64 + 32 + H, 0); ctx.lineTo(k * 64 + H, 0); ctx.fill(); }
      noiseFill(ctx, W, H, R, 1500, 120, 80, 0.25, 2);
    }, { repeat: true });
    TX.checker = G.canvasTexture(256, 64, (ctx, W, H) => {
      for (let y = 0; y < 2; y++) for (let x = 0; x < 8; x++) { ctx.fillStyle = (x + y) % 2 ? '#111' : '#eee'; ctx.fillRect(x * 32, y * 32, 32, 32); }
    });
    TX.stop = G.canvasTexture(512, 512, (ctx, W, H) => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,214,40,0.95)'; ctx.lineWidth = 22; ctx.strokeRect(14, 14, W - 28, H - 28);
      ctx.setLineDash([40, 30]); ctx.lineWidth = 8; ctx.strokeRect(60, 60, W - 120, H - 120); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.92)'; ctx.font = 'bold 150px Orbitron, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('STOP', W / 2, H / 2);
    });
    TX.heli = G.canvasTexture(512, 512, (ctx, W, H) => {
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.lineWidth = 18; ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 24, 0, Math.PI * 2); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,210,40,0.9)'; ctx.lineWidth = 8; ctx.beginPath(); ctx.arc(W / 2, H / 2, W / 2 - 52, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.font = 'bold 260px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('H', W / 2, H / 2 + 10);
    });
    TX.pool = G.canvasTexture(128, 128, (ctx, W, H) => {
      const gr = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, W / 2);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    });
    TX.lines = G.canvasTexture(256, 256, (ctx, W, H) => { // parking bay lines
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(240,240,235,0.85)'; ctx.fillRect(0, 0, 8, H); ctx.fillRect(0, H - 8, W, 8);
    }, { repeat: true });
    TX.ready = true;
    return TX;
  }
  // a banner with text on it ("MIN 150 KM/H")
  const banner = (text, bg = '#141820', fg = '#ffffff', edge = '#ff2a3c') => G.canvasTexture(1024, 160, (ctx, W, H) => {
    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = edge; ctx.fillRect(0, 0, W, 10); ctx.fillRect(0, H - 10, W, 10);
    let fs = 92; ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    do { ctx.font = `bold ${fs}px Orbitron, Arial`; fs -= 4; } while (fs > 30 && ctx.measureText(text).width > W - 60);
    ctx.fillText(text, W / 2, H / 2 + 4);
  });

  // a box whose UVs are in metres / tile (so textures keep their scale on any size)
  function uvBox(w, h, d, tile = 4) {
    const g = new T.BoxGeometry(w, h, d), uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) { const i = f * 4 + k; uv.setXY(i, uv.getX(i) * dims[f][0] / tile, uv.getY(i) * dims[f][1] / tile); }
    return g;
  }

  // ---------------------------------------------------------------- the world of one level
  const CELL = 16;
  const ckey = (cx, cz) => (cx + 1000) * 4000 + (cz + 1000);

  class World {
    constructor(game, level) {
      this.game = game; this.level = level;
      this.Q = game.Q;
      this.tod = TODS[level.tod] || TODS.night;
      this.root = new T.Group();
      this.solids = []; this.grid = new Map();
      this.batches = new Map(); // material -> [geometries]
      this.facades = []; // instanced building boxes
      this.anim = []; // per-frame callbacks (fire, LEDs)
      this.disposables = [];
      this.loops = []; this.coins = []; this.movers = []; this._buf = [];
      this.R = G.rng(level.seed || 99);
      this.tx = textures();
      this.mats();
    }

    // ---------- materials ----------
    mats() {
      const tx = this.tx, M = (o) => { const m = new T.MeshStandardMaterial(o); this.disposables.push(m); return m; };
      this.m = {
        concrete: M({ map: tx.concrete, bumpMap: tx.concrete, bumpScale: 1.2, roughness: 0.92 }),
        deck: M({ map: tx.concrete, bumpMap: tx.concrete, bumpScale: 1.0, roughness: 0.8, color: 0xb4b2ac }),
        asphalt: M({ map: tx.asphalt, bumpMap: tx.asphalt, bumpScale: 1.4, roughness: this.tod.stars ? 0.55 : 0.88, color: 0xd0d0d0 }),
        roof: M({ map: tx.roof, bumpMap: tx.roof, bumpScale: 0.8, roughness: 0.95 }),
        plate: M({ map: tx.plate, bumpMap: tx.plate, bumpScale: 2.0, roughness: 0.42, metalness: 0.75 }),
        hazard: M({ map: tx.hazard, roughness: 0.6 }),
        steel: M({ color: 0x2b2f34, roughness: 0.38, metalness: 0.85 }),
        galv: M({ color: 0x8c9196, roughness: 0.45, metalness: 0.8 }),
        cap: M({ map: tx.concrete, roughness: 0.85, color: 0xc9c5bc }),
        white: M({ color: 0xe8e8e4, roughness: 0.6 }),
        darkPaint: M({ color: 0x23262b, roughness: 0.5, metalness: 0.3 }),
        rubber: M({ color: 0x18191b, roughness: 0.9 }),
        ac: M({ color: 0xa7aaa8, roughness: 0.55, metalness: 0.5 }),
        tank: M({ color: 0x5a4636, roughness: 0.9 }),
        glassRail: new T.MeshPhysicalMaterial({ color: 0x9fc4d8, roughness: 0.05, metalness: 0, transmission: 0, transparent: true, opacity: 0.28, depthWrite: false }),
      };
      this.disposables.push(this.m.glassRail);
      this.m.cont = [0x8a2f22, 0x1f4f7a, 0x2f5f3a, 0xb5651d, 0x7a7d80, 0x6d2a4a].map((c) => M({ map: tx.corr, bumpMap: tx.corr, bumpScale: 2.5, color: c, roughness: 0.62, metalness: 0.35 }));
      const B = (c) => { const m = new T.MeshBasicMaterial({ color: c, toneMapped: false }); this.disposables.push(m); return m; };
      this.m.led = B(new T.Color(4, 0.25, 0.2)); this.m.ledW = B(new T.Color(3.2, 3.0, 2.6)); this.m.ledA = B(new T.Color(4, 2.2, 0.4));
      this.m.beacon = B(new T.Color(5, 0.15, 0.1)); this.m.tube = B(new T.Color(2.6, 2.8, 3.0));
    }

    // ---------- geometry helpers ----------
    add(mat, geo) { if (!this.batches.has(mat)) this.batches.set(mat, []); this.batches.get(mat).push(geo); }
    solid(s) {
      s.c = s.c ?? 1; s.s = s.s ?? 0;
      this.solids.push(s);
      const r = Math.hypot(s.hw, s.hl) + 3;
      for (let cx = Math.floor((s.x - r) / CELL); cx <= Math.floor((s.x + r) / CELL); cx++) for (let cz = Math.floor((s.z - r) / CELL); cz <= Math.floor((s.z + r) / CELL); cz++) {
        const k = ckey(cx, cz); if (!this.grid.has(k)) this.grid.set(k, []); this.grid.get(k).push(s);
      }
      return s;
    }
    // a box standing on y0; yaw turns it about its centre
    box(mat, x, y0, z, w, h, d, o = {}) {
      const g = uvBox(w, h, d, o.tile || 4);
      g.rotateY(o.yaw || 0); g.translate(x, y0 + h / 2, z);
      this.add(mat, g);
      if (o.solid !== false) this.solid({ x, z, c: Math.cos(o.yaw || 0), s: Math.sin(o.yaw || 0), hw: w / 2, hl: d / 2, y0, y1: y0 + h });
    }
    // a ramp along z: height yA at zA, yB at zB (straight slope), standing on 'base'
    ramp(mat, x, w, zA, yA, zB, yB, base = 0, o = {}) {
      const zc = (zA + zB) / 2, hl = Math.abs(zA - zB) / 2;
      const yN = zA > zB ? yA : yB, yF = zA > zB ? yB : yA; // N: the +z end, F: the -z end
      const g = uvBox(w, 1, hl * 2, o.tile || 3), p = g.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const lz = p.getZ(i), t = (hl - lz) / (2 * hl);
        p.setY(i, p.getY(i) > 0 ? yN + (yF - yN) * t : base);
      }
      g.computeVertexNormals(); g.translate(x, 0, zc);
      this.add(mat, g);
      // hazard edging down both sides of the deck
      if (o.edges !== false) for (const sx of [-1, 1]) {
        const e = new T.BoxGeometry(0.25, 0.06, hl * 2, 1, 1, 1), ep = e.attributes.position;
        for (let i = 0; i < ep.count; i++) { const lz = ep.getZ(i), t = (hl - lz) / (2 * hl); ep.setY(i, ep.getY(i) + yN + (yF - yN) * t + 0.03); }
        const uv = e.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.25, uv.getY(i) * hl * 2);
        e.computeVertexNormals(); e.translate(x + sx * (w / 2 - 0.125), 0, zc);
        this.add(this.m.hazard, e);
      }
      this.solid({ x, z: zc, hw: w / 2, hl, y0: base, y1: Math.max(yN, yF), wedge: true, yN, yF });
    }
    // a flat textured decal lying on a surface (painted markings)
    decal(tex, x, y, z, w, d, yaw = 0, o = {}) {
      const m = new T.MeshStandardMaterial({ map: tex, transparent: true, depthWrite: false, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, ...o });
      this.disposables.push(m);
      const mesh = new T.Mesh(new T.PlaneGeometry(w, d), m);
      mesh.rotation.set(-Math.PI / 2, 0, yaw); mesh.position.set(x, y + 0.03, z);
      mesh.receiveShadow = true;
      this.root.add(mesh);
      return mesh;
    }
    // a building: procedural facade on the sides, a membrane roof, optional parapets.
    // par: { n, s, e, w } each true (full wall) or a list of [from, to] openings (x for n/s, z for e/w)
    building(x, z, w, d, h, style = 0, o = {}) {
      this.facades.push({ x, z, w, d, h, style, seed: this.R() });
      this.solid({ x, z, hw: w / 2, hl: d / 2, y0: 0, y1: h });
      if (o.roof !== false) {
        const rg = new T.PlaneGeometry(w - 0.4, d - 0.4); rg.rotateX(-Math.PI / 2);
        const uv = rg.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (w - 0.4) / 6, uv.getY(i) * (d - 0.4) / 6);
        rg.translate(x, h + 0.04, z); this.add(o.roofMat || this.m.roof, rg);
      }
      const par = o.par, ph = o.ph || 1.15, t = 0.4;
      if (par) {
        const run = (axis, fixed, a, b, open) => {
          // walls from a..b along the axis, minus the openings
          const cuts = (open === true ? [] : open).slice().sort((p, q) => p[0] - q[0]);
          let s = a;
          for (const [c0, c1] of cuts.concat([[b, b]])) {
            const e = Math.min(c0, b);
            if (e - s > 0.2) {
              const L = e - s, mid = (s + e) / 2;
              if (axis === 'x') this.box(this.m.cap, mid, h, fixed, L, ph, t, { tile: 3 });
              else this.box(this.m.cap, fixed, h, mid, t, ph, L, { tile: 3 });
            }
            s = Math.max(s, c1);
          }
        };
        if (par.n) run('x', z - d / 2 + t / 2, x - w / 2, x + w / 2, par.n);
        if (par.s) run('x', z + d / 2 - t / 2, x - w / 2, x + w / 2, par.s);
        if (par.w) run('z', x - w / 2 + t / 2, z - d / 2 + t, z + d / 2 - t, par.w);
        if (par.e) run('z', x + w / 2 - t / 2, z - d / 2 + t, z + d / 2 - t, par.e);
      }
    }
    // rooftop clutter: AC units and vents scattered where free(x, z) allows
    roofProps(x, z, w, d, h, n, free) {
      const R = this.R;
      for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
        const px = x + (R() - 0.5) * (w - 4), pz = z + (R() - 0.5) * (d - 4);
        if (free && !free(px, pz)) continue;
        k++;
        const r = R();
        if (r < 0.55) { // condenser unit with a fan on top
          const sw = 1.6 + R() * 1.2, sd = 1.2 + R() * 1.0, sh = 1.0 + R() * 0.6;
          this.box(this.m.ac, px, h, pz, sw, sh, sd, { tile: 2 });
          const fan = new T.CylinderGeometry(Math.min(sw, sd) * 0.36, Math.min(sw, sd) * 0.36, 0.08, 18); fan.translate(px, h + sh + 0.04, pz); this.add(this.m.darkPaint, fan);
        } else if (r < 0.8) { // vent stack
          const c = new T.CylinderGeometry(0.35, 0.35, 1.8, 12); c.translate(px, h + 0.9, pz); this.add(this.m.galv, c);
          const cap = new T.CylinderGeometry(0.6, 0.6, 0.12, 12); cap.translate(px, h + 1.9, pz); this.add(this.m.galv, cap);
          this.solid({ x: px, z: pz, hw: 0.4, hl: 0.4, y0: h, y1: h + 1.9 });
        } else { // stair / lift housing
          const sw = 3.5 + R() * 2, sd = 3 + R() * 2;
          this.box(this.m.concrete, px, h, pz, sw, 3.2, sd, { tile: 4 });
          this.box(this.m.darkPaint, px, h + 3.2, pz, sw + 0.3, 0.25, sd + 0.3, { solid: false });
        }
      }
    }
    waterTank(x, z, h, s = 1.6) {
      const c = new T.CylinderGeometry(s, s, 2.6 * s / 1.6, 16); c.translate(x, h + 2.4 + 1.3 * s / 1.6, z); this.add(this.m.tank, c);
      const cone = new T.ConeGeometry(s * 1.06, 0.8, 16); cone.translate(x, h + 2.4 + 2.6 * s / 1.6 + 0.4, z); this.add(this.m.tank, cone);
      for (const [a, b] of [[-0.7, -0.7], [0.7, -0.7], [0.7, 0.7], [-0.7, 0.7]]) this.box(this.m.steel, x + a * s * 0.8, h, z + b * s * 0.8, 0.14, 2.4, 0.14, { solid: false });
      this.solid({ x, z, hw: s, hl: s, y0: h, y1: h + 5.5 });
    }
    // a billboard on two legs, its face lit at night
    billboard(x, z, h, yaw, text, col) {
      const W = 12, H = 4.5, c = Math.cos(yaw), s = Math.sin(yaw);
      for (const sx of [-3.5, 3.5]) this.box(this.m.steel, x + sx * c, h, z - sx * s, 0.3, 6, 0.3, { yaw });
      this.box(this.m.darkPaint, x, h + 6, z, W + 0.4, H + 0.4, 0.3, { yaw });
      const tex = banner(text, col || '#1b2a44', '#ffffff', '#ffd23a');
      const lit = this.tod.stars ? 1.6 : 1.0;
      const m = new T.MeshBasicMaterial({ map: tex, color: new T.Color(lit, lit, lit), toneMapped: !this.tod.stars });
      this.disposables.push(m, tex);
      const face = new T.Mesh(new T.PlaneGeometry(W, H), m);
      face.position.set(x + 0.17 * s, h + 6.2 + H / 2, z + 0.17 * c); face.rotation.y = yaw;
      this.root.add(face);
    }
    // street / flood light: pole, head, a glow, and a light pool on the ground (no real light: they're cheap)
    lamp(x, y, z, yaw = 0, hgt = 8, pool = true) {
      this.box(this.m.steel, x, y, z, 0.22, hgt, 0.22, { solid: true });
      const c = Math.cos(yaw), s = Math.sin(yaw);
      this.box(this.m.steel, x - 1.2 * s, y + hgt - 0.1, z - 1.2 * c, 0.14, 0.14, 2.4, { yaw, solid: false });
      const head = new T.BoxGeometry(0.5, 0.12, 1.0); head.rotateY(yaw); head.translate(x - 2.3 * s, y + hgt - 0.12, z - 2.3 * c);
      this.add(this.tod.stars || this.tod === TODS.dusk ? this.m.ledW : this.m.galv, head);
      if (pool && (this.tod.stars || this.tod === TODS.dusk)) {
        const p = this.decal(this.tx.pool, x - 2.3 * s, y, z - 2.3 * c, 13, 13, 0, { color: new T.Color(1.0, 0.86, 0.66).multiplyScalar(0.6), blending: T.AdditiveBlending, roughness: 1 });
        p.material = new T.MeshBasicMaterial({ map: this.tx.pool, color: new T.Color(1.0, 0.85, 0.62).multiplyScalar(0.55), transparent: true, depthWrite: false, blending: T.AdditiveBlending, polygonOffset: true, polygonOffsetFactor: -3 });
        this.disposables.push(p.material);
      }
    }
    // a parked car (one of the traffic models)
    parked(x, y, z, yaw, type) {
      const types = G.TRAFFIC_TYPES; if (!types) return;
      const tp = types[type != null ? type % types.length : (this.R() * 3) | 0];
      if (!this.carGeo) this.carGeo = new Map();
      let cg = this.carGeo.get(tp);
      if (!cg) {
        const b = [], l = [];
        tp.build(b, l);
        cg = { body: b.length ? ADDONS.mergeGeometries(b.map((g) => (g.index ? g.toNonIndexed() : g))) : null, lights: l.length ? ADDONS.mergeGeometries(l.map((g) => (g.index ? g.toNonIndexed() : g))) : null, list: [] };
        this.carGeo.set(tp, cg);
      }
      cg.list.push([x, y, z, yaw, [0xc8ccd2, 0x1c1e22, 0x7d1f22, 0x24456e, 0xe9e9e6, 0x5a5f66, 0x2f5a3c, 0xb88a2a, 0x8b8f96, 0x3d2a4f][(this.R() * 10) | 0]]);
      const c = Math.cos(yaw), s = Math.sin(yaw);
      this.solid({ x, z, c, s, hw: (tp.wid || 2) / 2, hl: (tp.len || 4.5) / 2, y0: y, y1: y + (tp.hgt || 1.5) });
    }
    // a shipping container (12 m, corrugated)
    container(x, y, z, yaw, ci) {
      const mat = this.m.cont[ci % this.m.cont.length];
      this.box(mat, x, y, z, 2.44, 2.6, 12.2, { yaw, tile: 2.4 });
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const e of [-6.12, 6.12]) { const g = new T.BoxGeometry(2.5, 2.66, 0.08); g.rotateY(yaw); g.translate(x + e * s, y + 1.33, z + e * c); this.add(this.m.darkPaint, g); }
    }
    // flood-light mast with a lamp bank (and a real light when asked)
    floodMast(x, z, h, yaw) {
      const c = new T.CylinderGeometry(0.25, 0.4, h, 10); c.translate(x, h / 2, z); this.add(this.m.galv, c);
      this.solid({ x, z, hw: 0.45, hl: 0.45, y0: 0, y1: h });
      const bank = new T.BoxGeometry(3.2, 1.2, 0.3); bank.rotateY(yaw); bank.translate(x, h, z); this.add(this.m.darkPaint, bank);
      const lens = new T.BoxGeometry(3.0, 1.0, 0.05); lens.translate(0, 0, 0.18); lens.rotateY(yaw); lens.translate(x, h, z); this.add(this.m.ledW, lens);
    }

    // ---------- set pieces ----------
    // a ring of fire you fly through; posts or cables hold it up
    fireRing(x, y, z, r, o = {}) {
      const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = o.yaw || 0;
      const torus = new T.Mesh(new T.TorusGeometry(r, 0.26, 14, 64), new T.MeshStandardMaterial({ color: 0x2a1a10, roughness: 0.4, metalness: 0.8, emissive: new T.Color(1.0, 0.35, 0.08), emissiveIntensity: 1.2 }));
      this.disposables.push(torus.material, torus.geometry);
      torus.castShadow = true; g.add(torus);
      // the burner jets around the ring
      const jets = new T.InstancedMesh(new T.CylinderGeometry(0.12, 0.16, 0.5, 8), this.m.steel, 16);
      const m4 = new T.Matrix4(), qq = new T.Quaternion(), sc = new T.Vector3(1, 1, 1), ps = new T.Vector3();
      for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; ps.set(Math.cos(a) * (r + 0.3), Math.sin(a) * (r + 0.3), 0); qq.setFromAxisAngle(new T.Vector3(0, 0, 1), a - Math.PI / 2); jets.setMatrixAt(i, m4.compose(ps, qq, sc)); }
      g.add(jets);
      this.root.add(g);
      const light = new T.PointLight(0xff7a2a, 260, 50, 1.6); light.position.set(x, y, z); this.root.add(light);
      const fire = new G.Particles(this.root, 900, { texture: G.puffTexture(), additive: true, color: new T.Color(1.7, 0.62, 0.16) });
      const smoke = new G.Particles(this.root, 260, { texture: G.puffTexture(), color: new T.Color(0.12, 0.11, 0.1) });
      this.parts = (this.parts || []).concat([fire, smoke]);
      const yaw = o.yaw || 0, cy = Math.cos(yaw), sy = Math.sin(yaw);
      let tt = 0, acc = 0;
      this.anim.push((dt) => {
        tt += dt; acc += dt;
        const fl = 0.8 + 0.25 * Math.sin(tt * 23) + 0.15 * Math.sin(tt * 37.1);
        light.intensity = 230 * fl; torus.material.emissiveIntensity = 1.0 + 0.6 * fl;
        while (acc > 1 / 60) {
          acc -= 1 / 60;
          for (let k = 0; k < 9; k++) {
            const a = Math.random() * Math.PI * 2, lx = Math.cos(a) * r, ly = Math.sin(a) * r, lz = (Math.random() - 0.5) * 0.4;
            fire.emit(x + lx * cy + lz * sy, y + ly, z - lx * sy + lz * cy, (Math.random() - 0.5) * 1.2, 2.2 + Math.random() * 2.5, (Math.random() - 0.5) * 1.2,
              0.45 + Math.random() * 0.4, 0.7 + Math.random() * 0.4, 0.15, 0.85, { drag: 1.2, buoy: 3.5, spin: 3 });
          }
          if (Math.random() < 0.5) {
            const a = Math.random() * Math.PI, lx = Math.cos(a) * r, ly = Math.sin(a) * r;
            smoke.emit(x + lx * cy, y + ly + 0.8, z - lx * sy, 0, 2.5, 0, 2.2, 1.0, 4.0, 0.35, { drag: 0.6, buoy: 1.4 });
          }
        }
        fire.update(dt); smoke.update(dt);
      });
      // supports
      if (o.posts) {
        const px = r + 1.6, top = y + r + 1.2;
        for (const sx of [-1, 1]) this.box(this.m.steel, x + sx * px * cy, o.base || 0, z - sx * px * sy, 0.5, top - (o.base || 0), 0.5, { yaw });
        this.box(this.m.steel, x, top, z, px * 2 + 0.5, 0.45, 0.45, { yaw, solid: false });
        for (const sx of [-1, 1]) { const ch = new T.CylinderGeometry(0.04, 0.04, top - (y + r), 6); ch.translate(x + sx * 0.6 * cy, (top + y + r) / 2, z - sx * 0.6 * sy); this.add(this.m.steel, ch); }
      }
      if (o.cables) for (const [ax, ay, az] of o.cables) {
        const a = new T.Vector3(x, y + r, z), b = new T.Vector3(ax, ay, az), L = a.distanceTo(b);
        const cg = new T.CylinderGeometry(0.05, 0.05, L, 6); cg.translate(0, L / 2, 0);
        cg.applyMatrix4(new T.Matrix4().makeRotationFromQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), b.clone().sub(a).normalize())));
        cg.translate(a.x, a.y, a.z); this.add(this.m.steel, cg);
      }
      return { torus };
    }
    // a speed gate: two pillars, a banner and LED strips that go green once you're fast enough
    speedGate(x, y, z, hw, min, o = {}) {
      const h = o.h || 6.5;
      if (!o.noPillars) for (const sx of [-1, 1]) this.box(this.m.darkPaint, x + sx * (hw + 0.4), y, z, 0.8, h, 0.8);
      const tex = banner(`MIN ${min} KM/H`); this.disposables.push(tex);
      const bm = new T.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new T.Color(0.9, 0.9, 0.9), roughness: 0.5 });
      this.disposables.push(bm);
      const bw = Math.max(hw * 2 + 1.6, 7), bannerMesh = new T.Mesh(new T.BoxGeometry(bw, bw / 6.4, 0.3), bm);
      bannerMesh.position.set(x, y + h + bw / 12.8, z); this.root.add(bannerMesh);
      const ledM = new T.MeshBasicMaterial({ color: new T.Color(4, 0.3, 0.2), toneMapped: false }); this.disposables.push(ledM);
      for (const sx of [-1, 1]) { const s = new T.Mesh(new T.BoxGeometry(0.12, h - 0.4, 0.84), ledM); s.position.set(x + sx * (hw + 0.02), y + h / 2, z); this.root.add(s); }
      const strip = new T.Mesh(new T.BoxGeometry(hw * 2, 0.12, 0.6), ledM); strip.position.set(x, y + 0.02, z); this.root.add(strip);
      return { ledM };
    }
    // a 360° loop standing on y0, entered heading -z at (x, z); it drifts 'shift' metres sideways so it clears itself
    loop(x, y0, z, R = 9, w = 6, shift = 7.5) {
      const lp = { id: this.loops.length, x, z, y0, R, w, shift, tx: 0, tz: -1, rx: 1, rz: 0 };
      this.loops.push(lp);
      const N = 140, P = new T.Vector3(), pos = [], uv = [], idx = [], edges = [[], []];
      for (let i = 0; i <= N; i++) {
        this.loopPoint(lp, (i / N) * Math.PI * 2, P);
        for (let e = 0; e < 2; e++) {
          const o = (e ? 1 : -1) * w / 2, v = new T.Vector3(P.x + o, P.y + 0.03, P.z);
          pos.push(v.x, v.y, v.z); uv.push(e * w / 3, (i / N) * Math.PI * 2 * R / 3);
          edges[e].push(v);
        }
        if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const rg = new T.BufferGeometry();
      rg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); rg.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); rg.setIndex(idx); rg.computeVertexNormals();
      if (!this.m.loopDeck) {
        this.m.loopDeck = new T.MeshStandardMaterial({ map: this.tx.plate, bumpMap: this.tx.plate, bumpScale: 1.5, color: 0x9aa0a8, roughness: 0.4, metalness: 0.8, side: T.DoubleSide });
        this.m.loopRail = new T.MeshBasicMaterial({ color: new T.Color(0.5, 2.4, 3.4), toneMapped: false });
        this.disposables.push(this.m.loopDeck, this.m.loopRail);
      }
      const ribbon = new T.Mesh(rg, this.m.loopDeck); ribbon.castShadow = ribbon.receiveShadow = !!this.Q.shadows;
      this.root.add(ribbon); this.disposables.push(rg);
      for (const e of edges) { const tg = new T.TubeGeometry(new T.CatmullRomCurve3(e), N, 0.14, 6, false); this.root.add(new T.Mesh(tg, this.m.loopRail)); this.disposables.push(tg); }
      // a steel portal frame around it, the yellow entry lane and a white stripe where you come out
      const xl = Math.min(x, x + shift) - w / 2 - 1.2, xr = Math.max(x, x + shift) + w / 2 + 1.2, top = y0 + 2 * R + 1.2;
      for (const px of [xl, xr]) for (const dz of [-R * 0.55, R * 0.55]) this.box(this.m.steel, px, y0, z + dz, 0.5, top - y0, 0.5);
      for (const dz of [-R * 0.55, R * 0.55]) this.box(this.m.steel, (xl + xr) / 2, top, z + dz, xr - xl + 0.5, 0.5, 0.5, { solid: false });
      this.box(this.m.hazard, x, y0, z + 8, w * 0.6, 0.04, 14, { solid: false, tile: 1 });
      this.box(this.m.ledW, x + shift, y0, z - 4, w * 0.5, 0.03, 6, { solid: false });
      return lp;
    }
    loopPoint(lp, th, out) {
      const a = lp.R * Math.sin(th), lat = lp.shift * th / (Math.PI * 2);
      return out.set(lp.x + lp.tx * a + lp.rx * lat, lp.y0 + lp.R * (1 - Math.cos(th)), lp.z + lp.tz * a + lp.rz * lat);
    }
    enterLoops(b) {
      if (b.ride) return;
      for (const lp of this.loops) {
        if (b.pos.y > lp.y0 + 1.2 || b.pos.y < lp.y0 - 1) continue;
        const dx = b.pos.x - lp.x, dz = b.pos.z - lp.z, along = dx * lp.tx + dz * lp.tz, side = dx * lp.rx + dz * lp.rz;
        if (along < 0 || along > 1.6 || Math.abs(side) > lp.w / 2 - 0.4) continue;
        const v = b.vel.x * lp.tx + b.vel.z * lp.tz;
        if (v < 6) continue;
        b.ride = { lp, th: along / lp.R, v, off: G.clamp(side, -lp.w / 2 + 1, lp.w / 2 - 1) };
        return;
      }
    }
    // on the loop the car follows the ribbon; gravity bleeds speed on the way up, too slow and it drops off
    rideStep(b, dt, inp) {
      const r = b.ride, lp = r.lp, g = G.GRAV, V = this._rv || (this._rv = [new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Vector3(), new T.Matrix4()]);
      if (!b.frozen) r.v += (inp.throttle * 10 - inp.brake * 14) * dt;
      r.v -= g * Math.sin(r.th) * dt;
      r.th += (r.v / lp.R) * dt;
      const done = r.th >= Math.PI * 2;
      if (done) r.th = Math.PI * 2;
      const th = r.th, c = Math.cos(th), s = Math.sin(th);
      this.loopPoint(lp, th, b.pos);
      b.pos.x += lp.rx * r.off; b.pos.z += lp.rz * r.off;
      const fw = V[0].set(lp.tx * c, s, lp.tz * c), up = V[1].set(-lp.tx * s, c, -lp.tz * s), rt = V[2].crossVectors(fw, up);
      V[4].makeBasis(rt, up, V[3].copy(fw).negate());
      b.q.setFromRotationMatrix(V[4]);
      b.vel.copy(fw).multiplyScalar(r.v);
      b.w.copy(rt).multiplyScalar(r.v / lp.R);
      b.grounded = true; b.contacts = 4; b.altitude = 0; b.speed = Math.abs(r.v); b.fwdSpeed = r.v; b.sideSlip = 0; b.slipMax = 0;
      b.steerAngle = 0; b.rollAcc = 0; b.pitchAcc = 0;
      for (const wh of b.wheels) { wh.contact = true; wh.slip = 0; wh.spinV = r.v / 0.34; wh.spin += wh.spinV * dt; }
      this.game.track.nearest(b.pos.x, b.pos.z, b.near.i, b.near);
      const fall = th > 0.3 && th < Math.PI * 1.7 && (r.v < 2 || (r.v * r.v) / lp.R < -g * c);
      if (done || fall) {
        b.ride = null;
        if (done) { b.pos.y = lp.y0 + 0.02; b.vel.y = 0; b.w.set(0, 0, 0); this.loopDone = lp; }
        else this.loopFell = lp;
      }
    }
    // a gold coin with a light beam above it so you can find it from afar
    coin(x, y, z) {
      if (!this.m.coin) {
        this.m.coin = new T.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.22, metalness: 1, emissive: new T.Color(1.0, 0.62, 0.1), emissiveIntensity: 1.5 });
        this.m.coinBeam = new T.MeshBasicMaterial({ color: new T.Color(1.0, 0.75, 0.25), transparent: true, opacity: 0.16, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false });
        this.coinGeo = new T.CylinderGeometry(1.0, 1.0, 0.18, 36); this.coinGeo.rotateX(Math.PI / 2);
        this.coinRim = new T.TorusGeometry(1.0, 0.09, 8, 36);
        this.beamGeo = new T.CylinderGeometry(0.35, 0.35, 60, 10, 1, true); this.beamGeo.translate(0, 31, 0);
        this.disposables.push(this.m.coin, this.m.coinBeam, this.coinGeo, this.coinRim, this.beamGeo);
      }
      const g = new T.Group(); g.position.set(x, y, z);
      const disc = new T.Mesh(this.coinGeo, this.m.coin); disc.castShadow = true; g.add(disc);
      g.add(new T.Mesh(this.coinRim, this.m.coin));
      g.add(new T.Mesh(this.beamGeo, this.m.coinBeam));
      this.root.add(g);
      const c = { x, y, z, g, got: false, t: this.R() * 6 };
      this.coins.push(c);
      this.anim.push((dt) => {
        c.t += dt;
        if (c.got) { g.scale.setScalar(Math.max(0, g.scale.x - dt * 4)); g.position.y += dt * 6; return; }
        g.rotation.y = c.t * 2.4; g.position.y = y + Math.sin(c.t * 2) * 0.25;
      });
      return c;
    }
    resetCoins() { for (const c of this.coins) { c.got = false; c.g.scale.setScalar(1); c.g.position.set(c.x, c.y, c.z); } }
    // something that moves (crushers, sliding walls): fn(t, s) places the solid; touching a deadly one ends the try
    mover(mat, w, h, d, fn, o = {}) {
      const mesh = new T.Mesh(uvBox(w, h, d, o.tile || 3), mat);
      mesh.castShadow = mesh.receiveShadow = !!this.Q.shadows;
      this.root.add(mesh); this.disposables.push(mesh.geometry);
      const s = { x: 0, z: 0, c: 1, s: 0, hw: w / 2, hl: d / 2, y0: 0, y1: h, h, deadly: o.deadly !== false };
      const m = { s, mesh, fn, t: 0, place: null };
      m.place = () => { fn(m.t, s); s.y1 = s.y0 + s.h; mesh.position.set(s.x, s.y0 + h / 2, s.z); };
      m.place();
      this.movers.push(m);
      this.anim.push((dt) => { m.t += dt; m.place(); });
      return m;
    }
    resetMovers() { for (const m of this.movers) { m.t = 0; m.place(); } }

    // finish line: a checker band across the road under a gantry
    finishLine(x, y, z, hw) {
      const tex = this.tx.checker.clone(); tex.wrapS = T.RepeatWrapping; tex.repeat.set(hw / 2, 1); tex.needsUpdate = true; this.disposables.push(tex);
      this.decal(tex, x, y, z, hw * 2, 2, 0, { roughness: 0.6 });
      for (const sx of [-1, 1]) this.box(this.m.darkPaint, x + sx * (hw + 0.6), y, z, 0.6, 7, 0.6);
      const tb = banner('FINISH', '#0d0f14', '#ffffff', '#ffd23a'); this.disposables.push(tb);
      const m = new T.MeshStandardMaterial({ map: tb, emissiveMap: tb, emissive: new T.Color(1, 1, 1), roughness: 0.5 }); this.disposables.push(m);
      const b = new T.Mesh(new T.BoxGeometry(hw * 2 + 1.8, 1.6, 0.4), m); b.position.set(x, y + 7.6, z); this.root.add(b);
    }

    // ---------- the city around (the skyline you see from the roofs) ----------
    skyline(o) {
      const R = G.rng(o.seed || 5), keep = o.keep || [], pitch = 58, rad = o.radius || 650;
      const pal = [[0x2c3a48, 0x243242, 0x34424e, 0x202c38, 0x3c4854], [0x8a4632, 0x7a3e2e, 0x9c5a42, 0x6e3a2c], [0xbdb4a2, 0xa89f8e, 0xcfc8b8, 0x948e84], [0xdadcde, 0xa2a8ae, 0x767c82, 0xc4c8cb]];
      const caps = [], beacons = [];
      for (let gx = -rad; gx <= rad; gx += pitch) for (let gz = -rad; gz <= rad; gz += pitch) {
        const cx = gx + (o.cx || 0), cz = gz + (o.cz || 0);
        if (Math.hypot(gx, gz) > rad) continue;
        for (let k = 0; k < 2; k++) {
          const w = 16 + R() * 18, d = 16 + R() * 18;
          const x = cx + (k ? 1 : -1) * (pitch / 4 - 1) + (R() - 0.5) * 4, z = cz + (R() - 0.5) * 8;
          if (keep.some((r) => x + w / 2 > r[0] - 6 && x - w / 2 < r[1] + 6 && z + d / 2 > r[2] - 6 && z - d / 2 < r[3] + 6)) continue;
          let h = (o.hMin || 18) + R() * ((o.hMax || 90) - (o.hMin || 18));
          if (R() < 0.12) h *= 1.6;
          const style = h > 70 ? (R() < 0.7 ? 0 : 3) : (R() * 4) | 0;
          this.facades.push({ x, z, w, d, h, style, seed: R(), col: pal[style][(R() * pal[style].length) | 0], far: true });
          caps.push([x, h, z, w - 0.6, d - 0.6]);
          if (h > 75) beacons.push([x, h + 1.5, z]);
        }
      }
      // roof caps and clutter on the backdrop (instanced: no collision, nobody drives there)
      const geo = new T.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0); this.disposables.push(geo);
      const cm = new T.InstancedMesh(geo, this.m.roof, caps.length * 2);
      const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3();
      caps.forEach((c, i) => {
        cm.setMatrixAt(i * 2, m4.compose(p.set(c[0], c[1], c[2]), q, s.set(c[3], 0.1, c[4])));
        cm.setMatrixAt(i * 2 + 1, m4.compose(p.set(c[0] + (R() - 0.5) * c[3] * 0.4, c[1], c[2] + (R() - 0.5) * c[4] * 0.4), q, s.set(c[3] * (0.2 + R() * 0.2), 2.5 + R() * 3, c[4] * (0.2 + R() * 0.2))));
      });
      cm.castShadow = false; cm.receiveShadow = true; this.root.add(cm);
      if (this.tod.stars || this.tod === TODS.dusk) {
        const bm = new T.InstancedMesh(new T.SphereGeometry(0.6, 8, 6), this.m.beacon, beacons.length);
        beacons.forEach((b, i) => bm.setMatrixAt(i, m4.makeTranslation(b[0], b[1], b[2])));
        this.root.add(bm); this.beacons = bm;
        // street lights between the blocks: rows of glows
        const glows = [];
        for (let gx = -rad; gx <= rad; gx += pitch) for (let gz = -rad; gz <= rad; gz += 28) {
          const x = gx + (o.cx || 0) + pitch / 2, z = gz + (o.cz || 0);
          if (Math.hypot(gx, gz) > rad || keep.some((r) => x > r[0] - 4 && x < r[1] + 4 && z > r[2] - 4 && z < r[3] + 4)) continue;
          glows.push([x - 6, 8, z], [x + 6, 8, z]);
        }
        const gm = new T.InstancedMesh(new T.SphereGeometry(0.35, 6, 4), new T.MeshBasicMaterial({ color: new T.Color(6, 4.2, 2.2), toneMapped: false }), glows.length);
        this.disposables.push(gm.material);
        glows.forEach((b, i) => gm.setMatrixAt(i, m4.makeTranslation(b[0], b[1], b[2])));
        this.root.add(gm);
        // car light streaks along the avenues
        const streaks = [];
        for (let gx = -rad; gx <= rad; gx += pitch) for (let k = 0; k < 14; k++) streaks.push([gx + (o.cx || 0) + pitch / 2 + (R() < 0.5 ? -2 : 2), 0.7, (R() - 0.5) * rad * 2 + (o.cz || 0), R() < 0.5]);
        const red = new T.MeshBasicMaterial({ color: new T.Color(5, 0.2, 0.15), toneMapped: false }), wht = new T.MeshBasicMaterial({ color: new T.Color(5, 4.6, 3.6), toneMapped: false });
        this.disposables.push(red, wht);
        const sr = new T.InstancedMesh(new T.BoxGeometry(1.6, 0.2, 0.25), red, streaks.length), sw = new T.InstancedMesh(new T.BoxGeometry(1.6, 0.2, 0.25), wht, streaks.length);
        streaks.forEach((t, i) => {
          const keepOut = keep.some((r) => t[0] > r[0] - 4 && t[0] < r[1] + 4 && t[2] > r[2] - 4 && t[2] < r[3] + 4);
          const m = keepOut ? m4.makeScale(0, 0, 0) : m4.makeTranslation(t[0], t[1], t[2]);
          sr.setMatrixAt(i, t[3] ? m : m4.makeScale(0, 0, 0)); sw.setMatrixAt(i, t[3] ? m4.makeScale(0, 0, 0) : (keepOut ? m4.makeScale(0, 0, 0) : m4.makeTranslation(t[0], t[1], t[2])));
        });
        sr.rotation.y = Math.PI / 2; sw.rotation.y = Math.PI / 2;
        // rotation about y swaps x/z: build them along z instead
        sr.rotation.y = 0; sw.rotation.y = 0;
        this.root.add(sr, sw);
      }
    }

    // ---------- finish building: merge batches, build facades, sky, lights ----------
    finalize() {
      const Q = this.Q;
      for (const [mat, geos] of this.batches) {
        const merged = ADDONS.mergeGeometries(geos.map((g) => { if (g.index) g = g.toNonIndexed(); return g; }));
        geos.forEach((g) => g.dispose());
        const mesh = new T.Mesh(merged, mat);
        mesh.castShadow = Q.shadows && !mat.transparent && mat !== this.m.ledW && mat !== this.m.led && mat !== this.m.tube;
        mesh.receiveShadow = Q.shadows;
        this.root.add(mesh); this.disposables.push(merged);
      }
      this.batches.clear();
      // parked cars
      if (this.carGeo) {
        const body = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 });
        const lights = new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
        this.disposables.push(body, lights);
        const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(1, 1, 1), p = new T.Vector3(), up = new T.Vector3(0, 1, 0);
        for (const cg of this.carGeo.values()) {
          for (const [g, mat] of [[cg.body, body], [cg.lights, lights]]) {
            if (!g) continue;
            const im = new T.InstancedMesh(g, mat, cg.list.length);
            const col = new T.Color();
            cg.list.forEach((c, i) => { im.setMatrixAt(i, m4.compose(p.set(c[0], c[1], c[2]), q.setFromAxisAngle(up, c[3]), s)); if (mat === body) im.setColorAt(i, col.set(c[4])); });
            im.castShadow = Q.shadows && mat === body; im.receiveShadow = Q.shadows;
            this.root.add(im); this.disposables.push(g);
          }
        }
      }
      // facades: one instanced mesh with the city's procedural building shader
      if (this.facades.length && G.makeBuildingMaterial) {
        const pal = [[0x2c3a48, 0x243242, 0x34424e, 0x202c38, 0x3c4854], [0x8a4632, 0x7a3e2e, 0x9c5a42, 0x6e3a2c, 0xa06a50], [0xbdb4a2, 0xa89f8e, 0xcfc8b8, 0x948e84, 0xb0a58c], [0xdadcde, 0xa2a8ae, 0x767c82, 0xc4c8cb, 0x8a8478]];
        const DIMS = [[3.8, 4.2, 1.5, 1.8], [3.0, 3.3, 2.6, 3.4], [3.5, 3.9, 2.2, 3.0], [3.4, 3.8, 5.0, 7.0]];
        const geo = new T.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
        const a = new Float32Array(this.facades.length * 4);
        const mat = G.makeBuildingMaterial(this.tod, Q.level >= 3);
        const im = new T.InstancedMesh(geo, mat, this.facades.length);
        const m4 = new T.Matrix4(), q = new T.Quaternion(), s = new T.Vector3(), p = new T.Vector3(), col = new T.Color();
        this.facades.forEach((f, i) => {
          im.setMatrixAt(i, m4.compose(p.set(f.x, 0, f.z), q, s.set(f.w, f.h, f.d)));
          im.setColorAt(i, col.set(f.col != null ? f.col : pal[f.style][(f.seed * pal[f.style].length) | 0]).multiplyScalar(0.9 + f.seed * 0.2));
          const D = DIMS[f.style];
          a.set([f.style, f.seed, G.lerp(D[0], D[1], f.seed), G.lerp(D[2], D[3], 1 - f.seed)], i * 4);
        });
        geo.setAttribute('aStyle', new T.InstancedBufferAttribute(a, 4));
        im.castShadow = Q.shadows; im.receiveShadow = Q.shadows; im.frustumCulled = false;
        this.root.add(im); this.disposables.push(geo, mat);
      }
      this.buildSky();
    }

    buildSky() {
      const tod = this.tod, game = this.game, Q = this.Q;
      const skyMat = new T.ShaderMaterial({
        side: T.BackSide, depthWrite: false, fog: false,
        uniforms: {
          uZen: { value: new T.Color(tod.zenith) }, uHor: { value: new T.Color(tod.horizon) },
          uGlow: { value: new T.Color(tod.glow) }, uSun: { value: new T.Vector3(...tod.sunDir).normalize() },
          uStars: { value: tod.stars }, uTime: { value: 0 }, uNight: { value: tod.stars },
        },
        vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
        fragmentShader: `
          uniform vec3 uZen, uHor, uGlow, uSun; uniform float uStars, uTime, uNight; varying vec3 vDir;
          float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
          void main(){
            vec3 d = normalize(vDir);
            float y = d.y;
            vec3 col = mix(uHor, uZen, smoothstep(-0.02, 0.45, y));
            col = mix(col, uGlow, exp(-abs(y)*14.0) * 0.6);
            float sd = max(dot(d, uSun), 0.0);
            if (uNight > 0.5) {
              col += vec3(0.6,0.7,1.0) * pow(sd, 400.0) * 0.6;
              col += vec3(1.0) * smoothstep(0.9994, 0.9997, sd) * 2.5;
            } else {
              col += vec3(1.0,0.6,0.3) * pow(sd, 8.0) * 0.7;
              col += vec3(1.0,0.85,0.6) * smoothstep(0.9990, 0.9995, sd) * 6.0;
            }
            if (uStars > 0.0 && y > 0.0) {
              vec3 p = d * 260.0; vec3 c = floor(p); float h = h31(c);
              if (h > 0.9965) { vec3 f = fract(p) - 0.5; float s = 1.0 - smoothstep(0.0, 0.18, length(f));
                col += vec3(0.9,0.95,1.0) * s * (h - 0.9965) * 300.0 * (0.6 + 0.4*sin(uTime*3.0 + h*90.0)) * smoothstep(0.0,0.25,y); }
            }
            if (y < 0.0) col = mix(col, uHor * 0.3, smoothstep(0.0, -0.1, y));
            gl_FragColor = vec4(col, 1.0);
          }`,
      });
      this.disposables.push(skyMat);
      const sky = new T.Mesh(new T.SphereGeometry(3000, 32, 16), skyMat);
      sky.frustumCulled = false; sky.renderOrder = -10;
      this.root.add(sky); this.sky = sky; this.disposables.push(sky.geometry);
      this.fog = new T.FogExp2(tod.fog, tod.fogDensity);
      // ground far below (a level can cover it with its own)
      if (this.level.ground !== false) {
        const gt = this.tx.asphalt.clone(); gt.repeat.set(500, 500); gt.needsUpdate = true; this.disposables.push(gt);
        const gm = new T.MeshStandardMaterial({ map: gt, roughness: 0.9, color: 0x9a9a9a }); this.disposables.push(gm);
        const ground = new T.Mesh(new T.PlaneGeometry(4000, 4000), gm);
        ground.rotation.x = -Math.PI / 2; ground.position.y = -0.03; ground.receiveShadow = true;
        this.root.add(ground); this.disposables.push(ground.geometry);
      }
      // lights
      const hemi = new T.HemisphereLight(tod.hemiSky, tod.hemiGround, tod.hemi);
      this.root.add(hemi);
      const sun = new T.DirectionalLight(tod.moon, tod.moonI);
      this.sunDir = new T.Vector3(...tod.sunDir).normalize();
      if (Q.shadows) {
        sun.castShadow = true; sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
        const c = sun.shadow.camera; c.left = -55; c.right = 55; c.top = 55; c.bottom = -55; c.near = 10; c.far = 360;
        sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
      }
      this.root.add(sun, sun.target); this.sun = sun;
      // environment for reflections
      const pm = new T.PMREMGenerator(game.renderer), es = new T.Scene();
      es.background = new T.Color(tod.zenith).lerp(new T.Color(tod.horizon), 0.4);
      const eb = (color, x, y, z, sx, sy, sz) => { const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), new T.MeshBasicMaterial({ color })); m.position.set(x, y, z); es.add(m); };
      eb(new T.Color(tod.horizon).multiplyScalar(1.2), 0, -3, 0, 60, 4, 60);
      eb(new T.Color(tod.hemiGround), 0, -12, 0, 80, 2, 80);
      const R = G.rng(42), pal = [0xffb070, 0x70c8ff, 0xff4060, 0xffffff, 0xff9040];
      for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; eb(new T.Color(pal[i % 5]).multiplyScalar(tod.stars ? 2.5 : 1.2), Math.cos(a) * 22, 1 + R() * 6, Math.sin(a) * 22, 1 + R() * 3, 0.4 + R() * 3, 1 + R() * 3); }
      eb(new T.Color(1, 1, 1).multiplyScalar(tod.stars ? 3 : 5), 0, 18, 0, 14, 0.5, 4);
      this.env = pm.fromScene(es, 0.03).texture;
      pm.dispose();
      es.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    }

    // ---------- show / hide the regular city ----------
    enter() {
      const g = this.game, sc = g.scene, keep = new Set([this.root, g.playerModel.group, g.reflCam]);
      for (const k of ['steam', 'smoke', 'sparks', 'leaves']) if (g.fx[k]) keep.add(g.fx[k].mesh);
      this.hidden = [];
      for (const o of sc.children) if (!keep.has(o) && o.visible) { o.visible = false; this.hidden.push(o); }
      this.saved = { fog: sc.fog, bg: sc.background, env: sc.environment, envI: sc.environmentIntensity, exp: g.renderer.toneMappingExposure };
      sc.add(this.root);
      sc.fog = this.fog; sc.background = new T.Color(this.tod.fog);
      sc.environment = this.env; sc.environmentIntensity = this.tod.env;
      g.renderer.toneMappingExposure = this.tod.exposure;
      for (const sl of g.headlights || []) sl.intensity = this.tod.stars ? 480 : 220;
      this.fxCol = [g.fx.steam.mat.uniforms.uColor.value.clone(), g.fx.smoke.mat.uniforms.uColor.value.clone()];
      const st = this.tod.steam || 1;
      g.fx.steam.mat.uniforms.uColor.value.setRGB(0.86, 0.9, 0.98).multiplyScalar(st);
      g.fx.smoke.mat.uniforms.uColor.value.setRGB(0.32, 0.32, 0.34).multiplyScalar(st);
    }
    exit() {
      const g = this.game, sc = g.scene;
      sc.remove(this.root);
      for (const o of this.hidden || []) o.visible = true;
      if (this.saved) {
        sc.fog = this.saved.fog; sc.background = this.saved.bg; sc.environment = this.saved.env; sc.environmentIntensity = this.saved.envI;
        g.renderer.toneMappingExposure = this.saved.exp;
      }
      const tod = G.TOD[g.settings.tod] || G.TOD.night;
      for (const sl of g.headlights || []) sl.intensity = tod.stars ? 480 : 220;
      if (this.fxCol) { g.fx.steam.mat.uniforms.uColor.value.copy(this.fxCol[0]); g.fx.smoke.mat.uniforms.uColor.value.copy(this.fxCol[1]); }
    }
    dispose() {
      this.root.traverse((o) => { if (o.isInstancedMesh || o.isMesh) { if (o.geometry && !this.disposables.includes(o.geometry)) o.geometry.dispose(); } });
      for (const d of this.disposables) if (d && d.dispose) d.dispose();
      for (const p of this.parts || []) { p.mesh.geometry.dispose(); p.mat.dispose(); }
      if (this.env) this.env.dispose();
    }

    update(dt, cam, focus) {
      this.t = (this.t || 0) + dt;
      this.sky.position.copy(cam.position);
      this.sky.material.uniforms.uTime.value = this.t;
      if (this.beacons) this.m.beacon.color.setRGB(Math.sin(this.t * 3) > 0.2 ? 6 : 0.4, 0.15, 0.12);
      this.sun.target.position.copy(focus);
      this.sun.position.copy(focus).addScaledVector(this.sunDir, 180);
      for (const f of this.anim) f(dt);
    }

    // ---------- physics: ground, ceilings and solid walls ----------
    at(x, z) {
      const l = this.grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!this.movers.length) return l;
      const b = this._buf; b.length = 0;
      if (l) for (const s of l) b.push(s);
      for (const m of this.movers) if (Math.abs(m.s.x - x) < m.s.hw + 6 && Math.abs(m.s.z - z) < m.s.hl + 6) b.push(m.s);
      return b;
    }
    top(s, lz) { return s.wedge ? s.yN + (s.yF - s.yN) * G.clamp((s.hl - lz) / (2 * s.hl), 0, 1) : s.y1; }
    groundAt(x, z, q, yRef) {
      q.h = 0; q.nx = 0; q.ny = 1; q.nz = 0; q.vx = 0; q.vy = 0; q.vz = 0; q.roof = false; q.ceil = Infinity;
      const list = this.at(x, z);
      if (!list) return q;
      const yr = yRef == null ? 1e9 : yRef;
      for (const s of list) {
        const dx = x - s.x, dz = z - s.z, lx = dx * s.c - dz * s.s, lz = dx * s.s + dz * s.c;
        if (Math.abs(lx) > s.hw || Math.abs(lz) > s.hl) continue;
        const h = this.top(s, lz);
        if (h <= yr + 0.6) {
          if (h > q.h) {
            q.h = h;
            if (s.wedge) { const k = (s.yF - s.yN) / (2 * s.hl), n = 1 / Math.sqrt(1 + k * k); q.nx = k * s.s * n; q.ny = n; q.nz = k * s.c * n; }
            else { q.nx = 0; q.ny = 1; q.nz = 0; }
          }
        } else if (s.y0 > yr - 0.2 && s.y0 < q.ceil) q.ceil = s.y0;
      }
      return q;
    }
    // the body against walls, ledges and ceilings: push out along the shallowest way, bounce, report the hardest hit
    collide(b) {
      const pos = b.pos, vel = b.vel, q = b.q, P = this._p || (this._p = new T.Vector3());
      let hit = 0;
      for (const lp of COLL_PTS) {
        P.set(lp[0], lp[1], lp[2]).applyQuaternion(q).add(pos);
        const list = this.at(P.x, P.z);
        if (!list) continue;
        for (const s of list) {
          const dx = P.x - s.x, dz = P.z - s.z, lx = dx * s.c - dz * s.s, lz = dx * s.s + dz * s.c;
          const px = s.hw - Math.abs(lx), pz = s.hl - Math.abs(lz);
          if (px <= 0 || pz <= 0 || P.y < s.y0) continue;
          const top = this.top(s, lz);
          if (P.y > top) continue;
          if (s.deadly && this.onDeadly) this.onDeadly(s);
          const pTop = top - P.y, pBot = P.y - s.y0;
          const under = pos.y + 0.5 < s.y0;
          if (pTop < 0.6 && !under) continue; // a step / the surface: the wheels handle it
          // the shallowest way out (a ceiling only pushes down when the car is under it)
          let nx = 0, ny = 0, nz = 0, pen;
          if (under || (pBot < px && pBot < pz && pBot < 0.6)) { ny = -1; pen = pBot; }
          else if (px < pz) { const sg = Math.sign(lx) || 1; nx = sg * s.c; nz = -sg * s.s; pen = px; }
          else { const sg = Math.sign(lz) || 1; nx = sg * s.s; nz = sg * s.c; pen = pz; }
          pos.x += nx * pen; pos.y += ny * pen; pos.z += nz * pen;
          P.x += nx * pen; P.y += ny * pen; P.z += nz * pen;
          const vn = -(vel.x * nx + vel.y * ny + vel.z * nz);
          if (vn > 0) {
            vel.x += nx * vn * 1.3; vel.y += ny * vn * 1.3; vel.z += nz * vn * 1.3;
            if (ny === 0) { vel.x *= 0.97; vel.z *= 0.97; b.w.y += (Math.random() - 0.5) * vn * 0.05; }
            hit = Math.max(hit, vn);
          }
        }
      }
      if (hit > 0.5) b.onWallHit(pos, hit, b.speed);
    }
  }
  const COLL_PTS = [[0.95, 0.3, 2.1], [-0.95, 0.3, 2.1], [0.95, 0.3, -2.1], [-0.95, 0.3, -2.1], [1.0, 0.6, 0], [-1.0, 0.6, 0],
    [0, 0.45, -2.35], [0, 0.6, 2.35], [0.55, 1.15, 0.3], [-0.55, 1.15, 0.3], [0, 1.2, 0], [0.6, 0.5, -1.2], [-0.6, 0.5, -1.2]];

  // ---------------------------------------------------------------- levels
  // Car heads -z. Each level: build(w) makes the world and returns { start:[x,y,z], goals:[...], kill(p), ref(x,z) }.
  // goal types: ring {x,y,z,r}, gate {x,y,z,hw,h,min}, line {x,y,z,hw}, pad {x,y,z,hw,hl}
  const LEVELS = [
    {
      name: 'ROOFTOP RUN', tod: 'sunset', seed: 11, n2: 30, par: 14, limit: 45,
      brief: 'Jump the alley from one roof to the next and stop inside the box.',
      tip: 'Hit the kicker at 80 to 115 km/h, then brake into the box',
      build(w) {
        const H = 60, HB = 56;
        // roof A: the runway
        w.building(0, -60, 30, 140, H, 0, { par: { s: true, e: true, w: true, n: [[-4.2, 4.2]] } });
        w.roofProps(0, -60, 30, 140, H, 16, (x, z) => Math.abs(x) > 7 && z < -4 && z > -116);
        w.waterTank(-10, -20, H, 1.8); w.waterTank(10.5, -95, H, 1.5);
        w.billboard(9, -40, H, Math.PI / 2 * 0, 'ROADSTER THRUSTER', '#2a0f14');
        w.ramp(w.m.plate, 0, 8, -116, H, -130, H + 2.4, H);
        w.decal(w.tx.hazard, 0, H, -114, 8, 1.2);
        // rooftop runway lights
        for (let z = -10; z > -112; z -= 8) for (const sx of [-4.4, 4.4]) w.box(w.m.ledA, sx, H, z, 0.25, 0.08, 0.6, { solid: false });
        // roof B: the landing, short, with a solid wall at the far end
        w.building(0, -176, 24, 48, HB, 2, { par: { n: true, e: true, w: true } });
        w.decal(w.tx.stop, 0, HB, -180, 12, 14);
        w.roofProps(0, -176, 24, 48, HB, 3, (x, z) => Math.abs(x) > 8.5);
        // the street canyon below and the buildings around
        w.building(-34, -150, 26, 60, 48, 1, { par: { n: true, s: true, e: true, w: true } });
        w.building(34, -145, 28, 70, 66, 3, { par: { n: true, s: true, e: true, w: true } });
        w.building(-38, -40, 30, 70, 74, 0, { par: { n: true, s: true, e: true, w: true } });
        w.building(36, -50, 26, 80, 52, 2, { par: { n: true, s: true, e: true, w: true } });
        w.building(0, -232, 40, 30, 70, 0, { par: { n: true, s: true, e: true, w: true } });
        for (let z = -138; z > -150; z -= 4) for (const sx of [-6, 6]) w.parked(sx, 0, z - 6, 0);
        w.skyline({ seed: 21, keep: [[-60, 60, -260, 20]], hMin: 25, hMax: 95, radius: 720 });
        return {
          start: [0, H, 2], goals: [{ type: 'pad', x: 0, y: HB, z: -180, hw: 6, hl: 7 }],
          kill: (p) => p.pos.y < HB - 6 && 'FELL',
          ref: (x, z) => (z > -140 ? H : HB),
        };
      },
    },
    {
      name: 'RING OF FIRE', tod: 'dusk', seed: 22, n2: 25, par: 13, limit: 45,
      brief: 'Build speed through the container yard and fly through the burning ring.',
      tip: 'Leave the ramp at 130 to 160 km/h',
      build(w) {
        // yard surface
        w.box(w.m.concrete, 0, -0.5, -170, 70, 0.52, 400, { solid: false, tile: 6 });
        // container corridor
        let ci = 0;
        for (let z = -10; z > -140; z -= 12.6) for (const sx of [-1, 1]) {
          const st = 1 + ((ci * 7) % 3 === 0 ? 1 : 0) + (ci % 5 === 0 ? 1 : 0);
          for (let k = 0; k < st; k++) w.container(sx * 13.5, k * 2.6, z, 0, ci + k * 3);
          ci++;
        }
        for (let z = -20; z > -140; z -= 13) for (const sx of [-1, 1]) for (let k = 0; k < 3; k++) w.container(sx * (19 + k * 2.6), 0, z + (k % 2) * 3, 0, ci++ + k);
        // warehouses
        for (const [x, z, wd, d, h] of [[-48, -60, 30, 90, 14], [48, -90, 30, 110, 16], [-46, -260, 34, 80, 18], [50, -280, 30, 70, 12]]) {
          w.box(w.m.cont[4], x, 0, z, wd, h, d, { tile: 2.4 });
          w.box(w.m.galv, x, h, z, wd + 0.6, 0.4, d + 0.6, { solid: false });
        }
        w.floodMast(-24, -100, 22, Math.PI / 2); w.floodMast(24, -190, 22, -Math.PI / 2); w.floodMast(-24, -300, 22, Math.PI / 2);
        for (let z = -40; z > -330; z -= 40) for (const sx of [-1, 1]) w.lamp(sx * 9.5, 0, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 7);
        // ramp, ring, landing
        w.ramp(w.m.plate, 0, 7, -150, 0, -170, 6);
        for (const sx of [-1, 1]) w.box(w.m.hazard, sx * 3.75, 0, -160, 0.5, 1.0, 20, { tile: 1 });
        const RING_Y = 10.2, RING_Z = -224;
        w.fireRing(0, RING_Y, RING_Z, 3.2, { posts: true });
        w.ramp(w.m.plate, 0, 10, RING_Z - 5, 5, RING_Z - 45, 0);
        w.finishLine(0, 0, RING_Z - 110, 10);
        w.skyline({ seed: 33, keep: [[-80, 80, -420, 40]], hMin: 10, hMax: 40, radius: 700 });
        return {
          start: [0, 0, 6],
          goals: [{ type: 'ring', x: 0, y: RING_Y, z: RING_Z, r: 3.2 }, { type: 'line', x: 0, y: 0, z: RING_Z - 110, hw: 10 }],
          kill: (p) => p.pos.x * p.pos.x > 40 * 40 && 'LEFT THE YARD',
          ref: () => 0,
        };
      },
    },
    {
      name: 'THE NEEDLE', tod: 'night', seed: 33, n2: 40, par: 12, limit: 40,
      brief: 'Clear both speed gates. The second one is a slot between two towers.',
      tip: 'Save some N₂: 190 at the first gate, 200 through the slot',
      build(w) {
        // avenue
        w.box(w.m.asphalt, 0, -0.5, -230, 20, 0.52, 520, { solid: false, tile: 5 });
        for (const sx of [-1, 1]) {
          w.box(w.m.concrete, sx * 12, 0, -165, 4, 0.16, 390, { tile: 3 }); // sidewalks to the towers
          w.box(w.m.cap, sx * 10.1, 0, -165, 0.2, 0.18, 390, { solid: false }); // kerbs
        }
        // lane markings
        for (let z = 0; z > -280; z -= 9) w.box(w.m.white, 0, 0.005, z, 0.18, 0.02, 4, { solid: false });
        // building rows along the avenue
        let z = 10;
        const R = w.R;
        while (z > -280) {
          const d = 18 + R() * 18;
          for (const sx of [-1, 1]) w.building(sx * (14 + 12), z - d / 2, 24, d - 1, 20 + R() * 60, (R() * 4) | 0, {});
          z -= d;
        }
        for (let zz = -20; zz > -232; zz -= 13) for (const sx of [-1, 1]) if (R() < 0.6) w.parked(sx * 8.8, 0, zz, sx > 0 ? 0 : Math.PI);
        for (let zz = -10; zz > -280; zz -= 30) for (const sx of [-1, 1]) w.lamp(sx * 10.6, 0.16, zz, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 9);
        // gate 1
        w.speedGate(0, 0, -200, 5, 190);
        // the towers and the slot
        const SL = -8.0, SR = -3.6;
        w.building((-46 + SL) / 2, -305, SL + 46, 30, 92, 0, {});
        w.building((SR + 46) / 2, -305, 46 - SR, 30, 140, 3, {});
        for (const sx of [SL, SR]) for (let y = 0.5; y < 14; y += 1.5) w.box(w.m.led, sx + (sx === SL ? 0.05 : -0.05), y, -305, 0.1, 0.12, 30, { solid: false });
        const gate2 = w.speedGate((SL + SR) / 2, 0, -321, (SR - SL) / 2, 200, { noPillars: true, h: 7.5 });
        w.decal(w.tx.hazard, (SL + SR) / 2, 0, -288, SR - SL, 2);
        // plaza beyond
        w.box(w.m.deck, 0, -0.5, -400, 80, 0.52, 160, { solid: false, tile: 6 });
        w.finishLine(0, 0, -372, 20);
        for (const [x, zz] of [[-24, -350], [24, -350], [-24, -420], [24, -420]]) w.lamp(x, 0, zz, 0, 9);
        w.building(0, -500, 120, 40, 60, 2, {});
        w.skyline({ seed: 44, keep: [[-60, 60, -540, 30]], hMin: 30, hMax: 120, radius: 760 });
        return {
          start: [0, 0, 6],
          goals: [{ type: 'gate', x: 0, y: 0, z: -200, hw: 5, h: 6.5, min: 190 }, { type: 'gate', x: (SL + SR) / 2, y: 0, z: -321, hw: (SR - SL) / 2, h: 9, min: 200, led: gate2.ledM }, { type: 'line', x: 0, y: 0, z: -372, hw: 22 }],
          kill: () => false,
          ref: () => 0,
        };
      },
    },
    {
      name: 'PARKING GARAGE', tod: 'day', seed: 44, n2: 15, par: 32, limit: 90,
      brief: 'Climb the garage, launch off the top deck and stop on the roof across the street.',
      tip: 'Leave the top deck at 50 to 65 km/h',
      build(w) {
        const XW = 18.5, ZW = 35, decks = [3.5, 7, 10.5], T2 = 0.4;
        w.box(w.m.asphalt, 0, -0.5, 0, 90, 0.52, 200, { solid: false, tile: 5 });
        // decks with their holes (built as up to 4 slabs around the hole)
        const holes = [[4, 12, -12, 10], [-12, -4, -10, 12], [4, 12, -12, 10]];
        decks.forEach((top, i) => {
          const [hx0, hx1, hz0, hz1] = holes[i], y0 = top - T2;
          const slab = (x0, x1, z0, z1) => { if (x1 - x0 > 0.1 && z1 - z0 > 0.1) w.box(w.m.deck, (x0 + x1) / 2, y0, (z0 + z1) / 2, x1 - x0, T2, z1 - z0, { tile: 5 }); };
          slab(-XW, XW, -ZW, hz0); slab(-XW, XW, hz1, ZW); slab(-XW, hx0, hz0, hz1); slab(hx1, XW, hz0, hz1);
          // parapets (the roof's north edge opens over the street)
          const ph = 1.1;
          w.box(w.m.concrete, 0, top, ZW - 0.2, XW * 2, ph, 0.4, { tile: 3 });
          if (i < 2) w.box(w.m.concrete, 0, top, -ZW + 0.2, XW * 2, ph, 0.4, { tile: 3 });
          else { w.box(w.m.concrete, (-XW + 4) / 2, top, -ZW + 0.2, XW + 4, ph, 0.4, { tile: 3 }); w.box(w.m.concrete, (12 + XW) / 2, top, -ZW + 0.2, XW - 12, ph, 0.4, { tile: 3 }); }
          for (const sx of [-1, 1]) w.box(w.m.concrete, sx * (XW - 0.2), top, 0, 0.4, ph, ZW * 2, { tile: 3 });
          // bay lines and parked cars along both sides
          const lt = w.tx.lines.clone(); lt.repeat.set(10, 1); lt.needsUpdate = true; w.disposables.push(lt);
          for (const sx of [-1, 1]) {
            w.decal(lt, sx * 15.1, top, 0, 5, 36, Math.PI / 2 * 0);
            for (let zz = -16; zz <= 16; zz += 2.8) if (w.R() < 0.55) w.parked(sx * 15.1, top, zz, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
          }
          // fluorescent tubes under the slab above
          if (i < 2) for (let zz = -30; zz <= 30; zz += 10) for (const xx of [-10, 0, 10]) w.box(w.m.tube, xx, decks[i + 1] - T2 - 0.08, zz, 0.15, 0.06, 2.4, { solid: false });
        });
        for (let zz = -30; zz <= 30; zz += 10) for (const xx of [-10, 0, 10]) w.box(w.m.tube, xx, decks[0] - T2 - 0.08, zz, 0.15, 0.06, 2.4, { solid: false });
        // ground floor parked cars
        for (const sx of [-1, 1]) for (let zz = -16; zz <= 16; zz += 2.8) if (w.R() < 0.5) w.parked(sx * 15.1, 0, zz, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        // columns: a spine along x = 0 and the perimeter
        const colAt = (x, z, y0, y1) => w.box(w.m.concrete, x, y0, z, 0.7, y1 - y0, 0.7, { tile: 2 });
        decks.forEach((top, i) => {
          const y0 = i === 0 ? 0 : decks[i - 1], y1 = top - T2;
          for (const zz of [-20, -10, 0, 10, 20]) colAt(0, zz, y0, y1);
          for (let zz = -30; zz <= 30; zz += 10) for (const sx of [-1, 1]) colAt(sx * (XW - 0.6), zz, y0, y1);
        });
        // ramps
        w.ramp(w.m.deck, 8, 7.6, 10, 0, -12, decks[0]);
        w.ramp(w.m.deck, -8, 7.6, -10, decks[0], 12, decks[1], decks[0]);
        w.ramp(w.m.deck, 8, 7.6, 10, decks[1], -12, decks[2], decks[1]);
        // arrows painted on the decks
        const arrow = G.canvasTexture(128, 256, (ctx, W, H) => { ctx.clearRect(0, 0, W, H); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.moveTo(W / 2, 10); ctx.lineTo(W - 10, 100); ctx.lineTo(W * 0.68, 100); ctx.lineTo(W * 0.68, H - 10); ctx.lineTo(W * 0.32, H - 10); ctx.lineTo(W * 0.32, 100); ctx.lineTo(10, 100); ctx.fill(); });
        w.disposables.push(arrow);
        w.decal(arrow, 8, 0, 20, 2.5, 5);
        w.decal(arrow, -8, decks[0], -18, 2.5, 5, Math.PI); w.decal(arrow, 8, decks[0], -22, 2.5, 5, Math.PI / 2);
        w.decal(arrow, 8, decks[1], 18, 2.5, 5, 0); w.decal(arrow, -8, decks[1], 18, 2.5, 5, -Math.PI / 2);
        w.decal(w.tx.hazard, 8, decks[2], -34.2, 8, 1.2);
        // facade skin on the outside: concrete spandrels on each level
        decks.forEach((top) => {
          for (const sz of [-1, 1]) w.box(w.m.cap, 0, top - 0.9, sz * (ZW + 0.05), XW * 2 + 0.2, 0.9, 0.12, { solid: false, tile: 3 });
          for (const sx of [-1, 1]) w.box(w.m.cap, sx * (XW + 0.05), top - 0.9, 0, 0.12, 0.9, ZW * 2, { solid: false, tile: 3 });
        });
        // the street and the target roof across it
        w.box(w.m.concrete, 0, 0, -38, 60, 0.15, 3, { tile: 3 });
        w.building(8, -58, 8, 18, 4, 1, { par: { n: true, e: true, w: true }, ph: 1.0 });
        w.decal(w.tx.stop, 8, 4, -59, 6.6, 9);
        w.building(-12, -60, 24, 22, 9, 2, {});
        w.building(26, -62, 20, 26, 14, 1, {});
        for (let x = -30; x <= 30; x += 12) w.lamp(x, 0, -44, Math.PI, 8, false);
        for (const [x, z] of [[-26, -42], [-12, -42], [22, -40]]) w.parked(x, 0, z, Math.PI / 2);
        w.skyline({ seed: 55, keep: [[-50, 50, -90, 70]], hMin: 10, hMax: 60, radius: 650 });
        return {
          start: [8, 0, 52],
          goals: [{ type: 'pad', x: 8, y: 4, z: -59, hw: 3.4, hl: 7.6 }],
          kill: (p) => p.pos.y < 2.5 && p.pos.z < -36.5 && 'MISSED THE ROOF',
          ref: (x, z) => (z < -36 ? 4 : 0),
        };
      },
    },
    {
      name: 'SKYLINE FINALE', tod: 'nightRoof', seed: 55, n2: 35, par: 30, limit: 80,
      brief: 'Speed gate, ring of fire, a skybridge with no rails and a helipad. 120 m up.',
      tip: 'Boost to the gate, cross the bridge slowly, jump to the helipad at about 60 km/h',
      build(w) {
        const HA = 120, HB = 112, HD = 104;
        // tower A: the runway
        w.building(0, -80, 30, 184, HA, 0, { par: { s: true, e: true, w: true, n: [[-4.2, 4.2]] } });
        w.roofProps(0, -80, 30, 184, HA, 10, (x, z) => Math.abs(x) > 7 && z < 0 && z > -150);
        for (let z = -4; z > -150; z -= 8) for (const sx of [-4.4, 4.4]) w.box(w.m.ledA, sx, HA, z, 0.25, 0.08, 0.6, { solid: false });
        const gA = w.speedGate(0, HA, -110, 5, 140);
        w.ramp(w.m.plate, 0, 8, -152, HA, -170, HA + 3, HA);
        // the ring hangs on cables between two towers
        const RING_Y = 126.2;
        w.building(-45, -195, 22, 30, 138, 3, {}); w.building(45, -195, 22, 30, 132, 0, {});
        w.fireRing(0, RING_Y, -192, 3.6, { cables: [[-34, 138, -192], [34, 132, -192]] });
        // tower B: landing
        w.building(0, -268, 30, 106, HB, 2, { par: { s: false, e: true, w: true, n: [[-2.2, 2.2]] } });
        w.decal(w.tx.hazard, 0, HB, -318, 4, 1.2);
        w.roofProps(0, -268, 30, 106, HB, 6, (x, z) => Math.abs(x) > 8);
        // skybridge: 4 m wide, no rails, LED edges
        w.box(w.m.steel, 0, HB - 1.2, -346, 4, 1.2, 48, { tile: 2 });
        w.box(w.m.plate, 0, HB - 0.05, -346, 4, 0.05, 48, { tile: 2, solid: false });
        for (const sx of [-1.9, 1.9]) for (let z = -324; z > -370; z -= 3) w.box(w.m.ledW, sx, HB, z, 0.12, 0.06, 0.8, { solid: false });
        // tower C, then the helipad
        w.building(0, -387, 24, 34, HB, 3, { par: { s: [[-2.2, 2.2]], e: true, w: true, n: [[-5, 5]] } });
        w.decal(w.tx.hazard, 0, HB, -403, 10, 1.2);
        w.building(0, -431, 16, 16, HD, 0, { par: false });
        w.decal(w.tx.heli, 0, HD, -431, 14, 14);
        for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; w.box(w.m.ledA, Math.cos(t) * 7.4, HD, -431 + Math.sin(t) * 7.4, 0.3, 0.1, 0.3, { solid: false }); }
        w.building(-40, -300, 30, 60, 100, 0, {}); w.building(42, -330, 26, 50, 90, 3, {});
        w.building(-36, -420, 30, 40, 80, 2, {}); w.building(38, -440, 30, 50, 118, 0, {});
        w.billboard(10, -40, HA, 0, 'STUNT CHALLENGE', '#2a0f14');
        w.skyline({ seed: 66, keep: [[-70, 70, -470, 30]], hMin: 40, hMax: 130, radius: 800 });
        return {
          start: [0, HA, 4],
          goals: [{ type: 'gate', x: 0, y: HA, z: -110, hw: 5, h: 6.5, min: 140, led: gA.ledM }, { type: 'ring', x: 0, y: RING_Y, z: -192, r: 3.6 }, { type: 'pad', x: 0, y: HD, z: -431, hw: 7.2, hl: 7.2 }],
          kill: (p) => p.pos.y < (p.pos.z > -412 ? 106 : 98) && 'FELL',
          ref: (x, z) => (z > -176 ? HA : z > -412 ? HB : HD),
        };
      },
    },
  ];
  // ---------------------------------------------------------------- levels 6 to 15 (and the order of the run)
  const mat = (w, o, phys) => { const m = phys ? new T.MeshPhysicalMaterial(o) : new T.MeshStandardMaterial(o); w.disposables.push(m); return m; };
  // a red-primer steel I-beam from (x0, z0) to (x1, z1), its top at y; only the top flange is solid
  function ibeam(w, x0, z0, x1, z1, y, wid, m) {
    const dx = x1 - x0, dz = z1 - z0, L = Math.hypot(dx, dz), yaw = Math.atan2(dx, dz), cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    w.box(m, cx, y - 0.16, cz, wid, 0.16, L, { yaw, tile: 2 });
    w.box(m, cx, y - 1.0, cz, 0.22, 0.84, L, { yaw, solid: false, tile: 2 });
    w.box(m, cx, y - 1.16, cz, wid * 0.8, 0.16, L, { yaw, solid: false, tile: 2 });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    for (const sx of [-1, 1]) for (let t = 1.5; t < L; t += 3) {
      const k = t - L / 2;
      w.box(w.m.ledW, cx + s * k + c * sx * (wid / 2 - 0.08), y, cz + c * k - s * sx * (wid / 2 - 0.08), 0.1, 0.04, 0.5, { yaw, solid: false });
    }
  }
  // a tower crane: lattice mast, jib and a beacon (scenery)
  function crane(w, x, z, h, yaw, m) {
    w.box(m, x, 0, z, 2.2, h, 2.2, { tile: 2 });
    const c = Math.cos(yaw), s = Math.sin(yaw);
    w.box(m, x + s * 14, h, z + c * 14, 1.4, 1.6, 44, { yaw, solid: false, tile: 2 });
    w.box(w.m.darkPaint, x - s * 6, h - 1.6, z - c * 6, 3, 3, 4, { yaw, solid: false });
    w.box(w.m.beacon, x, h + 1.6, z, 0.5, 0.5, 0.5, { solid: false });
  }
  // a water surface far below (the harbour level)
  function water(w, y = 0) {
    const t = w.tx.concrete.clone(); t.repeat.set(300, 300); t.needsUpdate = true; w.disposables.push(t);
    const m = mat(w, { color: 0x0a2230, roughness: 0.08, metalness: 0.55, bumpMap: t, bumpScale: 0.6 });
    const pl = new T.Mesh(new T.PlaneGeometry(4000, 4000), m); pl.rotation.x = -Math.PI / 2; pl.position.y = y; pl.receiveShadow = true;
    w.root.add(pl); w.disposables.push(pl.geometry);
    w.anim.push((dt) => { t.offset.x += dt * 0.02; t.offset.y += dt * 0.012; });
  }

  const NEW = {
    // ---------------- FLIP AND STICK: kicker, a full flip, a deck to land on
    flip: {
      name: 'FLIP AND STICK', tod: 'day', seed: 61, n2: 20, par: 14, limit: 45,
      brief: 'Hit the kicker, roll the car all the way round in the air, land on the deck and stop in the box.',
      tip: 'Kicker at about 80 km/h. In the air hold Space + Q (or E) to roll, let go after a quarter turn: it comes round on its own',
      build(w) {
        w.box(w.m.asphalt, 0, -0.5, -60, 120, 0.52, 260, { solid: false, tile: 5 });
        // parking bays and cars on both sides of the lot
        const lt = w.tx.lines.clone(); lt.repeat.set(16, 1); lt.needsUpdate = true; w.disposables.push(lt);
        for (const sx of [-1, 1]) for (const row of [18, 32]) {
          w.decal(lt, sx * row, 0, -40, 5, 120, 0);
          for (let z = 15; z > -95; z -= 2.8) if (w.R() < 0.6) w.parked(sx * row, 0, z, sx > 0 ? Math.PI / 2 : -Math.PI / 2);
        }
        // run-up lane and the kicker
        for (let z = -10; z > -54; z -= 6) w.box(w.m.hazard, 0, 0, z, 1.2, 0.02, 2.4, { solid: false, tile: 1 });
        w.ramp(w.m.plate, 0, 9, -54, 0, -70, 7.5);
        for (const sx of [-1, 1]) w.box(w.m.steel, sx * 3.2, 0, -66, 0.4, 7.2, 0.4, { solid: false });
        // the landing deck: a wide stage on the lot
        w.box(w.m.deck, 0, 0, -140, 48, 2.4, 90, { tile: 5 });
        w.box(w.m.hazard, 0, 2.4, -95.6, 48, 0.03, 0.8, { solid: false, tile: 1 });
        for (const sx of [-1, 1]) for (let z = -97; z > -184; z -= 3) w.box(w.m.ledA, sx * 23.85, 2.4, z, 0.12, 0.05, 0.8, { solid: false });
        w.decal(w.tx.stop, 0, 2.4, -165, 12, 14);
        w.box(w.m.concrete, 0, 0, -190, 54, 4.5, 4, { tile: 3 }); // a crash wall behind the stage
        // stadium beyond, warehouses, masts
        w.building(0, -250, 140, 60, 26, 2, {});
        w.building(-74, -60, 30, 120, 18, 1, {}); w.building(76, -100, 30, 160, 22, 3, {});
        for (const [x, z] of [[-45, -10], [45, -10], [-45, -120], [45, -120]]) w.floodMast(x, z, 24, x < 0 ? Math.PI / 2 : -Math.PI / 2);
        w.billboard(26, -196, 0, 0, 'FLIP AND STICK', '#16324f');
        w.skyline({ seed: 71, keep: [[-90, 90, -285, 40]], hMin: 15, hMax: 70, radius: 700 });
        return {
          start: [0, 0, 8],
          goals: [{ type: 'flip', n: 1 }, { type: 'pad', x: 0, y: 2.4, z: -165, hw: 6, hl: 7 }],
          kill: (p) => p.grounded && p.pos.y < 1.2 && p.pos.z < -72 && 'MISSED THE DECK',
          ref: (x, z) => (Math.abs(x) < 24 && z < -95 && z > -185 ? 2.4 : 0),
        };
      },
    },

    // ---------------- TRIPLE LOOP: three loops, none of them in line with the last
    loops: {
      name: 'TRIPLE LOOP', tod: 'night', seed: 62, n2: 25, par: 21, limit: 50,
      brief: 'Three loops in a row on the old airfield. Each one comes out of line with the next: steer into every entry lane.',
      tip: 'Each loop throws you out sideways: steer for the next yellow lane straight away, at 60 km/h or more',
      build(w) {
        w.box(w.m.concrete, 0, -0.5, -150, 140, 0.52, 460, { solid: false, tile: 8 });
        // runway lights and taxiway lines
        for (let z = 30; z > -380; z -= 10) for (const sx of [-1, 1]) w.box(w.m.ledA, sx * 26, 0, z, 0.4, 0.1, 0.4, { solid: false });
        for (let z = 30; z > -380; z -= 7) w.box(w.m.ledW, -18, 0.005, z, 0.25, 0.02, 3, { solid: false });
        const l1 = w.loop(0, 0, -100, 9, 6, 7.5);
        const l2 = w.loop(-3, 0, -190, 9, 6, -7.5);
        const l3 = w.loop(5, 0, -280, 9, 6, 7.5);
        w.finishLine(12.5, 0, -345, 9);
        // hangars and the tower
        for (const [x, z, d] of [[-62, -60, 70], [-62, -170, 70], [64, -110, 90], [64, -250, 80]]) {
          w.box(w.m.cont[4], x, 0, z, 34, 14, d, { tile: 2.4 });
          const arch = new T.CylinderGeometry(17, 17, d, 24, 1, false, -Math.PI / 2, Math.PI); arch.rotateX(Math.PI / 2); arch.scale(1, 0.32, 1); arch.translate(x, 14, z); w.add(w.m.cont[4], arch);
        }
        w.building(-40, -330, 12, 12, 34, 3, {}); w.box(w.m.glassRail, -40, 34, -330, 14, 4, 14, { solid: false }); w.box(w.m.darkPaint, -40, 38, -330, 15, 0.5, 15, { solid: false });
        for (const z of [-40, -150, -260, -360]) for (const sx of [-1, 1]) w.floodMast(sx * 34, z, 20, sx > 0 ? -Math.PI / 2 : Math.PI / 2);
        w.skyline({ seed: 72, keep: [[-100, 100, -420, 60]], hMin: 10, hMax: 50, radius: 760 });
        return {
          start: [0, 0, 40],
          goals: [{ type: 'loop', lp: l1, k: 1, of: 3 }, { type: 'loop', lp: l2, k: 2, of: 3 }, { type: 'loop', lp: l3, k: 3, of: 3 }, { type: 'line', x: 12.5, y: 0, z: -345, hw: 10 }],
          kill: (p) => Math.abs(p.pos.x) > 60 && 'LEFT THE AIRFIELD',
          ref: () => 0,
        };
      },
    },

    // ---------------- COIN RUSH: five coins over three roofs
    coins: {
      name: 'COIN RUSH', tod: 'sunset', seed: 63, n2: 30, par: 24, limit: 60,
      brief: 'Five coins over three rooftops. Some sit on the roofs, some hang in the air: jump for them and use the thrusters.',
      tip: 'No way back up: side coin, jump the gap, over the stair housing, then a short burst of thrusters (Space) off the last kicker',
      build(w) {
        const HA = 40, HB = 38, HC = 31;
        // roof A
        w.building(0, -50, 40, 104, HA, 0, { par: { s: true, e: true, w: true, n: [[-4.6, 4.6]] } });
        w.roofProps(0, -50, 40, 104, HA, 10, (x, z) => Math.abs(x) > 16 && z < -10 && Math.abs(z + 50) > 6);
        w.waterTank(15, -20, HA, 1.8);
        w.ramp(w.m.plate, 0, 8, -88, HA, -100, HA + 2.6, HA);
        w.decal(w.tx.hazard, 0, HA, -86, 8, 1.2);
        w.billboard(-14, -96, HA, 0, 'COIN RUSH', '#3a1c0a');
        // roof B: a ramp onto a stair housing, then a kicker off the far end
        w.building(0, -162, 36, 90, HB, 2, { par: { e: true, w: true, n: [[-5, 5]] } });
        w.ramp(w.m.plate, 11, 6, -142, HB, -154, HB + 3.0, HB);
        w.box(w.m.concrete, 11, HB, -160, 6, 3.0, 12, { tile: 3 });
        w.box(w.m.darkPaint, 11, HB + 3.0, -160, 6.3, 0.2, 12.3, { solid: false });
        w.decal(w.tx.hazard, 11, HB, -140, 6, 1.2);
        w.ramp(w.m.plate, 0, 8, -195, HB, -207, HB + 2.6, HB);
        w.decal(w.tx.hazard, 0, HB, -193, 8, 1.2);
        w.roofProps(0, -162, 36, 90, HB, 6, (x, z) => Math.abs(x) > 14 && z > -190);
        // roof C
        w.building(0, -265, 40, 80, HC, 3, { par: { n: true, e: true, w: true } });
        w.roofProps(0, -265, 40, 80, HC, 6, (x) => x > 10);
        // the street canyon and neighbours
        w.building(-44, -130, 30, 220, 52, 1, {}); w.building(46, -120, 34, 200, 30, 3, {});
        w.building(-42, -285, 30, 70, 44, 0, {}); w.building(44, -280, 30, 60, 58, 2, {});
        for (const sx of [-1, 1]) for (let z = -100; z > -230; z -= 6) if (w.R() < 0.5) w.parked(sx * 6, 0, z, sx > 0 ? 0 : Math.PI);
        // the coins
        w.coin(-13, HA + 1.3, -50);
        w.coin(0, HA + 5.2, -111);
        w.coin(11, HB + 4.4, -160);
        w.coin(0, HB + 8, -227);
        w.coin(-10, HC + 1.3, -292);
        w.skyline({ seed: 73, keep: [[-70, 70, -330, 20]], hMin: 20, hMax: 90, radius: 720 });
        const got = () => w.coins.filter((c) => c.got).length;
        return {
          start: [0, HA, -4],
          goals: [{ type: 'coins' }],
          kill: (p) => (p.pos.y < (p.pos.z > -110 ? HA - 4 : p.pos.z > -215 ? HB - 4 : HC - 4) ? 'FELL' : p.pos.z < -240 && got() < 4 ? 'MISSED A COIN' : false),
          ref: (x, z) => (z > -110 ? HA : z > -215 ? HB : HC),
        };
      },
    },

    // ---------------- THE CORRIDOR: a 5 m wide viaduct, no rails, two speed gates
    corridor: {
      name: 'THE CORRIDOR', tod: 'night', seed: 64, n2: 30, par: 19, limit: 45,
      brief: 'A viaduct five metres wide, 26 metres up, no rails. It bends. Hit 200 at the first gate and 245 through the last.',
      tip: 'Stay on the throttle through the bends and keep the N₂ for the last straight',
      build(w) {
        const H = 26, WD = 5;
        const bump = (z, z0, L, A) => (z <= z0 && z >= z0 - L ? (A * (1 - Math.cos((2 * Math.PI * (z0 - z)) / L))) / 2 : 0);
        const px = (z) => bump(z, -160, 240, 7) + bump(z, -500, 240, -7);
        const STEP = 6;
        for (let z = 12; z > -960; z -= STEP) {
          const xA = px(z), xB = px(z - STEP), dx = xB - xA, L = Math.hypot(dx, STEP) + 0.3, yaw = Math.atan2(-dx, STEP);
          const cx = (xA + xB) / 2, cz = z - STEP / 2;
          w.box(w.m.deck, cx, H - 1.2, cz, WD, 1.2, L, { yaw, tile: 4 });
          const c = Math.cos(yaw), s = Math.sin(yaw);
          for (const sx of [-1, 1]) w.box(sx > 0 ? w.m.led : w.m.ledW, cx + c * sx * (WD / 2 - 0.06), H, cz - s * sx * (WD / 2 - 0.06), 0.1, 0.05, 1.6, { yaw, solid: false });
          if (Math.round(z) % 24 === 0) w.box(w.m.concrete, cx, 0, cz, 2.2, H - 1.2, 2.2, { tile: 3 });
        }
        for (let z = -20; z > -900; z -= 12) w.box(w.m.white, px(z), H, z, 0.15, 0.02, 3, { solid: false });
        // the gates: tall pillars from the street, the last one narrows the deck to 3.8 m
        const g1 = w.speedGate(0, H, -450, 2.6, 200, { noPillars: true });
        for (const sx of [-1, 1]) w.box(w.m.darkPaint, sx * 3.0, 0, -450, 0.8, H + 6.5, 0.8);
        const g2 = w.speedGate(0, H, -800, 1.9, 245, { noPillars: true });
        for (const sx of [-1, 1]) w.box(w.m.darkPaint, sx * 2.3, H, -800, 0.8, 6.5, 0.8);
        w.finishLine(0, H, -860, 2.5);
        for (const sx of [-1, 1]) w.box(w.m.concrete, sx * 3.1, 0, -860, 0.6, H, 0.6);
        // the canyon of towers along it
        const R = w.R;
        for (const sx of [-1, 1]) for (let z = 0; z > -960; ) {
          const d = 22 + R() * 26;
          w.building(sx * (34 + R() * 10), z - d / 2, 30, d - 2, 18 + R() * 80, (R() * 4) | 0, {});
          z -= d + 4;
        }
        for (let z = -10; z > -950; z -= 40) for (const sx of [-1, 1]) w.lamp(sx * 12, 0, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 8);
        for (let z = -20; z > -940; z -= 14) for (const sx of [-1, 1]) if (R() < 0.5) w.parked(sx * 6, 0, z, sx > 0 ? 0 : Math.PI);
        w.skyline({ seed: 74, keep: [[-60, 60, -1000, 40]], hMin: 30, hMax: 120, radius: 900, cz: -450 });
        return {
          start: [0, H, 6],
          goals: [{ type: 'gate', x: 0, y: H, z: -450, hw: 2.6, h: 6.5, min: 200, led: g1.ledM }, { type: 'gate', x: 0, y: H, z: -800, hw: 1.9, h: 6.5, min: 245, led: g2.ledM }, { type: 'line', x: 0, y: H, z: -860, hw: 3 }],
          kill: (p) => p.pos.y < H - 4 && 'FELL',
          ref: () => H,
        };
      },
    },

    // ---------------- THRUSTER HOP: pier to pier over the harbour, each gap longer than the last
    hop: {
      name: 'THRUSTER HOP', tod: 'dusk', seed: 65, n2: 45, par: 17, limit: 60, ground: false,
      brief: 'Pier to pier across the harbour. The gaps get longer, and the last pier has no kicker: hover across on the under-thrusters.',
      tip: 'Over 100 km/h off the first kicker, 140 off the second. Hold Space just before the end of the last pier and keep it lit',
      build(w) {
        water(w, 0);
        const H = 6;
        const pier = (z0, z1, kick) => {
          const zc = (z0 + z1) / 2, d = z0 - z1;
          w.box(w.m.concrete, 0, 0, zc, 14, H, d, { tile: 4 });
          w.box(w.m.deck, 0, H, zc, 14, 0.02, d, { solid: false, tile: 5 });
          for (const sx of [-1, 1]) {
            for (let z = z0 - 4; z > z1 + 2; z -= 9) { const b = new T.CylinderGeometry(0.28, 0.34, 0.7, 12); b.translate(sx * 6.4, H + 0.35, z); w.add(w.m.darkPaint, b); }
            w.box(w.m.hazard, sx * 6.85, H, zc, 0.3, 0.05, d, { solid: false, tile: 1 });
            for (let z = z0 - 2; z > z1; z -= 6) w.box(w.m.rubber, sx * 7.1, H - 2.2, z, 0.3, 1.6, 1.2, { solid: false });
          }
          if (kick) { w.ramp(w.m.plate, 0, 8, z1 + 12, H, z1, H + kick, H); w.decal(w.tx.hazard, 0, H, z1 + 13.5, 8, 1.2); }
        };
        pier(10, -80, 1.5);
        pier(-110, -170, 2.2);
        pier(-220, -280, 0);
        pier(-330, -470, 0);
        for (const z of [-280.3, -329.7]) w.box(w.m.ledA, 0, H, z, 14, 0.04, 0.4, { solid: false });
        w.decal(w.tx.stop, 0, H, -440, 10, 12);
        w.box(w.m.concrete, 0, H, -468, 14, 1.2, 0.6, { tile: 3 });
        for (const z of [-30, -150, -250, -360, -440]) for (const sx of [-1, 1]) w.lamp(sx * 6.2, H, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 7);
        // the harbour: container stacks on the quays, a ship, cranes
        let ci = 0;
        for (const sx of [-1, 1]) {
          w.box(w.m.concrete, sx * 70, 0, -190, 60, 4, 600, { tile: 6 });
          for (let z = 60; z > -460; z -= 13) for (let k = 0; k < 1 + ((ci * 7) % 3); k++) w.container(sx * (52 + (ci % 3) * 3), 4 + k * 2.6, z, 0, ci++ + k);
          crane(w, sx * 46, -120 + sx * 70, 48, sx > 0 ? -Math.PI / 2 : Math.PI / 2, w.m.cont[3]);
        }
        w.box(w.m.cont[1], -34, 0, -540, 22, 12, 120, { tile: 3 }); w.box(w.m.white, -34, 12, -570, 16, 10, 22, { solid: false });
        w.skyline({ seed: 75, keep: [[-110, 110, -620, 80]], hMin: 20, hMax: 80, radius: 760 });
        return {
          start: [0, H, 4],
          goals: [{ type: 'pad', x: 0, y: H, z: -440, hw: 5, hl: 6 }],
          kill: (p) => p.pos.y < H - 2.5 && 'SPLASH',
          ref: () => H,
        };
      },
    },

    // ---------------- BEAM WALK: steel beams between roofs, 90 m up
    beams: {
      name: 'BEAM WALK', tod: 'nightRoof', seed: 66, n2: 10, par: 30, limit: 80,
      brief: 'Cross from roof to roof on bare steel beams 90 metres up. They get narrower, and the second one turns.',
      tip: 'Slow is fast here: 20 to 30 km/h on the beams and line the car up on the roof before each one',
      build(w) {
        const H = 90, bm = mat(w, { color: 0x8a3a24, roughness: 0.55, metalness: 0.45 });
        w.building(0, -30, 26, 70, H, 0, { par: { s: true, e: true, w: true, n: [[-1.6, 1.6]] } });
        w.roofProps(0, -30, 26, 70, H, 8, (x) => Math.abs(x) > 6);
        ibeam(w, 0, -64.6, 0, -95.4, H, 2.8, bm);
        w.building(0, -105, 14, 20, H, 3, {});
        ibeam(w, -3, -114.6, -16.0, -137.6, H, 2.6, bm);
        w.building(-18, -150, 16, 26, H, 2, {});
        ibeam(w, -18, -162.6, -18, -197.4, H, 2.2, bm);
        w.building(-18, -215, 24, 36, H, 0, { par: { n: true, e: true, w: true, s: [[-19.4, -16.6]] } });
        w.decal(w.tx.stop, -18, H, -217, 9, 11);
        for (const [x, z] of [[0, -105], [-18, -150]]) for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) w.box(w.m.beacon, x + a * 5, H, z + b * 7, 0.3, 0.3, 0.3, { solid: false });
        crane(w, 22, -150, 120, -Math.PI / 2, mat(w, { color: 0xd8a51c, roughness: 0.5, metalness: 0.4 }));
        w.building(30, -70, 30, 50, 70, 1, {}); w.building(-34, -70, 28, 60, 110, 0, {});
        w.building(22, -230, 26, 40, 80, 3, {}); w.building(-50, -170, 24, 40, 60, 2, {});
        w.skyline({ seed: 76, keep: [[-60, 50, -250, 20]], hMin: 40, hMax: 150, radius: 800 });
        return {
          start: [0, H, -2],
          goals: [{ type: 'pad', x: -18, y: H, z: -217, hw: 4.5, hl: 5.5 }],
          kill: (p) => p.pos.y < H - 3 && 'FELL',
          ref: () => H,
        };
      },
    },

    // ---------------- CRUSHER ALLEY: presses and sliding walls; learn the rhythm
    crusher: {
      name: 'CRUSHER ALLEY', tod: 'dusk', seed: 67, n2: 20, par: 22, limit: 55,
      brief: 'A factory street of hydraulic presses and sliding walls. Learn the rhythm, then hit the speed gate at the end.',
      tip: 'The presses work in a green wave: about 75 km/h through them. Watch the walls and go for the open side',
      build(w) {
        w.box(w.m.asphalt, 0, -0.5, -200, 60, 0.52, 480, { solid: false, tile: 5 });
        for (let z = 0; z > -400; z -= 9) w.box(w.m.ledA, 0, 0.005, z, 0.18, 0.02, 4, { solid: false });
        // factory halls left and right
        for (const sx of [-1, 1]) for (let z = 10; z > -420; z -= 52) {
          w.box(w.m.cont[sx > 0 ? 4 : 0], sx * 21, 0, z - 25, 22, 16 + w.R() * 8, 48, { tile: 2.4 });
          w.box(w.m.galv, sx * 10.4, 0, z - 25, 0.4, 1.0, 48, { tile: 2 });
        }
        const press = (z, ph) => {
          for (const sx of [-1, 1]) w.box(w.m.steel, sx * 5.8, 0, z, 1.0, 9, 1.4);
          w.box(w.m.steel, 0, 9, z, 12.6, 1.2, 1.6, { solid: false });
          const om = 2 * Math.PI / 2.4;
          w.mover(w.m.hazard, 10, 3, 4, (t, s) => { s.x = 0; s.z = z; s.y0 = 0.15 + 5.6 * (0.5 + 0.5 * Math.sin(om * t + ph)); }, { tile: 1.5 });
          w.mover(w.m.galv, 1.0, 6, 1.0, (t, s) => { s.x = 0; s.z = z; s.y0 = 3.15 + 5.6 * (0.5 + 0.5 * Math.sin(om * t + ph)); }, { deadly: false });
        };
        const v = 21; // the green wave: 75 km/h
        [-80, -110, -140, -170].forEach((z, i) => press(z, -Math.PI / 2 - (2 * Math.PI / 2.4) * ((-z - 50) / v - 2.4) + Math.PI));
        const slide = (z, ph) => {
          const om = 2 * Math.PI / 3.2;
          w.mover(w.m.cont[3], 6, 2.8, 3, (t, s) => { s.x = 4.3 * Math.sin(om * t + ph); s.z = z; s.y0 = 0; }, { tile: 2.4 });
          w.box(w.m.steel, 0, 3.2, z, 12, 0.3, 0.3, { solid: false });
        };
        slide(-230, 0); slide(-265, 2.2); slide(-300, 4.4);
        const g = w.speedGate(0, 0, -360, 5, 140);
        w.finishLine(0, 0, -385, 9);
        for (let z = -20; z > -400; z -= 30) for (const sx of [-1, 1]) w.lamp(sx * 9.4, 0, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 7);
        w.skyline({ seed: 77, keep: [[-50, 50, -460, 40]], hMin: 10, hMax: 50, radius: 700 });
        return {
          start: [0, 0, 6],
          goals: [{ type: 'gate', x: 0, y: 0, z: -360, hw: 5, h: 6.5, min: 140, led: g.ledM, label: 'GET THROUGH · 140 KM/H AT THE GATE', short: 'GATE · 140 KM/H' }, { type: 'line', x: 0, y: 0, z: -385, hw: 10 }],
          kill: (p) => Math.abs(p.pos.x) > 11 && 'LEFT THE STREET',
          ref: () => 0,
        };
      },
    },

    // ---------------- THE THREADER: three slots, side to side, faster each time
    threader: {
      name: 'THE THREADER', tod: 'night', seed: 68, n2: 45, par: 14, limit: 45,
      brief: 'Three walls of towers across the avenue, each with one slot: left, right, centre. 185, 240, then 255 km/h.',
      tip: 'Start each lane change about 100 m before the slot, smooth and early. Save the N₂ until you are through the first one',
      build(w) {
        w.box(w.m.asphalt, 0, -0.5, -320, 24, 0.52, 720, { solid: false, tile: 5 });
        for (const sx of [-1, 1]) w.box(w.m.concrete, sx * 13, 0, -320, 2, 0.16, 720, { tile: 3 });
        for (let z = 0; z > -660; z -= 9) for (const lx of [-3.5, 3.5]) w.box(w.m.white, lx, 0.005, z, 0.15, 0.02, 3.5, { solid: false });
        const R = w.R;
        for (const sx of [-1, 1]) for (let z = 10; z > -680; ) { const d = 20 + R() * 18; w.building(sx * 28, z - d / 2, 26, d - 1, 30 + R() * 70, (R() * 4) | 0, {}); z -= d; }
        const wall = (z, x, wid, min, st) => {
          const L = x - wid / 2, Rr = x + wid / 2;
          w.building((-14 + L) / 2, z, L + 14, 30, 70 + R() * 50, st, {});
          w.building((Rr + 14) / 2, z, 14 - Rr, 30, 60 + R() * 60, (st + 1) % 4, {});
          for (const sx of [L, Rr]) for (let y = 0.5; y < 12; y += 1.5) w.box(w.m.led, sx + (sx === L ? 0.05 : -0.05), y, z, 0.1, 0.12, 30, { solid: false });
          w.decal(w.tx.hazard, x, 0, z + 17, wid, 2);
          const g = w.speedGate(x, 0, z - 16, wid / 2, min, { noPillars: true, h: 7.5 });
          return { type: 'gate', x, y: 0, z: z - 16, hw: wid / 2, h: 9, min, led: g.ledM };
        };
        const goals = [wall(-250, -6, 4.6, 185, 0), wall(-400, 6, 4.4, 240, 2), wall(-550, 0, 4.0, 255, 1)];
        w.box(w.m.deck, 0, -0.5, -680, 80, 0.52, 120, { solid: false, tile: 6 });
        w.finishLine(0, 0, -620, 12);
        for (let z = -10; z > -660; z -= 30) for (const sx of [-1, 1]) w.lamp(sx * 12.4, 0.16, z, sx > 0 ? -Math.PI / 2 : Math.PI / 2, 9);
        w.skyline({ seed: 78, keep: [[-50, 50, -760, 30]], hMin: 30, hMax: 130, radius: 800, cz: -300 });
        goals.push({ type: 'line', x: 0, y: 0, z: -620, hw: 14 });
        return { start: [0, 0, 6], goals, kill: () => false, ref: () => 0 };
      },
    },

    // ---------------- FREEFALL: off the tallest tower, three rings on the way down
    freefall: {
      name: 'FREEFALL', tod: 'sunset', seed: 69, n2: 30, par: 14, limit: 45,
      brief: 'Launch off a 130 metre tower, fall through three rings of fire on the way down and touch down on the landing hill.',
      tip: 'Leave the ramp at 104 to 110 km/h. A bit slow? A short burst of thrusters (Space) lifts you back onto the line. Hands off them after the last ring',
      build(w) {
        const H = 130, F = FREEFALL;
        w.building(0, -40, 30, 100, H, 0, { par: { s: true, e: true, w: true, n: [[-4.2, 4.2]] } });
        for (let z = -4; z > -76; z -= 8) for (const sx of [-4.4, 4.4]) w.box(w.m.ledA, sx, H, z, 0.25, 0.08, 0.6, { solid: false });
        w.roofProps(0, -40, 30, 100, H, 8, (x) => Math.abs(x) > 7);
        w.ramp(w.m.plate, 0, 8, -78, H, -90, H + 2.0, H);
        F.rings.forEach(([z, y], i) => w.fireRing(0, y, z, 4.2, { cables: [[-30, y + 20, z - 4], [30, y + 18, z + 4]] }));
        // the landing hill: segments bending from steep to flat, on a steel frame
        const hill = F.hill;
        for (let i = 0; i < hill.length - 1; i++) {
          const [zA, yA] = hill[i], [zB, yB] = hill[i + 1];
          w.ramp(w.m.deck, 0, 16, zA, yA, zB, yB, Math.max(0, Math.min(yA, yB) - 1.2), { edges: true });
          if (i % 3 === 0 && yB > 1.5) for (const sx of [-1, 1]) w.box(w.m.steel, sx * 7.6, 0, (zA + zB) / 2, 0.6, Math.min(yA, yB) - 1.2, 0.6);
        }
        w.box(w.m.asphalt, 0, -0.5, F.finish + 60, 60, 0.52, 260, { solid: false, tile: 5 });
        w.finishLine(0, 0, F.finish, 12);
        for (const [x, z, d, h] of [[-40, -160, 30, 60], [42, -150, 30, 80], [-46, -300, 34, 40], [48, -320, 30, 50]]) w.building(x, z, d, 40, h, 2, {});
        w.skyline({ seed: 79, keep: [[-70, 70, -560, 30]], hMin: 30, hMax: 110, radius: 800, cz: -200 });
        return {
          start: [0, H, 4],
          goals: F.rings.map(([z, y]) => ({ type: 'ring', x: 0, y, z, r: 4.2 })).concat([{ type: 'line', x: 0, y: 0, z: F.finish, hw: 14 }]),
          kill: (p) => p.grounded && p.pos.y < 1 && p.pos.z > F.under && 'MISSED THE SLOPE',
          ref: (x, z) => (z > -92 ? H : 0),
          camUp: 16,
        };
      },
    },

    // ---------------- THE GAUNTLET: everything at once
    gauntlet: {
      name: 'THE GAUNTLET', tod: 'nightRoof', seed: 70, n2: 40, par: 24, limit: 90,
      brief: 'The last one: speed gate, a loop on the roof, a ring of fire over the street, a bare beam and the helipad.',
      tip: '150 at the gate, keep 90 into the loop, 110 off the kicker, crawl the beam, stop on the H',
      build(w) {
        const HA = 80, HB = 74, HC = 74, bm = mat(w, { color: 0x8a3a24, roughness: 0.55, metalness: 0.45 });
        w.building(0, -110, 34, 240, HA, 0, { par: { s: true, e: true, w: true, n: [[0, 15]] } });
        for (let z = -4; z > -120; z -= 8) for (const sx of [-4.4, 4.4]) w.box(w.m.ledA, sx, HA, z, 0.25, 0.08, 0.6, { solid: false });
        const g = w.speedGate(0, HA, -100, 5, 150);
        const lp = w.loop(0, HA, -150, 9, 6, 7.5);
        w.ramp(w.m.plate, 7.5, 7, -218, HA, -230, HA + 2.6, HA);
        w.decal(w.tx.hazard, 7.5, HA, -216, 7, 1.2);
        w.fireRing(7.5, G.GAUNTLET_RING_Y || HA + 6.2, -252, 3.8, { cables: [[-26, HA + 26, -252], [40, HA + 20, -252]] });
        // roof B over the street
        w.building(7.5, -305, 24, 60, HB, 2, { par: { e: true, w: true, n: [[6.3, 8.7]] } });
        ibeam(w, 7.5, -334.6, 7.5, -366.4, HB, 2.0, bm);
        w.building(7.5, -380, 18, 26, HC - 4, 3, { par: false });
        w.decal(w.tx.heli, 7.5, HC - 4, -380, 15, 15);
        for (let a = 0; a < 16; a++) { const t = (a / 16) * Math.PI * 2; w.box(w.m.ledA, 7.5 + Math.cos(t) * 7.6, HC - 4, -380 + Math.sin(t) * 7.6, 0.3, 0.1, 0.3, { solid: false }); }
        // a short drop from the end of the beam onto the helipad roof
        w.building(-40, -260, 30, 80, 60, 1, {}); w.building(50, -250, 30, 70, 96, 0, {});
        w.building(-36, -400, 30, 50, 90, 2, {}); w.building(46, -410, 26, 40, 70, 3, {});
        w.billboard(-10, -60, HA, 0, 'THE GAUNTLET', '#2a0f14');
        w.skyline({ seed: 80, keep: [[-70, 70, -440, 20]], hMin: 40, hMax: 130, radius: 820, cz: -200 });
        return {
          start: [0, HA, -2],
          goals: [{ type: 'gate', x: 0, y: HA, z: -100, hw: 5, h: 6.5, min: 150, led: g.ledM }, { type: 'loop', lp }, { type: 'ring', x: 7.5, y: G.GAUNTLET_RING_Y || HA + 6.2, z: -252, r: 3.8 }, { type: 'pad', x: 7.5, y: HC - 4, z: -380, hw: 7, hl: 7 }],
          kill: (p) => p.pos.y < (p.pos.z > -235 ? HA - 4 : p.pos.z > -368 ? HB - 4 : HC - 8) && 'FELL',
          ref: (x, z) => (z > -235 ? HA : z > -368 ? HB : HC - 4),
        };
      },
    },
  };
  // FREEFALL's flight line, measured: take-off at z -92, y 132.3, rise 0.146 per metre, gravity 12.26 m/s² (the game's)
  // The rings sit on the 108 km/h arc; the hill runs 8 m under the 112 km/h arc, then bends flat 0.1° per metre, so
  // anything from about 102 to 112 km/h touches down at a shallow angle.
  const FREEFALL = (() => {
    const Z0 = -92, Y0 = 132.3, A = 0.146, GR = 12.26;
    const arc = (kmh, dz) => { const vx = kmh / 3.6, t = dz / vx; return Y0 + A * vx * t - 0.5 * GR * t * t; };
    const slope = (kmh, dz) => { const vx = kmh / 3.6, t = dz / vx; return Math.atan(-(A * vx - GR * t) / vx); };
    const hill = [];
    let dz = 57;
    for (; dz < 108; dz += 3) hill.push([Z0 - dz, arc(112, dz) - 8]);
    let y = arc(112, dz) - 8, th = slope(112, dz);
    hill.push([Z0 - dz, y]);
    const k = (0.1 * Math.PI) / 180;
    while (y > 0 && th > 0) { const st = 3; dz += st * Math.cos(th); y -= st * Math.sin(th); th = Math.max(0, th - k * st); hill.push([Z0 - dz, Math.max(0, y)]); }
    const end = hill[hill.length - 1][0];
    hill.push([end - 20, 0]);
    const under = hill.filter((h) => h[1] > 3).pop()[0]; // anything grounded and low before here is under the hill
    return { rings: [25, 50, 75].map((d) => [Z0 - d, +arc(108, d).toFixed(1)]), hill, under, finish: Math.round(end - 70) };
  })();
  {
    const L0 = LEVELS.slice();
    LEVELS.length = 0;
    LEVELS.push(L0[0], L0[1], NEW.flip, L0[2], L0[3], NEW.loops, NEW.coins, NEW.corridor, NEW.hop, L0[4], NEW.beams, NEW.crusher, NEW.threader, NEW.freefall, NEW.gauntlet);
  }
  G.CHAL_LEVELS = LEVELS;

  // the stand-in "track" while a level is loaded: no road, no walls; ground comes from the level
  function stubTrack(world, spec) {
    return {
      length: 1e6, elev: false, wild: false, gaps: [], bridges: [], tunnels: [], ramps: [], spans: [], floorY: -400, roof: 0, N: 0, px: [], pz: [],
      nearest(x, z, hint, o) { o = o || {}; o.i = 0; o.s = -z; o.lat = 0; o.rx = 1; o.rz = 0; o.tx = 0; o.tz = -1; return o; },
      sample(s, o) { o = o || {}; o.x = spec.start[0]; o.z = spec.start[2] - s; o.rx = 1; o.rz = 0; o.tx = 0; o.tz = -1; return o; },
      heightAt: () => 0, sd: (a, b) => a - b, gapAt: () => null, gapAhead: () => null, updateSpans() {}, roofAt: () => 0,
      respawn: (s) => ({ s }), distToRoad: () => 0, clearAt: () => true,
      groundAt: (x, z, q, yRef) => world.groundAt(x, z, q, yRef),
      thrustRef: (x, z) => spec.ref(x, z),
    };
  }

  // ---------------------------------------------------------------- how runs are cut
  // courses: one entry per ranked run, each with its own leaderboard (track id + level count). To play the challenge
  // as three 5-level courses instead of one 15-level run, swap in:
  //   [{ name: 'ACT I', from: 0, to: 4, track: 'stunt1', laps: 5 }, { name: 'ACT II', from: 5, to: 9, track: 'stunt2', laps: 5 },
  //    { name: 'ACT III', from: 10, to: 14, track: 'stunt3', laps: 5 }]
  const RUN = {
    lives: 5,
    actLife: true, // clearing the last level of an act gives a life back (up to the max)
    acts: [{ name: 'STREET SCHOOL', from: 0 }, { name: 'STEEL AND SPEED', from: 5 }, { name: 'NO MERCY', from: 10 }],
    courses: [{ name: 'FULL RUN', from: 0, to: 14, track: 'stunt15', laps: 15 }],
  };
  G.CHAL_RUN = RUN;
  const ROMAN = ['I', 'II', 'III', 'IV', 'V'];
  const actOf = (i) => { let k = 0; RUN.acts.forEach((a, j) => { if (i >= a.from) k = j; }); return k; };
  G.chalActName = (i) => `ACT ${ROMAN[actOf(i)]} · ${RUN.acts[actOf(i)].name}`;

  const UP = new T.Vector3();
  // ---------------------------------------------------------------- a run
  class ChallengeRun {
    constructor(game, opt = {}) {
      this.game = game;
      this.practice = opt.level != null;
      this.course = RUN.courses[opt.course || 0] || RUN.courses[0];
      this.first = this.practice ? opt.level : this.course.from;
      this.last = this.practice ? opt.level : Math.min(this.course.to, LEVELS.length - 1);
      this.count = this.last - this.first + 1;
      this.lives = this.practice ? Infinity : RUN.lives;
      this.total = 0; this.runTime = 0;
      this.results = [];
      this.realTrack = game.track;
      this.load(this.first);
    }
    get act() { return G.chalActName(this.idx); }

    load(i) {
      const g = this.game;
      if (this.world) { this.world.exit(); this.world.dispose(); }
      this.idx = i; this.level = LEVELS[i];
      this.world = new World(g, this.level);
      this.spec = this.level.build(this.world);
      this.world.finalize();
      this.world.enter();
      this.world.onDeadly = () => this.fail('CRUSHED');
      g.track = stubTrack(this.world, this.spec);
      this.tries = 0;
      this.startAttempt(false);
    }

    startAttempt(retry) {
      const g = this.game, p = g.player, sp = this.spec, w = this.world;
      this.tries++;
      this.goal = 0; this.prec = []; this.t = 0; this.padT = 0; this.camHold = null; this.failed = null; this.doneT = 0;
      this.airT = 0; this.flipT = 0; this.prevSt = 'countdown';
      w.loopDone = null; w.loopFell = null; w.resetCoins(); w.resetMovers();
      // place the car (what Player.place does, off the level's start)
      const [x, y, z] = sp.start;
      p.pos.set(x, y + 0.02, z);
      p.q.setFromAxisAngle(new T.Vector3(0, 1, 0), 0);
      p.vel.set(0, 0, 0); p.w.set(0, 0, 0); p.ride = null;
      for (const wh of p.wheels) { wh.comp = 0.1; wh.len = 0.45; wh.spinV = 0; }
      p.near.i = -1; g.track.nearest(p.pos.x, p.pos.z, -1, p.near);
      p.flipT = 0; p.airTime = 0; p.pitchAcc = 0; p.rollAcc = 0;
      p.fuel = this.level.n2; p.fuelLock = false; p.noRecharge = true; p.infFuel = false;
      p.health = 100;
      g.lastS = p.near.s; g.progress = 0;
      g.state = 'countdown';
      g.cdT = retry ? 1.999 : 3.999; g.cdLast = -1; g.camIntro = retry ? 0.3 : 0;
      g.camYaw = 0;
      for (const gl of sp.goals) { if (gl.led) gl.led.color.setRGB(4, 0.3, 0.2); gl.prevD = null; }
      g.hud.chal(this);
      g.hud.chalObjective('');
      g.hud.chalIntro(this, this.goalText(sp.goals[0], false));
      if (retry) g.hud.message(`TRY ${this.tries}`, 1000);
    }

    // what a goal asks for: the long line for the objective box, the short one for "NEXT: …"
    goalText(gl, short) {
      if (!gl) return '';
      if (gl.label) return short ? gl.short || gl.label : gl.label;
      const coins = this.world.coins, got = coins.filter((c) => c.got).length;
      switch (gl.type) {
        case 'ring': return short ? 'THE RING' : 'FLY THROUGH THE RING';
        case 'gate': return short ? `GATE · ${gl.min} KM/H` : `SPEED GATE · MIN ${gl.min} KM/H`;
        case 'pad': return short ? 'STOP IN THE BOX' : 'STOP INSIDE THE BOX';
        case 'coins': return short ? 'THE COINS' : `GRAB ALL ${coins.length} COINS · ${got}/${coins.length}`;
        case 'loop': return short ? 'THE LOOP' : gl.of > 1 ? `HIT LOOP ${gl.k} OF ${gl.of}` : 'HIT THE LOOP';
        case 'flip': return short ? 'A FLIP' : gl.n > 1 ? `DO ${gl.n} FLIPS AND LAND THEM` : 'DO A FLIP AND LAND IT';
        default: return short ? 'FINISH' : 'REACH THE FINISH';
      }
    }
    hint() { this.game.hud.chalObjective(this.goalText(this.spec.goals[this.goal], false)); }

    // called every frame by the game
    update(dt, st) {
      const g = this.game, p = g.player;
      this.world.update(dt, g.camera, p.pos);
      if (st === 'race') {
        if (this.prevSt === 'countdown') g.hud.chalIntroGo();
        this.t += dt; this.runTime += dt;
        g.raceTime = this.t;
        this.world.enterLoops(p);
        this.check(dt);
        if (g.state === 'race' && this.t > this.level.limit) this.fail('OUT OF TIME');
      } else if (st === 'cfail') {
        this.doneT += dt;
        if (this.doneT > 2.2) this.afterFail();
      } else if (st === 'cdone') {
        this.doneT += dt;
        if (this.doneT > 3.0) this.next();
      }
      this.prevSt = st;
      g.score = Math.round(this.total);
    }

    check(dt) {
      const g = this.game, p = g.player, sp = this.spec, w = this.world;
      const k = sp.kill(p);
      if (k) { this.camHold = g.camera.position.clone(); return this.fail(k === 'FELL' ? 'YOU FELL' : k); }
      // upside down and stuck
      UP.set(0, 1, 0).applyQuaternion(p.q);
      if (!p.ride && UP.y < 0.1 && p.speed < 3) { this.flipT += dt; if (this.flipT > 1.2) return this.fail('FLIPPED'); } else this.flipT = 0;
      // coins can be picked up in any order, whatever the current goal
      for (const c of w.coins) {
        if (c.got) continue;
        const dx = p.pos.x - c.x, dy = p.pos.y + 0.6 - c.y, dz = p.pos.z - c.z;
        if (dx * dx + dy * dy + dz * dz < 2.6 * 2.6) {
          c.got = true;
          const n = w.coins.filter((q) => q.got).length;
          G.audio.stunt();
          g.fx && g.fx.burst && g.fx.burst(c.x, c.y, c.z, 30, 0, 3, 0, 7);
          const gl = sp.goals[this.goal];
          if (gl && gl.type === 'coins' && n === w.coins.length) { this.prec.push(G.clamp(1 - this.t / this.level.limit, 0, 1) * 0.5 + 0.5); this.pass('ALL COINS'); }
          else g.hud.popup(`COIN ${n}/${w.coins.length}`, '', 'blue');
          if (gl && gl.type === 'coins') this.hint();
        }
      }
      if (g.state !== 'race') return;
      // air time: flips are judged on landing
      if (!p.grounded && !p.ride) this.airT += dt;
      else {
        if (this.airT > 0.35) this.landed();
        if (g.state !== 'race') return;
        this.airT = 0; p.pitchAcc = 0; p.rollAcc = 0;
      }
      const gl = sp.goals[this.goal];
      if (!gl) return;
      const cx = p.pos.x, cy = p.pos.y + 0.6, cz = p.pos.z;
      if (gl.type === 'pad') {
        const inside = Math.abs(cx - gl.x) < gl.hw && Math.abs(cz - gl.z) < gl.hl && Math.abs(p.pos.y - gl.y) < 1.5;
        if (inside && p.grounded && p.speed < 1.5) {
          this.padT += dt;
          if (this.padT > 0.6) {
            const off = Math.max(Math.abs(cx - gl.x) / gl.hw, Math.abs(cz - gl.z) / gl.hl);
            this.prec.push(1 - off);
            this.complete();
          }
        } else this.padT = 0;
        return;
      }
      if (gl.type === 'coins' || gl.type === 'flip') return;
      if (gl.type === 'loop') {
        if (w.loopDone === gl.lp) { w.loopDone = null; this.prec.push(1); return this.pass(gl.of > 1 ? `LOOP ${gl.k}/${gl.of}` : 'LOOP!'); }
        if (w.loopFell === gl.lp) return this.fail('TOO SLOW FOR THE LOOP');
        if (!p.ride && cz < gl.lp.z - 3) return this.fail('MISSED THE LOOP');
        return;
      }
      // plane crossing: the goal plane faces -z (every set piece is laid out along the run)
      const d = gl.z - cz; // > 0 once past it
      if (gl.prevD == null) { gl.prevD = d; return; }
      const crossed = gl.prevD < 0 && d >= 0;
      gl.prevD = d;
      if (gl.type === 'gate' && gl.led) gl.led.color.setRGB(p.speed * 3.6 >= gl.min ? 0.2 : 4, p.speed * 3.6 >= gl.min ? 4 : 0.3, 0.2);
      if (!crossed) return;
      const u = cx - gl.x, v = cy - gl.y;
      if (gl.type === 'ring') {
        const rr = Math.hypot(u, v), pass = gl.r - 0.9;
        if (rr <= pass) { this.prec.push(1 - rr / pass); this.pass(rr < pass * 0.35 ? 'BULLSEYE' : 'THROUGH THE RING'); }
        else if (rr <= gl.r + 1.3) this.fail('BURNED');
        else this.fail('MISSED THE RING');
      } else if (gl.type === 'gate') {
        const kmh = Math.round(p.speed * 3.6);
        if (Math.abs(u) <= gl.hw && v > -1 && v < gl.h) {
          if (kmh >= gl.min) { this.prec.push(G.clamp((kmh - gl.min) / 60, 0, 1) * 0.5 + 0.5); this.pass(`${kmh} KM/H`); }
          else this.fail(`TOO SLOW · ${kmh} KM/H`);
        } else this.fail('MISSED THE GATE');
      } else if (gl.type === 'line') {
        if (Math.abs(u) <= gl.hw) this.complete();
      }
    }

    // back on the wheels after a jump: was there a flip in it?
    landed() {
      const p = this.game.player, gl = this.spec.goals[this.goal];
      if (!gl || gl.type !== 'flip') return;
      const turns = Math.abs(p.pitchAcc) / (Math.PI * 2), flips = Math.floor(turns + 0.2) + Math.floor(Math.abs(p.rollAcc) / (Math.PI * 2) + 0.2);
      UP.set(0, 1, 0).applyQuaternion(p.q);
      if (flips >= (gl.n || 1) && UP.y > 0.3) { // on two wheels is fine: the car rights itself
        this.prec.push(G.clamp(1 - Math.abs(turns - Math.round(turns)) * 3, 0, 1));
        this.pass(flips > 1 ? `${flips}× FLIP!` : 'FLIP!');
      } else if (this.airT > 0.9 && (gl.strict !== false || flips)) this.fail(flips ? 'BAD LANDING' : 'NO FLIP');
    }

    pass(text) {
      const g = this.game;
      this.goal++;
      g.hud.popup(text, this.goal < this.spec.goals.length ? 'NEXT: ' + this.goalText(this.spec.goals[this.goal], true) : '', 'blue');
      G.audio.stunt();
      if (this.goal >= this.spec.goals.length) this.complete();
      else this.hint();
    }

    // a crash into a wall or a ledge ends the attempt
    onHit(vn) {
      const g = this.game;
      if (g.state !== 'race' || vn < 13) return;
      this.fail('CRASHED');
    }
    onReset() { if (this.game.state === 'race') this.fail(this.game.player.up && this.game.player.up.y < 0.2 ? 'FLIPPED' : 'RESTART'); }

    fail(reason) {
      const g = this.game;
      if (g.state !== 'race') return;
      g.state = 'cfail'; this.doneT = 0; this.failed = reason;
      if (!this.practice) this.lives--;
      g.hud.message(reason, 2000);
      const tip = this.level.tip;
      g.hud.popup(this.practice ? 'TRY AGAIN' : this.lives > 0 ? `${this.lives} ${this.lives === 1 ? 'LIFE' : 'LIVES'} LEFT` : 'NO LIVES LEFT', tip, 'warn');
      g.hud.chal(this);
      G.audio.impact(14);
    }
    afterFail() {
      if (this.lives <= 0) return this.results_(false);
      this.startAttempt(true);
    }

    complete() {
      const g = this.game, p = g.player, L = this.level;
      if (g.state !== 'race') return;
      g.state = 'cdone'; this.doneT = 0;
      const prec = this.prec.length ? this.prec.reduce((a, b) => a + b, 0) / this.prec.length : 0.5;
      const timeB = Math.round(Math.max(0, L.par - this.t) * 100);
      const precB = Math.round(prec * 500), firstB = this.tries === 1 ? 500 : 0, fuelB = Math.round(G.clamp(p.fuel / L.n2, 0, 1) * 300);
      const pts = 1000 + timeB + precB + firstB + fuelB;
      this.total += pts;
      this.results.push({ name: L.name, time: this.t, pts, tries: this.tries });
      const key = 'chalLvl_' + this.idx, best = G.store.get(key, 0);
      if (pts > best) G.store.set(key, pts);
      g.hud.message('LEVEL CLEAR', 2400);
      g.hud.popup(`+${pts.toLocaleString()}`, [timeB && `TIME +${timeB}`, `PRECISION +${precB}`, firstB && 'FIRST TRY +500', fuelB && `N₂ +${fuelB}`].filter(Boolean).join(' · '), 'big');
      // the end of an act gives a life back
      if (!this.practice && RUN.actLife && this.idx < this.last && RUN.acts.some((a) => a.from === this.idx + 1) && this.lives < RUN.lives) {
        this.lives++;
        setTimeout(() => { g.hud.popup(`ACT ${ROMAN[actOf(this.idx)]} CLEAR`, '+1 LIFE', 'blue'); g.hud.chal(this); }, 1300);
      }
      G.audio.stunt();
    }
    next() {
      if (this.idx >= this.last) return this.results_(true);
      this.load(this.idx + 1);
    }

    // the results card (and the leaderboard for a ranked run, finished or not)
    results_(cleared) {
      const g = this.game;
      g.state = 'finished'; g.finished = true;
      g.player.frozen = true;
      g.hud.chalIntroHide();
      const lifeB = cleared && !this.practice ? this.lives * 1000 : 0;
      this.total += lifeB;
      g.score = Math.round(this.total);
      const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
      $('res-title').textContent = this.practice ? (cleared ? 'LEVEL CLEAR' : 'PRACTICE OVER') : cleared ? 'RUN COMPLETE' : 'GAME OVER';
      const rows = this.results.map((r, i) => `<div class="row"><span class="p">${this.first + i + 1}</span><span class="n">${esc(r.name)}<small class="tries"> · ${r.tries === 1 ? 'first try' : r.tries + ' tries'}</small></span><span class="when">${G.fmtTime(r.time)}</span><span class="t">${r.pts.toLocaleString()}</span></div>`);
      if (!cleared && !this.practice) rows.push(`<div class="row dim"><span class="p">${this.idx + 1}</span><span class="n">${esc(this.level.name)}</span><span class="t">FAILED</span></div>`);
      if (lifeB) rows.push(`<div class="row"><span class="p">♥</span><span class="n">LIVES LEFT × ${this.lives}</span><span class="t">${lifeB.toLocaleString()}</span></div>`);
      $('res-rows').innerHTML = rows.join('');
      const best = G.store.get('chalBest', 0), isBest = !this.practice && this.total > best;
      if (isBest) G.store.set('chalBest', Math.round(this.total));
      $('res-stats').innerHTML = `<div><b>${Math.round(this.total).toLocaleString()}</b><small>${isBest ? 'NEW BEST SCORE' : 'SCORE'}</small></div>` +
        `<div><b>${this.results.length}/${this.count}</b><small>LEVELS</small></div><div><b>${G.fmtTime(this.runTime)}</b><small>TIME</small></div>`;
      $('btn-again').textContent = this.practice ? 'PLAY AGAIN' : 'NEW RUN';
      document.body.classList.remove('playing');
      $('results').classList.add('open');
      const el = $('res-board');
      if (this.practice) { el.textContent = 'Practice runs are not ranked: start a run from the Stunt Challenge menu.'; return; }
      this.submit_(el);
    }
    // a ranked run goes on the board as soon as it ends, finished or not (and when you quit it)
    submit_(el) {
      if (this.submitted || this.practice) return;
      if (this.total <= 0) { if (el) el.textContent = 'Clear a level to get on the leaderboard.'; return; }
      this.submitted = true;
      if (el) el.textContent = 'Sending to the leaderboard…';
      const g = this.game, c = this.course;
      G.api.submit({ name: g.settings.mpName, track: c.track, mode: 'chal', laps: c.laps, time_ms: Math.round(this.runTime * 1000), score: Math.round(this.total) })
        .then((r) => { if (el) el.innerHTML = `${r.best ? 'NEW PERSONAL BEST · ' : ''}<b>#${r.rank}</b> of ${r.total} on the Stunt Challenge leaderboard`; })
        .catch(() => { if (el) el.textContent = 'Leaderboard offline: this run was not saved.'; });
    }

    // camera: stay under ceilings (the garage) and above surfaces
    camClamp(x, y, z) {
      const q = this._cq || (this._cq = {});
      // camUp: on a steep slope the ground behind the car is far above it; look that high for it (no ceilings there)
      const up = this.spec && this.spec.camUp;
      this.world.groundAt(x, z, q, up ? Math.max(this.game.player.pos.y + 1.0, y + up) : this.game.player.pos.y + 1.0);
      if (q.ceil < Infinity) y = Math.min(y, q.ceil - 0.35);
      return Math.max(y, q.h + 0.6);
    }

    dispose() {
      const g = this.game;
      if (!this.submitted && !this.practice && this.results.length) {
        const best = G.store.get('chalBest', 0);
        if (this.total > best) G.store.set('chalBest', Math.round(this.total));
        this.submit_(null);
      }
      if (this.world) { this.world.exit(); this.world.dispose(); this.world = null; }
      g.track = this.realTrack;
      g.player.noRecharge = false; g.player.ride = null;
      g.hud.chal(null); g.hud.chalIntroHide();
    }
  }
  G.ChallengeRun = ChallengeRun;
})();
