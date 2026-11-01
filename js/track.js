// track.js — closed circuits (city streets, one-way expressway, the elevated skyway): spline samples, road meshes,
// ramps, ground queries. A circuit may climb (ctrl points take an optional height) and even cross over itself: the
// ground under a car is then the highest deck that's not above it, and decks and footbridges are solid from below.
(function () {
  const T = THREE;

  G.LANE_W = 3.6;
  // circuits: lane centres (lat, + = right of the racing line), road/sidewalk/wall half-widths, spline
  G.TRACKS = {
    city: {
      name: 'DOWNTOWN', fwd: [1.8, 5.4, 9.0], onc: [-1.8, -5.4, -9.0], road: 12, walk: 16, wall: 15.6, grid: [3.0, 6.8],
      ctrl: [
        [-300, -315], [0, -330], [300, -320], [520, -290], [700, -150], [720, 150], [560, 300],
        [300, 250], [100, 380], [-200, 420], [-550, 350], [-700, 100], [-720, -150], [-600, -290],
      ],
    },
    // eight lanes, all running with the race: long sweepers and a hairpin-free flow
    highway: {
      name: 'EXPRESSWAY', fwd: [-12.6, -9.0, -5.4, -1.8, 1.8, 5.4, 9.0, 12.6], onc: [], road: 15.6, walk: 19.6, wall: 19.2, grid: [-1.9, 1.9], traffic: 1.3, fill: 0.6,
      ctrl: [
        [-720, -340], [-240, -420], [240, -380], [680, -450], [1000, -240], [1040, 120], [800, 380],
        [400, 340], [120, 520], [-320, 560], [-760, 450], [-1000, 160], [-960, -160],
      ],
    },
    // four lanes on concrete decks: a flyover that peels off to the right, climbs and loops back over the road it
    // just left, a long viaduct, footbridges low enough to clip if you jump, and signalled cross streets at ground level
    skyway: {
      name: 'SKYWAY', fwd: [-5.4, -1.8, 1.8, 5.4], onc: [], road: 8, walk: 9.8, wall: 9.5, grid: [-1.9, 1.9], traffic: 1.2, fill: 0.85,
      elev: true, trees: false, bridges: true, noCourse: true,
      ctrl: [
        [-640, -430, 0], [-340, -432, 0], [-60, -425, 0], [130, -400, 0], [260, -340, 0], [380, -262, 1.5],
        [500, -256, 5], [585, -322, 8.5], [598, -432, 11], [530, -522, 12], [420, -540, 12.5], [322, -485, 12.5],
        [280, -390, 12.5], [282, -300, 12], [300, -205, 9.5], [358, -118, 6], [470, -70, 2.5], [620, -55, 0],
        [790, -50, 0], [930, 40, 0], [975, 230, 0], [900, 410, 0], [720, 490, 0], [470, 505, 0],
        [230, 505, 5], [-20, 505, 9.5], [-280, 500, 9.5], [-520, 490, 5], [-740, 450, 0], [-900, 320, 0],
        [-960, 90, 0], [-950, -170, 0], [-860, -370, 0],
      ],
    },
  };
  G.setTrack = function (id) {
    const t = G.TRACKS[id] || G.TRACKS.city;
    G.TRACK = t; G.TRACK_ID = G.TRACKS[id] ? id : 'city';
    G.LANES_FWD = t.fwd;               // right-hand traffic: same direction as the race
    G.LANES_ONC = t.onc;               // oncoming
    G.LANES = t.fwd.concat(t.onc);     // traffic lane index -> lat; the first LANES_FWD.length run with the race
    G.ROAD_HALF = t.road;
    G.WALK_OUT = t.walk;               // sidewalk outer edge
    G.WALL = t.wall;                   // invisible wall (building line) for cars
  };
  G.setTrack('city');

  class Track {
    constructor() {
      const pts = G.TRACK.ctrl.map(([x, z]) => new T.Vector3(x, 0, z));
      this.elev = !!G.TRACK.elev;
      const curve = new T.CatmullRomCurve3(pts, true, 'centripetal');
      curve.arcLengthDivisions = 6000;
      this.curve = curve;
      this.length = curve.getLength();
      const N = (this.N = Math.round(this.length / 2));
      this.ds = this.length / N;
      const px = (this.px = new Float32Array(N)), pz = (this.pz = new Float32Array(N));
      const tx = (this.tx = new Float32Array(N)), tz = (this.tz = new Float32Array(N));
      this.curv = new Float32Array(N);
      const p = new T.Vector3(), t = new T.Vector3();
      for (let i = 0; i < N; i++) {
        curve.getPointAt(i / N, p);
        curve.getTangentAt(i / N, t);
        t.y = 0; t.normalize();
        px[i] = p.x; pz[i] = p.z; tx[i] = t.x; tz[i] = t.z;
      }
      // curvature (1/m), smoothed
      const raw = new Float32Array(N);
      for (let i = 0; i < N; i++) {
        const a = (i - 3 + N) % N, b = (i + 3) % N;
        const ha = Math.atan2(tx[a], tz[a]), hb = Math.atan2(tx[b], tz[b]);
        raw[i] = Math.abs(G.angDiff(ha, hb)) / (6 * this.ds);
      }
      for (let i = 0; i < N; i++) {
        let s = 0;
        for (let k = -6; k <= 6; k++) s += raw[(i + k + N) % N];
        this.curv[i] = s / 13;
      }
      // heights: a second spline through the same points with their heights, kept off the ground and eased
      this.py = new Float32Array(N); this.gr = new Float32Array(N);
      if (this.elev) {
        const c3 = new T.CatmullRomCurve3(G.TRACK.ctrl.map(([x, z, y]) => new T.Vector3(x, y || 0, z)), true, 'centripetal');
        c3.arcLengthDivisions = 6000;
        const raw = new Float32Array(N);
        for (let i = 0; i < N; i++) raw[i] = Math.max(0, c3.getPointAt(i / N, p).y);
        for (let i = 0; i < N; i++) { let a = 0; for (let k = -12; k <= 12; k++) a += raw[(i + k + N) % N]; this.py[i] = a < 0.05 ? 0 : a / 25; }
        for (let i = 0; i < N; i++) this.gr[i] = (this.py[(i + 1) % N] - this.py[(i - 1 + N) % N]) / (2 * this.ds);
      }
      this.minX = Math.min(...px); this.maxX = Math.max(...px);
      this.minZ = Math.min(...pz); this.maxZ = Math.max(...pz);
      this.buildGrid();
      // samples with another level of the circuit right above or below them (no pillars, lamps or ramps there)
      this.cross = new Uint8Array(N);
      if (this.elev) {
        const R = G.WALK_OUT + 3;
        for (let i = 0; i < N; i++) {
          const cx = Math.floor(px[i] / this.cell), cz = Math.floor(pz[i] / this.cell);
          for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of this.grid.get(this.key(cx + a, cz + b)) || []) {
            let d = Math.abs(i - j); d = Math.min(d, N - d);
            if (d > 40 && Math.hypot(px[j] - px[i], pz[j] - pz[i]) < R * 2) this.cross[i] = 1;
          }
        }
      }
      this.ramps = [];
      this.bridges = [];
      this._s = { x: 0, z: 0, tx: 0, tz: 1, rx: 1, rz: 0 };
    }

    buildGrid() {
      this.cell = 25;
      this.grid = new Map();
      for (let i = 0; i < this.N; i++) {
        const k = this.key(Math.floor(this.px[i] / this.cell), Math.floor(this.pz[i] / this.cell));
        if (!this.grid.has(k)) this.grid.set(k, []);
        this.grid.get(k).push(i);
      }
    }
    key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }

    // interpolated sample at arc length s
    sample(s, out = this._s) {
      const N = this.N;
      const f = G.wrap(s, this.length) / this.ds;
      const i = Math.floor(f) % N, j = (i + 1) % N, a = f - Math.floor(f);
      out.x = this.px[i] + (this.px[j] - this.px[i]) * a;
      out.z = this.pz[i] + (this.pz[j] - this.pz[i]) * a;
      let x = this.tx[i] + (this.tx[j] - this.tx[i]) * a, z = this.tz[i] + (this.tz[j] - this.tz[i]) * a;
      const l = Math.hypot(x, z) || 1;
      out.tx = x / l; out.tz = z / l;
      out.rx = -out.tz; out.rz = out.tx;   // right = tangent x up
      return out;
    }

    curvatureAt(s) { return this.curv[Math.floor(G.wrap(s, this.length) / this.ds) % this.N]; }
    // road height (deck top) and grade at arc length s
    heightAt(s) {
      if (!this.elev) return 0;
      const f = G.wrap(s, this.length) / this.ds, i = Math.floor(f) % this.N, a = f - Math.floor(f);
      return this.py[i] + (this.py[(i + 1) % this.N] - this.py[i]) * a;
    }
    gradeAt(s) { return this.elev ? this.gr[Math.floor(G.wrap(s, this.length) / this.ds) % this.N] : 0; }
    // nothing passes over or under the road within ±r metres of s (and no footbridge there)
    clearAt(s, r) {
      if (!this.elev) return true;
      for (let d = -r; d <= r; d += this.ds) if (this.cross[Math.floor(G.wrap(s + d, this.length) / this.ds) % this.N]) return false;
      return !this.bridges.some((b) => Math.abs(G.wrap(b.s - s + this.length / 2, this.length) - this.length / 2) < r + 20);
    }
    // street level within ±r metres of s, clear of the flyovers
    flatAt(s, r) {
      if (!this.clearAt(s, r)) return false;
      for (let d = -r; d <= r; d += this.ds) if (this.py[Math.floor(G.wrap(s + d, this.length) / this.ds) % this.N] > 0.3) return false;
      return true;
    }

    // nearest point; hint = previous sample index (or -1 for global). With a height y (elevated circuits) a deck at
    // another level counts as far away, so a car keeps to the level it's driving on
    nearest(x, z, hint, out, y) {
      out = out || {};
      const N = this.N, yw = this.elev && y != null ? 16 : 0;
      let best = -1, bd = 1e18;
      if (hint >= 0) {
        for (let k = -40; k <= 40; k++) {
          const i = (hint + k + N) % N;
          const dx = x - this.px[i], dz = z - this.pz[i], dy = yw ? this.py[i] - y : 0, d = dx * dx + dz * dz + yw * dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
      }
      if (best < 0 || bd > 900) {
        const r = this.gridNearest(x, z, 3, yw ? y : null);
        if (r >= 0) { best = r; }
        else { // brute force fallback
          for (let i = 0; i < N; i += 2) {
            const dx = x - this.px[i], dz = z - this.pz[i], d = dx * dx + dz * dz;
            if (d < bd) { bd = d; best = i; }
          }
        }
      }
      const i = best;
      const dx = x - this.px[i], dz = z - this.pz[i];
      const along = dx * this.tx[i] + dz * this.tz[i];
      out.i = i;
      out.s = G.wrap(i * this.ds + along, this.length);
      out.lat = dx * -this.tz[i] + dz * this.tx[i];
      out.tx = this.tx[i]; out.tz = this.tz[i];
      out.rx = -this.tz[i]; out.rz = this.tx[i];
      return out;
    }

    gridNearest(x, z, rad, y) {
      const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell), yw = y != null ? 16 : 0;
      let best = -1, bd = 1e18;
      for (let a = -rad; a <= rad; a++) for (let b = -rad; b <= rad; b++) {
        const arr = this.grid.get(this.key(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const dx = x - this.px[i], dz = z - this.pz[i], dy = yw ? this.py[i] - y : 0, d = dx * dx + dz * dz + yw * dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
      }
      this._gd = Math.sqrt(bd);
      return best;
    }

    distToRoad(x, z, maxR = 60) {
      const r = this.gridNearest(x, z, Math.ceil(maxR / this.cell));
      return r < 0 ? 1e9 : this._gd;
    }

    pointAt(s, lat, out) {
      const p = this.sample(s);
      out.x = p.x + p.rx * lat; out.z = p.z + p.rz * lat;
      return out;
    }

    // ----- ground: flat 0 (or the decks) + ramps -----
    addRamp(s, lat, len = 15, w = 7, h = 2.7) {
      const p = this.sample(s, {});
      const x = p.x + p.rx * lat, z = p.z + p.rz * lat;
      this.ramps.push({ s, lat, len, w, h, x, z, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, k: h / len, y0: this.heightAt(s), g: this.gradeAt(s) });
    }
    // a footbridge right across the circuit: clear underneath at road speed, a wall if you jump into it
    addBridge(s) {
      const p = this.sample(s, {}), y0 = this.heightAt(s) + 6.2;
      this.bridges.push({ s: G.wrap(s, this.length), x: p.x, z: p.z, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, hl: 2.2, hw: G.WALK_OUT + 4, y0, y1: y0 + 1.3 });
    }

    // yRef: the height of the point asking (a wheel, a body corner). Decks more than a step above it don't count:
    // they're ceilings, and out.ceil is the underside of the lowest of those (Infinity if none)
    groundAt(x, z, out, yRef = 1e9) {
      out.h = 0; out.nx = 0; out.ny = 1; out.nz = 0; out.vx = 0; out.vy = 0; out.vz = 0; out.roof = null; out.ceil = Infinity;
      if (this.elev) this.deckAt(x, z, yRef, out);
      for (let i = 0; i < this.ramps.length; i++) {
        const r = this.ramps[i];
        const dx = x - r.x, dz = z - r.z;
        if (dx * dx + dz * dz > 200 || r.y0 > yRef + 1) continue;
        const along = dx * r.tx + dz * r.tz, side = dx * r.rx + dz * r.rz;
        if (Math.abs(side) > r.w / 2 || Math.abs(along) > r.len / 2) continue;
        const h = r.y0 + r.g * along + r.h * (along + r.len / 2) / r.len, k = r.k + r.g; // tilted with the road's grade
        if (h > out.h) {
          const inv = 1 / Math.sqrt(1 + k * k);
          out.h = h; out.nx = -k * r.tx * inv; out.ny = inv; out.nz = -k * r.tz * inv;
        }
      }
      return out;
    }
    deckAt(x, z, yRef, out) {
      const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell), lim = G.WALK_OUT + 0.6, half = this.ds * 0.62;
      let best = -1;
      for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
        const arr = this.grid.get(this.key(cx + a, cz + b));
        if (!arr) continue;
        for (const i of arr) {
          const dx = x - this.px[i], dz = z - this.pz[i];
          const along = dx * this.tx[i] + dz * this.tz[i];
          if (along > half || along < -half || Math.abs(dz * this.tx[i] - dx * this.tz[i]) > lim) continue;
          const h = this.py[i] + this.gr[i] * along;
          if (h > yRef + 0.6) { if (h - DECK < out.ceil) out.ceil = h - DECK; continue; } // mid-slab or below: a ceiling
          if (h > out.h) { out.h = h; best = i; }
        }
      }
      // footbridges: their top is ground for anything landing on them, their underside a ceiling
      for (const q of this.bridges) {
        const dx = x - q.x, dz = z - q.z;
        if (Math.abs(dx * q.tx + dz * q.tz) > q.hl || Math.abs(dx * q.rx + dz * q.rz) > q.hw) continue;
        if (q.y1 > yRef + 0.6) { if (q.y0 < out.ceil) out.ceil = q.y0; } else if (q.y1 > out.h) { out.h = q.y1; best = -1; }
      }
      if (best >= 0) {
        const g = this.gr[best], inv = 1 / Math.sqrt(1 + g * g);
        out.nx = -g * this.tx[best] * inv; out.ny = inv; out.nz = -g * this.tz[best] * inv;
      }
    }

    // ----- meshes -----
    ribbon(latA, yA, latB, yB, vLen, uA = 0, uB = 1) {
      const N = this.N, rows = N + 1;
      const pos = new Float32Array(rows * 2 * 3), uv = new Float32Array(rows * 2 * 2);
      for (let r = 0; r < rows; r++) {
        const i = r % N;
        const rx = -this.tz[i], rz = this.tx[i];
        const v = (r * this.ds) / vLen;
        const y = this.py[i];
        pos.set([this.px[i] + rx * latA, yA + y, this.pz[i] + rz * latA, this.px[i] + rx * latB, yB + y, this.pz[i] + rz * latB], r * 6);
        uv.set([uA, v, uB, v], r * 4);
      }
      const idx = [];
      for (let r = 0; r < N; r++) {
        const a = r * 2, b = a + 1, c = a + 2, d = a + 3;
        idx.push(a, b, c, b, d, c);
      }
      const g = new T.BufferGeometry();
      g.setAttribute('position', new T.BufferAttribute(pos, 3));
      g.setAttribute('uv', new T.BufferAttribute(uv, 2));
      g.setIndex(idx);
      g.computeVertexNormals();
      return g;
    }

    buildMeshes(scene, Q) {
      const group = new T.Group();
      const roadTile = this.length / Math.round(this.length / 12);
      // asphalt + markings
      const roadTex = G.canvasTexture(1024, 512, (ctx, W, H) => {
        ctx.fillStyle = '#2b2c30'; ctx.fillRect(0, 0, W, H);
        const r = G.rng(3);
        for (let i = 0; i < 26000; i++) {
          const g = 30 + r() * 40 | 0;
          ctx.fillStyle = `rgba(${g},${g},${g + 3},${0.35 + r() * 0.4})`;
          ctx.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2);
        }
        const RH = G.ROAD_HALF, X = (lat) => (lat + RH) / (2 * RH) * W;
        const lw = G.LANE_W / 2, all = G.LANES;
        const lo = Math.min(...all) - lw, hi = Math.max(...all) + lw;   // painted edge lines
        // tyre wear in lanes
        for (const l of all) {
          for (const o of [-0.8, 0.8]) {
            ctx.fillStyle = 'rgba(15,15,18,0.28)';
            ctx.fillRect(X(l + o) - 14, 0, 28, H);
          }
        }
        ctx.fillStyle = 'rgba(70,70,75,0.35)';
        ctx.fillRect(0, 0, X(lo + 0.1), H); ctx.fillRect(X(hi - 0.1), 0, W, H);
        ctx.fillStyle = '#e8e8e2';
        ctx.fillRect(X(lo), 0, X(lo + 0.2) - X(lo), H);
        ctx.fillRect(X(hi - 0.2), 0, X(hi) - X(hi - 0.2), H);
        // dashes between lanes that run the same way, double yellow where the directions meet
        const dash = (a) => { for (let k = 1; k < a.length; k++) { const l = (a[k] + a[k - 1]) / 2; ctx.fillRect(X(l) - 3, 0, 6, H / 3); } };
        dash([...G.LANES_FWD].sort((a, b) => a - b)); dash([...G.LANES_ONC].sort((a, b) => a - b));
        if (G.LANES_ONC.length) {
          ctx.fillStyle = '#e8b62a';
          ctx.fillRect(X(-0.28), 0, X(-0.14) - X(-0.28), H);
          ctx.fillRect(X(0.14), 0, X(0.28) - X(0.14), H);
        }
      }, { repeat: true });
      roadTex.wrapS = T.ClampToEdgeWrapping;
      const roadMat = new T.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.0 });
      if (Q.level >= 3) {
        // fine aggregate + patched cracks so the asphalt catches light instead of reading as a flat print
        roadMat.bumpMap = G.canvasTexture(512, 512, (ctx, W, H) => {
          ctx.fillStyle = '#808080'; ctx.fillRect(0, 0, W, H);
          const r = G.rng(7);
          for (let i = 0; i < 30000; i++) {
            const g = 90 + r() * 110 | 0;
            ctx.fillStyle = `rgba(${g},${g},${g},${0.25 + r() * 0.5})`;
            ctx.fillRect(r() * W, r() * H, 1 + r() * 2.2, 1 + r() * 2.2);
          }
          ctx.strokeStyle = 'rgba(40,40,40,0.7)'; ctx.lineWidth = 1.5;
          for (let i = 0; i < 9; i++) {
            let x = r() * W, y = r() * H; ctx.beginPath(); ctx.moveTo(x, y);
            for (let k = 0; k < 8; k++) { x += (r() - 0.5) * 40; y += r() * 30; ctx.lineTo(x, y); }
            ctx.stroke();
          }
        }, { srgb: false, repeat: true });
        roadMat.bumpMap.repeat.set(3, 1);
        roadMat.bumpScale = 1.2;
      }
      if (Q.wetRoad) {
        roadMat.roughnessMap = G.canvasTexture(256, 512, (ctx, W, H) => {
          ctx.fillStyle = '#d0d0d0'; ctx.fillRect(0, 0, W, H);
          const r = G.rng(11);
          for (let i = 0; i < 40; i++) {
            const x = r() * W, y = r() * H, rad = 8 + r() * 40;
            const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
            g.addColorStop(0, 'rgba(25,25,25,0.95)'); g.addColorStop(1, 'rgba(25,25,25,0)');
            ctx.fillStyle = g; ctx.save(); ctx.translate(x, y); ctx.scale(1, 2.5); ctx.translate(-x, -y);
            ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2); ctx.restore();
          }
        }, { srgb: false, repeat: true });
        roadMat.roughness = 1.0;
        roadMat.envMapIntensity = 1.4;
      }
      const road = new T.Mesh(this.ribbon(-G.ROAD_HALF, 0.0, G.ROAD_HALF, 0.0, roadTile), roadMat);
      road.receiveShadow = true;
      group.add(road);

      // sidewalks
      const walkTex = G.canvasTexture(256, 256, (ctx, W, H) => {
        ctx.fillStyle = '#55565a'; ctx.fillRect(0, 0, W, H);
        const r = G.rng(5);
        for (let i = 0; i < 5000; i++) { const g = 70 + r() * 40 | 0; ctx.fillStyle = `rgba(${g},${g},${g},0.4)`; ctx.fillRect(r() * W, r() * H, 2, 2); }
        ctx.strokeStyle = 'rgba(25,25,28,0.8)'; ctx.lineWidth = 3;
        for (let k = 0; k <= 4; k++) { ctx.beginPath(); ctx.moveTo(0, k * H / 4); ctx.lineTo(W, k * H / 4); ctx.stroke(); }
        ctx.beginPath(); ctx.moveTo(W / 2, 0); ctx.lineTo(W / 2, H); ctx.stroke();
      }, { repeat: true });
      const walkMat = new T.MeshStandardMaterial({ map: walkTex, roughness: 0.9 });
      const curbMat = new T.MeshStandardMaterial({ color: 0x8a8a8e, roughness: 0.8, side: T.DoubleSide });
      for (const sg of [1, -1]) {
        const RH = G.ROAD_HALF, WO = G.WALK_OUT;
        const top = this.ribbon(sg > 0 ? RH : -WO, 0.16, sg > 0 ? WO : -RH, 0.16, 8);
        const m = new T.Mesh(top, walkMat); m.receiveShadow = true; group.add(m);
        group.add(new T.Mesh(this.ribbon(sg * RH, 0.0, sg * RH, 0.16, 8), curbMat));
        // red LED edge strip (the reference ramp's red edge lights)
        const led = new T.Mesh(this.ribbon(sg * (RH - 0.02), 0.03, sg * (RH - 0.02), 0.11, 8),
          new T.MeshBasicMaterial({ color: new T.Color(4, 0.12, 0.15), side: T.DoubleSide, toneMapped: false }));
        group.add(led);
      }

      // ramps
      const chevTex = G.canvasTexture(256, 512, (ctx, W, H) => {
        ctx.fillStyle = '#18191c'; ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#ffc21a';
        for (let k = 0; k < 6; k++) {
          const y = H - k * 90 - 40;
          ctx.beginPath(); ctx.moveTo(30, y); ctx.lineTo(W / 2, y - 60); ctx.lineTo(W - 30, y);
          ctx.lineTo(W - 30, y + 26); ctx.lineTo(W / 2, y - 34); ctx.lineTo(30, y + 26); ctx.closePath(); ctx.fill();
        }
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 10, H); ctx.fillRect(W - 10, 0, 10, H);
      });
      const rampTop = new T.MeshStandardMaterial({ map: chevTex, roughness: 0.6, metalness: 0.3 });
      const rampSide = new T.MeshStandardMaterial({ color: 0x222326, roughness: 0.7, metalness: 0.4 });
      const lipMat = new T.MeshBasicMaterial({ color: new T.Color(6, 0.45, 0.12), toneMapped: false });
      for (const r of this.ramps) {
        const g = rampGeometry(r.len, r.w, r.h);
        const m = new T.Mesh(g, [rampTop, rampSide]);
        m.position.set(r.x, r.y0, r.z);
        m.rotation.set(Math.atan(r.g), Math.atan2(-r.tx, -r.tz), 0, 'YXZ');
        m.castShadow = true; m.receiveShadow = true;
        const lip = new T.Mesh(new T.BoxGeometry(r.w, 0.12, 0.12), lipMat);
        lip.position.set(0, r.h, -r.len / 2);
        m.add(lip);
        for (const sx of [-1, 1]) {
          const side = new T.Mesh(new T.BoxGeometry(0.1, 0.1, r.len), lipMat);
          side.position.set(sx * r.w / 2, r.h / 2 + 0.05, 0);
          side.rotation.x = Math.atan2(r.h, r.len);
          m.add(side);
        }
        group.add(m);
      }
      if (this.elev) this.buildDecks(group, Q);
      scene.add(group);
      this.group = group;
    }

    // concrete: parapets, deck slabs and their edges, pillars under the high parts, and the footbridges
    buildDecks(group, Q) {
      const WO = G.WALK_OUT, N = this.N;
      const conc = new T.MeshStandardMaterial({ color: 0x74767c, roughness: 0.88, side: T.DoubleSide });
      const under = new T.MeshStandardMaterial({ color: 0x3a3b40, roughness: 0.95, side: T.DoubleSide });
      const glow = new T.MeshBasicMaterial({ color: new T.Color(0.25, 1.6, 3.2), side: T.DoubleSide, toneMapped: false });
      for (const sg of [1, -1]) {
        const a = sg * (WO - 0.45), b = sg * WO;
        group.add(new T.Mesh(this.ribbon(a, 0.16, a, 1.1, 8), conc));      // parapet, road side
        group.add(new T.Mesh(this.ribbon(a, 1.1, b, 1.1, 8), conc));        // its top
        group.add(new T.Mesh(this.ribbon(b, 1.1, b, -DECK, 8), conc));      // outer face down the slab edge
        group.add(new T.Mesh(this.ribbon(b + sg * 0.02, -0.5, b + sg * 0.02, -0.32, 8), glow)); // light line along the edge
      }
      const slab = new T.Mesh(this.ribbon(-WO, -DECK, WO, -DECK, 8), under);
      group.add(slab);
      // pillars with a cross-head, wherever the deck is high enough and nothing else runs underneath
      const spots = [];
      for (let i = 0; i < N; i += 14) if (this.py[i] > 2.6 && !this.cross[i]) spots.push(i);
      const col = new T.InstancedMesh(new T.CylinderGeometry(1.25, 1.45, 1, 14), conc, spots.length);
      const head = new T.InstancedMesh(new T.BoxGeometry(2 * WO - 3, 1, 2.4), conc, spots.length);
      const m4 = new T.Matrix4(), q = new T.Quaternion(), up = new T.Vector3(0, 1, 0), v = new T.Vector3(), sc = new T.Vector3();
      spots.forEach((i, k) => {
        const h = this.py[i] - DECK;
        q.setFromAxisAngle(up, Math.atan2(-this.tx[i], -this.tz[i]));
        m4.compose(v.set(this.px[i], h / 2, this.pz[i]), q, sc.set(1, h, 1)); col.setMatrixAt(k, m4);
        m4.compose(v.set(this.px[i], h - 0.5, this.pz[i]), q, sc.set(1, 1, 1)); head.setMatrixAt(k, m4);
      });
      for (const m of [col, head]) { m.castShadow = Q.shadows; m.receiveShadow = true; group.add(m); }

      // footbridges: a slab with railings on two legs, amber lights along the edges you'd hit
      const steel = new T.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.5, metalness: 0.6 });
      const amber = new T.MeshBasicMaterial({ color: new T.Color(4, 1.6, 0.15), toneMapped: false });
      const glass = new T.MeshStandardMaterial({ color: 0x89b8d8, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.35 });
      for (const q2 of this.bridges) {
        const g = new T.Group(), W = 2 * q2.hw, D = 2 * q2.hl, H = q2.y1 - q2.y0;
        g.position.set(q2.x, 0, q2.z);
        g.rotation.y = Math.atan2(-q2.tx, -q2.tz);
        const deck = new T.Mesh(new T.BoxGeometry(W, H, D), conc); deck.position.y = q2.y0 + H / 2; deck.castShadow = true; g.add(deck);
        for (const sz of [-1, 1]) {
          const rail = new T.Mesh(new T.BoxGeometry(W, 1.1, 0.06), glass); rail.position.set(0, q2.y1 + 0.55, sz * (q2.hl - 0.05)); g.add(rail);
          const top = new T.Mesh(new T.BoxGeometry(W, 0.08, 0.14), steel); top.position.set(0, q2.y1 + 1.12, sz * (q2.hl - 0.05)); g.add(top);
          const lit = new T.Mesh(new T.BoxGeometry(W - 0.4, 0.14, 0.05), amber); lit.position.set(0, q2.y0 + 0.12, sz * (q2.hl + 0.01)); g.add(lit);
        }
        for (const sx of [-1, 1]) {
          const leg = new T.Mesh(new T.BoxGeometry(1.4, q2.y0, 1.6), conc); leg.position.set(sx * (q2.hw - 1.2), q2.y0 / 2, 0); leg.castShadow = true; g.add(leg);
        }
        group.add(g);
      }
    }
  }

  const DECK = 1.4; // deck slab depth under the road surface

  // wedge: forward is -Z, low edge at +len/2, high edge (lip) at -len/2
  function rampGeometry(len, w, h) {
    const hw = w / 2, hl = len / 2;
    const P = {
      a: [-hw, 0, hl], b: [hw, 0, hl], c: [hw, h, -hl], d: [-hw, h, -hl],
      e: [-hw, 0, -hl], f: [hw, 0, -hl],
    };
    const top = [P.a, P.b, P.c, P.a, P.c, P.d];
    const topUV = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];
    const rest = [
      P.b, P.f, P.c,   // right side
      P.a, P.d, P.e,   // left side
      P.e, P.d, P.c, P.e, P.c, P.f, // back face
    ];
    const pos = [...top, ...rest].flat();
    const uv = [...topUV, ...new Array(rest.length * 2).fill(0)];
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.addGroup(0, 6, 0); g.addGroup(6, rest.length, 1);
    g.computeVertexNormals();
    return g;
  }

  G.Track = Track;
})();
