// rivals.js — AI roadsters. Each one is a full G.Player physics body (same tyres, mass, collisions and walls as you);
// the AI only presses the same "keys": steer, throttle, brake, boost and the under-thrusters.
(function () {
  const T = THREE;
  const NAMES = ['NOVA', 'RAVEN', 'ION', 'COMET', 'BLITZ', 'VEGA', 'ORBIT'];
  const COLORS = [0xc0182a, 0x15171b, 0x1d4fd8, 0xf2b705, 0xe8f6ff, 0x6a1bb0, 0x0f8f6a];
  // lines the AI can hold: every lane running with the race, the first oncoming lane (if any), and a line just
  // past each edge lane that slips past ramps — only where the whole car stays on the asphalt, never the sidewalk
  // (city: [1.8, 5.4, 9.0, -1.8, 0.1]); rebuilt per track
  let CAND = [], CAND_COST = [];
  function buildCand() {
    const F = G.LANES_FWD, lo = Math.min(...F), hi = Math.max(...F);
    CAND = [...F]; CAND_COST = F.map(() => 0);
    if (G.LANES_ONC.length) { CAND.push(G.LANES_ONC[0]); CAND_COST.push(70); }
    for (const l of [lo - 1.7, hi + 1.6]) if (Math.abs(l) < G.ROAD_HALF - 1.4 && !CAND.includes(l)) { CAND.push(l); CAND_COST.push(10); }
  }
  // the furthest a rival's aim point may sit from the centre line: kerb minus half a car and a little margin
  const latMax = () => G.ROAD_HALF - 1.4;
  // rival skill: how close to the car's real limits the AI dares to drive. Same car, same physics, same keys.
  // grip = share of the tyres' real cornering limit it trusts (the limit grows with speed: downforce),
  // aBrk = braking it plans with (m/s²), top = speed cap (m/s), smart = plans the rear thruster (else random
  // bursts, boost per second), n2 = N₂ it keeps in reserve, n2Rate = N₂/s it earns like a player earns from
  // stunts, react = seconds of reaction it leaves before braking, jump = hops over traffic it can't get around,
  // catchUp/ease = rubber band when behind/ahead of you
  const SKILL = {
    easy:   { grip: 0.56, aBrk: 8,  top: 74,  boost: 0.15, smart: false, n2: 70, n2Rate: 0, react: 0.5,  jump: false, catchUp: 1.06, ease: 0.85 },
    normal: { grip: 0.7,  aBrk: 11, top: 86,  boost: 0.45, smart: false, n2: 50, n2Rate: 1, react: 0.3,  jump: false, catchUp: 1.08, ease: 0.94 },
    hard:   { grip: 0.88, aBrk: 14, top: 140, smart: true, n2: 30, n2Rate: 3, react: 0.15, jump: true,  catchUp: 1.06, ease: 1 },
    pro:    { grip: 0.97, aBrk: 16, top: 999, smart: true, n2: 26, n2Rate: 7, react: 0.06, jump: true,  catchUp: 1.08, ease: 1 },
  };
  // the tyres' sideways limit at speed v (m/s²): friction x (weight + downforce), from car.js
  const A0 = 16.2, A1 = 0.0013;
  // fastest a skill can take curvature k: v² k = grip (A0 + A1 v²)
  const cornerV = (k, g) => (k <= A1 * g ? 999 : Math.sqrt((A0 * g) / (k - A1 * g)));
  const UP_ACC = 4.2; // net climb of the under-thrusters (m/s²)

  let RivalBody = null;
  // defined lazily so G.Player is guaranteed to exist
  const bodyClass = () => RivalBody || (RivalBody = class extends G.Player {
    constructor(game, model, r) { super(game, model); this.r = r; this.tnear = []; }
    onScrape() {}
    onWallHit(p, vn) { if (vn > 4) this.game.onRivalHit(this.r, vn); }
    onFlipped() { this.r.owner.reset(this.r); }
    onTrafficHit(c, vrel) { this.game.onRivalHit(this.r, vrel); }
    // the player's side of a player/rival hit is reported by the player body; rival/rival once per pair
    onCarHit(other, vrel) { if (other.r && this.r.i < other.r.i) this.game.onRivalHit(this.r, vrel); }
  });

  class Rivals {
    constructor(game, count) {
      this.game = game;
      this.list = [];
      buildCand();
      const RB = bodyClass();
      for (let i = 0; i < count; i++) {
        const model = G.buildRoadster(COLORS[i % COLORS.length], { shadows: game.Q.shadows && game.Q.level >= 3 });
        game.scene.add(model.group);
        const r = {
          i, owner: this, name: NAMES[i % NAMES.length], color: COLORS[i % COLORS.length], model,
          s: 0, lastS: 0, latT: 0, v: 0, skill: 0.9 + Math.random() * 0.1,
          boostT: 0, jumpT: 0, jumpC: null, laneT: 0, stuckT: 0, finished: false, finishTime: 0,
          inp: { steer: 0, throttle: 0, brake: 0, handbrake: false, jump: false, thrL: false, thrR: false, boost: false, pitch: 0, rollAir: 0 },
        };
        r.b = new RB(game, model, r);
        r.pos = r.b.pos; r.th = r.b.th;
        this.list.push(r);
      }
      this._s = {}; this._m = {};
    }

    grid(startS, slots) {
      const L = this.game.track.length;
      this.list.forEach((r, k) => {
        const sl = slots[k];
        r.b.place(startS + sl.ds, sl.lat, 0);
        r.b.fuel = 100; r.b.fuelLock = false; r.b.frozen = true;
        r.s = startS + sl.ds; r.lastS = G.wrap(r.s, L); r.latT = sl.lat;
        r.finished = false; r.boostT = 0; r.jumpT = 0; r.jumpC = null; r.stuckT = 0;
        r.b.syncModel();
      });
    }

    // back on the road in the nearest race lane, clear of traffic — same as the player's reset
    reset(r) {
      const b = r.b, n = b.near, traffic = this.game.traffic;
      const lat = G.LANES_FWD.reduce((a, c) => (Math.abs(c - n.lat) < Math.abs(a - n.lat) ? c : a));
      let s = n.s;
      if (traffic) for (let k = 0; k < 10; k++) {
        const blocked = traffic.cars.some((c) => Math.abs(c.lat - lat) < 2.5 && traffic.zoneDist(c.s, s) < c.t.len / 2 + 6);
        if (!blocked) break; s += 12;
      }
      b.place(s, lat, Math.min(b.speed * 0.6, 25));
      b.fuel = Math.max(b.fuel, 30);
      r.latT = lat; r.stuckT = 0; r.jumpT = 0; r.jumpC = null; r.boostT = 0;
    }

    // one physics substep for every rival (called next to the player's step)
    step(h) {
      const traffic = this.game.traffic, pl = this.game.player, list = this.list;
      for (const r of list) {
        r.b.step(h, r.inp);
        if (traffic) traffic.collidePlayer(r.b, r.b.tnear);
      }
      for (let a = 0; a < list.length; a++) {
        G.collideCars(pl, list[a].b);
        for (let c = a + 1; c < list.length; c++) G.collideCars(list[a].b, list[c].b);
      }
    }

    // once per frame: progress, AI decisions for the next frame, visuals
    update(dt, racing, player, playerProg) {
      const tr = this.game.track, L = tr.length, traffic = this.game.traffic;
      for (const r of this.list) {
        const b = r.b;
        let ds = b.near.s - r.lastS;
        if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
        r.lastS = b.near.s;
        if (Math.abs(ds) < 40) r.s += ds;
        r.v = Math.max(0, b.fwdSpeed);
        if (traffic) traffic.gatherNear(b.pos.x, b.pos.z, 30, b.tnear); else b.tnear.length = 0;
        b.frozen = !racing && !r.finished;
        if (racing && !r.finished) this.think(r, dt, tr, L, traffic, playerProg);
        else if (r.finished) this.drive(r, tr, 18, r.latT);
        // stuck against something for a while -> reset, like a player would
        if (racing && !r.finished && b.speed < 3) { r.stuckT += dt; if (r.stuckT > 2.5) this.reset(r); } else r.stuckT = 0;
        b.syncModel();
        G.updateRoadsterFX(r.model, b.th, performance.now() / 1000, b.braking);
        this.emit(r, dt);
      }
    }

    think(r, dt, tr, L, traffic, playerProg) {
      const b = r.b, sNow = b.near.s, v = r.v, K = SKILL[this.game.settings.difficulty] || SKILL.normal;
      // rubber band: a rival behind you drives a touch braver and earns N₂ faster
      const gap = r.s - playerProg, behind = gap < -60, ahead = gap > 160;
      const grip = K.grip * r.skill * (gap < -120 ? K.catchUp : ahead ? K.ease : 1);
      // N₂ a player would be earning from near misses and stunts along the way
      if (b.grounded) b.fuel = Math.min(100, b.fuel + (K.n2Rate + (behind ? K.n2Rate : 0)) * dt);
      // speed plan: the fastest speed from which every corner ahead can still be braked down to in time
      const reach = v * K.react, horizon = v * v / (2 * K.aBrk) + reach + 40;
      let target = K.top, kAhead = 0;
      for (let d = 0; d < horizon; d += 5) {
        const k = tr.curvatureAt(sNow + d);
        if (d < v * 2.2 + 20) kAhead = Math.max(kAhead, k);
        const vC = cornerV(k, grip);
        target = Math.min(target, Math.sqrt(vC * vC + 2 * K.aBrk * Math.max(0, d - reach)));
      }

      // traffic scan per lane, in seconds-to-contact turned back into metres: a car going your way at 60 is no
      // obstacle, a parked one or one coming the other way is. Wrecks report their real position.
      const clear = CAND.map(() => 220);
      let curClear = 220, curGap = 220, blocker = null, blockerV = 0;
      const myLat = b.near.lat, vv = Math.max(v, 10);
      const consider = (c, d, lat, latSpan, len, cv, hgt = c.t.hgt) => {
        const gapD = d - len / 2 - 2.6;
        const close = Math.max(1, vv - cv);
        // a slow car far ahead still makes its lane worse than an empty one, so the move starts early
        const eff = Math.min(220, gapD < 0 ? gapD : Math.min(gapD * vv / close, gapD + 60));
        for (let j = 0; j < CAND.length; j++) if (Math.abs(lat - CAND[j]) < latSpan) clear[j] = Math.min(clear[j], eff);
        if (Math.abs(lat - myLat) < latSpan && eff < curClear && b.altitude < hgt + 0.3) { curClear = eff; curGap = gapD; blocker = c.t ? c : null; blockerV = cv; }
      };
      if (traffic) {
        for (const c of traffic.cars) {
          let d = G.wrap(c.s - sNow, L);
          if (d > L - 8) d -= L;
          if (d > (c.dir < 0 ? 300 : 180) || d < -6) continue; // oncoming cars close fast: look further
          consider(c, d, c.lat, c.t.wid / 2 + 1.5, c.t.len, c.loose ? 0 : c.v * c.dir);
        }
        // cross-street cars: where will they be, sideways, when we get there?
        for (const c of traffic.xcars) {
          let d = G.wrap(c.s - sNow, L);
          if (d > L - 8) d -= L;
          if (d > 180 || d < -4) continue;
          const t0 = Math.max(0, d) / vv, w = (c.t.wid / 2 + 3) / vv + 0.3;
          const mv = c.loose ? 0 : c.v * c.dir;
          const u0 = c.u + mv * Math.max(0, t0 - w), u1 = c.u + mv * (t0 + w);
          consider(c, d, (u0 + u1) / 2, Math.abs(u1 - u0) / 2 + c.t.len / 2 + 1.25, c.t.wid, 0);
        }
      }
      // the other racers (you included): don't ram the one ahead, pass it
      for (const o of this.list) if (o !== r) this.considerCar(o.b, sNow, L, consider);
      if (this.game.player) this.considerCar(this.game.player, sNow, L, consider);
      // jump ramps launch you into the next corner blind: line up beside them, like a racer would
      for (const rp of tr.ramps) {
        let d = G.wrap(rp.s - sNow, L);
        if (d > L - 10) d -= L;
        if (d > 160 || d < -rp.len) continue;
        const rch = rp.w / 2 + 1.15, gapD = d - rp.len / 2 - 2.6;
        for (let j = 0; j < CAND.length; j++) if (Math.abs(rp.lat - CAND[j]) < rch) clear[j] = Math.min(clear[j], gapD);
      }
      // choose lane: the clearest, unless it's a long way across; once committed to a move, see it through
      // for a moment instead of dithering between two half-blocked lanes
      let best = 0, bs = -1e9, cur = 0;
      for (let j = 0; j < CAND.length; j++) {
        if (CAND[j] === r.latT) cur = j;
        // getting there crosses the lanes in between: a car close ahead in one of them closes this option too
        let cj = clear[j];
        const lo = Math.min(myLat, CAND[j]) + 0.5, hi = Math.max(myLat, CAND[j]) - 0.5;
        for (let k = 0; k < CAND.length; k++) if (k !== j && CAND[k] > lo && CAND[k] < hi && clear[k] < v * 1.2 + 15) cj = Math.min(cj, clear[k]);
        const sc = Math.min(cj, 170) - Math.abs(CAND[j] - r.latT) * (2 + v * 0.02) - CAND_COST[j] + (CAND[j] === r.latT ? 18 : 0);
        if (sc > bs) { bs = sc; best = j; }
      }
      r.laneT -= dt;
      if (best !== cur && (r.laneT <= 0 || clear[cur] < v * 0.5)) { r.latT = CAND[best]; r.laneT = 0.5; }
      else best = cur;

      let hopping = false;
      // boxed in with nowhere to go: hop over it on the under-thrusters (straight road ahead only)
      if (r.jumpC) {
        const c = r.jumpC;
        let d = G.wrap(c.s - sNow, L);
        if (d > L / 2) d -= L;
        const span = c.xc ? c.t.wid : c.t.len;
        if (d < -span / 2 - 3 || b.fuelLock || b.fuel < 3 || r.jumpT > 3.5) { r.jumpC = null; r.jumpT = 0; }
      } else if (K.jump && blocker && blocker.t.hgt < 2.3 && clear[best] < curClear + 15 && v > 28 && v - blockerV > 10 && b.grounded && b.fuel > 32 && kAhead < 0.006) {
        // keep the speed up toward it, then lift off just in time to clear its roof
        const tRise = Math.sqrt((2 * (blocker.t.hgt + 0.6)) / UP_ACC) + 0.2;
        const tHit = curGap / (v - blockerV);
        if (tHit < tRise + 0.15) { if (tHit > tRise - 0.4) { r.jumpC = blocker; r.jumpT = 0; } }
        else hopping = true;
      }
      // something ahead in our lane we can't jump: cap speed so we could still stop behind it
      if (!r.jumpC && !hopping && curClear < 200) {
        const bv = Math.max(blockerV, 0), room = Math.max(0, curGap - 3 - v * K.react);
        target = Math.min(target, Math.sqrt(bv * bv + 2 * K.aBrk * 0.8 * room));
      }

      // rear thruster
      if (K.smart) {
        // pull hard wherever there's speed to gain, keep a reserve for hops, and let the tank refill between bursts
        const want = target > v + 3 && !b.fuelLock && (curClear > v * 1.2 || r.jumpC);
        if (r.boostT > 0) { if (!want || b.fuel < K.n2) r.boostT = 0; }
        else if (want && b.fuel > K.n2 + 18) r.boostT = 99;
      } else {
        const boostRate = K.boost * (behind ? 2 : 1);
        if (r.boostT <= 0 && b.fuel > K.n2 && kAhead < 0.004 && v > 35 && target > v - 2 && Math.random() < dt * boostRate) r.boostT = 1 + Math.random() * 1.5;
        if (r.boostT > 0) { r.boostT -= dt; if (b.fuelLock || b.fuel < K.n2 * 0.4 || target < v - 3 || curClear < 60) r.boostT = 0; }
      }
      this.drive(r, tr, target, r.latT);
      r.inp.boost = r.boostT > 0;
      if (r.jumpC) {
        r.jumpT += dt;
        // climb until the car is clear of the roof (measured from the road: over a car, altitude reads from
        // its roof), then coast over it; once off the thrusters the flank ones keep the landing on the road
        r.inp.jump = b.pos.y < r.jumpC.y + r.jumpC.t.hgt + 1.3 && !b.fuelLock;
        if (r.inp.jump) r.inp.thrL = r.inp.thrR = false;
      }
    }

    considerCar(ob, sNow, L, consider) {
      if (!ob.near || ob.altitude > 2) return;
      let d = G.wrap(ob.near.s - sNow, L);
      if (d > L - 8) d -= L;
      if (d > 120 || d < -3) return;
      // a racer ahead speeds up too: only a clearly slower one counts as in the way
      consider(ob, d, ob.near.lat, 2.3, 4.4, Math.max(0, ob.fwdSpeed || 0) + 4, 1.2);
    }

    // pure-pursuit steering toward the lane, throttle/brake toward the target speed
    drive(r, tr, target, lat) {
      const b = r.b, inp = r.inp, v = r.v;
      // keep off the sidewalk: an aim point that cuts a corner drags the car inward, so pull the aim back toward
      // the centre by however far the car has already drifted past the edge of the asphalt
      const lm = latMax();
      lat = G.clamp(lat, -lm, lm);
      const over = Math.abs(b.near.lat) - (lm - 0.4);
      if (over > 0 && Math.sign(b.near.lat) === Math.sign(lat)) lat -= Math.sign(lat) * over * 3;
      const Ld = 7 + v * 0.42;
      const p = tr.sample(b.near.s + Ld, this._s);
      // in a corner the straight line to the aim point bulges over the inside kerb: check where it passes halfway
      // and slide the aim outward until that point is back on the asphalt
      const m = tr.sample(b.near.s + Ld / 2, this._m);
      const midLat = ((b.pos.x + p.x + p.rx * lat) / 2 - m.x) * m.rx + ((b.pos.z + p.z + p.rz * lat) / 2 - m.z) * m.rz;
      const bulge = Math.abs(midLat) - (lm - 0.6);
      if (bulge > 0) lat = G.clamp(lat - Math.sign(midLat) * bulge * 2, -lm, lm);
      const tx = p.x + p.rx * lat - b.pos.x, tz = p.z + p.rz * lat - b.pos.z;
      const f = _f.set(0, 0, -1).applyQuaternion(b.q);
      const fx = f.x, fz = f.z, rx = -fz, rz = fx; // car's right in the ground plane
      const ang = Math.atan2(tx * rx + tz * rz, tx * fx + tz * fz);
      // pure pursuit: the turn rate that arcs onto the aim point, mapped through the same steering assist the
      // player's arrows go through (yaw rate = steer x 1.35 rad/s) — so small corrections at 90 m/s stay small
      const yawRate = Math.max(v, 8) * 2 * Math.sin(ang) / Math.hypot(tx, tz);
      inp.steer = G.clamp(yawRate / 1.35 + (Math.abs(ang) > 0.6 ? Math.sign(ang) : 0), -1, 1);
      const err = target - v;
      inp.throttle = err > 0 ? G.clamp(err / 4, 0, 1) : 0;
      inp.brake = err < -1.5 && v > 2 ? G.clamp(-err / 4, 0, 1) : 0;
      // full throttle whenever there's room: the planner already leaves the margin
      if (err > 1) inp.throttle = 1;
      inp.boost = false; inp.jump = false; inp.thrL = inp.thrR = false;
      // off a ramp at an angle there's no grip to steer with: fire a flank thruster if the landing spot is past the kerb
      if (!b.grounded && b.altitude > 0.8) {
        const vl = b.vel.x * m.rx + b.vel.z * m.rz;
        const land = b.near.lat + vl * (Math.sqrt(2 * b.altitude / 9.8) + 0.35);
        if (Math.abs(land) > lm - 1) {
          const push = rx * m.rx + rz * m.rz > 0 ? 1 : -1; // +1: the car's right is the track's right
          if (land * push > 0) inp.thrL = true; else inp.thrR = true;
        }
      }
    }

    emit(r, dt) {
      const fx = this.game.fx;
      if (!fx) return;
      const b = r.b, g = r.model.group;
      g.updateMatrixWorld();
      if (b.th.L > 0.1 || b.th.R > 0.1) fx.steamUnder(g, b.th.L, b.th.R, b.altitude, dt, b.vel);
      if (b.th.B > 0.1) fx.steamRear(g, b.th.B, dt, b.vel);
    }

    dispose() {
      for (const r of this.list) this.game.scene.remove(r.model.group);
    }
  }
  const _f = new T.Vector3();
  G.Rivals = Rivals;
  G.RIVAL_COLORS = COLORS;
  G.RIVAL_NAMES = NAMES;
  G.RIVAL_SKILL = SKILL;
})();
