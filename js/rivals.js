// rivals.js — AI roadsters. Each one is a full G.Player physics body (same tyres, mass, collisions and walls as you);
// the AI only presses the same "keys": steer, throttle, brake, boost and the under-thrusters.
(function () {
  const T = THREE;
  const NAMES = ['NOVA', 'RAVEN', 'ION', 'COMET', 'BLITZ', 'VEGA', 'ORBIT'];
  const COLORS = [0xc0182a, 0x15171b, 0x1d4fd8, 0xf2b705, 0xe8f6ff, 0x6a1bb0, 0x0f8f6a];
  // lines the AI can hold: every lane running with the race, the first oncoming lane (if any), and a line just
  // past each edge lane that slips past ramps (city: [1.8, 5.4, 9.0, -1.8, 0.1, 12.6]); rebuilt per track
  let CAND = [], CAND_COST = [];
  function buildCand() {
    const F = G.LANES_FWD, lo = Math.min(...F), hi = Math.max(...F);
    CAND = [...F]; CAND_COST = F.map(() => 0);
    if (G.LANES_ONC.length) { CAND.push(G.LANES_ONC[0]); CAND_COST.push(70); }
    for (const l of [lo - 1.7, hi + 3.6]) if (Math.abs(l) < G.WALL - 1.5) { CAND.push(l); CAND_COST.push(10); }
  }
  // rival skill: how close to the car's real limits the AI dares to drive. Same car, same physics, same keys —
  // aLat = cornering it trusts (m/s², tyres give ~16), aBrk = braking it plans with, top = speed cap (fraction
  // of a 100 m/s flat-out run), boost = boosts per second on straights, n2 = N₂ it keeps in reserve,
  // react = seconds of reaction it leaves before braking, catchUp/ease = rubber band when behind/ahead of you
  const SKILL = {
    easy:   { aLat: 10.5, aBrk: 8,    top: 0.74, boost: 0.15, n2: 70, react: 0.5,  catchUp: 1.06, ease: 0.85 },
    normal: { aLat: 13,   aBrk: 10.5, top: 0.86, boost: 0.45, n2: 50, react: 0.3,  catchUp: 1.1,  ease: 0.94 },
    hard:   { aLat: 15,   aBrk: 12.5, top: 0.96, boost: 1.2,  n2: 30, react: 0.15, catchUp: 1.12, ease: 1 },
    pro:    { aLat: 17,   aBrk: 14,   top: 1.2,  boost: 3,    n2: 18, react: 0.08, catchUp: 1.15, ease: 1 },
  };

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
          boostT: 0, jumpT: 0, stuckT: 0, finished: false, finishTime: 0,
          inp: { steer: 0, throttle: 0, brake: 0, handbrake: false, jump: false, thrL: false, thrR: false, boost: false, pitch: 0, rollAir: 0 },
        };
        r.b = new RB(game, model, r);
        r.pos = r.b.pos; r.th = r.b.th;
        this.list.push(r);
      }
      this._s = {};
    }

    grid(startS, slots) {
      const L = this.game.track.length;
      this.list.forEach((r, k) => {
        const sl = slots[k];
        r.b.place(startS + sl.ds, sl.lat, 0);
        r.b.fuel = 100; r.b.fuelLock = false; r.b.frozen = true;
        r.s = startS + sl.ds; r.lastS = G.wrap(r.s, L); r.latT = sl.lat;
        r.finished = false; r.boostT = 0; r.jumpT = 0; r.stuckT = 0;
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
      r.latT = lat; r.stuckT = 0; r.jumpT = 0;
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
      // speed plan: the fastest speed from which every corner ahead can still be braked down to in time
      const reach = v * K.react, horizon = v * v / (2 * K.aBrk) + reach + 40;
      let target = 100 * K.top * r.skill, kHere = 0;
      for (let d = 0; d < horizon; d += 6) {
        const k = tr.curvatureAt(sNow + d);
        if (d < 30) kHere = Math.max(kHere, k);
        const vC = Math.sqrt(K.aLat / Math.max(k, 1e-4));
        target = Math.min(target, Math.sqrt(vC * vC + 2 * K.aBrk * Math.max(0, d - reach)));
      }
      // rubber band
      const gap = r.s - playerProg;
      if (gap < -120) target *= K.catchUp; else if (gap > 160) target *= K.ease;

      // traffic scan per lane (wrecks included — they report their real lane position)
      const clear = CAND.map(() => 220);
      let curClear = 220, blockerV = 0;
      if (traffic) for (const c of traffic.cars) {
        let d = G.wrap(c.s - sNow, L);
        if (d > L - 8) d -= L;
        if (d > 160 || d < -6) continue;
        const rch = c.t.wid / 2 + 1.25;
        const gapD = d - c.t.len / 2 - 2.6;
        for (let j = 0; j < CAND.length; j++) if (Math.abs(c.lat - CAND[j]) < rch) clear[j] = Math.min(clear[j], gapD);
        if (Math.abs(c.lat - b.near.lat) < rch && gapD < curClear && b.altitude < c.t.hgt + 0.3) { curClear = gapD; blockerV = c.loose ? 0 : c.v * c.dir; }
      }
      // jump ramps launch you into the next corner blind: line up beside them, like a racer would
      for (const rp of tr.ramps) {
        let d = G.wrap(rp.s - sNow, L);
        if (d > L - 10) d -= L;
        if (d > 160 || d < -rp.len) continue;
        const rch = rp.w / 2 + 1.15, gapD = d - rp.len / 2 - 2.6;
        for (let j = 0; j < CAND.length; j++) if (Math.abs(rp.lat - CAND[j]) < rch) clear[j] = Math.min(clear[j], gapD);
      }
      // choose lane
      let best = 0, bs = -1e9;
      for (let j = 0; j < CAND.length; j++) {
        const sc = Math.min(clear[j], 160) - Math.abs(CAND[j] - r.latT) * 2.5 - CAND_COST[j] + (CAND[j] === r.latT ? 12 : 0);
        if (sc > bs) { bs = sc; best = j; }
      }
      r.latT = CAND[best];
      // something slower ahead in our lane: cap speed so we could still stop behind it
      if (curClear < 180) {
        const bv = Math.max(blockerV, 0), room = Math.max(0, curClear - 3 - v * K.react);
        target = Math.min(target, Math.sqrt(bv * bv + 2 * K.aBrk * 0.8 * room));
      }
      // boosts on straights (more often when trailing the player)
      const boostRate = K.boost * (gap < -120 ? 2 : 1);
      if (r.boostT <= 0 && b.fuel > K.n2 && kHere < 0.004 && v > 35 && target > v - 2 && Math.random() < dt * boostRate) r.boostT = 1 + Math.random() * 1.5;
      if (r.boostT > 0) { r.boostT -= dt; if (b.fuelLock || b.fuel < K.n2 * 0.4 || target < v - 3 || curClear < 60) r.boostT = 0; }
      this.drive(r, tr, target, r.latT);
      r.inp.boost = r.boostT > 0;
    }

    // pure-pursuit steering toward the lane, throttle/brake toward the target speed
    drive(r, tr, target, lat) {
      const b = r.b, inp = r.inp, v = r.v;
      const Ld = 7 + v * 0.42;
      const p = tr.sample(b.near.s + Ld, this._s);
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
      inp.boost = false; inp.jump = false;
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
  G.RIVAL_SKILL = SKILL;
})();
