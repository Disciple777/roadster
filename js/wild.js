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
    const D = G.TRACK, theme = D.theme, alps = theme === 'alps', isle = theme === 'isle', fjord = theme === 'fjord', sea = isle || fjord;
    const N = tr.N, ds = tr.ds, WO = G.WALK_OUT;
    const R = G.rng(alps ? 777 : isle ? 999 : fjord ? 888 : 555);
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
    // tunnel mouths: a heightfield can't drop from the mountain top to the road in a vertical face, so each portal gets a
    // notch: the land stays down at road level for the first PLEAD metres of the tunnel and PNOTCH metres either side of
    // it. A rock headwall with the opening in it closes the notch in front and a rock lid closes it on top (portals
    // below), and any land triangle that still reaches into the tube is dropped from the mesh
    const PLEAD = cell * 1.6 + 2, PNOTCH = WO + 2 + cell * 1.5, PHALF = PNOTCH + cell * 1.5 + 1;
    const portalDepth = (i) => { const t = tunnelOf(i); return t ? Math.min(tr.sd(i * ds, t.s0), tr.sd(t.s1, i * ds)) : 1e9; };

    // distant buttes / peaks scattered off the road
    const buttes = [];
    for (let k = 0; k < (alps || sea ? 0 : 46); k++) {
      const bx = tr.minX - 900 + R() * (tr.maxX - tr.minX + 1800), bz = tr.minZ - 900 + R() * (tr.maxZ - tr.minZ + 1800);
      const gx = Math.round((bx - x0) / cell), gz = Math.round((bz - z0) / cell);
      const r0 = 28 + R() * 110;
      if (dist[gz * nx + gx] < r0 + 70) continue;
      buttes.push({ x: bx, z: bz, r: r0, h: 22 + R() * (r0 < 60 ? 110 : 70) });
    }

    // VOLCANO ISLAND: the cone stands inside the loop, nudged towards the high road so it looms over the caldera leap;
    // sea stacks stand off the coast
    const VX = (tr.minX + tr.maxX) / 2 + 80, VZ = (tr.minZ + tr.maxZ) / 2 + 120, VH = 470, VR = 820, CRATER = VH * 0.62;
    W.volcano = { x: VX, z: VZ, y: CRATER };
    const stacks = [];
    if (isle) for (let k = 0; k < 60 && stacks.length < 18; k++) {
      const bx = tr.minX - 600 + R() * (tr.maxX - tr.minX + 1200), bz = tr.minZ - 600 + R() * (tr.maxZ - tr.minZ + 1200);
      const gx = Math.round((bx - x0) / cell), gz = Math.round((bz - z0) / cell), r0 = 14 + R() * 34;
      if (inside[gz * nx + gx] || dist[gz * nx + gx] < r0 + 130) continue;
      stacks.push({ x: bx, z: bz, r: r0, h: 24 + R() * 60 });
    }
    for (let gz = 0; gz < nz; gz++) for (let gx = 0; gx < nx; gx++) {
      const k = gz * nx + gx, x = x0 + gx * cell, z = z0 + gz * cell, d = dist[k], i = near[k];
      const rh = tr.py[i];
      let h;
      if (isle) {
        if (inside[k]) {
          // jungle hills rising to the volcano, a crater at its top
          const dc = Math.hypot(x - VX, z - VZ);
          let cone = VH * Math.pow(Math.max(0, 1 - dc / VR), 1.6) + 22 * ridge(x / 240, z / 240) * (1 - sstep(VR * 0.3, VR, dc));
          if (dc < 140) cone += (CRATER - cone) * (1 - sstep(70, 140, dc));
          h = Math.max(rh * (1 - sstep(30, 240, d)), cone * sstep(10, 140, d)) + 16 * fbm(x / 150, z / 150, 3) * sstep(15, 160, d);
        } else {
          // beach, then the sea floor; where the road runs high it's a cliff coast
          h = rh * (1 - sstep(25, 180, d)) - 18 * sstep(30, 300, d) + 2.5 * fbm(x / 60, z / 60, 3);
          for (const b of stacks) {
            const bd = Math.hypot(x - b.x, z - b.z), rr = b.r * (0.8 + 0.4 * fbm(x / 30 + b.x, z / 30, 2));
            if (bd < rr + 14) h = Math.max(h, b.h * (1 - sstep(rr, rr + 12, bd)) - 18 * sstep(rr, rr + 12, bd));
          }
        }
      } else if (fjord) {
        if (inside[k]) {
          // the massif the road is cut into: it rises straight off the inside of the road
          h = rh + sstep(20, 300, d) * (60 + 380 * ridge(x / 600, z / 600)) + 6 * fbm(x / 90, z / 90, 3);
        } else {
          // a sheer wall down from the road into deep water, the fjord, then the far wall of the fjord
          h = (rh + 2) * (1 - sstep(WO + 6, WO + 70, d)) - 40 * sstep(WO + 20, WO + 140, d) + sstep(420, 800, d) * (180 + 520 * ridge(x / 700, z / 700)) + 4 * fbm(x / 50, z / 50, 3);
        }
      } else if (!alps) {
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
      // the rock a tunnel goes through (all but the notch at each mouth)
      const notch = isTunnel(i) && d < PNOTCH && portalDepth(i) < PLEAD;
      if (isTunnel(i) && d < 110 && !notch) h = Math.max(h, (rh + tr.roof[i] + 28 + 10 * fbm(x / 40, z / 40, 2)) * (1 - sstep(60, 110, d)) + h * sstep(60, 110, d));
      // the road corridor: flat under the road, then a cut or a fill out to the natural ground
      if (!isTunnel(i) || notch) {
        const w = 1 - sstep(WO + cell * 0.8, WO + cell * 0.8 + (alps ? 30 : isle ? 36 : fjord ? 14 : 42), d);
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
        const fl = g.floor + (sea ? Math.max(0, Math.abs(u) - 180) * 0.5 : 0);
        if (sea && fl >= H[k]) continue;
        // never cut into another stretch of the circuit
        if (dist[k] < WO + 30 && Math.abs(tr.sd(near[k] * ds, g.s0 + g.len / 2)) > g.len / 2 + 80) continue;
        const hw = g.hw(u), f = 1 - sstep(hw - cell * 1.15, hw, Math.abs(along - g.meander(u)));
        if (f > 0) H[k] = H[k] + (fl + 1.5 * fbm(x / 20, z / 20, 2) - H[k]) * f;
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
      // is this point inside a tunnel tube (between its walls, over the road, under its ceiling)?
      const inTube = (x, y, z, i) => {
        for (let it = 0; it < 3; it++) i = ((i + Math.round(((x - tr.px[i]) * tr.tx[i] + (z - tr.pz[i]) * tr.tz[i]) / ds)) % N + N) % N;
        if (!isTunnel(i)) return false;
        const lat = (z - tr.pz[i]) * tr.tx[i] - (x - tr.px[i]) * tr.tz[i], y0 = tr.heightAt(i * ds + (x - tr.px[i]) * tr.tx[i] + (z - tr.pz[i]) * tr.tz[i]);
        return Math.abs(lat) < WO + 0.3 && y > y0 + 0.02 && y < y0 + tr.roof[i] + 0.2;
      };
      const pierces = (a, b, c) => {
        const ka = near[a]; if (ka < 0 || !(isTunnel(ka) || isTunnel(near[b]) || isTunnel(near[c]))) return false;
        if (Math.min(dist[a], dist[b], dist[c]) > WO + cell * 1.5) return false;
        const P = [a, b, c].map((k) => [x0 + (k % nx) * cell, H[k], z0 + Math.floor(k / nx) * cell]);
        const S = 8;
        for (let u = 0; u <= S; u++) for (let v = 0; u + v <= S; v++) {
          const wa = 1 - (u + v) / S, wb = u / S, wc = v / S;
          if (inTube(P[0][0] * wa + P[1][0] * wb + P[2][0] * wc, P[0][1] * wa + P[1][1] * wb + P[2][1] * wc, P[0][2] * wa + P[1][2] * wb + P[2][2] * wc, ka)) return true;
        }
        return false;
      };
      for (let gz = 0; gz < nz - 1; gz++) for (let gx = 0; gx < nx - 1; gx++) {
        const a = gz * nx + gx, b = a + 1, c = a + nx, d = c + 1;
        if (!pierces(a, c, b)) { idx[q++] = a; idx[q++] = c; idx[q++] = b; }
        if (!pierces(b, c, d)) { idx[q++] = b; idx[q++] = c; idx[q++] = d; }
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setIndex(new T.BufferAttribute(idx.subarray(0, q), 1));
      g.computeVertexNormals();
      const ground = new T.Mesh(g, (W.landMat = landMaterial(theme)));
      ground.receiveShadow = Q.shadows; ground.frustumCulled = false;
      scene.add(ground);
    }
    if (sea) {
      // the ocean: one big sheet, see-through enough that the turquoise shallows show
      const waveTex = G.canvasTexture(256, 256, (ctx, Wd, Ht) => {
        const r = G.rng(23); ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, Wd, Ht);
        for (let k = 0; k < 400; k++) { const g = 100 + r() * 120 | 0; ctx.strokeStyle = `rgba(${g},${g},${g},0.5)`; ctx.lineWidth = 1 + r() * 2; ctx.beginPath(); const x = r() * Wd, y = r() * Ht; ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 10, y - 4, x + 20 + r() * 20, y); ctx.stroke(); }
      }, { repeat: true });
      waveTex.repeat.set(400, 400);
      const seaMat = new T.MeshStandardMaterial({ color: fjord ? 0x163f4c : 0x1b86a8, roughness: fjord ? 0.12 : 0.18, metalness: 0.35, transparent: true, opacity: fjord ? 0.94 : 0.84, bumpMap: waveTex, bumpScale: 0.6, depthWrite: false });
      const sea = new T.Mesh(new T.PlaneGeometry(20000, 20000), seaMat);
      sea.rotation.x = -Math.PI / 2; sea.position.set((tr.minX + tr.maxX) / 2, -1.6, (tr.minZ + tr.maxZ) / 2); sea.renderOrder = 1;
      scene.add(sea);
      anim.push((dt) => { waveTex.offset.x += dt * 0.004; waveTex.offset.y += dt * 0.0025; });
    }

    // ================= rock / snow / wood / steel materials =================
    const rockMat = W.landMat; // the land shader also reads well on instanced rock (strata by world height)
    const steel = new T.MeshStandardMaterial({ color: alps || fjord ? 0x3a3f46 : isle ? 0x3a2e28 : 0x5a3a28, roughness: 0.6, metalness: 0.6 });
    const conc = new T.MeshStandardMaterial({ color: alps || fjord ? 0x8c8f94 : isle ? 0x5e5652 : 0xa08470, roughness: 0.9 });
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
      ctx.fillStyle = alps || fjord ? '#b9bcbf' : isle ? '#4a3c36' : '#c2a68e'; ctx.fillRect(0, 0, Wd, Ht);
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
    const tubeLight = new T.MeshBasicMaterial({ map: dashTex, color: alps ? new T.Color(3.2, 2.9, 2.4) : fjord ? new T.Color(1.6, 2.8, 4) : isle ? new T.Color(4.5, 1.1, 0.2) : new T.Color(4, 1.9, 0.55), toneMapped: false, side: T.DoubleSide });
    const poolMat = new T.MeshBasicMaterial({ map: G.softSprite(), color: alps ? new T.Color(0.45, 0.43, 0.38) : fjord ? new T.Color(0.2, 0.34, 0.48) : isle ? new T.Color(0.75, 0.2, 0.05) : new T.Color(0.6, 0.34, 0.12), blending: T.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
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
        if (side) {
          const lint = new T.Mesh(new T.BoxGeometry(2 * (WO + 2), 2.2, 3), conc); lint.position.set(0, h + 1.1, 0); port.add(lint);
        } else {
          // the mountain's face with the mouth cut out of it: legs either side and the rock over the opening, up to the
          // lid over the notch (the land behind is down at road level, see PLEAD)
          // local +Z * dir looks back down the road at the approaching car; the face's front sits just in front of the portal
          const top = h + 30, legW = PHALF - WO - 0.05, fz = -dir * 1.2;
          // its skyline: full height over the mouth, falling away to the shoulders so the ends sink into the hillside
          const topAt = (lat) => h + 5 + (top - h - 5) * (1 - sstep(WO + 5, PHALF, Math.abs(lat))) + 2.5 * (fbm(lat / 8 + s * 0.01, 3.7, 2) - 0.5);
          const face = (w, hh, cx, cy) => {
            const g = new T.BoxGeometry(w, hh, 3.2, Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(hh / 4)), 1), pa = g.attributes.position;
            for (let v = 0; v < pa.count; v++) { const vx = pa.getX(v) + cx, vy = pa.getY(v) + cy; if (vy > h + 0.5) pa.setY(v, h + 0.5 + (vy - h - 0.5) * (topAt(vx) - h - 0.5) / (top - h - 0.5) - cy); }
            // a rough rock face: push the front vertices in and out a little (never into the opening)
            for (let v = 0; v < pa.count; v++) {
              const vx = pa.getX(v) + cx, vy = pa.getY(v) + cy;
              if (pa.getZ(v) * dir < 1) continue; // front face only
              const edge = Math.abs(vx) < WO + 0.1 ? vy - h : Math.abs(vx) - WO; // flat round the opening
              const k = G.clamp((edge - 1) / 4, 0, 1);
              pa.setZ(v, pa.getZ(v) + dir * k * (3.2 * fbm(vx / 9 + s * 0.01, vy / 7, 3) - 1.2));
            }
            g.computeVertexNormals();
            const m = new T.Mesh(g, rockMat); m.position.set(cx, cy, fz); port.add(m);
          };
          for (const sg of [-1, 1]) face(legW, top + 4, sg * (WO + 0.05 + legW / 2), top / 2 - 2);
          face(2 * WO + 0.2, top - h, 0, (top + h) / 2);
          // a concrete frame round the opening
          const lint = new T.Mesh(new T.BoxGeometry(2 * (WO + 2.2), 2.2, 3.8), conc); lint.position.set(0, h + 1.1, dir * 0.9); port.add(lint);
          for (const sg of [-1, 1]) { const leg = new T.Mesh(new T.BoxGeometry(2.2, h, 3.8), conc); leg.position.set(sg * (WO + 1.1), h / 2, dir * 0.9); port.add(leg); }
          // the lid over the notch: the mountain's own surface (same shape as the land around it), starting level with
          // the top of the face and sinking a little under the land at its far edges so no seam shows from above
          const iP = idxOf(s), aEnd = PLEAD + cell * 1.5 + 3, nL = Math.ceil(aEnd / ds), nC = Math.ceil((2 * PHALF) / (cell / 2));
          const lp = [], li = [];
          for (let r = 0; r <= nL; r++) {
            const i = (((iP + dir * r) % N) + N) % N, a = r * ds, rx = -tr.tz[i], rz = tr.tx[i];
            for (let c = 0; c <= nC; c++) {
              const lat = -PHALF + (2 * PHALF * c) / nC, x = tr.px[i] + rx * lat, z = tr.pz[i] + rz * lat;
              let yy = tr.py[i] + h + 28 + 10 * fbm(x / 40, z / 40, 2);
              const f = sstep(0, cell * 1.5, a);
              yy = (y + topAt(lat)) * (1 - f) + yy * f;
              yy -= 3 * Math.max(sstep(PHALF - cell, PHALF, Math.abs(lat)), sstep(aEnd - cell, aEnd, a));
              lp.push(x, Math.max(yy, tr.py[i] + h + 1), z);
              if (r < nL && c < nC) { const k = r * (nC + 1) + c; li.push(k, k + nC + 1, k + 1, k + 1, k + nC + 1, k + nC + 2); }
            }
          }
          const lg = new T.BufferGeometry(); lg.setAttribute('position', new T.Float32BufferAttribute(lp, 3)); lg.setIndex(li); lg.computeVertexNormals();
          const lid = new T.Mesh(lg, rockMat); lid.receiveShadow = true; lid.castShadow = Q.shadows; g.add(lid);
        }
        // name board over the mouth
        const board = new T.Mesh(new T.PlaneGeometry(14, 1.8), signMaterial(t.name, '#ffd23a', '#121315'));
        board.position.set(0, h + 1.1, side ? dir * 1.56 : dir * 2.86); if (dir < 0) board.rotation.y = Math.PI; port.add(board);
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
        const glow = new T.Mesh(strip(i0, i1, -WO, rel + 0.5, WO, rel + 0.5, 6), new T.MeshBasicMaterial({ color: fjord ? new T.Color(0.2, 0.9, 1.8) : new T.Color(1.6, 0.25, 0.05), toneMapped: false }));
        scene.add(glow);
      }
      if (g.broken) buildBrokenBridge(g);
      if (g.water) buildWater(g);
      if (g.lava) buildLava(g);
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

    // a lava river along the bottom of the chasm (only where the chasm was carved: never hanging over the sea)
    function lavaMaterial(k = 1) {
      const tex = G.canvasTexture(256, 256, (ctx, Wd, Ht) => {
        const r = G.rng(71);
        ctx.fillStyle = '#ff5a10'; ctx.fillRect(0, 0, Wd, Ht);
        for (let i = 0; i < 90; i++) { ctx.fillStyle = `rgba(255,${200 + r() * 55 | 0},${60 + r() * 80 | 0},${0.35 + r() * 0.4})`; ctx.beginPath(); ctx.ellipse(r() * Wd, r() * Ht, 6 + r() * 20, 3 + r() * 8, r() * 3, 0, 7); ctx.fill(); }
        // dark crust plates drifting on it
        for (let i = 0; i < 70; i++) { ctx.fillStyle = `rgba(${30 + r() * 30 | 0},${8 + r() * 8 | 0},4,${0.55 + r() * 0.4})`; ctx.beginPath(); const x = r() * Wd, y = r() * Ht; ctx.moveTo(x, y); for (let j = 0; j < 6; j++) ctx.lineTo(x + (r() - 0.5) * 34, y + (r() - 0.5) * 34); ctx.fill(); }
      }, { repeat: true });
      const m = new T.MeshBasicMaterial({ map: tex, color: new T.Color(2.4 * k, 1.1 * k, 0.5 * k), toneMapped: false, side: T.DoubleSide });
      anim.push((dt) => { tex.offset.y -= dt * 0.035; });
      return m;
    }
    function buildLava(g) {
      const c = tr.sample(g.s0 + g.len / 2, {}), y = g.floor + 2.4, S = 96, E = 420, pos = [], uv = [], idx = [];
      const ok = [];
      for (let k = 0; k <= S; k++) {
        const u = -E + (2 * E * k) / S, a = g.meander(u), hw = g.hw(u) * 0.8;
        for (const sg of [-1, 1]) { pos.push(c.x + c.rx * u + c.tx * (a + sg * hw), y, c.z + c.rz * u + c.tz * (a + sg * hw)); uv.push(sg < 0 ? 0 : hw / 12, u / 24); }
        ok.push(hAt(c.x + c.rx * u + c.tx * a, c.z + c.rz * u + c.tz * a) < y + 1 && hAt(c.x + c.rx * u + c.tx * a, c.z + c.rz * u + c.tz * a) > g.floor - 4);
      }
      for (let k = 0; k < S; k++) if (ok[k] || ok[k + 1]) { const q = k * 2; idx.push(q, q + 2, q + 1, q + 1, q + 2, q + 3); }
      const geo = new T.BufferGeometry(); geo.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); geo.setIndex(idx);
      scene.add(new T.Mesh(geo, W.lavaMat || (W.lavaMat = lavaMaterial())));
      // the heat haze: a soft glow hanging over the river
      const glow = new T.Sprite(new T.SpriteMaterial({ map: G.softSprite(), color: new T.Color(1, 0.35, 0.08), blending: T.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.7 }));
      glow.position.set(c.x, y + 6, c.z); glow.scale.set(g.len * 2.2, 26, 1); scene.add(glow);
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
      } else if (sp.kind === 'rope') {
        // a sagging plank bridge strung across the gorge, a few planks gone, rope handrails, timber posts on each rim
        const wood = new T.MeshStandardMaterial({ color: 0x6b4a2c, roughness: 0.95 }), rope = new T.MeshStandardMaterial({ color: 0xb89a66, roughness: 1 });
        const U = 32, yAt = (u) => sp.y0 + 0.6 + 3 * (u / U) * (u / U), planks = [];
        for (let u = -U + 0.6; u < U; u += 0.9) if (R() > 0.12) planks.push(u);
        const pm = new T.InstancedMesh(new T.BoxGeometry(0.7, 0.18, 2.6), wood, planks.length);
        planks.forEach((u, k) => { m4.compose(ps.set(u, yAt(u), 0), qq.setFromEuler(eu.set((R() - 0.5) * 0.12, 0, Math.atan(6 * u / (U * U)))), sc.set(1, 1, 1)); pm.setMatrixAt(k, m4); });
        g.add(pm);
        for (const z of [-1.4, 1.4]) for (const dy of [0.15, 1.1]) {
          const pts = []; for (let k = 0; k <= 24; k++) { const u = -U + (2 * U * k) / 24; pts.push(new T.Vector3(u, yAt(u) + dy, z)); }
          g.add(new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 40, 0.07, 5), rope));
        }
        for (const sg of [-1, 1]) for (const z of [-1.5, 1.5]) {
          const fy = Math.min(groundAt(sg * (U + 1)), yAt(U) - 1), hgt = yAt(U) + 2 - fy;
          const post = new T.Mesh(new T.CylinderGeometry(0.22, 0.28, hgt, 6), wood); post.position.set(sg * (U + 1), fy + hgt / 2, z); g.add(post);
        }
      } else if (sp.kind === 'geyser') {
        // two lava fountains out of the caldera, taking turns: bubbles and a glow first, then a column you must not touch
        const gp = tr.gapAt(sp.s), ly = gp ? gp.floor + 2.4 : sp.base - 40;
        const colMat = new T.MeshBasicMaterial({ map: (W.lavaMat || (W.lavaMat = lavaMaterial())).map, color: new T.Color(3, 1.2, 0.35), toneMapped: false });
        const cols = sp.cols.map((c) => {
          const col = new T.Mesh(new T.CylinderGeometry(2.0, 2.8, 1, 12, 1, true).translate(0, 0.5, 0), colMat); col.position.set(c.lat, ly, 0); g.add(col);
          const crown = new T.Mesh(new T.SphereGeometry(3.2, 10, 6), colMat); g.add(crown);
          const glow = new T.Sprite(new T.SpriteMaterial({ map: G.softSprite(), color: new T.Color(1, 0.4, 0.1), blending: T.AdditiveBlending, transparent: true, depthWrite: false }));
          glow.scale.set(16, 16, 1); g.add(glow);
          const ring = new T.Mesh(new T.RingGeometry(1.4, 3.4, 20), new T.MeshBasicMaterial({ color: new T.Color(4, 1.4, 0.3), toneMapped: false, transparent: true, side: T.DoubleSide, depthWrite: false }));
          ring.rotation.x = -Math.PI / 2; ring.position.set(c.lat, ly + 0.2, 0); g.add(ring);
          return { c, col, crown, glow, ring };
        });
        anim.push((dt, t) => {
          for (const o of cols) {
            const c = o.c, on = c.h > 0.01, top = c.y1;
            o.col.visible = o.crown.visible = on;
            if (on) { o.col.scale.y = Math.max(0.1, top - ly); o.crown.position.set(c.lat, top, 0); o.crown.scale.set(1 + 0.15 * Math.sin(t * 20), 0.55, 1 + 0.15 * Math.cos(t * 17)); }
            o.glow.position.set(c.lat, on ? top : ly + 3, 0);
            o.glow.material.opacity = on ? 1 : c.warn * (0.6 + 0.4 * Math.sin(t * 30));
            o.ring.material.opacity = c.warn ? 0.4 + 0.6 * c.warn : on ? 0.8 : 0;
            o.ring.scale.setScalar(1 + (c.warn ? 0.4 * Math.sin(t * 25) : 0));
          }
        });
      } else if (sp.kind === 'falls') {
        // a rock lip juts out of the mountain over the jump, and a river pours off its whole edge down to the fjord:
        // you fly under the lip and straight through the curtain
        const xa = -(WO + 14), xb = WO + 90, top = sp.y0 + 4, lw = xb - xa;
        const lipMat = new T.MeshStandardMaterial({ color: 0x3b3e42, roughness: 0.92, flatShading: true });
        for (let k = 0; k < 9; k++) {
          const f = k / 8, x = xa + 6 + f * (lw - 12), kk = 7 + 5 * f + R() * 3;
          const rk = new T.Mesh(new T.DodecahedronGeometry(1, 0), lipMat);
          rk.position.set(x, top + kk * 0.35, (R() - 0.5) * 4); rk.scale.set(kk * 1.4, kk * 0.6, 9 + R() * 4); rk.rotation.set(R() * 0.4, R() * 3, R() * 0.4); g.add(rk);
        }
        const streak = G.canvasTexture(128, 256, (ctx, Wd, Ht) => {
          const r = G.rng(43); ctx.clearRect(0, 0, Wd, Ht);
          for (let k = 0; k < 260; k++) {
            const x = r() * Wd, a = 0.15 + r() * 0.5, w = 1 + r() * 4, y = r() * Ht, l = 30 + r() * 140;
            ctx.fillStyle = `rgba(235,245,255,${a})`; ctx.fillRect(x, y, w, l); if (y + l > Ht) ctx.fillRect(x, y - Ht, w, l);
          }
        }, { repeat: true });
        const hgt = top + 1.6;
        streak.repeat.set(lw / 14, hgt / 30);
        const wm = new T.MeshBasicMaterial({ map: streak, color: new T.Color(0.9, 0.97, 1.05), transparent: true, opacity: 0.85, depthWrite: false, side: T.DoubleSide });
        const sheets = [];
        for (const [dz, sc0, sp0] of [[0, 1, 1], [1.5, 1.3, 0.8], [-1.2, 0.8, 1.25]]) {
          const tx = streak.clone(); tx.needsUpdate = true; tx.repeat.set(lw / 14 * sc0, hgt / 30 * sc0);
          const m = wm.clone(); m.map = tx; m.opacity = dz ? 0.45 : 0.8;
          const sh = new T.Mesh(new T.PlaneGeometry(lw, hgt), m); sh.position.set((xa + xb) / 2, top - hgt / 2, dz); g.add(sh);
          sheets.push([tx, sp0]);
        }
        anim.push((dt) => { for (const [tx, v] of sheets) tx.offset.y += dt * 1.1 * v; });
        // spray where it hits the water, and a veil of mist half way down
        const mist = new T.SpriteMaterial({ map: G.softSprite(), color: 0xe8f2f8, transparent: true, depthWrite: false, opacity: 0.55 });
        for (let k = 0; k < 10; k++) {
          const ms = new T.Sprite(mist); const sz = 30 + R() * 40;
          ms.position.set(xa + R() * lw, k < 7 ? 2 + R() * 10 : top * (0.3 + R() * 0.4), (R() - 0.5) * 16); ms.scale.set(sz, sz * 0.6, 1); g.add(ms);
        }
        g.userData.noShadow = true;
      } else if (sp.kind === 'ship') {
        // an old galleon wedged across the gorge, keel up high: you fly underneath it
        const wood = new T.MeshStandardMaterial({ color: 0x4a3322, roughness: 0.95 }), dk = new T.MeshStandardMaterial({ color: 0x2a1d14, roughness: 1 });
        const L = 38, Bm = 10, Hh = 7, shp = new T.Shape();
        // the hull's side profile in local X (along the ship) / Y: a flat keel, the bow and stern swept up
        shp.moveTo(-L / 2 + 6, 0); shp.lineTo(L / 2 - 7, 0); shp.quadraticCurveTo(L / 2 - 1, 0.5, L / 2 + 2, Hh + 2.5);
        shp.lineTo(L / 2 - 4, Hh + 1); shp.lineTo(-L / 2 + 4, Hh + 1); shp.lineTo(-L / 2 + 1, Hh + 4.5); shp.lineTo(-L / 2 - 1, Hh + 4.5); shp.quadraticCurveTo(-L / 2, 1, -L / 2 + 6, 0);
        const hg = new T.ExtrudeGeometry(shp, { depth: Bm - 4, bevelEnabled: true, bevelSize: 1.2, bevelThickness: 2, bevelSegments: 3, curveSegments: 6 });
        hg.translate(0, 0, -(Bm - 4) / 2);
        // round the bottom: pull the low vertices in so the hull reads as a hull, not a box
        const pa = hg.attributes.position;
        for (let v = 0; v < pa.count; v++) { const y = pa.getY(v), k = 1 - Math.min(1, Math.max(0, y) / (Hh * 0.8)); pa.setZ(v, pa.getZ(v) * (1 - 0.55 * k * k)); }
        hg.computeVertexNormals();
        const hull = new T.Mesh(hg, wood); hull.position.y = sp.y0; g.add(hull);
        const band = new T.Mesh(new T.BoxGeometry(L - 12, 0.5, Bm + 0.4), dk); band.position.set(0, sp.y0 + Hh * 0.7, 0); g.add(band);
        // broken masts leaning off it, torn sails
        const sail = new T.MeshStandardMaterial({ color: 0xcfc2a0, roughness: 1, side: T.DoubleSide });
        [[-8, 14, 0.25], [4, 22, -0.18], [13, 10, 0.5]].forEach(([u, hgt, lean]) => {
          const m = new T.Mesh(new T.CylinderGeometry(0.35, 0.5, hgt, 7).translate(0, hgt / 2, 0), wood); m.position.set(u, sp.y0 + Hh, 0); m.rotation.z = lean; m.rotation.x = lean * 0.6; g.add(m);
          const sg = new T.PlaneGeometry(hgt * 0.55, hgt * 0.4, 4, 3), sa = sg.attributes.position;
          for (let v = 0; v < sa.count; v++) { sa.setZ(v, Math.sin(sa.getX(v) * 0.7) * 0.8); if (sa.getY(v) < -hgt * 0.1 && R() < 0.4) sa.setY(v, sa.getY(v) + R() * 2); }
          sg.computeVertexNormals();
          const sl = new T.Mesh(sg, sail); sl.rotation.y = Math.PI / 2; sl.position.y = hgt * 0.62; m.add(sl);
        });
        // hawsers down to the rims holding it
        for (const sg of [-1, 1]) {
          const ax = sg * (L / 2 - 2), ay = sp.y0 + Hh, bx = sg * (L / 2 + 10), by = groundAt(bx);
          const rr = new T.Mesh(new T.CylinderGeometry(0.1, 0.1, 1, 4).translate(0, 0.5, 0), dk);
          rr.position.set(ax, ay, 0); rr.scale.y = Math.hypot(bx - ax, by - ay); rr.rotation.z = Math.atan2(-(bx - ax), by - ay); g.add(rr);
        }
      }
      g.traverse((o) => { if (o.isMesh && !(g.userData.noShadow && o.material.transparent)) { o.castShadow = o.castShadow || Q.shadows; o.receiveShadow = true; } });
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
    if (isle) {
      // palms: a bent trunk and a crown of drooping fronds (alpha-cut leaflets)
      const frondTex = G.canvasTexture(128, 256, (ctx, Wd, Ht) => {
        ctx.clearRect(0, 0, Wd, Ht); const r = G.rng(31);
        ctx.strokeStyle = '#5a7a2a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(Wd / 2, 0); ctx.lineTo(Wd / 2, Ht); ctx.stroke();
        for (let y = 6; y < Ht - 4; y += 5) {
          const w = (Wd / 2 - 4) * Math.sin((y / Ht) * Math.PI * 0.9 + 0.2), g = 90 + r() * 70 | 0;
          ctx.strokeStyle = `rgb(${g * 0.35 | 0},${g},${g * 0.3 | 0})`; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.moveTo(Wd / 2, y); ctx.lineTo(Wd / 2 - w, y + 14); ctx.moveTo(Wd / 2, y); ctx.lineTo(Wd / 2 + w, y + 14); ctx.stroke();
        }
      });
      const frondMat = new T.MeshStandardMaterial({ map: frondTex, alphaTest: 0.5, side: T.DoubleSide, roughness: 0.8 });
      const trunkMat = new T.MeshStandardMaterial({ color: 0x7a6248, roughness: 1 });
      const TH = 11, bend = (y) => 1.6 * (y / TH) * (y / TH);
      const trunkG = new T.CylinderGeometry(0.22, 0.34, TH, 7, 8).translate(0, TH / 2, 0);
      { const pa = trunkG.attributes.position; for (let v = 0; v < pa.count; v++) pa.setX(v, pa.getX(v) + bend(pa.getY(v))); trunkG.computeVertexNormals(); }
      const fronds = [];
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * Math.PI * 2, fg = new T.PlaneGeometry(1.6, 5.5, 1, 6).translate(0, -2.75, 0), pa = fg.attributes.position;
        for (let v = 0; v < pa.count; v++) { const l = -pa.getY(v); pa.setXYZ(v, pa.getX(v), 0.6 - 0.09 * l * l, l); } // arch out and droop
        fg.rotateY(a); fg.translate(bend(TH), TH, 0); fronds.push(fg);
      }
      const crownG = ADDONS.mergeGeometries(fronds); crownG.computeVertexNormals();
      const palms = placeScatter(Math.round(900 * dens), (x, z, d, y) => offRoad(d, 4) && d < 420 && y > -0.6 && y < 60 && slopeAt(x, z) < 0.5 && notChasm(x, z));
      const placeP = (c, m) => { const k = 0.8 + c[3] * 0.6; m.compose(ps.set(c[0], c[1] - 0.3, c[2]), qq.setFromAxisAngle(up, c[3] * 47), sc.set(k, k * (0.85 + c[3] * 0.4), k)); };
      instance(trunkG, trunkMat, palms, placeP);
      instance(crownG, frondMat, palms, placeP);
      // the jungle: broadleaf canopy trees and bushes up the volcano's flanks
      const leaf = new T.MeshStandardMaterial({ color: 0x2f6a2a, roughness: 0.9, flatShading: true });
      const jungle = placeScatter(Math.round(1400 * dens), (x, z, d, y) => offRoad(d, 5) && d < 650 && y > 3 && y < 120 && slopeAt(x, z) < 0.8 && notChasm(x, z));
      const jm = instance(new T.IcosahedronGeometry(1, 1), leaf, jungle, (c, m) => { const k = 2.5 + c[3] * 5; m.compose(ps.set(c[0], c[1] + k * 0.55, c[2]), qq.setFromAxisAngle(up, c[3] * 13), sc.set(k * 1.2, k * 0.8, k * 1.1)); });
      const tc = new T.Color();
      jungle.forEach((c, j) => jm.setColorAt(j, tc.setRGB(0.7 + G.wrap(c[3] * 17, 1) * 0.5, 0.8 + G.wrap(c[3] * 29, 1) * 0.4, 0.6 + G.wrap(c[3] * 7, 1) * 0.4)));
      jm.instanceColor.needsUpdate = true;
      instance(new T.CylinderGeometry(0.3, 0.45, 1, 5).translate(0, 0.5, 0), trunkMat, jungle.filter((c) => c[3] > 0.5), (c, m) => { const k = 2.5 + c[3] * 5; m.compose(ps.set(c[0], c[1] - 0.3, c[2]), qq.identity(), sc.set(1, k * 0.7, 1)); });
      // basalt boulders and lava rocks
      const rocks = placeScatter(Math.round(360 * dens), (x, z, d, y) => offRoad(d, 3) && d < 600 && y > -4);
      instance(new T.DodecahedronGeometry(1, 0), rockMat, rocks, (c, m) => {
        const k = 0.8 + c[3] * c[3] * 4.5; m.compose(ps.set(c[0], c[1] + k * 0.25, c[2]), qq.setFromEuler(eu.set(c[3] * 3, c[3] * 9, c[3] * 5)), sc.set(k * 1.3, k, k * 1.1));
      });
      // a beach village of stilt huts round the start / finish
      const huts = [];
      for (let k = 0; k < 400 && huts.length < Math.round(22 * dens); k++) {
        const s = G.wrap(-400 + R() * 900, tr.length), sg = R() < 0.5 ? -1 : 1, lat = sg * (WO + 10 + R() * 70), p = tr.sample(s, {});
        const x = p.x + p.rx * lat, z = p.z + p.rz * lat;
        if (distAt(x, z) < WO + 8 || slopeAt(x, z) > 0.3 || !notChasm(x, z) || huts.some((c) => Math.hypot(c[0] - x, c[2] - z) < 14)) continue;
        huts.push([x, Math.max(hAt(x, z), -1.6), z, R(), yawOf(p)]);
      }
      const hutWood = new T.MeshStandardMaterial({ color: 0x8a6a44, roughness: 0.95 }), thatch = new T.MeshStandardMaterial({ color: 0xb89a5a, roughness: 1 });
      instance(new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), hutWood, huts, (c, m) => m.compose(ps.set(c[0], c[1] + 2.2, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(6 + c[3] * 2, 3.2, 5 + c[3] * 2)));
      instance(new T.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0), thatch, huts, (c, m) => m.compose(ps.set(c[0], c[1] + 5.3, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(6.2 + c[3] * 2, 4.5, 5.6 + c[3] * 2)));
      instance(new T.CylinderGeometry(0.2, 0.2, 1, 5).translate(0, 0.5, 0), hutWood, huts, (c, m) => m.compose(ps.set(c[0], c[1] - 1, c[2]), qq.identity(), sc.set(6, 3.3, 6)));
      // the crater: a lava lake, its glow and a smoke plume you can see from all round the island
      const V = W.volcano;
      const lakeMat = lavaMaterial(1.3); lakeMat.map.repeat.set(6, 6);
      const lake = new T.Mesh(new T.CircleGeometry(78, 32), lakeMat); lake.rotation.x = -Math.PI / 2; lake.position.set(V.x, V.y + 4, V.z); scene.add(lake);
      const cg = new T.Sprite(new T.SpriteMaterial({ map: G.softSprite(), color: new T.Color(1, 0.35, 0.08), blending: T.AdditiveBlending, transparent: true, depthWrite: false }));
      cg.position.set(V.x, V.y + 30, V.z); cg.scale.set(320, 120, 1); scene.add(cg);
      const smokeMat = new T.SpriteMaterial({ map: G.softSprite(), color: 0x5a5450, transparent: true, depthWrite: false, opacity: 0.5 });
      const puffs = [];
      for (let k = 0; k < 26; k++) { const sp1 = new T.Sprite(smokeMat.clone()); scene.add(sp1); puffs.push([sp1, k / 26, R()]); }
      anim.push((dt, t) => {
        cg.material.opacity = 0.75 + 0.25 * Math.sin(t * 1.7);
        for (const [p1, ph, rr] of puffs) {
          const u = G.wrap(t / 40 + ph, 1), sz = 60 + u * 340;
          p1.position.set(V.x + u * 520 + Math.sin(rr * 9 + u * 4) * 40 * u, V.y + 20 + u * 700, V.z - u * 260 + Math.cos(rr * 7) * 30 * u);
          p1.scale.set(sz, sz, 1); p1.material.opacity = 0.55 * Math.min(1, u * 8) * (1 - u);
        }
      });
    } else if (!alps && !fjord) {
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
      // conifers on the slopes: spruces and firs built from tiers of drooping branches with feathery needle tips, bark
      // on the trunk, and snow that settles on whatever faces the sky (shader, world space) rather than painted on
      const seg = Q.level >= 4 ? 16 : Q.level >= 3 ? 12 : 8;
      const needleTex = G.canvasTexture(256, 256, (ctx, Wd, Ht) => {
        // u runs round the tree, v from the trunk (0) out to the branch tips (1); the outer band is cut into needle
        // fringes by alpha so the silhouette isn't a clean cone edge
        const r = G.rng(91);
        const gr = ctx.createLinearGradient(0, 0, 0, Ht);
        gr.addColorStop(0, '#102418'); gr.addColorStop(0.55, '#23442a'); gr.addColorStop(1, '#335a33');
        ctx.fillStyle = gr; ctx.fillRect(0, 0, Wd, Ht * 0.8);
        // needle sprays pointing outwards
        for (let k = 0; k < 2600; k++) {
          const x = r() * Wd, y = r() * Ht * 0.95, l = 6 + r() * 16, a = (r() - 0.5) * 0.9, g = 50 + r() * 75;
          ctx.strokeStyle = `rgba(${(g * 0.45) | 0},${g | 0},${(g * 0.5) | 0},${0.5 + r() * 0.5})`;
          ctx.lineWidth = 1 + r() * 1.5;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.sin(a) * l, y + Math.cos(a) * l); ctx.stroke();
        }
        // darker gaps between branch clumps
        for (let k = 0; k < 220; k++) { ctx.fillStyle = `rgba(4,10,6,${0.25 + r() * 0.35})`; ctx.beginPath(); ctx.ellipse(r() * Wd, r() * Ht * 0.85, 3 + r() * 6, 8 + r() * 16, 0, 0, 7); ctx.fill(); }
      }, { repeat: true });
      // the alpha mask (fringe at the tips)
      {
        const img = needleTex.image, ctx = img.getContext('2d'), Wd = img.width, Ht = img.height, d = ctx.getImageData(0, 0, Wd, Ht), r = G.rng(17);
        const edge = new Float32Array(Wd);
        for (let x = 0; x < Wd; x++) edge[x] = 0.8 + 0.14 * Math.abs(Math.sin(x / Wd * Math.PI * 23 + 0.7)) + r() * 0.06;
        for (let y = 0; y < Ht; y++) for (let x = 0; x < Wd; x++) {
          const k = (y * Wd + x) * 4, v = y / Ht;
          let a = v < edge[x] - 0.22 ? 1 : v > edge[x] ? 0 : (r() < (edge[x] - v) / 0.22 ? 1 : 0);
          if (a && v > edge[x] - 0.22) { d.data[k] = 30 + r() * 25; d.data[k + 1] = 60 + r() * 40; d.data[k + 2] = 34 + r() * 20; }
          d.data[k + 3] = a ? 255 : 0;
        }
        ctx.putImageData(d, 0, 0); needleTex.needsUpdate = true;
      }
      const barkTex = G.canvasTexture(64, 256, (ctx, Wd, Ht) => {
        const r = G.rng(5); ctx.fillStyle = '#3b2a1e'; ctx.fillRect(0, 0, Wd, Ht);
        for (let k = 0; k < 160; k++) { const g = 20 + r() * 50; ctx.fillStyle = `rgba(${g + 20},${g},${g * 0.7},0.7)`; ctx.fillRect(r() * Wd, r() * Ht, 1 + r() * 3, 10 + r() * 40); }
        for (let k = 0; k < 60; k++) { ctx.fillStyle = 'rgba(10,6,4,0.6)'; ctx.fillRect(r() * Wd, r() * Ht, 2 + r() * 6, 2); }
      }, { repeat: true });
      barkTex.repeat.set(2, 3);
      const snowy = (mat, amount) => {
        mat.onBeforeCompile = (sh) => {
          sh.vertexShader = 'varying vec3 vSP; varying vec3 vSN;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            mat4 sIM = mat4(1.0);
            #ifdef USE_INSTANCING
              sIM = instanceMatrix;
            #endif
            vSP = (modelMatrix * sIM * vec4(position, 1.0)).xyz; vSN = normalize(mat3(modelMatrix * sIM) * normal);`);
          sh.fragmentShader = 'varying vec3 vSP; varying vec3 vSN;\nfloat sh1(vec3 p){ return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }\n' +
            'float sn3(vec3 p){ vec3 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(mix(sh1(i), sh1(i+vec3(1,0,0)), f.x), mix(sh1(i+vec3(0,1,0)), sh1(i+vec3(1,1,0)), f.x), f.y), mix(mix(sh1(i+vec3(0,0,1)), sh1(i+vec3(1,0,1)), f.x), mix(sh1(i+vec3(0,1,1)), sh1(i+vec3(1,1,1)), f.x), f.y), f.z); }\n' +
            sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
            {
              float nz = sn3(vSP * 2.3) * 0.5 + sn3(vSP * 0.9) * 0.3 + sn3(vSP * 0.35) * 0.2;
              float up = (gl_FrontFacing ? 1.0 : -1.0) * normalize(vSN).y;
              // snow clumps on the upper side of the boughs only, broken up so the green shows through
              float s = smoothstep(0.42, 0.66, up + (nz - 0.5) * 0.6) * smoothstep(0.3, 0.55, nz) * ${amount.toFixed(2)};
              diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.97) * (0.9 + 0.1 * nz), s);
            }`);
        };
        return mat;
      };
      const needleMat = snowy(new T.MeshStandardMaterial({ map: needleTex, alphaTest: 0.5, side: T.DoubleSide, roughness: 0.95, metalness: 0 }), fjord ? 0.3 : 0.92);
      const barkMat = new T.MeshStandardMaterial({ map: barkTex, roughness: 1, metalness: 0 });
      // one tier: a cone of branches whose rim is a ring of drooping tips (every other vertex pulled in and lifted)
      const tier = (y0, R, Hh, phase, rr) => {
        const pos = [], uv = [], idx = [], n = seg * 2;
        pos.push(0, y0 + Hh, 0); uv.push(0.5, 0);
        for (let j = 0; j <= n; j++) {
          const a = (j / n) * Math.PI * 2 + phase, tip = j % 2 === 0, rad = R * (tip ? 1 : 0.82) * (0.86 + 0.28 * rr());
          const droop = tip ? -R * (0.2 + 0.14 * rr()) : -R * 0.04;
          pos.push(Math.cos(a) * rad, y0 + droop, Math.sin(a) * rad); uv.push((j / n) * 3, 1);
        }
        for (let j = 1; j <= n; j++) idx.push(0, j + 1, j);
        // a mid ring so the branches sag (a convex cone reads as a party hat)
        const base = pos.length / 3;
        for (let j = 0; j <= n; j++) {
          const p0 = 1 + j, x = pos[p0 * 3], z = pos[p0 * 3 + 2], y = pos[p0 * 3 + 1];
          pos.push(x * 0.55, y0 + Hh * 0.5 + (y - y0) * 0.2, z * 0.55); uv.push((j / n) * 3, 0.55);
        }
        // re-stitch: apex -> mid ring -> rim
        idx.length = 0;
        for (let j = 0; j < n; j++) { const m0 = base + j, m1 = base + j + 1, r0 = 1 + j, r1 = 2 + j; idx.push(0, m1, m0, m0, m1, r1, m0, r1, r0); }
        // underside, a shallow dark cone back to the trunk
        const uc = pos.length / 3; pos.push(0, y0 + Hh * 0.18, 0); uv.push(0.5, 0.05);
        for (let j = 0; j < n; j++) idx.push(uc, 1 + j, 2 + j);
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
        g.computeVertexNormals(); // smooth across the tier: soft boughs, not facets
        return g;
      };
      const species = [
        { tiers: 6, R: 3.0, Ht: 13, trunk: 1.6, seed: 3 },   // tall Norway spruce
        { tiers: 5, R: 3.4, Ht: 9.5, trunk: 1.2, seed: 8 },  // broad fir
        { tiers: 4, R: 1.8, Ht: 5, trunk: 0.7, seed: 12 },   // young tree
      ];
      const sGeo = species.map((sp) => {
        const rr = G.rng(sp.seed), parts = [];
        for (let k = 0; k < sp.tiers; k++) {
          const f = k / (sp.tiers - 1), y0 = sp.trunk + f * (sp.Ht - sp.trunk) * 0.86, R = sp.R * (1 - f * 0.82) * (0.92 + 0.16 * rr());
          parts.push(tier(y0, R, R * 0.95 + 0.6, rr() * 6.3, rr));
        }
        const fol = ADDONS.mergeGeometries(parts);
        // bend the normals outwards a little: the tree shades like a soft volume instead of a stack of plates
        const pa = fol.attributes.position, na = fol.attributes.normal;
        for (let v = 0; v < pa.count; v++) {
          const x = pa.getX(v), z = pa.getZ(v), l = Math.hypot(x, z) || 1;
          const nx = na.getX(v) * 0.65 + (x / l) * 0.35, ny = na.getY(v) * 0.65, nz = na.getZ(v) * 0.65 + (z / l) * 0.35, nl = Math.hypot(nx, ny, nz);
          na.setXYZ(v, nx / nl, ny / nl, nz / nl);
        }
        const trunk = new T.CylinderGeometry(0.07 * sp.R, 0.13 * sp.R, sp.Ht * 0.92, 7, 1).translate(0, sp.Ht * 0.46 - 0.3, 0);
        return { fol, trunk };
      });
      const pines = placeScatter(Math.round(1900 * dens), (x, z, d, y) => offRoad(d, 4) && d < 700 && y < (fjord ? 220 : 260) && y > (fjord ? 0.5 : -2) && slopeAt(x, z) < 0.75 && notChasm(x, z));
      // groves: thin out the trees that ended up alone in open snow, keep the clumps
      const groves = []; for (let k = 0; k < 90; k++) groves.push([tr.minX - 700 + R() * (tr.maxX - tr.minX + 1400), tr.minZ - 700 + R() * (tr.maxZ - tr.minZ + 1400), 60 + R() * 140]);
      const kept = pines.filter((c) => c[3] < 0.12 || groves.some(([gx, gz, gr]) => Math.hypot(c[0] - gx, c[2] - gz) < gr) || distAt(c[0], c[2]) < 60);
      const bySp = species.map(() => []);
      for (const c of kept) bySp[c[3] < 0.5 ? 0 : c[3] < 0.82 ? 1 : 2].push(c);
      const tc = new T.Color();
      species.forEach((sp, k) => {
        const list = bySp[k];
        if (!list.length) return;
        const place = (c, m) => {
          const h = G.wrap(c[3] * 7919, 1), sc0 = (k === 2 ? 0.7 : 0.75) + h * 0.7;
          m.compose(ps.set(c[0], c[1] - 0.4, c[2]), qq.setFromAxisAngle(up, h * 40), sc.set(sc0, sc0 * (0.9 + G.wrap(h * 13, 1) * 0.3), sc0));
        };
        const fm = instance(sGeo[k].fol, needleMat, list, place);
        list.forEach((c, j) => { const h = G.wrap(c[3] * 3571, 1); fm.setColorAt(j, tc.setRGB(0.82 + h * 0.3, 0.86 + h * 0.24, 0.8 + h * 0.2)); });
        fm.instanceColor.needsUpdate = true;
        instance(sGeo[k].trunk, barkMat, list, place).castShadow = false;
      });
      W.pines = kept;
      // a village of chalets round the start
      const ch = [];
      for (let k = 0; k < 400 && ch.length < Math.round(34 * dens); k++) {
        const s = G.wrap(-500 + R() * 1200, tr.length), sg = R() < 0.5 ? -1 : 1, lat = sg * (WO + 9 + R() * 90), p = tr.sample(s, {});
        const x = p.x + p.rx * lat, z = p.z + p.rz * lat;
        if (distAt(x, z) < WO + 7 || slopeAt(x, z) > 0.2 || (fjord && hAt(x, z) < 0.3) || !notChasm(x, z) || ch.some((c) => Math.hypot(c[0] - x, c[2] - z) < 16)) continue;
        ch.push([x, hAt(x, z), z, R(), yawOf(p)]);
      }
      const walls = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const roofG = new T.CylinderGeometry(0.62, 0.62, 1, 3, 1).rotateZ(Math.PI / 2).rotateX(Math.PI / 6 + Math.PI); roofG.scale(1, 0.62, 1.15);
      const sizes = ch.map((c) => [9 + c[3] * 6, 5 + c[3] * 3, 8 + c[3] * 4]);
      instance(walls, new T.MeshStandardMaterial({ color: fjord ? 0x9a2620 : 0x7a4e2e, roughness: 0.85 }), ch, (c, m, k) => { const [w, h, d2] = sizes[k]; m.compose(ps.set(c[0], c[1] - 0.6, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(w, h + 0.6, d2)); });
      instance(roofG, new T.MeshStandardMaterial({ color: fjord ? 0x2b2d30 : 0xf2f5f8, roughness: 0.8 }), ch, (c, m, k) => { const [w, h, d2] = sizes[k]; m.compose(ps.set(c[0], c[1] + h - 0.1, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(w * 1.18, w * 0.62, d2 * 1.2)); });
      // warm windows
      const winM = new T.MeshBasicMaterial({ color: new T.Color(3.2, 1.9, 0.8), toneMapped: false });
      W.chaletWin = instance(new T.BoxGeometry(1, 1, 1), winM, ch, (c, m, k) => { const [w, h, d2] = sizes[k]; m.compose(ps.set(c[0], c[1] + h * 0.45, c[2]), qq.setFromAxisAngle(up, c[4]), sc.set(w * 0.7, 1.1, d2 + 0.08)); });
      const rocks = placeScatter(Math.round(260 * dens), (x, z, d, y) => offRoad(d, 3) && d < 500 && (!fjord || y > -1));
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
  function landMaterial(theme) {
    const alps = theme === 'alps', isle = theme === 'isle', fjord = theme === 'fjord';
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
          ${isle ? `
          // sea floor turquoise sand, a white beach, jungle green climbing to black ash, steep faces basalt
          vec3 sea = mix(vec3(0.55, 0.78, 0.7), vec3(0.85, 0.82, 0.62), smoothstep(-6.0, -1.8, y));
          vec3 sand = vec3(0.9, 0.82, 0.62) * (0.9 + 0.1 * gn);
          vec3 green = mix(vec3(0.12, 0.3, 0.08), vec3(0.24, 0.42, 0.12), gn);
          green = mix(green, vec3(0.32, 0.36, 0.14), smoothstep(0.72, 0.85, ln(vLWP.xz * 0.2)) * 0.5);
          vec3 ash = mix(vec3(0.09, 0.08, 0.08), vec3(0.26, 0.15, 0.11), ln(vLWP.xz * 0.03));
          vec3 basalt = mix(vec3(0.07, 0.065, 0.07), vec3(0.18, 0.15, 0.14), ln(vec2(y * 0.5, vLWP.x * 0.07 + vLWP.z * 0.07)));
          float yy = y + (gn - 0.5) * 10.0;
          vec3 c = mix(sand, green, smoothstep(1.0, 3.5, yy));
          c = mix(c, ash, smoothstep(90.0, 140.0, yy));
          c = mix(sea, c, smoothstep(-2.4, -1.2, y));
          diffuseColor.rgb = mix(basalt, c, smoothstep(0.55, 0.75, fl));
          ` : fjord ? `
          // black wet rock at the waterline, moss and heather on anything flat, snow on the high flats, grey granite walls
          vec3 snow = vec3(0.86, 0.9, 0.96) * (0.92 + 0.08 * gn);
          vec3 moss = mix(vec3(0.13, 0.2, 0.08), vec3(0.27, 0.32, 0.15), gn);
          moss = mix(moss, vec3(0.3, 0.22, 0.2), smoothstep(0.74, 0.86, ln(vLWP.xz * 0.15)) * 0.5);
          vec3 rock = mix(vec3(0.14, 0.145, 0.155), vec3(0.32, 0.31, 0.3), ln(vec2(y * 0.3, vLWP.x * 0.04 + vLWP.z * 0.04)));
          rock = mix(rock, vec3(0.08, 0.09, 0.1), smoothstep(0.75, 0.95, ln(vec2(vLWP.x * 0.02 + vLWP.z * 0.02, y * 0.08))) * 0.6); // streaks
          float yy = y + (gn - 0.5) * 40.0;
          vec3 top = mix(moss, snow, smoothstep(200.0, 280.0, yy));
          vec3 c = mix(rock, top, smoothstep(0.62, 0.8, fl + gn * 0.12));
          c = mix(vec3(0.04, 0.045, 0.05), c, smoothstep(-0.5, 3.0, y));
          diffuseColor.rgb = mix(vec3(0.07, 0.14, 0.15), c, smoothstep(-3.0, -1.4, y));
          ` : alps ? `
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
