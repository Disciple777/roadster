// course.js — obstacle courses: set pieces laid along the circuit (barrier chicanes, needle gates, container jumps,
// bollard slaloms, crate walls, 360° loops), solid obstacles you can land on, floating mines over the dodge sections
// (so you can't just fly the whole lap), repair kits, and the bonuses for threading gaps, clearing hurdles and
// landing on rooftops. Hull damage itself lives in game.js (game.damage).
(function () {
  const T = THREE;

  // the catalogue: each course is a sequence of set pieces dropped onto the current circuit. New kinds of course
  // (rooftop runs, canyon gaps…) slot in here as new piece builders + an entry.
  G.COURSES = {
    street: { name: 'STUNT STREETS', seed: 7, pieces: ['chicane', 'needle', 'containers', 'loop', 'slalom', 'crates', 'needle', 'containers', 'chicane', 'loop', 'slalom', 'crates'] },
  };

  // h: height (m) · dmg: hull damage per m/s of impact above 3 · breakable: smashes instead of stopping the car
  const KIND = {
    barrier: { h: 1.1, dmg: 1.0 },
    pillar: { h: 5.5, dmg: 1.1 },
    container: { h: 2.6, dmg: 1.2 },
    bollard: { h: 1.2, dmg: 0.8 },
    crate: { h: 1.5, dmg: 0, breakable: true },
  };
  const BOX_COLORS = [0x2f6fa8, 0xb8452c, 0x3d8a4a, 0xc9a227, 0x6b4aa0, 0x8a8f96];
  const PL = 4.6, PW = 2.05; // roadster footprint, same as traffic collisions

  class Course {
    constructor(game, id) {
      this.game = game;
      this.def = G.COURSES[id] || G.COURSES.street;
      const tr = (this.track = game.track);
      this.L = tr.length;
      this.obs = []; this.kickers = []; this.gates = []; this.hurdles = []; this.kits = [];
      this.loops = []; this.bombs = [];
      this.near = []; this.nearK = []; this.nearB = [];
      this.rand = G.rng(this.def.seed * 9973 + (G.TRACK_ID === 'highway' ? 1 : 0));
      this.layout();
      this.obs.sort((a, b) => a.s - b.s);
      this.buildMeshes();
      this.lastS = null;
    }

    // ---------- layout ----------
    layout() {
      const L = this.L, ramps = this.track.ramps;
      const LEN = { chicane: 36, needle: 50, containers: 46, slalom: 98, crates: 16, loop: 34 };
      let s = 150, i = 0;
      while (s < L - 220) {
        const kind = this.def.pieces[i % this.def.pieces.length];
        const len = LEN[kind];
        // keep clear of the circuit's own jump ramps (they'd launch you straight into a wall)
        const clash = ramps.find((r) => r.s > s - 90 && r.s < s + len + 40);
        if (clash) { s = clash.s + 90; continue; }
        if (s + len > L - 200) break;
        this[kind](s);
        if (kind === 'containers' || this.rand() < 0.55) this.addKit(s + len + 22 + this.rand() * 10, this.laneLat());
        s += len + 60 + this.rand() * 35;
        i++;
      }
    }

    laneLat() { const R = G.ROAD_HALF; return (this.rand() * 2 - 1) * (R - 3); }

    // a box laid square to the road: len along the track, wid across it
    add(kind, s, lat, len, wid, extra) {
      const p = this.track.sample(s, {});
      const k = KIND[kind];
      const o = Object.assign({ kind, k, s: G.wrap(s, this.L), lat, hl: len / 2, hw: wid / 2, h: k.h, x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, alive: true }, extra);
      this.obs.push(o);
      return o;
    }
    // a run of short segments across [a, b] (looks like a real barrier line and stays straight on the curve)
    line(kind, s, a, b, seg, len) {
      const n = Math.max(1, Math.round((b - a) / seg)), w = (b - a) / n;
      for (let j = 0; j < n; j++) this.add(kind, s, a + w * (j + 0.5), len, w * 0.96, { stripe: j & 1 });
    }
    kicker(s, lat, len, wid, h) {
      const p = this.track.sample(s, {});
      this.kickers.push({ s: G.wrap(s, this.L), lat, len, w: wid, h, k: h / len, x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz });
    }
    gate(s, lat, gap, pts, name) { this.gates.push({ s: G.wrap(s, this.L), lat, gap, pts, name }); }
    hurdle(s, top, name) { this.hurdles.push({ s: G.wrap(s, this.L), top, name }); }

    // two staggered barrier walls: weave through the openings or hop them
    chicane(s) {
      const R = G.ROAD_HALF, gap = 7.5, m = this.rand() < 0.5 ? 1 : -1;
      const wall = (ss, side) => {
        if (side > 0) this.line('barrier', ss, -R, R - gap, 2, 0.8); else this.line('barrier', ss, -R + gap, R, 2, 0.8);
        this.hurdle(ss, KIND.barrier.h);
      };
      wall(s, m); wall(s + 32, -m);
      this.bombRow(s + 16);
    }
    // a full-width wall with one narrow slot marked by tall pillars: thread it for big points
    needle(s) {
      const R = G.ROAD_HALF;
      for (let n = 0; n < 2; n++) {
        const ss = s + n * 42, gap = n ? 4.2 : 4.8, c = G.clamp(this.laneLat(), -R + gap / 2 + 1.2, R - gap / 2 - 1.2);
        this.line('barrier', ss, -R, c - gap / 2 - 1, 2, 0.8);
        this.line('barrier', ss, c + gap / 2 + 1, R, 2, 0.8);
        this.add('pillar', ss, c - gap / 2 - 0.5, 1, 1);
        this.add('pillar', ss, c + gap / 2 + 0.5, 1, 1);
        this.gate(ss, c, gap, n ? 700 : 500, n ? 'NEEDLE THREADED' : 'GATE THREADED');
        this.hurdle(ss, KIND.barrier.h);
      }
      this.bombRow(s + 21);
    }
    // a kicker into a block of containers: land on the roof, or take the narrow alley through the middle
    containers(s) {
      const R = G.ROAD_HALF, alley = 3.6, a = G.clamp(this.laneLat(), -R + 4, R - 4);
      const lo = a - alley / 2, hi = a + alley / 2;
      // kickers on both sides of the alley, ending 3 m short of the boxes
      if (lo + R > 2) this.kicker(s + 6, (-R + lo) / 2, 12, lo + R, 2.5);
      if (R - hi > 2) this.kicker(s + 6, (hi + R) / 2, 12, R - hi, 2.5);
      for (const [x0, x1] of [[-R, lo], [hi, R]]) {
        const n = Math.max(1, Math.round((x1 - x0) / 2.6)), w = (x1 - x0) / n;
        for (let j = 0; j < n; j++) for (let r = 0; r < 2; r++) {
          this.add('container', s + 15 + 6 + r * 12, x0 + w * (j + 0.5), 11.8, w * 0.97, { color: BOX_COLORS[(this.rand() * BOX_COLORS.length) | 0], roof: s });
        }
      }
      this.gate(s + 27, a, alley, 600, 'ALLEY RUN');
      this.hurdle(s + 39, KIND.container.h, 'CLEARED THE STACK');
    }
    // rows of bollards with a gap that swaps sides every row
    slalom(s) {
      const R = G.ROAD_HALF, gap = 6;
      for (let r = 0; r < 6; r++) {
        const ss = s + r * 18, c = (r & 1 ? 1 : -1) * R * 0.45;
        for (let x = -R + 1.2; x < R - 0.6; x += 2.4) if (Math.abs(x - c) > gap / 2) this.add('bollard', ss, x, 0.5, 0.5);
        this.gate(ss, c, gap, 150, 'SLALOM');
      }
      this.bombRow(s + 18); this.bombRow(s + 72);
    }
    // a 360° loop: enter on the yellow lane, keep your speed up (about 85 km/h at least), come out a lane over
    loop(s) {
      const R = G.ROAD_HALF, side = this.rand() < 0.5 ? 1 : -1;
      const lat = -side * (R - 4.5), p = this.track.sample(s + 12, {});
      this.loops.push({ s: G.wrap(s + 12, this.L), lat, R: 9, w: 6, shift: side * 7.5, x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz });
    }
    // floating mines across the street: a couple low, most of them up where you'd fly over the ground obstacles
    bombRow(s) {
      const R = G.ROAD_HALF, hs = [6.5, 10, 14, 18, 22, 26];
      for (let j = hs.length - 1; j > 0; j--) { const k = (this.rand() * (j + 1)) | 0; [hs[j], hs[k]] = [hs[k], hs[j]]; }
      for (let k = 0; k < 5; k++) {
        const lat = -R + 2 + (k + 0.2 + this.rand() * 0.6) * (2 * R - 4) / 5;
        const p = this.track.pointAt(s + (this.rand() - 0.5) * 6, lat, {});
        this.bombs.push({ s: G.wrap(s, this.L), x: p.x, z: p.z, y0: hs[k] + this.rand() * 2, y: 0, ph: this.rand() * 6.28, alive: true, t: 0 });
      }
    }
    // a wall of crates: smash through (slows you) or use the kicker in the middle to fly over
    crates(s) {
      const R = G.ROAD_HALF, c = G.clamp(this.laneLat(), -R + 4, R - 4);
      this.kicker(s - 4, c, 8, 4.5, 1.8);
      for (let x = -R + 0.75; x < R; x += 1.5) this.add('crate', s + 6, x, 1.4, 1.4, { spin: this.rand() });
      this.hurdle(s + 6, KIND.crate.h);
    }
    addKit(s, lat) {
      const p = this.track.pointAt(s, lat, {});
      this.kits.push({ s: G.wrap(s, this.L), x: p.x, z: p.z, y: 1.3, active: true, t: 0 });
    }

    // ---------- meshes ----------
    buildMeshes() {
      const sc = this.game.scene, Q = this.game.Q;
      const grp = (this.group = new T.Group());
      sc.add(grp);
      const box = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const mats = {
        barrier: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, emissive: 0x331010, emissiveIntensity: 0.6 }),
        pillar: new T.MeshStandardMaterial({ color: 0xff6a2a, roughness: 0.4, emissive: 0xff4a10, emissiveIntensity: 1.6 }),
        container: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35 }),
        bollard: new T.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.5, emissive: 0xffb000, emissiveIntensity: 0.9 }),
        crate: new T.MeshStandardMaterial({ color: 0xb07a3e, roughness: 0.85 }),
      };
      this.mats = Object.values(mats);
      this.geos = [box];
      this.inst = {};
      const m = new T.Matrix4(), col = new T.Color();
      for (const kind of Object.keys(KIND)) {
        const list = this.obs.filter((o) => o.kind === kind);
        if (!list.length) continue;
        const im = new T.InstancedMesh(box, mats[kind], list.length);
        im.castShadow = im.receiveShadow = !!Q.shadows;
        list.forEach((o, j) => {
          o.inst = im; o.ii = j;
          this.pose(o, m); im.setMatrixAt(j, m);
          if (kind === 'barrier') im.setColorAt(j, col.set(o.stripe ? 0xd8262e : 0xf2f0ea));
          else if (kind === 'container') im.setColorAt(j, col.set(o.color));
          else if (kind === 'crate') im.setColorAt(j, col.set(0xb07a3e).multiplyScalar(0.8 + o.spin * 0.4));
        });
        if (kind === 'crate') im.instanceMatrix.setUsage(T.DynamicDrawUsage);
        grp.add(im);
        this.inst[kind] = im;
      }
      // kickers: a wedge rising toward -Z (the race direction once posed)
      if (this.kickers.length) {
        const wg = new T.BufferGeometry();
        const v = [-0.5, 0, 0.5, 0.5, 0, 0.5, 0.5, 1, -0.5, -0.5, 1, -0.5, -0.5, 0, -0.5, 0.5, 0, -0.5];
        // faces: slope, front, two sides, bottom
        const idx = [0, 1, 2, 0, 2, 3, 4, 3, 2, 4, 2, 5, 0, 3, 4, 1, 5, 2, 0, 4, 5, 0, 5, 1];
        wg.setAttribute('position', new T.Float32BufferAttribute(v, 3));
        wg.setIndex(idx);
        const flat = wg.toNonIndexed(); flat.computeVertexNormals();
        this.geos.push(wg, flat);
        const km = new T.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.6, emissive: 0x6a4a00, emissiveIntensity: 0.8, side: T.DoubleSide });
        this.mats.push(km);
        const im = new T.InstancedMesh(flat, km, this.kickers.length);
        im.receiveShadow = !!Q.shadows;
        this.kickers.forEach((k, j) => { this.poseBox(m, k, k.w, k.h, k.len, 0); im.setMatrixAt(j, m); });
        grp.add(im);
      }
      // loops: a ribbon of road with glowing rails, plus a yellow entry lane
      if (this.loops.length) {
        const rm = new T.MeshStandardMaterial({ color: 0x30343c, roughness: 0.6, metalness: 0.3, emissive: 0x0a1420, side: T.DoubleSide });
        const railM = new T.MeshBasicMaterial({ color: new T.Color(0.4, 2.2, 3.2), toneMapped: false });
        const laneM = new T.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.6, emissive: 0x6a4a00, emissiveIntensity: 0.8 });
        this.mats.push(rm, railM, laneM);
        const N = 120, P = new T.Vector3();
        for (const lp of this.loops) {
          const pos = [], idx = [], edges = [[], []];
          for (let i = 0; i <= N; i++) {
            this.loopPoint(lp, (i / N) * Math.PI * 2, P);
            for (let e = 0; e < 2; e++) {
              const o = (e ? 1 : -1) * lp.w / 2;
              const v = new T.Vector3(P.x + lp.rx * o, P.y + 0.03, P.z + lp.rz * o);
              pos.push(v.x, v.y, v.z);
              edges[e].push(v);
            }
            if (i < N) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
          }
          const rg = new T.BufferGeometry();
          rg.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); rg.setIndex(idx); rg.computeVertexNormals();
          const ribbon = new T.Mesh(rg, rm);
          ribbon.receiveShadow = !!Q.shadows; ribbon.castShadow = !!Q.shadows;
          grp.add(ribbon); this.geos.push(rg);
          for (const e of edges) {
            const tg = new T.TubeGeometry(new T.CatmullRomCurve3(e), N, 0.14, 6, false);
            grp.add(new T.Mesh(tg, railM)); this.geos.push(tg);
          }
          // entry lane: 14 m of yellow leading into the loop, and a stripe where you come out
          const lg = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
          this.geos.push(lg);
          for (const [lat, len, off] of [[lp.lat, 14, -7], [lp.lat + lp.shift, 8, 4]]) {
            const p = this.track.sample(lp.s + off, {});
            const o = { x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz };
            const lane = new T.Mesh(lg, laneM);
            lane.matrixAutoUpdate = false;
            this.poseBox(lane.matrix, o, lp.w * 0.6, 0.04, len, 0);
            grp.add(lane);
          }
        }
      }
      // mines: dark spiked spheres with a blinking red light on top
      if (this.bombs.length) {
        const n = this.bombs.length;
        const bg = new T.SphereGeometry(1, 16, 12), sg = new T.CylinderGeometry(0.07, 0.07, 2.7, 6), lg = new T.SphereGeometry(0.34, 10, 8);
        const bm = new T.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.45, metalness: 0.7, emissive: 0x4a0808 });
        const sm = new T.MeshStandardMaterial({ color: 0x6a6e74, roughness: 0.4, metalness: 0.8 });
        const lm = new T.MeshBasicMaterial({ color: new T.Color(5, 0.3, 0.2), toneMapped: false });
        this.geos.push(bg, sg, lg); this.mats.push(bm, sm, lm);
        this.bombBody = new T.InstancedMesh(bg, bm, n);
        this.bombSpikes = new T.InstancedMesh(sg, sm, n * 3);
        this.bombLight = new T.InstancedMesh(lg, lm, n);
        for (const im of [this.bombBody, this.bombSpikes, this.bombLight]) { im.frustumCulled = false; im.instanceMatrix.setUsage(T.DynamicDrawUsage); grp.add(im); }
        this.bombBody.castShadow = !!Q.shadows;
        this.inst.bombBody = this.bombBody; this.inst.bombSpikes = this.bombSpikes; this.inst.bombLight = this.bombLight;
      }
      // repair kits: white box, red cross, green halo
      const kitMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0x404040, roughness: 0.4 });
      const crossMat = new T.MeshBasicMaterial({ color: new T.Color(4, 0.4, 0.5), toneMapped: false });
      const ringMat = new T.MeshBasicMaterial({ color: new T.Color(0.6, 4, 1.2), toneMapped: false });
      const kb = new T.BoxGeometry(1, 1, 1), c1 = new T.BoxGeometry(1.04, 0.24, 0.7), c2 = new T.BoxGeometry(1.04, 0.7, 0.24), rg = new T.TorusGeometry(1, 0.06, 8, 32);
      this.mats.push(kitMat, crossMat, ringMat); this.geos.push(kb, c1, c2, rg);
      for (const k of this.kits) {
        const g = new T.Group();
        g.add(new T.Mesh(kb, kitMat));
        const a = new T.Mesh(c1, crossMat), b = new T.Mesh(c2, crossMat), a2 = a.clone(), b2 = b.clone();
        a2.rotation.y = b2.rotation.y = Math.PI / 2;
        g.add(a, b, a2, b2);
        const ring = new T.Mesh(rg, ringMat); ring.rotation.x = Math.PI / 2; ring.position.y = -0.4; g.add(ring);
        g.position.set(k.x, k.y, k.z);
        k.g = g; k.ring = ring;
        grp.add(g);
      }
    }
    // box basis: X across the road, Y up, Z against the race direction (so a model's -Z "front" faces forward)
    poseBox(m, o, wid, h, len, y) {
      m.set(o.rx * wid, 0, -o.tx * len, o.x,
        0, h, 0, y,
        o.rz * wid, 0, -o.tz * len, o.z,
        0, 0, 0, 1);
      return m;
    }
    pose(o, m) {
      if (!o.alive && !o.fly) return m.makeScale(0, 0, 0);
      this.poseBox(m, o, o.hw * 2, o.h, o.hl * 2, 0);
      if (o.fly) {
        const f = o.fly;
        _q.setFromEuler(_e.set(f.rx, f.ry, f.rz));
        _p.set(f.x, f.y, f.z);
        _sv.set(o.hw * 2, o.h, o.hl * 2);
        m.compose(_p, _q, _sv);
      }
      return m;
    }

    // ---------- collisions (called from Player.step, every physics substep) ----------
    // which obstacles are close enough to matter for this body
    gather(b, out, r = 16) {
      out.length = 0;
      const s = b.near.s, L = this.L;
      for (const o of this.obs) {
        if (!o.alive) continue;
        let d = o.s - s;
        if (d > L / 2) d -= L; else if (d < -L / 2) d += L;
        if (d > -r && d < r) out.push(o);
      }
      return out;
    }

    collide(b) {
      if (b === this.game.player) { this.enterLoops(b); this.hitBombs(b); }
      const fwd = _a.set(0, 0, -1).applyQuaternion(b.q); fwd.y = 0;
      if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
      fwd.normalize();
      const pfx = fwd.x, pfz = fwd.z, prx = -pfz, prz = pfx;
      const list = this.gather(b, b === this.game.player ? this.near : (b._cnear = b._cnear || []), 14);
      for (const o of list) {
        if (!o.alive) continue;
        if (b.pos.y + 0.18 > o.h - 0.25) continue; // riding over it (or on its roof)
        const dx = o.x - b.pos.x, dz = o.z - b.pos.z;
        const ax4 = [[pfx, pfz], [prx, prz], [o.tx, o.tz], [o.rx, o.rz]];
        let minO = 1e9, nx = 0, nz = 0, sep = false;
        for (const [ax, az] of ax4) {
          const pr = Math.abs(pfx * ax + pfz * az) * PL / 2 + Math.abs(prx * ax + prz * az) * PW / 2;
          const cr = Math.abs(o.tx * ax + o.tz * az) * o.hl + Math.abs(o.rx * ax + o.rz * az) * o.hw;
          const d = dx * ax + dz * az, ov = pr + cr - Math.abs(d);
          if (ov <= 0) { sep = true; break; }
          if (ov < minO) { minO = ov; const sg = d > 0 ? -1 : 1; nx = ax * sg; nz = az * sg; }
        }
        if (sep) continue;
        const vel = b.vel, vrel = vel.x * nx + vel.z * nz;
        if (o.k.breakable) {
          this.smash(o, b);
          const keep = G.clamp(0.9 - b.speed * 0.002, 0.8, 0.9);
          vel.x *= keep; vel.z *= keep;
          this.game.onCrateSmash(b, o, b.speed);
          continue;
        }
        b.pos.x += nx * minO; b.pos.z += nz * minO;
        if (vrel < 0) {
          vel.x -= nx * vrel * 1.3; vel.z -= nz * vrel * 1.3;
          const tx = -nz, tz = nx, vt = vel.x * tx + vel.z * tz;
          vel.x -= tx * vt * 0.1; vel.z -= tz * vt * 0.1;
          b.w.y += Math.sign(vt) * Math.abs(vrel) * 0.02 + (Math.random() - 0.5) * Math.abs(vrel) * 0.03;
          this.game.onObstacleHit(b, o, -vrel, b.pos.x - nx * 1.2, b.pos.y + 0.6, b.pos.z - nz * 1.2);
        }
      }
    }

    // ---------- loops ----------
    // point on the loop at angle th (0 = entry, 2π = exit): up and over, drifting sideways so it clears itself
    loopPoint(lp, th, out) {
      const a = lp.R * Math.sin(th), lat = lp.shift * th / (Math.PI * 2);
      out.set(lp.x + lp.tx * a + lp.rx * lat, lp.R * (1 - Math.cos(th)), lp.z + lp.tz * a + lp.rz * lat);
      return out;
    }
    enterLoops(b) {
      if (b.ride || b.pos.y > 1.2) return;
      for (const lp of this.loops) {
        const dx = b.pos.x - lp.x, dz = b.pos.z - lp.z;
        const along = dx * lp.tx + dz * lp.tz, side = dx * lp.rx + dz * lp.rz;
        if (along < 0 || along > 1.6 || Math.abs(side) > lp.w / 2 - 0.4) continue;
        const v = b.vel.x * lp.tx + b.vel.z * lp.tz;
        if (v < 6) continue;
        b.ride = { lp, th: along / lp.R, v, off: G.clamp(side, -lp.w / 2 + 1, lp.w / 2 - 1) };
        return;
      }
    }
    // while on the loop the car follows the track exactly; gravity bleeds speed on the way up, and if it runs out
    // before the top the car simply falls off
    rideStep(b, dt, inp) {
      const r = b.ride, lp = r.lp, g = G.GRAV;
      if (!b.frozen) r.v += (inp.throttle * 10 - inp.brake * 14) * dt;
      r.v -= g * Math.sin(r.th) * dt;
      r.th += (r.v / lp.R) * dt;
      const done = r.th >= Math.PI * 2;
      if (done) r.th = Math.PI * 2;
      const th = r.th, c = Math.cos(th), s = Math.sin(th);
      this.loopPoint(lp, th, b.pos);
      b.pos.x += lp.rx * r.off; b.pos.z += lp.rz * r.off;
      // car frame: forward along the loop, up toward its centre
      const fw = _a.set(lp.tx * c, s, lp.tz * c), up = _p.set(-lp.tx * s, c, -lp.tz * s);
      const rt = _sv.crossVectors(fw, up);
      _m.makeBasis(rt, up, _b.copy(fw).negate());
      b.q.setFromRotationMatrix(_m);
      b.vel.copy(fw).multiplyScalar(r.v);
      b.w.copy(rt).multiplyScalar(r.v / lp.R);
      b.grounded = true; b.contacts = 4; b.altitude = 0; b.speed = Math.abs(r.v); b.fwdSpeed = r.v; b.sideSlip = 0; b.slipMax = 0;
      b.steerAngle = 0; b.rollAcc = 0; b.pitchAcc = 0;
      for (const wh of b.wheels) { wh.contact = true; wh.slip = 0; wh.spinV = r.v / 0.34; wh.spin += wh.spinV * dt; }
      this.track.nearest(b.pos.x, b.pos.z, b.near.i, b.near);
      const fall = th > 0.3 && th < Math.PI * 1.7 && (r.v < 2 || (r.v * r.v) / lp.R < -g * c);
      if (done || fall) {
        b.ride = null;
        if (done) { b.pos.y = 0.02; b.vel.y = 0; b.w.set(0, 0, 0); this.game.onLoop(); }
        else this.game.hud.popup('TOO SLOW', 'hit the loop faster', 'warn');
      }
    }

    // ---------- mines ----------
    hitBombs(b) {
      const cy = b.pos.y + 0.6;
      for (const m of this.nearB) {
        if (!m.alive) continue;
        const dx = b.pos.x - m.x, dy = cy - m.y, dz = b.pos.z - m.z, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > 2.9 * 2.9) continue;
        m.alive = false; m.t = 25;
        const d = Math.sqrt(d2) || 1;
        b.vel.x += (dx / d) * 10; b.vel.y += (dy / d) * 6 + 5; b.vel.z += (dz / d) * 10;
        b.w.x += (Math.random() - 0.5) * 5; b.w.y += (Math.random() - 0.5) * 3; b.w.z += (Math.random() - 0.5) * 5;
        this.game.onBomb(b, m);
      }
    }

    smash(o, b) {
      o.alive = false;
      const sp = 0.5 + Math.random() * 0.5;
      o.fly = { x: o.x, y: 0.3, z: o.z, vx: b.vel.x * sp + (Math.random() - 0.5) * 6, vy: 4 + Math.random() * 5, vz: b.vel.z * sp + (Math.random() - 0.5) * 6, rx: 0, ry: 0, rz: 0, wr: (Math.random() - 0.5) * 14, t: 0 };
      this.dirty = true;
    }

    // ground: kicker slopes, and the flat tops of obstacles you can land on
    groundAt(x, z, yRef, out) {
      for (const k of this.nearK) {
        const dx = x - k.x, dz = z - k.z;
        const along = dx * k.tx + dz * k.tz, side = dx * k.rx + dz * k.rz;
        if (Math.abs(side) > k.w / 2 || Math.abs(along) > k.len / 2) continue;
        const h = k.h * (along + k.len / 2) / k.len;
        if (h > out.h && h <= yRef + 0.6) {
          const inv = 1 / Math.sqrt(1 + k.k * k.k);
          out.h = h; out.nx = -k.k * k.tx * inv; out.ny = inv; out.nz = -k.k * k.tz * inv;
        }
      }
      for (const o of this.near) {
        if (!o.alive || o.h <= out.h || o.h > yRef + 0.05) continue;
        const dx = x - o.x, dz = z - o.z;
        if (Math.abs(dx * o.tx + dz * o.tz) < o.hl && Math.abs(dx * o.rx + dz * o.rz) < o.hw) {
          out.h = o.h; out.nx = 0; out.ny = 1; out.nz = 0; out.vx = 0; out.vy = 0; out.vz = 0;
        }
      }
      return out;
    }

    // a spot to drop the car after a reset: step forward until nothing solid is near this lane
    freeSpot(s, lat) {
      for (let k = 0; k < 20; k++) {
        const hit = this.loops.some((q) => Math.abs(G.wrap(q.s - s + 20, this.L) - 20) < q.R + 6 && Math.abs(q.lat + q.shift / 2 - lat) < Math.abs(q.shift) / 2 + q.w / 2 + 1.5) || this.obs.some((o) => o.alive && Math.abs(G.wrap(o.s - s + 20, this.L) - 20) < o.hl + 6 && Math.abs(o.lat - lat) < o.hw + 2) ||
          this.kickers.some((q) => Math.abs(G.wrap(q.s - s + 20, this.L) - 20) < q.len / 2 + 4 && Math.abs(q.lat - lat) < q.w / 2 + 1.5);
        if (!hit) return s;
        s += 6;
      }
      return s;
    }

    reset() {
      for (const o of this.obs) if (o.k.breakable) { o.alive = true; o.fly = null; }
      for (const k of this.kits) { k.active = true; k.g.visible = true; }
      for (const m of this.bombs) { m.alive = true; m.t = 0; }
      this.dirty = true; this.lastS = null; this.roofDone = new Set();
    }

    // ---------- per frame ----------
    update(dt, live) {
      const g = this.game, p = g.player, L = this.L;
      // neighbourhoods for the ground query (kickers by distance, obstacles by track position)
      this.gather(p, this.near, 30);
      this.nearK.length = 0;
      for (const k of this.kickers) { const dx = k.x - p.pos.x, dz = k.z - p.pos.z; if (dx * dx + dz * dz < 40 * 40) this.nearK.push(k); }

      // mines: bob and drift a little, blink, come back a while after going off
      this.nearB.length = 0;
      if (this.bombs.length) {
        const bb = this.bombBody, bs = this.bombSpikes, bl = this.bombLight, t = g.t;
        const blink = Math.sin(t * 7) > 0.2 ? 1 : 0.35;
        this.bombs.forEach((m, j) => {
          if (!m.alive) { m.t -= dt; if (m.t <= 0) m.alive = true; }
          m.y = m.y0 + Math.sin(t * 1.3 + m.ph) * 0.6;
          if (m.alive) {
            _p.set(m.x, m.y, m.z); _q.setFromEuler(_e.set(0, t * 0.5 + m.ph, 0.3)); _sv.set(1, 1, 1);
            _m.compose(_p, _q, _sv); bb.setMatrixAt(j, _m);
            for (let k = 0; k < 3; k++) {
              _q.setFromEuler(_e.set(k === 1 ? Math.PI / 2 : 0, t * 0.5 + m.ph, k === 2 ? Math.PI / 2 : 0.3));
              _m.compose(_p, _q, _sv); bs.setMatrixAt(j * 3 + k, _m);
            }
            _p.y += 1.02; _sv.setScalar(blink); _m.compose(_p, _q.identity(), _sv); bl.setMatrixAt(j, _m);
            const dx = m.x - p.pos.x, dz = m.z - p.pos.z;
            if (dx * dx + dz * dz < 30 * 30) this.nearB.push(m);
          } else {
            _m.makeScale(0, 0, 0); bb.setMatrixAt(j, _m); bl.setMatrixAt(j, _m);
            for (let k = 0; k < 3; k++) bs.setMatrixAt(j * 3 + k, _m);
          }
        });
        bb.instanceMatrix.needsUpdate = bs.instanceMatrix.needsUpdate = bl.instanceMatrix.needsUpdate = true;
      }

      // flying crates
      const m = _m;
      for (const o of this.obs) {
        const f = o.fly;
        if (!f) continue;
        f.t += dt; f.vy -= 16 * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.z += f.vz * dt;
        if (f.y < 0) { f.y = 0; f.vy *= -0.3; f.vx *= 0.7; f.vz *= 0.7; }
        f.rx += f.wr * dt; f.rz += f.wr * 0.6 * dt;
        if (f.t > 2.2) o.fly = null;
        this.dirty = true;
      }
      if (this.dirty && this.inst.crate) {
        const im = this.inst.crate;
        for (const o of this.obs) if (o.kind === 'crate') { this.pose(o, m); im.setMatrixAt(o.ii, m); }
        im.instanceMatrix.needsUpdate = true;
        this.dirty = false;
      }

      // repair kits
      for (const k of this.kits) {
        if (!k.active) { k.t -= dt; if (k.t <= 0) { k.active = true; k.g.visible = true; } continue; }
        k.g.rotation.y += dt * 1.6;
        k.g.position.y = k.y + Math.sin(g.t * 3 + k.x) * 0.2;
        k.ring.scale.setScalar(1 + 0.1 * Math.sin(g.t * 6));
        const dx = p.pos.x - k.x, dy = p.pos.y + 0.6 - k.g.position.y, dz = p.pos.z - k.z;
        if (live && dx * dx + dy * dy + dz * dz < 10) { k.active = false; k.g.visible = false; k.t = 40; g.repair(30); }
      }

      // bonuses: crossing a gate line inside its slot, clearing a hurdle in the air, landing on a container roof
      const s = p.near.s;
      if (this.lastS != null && live) {
        let ds = s - this.lastS;
        if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
        if (ds > 0 && ds < 30) {
          const crossed = (q) => { const d = G.wrap(q.s - this.lastS, L); return d > 0 && d <= ds; };
          for (const q of this.gates) if (crossed(q)) {
            const off = Math.abs(p.near.lat - q.lat), room = q.gap / 2 - PW / 2;
            if (off < room + 0.2 && p.altitude < 2) g.onGate(q, G.clamp(1 - off / Math.max(room, 0.1), 0, 1));
          }
          for (const q of this.hurdles) if (crossed(q) && !p.grounded && p.pos.y > q.top + 0.1) g.onHurdle(q);
        }
      }
      this.lastS = s;
      if (live && p.grounded && p.pos.y > KIND.container.h - 0.3) {
        for (const o of this.near) if (o.roof != null && !this.roofDone.has(o.roof)) {
          const dx = p.pos.x - o.x, dz = p.pos.z - o.z;
          if (Math.abs(dx * o.tx + dz * o.tz) < o.hl + 0.5 && Math.abs(dx * o.rx + dz * o.rz) < o.hw + 0.5) { this.roofDone.add(o.roof); g.onRooftop(); break; }
        }
      }
    }

    dispose() {
      this.game.scene.remove(this.group);
      for (const x of this.geos) x.dispose();
      for (const x of this.mats) x.dispose();
      for (const im of Object.values(this.inst)) im.dispose();
    }
  }
  const _a = new T.Vector3(), _b = new T.Vector3(), _p = new T.Vector3(), _sv = new T.Vector3(), _q = new T.Quaternion(), _e = new T.Euler(), _m = new T.Matrix4();
  G.Course = Course;
})();
