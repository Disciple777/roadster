// crossing.js — cross streets: side roads that cut straight across the circuit, each with traffic lights on one
// shared clock that runs whether or not anyone is near. Traffic on the circuit stops for red and cross traffic only
// goes on its own green, so you arrive to a queue, a stream of cars to jump, or a clear run.
(function () {
  const T = THREE;
  const HALF = 5;   // cross street half-width (two 3.6 m lanes and a margin)
  const LANE = 1.8; // cross lane centre, either side of the street's middle
  // one cycle (s): circuit green → circuit yellow → all red → cross green → cross yellow → all red
  const CYCLE = 32, MAIN_G = 15, MAIN_Y = 18, CROSS_G0 = 20, CROSS_G1 = 27, CROSS_Y = 29.5;
  G.XING = { HALF, LANE };

  const swrap = (d, L) => G.wrap(d + L / 2, L) - L / 2; // signed distance along the lap

  // spread round the lap, on straights, clear of the ramps and the start, with side streets that don't run into
  // another stretch of the circuit
  G.placeCrossings = function (track) {
    const L = track.length, out = [], p = {};
    const n = Math.max(3, Math.round(L / 950));
    // how far the side street can run on one side before it meets other road
    const reach = (s, sg) => {
      track.sample(s, p);
      let u = G.WALK_OUT + 4;
      for (; u <= 160; u += 4) {
        const x = p.x + p.rx * sg * u, z = p.z + p.rz * sg * u;
        const i = track.gridNearest(x, z, Math.ceil(40 / track.cell));
        if (i >= 0 && track._gd < G.WALK_OUT + HALF + 4 && Math.abs(swrap(i * track.ds - s, L)) > 60) break;
      }
      return u - 12;
    };
    for (let k = 0; k < n; k++) {
      const f = (k + 0.55) / n;
      let best = null, bk = 0.006;
      for (let d = -170; d <= 170; d += 10) {
        const s = G.wrap(f * L + d, L);
        if (s < 170 || s > L - 100) continue;
        if (track.ramps.some((r) => Math.abs(swrap(r.s - s, L)) < 80)) continue;
        if (out.some((x) => Math.abs(swrap(x.s - s, L)) < 320)) continue;
        let kk = 0;
        for (let e = -40; e <= 40; e += 10) kk = Math.max(kk, track.curvatureAt(s + e));
        if (kk >= bk) continue;
        const a = reach(s, -1), b = reach(s, 1);
        if (a < 50 || b < 50) continue;
        bk = kk; best = { s, ext: [a, b] }; // ext[0]: how far the street runs on the -r side, ext[1]: the +r side
      }
      if (best) {
        track.sample(best.s, p);
        out.push(Object.assign(best, { x: p.x, z: p.z, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz }));
      }
    }
    return out.sort((a, b) => a.s - b.s);
  };

  // is (x, z) on a cross street (plus pad)? the city keeps its buildings out of them
  G.inCrossing = function (track, x, z, pad) {
    for (const X of track.crossings || []) {
      const dx = x - X.x, dz = z - X.z;
      const along = dx * X.tx + dz * X.tz, u = dx * X.rx + dz * X.rz;
      if (Math.abs(along) < HALF + pad && u > -X.ext[0] - 15 && u < X.ext[1] + 15) return true;
    }
    return false;
  };
  G.nearCrossingS = (track, s, pad) => (track.crossings || []).some((X) => Math.abs(swrap(X.s - s, track.length)) < HALF + pad);

  const RED = [6, 0.25, 0.15], YEL = [6, 3.4, 0.2], GRN = [0.3, 6, 2.2];

  class Crossings {
    constructor(game) {
      this.game = game;
      const track = (this.track = game.track);
      this.list = track.crossings || [];
      this.clock = 0;
      this.state = this.list.map(() => ({ main: '', cross: '' }));
      this.group = new T.Group();
      game.scene.add(this.group);
      if (this.list.length) this.build();
      this.update(0);
    }

    phase(i) { return G.wrap(this.clock + i * 9.7, CYCLE); }
    main(i) { const t = this.phase(i); return t < MAIN_G ? 'G' : t < MAIN_Y ? 'Y' : 'R'; }
    cross(i) { const t = this.phase(i); return t >= CROSS_G0 && t < CROSS_G1 ? 'G' : t >= CROSS_G1 && t < CROSS_Y ? 'Y' : 'R'; }

    // distance from a circuit car's nose to the next stop line it has to respect (1e9 if none)
    stopGap(c) {
      const L = this.track.length;
      let best = 1e9;
      for (let i = 0; i < this.list.length; i++) {
        const X = this.list[i];
        const d = c.dir > 0 ? G.wrap(X.s - c.s, L) : G.wrap(c.s - X.s, L);
        if (d > 160) continue;
        const line = d - (HALF + 3.2) - c.t.len / 2;
        if (line < -0.5) continue; // already over the line: clear the junction
        const st = this.main(i);
        if (st === 'G') continue;
        // yellow: stop if it can be done gently; red: stop unless it's too late to stop at all
        if (st === 'Y' ? line > (c.v * c.v) / 10 : line > (c.v * c.v) / 18 - 1) best = Math.min(best, line);
      }
      return best;
    }

    update(dt) {
      this.clock += dt;
      for (let i = 0; i < this.list.length; i++) {
        const m = this.main(i), x = this.cross(i), s = this.state[i];
        if (m !== s.main || x !== s.cross) { s.main = m; s.cross = x; this.dirty = true; }
      }
      if (this.dirty && this.lamps) this.paint();
    }

    paint() {
      const col = new T.Color();
      this.heads.forEach((h, j) => {
        const st = this.state[h.i][h.grp];
        for (let k = 0; k < 3; k++) {
          const on = (k === 0 && st === 'R') || (k === 1 && st === 'Y') || (k === 2 && st === 'G');
          const c = k === 0 ? RED : k === 1 ? YEL : GRN, f = on ? 1 : 0.035;
          this.lamps.setColorAt(j * 3 + k, col.setRGB(c[0] * f, c[1] * f, c[2] * f));
        }
      });
      this.lamps.instanceColor.needsUpdate = true;
      this.dirty = false;
    }

    build() {
      const grp = this.group, RH = G.ROAD_HALF, WO = G.WALK_OUT, Q = this.game.Q;
      this.geos = []; this.mats = [];
      const keep = (g, m) => { this.geos.push(g); if (m) this.mats.push(m); return g; };

      // side street asphalt with a dashed centre line and edge lines
      const tex = G.canvasTexture(128, 256, (ctx, W, H) => {
        ctx.fillStyle = '#2a2b2f'; ctx.fillRect(0, 0, W, H);
        const r = G.rng(17);
        for (let i = 0; i < 3000; i++) { const g = 30 + r() * 40 | 0; ctx.fillStyle = `rgba(${g},${g},${g + 3},0.5)`; ctx.fillRect(r() * W, r() * H, 1.5, 1.5); }
        ctx.fillStyle = '#e8b62a'; ctx.fillRect(W / 2 - 2, 0, 4, H * 0.55);
        ctx.fillStyle = '#d8d8d2'; ctx.fillRect(6, 0, 3, H); ctx.fillRect(W - 9, 0, 3, H);
      }, { repeat: true });
      const streetM = new T.MeshStandardMaterial({ map: tex, roughness: 0.85 });
      this.mats.push(streetM);
      // zebra crossings over the circuit, and plain white for the stop lines
      const zebraTex = G.canvasTexture(64, 16, (ctx, W, H) => { ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W / 2, H); }, { repeat: true });
      const zebraM = new T.MeshStandardMaterial({ color: 0xe8e8e2, alphaMap: zebraTex, transparent: true, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 });
      const lineM = new T.MeshStandardMaterial({ color: 0xe8e8e2, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 });
      this.mats.push(zebraM, lineM);
      const m4 = new T.Matrix4(), v1 = new T.Vector3(), v2 = new T.Vector3(), v3 = new T.Vector3(0, 1, 0);
      // a flat quad: local X along (ax, az), local Y along (bx, bz), centred on (x, y, z)
      const quad = (mat, x, y, z, ax, az, w, bx, bz, h, uRep, vRep) => {
        const g = keep(new T.PlaneGeometry(w, h));
        const uv = g.attributes.uv;
        for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * uRep, uv.getY(k) * vRep);
        // right-handed basis with the face up: flip X if needed
        const flip = ax * bz - az * bx > 0 ? -1 : 1;
        const mesh = new T.Mesh(g, mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.makeBasis(v1.set(ax * flip, 0, az * flip), v2.set(bx, 0, bz), v3).setPosition(x, y, z);
        mesh.receiveShadow = true;
        grp.add(mesh);
      };

      const heads = (this.heads = []), poles = [], arms = [];
      this.list.forEach((X, i) => {
        const at = (a, l) => ({ x: X.x + X.tx * a + X.rx * l, z: X.z + X.tz * a + X.rz * l });
        // side street, both sides of the circuit, from the kerb out
        for (const sg of [-1, 1]) {
          const ext = X.ext[sg > 0 ? 1 : 0], len = ext - RH, c = at(0, sg * (RH + ext) / 2);
          quad(streetM, c.x, 0.17, c.z, X.tx, X.tz, HALF * 2, X.rx * sg, X.rz * sg, len, 1, len / 12);
          // its stop line, across the lane heading in
          const sl = at(sg * HALF / 2, sg * (WO + 0.3));
          quad(lineM, sl.x, 0.18, sl.z, X.tx, X.tz, HALF, X.rx, X.rz, 0.45, 1, 1);
        }
        // zebras either side of the junction box, stop lines before them
        for (const sg of [-1, 1]) {
          const z = at(sg * (HALF + 1.6), 0);
          quad(zebraM, z.x, 0.012, z.z, X.rx, X.rz, RH * 2, X.tx, X.tz, 3, (RH * 2) / 1.2, 1);
        }
        const onc = G.LANES_ONC.length > 0;
        const fl = onc ? [0, RH] : [-RH, RH];
        const sf = at(-(HALF + 3.6), (fl[0] + fl[1]) / 2);
        quad(lineM, sf.x, 0.013, sf.z, X.rx, X.rz, fl[1] - fl[0], X.tx, X.tz, 0.45, 1, 1);
        if (onc) { const so = at(HALF + 3.6, -RH / 2); quad(lineM, so.x, 0.013, so.z, X.rx, X.rz, RH, X.tx, X.tz, 0.45, 1, 1); }

        // signals on the far right corner for each approach; masts carry extra heads out over the lanes
        const signal = (a, l, fx, fz, grpName, armTo, overLanes, armAlong) => {
          const p = at(a, l);
          poles.push({ x: p.x, z: p.z, h: armTo != null ? 7 : 4.2 });
          heads.push({ x: p.x, y: 3.4, z: p.z, fx, fz, i, grp: grpName });
          if (armTo == null) return;
          const e = armAlong ? at(armTo, l) : at(a, armTo);
          arms.push({ x0: p.x, z0: p.z, x1: e.x, z1: e.z, y: 6.7 });
          for (const o of overLanes) { const q = armAlong ? at(o, l) : at(a, o); heads.push({ x: q.x, y: 6.0, z: q.z, fx, fz, i, grp: grpName }); }
        };
        const fwdHeads = onc ? [RH * 0.3, RH * 0.7] : [RH * 0.45, -RH * 0.45];
        signal(HALF + 1, RH + 1, -X.tx, -X.tz, 'main', onc ? RH * 0.1 : -RH * 0.55, fwdHeads, false);
        if (onc) signal(-(HALF + 1), -(RH + 1), X.tx, X.tz, 'main', -RH * 0.1, [(G.LANES_ONC[0] + G.LANES_ONC[G.LANES_ONC.length - 1]) / 2], false);
        // cross traffic heading +r looks for its light on the far (+r) side, on its right (-t)
        signal(-(HALF + 1), RH + 1, -X.rx, -X.rz, 'cross', -LANE + 0.6, [-LANE], true);
        signal(HALF + 1, -(RH + 1), X.rx, X.rz, 'cross', LANE - 0.6, [LANE], true);
      });

      const metal = new T.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7 });
      const headM = new T.MeshStandardMaterial({ color: 0x15161a, roughness: 0.6, metalness: 0.3 });
      const lampM = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
      this.mats.push(metal, headM, lampM);
      const poleG = keep(new T.CylinderGeometry(0.11, 0.15, 1, 8).translate(0, 0.5, 0));
      const armG = keep(new T.BoxGeometry(1, 0.14, 0.14));
      const headG = keep(new T.BoxGeometry(0.46, 1.3, 0.34));
      const lampG = keep(new T.CircleGeometry(0.14, 14));
      const pm = new T.InstancedMesh(poleG, metal, poles.length), am = new T.InstancedMesh(armG, metal, Math.max(1, arms.length));
      const hm = new T.InstancedMesh(headG, headM, heads.length), lm = (this.lamps = new T.InstancedMesh(lampG, lampM, heads.length * 3));
      const q = new T.Quaternion(), p = new T.Vector3(), s = new T.Vector3(), up = new T.Vector3(0, 1, 0);
      poles.forEach((o, j) => pm.setMatrixAt(j, m4.compose(p.set(o.x, 0, o.z), q.identity(), s.set(1, o.h, 1))));
      arms.forEach((o, j) => {
        const dx = o.x1 - o.x0, dz = o.z1 - o.z0, len = Math.hypot(dx, dz);
        q.setFromAxisAngle(up, Math.atan2(-dz, dx));
        am.setMatrixAt(j, m4.compose(p.set((o.x0 + o.x1) / 2, o.y, (o.z0 + o.z1) / 2), q, s.set(len, 1, 1)));
      });
      if (!arms.length) am.count = 0;
      heads.forEach((h, j) => {
        q.setFromAxisAngle(up, Math.atan2(h.fx, h.fz));
        hm.setMatrixAt(j, m4.compose(p.set(h.x, h.y, h.z), q, s.set(1, 1, 1)));
        for (let k = 0; k < 3; k++) lm.setMatrixAt(j * 3 + k, m4.compose(p.set(h.x + h.fx * 0.18, h.y + 0.4 - k * 0.4, h.z + h.fz * 0.18), q, s));
      });
      for (const im of [pm, am, hm, lm]) { im.frustumCulled = false; grp.add(im); }
      pm.castShadow = am.castShadow = hm.castShadow = !!Q.shadows;
      this.dirty = true;
      this.paint();
    }

    dispose() {
      this.game.scene.remove(this.group);
      for (const g of this.geos || []) g.dispose();
      for (const m of this.mats || []) { if (m.map) m.map.dispose(); if (m.alphaMap) m.alphaMap.dispose(); m.dispose(); }
    }
  }
  G.Crossings = Crossings;
})();
