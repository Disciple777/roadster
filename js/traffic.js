// traffic.js — instanced city traffic in both directions, lane following, knock-around wrecks,
// roofs you can land on, near-miss / jump-over detection
(function () {
  const T = THREE;
  const { mergeGeometries, toCreasedNormals, RoundedBoxGeometry } = ADDONS;

  const BODY_COLS = [0xc8ccd2, 0x1c1e22, 0x7d1f22, 0x24456e, 0xe9e9e6, 0x5a5f66, 0x2f5a3c, 0xb88a2a, 0x8b8f96, 0x3d2a4f, 0xd9542a];

  function part(list, geo, c, x, y, z, ry = 0) {
    if (geo.index) geo = geo.toNonIndexed();
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    const n = geo.attributes.position.count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2]; }
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    list.push(geo);
  }
  const BODY = [1, 1, 1], GLASS = [0.05, 0.06, 0.08], BLACK = [0.03, 0.03, 0.035], CHROME = [0.55, 0.56, 0.58], PLATE = [0.75, 0.75, 0.7];
  const HEAD = [2.0, 1.95, 1.75], TAILC = [1.7, 0.05, 0.04];
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = 0.18) => new RoundedBoxGeometry(w, h, d, 2, r);
  const wheel = (r, w) => new T.CylinderGeometry(r, r, w, 16).rotateZ(Math.PI / 2);

  // Smooth lofted car body. Sections: [z, wLow, yBottom, yBelt, wBelt, yRoof, wRoof] (half widths), front (-Z) first.
  // Side windows sit between belt and roof inside glassZ; steep roof panels become windscreens.
  const CR = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  function loft(list, secs, glassZ, SUB = 3) {
    const prof = ([z, wl, yb, ybt, wb, yr, wr]) =>
      [z, [[0, yb], [wl - 0.05, yb], [wl, yb + 0.14], [wl + 0.015, (yb + ybt) / 2], [wb, ybt], [wr, yr], [0, yr + 0.025]]];
    const P = secs.map(prof);
    const S = [];
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[Math.max(0, k - 1)], b = P[k], c = P[k + 1], d = P[Math.min(P.length - 1, k + 2)];
      for (let i = 0; i < SUB; i++) {
        const t = i / SUB;
        S.push([CR(a[0], b[0], c[0], d[0], t), b[1].map((_, j) => [
          CR(a[1][j][0], b[1][j][0], c[1][j][0], d[1][j][0], t),
          CR(a[1][j][1], b[1][j][1], c[1][j][1], d[1][j][1], t)])]);
      }
    }
    S.push(P[P.length - 1]);
    const pos = [], col = [];
    const tri = (A, B, C, c) => { pos.push(...A, ...B, ...C); col.push(...c, ...c, ...c); };
    for (let k = 0; k < S.length - 1; k++) {
      const [z0, p0] = S[k], [z1, p1] = S[k + 1];
      const zm = (z0 + z1) / 2;
      for (let j = 0; j < 6; j++) {
        let c = j === 0 ? BLACK : BODY;
        if (j === 4 && zm > glassZ[0] && zm < glassZ[1] && p0[5][1] - p0[4][1] > 0.25 && p1[5][1] - p1[4][1] > 0.25) c = GLASS;
        if (j === 5 && Math.abs((p1[5][1] - p0[5][1]) / (z1 - z0)) > 0.42) c = GLASS;
        for (const sx of [1, -1]) {
          const A = [p0[j][0] * sx, p0[j][1], z0], B = [p0[j + 1][0] * sx, p0[j + 1][1], z0];
          const C = [p1[j + 1][0] * sx, p1[j + 1][1], z1], D = [p1[j][0] * sx, p1[j][1], z1];
          if (sx > 0) { tri(A, B, C, c); tri(A, C, D, c); } else { tri(A, C, B, c); tri(A, D, C, c); }
        }
      }
    }
    // end caps (fan from the profile centre)
    for (const [k, front] of [[0, true], [S.length - 1, false]]) {
      const [z, p] = S[k];
      const ctr = [0, (p[0][1] + p[6][1]) / 2, z];
      for (let j = 0; j < 6; j++) for (const sx of [1, -1]) {
        const a = [p[j][0] * sx, p[j][1], z], b = [p[j + 1][0] * sx, p[j + 1][1], z];
        const c = j === 0 ? BLACK : BODY;
        if (front === (sx > 0)) tri(ctr, b, a, c); else tri(ctr, a, b, c);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    list.push(toCreasedNormals(g, 0.7));
  }

  function wheels(list, wid, r, zs) {
    for (const z of zs) for (const sx of [-1, 1]) {
      part(list, wheel(r, 0.26), BLACK, sx * (wid / 2 - 0.12), r, z);
      part(list, wheel(r * 0.62, 0.275), CHROME, sx * (wid / 2 - 0.12), r, z);
    }
  }
  function lights(list, wid, len, yH, yT) {
    for (const sx of [-1, 1]) {
      part(list, box(0.34, 0.11, 0.05), HEAD, sx * (wid / 2 - 0.32), yH, -len / 2 - 0.01);
      part(list, box(0.4, 0.12, 0.05), TAILC, sx * (wid / 2 - 0.3), yT, len / 2 + 0.01);
    }
  }
  function carDetails(b, wid, len, yMirror, zMirror, yPlate) {
    for (const sx of [-1, 1]) part(b, box(0.2, 0.12, 0.1), BODY, sx * (wid / 2 + 0.06), yMirror, zMirror);
    part(b, box(0.5, 0.13, 0.03), PLATE, 0, yPlate, len / 2 + 0.01);
    part(b, box(0.5, 0.13, 0.03), PLATE, 0, yPlate - 0.05, -len / 2 - 0.01);
  }

  const TYPES = [
    {
      id: 'sedan', name: 'CAR', len: 4.6, wid: 1.85, hgt: 1.48, mass: 1500, weight: 40, vmin: 21, vmax: 31, bonus: 300,
      build(b, l) {
        loft(b, [
          [-2.30, 0.80, 0.30, 0.66, 0.76, 0.70, 0.68],
          [-2.05, 0.90, 0.24, 0.78, 0.88, 0.80, 0.78],
          [-1.05, 0.925, 0.24, 0.86, 0.90, 0.92, 0.82],
          [-0.50, 0.925, 0.24, 0.89, 0.89, 1.40, 0.70],
          [0.35, 0.925, 0.24, 0.90, 0.88, 1.46, 0.70],
          [1.05, 0.925, 0.24, 0.92, 0.88, 1.38, 0.68],
          [1.65, 0.915, 0.25, 0.95, 0.88, 1.00, 0.80],
          [2.30, 0.86, 0.32, 0.92, 0.82, 0.95, 0.74],
        ], [-0.7, 1.4]);
        part(b, box(1.2, 0.14, 0.04), BLACK, 0, 0.5, -2.31);
        carDetails(b, 1.85, 4.6, 0.95, -0.55, 0.62);
        wheels(b, 1.85, 0.34, [-1.45, 1.45]);
        lights(l, 1.85, 4.6, 0.72, 0.84);
      },
    },
    {
      id: 'suv', name: 'SUV', len: 4.9, wid: 2.0, hgt: 1.85, mass: 2100, weight: 24, vmin: 20, vmax: 29, bonus: 350,
      build(b, l) {
        loft(b, [
          [-2.45, 0.92, 0.40, 0.86, 0.90, 0.92, 0.82],
          [-2.15, 0.98, 0.36, 1.00, 0.97, 1.05, 0.90],
          [-1.30, 1.00, 0.36, 1.08, 0.98, 1.14, 0.92],
          [-0.85, 1.00, 0.36, 1.10, 0.97, 1.74, 0.86],
          [0.20, 1.00, 0.36, 1.10, 0.96, 1.82, 0.86],
          [1.70, 1.00, 0.36, 1.10, 0.96, 1.80, 0.86],
          [2.25, 0.98, 0.38, 1.10, 0.94, 1.72, 0.84],
          [2.45, 0.95, 0.42, 1.05, 0.90, 1.55, 0.82],
        ], [-1.0, 2.2]);
        part(b, box(1.3, 0.3, 0.05), BLACK, 0, 0.72, -2.46);
        part(b, box(1.6, 0.05, 2.6), BLACK, 0, 1.86, 0.4);
        carDetails(b, 2.0, 4.9, 1.2, -0.85, 0.8);
        wheels(b, 2.0, 0.4, [-1.55, 1.55]);
        lights(l, 2.0, 4.9, 0.96, 1.08);
      },
    },
    {
      id: 'van', name: 'VAN', len: 5.4, wid: 2.05, hgt: 2.45, mass: 2800, weight: 12, vmin: 19, vmax: 27, bonus: 450,
      build(b, l) {
        loft(b, [
          [-2.70, 0.95, 0.40, 0.98, 0.95, 1.04, 0.90],
          [-2.35, 1.00, 0.36, 1.14, 1.00, 1.26, 0.95],
          [-1.65, 1.02, 0.36, 1.20, 1.00, 2.36, 0.97],
          [0.00, 1.025, 0.36, 1.22, 1.01, 2.40, 0.98],
          [2.60, 1.025, 0.36, 1.25, 1.01, 2.40, 0.98],
          [2.70, 1.00, 0.40, 1.25, 0.99, 2.38, 0.96],
        ], [-2.4, -1.1]);
        part(b, box(1.4, 0.32, 0.05), BLACK, 0, 0.75, -2.71);
        carDetails(b, 2.05, 5.4, 1.45, -1.6, 0.7);
        wheels(b, 2.05, 0.38, [-1.8, 1.8]);
        lights(l, 2.05, 5.4, 0.9, 1.0);
      },
    },
    {
      id: 'bus', name: 'BUS', len: 12, wid: 2.55, hgt: 3.2, mass: 12000, weight: 6, vmin: 16, vmax: 22, bonus: 800, outer: true,
      build(b, l) {
        part(b, rbox(2.55, 2.75, 12, 0.22), BODY, 0, 1.78, 0);
        part(b, box(2.58, 0.95, 10.4), GLASS, 0, 2.3, 0.6);
        part(b, box(2.3, 1.55, 0.06), GLASS, 0, 2.05, -6.01);
        part(b, box(2.58, 0.18, 12.02), [0.75, 0.12, 0.1], 0, 1.15, 0);
        part(b, rbox(2.2, 0.3, 6, 0.1), [0.6, 0.6, 0.62], 0, 3.25, 0.8);
        for (const sx of [-1, 1]) part(b, box(0.08, 0.35, 0.12), BLACK, sx * 1.36, 2.6, -5.8);
        part(b, box(0.7, 0.2, 0.04), PLATE, 0, 0.7, 6.01);
        wheels(b, 2.55, 0.5, [-4.0, 3.6]);
        lights(l, 2.55, 12, 0.9, 1.1);
        part(l, box(1.6, 0.18, 0.04), [1.6, 1.3, 0.2], 0, 3.0, -6.02);
      },
    },
    {
      id: 'semi', name: 'SEMI', len: 16, wid: 2.55, hgt: 3.9, mass: 20000, weight: 7, vmin: 17, vmax: 23, bonus: 1000, outer: true,
      build(b, l) {
        part(b, rbox(2.5, 2.3, 2.6, 0.25), BODY, 0, 2.0, -6.6);
        part(b, rbox(2.45, 0.9, 1.0, 0.18), BODY, 0, 1.0, -7.75);
        part(b, box(2.3, 0.85, 0.06), GLASS, 0, 2.55, -7.92);
        part(b, box(1.6, 0.8, 0.05), CHROME, 0, 1.15, -8.27);
        for (const sx of [-1, 1]) part(b, new T.CylinderGeometry(0.09, 0.09, 1.8, 10), CHROME, sx * 1.15, 3.3, -5.4);
        part(b, rbox(2.55, 2.95, 12.6, 0.08), [0.92, 0.92, 0.92], 0, 2.42, 1.65);
        part(b, box(2.2, 0.4, 13), BLACK, 0, 0.72, 0.5);
        part(b, box(2.4, 0.25, 0.6), BLACK, 0, 0.62, -5.6);
        wheels(b, 2.5, 0.52, [-6.8, -4.6, 5.0, 6.4]);
        lights(l, 2.5, 16, 1.0, 1.2);
        for (let i = -2; i <= 2; i++) part(l, box(0.1, 0.06, 0.04), [1.7, 0.8, 0.1], i * 0.3, 3.2, -7.95);
      },
    },
    {
      id: 'box', name: 'TRUCK', len: 8, wid: 2.4, hgt: 3.4, mass: 7000, weight: 7, vmin: 18, vmax: 25, bonus: 700, outer: true,
      build(b, l) {
        part(b, rbox(2.3, 2.0, 2.0, 0.22), BODY, 0, 1.5, -3.0);
        part(b, box(2.1, 0.7, 0.06), GLASS, 0, 1.95, -4.01);
        part(b, box(1.4, 0.5, 0.04), BLACK, 0, 0.95, -4.02);
        part(b, rbox(2.4, 2.6, 5.8, 0.06), [0.88, 0.88, 0.88], 0, 2.1, 1.0);
        part(b, box(2.0, 0.3, 7.6), BLACK, 0, 0.62, 0.1);
        wheels(b, 2.3, 0.48, [-2.9, 2.6]);
        lights(l, 2.3, 8, 0.9, 1.05);
      },
    },
  ];
  G.TRAFFIC_TYPES = TYPES;

  const DENSITY = { off: 0, light: 45, medium: 95, heavy: 165, insane: 260 };
  G.TRAFFIC_DENSITY = DENSITY;

  class Traffic {
    constructor(game, density) {
      this.game = game;
      const track = (this.track = game.track);
      // the counts are tuned for the 3.8 km, six-lane city loop: keep cars-per-lane-km about the same elsewhere
      const n = Math.round((DENSITY[density] ?? 95) * G.clamp(track.length * G.LANES.length / (3807 * 6), 0.5, 1.6));
      this.cars = [];
      this.near = [];
      this.group = new T.Group();
      game.scene.add(this.group);
      const totalW = TYPES.reduce((a, t) => a + t.weight, 0);
      const counts = TYPES.map(() => 0);
      const assign = [];
      for (let i = 0; i < n; i++) {
        let r = Math.random() * totalW, ti = 0;
        while (r > TYPES[ti].weight) { r -= TYPES[ti].weight; ti++; }
        assign.push(ti); counts[ti]++;
      }
      const shadows = game.Q.shadows;
      this.meshes = TYPES.map((t, ti) => {
        if (!counts[ti]) return null;
        const b = [], l = [];
        t.build(b, l);
        const bg = mergeGeometries(b), lg = mergeGeometries(l);
        const bm = new T.InstancedMesh(bg, new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 }), counts[ti]);
        const lm = new T.InstancedMesh(lg, new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), counts[ti]);
        bm.castShadow = shadows; bm.frustumCulled = false; lm.frustumCulled = false;
        bm.instanceMatrix.setUsage(T.DynamicDrawUsage); lm.instanceMatrix.setUsage(T.DynamicDrawUsage);
        this.group.add(bm, lm);
        return { bm, lm, used: 0 };
      });
      // blob shadows
      this.blobs = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new T.MeshBasicMaterial({ map: G.blobShadowTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, blending: T.MultiplyBlending, premultipliedAlpha: true }), Math.max(1, n));
      this.blobs.material.blending = T.CustomBlending;
      this.blobs.material.blendEquation = T.AddEquation;
      this.blobs.material.blendSrc = T.ZeroFactor;
      this.blobs.material.blendDst = T.OneMinusSrcColorFactor;
      this.blobs.material.color.setScalar(0.62);
      this.blobs.material.opacity = 1;
      this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
      this.group.add(this.blobs);
      this.blobs.count = n;

      const col = new T.Color();
      for (let i = 0; i < n; i++) {
        const ti = assign[i], t = TYPES[ti];
        const mesh = this.meshes[ti];
        const idx = mesh.used++;
        mesh.bm.setColorAt(idx, col.set(t.id === 'bus' ? G.pick([0xf2c230, 0xe9e9e6, 0x2c6fb7, 0xc0302c]) : G.pick(BODY_COLS)));
        const c = {
          id: i, ti, t, idx, s: 0, lane: 0, lat: 0, latT: 0, v: 0, vT: 0, dir: 1,
          x: 0, y: 0, z: 0, yaw: 0, hx: 0, hz: -1,
          loose: false, lvx: 0, lvy: 0, lvz: 0, yawV: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, timer: 0,
          lastAlong: NaN, cd: 0, latV: 0,
        };
        this.cars.push(c);
      }
      for (const m of this.meshes) if (m && m.bm.instanceColor) m.bm.instanceColor.needsUpdate = true;
      this._s = {}; this._n = {};
      this._gq = {};
      this.spawnAll(0, 70);
    }

    laneLat(lane) { return G.LANES[lane]; }
    // the lanes running the same way as this one (indices into G.LANES)
    laneGroup(lane) { const nf = G.LANES_FWD.length; return lane < nf ? [0, nf] : [nf, G.LANES.length]; }
    // trucks and buses keep out of the fast (leftmost) third of their side
    laneOk(t, lane) { const [a, b] = this.laneGroup(lane); return !t.outer || lane - a >= (b - a) / 3; }

    pickLane(t) {
      let lane;
      do lane = (Math.random() * G.LANES.length) | 0; while (!this.laneOk(t, lane));
      return lane;
    }

    // spread cars along the track keeping clear of the zone around s0
    spawnAll(s0, clear) {
      const L = this.track.length;
      for (const c of this.cars) {
        let tries = 0;
        do {
          c.lane = this.pickLane(c.t);
          c.s = Math.random() * L;
          tries++;
        } while (tries < 40 && (this.zoneDist(c.s, s0) < clear || !this.freeAt(c, c.lane, c.s)));
        this.initCar(c);
      }
    }
    zoneDist(a, b) { const L = this.track.length; const d = Math.abs(G.wrap(a - b, L)); return Math.min(d, L - d); }
    freeAt(c, lane, s) {
      for (const o of this.cars) {
        if (o === c || o.loose || o.lane !== lane || o.v === undefined) continue;
        if (this.zoneDist(o.s, s) < (o.t.len + c.t.len) / 2 + 10) return false;
      }
      return true;
    }
    initCar(c) {
      c.dir = c.lane < G.LANES_FWD.length ? 1 : -1;
      c.lat = c.latT = this.laneLat(c.lane);
      c.vT = G.rand(c.t.vmin, c.t.vmax) * (G.TRACK.traffic || 1);
      c.v = c.vT * 0.9;
      c.loose = false; c.roll = 0; c.pitch = 0; c.rollV = 0; c.pitchV = 0; c.timer = 0; c.lastAlong = NaN; c.y = 0;
      this.place(c);
    }

    respawnFar(c, ps) {
      const L = this.track.length;
      for (let k = 0; k < 30; k++) {
        const s = G.wrap(ps + G.rand(260, L - 260), L);
        const lane = this.pickLane(c.t);
        if (this.freeAt(c, lane, s)) { c.s = s; c.lane = lane; this.initCar(c); return; }
      }
    }

    place(c) {
      const p = this.track.sample(c.s, this._s);
      c.x = p.x + p.rx * c.lat; c.z = p.z + p.rz * c.lat;
      // heading with slight lane-change angle
      const a = Math.atan2(c.latV, Math.max(c.v, 1));
      const hx = p.tx * c.dir, hz = p.tz * c.dir;
      const ca = Math.cos(a), sa = Math.sin(a);
      // rotate heading towards +right by a (right of travel for dir=+1 is +r)
      c.hx = hx * ca + p.rx * sa; c.hz = hz * ca + p.rz * sa;
      c.yaw = Math.atan2(-c.hx, -c.hz);
      this.track.groundAt(c.x, c.z, this._gq);
      c.y = this._gq.h;
    }

    update(dt, player, playerS) {
      const L = this.track.length;
      // lane lists
      const NL = G.LANES.length, lanes = G.LANES.map(() => []);
      for (const c of this.cars) {
        if (!c.loose) { lanes[c.lane].push(c); continue; }
        // a slow wreck sitting in a lane is an obstacle the cars behind brake for and steer around
        if (c.y > 1 || Math.hypot(c.lvx, c.lvz) > 4) continue;
        for (let ln = 0; ln < NL; ln++) if (Math.abs(this.laneLat(ln) - c.lat) < 1.9) lanes[ln].push(c);
      }
      for (let ln = 0; ln < NL; ln++) {
        const arr = lanes[ln];
        arr.sort((a, b) => a.s - b.s);
        const n = arr.length;
        for (let k = 0; k < n; k++) {
          const c = arr[k];
          if (c.loose) continue;
          let gap = 1e9, lead = null;
          if (n > 1) {
            lead = c.dir > 0 ? arr[(k + 1) % n] : arr[(k - 1 + n) % n];
            const d = c.dir > 0 ? G.wrap(lead.s - c.s, L) : G.wrap(c.s - lead.s, L);
            gap = d - (c.t.len + lead.t.len) / 2;
          }
          // player as obstacle (traffic brakes a little for you)
          const safe = 5 + c.v * 1.0;
          let target = c.vT;
          const lv = lead && lead.loose ? 0 : lead ? lead.v : 0;
          if (gap < safe) target = Math.min(target, lv * G.clamp(gap / safe, 0, 1));
          if (gap < 1.5) c.v = Math.min(c.v, lv * 0.9);
          c.v += G.clamp(target - c.v, -9 * dt, 2.8 * dt);
          c.v = Math.max(0, c.v);
          // lane change when stuck behind slower car
          if (gap < safe * 1.6 && c.v < c.vT - 3 && Math.abs(c.lat - c.latT) < 0.2 && Math.random() < dt * 0.6) {
            const [a, b] = this.laneGroup(c.lane);
            const nl = G.pick([c.lane - 1, c.lane + 1].filter((x) => x >= a && x < b));
            if (nl !== undefined && this.laneOk(c.t, nl) && this.freeAt(c, nl, c.s)) { c.lane = nl; c.latT = this.laneLat(nl); }
          }
        }
      }
      const pPos = player.pos;
      this.near.length = 0;
      for (const c of this.cars) {
        if (!c.loose) {
          const old = c.lat;
          c.lat = G.damp(c.lat, c.latT, 1.6, dt);
          c.latV = (c.lat - old) / dt;
          c.s = G.wrap(c.s + c.v * c.dir * dt, L);
          this.place(c);
        } else { this.updateLoose(c, dt, playerS); this.collideLoose(c); }
        const dx = c.x - pPos.x, dz = c.z - pPos.z;
        if (dx * dx + dz * dz < 40 * 40) this.near.push(c); else c.lastAlong = NaN;
        if (c.cd > 0) c.cd -= dt;
      }
      this.writeInstances();
    }

    updateLoose(c, dt, playerS) {
      c.timer += dt;
      c.lvy -= G.GRAV * dt;
      c.x += c.lvx * dt; c.y += c.lvy * dt; c.z += c.lvz * dt;
      this.track.groundAt(c.x, c.z, this._gq);
      const gh = this._gq.h;
      const onGround = c.y <= gh + 0.01;
      if (onGround) {
        c.y = gh;
        if (c.lvy < -4) { c.lvy *= -0.25; c.rollV *= 0.6; c.pitchV *= 0.6; } else c.lvy = 0;
        const hs = Math.hypot(c.lvx, c.lvz);
        if (hs > 0.01) { const k = Math.max(0, hs - 9 * dt) / hs; c.lvx *= k; c.lvz *= k; }
        c.yawV *= Math.exp(-2.5 * dt);
        // settle roll/pitch to nearest stable (upright or on the roof)
        const tr = Math.abs(c.roll) > Math.PI / 2 ? Math.sign(c.roll) * Math.PI : 0;
        c.roll = G.damp(c.roll, tr, 5, dt); c.rollV *= Math.exp(-6 * dt);
        c.pitch = G.damp(c.pitch, 0, 5, dt); c.pitchV *= Math.exp(-6 * dt);
      }
      c.yaw += c.yawV * dt; c.roll += c.rollV * dt; c.pitch += c.pitchV * dt;
      c.hx = -Math.sin(c.yaw); c.hz = -Math.cos(c.yaw);
      // walls
      this.track.nearest(c.x, c.z, -1, this._n);
      const lim = G.WALL - c.t.wid / 2;
      if (Math.abs(this._n.lat) > lim) {
        const sg = Math.sign(this._n.lat), nx = this._n.rx * sg, nz = this._n.rz * sg;
        const pen = Math.abs(this._n.lat) - lim;
        c.x -= nx * pen; c.z -= nz * pen;
        const vn = c.lvx * nx + c.lvz * nz;
        if (vn > 0) { c.lvx -= nx * vn * 1.4; c.lvz -= nz * vn * 1.4; }
      }
      c.s = this._n.s; c.lat = this._n.lat;
      // a car that was only nudged and came to rest upright, lined up with its own side of the road, drives on
      if (onGround && c.timer > 1.5 && Math.hypot(c.lvx, c.lvz) < 0.6 && Math.abs(c.roll) < 0.15 && Math.abs(c.pitch) < 0.15) {
        const n = this._n, nf = G.LANES_FWD.length, lanes = c.dir > 0 ? G.LANES_FWD.map((_, i) => i) : G.LANES_ONC.map((_, i) => nf + i);
        const ln = lanes.reduce((a, b) => (Math.abs(this.laneLat(b) - n.lat) < Math.abs(this.laneLat(a) - n.lat) ? b : a));
        const p = this.track.sample(n.s, this._s);
        const al = (c.hx * p.tx + c.hz * p.tz) * c.dir;
        // roughly lined up (a nudge mid lane-change): ease the nose straight first, the way a driver would
        if (Math.abs(this.laneLat(ln) - n.lat) < 1.6 && al > 0.8 && al < 0.995) {
          const want = Math.atan2(-p.tx * c.dir, -p.tz * c.dir);
          let dy = want - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          c.yaw += G.clamp(dy, -0.5 * dt, 0.5 * dt); c.hx = -Math.sin(c.yaw); c.hz = -Math.cos(c.yaw);
        } else if (Math.abs(this.laneLat(ln) - n.lat) < 1.6 && al >= 0.995) {
          c.loose = false; c.lane = ln; c.lat = n.lat; c.latT = this.laneLat(ln); c.latV = 0; c.v = 0;
          c.roll = c.pitch = c.rollV = c.pitchV = c.yawV = 0; c.lastAlong = NaN;
          return;
        }
      }
      const dx = c.x - this.game.player.pos.x, dz = c.z - this.game.player.pos.z;
      if (c.timer > 9 && dx * dx + dz * dz > 150 * 150) this.respawnFar(c, playerS);
    }

    // a knocked-loose car hitting other traffic: same OBB + mass impulse rules as a roadster hitting traffic
    collideLoose(c) {
      if (Math.hypot(c.lvx, c.lvz) < 2) return;
      for (const o of this.cars) {
        if (o === c) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        if (dx * dx + dz * dz > 100 || Math.abs(o.y - c.y) > 2.2) continue;
        const axes = [[c.hx, c.hz], [-c.hz, c.hx], [o.hx, o.hz], [-o.hz, o.hx]];
        let minO = 1e9, nx = 0, nz = 0, sep = false;
        for (const [ax, az] of axes) {
          const rc = Math.abs(c.hx * ax + c.hz * az) * c.t.len / 2 + Math.abs(-c.hz * ax + c.hx * az) * c.t.wid / 2;
          const ro = Math.abs(o.hx * ax + o.hz * az) * o.t.len / 2 + Math.abs(-o.hz * ax + o.hx * az) * o.t.wid / 2;
          const d = dx * ax + dz * az, ov = rc + ro - Math.abs(d);
          if (ov <= 0) { sep = true; break; }
          if (ov < minO) { minO = ov; const sg = d > 0 ? 1 : -1; nx = ax * sg; nz = az * sg; } // c -> o
        }
        if (sep) continue;
        if (!o.loose) this.knock(o, 0, 0, 0, 0);
        const mc = c.t.mass, mo = o.t.mass * (o.loose ? 0.7 : 1);
        c.x -= nx * minO * mo / (mc + mo); c.z -= nz * minO * mo / (mc + mo);
        if (o.loose) { o.x += nx * minO * mc / (mc + mo); o.z += nz * minO * mc / (mc + mo); }
        const ovx = o.loose ? o.lvx : o.hx * o.v, ovz = o.loose ? o.lvz : o.hz * o.v;
        const vrel = (ovx - c.lvx) * nx + (ovz - c.lvz) * nz;
        if (vrel >= 0) continue;
        const j = -1.25 * vrel / (1 / mc + 1 / mo);
        c.lvx -= nx * j / mc; c.lvz -= nz * j / mc;
        const dv = j / mo;
        this.knock(o, nx * dv, dv > 1.2 ? Math.min(6, dv * 0.2) : 0, nz * dv, (Math.random() - 0.5) * dv * 0.2);
      }
    }

    knock(c, dvx, dvy, dvz, spin) {
      if (!c.loose) {
        c.loose = true; c.timer = 0;
        c.lvx = c.hx * c.v; c.lvz = c.hz * c.v; c.lvy = 0;
        c.yawV = 0; c.rollV = 0; c.pitchV = 0;
      }
      c.lvx += dvx; c.lvy += dvy; c.lvz += dvz;
      c.yawV += spin;
      const m = Math.hypot(dvx, dvz);
      c.rollV += (Math.random() - 0.5) * m * 0.25;
      c.pitchV += (Math.random() - 0.5) * m * 0.12;
      c.timer = 0;
    }

    writeInstances() {
      const m4 = this._m4 || (this._m4 = new T.Matrix4());
      const e = new T.Euler(0, 0, 0, 'YXZ'), q = new T.Quaternion(), p = new T.Vector3(), s1 = new T.Vector3(1, 1, 1), sb = new T.Vector3();
      for (const c of this.cars) {
        e.set(c.pitch, c.yaw, c.roll);
        q.setFromEuler(e);
        p.set(c.x, c.y, c.z);
        m4.compose(p, q, s1);
        const mesh = this.meshes[c.ti];
        mesh.bm.setMatrixAt(c.idx, m4); mesh.lm.setMatrixAt(c.idx, m4);
        const air = Math.max(0, c.y);
        p.set(c.x, 0.04, c.z);
        sb.set(c.t.wid * 1.5, 1, c.t.len * 1.25).multiplyScalar(Math.max(0.3, 1 - air * 0.1));
        q.setFromAxisAngle(_up, c.yaw);
        m4.compose(p, q, sb);
        this.blobs.setMatrixAt(c.id, m4);
      }
      for (const m of this.meshes) if (m) { m.bm.instanceMatrix.needsUpdate = true; m.lm.instanceMatrix.needsUpdate = true; }
      this.blobs.instanceMatrix.needsUpdate = true;
    }

    // roofs as ground for the player's wheels
    roofAt(x, z, yRef, out, list = this.near) {
      for (const c of list) {
        if (Math.abs(c.roll) > 0.35 || Math.abs(c.pitch) > 0.35) continue;
        const top = c.y + c.t.hgt;
        if (top <= out.h || top > yRef + 0.05) continue;
        const dx = x - c.x, dz = z - c.z;
        const along = dx * c.hx + dz * c.hz, side = dx * -c.hz + dz * c.hx;
        if (Math.abs(along) < c.t.len / 2 - 0.15 && Math.abs(side) < c.t.wid / 2 - 0.05) {
          out.h = top; out.nx = 0; out.ny = 1; out.nz = 0;
          if (c.loose) { out.vx = c.lvx; out.vy = 0; out.vz = c.lvz; } else { out.vx = c.hx * c.v; out.vy = 0; out.vz = c.hz * c.v; }
          out.roof = c;
        }
      }
      return out;
    }

    // traffic within r of a point (for AI roadsters, which need their own neighbourhood)
    gatherNear(x, z, r, out) {
      out.length = 0;
      for (const c of this.cars) { const dx = c.x - x, dz = c.z - z; if (dx * dx + dz * dz < r * r) out.push(c); }
      return out;
    }

    // roadster OBB (player or AI) vs traffic OBB (2D SAT + height) — called each physics substep
    collidePlayer(pl, list = this.near) {
      const fwd = _a.set(0, 0, -1).applyQuaternion(pl.q); fwd.y = 0;
      if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
      fwd.normalize();
      const pfx = fwd.x, pfz = fwd.z, prx = -pfz, prz = pfx;
      const PL = 4.6, PW = 2.05, MP = 1400;
      for (const c of list) {
        const top = c.y + c.t.hgt;
        if (pl.pos.y + 0.18 > top - 0.25) continue;     // above the roof
        if (pl.pos.y + 1.2 < c.y) continue;              // under a flying car
        const dx = c.x - pl.pos.x, dz = c.z - pl.pos.z;
        const chx = c.hx, chz = c.hz, crx = -chz, crz = chx;
        const CL = c.t.len, CW = c.t.wid;
        let minO = 1e9, nx = 0, nz = 0;
        const axes = [[pfx, pfz], [prx, prz], [chx, chz], [crx, crz]];
        let sep = false;
        for (const [ax, az] of axes) {
          const pr = Math.abs(pfx * ax + pfz * az) * PL / 2 + Math.abs(prx * ax + prz * az) * PW / 2;
          const cr = Math.abs(chx * ax + chz * az) * CL / 2 + Math.abs(crx * ax + crz * az) * CW / 2;
          const d = dx * ax + dz * az;
          const o = pr + cr - Math.abs(d);
          if (o <= 0) { sep = true; break; }
          if (o < minO) { minO = o; const sg = d > 0 ? -1 : 1; nx = ax * sg; nz = az * sg; }
        }
        if (sep) continue;
        // touching a car hands this one over to physics (a lane-changer can't just shove you aside)
        if (!c.loose) this.knock(c, 0, 0, 0, 0);
        const MT = c.t.mass * (c.loose ? 0.7 : 1);
        const wp = MT / (MP + MT), wc = MP / (MP + MT);
        pl.pos.x += nx * minO * wp; pl.pos.z += nz * minO * wp;
        if (c.loose) { c.x -= nx * minO * wc; c.z -= nz * minO * wc; }
        const cvx = c.loose ? c.lvx : c.hx * c.v, cvz = c.loose ? c.lvz : c.hz * c.v;
        const vrel = (pl.vel.x - cvx) * nx + (pl.vel.z - cvz) * nz;
        if (vrel < 0) {
          const j = -(1.25) * vrel / (1 / MP + 1 / MT);
          pl.vel.x += nx * j / MP; pl.vel.z += nz * j / MP;
          const dv = j / MT;
          // tangential scrub
          const tx = -nz, tz = nx;
          const vt = (pl.vel.x - cvx) * tx + (pl.vel.z - cvz) * tz;
          pl.vel.x -= tx * vt * 0.08; pl.vel.z -= tz * vt * 0.08;
          const side = (pl.pos.x - c.x) * c.hx + (pl.pos.z - c.z) * c.hz;
          pl.w.y += (Math.random() - 0.5) * Math.abs(vrel) * 0.05 + Math.sign(vt) * Math.abs(vrel) * 0.015;
          this.knock(c, -nx * dv, dv > 1.2 ? Math.min(9, dv * 0.25 + (dv > 6 ? 2 : 0)) : 0, -nz * dv, (Math.sign(side) || 1) * dv * 0.12);
          pl.onTrafficHit(c, -vrel, pl.pos.x - nx * 1.0, pl.pos.y + 0.6, pl.pos.z - nz * 1.0);
        }
      }
    }

    // near miss / jump-over detection (once per frame)
    detectStunts(pl) {
      for (const c of this.near) {
        const dx = pl.pos.x - c.x, dz = pl.pos.z - c.z;
        const along = dx * c.hx + dz * c.hz, side = dx * -c.hz + dz * c.hx;
        const prev = c.lastAlong;
        c.lastAlong = along;
        if (isNaN(prev) || c.loose || c.cd > 0) continue;
        if (Math.sign(prev) === Math.sign(along)) continue;
        const cvx = c.hx * c.v, cvz = c.hz * c.v;
        const rel = Math.hypot(pl.vel.x - cvx, pl.vel.z - cvz);
        if (rel < 10) continue;
        const top = c.y + c.t.hgt;
        const edge = Math.abs(side) - c.t.wid / 2 - 1.02;
        if (pl.pos.y > top - 0.3 && Math.abs(side) < c.t.wid / 2 + 1.5) {
          c.cd = 1.5; this.game.onJumpOver(c);
        } else if (edge > 0 && edge < 1.4 && pl.pos.y < top) {
          c.cd = 1.5; this.game.onNearMiss(c, edge, c.dir < 0);
        }
      }
    }

    dispose() {
      this.game.scene.remove(this.group);
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
  }
  const _a = new T.Vector3(), _up = new T.Vector3(0, 1, 0);
  G.Traffic = Traffic;
})();
