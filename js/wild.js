// wild.js — the land around the wild circuits (RED ROCK, ALPINE): a terrain heightfield carved to fit the road (mesas,
// mountains, chasms under the gaps), tunnels and avalanche galleries, the cliff faces and broken bridges at the gaps,
// warning signs, the rock arch, the trestle and viaduct with their trains, the cable cars, and the decor.
// Everything here is looks only: the physics lives in track.js (decks, holes, roofs, spans) and car.js.
(function () {
  const T = THREE;

  // ---------- noise ----------
  const hash = (x, z) => {
    let h = Math.imul(x | 0, 374761393) ^ Math.imul(z | 0, 668265263);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  const vnoise = (x, z) => {
    const xi = Math.floor(x), zi = Math.floor(z), fx = x - xi, fz = z - zi;
    const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
    const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
  const fbm = (x, z, o = 4) => { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < o; k++) { s += a * vnoise(x * f + k * 17.3, z * f - k * 9.1); n += a; f *= 2.03; a *= 0.5; } return s / n; };
  const ridge = (x, z) => { let s = 0, a = 0.5, f = 1, n = 0; for (let k = 0; k < 5; k++) { const r = 1 - Math.abs(vnoise(x * f + 31, z * f - 7) * 2 - 1); s += a * r * r; n += a; f *= 2.07; a *= 0.5; } return s / n; };
  const sstep = (a, b, x) => { const t = G.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  G.buildWild = function (game) {
    const { scene, track: tr, Q } = game;
    const D = G.TRACK, theme = D.theme, alps = theme === 'alps';
    const N = tr.N, ds = tr.ds, WO = G.WALK_OUT;
    const R = G.rng(alps ? 777 : 555);
    const W = { update: null, setTod: null };
    const anim = []; // per-frame movers: (dt, t) => void

    // ================= terrain heightfield =================
    const cell = Q.level >= 4 ? 10 : Q.level >= 3 ? 12 : Q.level >= 2 ? 16 : 20;
    const M = 1400;
    const x0 = tr.minX - M, z0 = tr.minZ - M;
    const nx = Math.ceil((tr.maxX + M - x0) / cell) + 1, nz = Math.ceil((tr.maxZ + M - z0) / cell) + 1, n = nx * nz;
    const H = new Float32Array(n), dist = new Float32Array(n).fill(1e9), near = new Int32Array(n).fill(-1);
    // exact distance to the road close to it...
    const RAD = 90, rc = Math.ceil(RAD / cell);
    for (let i = 0; i < N; i++) {
      const px = tr.px[i], pz = tr.pz[i], cx = Math.round((px - x0) / cell), cz = Math.round((pz - z0) / cell);
      for (let a = -rc; a <= rc; a++) for (let b = -rc; b <= rc; b++) {
        const gx = cx + a, gz = cz + b;
        if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) continue;
        const k = gz * nx + gx, d = Math.hypot(x0 + gx * cell - px, z0 + gz * cell - pz);
        if (d < dist[k]) { dist[k] = d; near[k] = i; }
      }
    }
    // ...and a chamfer sweep for everything further out (carrying the nearest sample along)
    const D1 = cell, D2 = cell * Math.SQRT2;
    const relax = (k, j, w) => { if (dist[j] + w < dist[k]) { dist[k] = dist[j] + w; near[k] = near[j]; } };
    for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx;
      if (gx > 0) relax(k, k - 1, D1);
      if (gz > 0) { relax(k, k - nx, D1); if (gx > 0) relax(k, k - nx - 1, D2); if (gx < nx - 1) relax(k, k - nx + 1, D2); }
    }
    for (let gz = nz - 1; gz >= 0; gz--) for (let gx = nx - 1; gx >= 0; gx--) {
      const k = gz * nx + gx;
      if (gx < nx - 1) relax(k, k + 1, D1);
      if (gz < nz - 1) { relax(k, k + nx, D1); if (gx < nx - 1) relax(k, k + nx + 1, D2); if (gx > 0) relax(k, k + nx - 1, D2); }
    }
    // inside the loop? (scanline crossings of the centre line, per terrain row)
    const inside = new Uint8Array(n);
    {
      const P = []; for (let i = 0; i < N; i += 4) P.push([tr.px[i], tr.pz[i]]);
      for (let gz = 0; gz < nz; gz++) {
        const z = z0 + gz * cell, xs = [];
        for (let k = 0; k < P.length; k++) {
          const [ax, az] = P[k], [bx, bz] = P[(k + 1) % P.length];
          if ((az <= z) !== (bz <= z)) xs.push(ax + (z - az) / (bz - az) * (bx - ax));
        }
        xs.sort((a, b) => a - b);
        for (let k = 0; k + 1 < xs.length; k += 2) {
          const a = Math.max(0, Math.ceil((xs[k] - x0) / cell)), b = Math.min(nx - 1, Math.floor((xs[k + 1] - x0) / cell));
          for (let gx = a; gx <= b; gx++) inside[gz * nx + gx] = 1;
        }
      }
    }
    const isTunnel = (i) => tr.roof[i] > 0 && !(tunnelOf(i) || {}).side;
    const tunnelOf = (i) => tr.tunnels.find((t) => tr.sd(i * ds, t.s0) >= 0 && tr.sd(t.s1, i * ds) >= 0);

    // distant buttes / peaks scattered off the road
    const buttes = [];
    for (let k = 0; k < (alps ? 0 : 46); k++) {
      const bx = tr.minX - 900 + R() * (tr.maxX - tr.minX + 1800), bz = tr.minZ - 900 + R() * (tr.maxZ - tr.minZ + 1800);
      const gx = Math.round((bx - x0) / cell), gz = Math.round((bz - z0) / cell);
      const r0 = 28 + R() * 110;
      if (dist[gz * nx + gx] < r0 + 70) continue;
      buttes.push({ x: bx, z: bz, r: r0, h: 22 + R() * (r0 < 60 ? 110 : 70) });
    }

    for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx, x = x0 + gx * cell, z = z0 + gz * cell, d = dist[k], i = near[k];
      const rh = tr.py[i];
      let h;
      if (!alps) {
        // desert floor, mesas wherever the road climbs high, buttes in the distance
        h = 2.6 * fbm(x / 170, z / 170) + 1.1 * fbm(x / 35, z / 35, 2);
        if (rh > 4 && !tr.hole[i]) {
          const Rm = 30 + rh * 3.1 + 34 * (fbm(x / 90, z / 90, 3) - 0.5);
          h = Math.max(h, (rh - 0.4 + (d > 30 ? 3 * fbm(x / 60, z / 60, 2) : 0)) * (1 - sstep(Rm, Rm + 16, d)));
        }
        for (const b of buttes) {
          const bd = Math.hypot(x - b.x, z - b.z), rr = b.r * (0.85 + 0.3 * fbm(x / 50 + b.x, z / 50, 2));
          if (bd < rr + 20) h = Math.max(h, b.h * (1 - sstep(rr, rr + 18, bd)));
        }
      } else {
        // snowy valley inside the loop, mountains around it rising from the road
        const valley = inside[k] ? rh * (1 - sstep(40, 380, d)) : rh;
        const m = (inside[k] ? sstep(120, 520, d) * (30 + 120 * ridge(x / 520, z / 520)) : sstep(50, 520, d) * (110 + 420 * ridge(x / 650, z / 650)));
        h = valley + m + 6 * fbm(x / 120, z / 120, 3);
      }
      // the rock a tunnel goes through
      if (isTunnel(i) && d < 110) h = Math.max(h, (rh + tr.roof[i] + 28 + 10 * fbm(x / 40, z / 40, 2)) * (1 - sstep(60, 110, d)) + h * sstep(60, 110, d));
      // the road corridor: flat under the road, then a cut or a fill out to the natural ground
      if (!isTunnel(i)) {
        const w = 1 - sstep(WO + cell * 0.8, WO + cell * 0.8 + (alps ? 30 : 42), d);
        h = h + (rh - 0.35 - h) * w;
      }
      H[k] = h;
    }
    // chasms under the gaps: a canyon across the road that meanders off on either side
    for (const g of tr.gaps) {
      if (g.inTunnel) continue;
      const c = tr.sample(g.s0 + g.len / 2, {}), seed = g.s0 * 0.013;
      const cs = Math.ceil(700 / cell), cgx = Math.round((c.x - x0) / cell), cgz = Math.round((c.z - z0) / cell);
      g.meander = (u) => 26 * Math.sin(u / 85 + seed) * sstep(g.big ? 140 : 25, g.big ? 300 : 140, Math.abs(u));
      g.hw = (u) => g.len / 2 + 1 + (g.big ? Math.max(0, Math.abs(u) - 140) * 0.2 : Math.max(0, Math.abs(u) - 30) * 0.06);
      for (let a = -cs; a <= cs; a++) for (let b = -cs; b <= cs; b++) {
        const gx = cgx + a, gz = cgz + b;
        if (gx < 0 || gz < 0 || gx >= nx || gz >= nz) continue;
        const k = gz * nx + gx, x = x0 + gx * cell - c.x, z = z0 + gz * cell - c.z;
        const along = x * c.tx + z * c.tz, u = x * c.rx + z * c.rz;
        if (Math.abs(u) > 650) continue;
        // never cut into another stretch of the circuit
        if (dist[k] < WO + 30 && Math.abs(tr.sd(near[k] * ds, g.s0 + g.len / 2)) > g.len / 2 + 80) continue;
        const hw = g.hw(u), f = 1 - sstep(hw - cell * 1.15, hw, Math.abs(along - g.meander(u)));
        if (f > 0) H[k] = H[k] + (g.floor + 1.5 * fbm(x / 20, z / 20, 2) - H[k]) * f;
      }
    }
    const hAt = (x, z) => {
      const fx = G.clamp((x - x0) / cell, 0, nx - 1.001), fz = G.clamp((z - z0) / cell, 0, nz - 1.001);
      const gx = Math.floor(fx), gz = Math.floor(fz), u = fx - gx, v = fz - gz, k = gz * nx + gx;
      return (H[k] * (1 - u) + H[k + 1] * u) * (1 - v) + (H[k + nx] * (1 - u) + H[k + nx + 1] * u) * v;
    };
    const slopeAt = (x, z) => Math.hypot(hAt(x + 3, z) - hAt(x - 3, z), hAt(x, z + 3) - hAt(x, z - 3)) / 6;
    const distAt = (x, z) => dist[G.clamp(Math.round((z - z0) / cell), 0, nz - 1) * nx + G.clamp(Math.round((x - x0) / cell), 0, nx - 1)];
    W.hAt = hAt;

    // mesh
    {
      const pos = new Float32Array(n * 3);
      for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) { const k = gz * nx + gx; pos.set([x0 + gx * cell, H[k], z0 + gz * cell], k * 3); }
      const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
      let q = 0;
      for (let gz = 0; gz < nz - 1; gz++) for (let gx = 0; gx < nx - 1; gx++) {
        const a = gz * nx + gx, b = a + 1, c = a + nx, d = c + 1;
        idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d;
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setIndex(new T.BufferAttribute(idx, 1));
      g.computeVertexNormals();
      const ground = new T.Mesh(g, (W.landMat = landMaterial(alps)));
      ground.receiveShadow = Q.shadows; ground.frustumCulled = false;
      scene.add(ground);
    }

    // ================= rock / snow / wood / steel materials =================
    const rockMat = W.landMat; // the land shader also reads well on instanced rock (strata by world height)
    const steel = new T.MeshStandardMaterial({ color: alps ? 0x3a3f46 : 0x5a3a28, roughness: 0.6, metalness: 0.6 });
    const conc = new T.MeshStandardMaterial({ color: alps ? 0x8c8f94 : 0xa08470, roughness: 0.9 });
    const dark = new T.MeshStandardMaterial({ color: 0x1b1c1f, roughness: 0.9 });
    const m4 = new T.Matrix4(), qq = new T.Quaternion(), ps = new T.Vector3(), sc = new T.Vector3(), up = new T.Vector3(0, 1, 0), eu = new T.Euler();
    const yawOf = (p) => Math.atan2(-p.tx, -p.tz); // local -Z down the road, local +X to its right

    // a strip along the road between two samples (like track.ribbon, for a stretch)
    const strip = (i0, i1, latA, yA, latB, yB, vLen = 8) => {
      const rows = i1 - i0 + 1, pos = new Float32Array(rows * 6), uv = new Float32Array(rows * 4), idx = [];
      for (let r = 0; r < rows; r++) {
        const i = (i0 + r) % N, rx = -tr.tz[i], rz = tr.tx[i], y = tr.py[i];
        pos.set([tr.px[i] + rx * latA, yA + y, tr.pz[i] + rz * latA, tr.px[i] + rx * latB, yB + y, tr.pz[i] + rz * latB], r * 6);
        uv.set([0, (r * ds) / vLen, 1, (r * ds) / vLen], r * 4);
        if (r < rows - 1) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3)); g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      return g;
    };
    const idxOf = (s) => Math.round(G.wrap(s, tr.length) / ds);

    // ================= tunnels & galleries =================
    const tileTex = G.canvasTexture(256, 256, (ctx, Wd, Ht) => {
      ctx.fillStyle = alps ? '#b9bcbf' : '#c2a68e'; ctx.fillRect(0, 0, Wd, Ht);
      const r = G.rng(13);
      for (let i = 0; i < 3000; i++) { const g = r() * 40 | 0; ctx.fillStyle = `rgba(${g},${g},${g},0.25)`; ctx.fillRect(r() * Wd, r() * Ht, 2, 2); }
      ctx.strokeStyle = 'rgba(40,40,40,0.55)'; ctx.lineWidth = 3;
      for (let k = 0; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(0, k * Ht / 4); ctx.lineTo(Wd, k * Ht / 4); ctx.stroke(); ctx.beginPath(); ctx.moveTo(k * Wd / 4, 0); ctx.lineTo(k * Wd / 4, Ht); ctx.stroke(); }
      // dirty lower band
      const gr = ctx.createLinearGradient(0, 0, Wd, 0); gr.addColorStop(0, 'rgba(20,20,20,0.6)'); gr.addColorStop(0.35, 'rgba(20,20,20,0)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, Wd, Ht);
    }, { repeat: true });
    const wallMat = new T.MeshStandardMaterial({ map: tileTex, color: 0x9a9a9a, roughness: 0.6, metalness: 0.05, side: T.DoubleSide });
    const ceilMat = new T.MeshStandardMaterial({ color: 0x25272b, roughness: 0.95, side: T.DoubleSide });
    const dashTex = G.canvasTexture(16, 128, (ctx, Wd, Ht) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, Wd, Ht); ctx.fillStyle = '#fff'; ctx.fillRect(0, 8, Wd, Ht * 0.55); }, { repeat: true, srgb: false });
    const tubeLight = new T.MeshBasicMaterial({ map: dashTex, color: alps ? new T.Color(3.2, 2.9, 2.4) : new T.Color(4, 1.9, 0.55), toneMapped: false, side: T.DoubleSide });
    const poolMat = new T.MeshBasicMaterial({ map: G.softSprite(), color: alps ? new T.Color(0.45, 0.43, 0.38) : new T.Color(0.6, 0.34, 0.12), blending: T.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const pools = [];
    for (const t of tr.tunnels) {
      const i0 = idxOf(t.s0), i1 = i0 + Math.round((t.s1 - t.s0) / ds), h = t.h, side = t.side || 0;
      const g = new T.Group();
      for (const sg of [-1, 1]) {
        if (sg === side) continue; // the gallery's open side
        g.add(new T.Mesh(strip(i0, i1, sg * (WO + 0.05), 0, sg * (WO + 0.05), h - 1.2, 6), wallMat));
        g.add(new T.Mesh(strip(i0, i1, sg * (WO - 0.6), h - 1.9, sg * (WO - 0.6), h - 1.6, 3.2), tubeLight)); // light line
      }
      const ceil = [new T.Mesh(strip(i0, i1, -WO - 0.05, h - 1.2, 0, h, 8), ceilMat), new T.Mesh(strip(i0, i1, 0, h, WO + 0.05, h - 1.2, 8), ceilMat)];
      for (const m of ceil) { m.castShadow = Q.shadows; m.receiveShadow = true; g.add(m); }
      for (let i = i0 + 3; i < i1 - 2; i += 6) pools.push(i % N);
      if (side) {
        // gallery: concrete roof slab with snow on it, pillars along the open side
        g.add(new T.Mesh(strip(i0, i1, -WO - 1.2, h + 1.0, WO + 1.2, h + 1.0, 8), new T.MeshStandardMaterial({ color: 0xeef2f6, roughness: 0.9 })));
        g.add(new T.Mesh(strip(i0, i1, side * (WO + 1.2), h + 1.0, side * (WO + 1.2), h - 1.2, 8), conc));
        const cnt = Math.floor((i1 - i0) / 5), pil = new T.InstancedMesh(new T.BoxGeometry(1.1, 1, 1.4), conc, cnt);
        for (let k = 0; k < cnt; k++) {
          const i = (i0 + k * 5 + 2) % N, p = tr.sample(i * ds, {}), y = tr.py[i];
          m4.compose(ps.set(p.x + p.rx * side * (WO + 0.6), y + (h - 0.6) / 2, p.z + p.rz * side * (WO + 0.6)), qq.setFromAxisAngle(up, yawOf(p)), sc.set(1, h - 0.6, 1));
          pil.setMatrixAt(k, m4);
        }
        pil.castShadow = Q.shadows; g.add(pil);
      }
      // portals
      for (const [s, dir] of [[t.s0, 1], [t.s1, -1]]) {
        const p = tr.sample(s, {}), y = tr.heightAt(s), port = new T.Group();
        port.position.set(p.x, y, p.z); port.rotation.y = yawOf(p);
        const span = WO + (side ? 2 : 16), top = side ? 2.2 : 16;
        const mat = side ? conc : (alps ? conc : rockMat);
        const lint = new T.Mesh(new T.BoxGeometry(2 * span, top, 3), mat); lint.position.set(0, h + top / 2, 0); port.add(lint);
        if (!side) for (const sg of [-1, 1]) { const leg = new T.Mesh(new T.BoxGeometry(span - WO, h + 0.5, 3), mat); leg.position.set(sg * (WO + (span - WO) / 2), (h + 0.5) / 2 - 0.5, 0); port.add(leg); }
        // name board over the mouth
        const board = new T.Mesh(new T.PlaneGeometry(14, 1.8), signMaterial(t.name, '#ffd23a', '#121315'));
        board.position.set(0, h + 1.1, dir * 1.56); if (dir < 0) board.rotation.y = Math.PI; port.add(board);
        port.traverse((o) => { if (o.isMesh) { o.castShadow = Q.shadows; o.receiveShadow = true; } });
        g.add(port);
      }
      scene.add(g);
    }
    if (pools.length) {
      const pm = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, pools.length);
      pools.forEach((i, k) => { m4.compose(ps.set(tr.px[i], tr.py[i] + 0.03, tr.pz[i]), qq.identity(), sc.set(11, 1, 11)); pm.setMatrixAt(k, m4); });
      pm.frustumCulled = false; scene.add(pm);
    }

    // ================= gaps: cliff faces, warning lights, broken bridges, the pit in the tunnel, water =================
    const lights = []; // [x, y, z, kind] kind 0 = red edge, 1 = green landing
    const stripeTex = G.canvasTexture(256, 32, (ctx, Wd, Ht) => { for (let x = -Ht; x < Wd; x += 32) { ctx.fillStyle = '#f5c518'; ctx.beginPath(); ctx.moveTo(x, Ht); ctx.lineTo(x + 16, Ht); ctx.lineTo(x + 16 + Ht, 0); ctx.lineTo(x + Ht, 0); ctx.fill(); } }, { repeat: true });
    const stripeMat = new T.MeshStandardMaterial({ map: stripeTex, roughness: 0.6, color: 0xffffff, emissive: 0x332200, polygonOffset: true, polygonOffsetFactor: -2 });
    stripeTex.repeat.set(6, 1);
    for (const g of tr.gaps) {
      for (const [s, face] of [[g.s0, 1], [g.s1, -1]]) {
        const p = tr.sample(s, {}), y = tr.heightAt(s), far = face < 0;
        let bot = g.floor - 2;
        if (!g.inTunnel) { bot = 1e9; for (let l = -WO - 6; l <= WO + 6; l += 4) { const q = tr.sample(s + face * 7, {}); bot = Math.min(bot, hAt(q.x + q.rx * l, q.z + q.rz * l) - 3); } bot = Math.max(bot, g.floor - 2); }
        const depth = y - bot;
        const width = g.inTunnel ? 2 * WO : 2 * (WO + 7);
        // the cliff (or the shaft wall in the tunnel) under the road end, facing into the gap
        const cg = new T.PlaneGeometry(width, depth, 10, 6);
        if (!g.inTunnel) {
          // ragged rock: narrows into a V as it goes down, bulges in and out, uneven bottom edge
          const pa = cg.attributes.position;
          for (let v = 0; v < pa.count; v++) {
            const x = pa.getX(v), y = pa.getY(v), k = (depth / 2 - y) / depth; // 0 at the road, 1 at the bottom
            const jig = Math.sin(x * 0.7 + y * 0.9 + s) * 0.5 + Math.sin(x * 1.9 - y * 1.3) * 0.5;
            pa.setX(v, x * (1 - 0.5 * k * k));
            if (k > 0.02) { pa.setZ(v, jig * 1.6 * Math.sqrt(k)); pa.setY(v, y + jig * 1.2 * k); }
          }
          cg.computeVertexNormals();
        }
        const cliff = new T.Mesh(cg, g.inTunnel ? dark : rockMat);
        cliff.position.set(p.x, y - depth / 2, p.z);
        cliff.rotation.y = yawOf(p) + (face > 0 ? Math.PI : 0);
        scene.add(cliff);
        // hazard stripe along the edge, lights along it: red on the take-off side, green where you land
        if (!(g.kick && !far)) {
          const st = new T.Mesh(new T.PlaneGeometry(2 * G.ROAD_HALF, 1.2).rotateX(-Math.PI / 2), stripeMat);
          st.position.set(p.x - p.tx * face * 0.7, y + 0.02, p.z - p.tz * face * 0.7); st.rotation.y = yawOf(p); scene.add(st);
        }
        for (let l = -WO + 0.6; l <= WO - 0.5; l += (2 * WO - 1.1) / 7) lights.push([p.x + p.rx * l - p.tx * face * 0.2, y + (g.kick && !far ? g.kick.h + 0.25 : 0.25), p.z + p.rz * l - p.tz * face * 0.2, far ? 1 : 0]);
      }
      if (g.inTunnel) {
        // the shaft: side walls down to the bottom, a glow from below
        const i0 = idxOf(g.s0), i1 = idxOf(g.s1);
        const rel = g.floor - tr.heightAt(g.s0);
        for (const sg of [-1, 1]) scene.add(new T.Mesh(strip(i0, i1, sg * WO, 0, sg * WO, rel, 6), dark));
        const glow = new T.Mesh(strip(i0, i1, -WO, rel + 0.5, WO, rel + 0.5, 6), new T.MeshBasicMaterial({ color: new T.Color(1.6, 0.25, 0.05), toneMapped: false }));
        scene.add(glow);
      }
      if (g.broken) buildBrokenBridge(g);
      if (g.water) buildWater(g);
      // warning signs ahead of it (on the roadside, or hung from the roof in a tunnel)
      for (const back of [300, 170]) {
        const s = g.s0 - (g.kick ? g.kick.len : 0) - back, p = tr.sample(s, {}), y = tr.heightAt(s), roof = tr.roofAt(s);
        if (tr.gapAt(s)) continue;
        const txt = back > 200 ? g.name : (g.kick ? 'FULL SPEED' : 'HOLD THRUST'), sub = back > 200 ? Math.round(g.len) + ' m GAP AHEAD' : g.kick ? 'JUMP ' + Math.round(g.len) + ' m' : 'NO ROAD ' + Math.round(g.len) + ' m';
        const mat = signMaterial(txt, back > 200 ? '#ffd23a' : '#ff4a3a', '#141518', sub);
        if (roof) {
          const b = new T.Mesh(new T.PlaneGeometry(12, 2.6), mat);
          b.position.set(p.x, y + roof - 2.6, p.z); b.rotation.y = yawOf(p) + Math.PI; scene.add(b);
        } else {
          for (const sg of [-1, 1]) {
            const grp = new T.Group(); grp.position.set(p.x + p.rx * sg * (WO + 2.6), y, p.z + p.rz * sg * (WO + 2.6)); grp.rotation.y = yawOf(p) + Math.PI - sg * 0.25;
            const b = new T.Mesh(new T.PlaneGeometry(7, 3.4), mat); b.position.y = 5.2; grp.add(b);
            const back2 = new T.Mesh(new T.BoxGeometry(7.2, 3.6, 0.2), dark); back2.position.set(0, 5.2, -0.12); grp.add(back2);
            for (const px of [-2.6, 2.6]) { const post = new T.Mesh(new T.BoxGeometry(0.25, 4, 0.25), steel); post.position.set(px, 2, -0.2); grp.add(post); }
            scene.add(grp);
          }
        }
      }
    }
    const lampGeo = new T.SphereGeometry(0.22, 8, 6);
    const edgeL = new T.InstancedMesh(lampGeo, new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), lights.length);
    lights.forEach((l, k) => { m4.makeTranslation(l[0], l[1], l[2]); edgeL.setMatrixAt(k, m4); });
    edgeL.frustumCulled = false; scene.add(edgeL);
    const lcol = new T.Color();
    anim.push((dt, t) => {
      const on = Math.sin(t * 9) > 0;
      lights.forEach((l, k) => edgeL.setColorAt(k, l[3] ? lcol.setRGB(0.3, 4, 1.2) : on ? lcol.setRGB(6, 0.3, 0.1) : lcol.setRGB(0.5, 0.03, 0.02)));
      edgeL.instanceColor.needsUpdate = true;
    });

    // a steel truss bridge torn apart over the gap: girders run out over the drop on both sides and stop, ragged
    function buildBrokenBridge(g) {
      const parts = [];
      const add = (s, l, y, w, hgt, len, yawAdd = 0, roll = 0) => {
        const p = tr.sample(s, {});
        parts.push({ x: p.x + p.rx * l, y: y.abs, z: p.z + p.rz * l, yaw: yawOf(p) + yawAdd, roll, w, hgt, len });
      };
      for (const [a, b, h0] of [[g.s0 - 46, g.s0 + 7, g.hNear], [g.s1 - 7, g.s1 + 46, g.hFar]]) {
        for (const sg of [-1, 1]) {
          const l = sg * (WO + 0.45);
          for (let s = a; s < b; s += 6) {
            const torn = s > g.s0 && s < g.s1, droop = torn ? (s < g.s0 + 10 ? (s - g.s0) * 0.35 : (g.s1 - s) * 0.35) : 0;
            add(s + 3, l, { abs: h0 + 4.2 - droop }, 0.35, 0.45, 6.2, 0, torn ? sg * 0.05 : 0);   // top chord
            add(s, l, { abs: h0 + 2.1 - droop * 0.5 }, 0.3, 4.2, 0.3);                           // post
            add(s + 3, l, { abs: h0 + 2.1 - droop * 0.7 }, 0.22, 0.22, 7.2, 0, 0.6 * (((s / 6) | 0) % 2 ? 1 : -1)); // diagonal
            if (torn || s < a + 1 || s > b - 7) continue;
            add(s, 0, { abs: h0 + 4.4 }, 2 * WO + 1, 0.3, 0.35); // cross beam overhead
          }
        }
        // the deck slab, hanging off the end over the drop
        const end = a < g.s0 ? g.s0 : g.s1, dir = a < g.s0 ? 1 : -1;
        add(end + dir * 3.2, 0, { abs: h0 - 0.9 - 0.8 }, 2 * WO, 1.4, 6.5, 0, 0);
      }
      const box = new T.BoxGeometry(1, 1, 1);
      const mesh = new T.InstancedMesh(box, steel, parts.length);
      parts.forEach((q, k) => {
        qq.setFromEuler(eu.set(q.roll, q.yaw, 0, 'YXZ'));
        m4.compose(ps.set(q.x, q.y, q.z), qq, sc.set(q.w, q.hgt, q.len)); mesh.setMatrixAt(k, m4);
      });
      mesh.castShadow = Q.shadows; mesh.receiveShadow = true; mesh.frustumCulled = false;
      scene.add(mesh);
      // piers standing in the gorge under the two ends
      for (const [s, h0] of [[g.s0 - 30, g.hNear], [g.s1 + 30, g.hFar]]) {
        const p = tr.sample(s, {}), fy = Math.min(hAt(p.x, p.z), h0 - 4);
        for (const sg of [-1, 1]) {
          const pier = new T.Mesh(new T.BoxGeometry(2.2, h0 - fy, 3), conc);
          pier.position.set(p.x + p.rx * sg * (WO - 1), (h0 + fy) / 2 - 1, p.z + p.rz * sg * (WO - 1)); pier.rotation.y = yawOf(p);
          scene.add(pier);
        }
      }
    }

    function buildWater(g) {
      const c = tr.sample(g.s0 + g.len / 2, {}), pos = [], idx = [], y = g.floor + 2.4;
      const S = 64, E = 640;
      for (let k = 0; k <= S; k++) {
        const u = -E + (2 * E * k) / S, a = g.meander(u), hw = g.hw(u) * 0.75;
        for (const sg of [-1, 1]) pos.push(c.x + c.rx * u + c.tx * (a + sg * hw), y, c.z + c.rz * u + c.tz * (a + sg * hw));
        if (k < S) { const q = k * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setIndex(idx); geo.computeVertexNormals();
      const water = new T.Mesh(geo, new T.MeshStandardMaterial({ color: alps ? 0x7fa8bd : 0x3a8c96, roughness: alps ? 0.3 : 0.12, metalness: 0.1, emissive: alps ? 0x0c1820 : 0x082226, side: T.DoubleSide }));
      scene.add(water);
    }

    // ================= spans over the road =================
    for (const sp of tr.spans || []) {
      const g = new T.Group();
      g.position.set(sp.x, 0, sp.z); g.rotation.y = yawOf(sp);
      const groundAt = (u) => hAt(sp.x + sp.rx * u, sp.z + sp.rz * u);
      if (sp.kind === 'arch') {
        // two sandstone spires out of the river canyon, joined by a natural arch you fly under
        const Rr = WO + 12, tube = 4.2, cy = sp.y0 - Rr + tube;
        const arc = new T.Mesh(new T.TorusGeometry(Rr, tube, 8, 26, Math.PI), rockMat);
        arc.position.y = cy; arc.scale.z = 1.2; g.add(arc);
        for (const sg of [-1, 1]) {
          const fy = Math.min(groundAt(sg * Rr), sp.base - 30);
          const sp1 = new T.Mesh(new T.CylinderGeometry(tube * 1.15, tube * 1.9, cy - fy + 2, 9, 4), rockMat);
          sp1.position.set(sg * Rr, (cy + fy) / 2, 0); g.add(sp1);
        }
      } else if (sp.kind === 'trestle' || sp.kind === 'viaduct') {
        const E = 320, via = sp.kind === 'viaduct';
        const deckMat = via ? new T.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.95 }) : steel;
        const deck = new T.Mesh(new T.BoxGeometry(2 * E, sp.y1 - sp.y0, 6), deckMat); deck.position.y = (sp.y0 + sp.y1) / 2; g.add(deck);
        for (const sg of [-0.9, 0.9]) { const rail = new T.Mesh(new T.BoxGeometry(2 * E, 0.25, 0.15), steel); rail.position.set(0, sp.y1 + 0.12, sg); g.add(rail); }
        // legs (lattice towers) or stone piers, never inside the road corridor
        const step = via ? 34 : 26, legs = [];
        for (let u = -E + step / 2; u < E; u += step) {
          if (Math.abs(u) < WO + 8) continue;
          legs.push([u, groundAt(u)]);
        }
        let pm;
        if (via) {
          pm = new T.InstancedMesh(new T.BoxGeometry(5, 1, 6.5), deckMat, legs.length);
          legs.forEach(([u, fy], k) => { const hgt = sp.y0 - fy + 2; m4.compose(ps.set(u, fy - 2 + hgt / 2, 0), qq.identity(), sc.set(1, hgt, 1)); pm.setMatrixAt(k, m4); });
        } else {
          // steel lattice towers: a square frustum with a cross-braced see-through skin
          const lat = G.canvasTexture(64, 64, (ctx, Wd, Ht) => {
            ctx.clearRect(0, 0, Wd, Ht); ctx.strokeStyle = '#fff'; ctx.lineWidth = 5;
            ctx.strokeRect(2, 2, Wd - 4, Ht - 4); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Wd, Ht); ctx.moveTo(Wd, 0); ctx.lineTo(0, Ht); ctx.stroke();
          }, { repeat: true });
          lat.repeat.set(1, 7);
          const lm = new T.MeshStandardMaterial({ color: 0x5a3020, map: lat, alphaTest: 0.5, side: T.DoubleSide, roughness: 0.7, metalness: 0.4 });
          const tg = new T.CylinderGeometry(2.4, 4.2, 1, 4, 1, true); tg.rotateY(Math.PI / 4); tg.translate(0, 0.5, 0);
          pm = new T.InstancedMesh(tg, lm, legs.length);
          legs.forEach(([u, fy], k) => { const hgt = sp.y0 - fy + 1; m4.compose(ps.set(u, fy - 1, 0), qq.identity(), sc.set(1, hgt, 1)); pm.setMatrixAt(k, m4); });
        }
        let k = legs.length;
        pm.count = k; pm.castShadow = Q.shadows; g.add(pm);
        if (via) {
          // a stone spandrel wall over each bay with the arch cut out of it
          const bayW = step - 5, rr = bayW / 2, hgtW = rr + 1.2;
          const shp = new T.Shape(); shp.moveTo(-bayW / 2, -hgtW); shp.lineTo(bayW / 2, -hgtW); shp.lineTo(bayW / 2, 0); shp.lineTo(-bayW / 2, 0); shp.lineTo(-bayW / 2, -hgtW);
          const hole = new T.Path(); hole.moveTo(-rr, -hgtW); hole.absarc(0, -hgtW, rr, Math.PI, 0, true); hole.lineTo(-rr, -hgtW); shp.holes.push(hole);
          const sg = new T.ExtrudeGeometry(shp, { depth: 6.5, bevelEnabled: false }); sg.translate(0, 0, -3.25);
          const am = new T.InstancedMesh(sg, deckMat, legs.length + 1);
          let a = 0;
          for (let j = 0; j + 1 < legs.length; j++) if (legs[j + 1][0] - legs[j][0] < step + 1) { m4.compose(ps.set((legs[j][0] + legs[j + 1][0]) / 2, sp.y0, 0), qq.identity(), sc.set(1, 1, 1)); am.setMatrixAt(a++, m4); }
          am.count = a; g.add(am);
        } else {
          // a girder span over the road, deep enough to read as the bit holding the track up
          for (const sz of [-2.8, 2.8]) { const gd = new T.Mesh(new T.BoxGeometry(2 * (WO + 9), 2.2, 0.4), steel); gd.position.set(0, sp.y0 + 1.1, sz); g.add(gd); }
        }
        // the train: rolls across, out of sight, and back round
        const train = makeTrain(via);
        train.position.y = sp.y1 + 0.2; g.add(train);
        const len = train.userData.len, speed = via ? 22 : 15, off = R() * 100;
        anim.push((dt, t) => { train.position.x = G.wrap(t * speed + off, 2 * E + len + 400) - E - len / 2 - 200; train.visible = Math.abs(train.position.x) < E + len; });
      } else if (sp.kind === 'gondola') {
        // two cables high over the jump, towers on the slopes, red cabins going both ways
        const cy = sp.y0 + 2.7 + 3.2;
        for (const off of [-3.5, 3.5]) {
          const cab = new T.Mesh(new T.CylinderGeometry(0.05, 0.05, 2 * sp.E, 5), steel); cab.rotation.z = Math.PI / 2; cab.position.set(0, cy, off); g.add(cab);
        }
        for (const u of [-sp.E + 10, -140, 140, sp.E - 10]) {
          const fy = groundAt(u), hgt = cy - fy + 2;
          const tw = new T.Mesh(new T.BoxGeometry(1.4, hgt, 1.4), steel); tw.position.set(u, fy + hgt / 2 - 1, 0); g.add(tw);
          const arm = new T.Mesh(new T.BoxGeometry(1, 0.8, 9), steel); arm.position.set(u, cy + 0.6, 0); g.add(arm);
        }
        const cabGeo = new T.BoxGeometry(3.2, 2.7, 2.5), red = new T.MeshStandardMaterial({ color: 0xd4191f, roughness: 0.35, metalness: 0.3 });
        const winMat = new T.MeshStandardMaterial({ color: 0x0b0e12, roughness: 0.05, metalness: 0.6, emissive: 0x332a18 });
        const cabs = sp.cabins.map((c) => {
          const cg = new T.Group();
          const body = new T.Mesh(cabGeo, red); body.position.y = 1.35; body.castShadow = Q.shadows; cg.add(body);
          const win = new T.Mesh(new T.BoxGeometry(3.25, 0.9, 2.55), winMat); win.position.y = 1.85; cg.add(win);
          const rod = new T.Mesh(new T.BoxGeometry(0.15, 3.2, 0.15), steel); rod.position.y = 2.7 + 1.6; cg.add(rod);
          scene.add(cg);
          return [c, cg];
        });
        anim.push(() => { for (const [c, cg] of cabs) { cg.position.set(c.x, c.y0, c.z); cg.rotation.y = yawOf(sp); } });
      }
      g.traverse((o) => { if (o.isMesh) { o.castShadow = o.castShadow || Q.shadows; o.receiveShadow = true; } });
      scene.add(g);
    }

    function makeTrain(swiss) {
      const g = new T.Group();
      const cols = swiss ? [0xc8141b, 0xc8141b, 0xc8141b, 0xc8141b] : [0xe0a020, 0x6b3a26, 0x2e4a5c, 0x7a6a50, 0x3d3d40, 0x6b3a26, 0x8a2e20, 0x2e4a5c];
      let x = 0;
      cols.forEach((c, k) => {
        const len = swiss ? 24 : k ? 15 : 20, hgt = swiss ? 4 : k ? 3.6 : 4.4;
        const car = new T.Mesh(new T.BoxGeometry(len, hgt, 3.1), new T.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.3 }));
        car.position.set(x + len / 2, hgt / 2 + 0.6, 0); g.add(car);
        if (swiss) {
          const win = new T.Mesh(new T.BoxGeometry(len - 1, 1, 3.15), new T.MeshStandardMaterial({ color: 0x0b0e12, emissive: 0x6a5530, emissiveIntensity: 1.2, roughness: 0.1 }));
          win.position.set(x + len / 2, 2.9, 0); g.add(win);
        }
        if (!k) {
          const lamp = new T.Mesh(new T.BoxGeometry(0.3, 0.5, 1.6), new T.MeshBasicMaterial({ color: new T.Color(6, 5.4, 4), toneMapped: false }));
          lamp.position.set(-0.1, 1.8, 0); g.add(lamp);
        }
        x += len + 0.8;
      });
      g.userData.len = x;
      return g;
    }

    // ================= decor =================
    const placeScatter = (count, ok) => {
      const out = [];
      for (let k = 0; k < count * 6 && out.length < count; k++) {
        const x = tr.minX - 700 + R() * (tr.maxX - tr.minX + 1400), z = tr.minZ - 700 + R() * (tr.maxZ - tr.minZ + 1400);
        const d = distAt(x, z), y = hAt(x, z);
        if (ok(x, z, d, y)) out.push([x, y, z, R()]);
      }
      return out;
    };
    const instance = (geo, mat, list, f) => {
      const m = new T.InstancedMesh(geo, mat, list.length);
      list.forEach((it, k) => { f(it, m4, k); m.setMatrixAt(k, m4); });
      m.castShadow = Q.shadows; m.receiveShadow = true; m.frustumCulled = false;
      scene.add(m); return m;
    };
    const dens = Q.cityDensity;
    const offRoad = (d, pad) => d > WO + pad;
    const notChasm = (x, z) => !tr.gaps.some((g) => { const c = tr.sample(g.s0 + g.len / 2, {}); return Math.hypot(x - c.x, z - c.z) < g.len + 40; });
    if (!alps) {
      // saguaros
      const sag = [new T.CylinderGeometry(0.38, 0.45, 6.5, 8).translate(0, 3.25, 0), new T.SphereGeometry(0.38, 8, 5).translate(0, 6.5, 0)];
      for (const [sx, y0, h] of [[1, 2.6, 2.2], [-1, 3.4, 1.6]]) {
        sag.push(new T.CylinderGeometry(0.26, 0.26, 1.3, 7).rotateZ(Math.PI / 2).translate(sx * 0.75, y0, 0));
        sag.push(new T.CylinderGeometry(0.26, 0.28, h, 7).translate(sx * 1.35, y0 + h / 2, 0));
        sag.push(new T.SphereGeometry(0.26, 7, 4).translate(sx * 1.35, y0 + h, 0));
      }
      const cactus = placeScatter(Math.round(520 * dens), (x, z, d, y) => offRoad(d, 5) && d < 520 && y > -1 && slopeAt(x, z) < 0.25);
      instance(ADDONS.mergeGeometries(sag), new T.MeshStandardMaterial({ color: 0x40663a, roughness: 0.85 }), cactus, (c, m) => {
        const k = 0.7 + c[3] * 0.7; m.compose(ps.set(c[0], c[1] - 0.2, c[2]), qq.setFromAxisAngle(up, c[3] * 20), sc.set(k, k, k));
      });
      // boulders
      const rocks = placeScatter(Math.round(420 * dens), (x, z, d, y) => offRoad(d, 3) && d < 600);
      instance(new T.DodecahedronGeometry(1, 0), rockMat, rocks, (c, m) => {
        const k = 0.8 + c[3] * c[3] * 4.5; m.compose(ps.set(c[0], c[1] + k * 0.25, c[2]), qq.setFromEuler(eu.set(c[3] * 3, c[3] * 9, c[3] * 5)), sc.set(k * 1.3, k, k * 1.1));
      });
      // hoodoos: stacked rock towers crowding the S-bends and lining the run to the river
      const hoods = placeScatter(Math.round(110 * dens), (x, z, d, y) => offRoad(d, 5) && d < 70 && y > -2 && y < 6 && notChasm(x, z));
      const hg = [new T.CylinderGeometry(1.6, 2.6, 1, 8).translate(0, 0.5, 0)];
      const hm = rockMat;
      instance(ADDONS.mergeGeometries(hg), hm, hoods, (c, m) => { const hgt = 9 + c[3] * 22; m.compose(ps.set(c[0], c[1] - 1, c[2]), qq.setFromAxisAngle(up, c[3] * 7), sc.set(1 + c[3], hgt, 1 + c[3])); });
      instance(new T.DodecahedronGeometry(1, 0), rockMat, hoods, (c, m) => { const hgt = 9 + c[3] * 22, k = 2.6 + c[3] * 1.4; m.compose(ps.set(c[0], c[1] - 1 + hgt + k * 0.4, c[2]), qq.setFromAxisAngle(up, c[3] * 11), sc.set(k * 1.2, k * 0.7, k)); });
    } else {
      // pines on the slopes
      const pg = [new T.CylinderGeometry(0.22, 0.32, 2.2, 6).translate(0, 1.1, 0)];
      for (let k = 0; k < 4; k++) pg.push(new T.ConeGeometry(2.6 - k * 0.55, 3.6 - k * 0.3, 8).translate(0, 2.4 + k * 2.1, 0));
      const pineGeo = ADDONS.mergeGeometries(pg);
      // colour the needles: dark green, snow on the upper faces of each layer
      {
        const p = pineGeo.attributes.position, nrm = pineGeo.attributes.normal, colA = new Float32Array(p.count * 3);
        for (let v = 0; v < p.count; v++) {
          const y = p.getY(v), snow = nrm.getY(v) > 0.45 && y > 2.3 ? 0.55 + 0.4 * ((v * 7) % 3) / 2 : 0;
          const c = y < 1.6 ? [0.2, 0.13, 0.08] : [0.05 + snow * 0.85, 0.12 + snow * 0.78, 0.07 + snow * 0.86];
          colA.set(c, v * 3);
        }
        pineGeo.setAttribute('color', new T.BufferAttribute(colA, 3));
      }
      const pines = placeScatter(Math.round(1500 * dens), (x, z, d, y) => offRoad(d, 4) && d < 700 && y < 260 && y > -2 && slopeAt(x, z) < 0.75 && notChasm(x, z));
      instance(pineGeo, new T.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), pines, (c, m) => {
        const k = 0.8 + c[3] * 0.9; m.compose(ps.set(c[0], c[1] - 0.3, c[2]), qq.setFromAxisAngle(up, c[3] * 30), sc.set(k, k * (0.9 + c[3] * 0.3), k));
      });
      // a village of chalets round the start
      const ch = [];
      for (let k = 0; k < 400 && ch.length < Math.round(34 * dens); k++) {
        const s = G.wrap(-500 + R() * 1200, tr.length), sg = R() < 0.5 ? -1 : 1, lat = sg * (WO + 9 + R() * 90), p = tr.sample(s, {});
        const x = p.x + p.rx * lat, z = p.z + p.rz * lat;
        if (distAt(x, z) < WO + 7 || slopeAt(x, z) > 0.2 || !notChasm(x, z) || ch.some((c) => Math.hypot(c[0] - x, c[2] - z) < 16)) continue;
        ch.push([x, hAt(x, z), z, R(), yawOf(p)]);
      }
      const walls = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const roofG = new T.CylinderGeometry(0.62, 0.62, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6 + Math.PI); roofG.scale(1, 0.62, 1.15);
      const sizes = ch.map((c) => [9 + c[3] * 6, 5 + c[3] * 3, 8 + c[3] * 4]);
      instance(walls, new T.MeshStandardMaterial({ color: 0x7a4e2e, roughness: 0.85 }), ch, (c, m, k) => { const [w, h, d2] = sizes[k]; m.compose(ps.set(c[0], c[1] - 0.6, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(w, h + 0.6, d2)); });
      instance(roofG, new T.MeshStandardMaterial({ color: 0xf2f5f8, roughness: 0.8 }), ch, (c, m, k) => { const [w, h, d2] = sizes[k]; m.compose(ps.set(c[0], c[1] + h - 0.1, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(w * 1.18, w * 0.62, d2 * 1.2)); });
      // warm windows
      const winM = new T.MeshBasicMaterial({ color: new T.Color(3.2, 1.9, 0.8), toneMapped: false });
      W.chaletWin = instance(new T.BoxGeometry(1, 1, 1), winM, ch, (c, m, k) => { const [w, h, d2] = sizes[k]; m.compose(ps.set(c[0], c[1] + h * 0.45, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(w * 0.7, 1.1, d2 + 0.08)); });
      const rocks = placeScatter(Math.round(260 * dens), (x, z, d, y) => offRoad(d, 3) && d < 500);
      instance(new T.DodecahedronGeometry(1, 0), rockMat, rocks, (c, m) => {
        const k = 1 + c[3] * c[3] * 5; m.compose(ps.set(c[0], c[1] + k * 0.2, c[2]), qq.setFromEuler(eu.set(c[3] * 3, c[3] * 9, c[3] * 5)), sc.set(k * 1.3, k, k * 1.1));
      });
    }

    // ================= live =================
    W.update = (dt, t) => { for (const f of anim) f(dt, t); };
    W.setTod = () => {};
    W.anim = anim;
    W.update(0, 0);
    return W;
  };

  // canvas sign: a big headline and an optional second line
  function signMaterial(text, col, bg, sub) {
    const tex = G.canvasTexture(512, sub ? 256 : 96, (ctx, Wd, Ht) => {
      ctx.fillStyle = bg; ctx.fillRect(0, 0, Wd, Ht);
      ctx.strokeStyle = col; ctx.lineWidth = 8; ctx.strokeRect(6, 6, Wd - 12, Ht - 12);
      ctx.fillStyle = col; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = `bold ${sub ? 64 : 56}px Orbitron, Arial`;
      ctx.fillText(text, Wd / 2, sub ? Ht * 0.36 : Ht / 2 + 2, Wd - 40);
      if (sub) { ctx.fillStyle = '#ffffff'; ctx.font = 'bold 40px Orbitron, Arial'; ctx.fillText(sub, Wd / 2, Ht * 0.72, Wd - 40); }
    });
    return new T.MeshBasicMaterial({ map: tex, color: new T.Color(1.5, 1.5, 1.5), toneMapped: false, side: T.DoubleSide });
  }

  // the land: sandstone strata by height on steep faces and sand on the flats (RED ROCK), or snow on the flats and
  // grey rock on the steep (ALPINE). Works on instanced rock too, so boulders and spires match the cliffs
  function landMaterial(alps) {
    const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, side: T.DoubleSide });
    m.onBeforeCompile = (sh) => {
      sh.vertexShader = 'varying vec3 vLWP; varying vec3 vLWN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 lIM = mat4(1.0);
        #ifdef USE_INSTANCING
          lIM = instanceMatrix;
        #endif
        vLWP = (modelMatrix * lIM * vec4(position, 1.0)).xyz;
        vLWN = normalize(mat3(modelMatrix * lIM) * normal);`);
      sh.fragmentShader = 'varying vec3 vLWP; varying vec3 vLWN;\n' +
        `float lh(vec2 p){ p = fract(p*vec2(127.1, 311.7)); p += dot(p, p+19.19); return fract(p.x*p.y); }
         float ln(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(lh(i), lh(i+vec2(1,0)), f.x), mix(lh(i+vec2(0,1)), lh(i+vec2(1,1)), f.x), f.y); }
        ` + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec3 n = normalize(vLWN); float fl = abs(n.y), y = vLWP.y;
          float gn = ln(vLWP.xz * 0.07) * 0.6 + ln(vLWP.xz * 0.6) * 0.4;
          ${alps ? `
          vec3 snow = vec3(0.86, 0.9, 0.96) * (0.92 + 0.08 * gn);
          vec3 rock = mix(vec3(0.12, 0.12, 0.13), vec3(0.24, 0.23, 0.22), ln(vec2(y * 0.4, vLWP.x * 0.05 + vLWP.z * 0.05)));
          float s = smoothstep(0.62, 0.8, fl + gn * 0.12);
          diffuseColor.rgb = mix(rock, snow, s);
          ` : `
          float b = y * 0.42 + ln(vLWP.xz * 0.012) * 3.5;
          vec3 rock = mix(vec3(0.42, 0.11, 0.045), vec3(0.6, 0.2, 0.08), 0.5 + 0.5 * sin(b * 1.9));
          rock = mix(rock, vec3(0.7, 0.45, 0.28), smoothstep(0.82, 0.98, sin(b * 0.55 + 1.3)));
          rock = mix(rock, vec3(0.2, 0.07, 0.04), smoothstep(0.9, 1.0, sin(b * 3.1)) * 0.6);
          vec3 sand = mix(vec3(0.62, 0.32, 0.15), vec3(0.72, 0.44, 0.24), gn);
          sand = mix(sand, vec3(0.3, 0.33, 0.17), smoothstep(0.78, 0.86, ln(vLWP.xz * 0.35)) * 0.55); // sage brush
          float s = smoothstep(0.72, 0.88, fl);
          diffuseColor.rgb = mix(rock * (0.85 + 0.3 * gn), sand, s);
          `}
        }`);
    };
    return m;
  }
})();
