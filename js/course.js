// course.js — obstacle courses: a course is a list of items ({t, s, p}: piece type, arc length along the circuit,
// parameters) built onto the current circuit. Set pieces (barrier chicanes, needle gates, container jumps, bollard
// slaloms, crate walls, 360° loops, air-ring chains, field-goal posts, mine rows), single obstacles (walls, cones, tyre
// stacks…), jumps and pads (ramps, tabletops, boost / bounce pads, oil), moving hazards (wrecking balls, sliding walls,
// spinners, laser gates) and pickups (repair kits, N₂, stars, rings). The official course is still laid out by the
// seeded generator below and "baked" into the same item list, so it stays identical for the leaderboard and ghosts;
// player-made courses (editor.js) are item lists saved as they are. Hull damage itself lives in game.js (game.damage).
(function () {
  const T = THREE;

  // procedural courses: a seed and a sequence of set pieces dropped along the circuit (baked into items on first use)
  G.COURSES = {
    street: { name: 'STUNT STREETS', seed: 7, pieces: ['chicane', 'hoops', 'needle', 'containers', 'goal', 'loop', 'slalom', 'crates', 'hoops', 'needle', 'goal', 'containers', 'chicane', 'loop', 'slalom', 'crates'] },
  };

  // h: height (m) · dmg: hull damage per m/s of impact above 3 · breakable: smashes instead of stopping the car
  const KIND = {
    barrier: { h: 1.1, dmg: 1.0 },
    pillar: { h: 5.5, dmg: 1.1 },
    container: { h: 2.6, dmg: 1.2 },
    bollard: { h: 1.2, dmg: 0.8 },
    crate: { h: 1.5, dmg: 0, breakable: true, pts: 100, label: 'CRATE SMASH' },
    post: { h: 6, dmg: 1.1 }, // goalpost stem: its top is the crossbar
    wall: { h: 3.2, dmg: 1.2 },
    cone: { h: 0.9, dmg: 0, breakable: true, pts: 50, label: 'CONE SMASH' },
    tires: { h: 1.1, dmg: 0.35 },
    deck: { h: 2.4, dmg: 1.0 }, // tabletop platform (its height comes from the item)
    gantry: { h: 15, dmg: 1.1 },
    hub: { h: 1.8, dmg: 1.0 },
    spinner: { h: 1.3, dmg: 0.9 },
    slider: { h: 2.2, dmg: 1.0 },
    emitter: { h: 1.6, dmg: 0.8 },
  };
  const BOX_COLORS = [0x2f6fa8, 0xb8452c, 0x3d8a4a, 0xc9a227, 0x6b4aa0, 0x8a8f96];
  const PL = 4.6, PW = 2.05; // roadster footprint, same as traffic collisions
  const PIV = 15, CHAIN = 13.2, BALL = 1.8; // wrecking ball: pivot height, chain length, ball radius

  // the editor's catalogue. len: rough length along the road · params: [key, label, min, max, step] ('lat' = across
  // the road) · rnd: parameters rolled at random when the piece is placed (REROLL draws them again)
  const LAT = 'lat';
  G.PIECE_CATS = [['set', 'SET PIECES'], ['obs', 'OBSTACLES'], ['jump', 'JUMPS & PADS'], ['haz', 'HAZARDS'], ['pick', 'PICKUPS']];
  G.PIECES = {
    chicane: { name: 'Chicane', cat: 'set', len: 36, desc: 'Two staggered barrier walls, mines overhead', params: [['m', 'Opening', -1, 1, 2]], rnd: ['m', 'b'] },
    needle: { name: 'Needle gates', cat: 'set', len: 50, desc: 'Full-width walls with one narrow slot each', params: [], rnd: ['c', 'b'] },
    containers: { name: 'Container stack', cat: 'set', len: 46, desc: 'Kickers onto a block of containers, alley through the middle', params: [['a', 'Alley', LAT]], rnd: ['a', 'cols'] },
    slalom: { name: 'Bollard slalom', cat: 'set', len: 98, desc: 'Six rows of bollards, the gap swaps sides', params: [['f', 'First gap', -1, 1, 2]], rnd: ['b1', 'b2'] },
    crates: { name: 'Crate wall', cat: 'set', len: 16, desc: 'Smash through or fly the kicker', params: [['c', 'Kicker', LAT]], rnd: ['c', 'sp'] },
    loop: { name: '360° loop', cat: 'set', len: 34, desc: 'Enter on the yellow lane above 85 km/h', params: [['side', 'Side', -1, 1, 2]], rnd: ['side'] },
    hoops: { name: 'Ring chain', cat: 'set', len: 96, desc: 'A kicker into five floating rings', params: [['c', 'Kicker', LAT], ['w', 'Weave', -1, 1, 2]], rnd: ['c', 'w'] },
    goal: { name: 'Field goal', cat: 'set', len: 50, desc: 'Kick off the ramp between the uprights', params: [['c', 'Line', LAT]], rnd: ['c'] },
    minerow: { name: 'Mine row', cat: 'set', len: 6, desc: 'Five floating mines across the street', params: [], rnd: ['b'] },
    barrier: { name: 'Barrier', cat: 'obs', len: 1, desc: 'Low striped barrier, jump it for a bonus', params: [['lat', 'Lane', LAT], ['w', 'Width', 2, 32, 1]] },
    wall: { name: 'Concrete wall', cat: 'obs', len: 1, desc: 'Tall wall: go round or fly over', params: [['lat', 'Lane', LAT], ['w', 'Width', 2, 32, 1]] },
    pillar: { name: 'Pillar', cat: 'obs', len: 1, desc: 'Glowing pillar', params: [['lat', 'Lane', LAT]] },
    container: { name: 'Container', cat: 'obs', len: 12, desc: 'A shipping container you can land on', params: [['lat', 'Lane', LAT], ['col', 'Colour', 0, 5, 1]], rnd: ['col'] },
    bollard: { name: 'Bollard', cat: 'obs', len: 1, desc: 'Short yellow post', params: [['lat', 'Lane', LAT]] },
    tires: { name: 'Tyre stack', cat: 'obs', len: 2, desc: 'Soft: bumps you, barely hurts', params: [['lat', 'Lane', LAT]] },
    crate: { name: 'Crate', cat: 'obs', len: 1, desc: 'Breakable wooden crate', params: [['lat', 'Lane', LAT]], rnd: ['spin'] },
    cone: { name: 'Traffic cone', cat: 'obs', len: 1, desc: 'Breakable, a few points each', params: [['lat', 'Lane', LAT]] },
    ramp: { name: 'Ramp', cat: 'jump', len: 12, desc: 'A kicker of any size', params: [['lat', 'Lane', LAT], ['len', 'Length', 4, 30, 1], ['w', 'Width', 2, 20, 0.5], ['h', 'Height', 0.5, 8, 0.1]] },
    table: { name: 'Tabletop', cat: 'jump', len: 34, desc: 'Ramp up, flat top, ramp down: land on top for a bonus', params: [['lat', 'Lane', LAT], ['w', 'Width', 3, 20, 0.5], ['h', 'Height', 1, 6, 0.1], ['top', 'Top length', 4, 40, 1]] },
    boost: { name: 'Boost pad', cat: 'jump', len: 6, desc: 'Fires you forward', params: [['lat', 'Lane', LAT], ['pow', 'Kick', 4, 30, 1]] },
    bounce: { name: 'Bounce pad', cat: 'jump', len: 4, desc: 'Throws you into the air', params: [['lat', 'Lane', LAT], ['pow', 'Bounce', 6, 26, 1]] },
    oil: { name: 'Oil slick', cat: 'jump', len: 14, desc: 'No grip while you cross it', params: [['lat', 'Lane', LAT], ['len', 'Length', 4, 40, 1], ['w', 'Width', 2, 24, 0.5]] },
    mine: { name: 'Mine', cat: 'haz', len: 2, desc: 'One floating mine', params: [['lat', 'Lane', LAT], ['y', 'Height', 1, 30, 0.5]], rnd: ['ph'] },
    pendulum: { name: 'Wrecking ball', cat: 'haz', len: 4, desc: 'Swings across the road', params: [['lat', 'Lane', LAT], ['amp', 'Swing', 1, 12, 0.5], ['per', 'Period', 1.5, 8, 0.1]], rnd: ['ph'] },
    slider: { name: 'Sliding wall', cat: 'haz', len: 2, desc: 'A wall that slides side to side', params: [['lat', 'Lane', LAT], ['w', 'Width', 2, 14, 0.5], ['amp', 'Travel', 0, 14, 0.5], ['per', 'Period', 1, 10, 0.1]], rnd: ['ph'] },
    spinner: { name: 'Spinner', cat: 'haz', len: 12, desc: 'A rotating bar: time it or jump it', params: [['lat', 'Lane', LAT], ['len', 'Length', 4, 26, 0.5], ['spd', 'Speed', -4, 4, 0.1]], rnd: ['ph'] },
    laser: { name: 'Laser gate', cat: 'haz', len: 1, desc: 'Blinks on and off: cross while it is off, or jump it', params: [['lat', 'Lane', LAT], ['w', 'Width', 4, 32, 1], ['on', 'On (s)', 0.3, 5, 0.1], ['off', 'Off (s)', 0.3, 5, 0.1], ['ph', 'Offset', 0, 5, 0.1]] },
    kit: { name: 'Repair kit', cat: 'pick', len: 1, desc: 'Hull +30%', params: [['lat', 'Lane', LAT]] },
    n2: { name: 'N₂ canister', cat: 'pick', len: 1, desc: 'Thrust +35', params: [['lat', 'Lane', LAT], ['y', 'Height', 1.3, 25, 0.1]] },
    star: { name: 'Star', cat: 'pick', len: 1, desc: '+300 points, once per run', params: [['lat', 'Lane', LAT], ['y', 'Height', 1.4, 30, 0.1]] },
    ring: { name: 'Air ring', cat: 'pick', len: 1, desc: 'Fly through it', params: [['lat', 'Lane', LAT], ['y', 'Height', 3, 30, 0.5], ['r', 'Size', 1.6, 6, 0.1]] },
  };

  // the builders: (s, p) with `this` the course. A missing parameter is drawn from the course RNG at the exact point
  // the original generator drew it, and written back into p, so a baked course rebuilds without touching the RNG.
  const PB = {
    // two staggered barrier walls: weave through the openings or hop them
    chicane(s, p) {
      const R = G.ROAD_HALF, gap = 7.5, m = this.P(p, 'm', () => (this.rand() < 0.5 ? 1 : -1));
      const wall = (ss, side) => {
        if (side > 0) this.line('barrier', ss, -R, R - gap, 2, 0.8); else this.line('barrier', ss, -R + gap, R, 2, 0.8);
        this.hurdle(ss, KIND.barrier.h);
      };
      wall(s, m); wall(s + 32, -m);
      this.bombRow(s + 16, p, 'b');
    },
    // a full-width wall with one narrow slot marked by tall pillars: thread it for big points
    needle(s, p) {
      const R = G.ROAD_HALF, cs = p.c || (p.c = []);
      for (let n = 0; n < 2; n++) {
        const ss = s + n * 42, gap = n ? 4.2 : 4.8;
        if (cs[n] == null) cs[n] = this.laneLat();
        const c = G.clamp(cs[n], -R + gap / 2 + 1.2, R - gap / 2 - 1.2);
        this.line('barrier', ss, -R, c - gap / 2 - 1, 2, 0.8);
        this.line('barrier', ss, c + gap / 2 + 1, R, 2, 0.8);
        this.add('pillar', ss, c - gap / 2 - 0.5, 1, 1);
        this.add('pillar', ss, c + gap / 2 + 0.5, 1, 1);
        this.gate(ss, c, gap, n ? 700 : 500, n ? 'NEEDLE THREADED' : 'GATE THREADED');
        this.hurdle(ss, KIND.barrier.h);
      }
      this.bombRow(s + 21, p, 'b');
    },
    // a kicker into a block of containers: land on the roof, or take the narrow alley through the middle
    containers(s, p) {
      const R = G.ROAD_HALF, alley = 3.6, a = G.clamp(this.P(p, 'a', () => this.laneLat()), -R + 4, R - 4);
      const lo = a - alley / 2, hi = a + alley / 2, cols = p.cols || (p.cols = []);
      let ci = 0;
      // kickers on both sides of the alley, ending 3 m short of the boxes
      if (lo + R > 2) this.kicker(s + 6, (-R + lo) / 2, 12, lo + R, 2.5);
      if (R - hi > 2) this.kicker(s + 6, (hi + R) / 2, 12, R - hi, 2.5);
      for (const [x0, x1] of [[-R, lo], [hi, R]]) {
        const n = Math.max(1, Math.round((x1 - x0) / 2.6)), w = (x1 - x0) / n;
        for (let j = 0; j < n; j++) for (let r = 0; r < 2; r++) {
          if (cols[ci] == null) cols[ci] = (this.rand() * BOX_COLORS.length) | 0;
          this.add('container', s + 15 + 6 + r * 12, x0 + w * (j + 0.5), 11.8, w * 0.97, { color: BOX_COLORS[cols[ci++] % BOX_COLORS.length], roof: 'c' + s });
        }
      }
      this.gate(s + 27, a, alley, 600, 'ALLEY RUN');
      this.hurdle(s + 39, KIND.container.h, 'CLEARED THE STACK');
    },
    // rows of bollards with a gap that swaps sides every row
    slalom(s, p) {
      const R = G.ROAD_HALF, gap = 6, f = this.P(p, 'f', () => 1) < 0 ? -1 : 1;
      for (let r = 0; r < 6; r++) {
        const ss = s + r * 18, c = (r & 1 ? 1 : -1) * f * R * 0.45;
        for (let x = -R + 1.2; x < R - 0.6; x += 2.4) if (Math.abs(x - c) > gap / 2) this.add('bollard', ss, x, 0.5, 0.5);
        this.gate(ss, c, gap, 150, 'SLALOM');
      }
      this.bombRow(s + 18, p, 'b1'); this.bombRow(s + 72, p, 'b2');
    },
    // a 360° loop: enter on the yellow lane, keep your speed up (about 85 km/h at least), come out a lane over
    loop(s, p) {
      const R = G.ROAD_HALF, side = this.P(p, 'side', () => (this.rand() < 0.5 ? 1 : -1)) < 0 ? -1 : 1;
      const lat = -side * (R - 4.5), q = this.track.sample(s + 12, {});
      this.loops.push({ s: G.wrap(s + 12, this.L), lat, R: 9, w: 6, shift: side * 7.5, x: q.x + q.rx * lat, z: q.z + q.rz * lat, tx: q.tx, tz: q.tz, rx: q.rx, rz: q.rz, it: this.cur });
    },
    // a wall of crates: smash through (slows you) or use the kicker in the middle to fly over
    crates(s, p) {
      const R = G.ROAD_HALF, c = G.clamp(this.P(p, 'c', () => this.laneLat()), -R + 4, R - 4), sp = p.sp || (p.sp = []);
      this.kicker(s - 4, c, 8, 4.5, 1.8);
      let i = 0;
      for (let x = -R + 0.75; x < R; x += 1.5, i++) {
        if (sp[i] == null) sp[i] = this.rand();
        this.add('crate', s + 6, x, 1.4, 1.4, { spin: sp[i] });
      }
      this.hurdle(s + 6, KIND.crate.h);
    },
    // a kicker into a chain of floating rings: hold the under-thrusters and fly through them all
    hoops(s, p) {
      const R = G.ROAD_HALF, c = G.clamp(this.P(p, 'c', () => this.laneLat()), -R + 4, R - 4), set = this.ringSets++, n = 5;
      const wob = (this.P(p, 'w', () => (this.rand() < 0.5 ? 1 : -1)) < 0 ? -1 : 1) * Math.min(3.5, R - 4);
      this.kicker(s, c, 10, 5, 2.2);
      for (let k = 0; k < n; k++) this.ring(s + 18 + k * 16, G.clamp(c + wob * Math.sin(k * 1.1), -R + 3, R - 3), 4.5 + Math.sin(((k + 0.5) / n) * Math.PI) * 6, 2.7, set, k, n);
    },
    // an American-football goalpost: launch off the kicker and fly between the uprights, over the crossbar
    goal(s, p) {
      const R = G.ROAD_HALF, c = G.clamp(this.P(p, 'c', () => this.laneLat()), -R + 5, R - 5), gs = s + 44;
      this.kicker(s, c, 12, 5, 2.6);
      this.add('post', gs, c, 0.6, 0.6);
      const q = this.track.pointAt(gs, c, {}), t = this.track.sample(gs, {});
      this.goals.push({ s: G.wrap(gs, this.L), lat: c, bar: KIND.post.h, half: 3.6, top: 17, x: q.x, z: q.z, tx: t.tx, tz: t.tz, rx: t.rx, rz: t.rz });
    },
    minerow(s, p) { this.bombRow(s, p, 'b'); },

    // ---- single obstacles ----
    barrier(s, p) {
      const R = G.ROAD_HALF, lat = this.lat(p), w = this.P(p, 'w', () => 8);
      this.line('barrier', s, Math.max(-R, lat - w / 2), Math.min(R, lat + w / 2), 2, 0.8);
      this.hurdle(s, KIND.barrier.h);
    },
    wall(s, p) {
      const lat = this.lat(p), w = this.P(p, 'w', () => 6);
      this.add('wall', s, lat, 1.2, w);
      this.hurdle(s, KIND.wall.h, 'OVER THE WALL');
    },
    pillar(s, p) { this.add('pillar', s, this.lat(p), 1, 1); },
    container(s, p) {
      const lat = this.lat(p), col = this.P(p, 'col', () => (this.rand() * BOX_COLORS.length) | 0);
      this.add('container', s, lat, 11.8, 2.5, { color: BOX_COLORS[Math.abs(col | 0) % BOX_COLORS.length], roof: 'k' + s + ':' + lat });
    },
    bollard(s, p) { this.add('bollard', s, this.lat(p), 0.5, 0.5); },
    tires(s, p) { this.add('tires', s, this.lat(p), 1.5, 1.5); },
    crate(s, p) { const lat = this.lat(p); this.add('crate', s, lat, 1.4, 1.4, { spin: this.P(p, 'spin', () => this.rand()) }); },
    cone(s, p) { this.add('cone', s, this.lat(p), 0.7, 0.7); },

    // ---- jumps & pads ----
    ramp(s, p) { this.kicker(s, this.lat(p), this.P(p, 'len', () => 12), this.P(p, 'w', () => 5), this.P(p, 'h', () => 2.5)); },
    table(s, p) {
      const lat = this.lat(p), w = this.P(p, 'w', () => 6), h = this.P(p, 'h', () => 2.4), top = this.P(p, 'top', () => 14);
      this.kicker(s, lat, 10, w, h);
      // climb: the car's nose reaches the deck while it is still on the ramp, so the deck gives way to anything coming up it
      this.add('deck', s + 5 + top / 2, lat, top, w, { h, climb: 0.3 * h + 0.4, roof: 't' + s + ':' + lat, roofName: 'TABLETOP' });
      this.kicker(s + 10 + top, lat, 10, w, h, -1);
    },
    boost(s, p) { this.pad('boost', s, this.lat(p), 6, 3.6, this.P(p, 'pow', () => 14)); },
    bounce(s, p) { this.pad('bounce', s, this.lat(p), 4, 4, this.P(p, 'pow', () => 14)); },
    oil(s, p) { this.pad('oil', s, this.lat(p), this.P(p, 'len', () => 14), this.P(p, 'w', () => 6), 0); },

    // ---- hazards ----
    mine(s, p) { const lat = this.lat(p); this.mine(s, lat, 0, this.P(p, 'y', () => 8), this.P(p, 'ph', () => this.rand() * 6.28)); },
    pendulum(s, p) {
      const lat = this.lat(p), amp = this.P(p, 'amp', () => 6), per = this.P(p, 'per', () => 3.2), ph = this.P(p, 'ph', () => this.rand() * 6.28);
      const span = Math.max(1, amp) + 4.5;
      this.add('gantry', s, lat - span, 0.8, 0.8); this.add('gantry', s, lat + span, 0.8, 0.8);
      const q = this.track.sample(s, {});
      this.pends.push({ s: G.wrap(s, this.L), lat, span, amax: Math.asin(Math.min(0.95, amp / CHAIN)), per: Math.max(0.5, per), ph, k: { dmg: 0.9 },
        x: q.x, z: q.z, tx: q.tx, tz: q.tz, rx: q.rx, rz: q.rz, bx: 0, by: 0, bz: 0, vx: 0, vy: 0, vz: 0, th: 0, it: this.cur });
    },
    slider(s, p) {
      const lat = this.lat(p), w = this.P(p, 'w', () => 5), amp = this.P(p, 'amp', () => 4), per = this.P(p, 'per', () => 4), ph = this.P(p, 'ph', () => this.rand() * 6.28);
      const q = this.track.sample(s, {});
      this.add('slider', s, lat, 1.4, w, { mv: { lat0: lat, amp, per: Math.max(0.5, per), ph, cx: q.x, cz: q.z } });
    },
    spinner(s, p) {
      const lat = this.lat(p), len = this.P(p, 'len', () => 11), spd = this.P(p, 'spd', () => 1.4), ph = this.P(p, 'ph', () => this.rand() * 6.28);
      this.add('hub', s, lat, 1.2, 1.2);
      const o = this.add('spinner', s, lat, 0.5, len, {});
      o.rot = { spd, ph, tx: o.tx, tz: o.tz, rx: o.rx, rz: o.rz };
    },
    laser(s, p) {
      const R = G.ROAD_HALF, lat = this.lat(p), w = this.P(p, 'w', () => 2 * R), on = this.P(p, 'on', () => 1.6), off = this.P(p, 'off', () => 1.6), ph = this.P(p, 'ph', () => 0);
      this.add('emitter', s, lat - w / 2 - 0.3, 0.6, 0.6); this.add('emitter', s, lat + w / 2 + 0.3, 0.6, 0.6);
      const q = this.track.pointAt(s, lat, {}), t = this.track.sample(s, {});
      this.lasers.push({ s: G.wrap(s, this.L), lat, w, on: Math.max(0.1, on), off: Math.max(0.1, off), ph, lit: true, x: q.x, z: q.z, tx: t.tx, tz: t.tz, rx: t.rx, rz: t.rz, it: this.cur });
    },

    // ---- pickups ----
    kit(s, p) { this.pick('kit', s, this.lat(p), 1.3); },
    n2(s, p) { this.pick('n2', s, this.lat(p), this.P(p, 'y', () => 1.3)); },
    star(s, p) { this.pick('star', s, this.lat(p), this.P(p, 'y', () => 1.4)); },
    ring(s, p) { this.ring(s, this.lat(p), this.P(p, 'y', () => 6), this.P(p, 'r', () => 2.7), this.ringSets++, 0, 1); },
  };

  // shared textures for the pads (made once, kept for the page's life)
  let PADTEX = null;
  function padTextures() {
    if (PADTEX) return PADTEX;
    const chev = (col) => (ctx, w, h) => {
      ctx.fillStyle = 'rgba(10,14,22,0.9)'; ctx.fillRect(0, 0, w, h);
      ctx.strokeStyle = col; ctx.lineWidth = 10; ctx.lineJoin = 'round';
      for (let k = 0; k < 3; k++) { const y = 40 + k * 70; ctx.beginPath(); ctx.moveTo(18, y + 44); ctx.lineTo(w / 2, y); ctx.lineTo(w - 18, y + 44); ctx.stroke(); }
      ctx.lineWidth = 6; ctx.strokeRect(3, 3, w - 6, h - 6);
    };
    PADTEX = {
      boost: G.canvasTexture(128, 256, chev('#5fd4ff')),
      bounce: G.canvasTexture(128, 128, (ctx, w, h) => {
        ctx.fillStyle = 'rgba(10,22,14,0.9)'; ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = '#6dffa8'; ctx.lineWidth = 7;
        for (let r = 14; r < 64; r += 16) { ctx.beginPath(); ctx.arc(w / 2, h / 2, r, 0, Math.PI * 2); ctx.stroke(); }
      }),
      oil: G.canvasTexture(256, 256, (ctx, w, h) => {
        const r = G.rng(17);
        for (let k = 0; k < 26; k++) {
          const x = w * (0.2 + r() * 0.6), y = h * (0.1 + r() * 0.8), rr = 18 + r() * 40;
          const g = ctx.createRadialGradient(x, y, 0, x, y, rr);
          g.addColorStop(0, 'rgba(4,4,6,0.95)'); g.addColorStop(0.7, 'rgba(8,6,14,0.85)'); g.addColorStop(1, 'rgba(8,6,14,0)');
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rr, 0, Math.PI * 2); ctx.fill();
        }
      }),
    };
    return PADTEX;
  }

  class Course {
    // def: a course ({name, items}), a procedural one ({seed, pieces}) or nothing / 'street' for the official course
    constructor(game, def) {
      this.game = game;
      if (!def || typeof def === 'string') def = G.officialCourse(game.track);
      this.def = def;
      this.track = game.track;
      this.init();
      this.items = def.items || G.bakeCourse(def, this.track);
      this.rand = G.rng(def.seed ? def.seed * 9973 + (G.TRACK_ID === 'highway' ? 1 : 0) : (Math.random() * 1e9) | 0);
      this.items.forEach((it, i) => {
        const f = PB[it.t];
        if (!f || !Number.isFinite(it.s)) return;
        this.cur = i;
        f.call(this, G.wrap(it.s, this.L), it.p || (it.p = {}));
      });
      this.obs.sort((a, b) => a.s - b.s);
      this.movers = this.obs.filter((o) => o.mv || o.rot);
      this.buildMeshes();
      this.lastS = null; this.clock = 0;
    }
    init() {
      this.L = this.track.length;
      this.obs = []; this.kickers = []; this.gates = []; this.hurdles = []; this.kits = [];
      this.loops = []; this.bombs = []; this.rings = []; this.goals = [];
      this.pads = []; this.pends = []; this.lasers = [];
      this.ringSets = 0; this.chain = { set: -1, k: -1, n: 0 }; this.cur = -1;
      this.near = []; this.nearK = []; this.nearB = [];
    }

    // the official generator: set pieces in order along the lap, clear of the circuit's own ramps, repair kits between
    layout() {
      const L = this.L, ramps = this.track.ramps, items = [];
      let s = 150, i = 0;
      while (s < L - 220) {
        const kind = this.def.pieces[i % this.def.pieces.length];
        const len = G.PIECES[kind].len;
        // keep clear of the circuit's own jump ramps (they'd launch you straight into a wall)
        const clash = ramps.find((r) => r.s > s - 90 && r.s < s + len + 40);
        if (clash) { s = Math.max(s, clash.s + 90) + 1; continue; } // always step forward: s = r.s + 90 can round back into the same clash
        if (s + len > L - 200) break;
        const p = {};
        PB[kind].call(this, s, p);
        items.push({ t: kind, s, p });
        if (kind === 'containers' || this.rand() < 0.55) { const ks = s + len + 22 + this.rand() * 10; items.push({ t: 'kit', s: ks, p: { lat: this.laneLat() } }); }
        s += len + 60 + this.rand() * 35;
        i++;
      }
      return items;
    }

    P(p, k, f) { const v = p[k]; return v != null && (typeof v !== 'number' || Number.isFinite(v)) ? v : (p[k] = f()); }
    lat(p) { const R = G.ROAD_HALF; return G.clamp(this.P(p, 'lat', () => 0), -R + 0.5, R - 0.5); }
    laneLat() { const R = G.ROAD_HALF; return (this.rand() * 2 - 1) * (R - 3); }

    // a box laid square to the road: len along the track, wid across it
    add(kind, s, lat, len, wid, extra) {
      const p = this.track.sample(s, {});
      const k = KIND[kind];
      const o = Object.assign({ kind, k, s: G.wrap(s, this.L), lat, hl: len / 2, hw: wid / 2, h: k.h, x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, alive: true, it: this.cur }, extra);
      this.obs.push(o);
      return o;
    }
    // a run of short segments across [a, b] (looks like a real barrier line and stays straight on the curve)
    line(kind, s, a, b, seg, len) {
      const n = Math.max(1, Math.round((b - a) / seg)), w = (b - a) / n;
      for (let j = 0; j < n; j++) this.add(kind, s, a + w * (j + 0.5), len, w * 0.96, { stripe: j & 1 });
    }
    // dir -1: a down ramp (high end first)
    kicker(s, lat, len, wid, h, dir = 1) {
      const p = this.track.sample(s, {});
      this.kickers.push({ s: G.wrap(s, this.L), lat, len, w: wid, h, k: h / len, dir, x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, it: this.cur });
    }
    gate(s, lat, gap, pts, name) { this.gates.push({ s: G.wrap(s, this.L), lat, gap, pts, name }); }
    hurdle(s, top, name) { this.hurdles.push({ s: G.wrap(s, this.L), top, name }); }
    ring(ss, lat, y, r, set, k, n) {
      const p = this.track.pointAt(ss, lat, {}), t = this.track.sample(ss, {});
      this.rings.push({ s: G.wrap(ss, this.L), lat, y, r, set, k, n, x: p.x, z: p.z, tx: t.tx, tz: t.tz, rx: t.rx, rz: t.rz, on: true, t: 0, it: this.cur });
    }
    pad(kind, s, lat, len, wid, pow) {
      const p = this.track.sample(s, {});
      this.pads.push({ kind, s: G.wrap(s, this.L), lat, hl: len / 2, hw: wid / 2, pow, x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz, it: this.cur });
    }
    pick(kind, s, lat, y) {
      const p = this.track.pointAt(s, lat, {});
      this.kits.push({ kind, s: G.wrap(s, this.L), lat, x: p.x, z: p.z, y, active: true, t: 0, it: this.cur });
    }
    mine(s, lat, ds, y0, ph) {
      const R = G.ROAD_HALF, p = this.track.pointAt(s + ds, G.clamp(lat, -R + 1, R - 1), {});
      this.bombs.push({ s: G.wrap(s, this.L), lat, x: p.x, z: p.z, y0, y: 0, ph, alive: true, t: 0, it: this.cur });
    }
    // floating mines across the street: a couple low, most of them up where you'd fly over the ground obstacles
    // (a row is kept in p[key] as [lat, ds, y0, phase] per mine)
    bombRow(s, p, key) {
      const R = G.ROAD_HALF;
      let row = p[key];
      if (!Array.isArray(row)) {
        const hs = [6.5, 10, 14, 18, 22, 26];
        for (let j = hs.length - 1; j > 0; j--) { const k = (this.rand() * (j + 1)) | 0; [hs[j], hs[k]] = [hs[k], hs[j]]; }
        row = p[key] = [];
        for (let k = 0; k < 5; k++) {
          const lat = -R + 2 + (k + 0.2 + this.rand() * 0.6) * (2 * R - 4) / 5;
          const ds = (this.rand() - 0.5) * 6, y0 = hs[k] + this.rand() * 2, ph = this.rand() * 6.28;
          row.push([lat, ds, y0, ph]);
        }
      }
      for (const m of row) if (Array.isArray(m)) this.mine(s, +m[0] || 0, +m[1] || 0, +m[2] || 8, +m[3] || 0);
    }

    // ---------- meshes ----------
    buildMeshes() {
      const sc = this.game.scene, Q = this.game.Q;
      const grp = (this.group = new T.Group());
      sc.add(grp);
      const box = new T.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
      const cyl = new T.CylinderGeometry(0.5, 0.5, 1, 14).translate(0, 0.5, 0);
      const cone = new T.ConeGeometry(0.5, 1, 14).translate(0, 0.5, 0);
      const mats = {
        barrier: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, emissive: 0x331010, emissiveIntensity: 0.6 }),
        pillar: new T.MeshStandardMaterial({ color: 0xff6a2a, roughness: 0.4, emissive: 0xff4a10, emissiveIntensity: 1.6 }),
        container: new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.35 }),
        bollard: new T.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.5, emissive: 0xffb000, emissiveIntensity: 0.9 }),
        crate: new T.MeshStandardMaterial({ color: 0xb07a3e, roughness: 0.85 }),
        post: new T.MeshStandardMaterial({ color: 0xffd400, roughness: 0.45, emissive: 0x806000, emissiveIntensity: 0.9 }),
        wall: new T.MeshStandardMaterial({ color: 0xa4a8b0, roughness: 0.92, emissive: 0x15171c }),
        cone: new T.MeshStandardMaterial({ color: 0xff6a10, roughness: 0.55, emissive: 0x5a1800, emissiveIntensity: 1 }),
        tires: new T.MeshStandardMaterial({ color: 0x1a1b1f, roughness: 0.95 }),
        deck: new T.MeshStandardMaterial({ color: 0x3c4554, roughness: 0.6, metalness: 0.4, emissive: 0x0a1a2a }),
        gantry: new T.MeshStandardMaterial({ color: 0x5a606a, roughness: 0.5, metalness: 0.6 }),
        hub: new T.MeshStandardMaterial({ color: 0xffc21a, roughness: 0.5, emissive: 0x6a4a00, emissiveIntensity: 0.8 }),
        spinner: new T.MeshStandardMaterial({ color: 0xff2a3c, roughness: 0.45, emissive: 0x700010, emissiveIntensity: 1.2 }),
        slider: new T.MeshStandardMaterial({ color: 0xff8a00, roughness: 0.5, emissive: 0x6a2a00, emissiveIntensity: 1.1 }),
        emitter: new T.MeshStandardMaterial({ color: 0x30343c, roughness: 0.4, metalness: 0.6, emissive: 0x500808 }),
      };
      const geoOf = { cone, tires: cyl, hub: cyl };
      this.mats = Object.values(mats);
      this.geos = [box, cyl, cone];
      this.inst = {};
      const m = new T.Matrix4(), col = new T.Color();
      for (const kind of Object.keys(KIND)) {
        const list = this.obs.filter((o) => o.kind === kind);
        if (!list.length) continue;
        const im = new T.InstancedMesh(geoOf[kind] || box, mats[kind], list.length);
        im.castShadow = im.receiveShadow = !!Q.shadows;
        list.forEach((o, j) => {
          o.inst = im; o.ii = j;
          this.pose(o, m); im.setMatrixAt(j, m);
          if (kind === 'barrier') im.setColorAt(j, col.set(o.stripe ? 0xd8262e : 0xf2f0ea));
          else if (kind === 'container') im.setColorAt(j, col.set(o.color));
          else if (kind === 'crate') im.setColorAt(j, col.set(0xb07a3e).multiplyScalar(0.8 + o.spin * 0.4));
        });
        if (KIND[kind].breakable || kind === 'slider' || kind === 'spinner') { im.instanceMatrix.setUsage(T.DynamicDrawUsage); im.frustumCulled = false; }
        grp.add(im);
        this.inst[kind] = im;
      }
      // kickers: a wedge rising toward -Z (the race direction once posed); a down ramp is the same wedge turned round
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
        this.kickers.forEach((k, j) => {
          const o = k.dir < 0 ? { x: k.x, z: k.z, tx: -k.tx, tz: -k.tz, rx: -k.rx, rz: -k.rz } : k;
          this.poseBox(m, o, k.w, k.h, k.len, 0); im.setMatrixAt(j, m);
        });
        grp.add(im);
        this.inst.kickers = im;
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
          for (const [lat, len, off] of [[lp.lat, 14, -7], [lp.lat + lp.shift, 8, 4]]) {
            const p = this.track.sample(lp.s + off, {});
            const o = { x: p.x + p.rx * lat, z: p.z + p.rz * lat, tx: p.tx, tz: p.tz, rx: p.rx, rz: p.rz };
            const lane = new T.Mesh(box, laneM);
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
      // rings: glowing hoops standing square to the road; they go dark for a while once flown through
      if (this.rings.length) {
        const tg = new T.TorusGeometry(1, 0.09, 10, 40), rm = new T.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
        this.geos.push(tg); this.mats.push(rm);
        const im = (this.ringMesh = new T.InstancedMesh(tg, rm, this.rings.length));
        im.frustumCulled = false;
        this.rings.forEach((q, j) => {
          const r = q.r;
          m.set(q.rx * r, 0, -q.tx * r, q.x, 0, r, 0, q.y, q.rz * r, 0, -q.tz * r, q.z, 0, 0, 0, 1);
          im.setMatrixAt(j, m);
        });
        grp.add(im); this.inst.rings = im;
        this.ringColors();
      }
      // goalposts: the stem is a solid obstacle (above); crossbar and uprights sit on top of it
      if (this.goals.length) {
        const pm = mats.post, gc = new T.CylinderGeometry(0.18, 0.18, 1, 10);
        const flagM = new T.MeshBasicMaterial({ color: new T.Color(3.5, 0.5, 0.2), toneMapped: false, side: T.DoubleSide }), fg = new T.PlaneGeometry(0.9, 0.5);
        this.geos.push(gc, fg); this.mats.push(flagM);
        for (const q of this.goals) {
          const g = new T.Group();
          g.matrixAutoUpdate = false;
          g.matrix.set(q.rx, 0, -q.tx, q.x, 0, 1, 0, 0, q.rz, 0, -q.tz, q.z, 0, 0, 0, 1);
          const bar = new T.Mesh(gc, pm); bar.rotation.z = Math.PI / 2; bar.scale.y = q.half * 2 + 0.36; bar.position.y = q.bar; g.add(bar);
          for (const sx of [-1, 1]) {
            const up = new T.Mesh(gc, pm); up.scale.y = q.top - q.bar; up.position.set(sx * q.half, (q.bar + q.top) / 2, 0); g.add(up);
            const flag = new T.Mesh(fg, flagM); flag.position.set(sx * (q.half + 0.45), q.top - 0.3, 0); g.add(flag);
          }
          g.traverse((o) => { o.castShadow = !!Q.shadows; });
          grp.add(g);
        }
      }
      // pads: flat painted plates (boost chevrons, bounce rings, an oil puddle)
      if (this.pads.length) {
        const tex = padTextures(), pm = {};
        for (const k of ['boost', 'bounce', 'oil']) {
          pm[k] = k === 'oil'
            ? new T.MeshStandardMaterial({ map: tex.oil, transparent: true, roughness: 0.05, metalness: 0.9, color: 0x9a90b0, depthWrite: false })
            : new T.MeshStandardMaterial({ map: tex[k], emissiveMap: tex[k], emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.5 });
          this.mats.push(pm[k]);
        }
        const pg = new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
        this.geos.push(pg);
        for (const q of this.pads) {
          const mesh = new T.Mesh(pg, pm[q.kind]);
          mesh.matrixAutoUpdate = false;
          this.poseBox(mesh.matrix, q, q.hw * 2, 1, q.hl * 2, q.kind === 'oil' ? 0.025 : 0.035);
          mesh.receiveShadow = !!Q.shadows;
          grp.add(mesh);
        }
      }
      // wrecking balls: a beam across the gantry posts, a chain and a heavy ball swinging under it
      if (this.pends.length) {
        const ballG = new T.SphereGeometry(BALL, 20, 14), chainG = new T.CylinderGeometry(0.09, 0.09, CHAIN, 6);
        const ballM = new T.MeshStandardMaterial({ color: 0x23252a, roughness: 0.35, metalness: 0.85, emissive: 0x200404 });
        this.geos.push(ballG, chainG); this.mats.push(ballM);
        for (const q of this.pends) {
          const g = new T.Group();
          g.matrixAutoUpdate = false;
          g.matrix.set(q.rx, 0, -q.tx, q.x + q.rx * q.lat, 0, 1, 0, PIV, q.rz, 0, -q.tz, q.z + q.rz * q.lat, 0, 0, 0, 1);
          const beam = new T.Mesh(box, mats.gantry); beam.scale.set(q.span * 2 + 0.8, 0.7, 0.7); beam.position.y = 0; g.add(beam);
          const arm = new T.Group(); g.add(arm);
          const chain = new T.Mesh(chainG, mats.gantry); chain.position.y = -CHAIN / 2; arm.add(chain);
          const ball = new T.Mesh(ballG, ballM); ball.position.y = -CHAIN; ball.castShadow = !!Q.shadows; arm.add(ball);
          q.arm = arm;
          grp.add(g);
        }
      }
      // laser gates: three red beams between the emitters, dark while the gate is off
      if (this.lasers.length) {
        const lm = new T.MeshBasicMaterial({ color: new T.Color(6, 0.25, 0.3), toneMapped: false });
        this.mats.push(lm);
        const im = (this.laserMesh = new T.InstancedMesh(box, lm, this.lasers.length * 3));
        im.instanceMatrix.setUsage(T.DynamicDrawUsage); im.frustumCulled = false;
        grp.add(im); this.inst.lasers = im;
        this.laserPose(true);
      }
      // pickups: repair kits (white box, red cross, green halo), N₂ canisters, gold stars
      const halo = new T.TorusGeometry(1, 0.06, 8, 32);
      this.geos.push(halo);
      const pk = {};
      const kitMat = new T.MeshStandardMaterial({ color: 0xffffff, emissive: 0x404040, roughness: 0.4 });
      const crossMat = new T.MeshBasicMaterial({ color: new T.Color(4, 0.4, 0.5), toneMapped: false });
      const ringMat = new T.MeshBasicMaterial({ color: new T.Color(0.6, 4, 1.2), toneMapped: false });
      const canMat = new T.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x2a9cff, emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.25 });
      const canRing = new T.MeshBasicMaterial({ color: new T.Color(0.5, 2.5, 5), toneMapped: false });
      const starMat = new T.MeshStandardMaterial({ color: 0xffd23a, emissive: 0xffa000, emissiveIntensity: 1.8, metalness: 0.5, roughness: 0.3 });
      const starRing = new T.MeshBasicMaterial({ color: new T.Color(4, 3, 0.5), toneMapped: false });
      const kb = new T.BoxGeometry(1, 1, 1), c1 = new T.BoxGeometry(1.04, 0.24, 0.7), c2 = new T.BoxGeometry(1.04, 0.7, 0.24);
      const cg = new T.CylinderGeometry(0.42, 0.42, 1.3, 16), capG = new T.CylinderGeometry(0.2, 0.42, 0.25, 16).translate(0, 0.77, 0), sg = new T.OctahedronGeometry(0.9, 0);
      this.mats.push(kitMat, crossMat, ringMat, canMat, canRing, starMat, starRing); this.geos.push(kb, c1, c2, cg, capG, sg);
      pk.kit = (g) => {
        g.add(new T.Mesh(kb, kitMat));
        const a = new T.Mesh(c1, crossMat), b = new T.Mesh(c2, crossMat), a2 = a.clone(), b2 = b.clone();
        a2.rotation.y = b2.rotation.y = Math.PI / 2;
        g.add(a, b, a2, b2);
        return ringMat;
      };
      pk.n2 = (g) => { g.add(new T.Mesh(cg, canMat), new T.Mesh(capG, canMat)); return canRing; };
      pk.star = (g) => { const st = new T.Mesh(sg, starMat); st.scale.set(0.8, 1.15, 0.35); g.add(st); return starRing; };
      for (const k of this.kits) {
        const g = new T.Group();
        const ring = new T.Mesh(halo, (pk[k.kind] || pk.kit)(g));
        ring.rotation.x = Math.PI / 2; ring.position.y = -0.4; g.add(ring);
        g.position.set(k.x, k.y, k.z);
        k.g = g; k.ring = ring;
        grp.add(g);
      }
    }
    ringColors() {
      const im = this.ringMesh, col = new T.Color();
      if (!im) return;
      this.rings.forEach((q, j) => im.setColorAt(j, q.on ? col.setRGB(3.2, 2.1, 0.35) : col.setRGB(0.12, 0.13, 0.16)));
      im.instanceColor.needsUpdate = true;
    }
    laserPose(force) {
      const im = this.laserMesh, m = _m;
      let changed = !!force;
      this.lasers.forEach((q, j) => {
        const cyc = q.on + q.off, lit = G.wrap(this.clock + q.ph, cyc) < q.on;
        if (lit === q.lit && !force) return;
        q.lit = lit; changed = true;
        for (let b = 0; b < 3; b++) {
          if (lit) this.poseBox(m, q, q.w, 0.07, 0.07, 0.35 + b * 0.55); else m.makeScale(0, 0, 0);
          im.setMatrixAt(j * 3 + b, m);
        }
      });
      if (changed) im.instanceMatrix.needsUpdate = true;
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

    // footprints for the editor's map: {it, s, lat, hl, hw, c} (c: what to draw)
    footprints() {
      const out = [];
      const f = (it, s, lat, hl, hw, c) => { if (it >= 0) out.push({ it, s, lat, hl, hw, c }); };
      for (const o of this.obs) f(o.it, o.s, o.lat, o.rot ? o.hw : o.hl, o.rot ? o.hw : o.hw, o.kind);
      for (const k of this.kickers) f(k.it, k.s, k.lat, k.len / 2, k.w / 2, 'kicker');
      for (const q of this.loops) f(q.it, q.s, q.lat + q.shift / 2, q.R, Math.abs(q.shift) / 2 + q.w / 2, 'loop');
      for (const q of this.bombs) f(q.it, q.s, q.lat, 1, 1, 'mine');
      for (const q of this.rings) f(q.it, q.s, q.lat, 0.4, q.r, 'ring');
      for (const q of this.kits) f(q.it, q.s, q.lat, 0.7, 0.7, q.kind);
      for (const q of this.pads) f(q.it, q.s, q.lat, q.hl, q.hw, q.kind);
      for (const q of this.pends) f(q.it, q.s, q.lat, 1.2, q.span, 'pendulum');
      for (const q of this.lasers) f(q.it, q.s, q.lat, 0.4, q.w / 2, 'laser');
      return out;
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
        if (d > -r - o.hl && d < r + o.hl) out.push(o);
      }
      return out;
    }

    collide(b) {
      if (b === this.game.player) { this.enterLoops(b); this.hitBombs(b); }
      this.padsStep(b);
      this.hitBalls(b);
      const fwd = _a.set(0, 0, -1).applyQuaternion(b.q); fwd.y = 0;
      if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
      fwd.normalize();
      const pfx = fwd.x, pfz = fwd.z, prx = -pfz, prz = pfx;
      const list = this.gather(b, b === this.game.player ? this.near : (b._cnear = b._cnear || []), 14);
      for (const o of list) {
        if (!o.alive) continue;
        if (b.pos.y + 0.18 > o.h - (o.climb || 0.25)) continue; // riding over it (or on its roof)
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
        const vel = b.vel;
        // a moving obstacle shoves the car: work with the speed relative to it
        const ovx = o.vx || 0, ovz = o.vz || 0, vrel = (vel.x - ovx) * nx + (vel.z - ovz) * nz;
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

    // pads act once as you roll onto them (oil for as long as you're on it)
    padsStep(b) {
      b.gripMul = 1;
      let on = null;
      if (this.pads.length && b.pos.y < 0.9) {
        for (const q of this.pads) {
          const dx = b.pos.x - q.x, dz = b.pos.z - q.z;
          if (dx * dx + dz * dz > 600) continue;
          if (Math.abs(dx * q.tx + dz * q.tz) > q.hl || Math.abs(dx * q.rx + dz * q.rz) > q.hw) continue;
          on = q;
          if (q.kind === 'oil') b.gripMul = 0.2;
          if (b._pad === q) continue;
          const v = b.vel;
          if (q.kind === 'boost') {
            v.x += q.tx * q.pow; v.z += q.tz * q.pow;
            const sp = Math.hypot(v.x, v.z);
            if (sp > 105) { v.x *= 105 / sp; v.z *= 105 / sp; }
          } else if (q.kind === 'bounce') { v.y = Math.max(v.y, q.pow); b.pos.y += 0.05; }
          this.game.onPad(b, q);
        }
      }
      b._pad = on;
    }
    // wrecking balls: a sphere that knocks the car away with its own swing
    hitBalls(b) {
      if (!this.pends.length) return;
      const cy = b.pos.y + 0.6, rr = BALL + 1.25;
      for (const q of this.pends) {
        const dx = b.pos.x - q.bx, dy = cy - q.by, dz = b.pos.z - q.bz, d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > rr * rr) continue;
        const d = Math.sqrt(d2) || 1, nx = dx / d, ny = dy / d, nz = dz / d;
        b.pos.x += nx * (rr - d); b.pos.y += Math.max(0, ny * (rr - d)); b.pos.z += nz * (rr - d);
        const vrel = (b.vel.x - q.vx) * nx + (b.vel.y - q.vy) * ny + (b.vel.z - q.vz) * nz;
        if (vrel >= 0) continue;
        b.vel.x -= nx * vrel * 1.5; b.vel.y -= ny * vrel * 0.6; b.vel.z -= nz * vrel * 1.5;
        b.w.y += (Math.random() - 0.5) * Math.abs(vrel) * 0.08; b.w.z += (Math.random() - 0.5) * Math.abs(vrel) * 0.05;
        this.game.onObstacleHit(b, q, -vrel, q.bx + nx * BALL, q.by + ny * BALL, q.bz + nz * BALL);
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
        const d = k.dir || 1, h = k.h * (d * along + k.len / 2) / k.len;
        if (h > out.h && h <= yRef + 0.6) {
          const inv = 1 / Math.sqrt(1 + k.k * k.k);
          out.h = h; out.nx = -d * k.k * k.tx * inv; out.ny = inv; out.nz = -d * k.k * k.tz * inv;
        }
      }
      for (const o of this.near) {
        if (!o.alive || o.h <= out.h || o.h > yRef + (o.climb || 0.05)) continue;
        const dx = x - o.x, dz = z - o.z;
        if (Math.abs(dx * o.tx + dz * o.tz) < o.hl && Math.abs(dx * o.rx + dz * o.rz) < o.hw) {
          out.h = o.h; out.nx = 0; out.ny = 1; out.nz = 0; out.vx = o.vx || 0; out.vy = 0; out.vz = o.vz || 0;
        }
      }
      return out;
    }

    // a spot to drop the car after a reset: step forward until nothing solid is near this lane
    freeSpot(s, lat) {
      for (let k = 0; k < 20; k++) {
        const hit = this.loops.some((q) => Math.abs(G.wrap(q.s - s + 20, this.L) - 20) < q.R + 6 && Math.abs(q.lat + q.shift / 2 - lat) < Math.abs(q.shift) / 2 + q.w / 2 + 1.5) || this.obs.some((o) => o.alive && Math.abs(G.wrap(o.s - s + 20, this.L) - 20) < Math.max(o.hl, o.rot ? o.hw : 0) + 6 && Math.abs(o.lat - lat) < Math.max(o.hw, o.rot ? o.hw : 0) + 2 + (o.mv ? o.mv.amp : 0)) ||
          this.kickers.some((q) => Math.abs(G.wrap(q.s - s + 20, this.L) - 20) < q.len / 2 + 4 && Math.abs(q.lat - lat) < q.w / 2 + 1.5) ||
          this.pends.some((q) => Math.abs(G.wrap(q.s - s + 20, this.L) - 20) < 6 && Math.abs(q.lat - lat) < q.span);
        if (!hit) return s;
        s += 6;
      }
      return s;
    }

    reset() {
      for (const o of this.obs) if (o.k.breakable) { o.alive = true; o.fly = null; }
      for (const k of this.kits) { k.active = true; k.g.visible = true; }
      for (const m of this.bombs) { m.alive = true; m.t = 0; }
      for (const q of this.rings) { q.on = true; q.t = 0; }
      this.chain = { set: -1, k: -1, n: 0 };
      this.ringColors();
      this.clock = 0;
      this.dirty = true; this.lastS = null; this.roofDone = new Set();
    }

    // ---------- per frame ----------
    // moving hazards run on the course clock (it restarts with every run, so they're always in the same place)
    moveHazards(dt) {
      this.clock += dt;
      const t = this.clock, m = _m;
      for (const o of this.movers) {
        if (o.mv) {
          const v = o.mv, w = (Math.PI * 2) / v.per, lat = v.lat0 + v.amp * Math.sin(w * t + v.ph), ls = v.amp * w * Math.cos(w * t + v.ph);
          o.lat = lat; o.x = v.cx + o.rx * lat; o.z = v.cz + o.rz * lat; o.vx = o.rx * ls; o.vz = o.rz * ls;
        } else {
          const r = o.rot, a = r.spd * t + r.ph, c = Math.cos(a), s = Math.sin(a);
          o.tx = c * r.tx + s * r.rx; o.tz = c * r.tz + s * r.rz; o.rx = c * r.rx - s * r.tx; o.rz = c * r.rz - s * r.tz;
        }
        this.pose(o, m); o.inst.setMatrixAt(o.ii, m); o.inst.instanceMatrix.needsUpdate = true;
      }
      for (const q of this.pends) {
        const w = (Math.PI * 2) / q.per, th = q.amax * Math.sin(w * t + q.ph), om = q.amax * w * Math.cos(w * t + q.ph);
        const lat = q.lat + CHAIN * Math.sin(th), vl = CHAIN * Math.cos(th) * om;
        q.th = th;
        q.bx = q.x + q.rx * lat; q.bz = q.z + q.rz * lat; q.by = PIV - CHAIN * Math.cos(th);
        q.vx = q.rx * vl; q.vz = q.rz * vl; q.vy = CHAIN * Math.sin(th) * om;
        if (q.arm) q.arm.rotation.z = th;
      }
      if (this.laserMesh) this.laserPose(false);
    }

    update(dt, live) {
      const g = this.game, p = g.player, L = this.L;
      this.moveHazards(dt);
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

      // flying crates and cones
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
      if (this.dirty) {
        for (const kind of ['crate', 'cone']) {
          const im = this.inst[kind];
          if (!im) continue;
          for (const o of this.obs) if (o.kind === kind) { this.pose(o, m); im.setMatrixAt(o.ii, m); }
          im.instanceMatrix.needsUpdate = true;
        }
        this.dirty = false;
      }

      // rings light back up a while after being flown through
      let relit = false;
      for (const q of this.rings) if (!q.on && (q.t -= dt) <= 0) { q.on = true; relit = true; }
      if (relit) this.ringColors();

      // pickups: repair kits, N₂ canisters (both come back after a while) and stars (once per run)
      for (const k of this.kits) {
        if (!k.active) { k.t -= dt; if (k.t <= 0) { k.active = true; k.g.visible = true; } continue; }
        k.g.rotation.y += dt * (k.kind === 'star' ? 2.4 : 1.6);
        k.g.position.y = k.y + Math.sin(g.t * 3 + k.x) * 0.2;
        k.ring.scale.setScalar(1 + 0.1 * Math.sin(g.t * 6));
        const dx = p.pos.x - k.x, dy = p.pos.y + 0.6 - k.g.position.y, dz = p.pos.z - k.z;
        if (live && dx * dx + dy * dy + dz * dz < 10) {
          k.active = false; k.g.visible = false;
          if (k.kind === 'n2') { k.t = 14; g.onCanister(); }
          else if (k.kind === 'star') { k.t = 1e9; g.onStar(); }
          else { k.t = 40; g.repair(30); }
        }
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
          const cy = p.pos.y + 0.55;
          for (const q of this.rings) if (q.on && crossed(q) && Math.hypot(p.near.lat - q.lat, cy - q.y) < q.r - 0.35) {
            q.on = false; q.t = 30;
            // a chain counts rings of one set taken in order without missing one
            const ch = this.chain;
            if (ch.set === q.set && ch.k === q.k - 1) ch.n++; else ch.n = 1;
            ch.set = q.set; ch.k = q.k;
            this.ringColors();
            g.onRing(q, ch.n, q.n > 1 && ch.n === q.n);
          }
          for (const q of this.goals) if (crossed(q) && !p.grounded && cy > q.bar) {
            const off = p.near.lat - q.lat;
            if (Math.abs(off) < q.half - 0.3 && cy < q.top + 4) g.onFieldGoal(q, cy - q.bar);
            else if (Math.abs(off) < q.half + 8) g.onFieldGoalMiss(off > 0 ? 'RIGHT' : 'LEFT');
          }
          for (const q of this.lasers) if (crossed(q) && Math.abs(p.near.lat - q.lat) < q.w / 2 + 0.5) g.onLaser(q, q.lit && p.pos.y < 1.9);
        }
      }
      this.lastS = s;
      if (live && p.grounded) {
        for (const o of this.near) if (o.roof != null && !this.roofDone.has(o.roof) && p.pos.y > o.h - 0.3) {
          const dx = p.pos.x - o.x, dz = p.pos.z - o.z;
          if (Math.abs(dx * o.tx + dz * o.tz) < o.hl + 0.5 && Math.abs(dx * o.rx + dz * o.rz) < o.hw + 0.5) { this.roofDone.add(o.roof); g.onRooftop(o.roofName); break; }
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

  const clone = (x) => JSON.parse(JSON.stringify(x));
  // the seeded generator's course as an item list (cached per circuit; callers get their own copy)
  G.bakeCourse = function (def, track) {
    const cache = (track._baked = track._baked || {}), key = def.seed + ':' + G.TRACK_ID + ':' + def.pieces.join(',');
    if (!cache[key]) {
      const c = Object.create(Course.prototype);
      c.track = track; c.def = def;
      c.init();
      c.rand = G.rng(def.seed * 9973 + (G.TRACK_ID === 'highway' ? 1 : 0));
      cache[key] = c.layout();
    }
    return clone(cache[key]);
  };
  // the official course on this circuit: the admin's edited version when there is one, else the built-in layout
  G.officialCourse = function (track) {
    const o = G.store.get('official_' + G.TRACK_ID, null);
    const items = o && Array.isArray(o.items) ? clone(o.items) : G.bakeCourse(G.COURSES.street, track);
    return { id: 'street', name: G.COURSES.street.name, official: true, track: G.TRACK_ID, items, edited: !!(o && o.items) };
  };
  G.courseKind = KIND;
})();
