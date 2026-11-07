// challenge.js — STUNT CHALLENGE: five hand-built stunt levels (rooftops, a container yard, an avenue, a parking
// garage, a skyline), each its own little world with its own sky and light, built when the level loads.
// One run = the five levels back to back on three shared lives; each level has a fixed N₂ budget (no recharge).
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
    at(x, z) { return this.grid.get(ckey(Math.floor(x / CELL), Math.floor(z / CELL))); }
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
      tip: 'Leave the ramp at 110 to 130 km/h',
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
        const RING_Y = 10.2;
        w.fireRing(0, RING_Y, -210, 3.2, { posts: true });
        w.ramp(w.m.plate, 0, 10, -215, 5, -255, 0);
        w.finishLine(0, 0, -320, 10);
        w.skyline({ seed: 33, keep: [[-80, 80, -400, 40]], hMin: 10, hMax: 40, radius: 700 });
        return {
          start: [0, 0, 6],
          goals: [{ type: 'ring', x: 0, y: RING_Y, z: -210, r: 3.2 }, { type: 'line', x: 0, y: 0, z: -320, hw: 10 }],
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

  // ---------------------------------------------------------------- a run
  class ChallengeRun {
    constructor(game, opt = {}) {
      this.game = game;
      this.practice = opt.level != null;
      this.first = this.practice ? opt.level : 0;
      this.last = this.practice ? opt.level : LEVELS.length - 1;
      this.lives = this.practice ? Infinity : 3;
      this.total = 0; this.runTime = 0;
      this.results = [];
      this.realTrack = game.track;
      this.load(this.first);
    }

    load(i) {
      const g = this.game;
      if (this.world) { this.world.exit(); this.world.dispose(); }
      this.idx = i; this.level = LEVELS[i];
      this.world = new World(g, this.level);
      this.spec = this.level.build(this.world);
      this.world.finalize();
      this.world.enter();
      g.track = stubTrack(this.world, this.spec);
      this.tries = 0;
      this.startAttempt(false);
    }

    startAttempt(retry) {
      const g = this.game, p = g.player, sp = this.spec;
      this.tries++;
      this.goal = 0; this.prec = []; this.t = 0; this.padT = 0; this.camHold = null; this.failed = null; this.doneT = 0;
      // place the car (what Player.place does, off the level's start)
      const [x, y, z] = sp.start;
      p.pos.set(x, y + 0.02, z);
      p.q.setFromAxisAngle(new T.Vector3(0, 1, 0), 0);
      p.vel.set(0, 0, 0); p.w.set(0, 0, 0); p.ride = null;
      for (const wh of p.wheels) { wh.comp = 0.1; wh.len = 0.45; wh.spinV = 0; }
      p.near.i = -1; g.track.nearest(p.pos.x, p.pos.z, -1, p.near);
      p.flipT = 0; p.airTime = 0;
      p.fuel = this.level.n2; p.fuelLock = false; p.noRecharge = true; p.infFuel = false;
      p.health = 100;
      g.lastS = p.near.s; g.progress = 0;
      g.state = 'countdown';
      g.cdT = retry ? 1.999 : 3.999; g.cdLast = -1; g.camIntro = retry ? 0.3 : 0;
      g.camYaw = 0;
      for (const gl of this.spec.goals) if (gl.led) gl.led.color.setRGB(4, 0.3, 0.2);
      for (const gl of this.spec.goals) gl.prevD = null;
      g.hud.chal(this);
      if (!retry) g.hud.message(this.level.name, 1800);
      else g.hud.message(`TRY ${this.tries}`, 1000);
      this.hint();
    }

    hint() {
      const g = this.game;
      const gl = this.spec.goals[this.goal];
      const t = !gl ? '' : gl.type === 'ring' ? 'FLY THROUGH THE RING' : gl.type === 'gate' ? `SPEED GATE · MIN ${gl.min} KM/H` : gl.type === 'pad' ? 'STOP INSIDE THE BOX' : 'REACH THE FINISH';
      g.hud.chalObjective(t);
    }

    // called every frame by the game
    update(dt, st) {
      const g = this.game, p = g.player;
      this.world.update(dt, g.camera, p.pos);
      if (st === 'race') {
        this.t += dt; this.runTime += dt;
        g.raceTime = this.t;
        this.check(dt);
        if (g.state === 'race' && this.t > this.level.limit) this.fail('OUT OF TIME');
      } else if (st === 'cfail') {
        this.doneT += dt;
        if (this.doneT > 2.2) this.afterFail();
      } else if (st === 'cdone') {
        this.doneT += dt;
        if (this.doneT > 3.0) this.next();
      }
      g.score = Math.round(this.total);
    }

    check(dt) {
      const g = this.game, p = g.player, sp = this.spec;
      const k = sp.kill(p);
      if (k) { this.camHold = g.camera.position.clone(); return this.fail(k === 'FELL' ? 'YOU FELL' : k); }
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

    pass(text) {
      const g = this.game;
      this.goal++;
      g.hud.popup(text, this.goal < this.spec.goals.length ? 'NEXT: ' + this.objText() : '', 'blue');
      G.audio.stunt();
      if (this.goal >= this.spec.goals.length) this.complete();
      else this.hint();
    }
    objText() { const gl = this.spec.goals[this.goal]; return !gl ? '' : gl.type === 'ring' ? 'THE RING' : gl.type === 'gate' ? `GATE · ${gl.min} KM/H` : gl.type === 'pad' ? 'STOP IN THE BOX' : 'FINISH'; }

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
      G.audio.stunt();
    }
    next() {
      if (this.idx >= this.last) return this.results_(true);
      this.load(this.idx + 1);
    }

    // the results card (and the leaderboard for a full run)
    results_(cleared) {
      const g = this.game;
      g.state = 'finished'; g.finished = true;
      g.player.frozen = true;
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
        `<div><b>${this.results.length}/${this.last - this.first + 1}</b><small>LEVELS</small></div><div><b>${G.fmtTime(this.runTime)}</b><small>TIME</small></div>`;
      $('btn-again').textContent = this.practice ? 'PLAY AGAIN' : 'NEW RUN';
      document.body.classList.remove('playing');
      $('results').classList.add('open');
      const el = $('res-board');
      if (this.practice) { el.textContent = 'Practice: only a full 5-level run goes on the leaderboard.'; return; }
      if (this.total <= 0 || this.runTime < 15) { el.textContent = 'Clear a level to get on the leaderboard.'; return; }
      el.textContent = 'Sending to the leaderboard…';
      G.api.submit({ name: g.settings.mpName, track: 'stunt', mode: 'chal', laps: 5, time_ms: Math.round(this.runTime * 1000), score: Math.round(this.total) })
        .then((r) => { el.innerHTML = `${r.best ? 'NEW PERSONAL BEST · ' : ''}<b>#${r.rank}</b> of ${r.total} on the Stunt Challenge leaderboard`; })
        .catch(() => { el.textContent = 'Leaderboard offline: this run was not saved.'; });
    }

    // camera: stay under ceilings (the garage) and above surfaces
    camClamp(x, y, z) {
      const q = this._cq || (this._cq = {});
      this.world.groundAt(x, z, q, this.game.player.pos.y + 1.0);
      if (q.ceil < Infinity) y = Math.min(y, q.ceil - 0.35);
      return Math.max(y, q.h + 0.6);
    }

    dispose() {
      const g = this.game;
      if (this.world) { this.world.exit(); this.world.dispose(); this.world = null; }
      g.track = this.realTrack;
      g.player.noRecharge = false;
      g.hud.chal(null);
    }
  }
  G.ChallengeRun = ChallengeRun;
})();
