// net.js — online multiplayer over WebRTC data channels (PeerJS for the handshake only), plus the remote cars.
// Star topology: the host's peer id is derived from a short room code; every client connects to the host, which
// relays each car's state to the others. Each phone simulates only its own car and sends ~20 snapshots a second;
// remote cars are drawn ~110 ms in the past, interpolated between the two snapshots around that moment.
(function () {
  const T = THREE;
  const PEERJS = ['https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js', 'https://cdnjs.cloudflare.com/ajax/libs/peerjs/1.5.4/peerjs.min.js'];
  const ID_PREFIX = 'roadster-thruster-v1-';
  const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
  const MAX_PLAYERS = 6;
  const SEND_HZ = 20;
  const DELAY = 110; // ms of interpolation buffer
  const STALE = 4000; // ms without a packet before a car fades out
  G.MP_COLORS = [0x1d8cff, 0xf2b705, 0x16c47f, 0xff4fd8, 0xff7a1a, 0x00d4e0]; // by join order: host, then clients
  const AI_ID = 100; // host-run AI rivals travel as remote cars with ids 100, 101, ...

  let peerLib = null;
  function loadPeer() {
    if (window.Peer) return Promise.resolve();
    if (peerLib) return peerLib;
    const tryUrl = (i) => new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = PEERJS[i]; s.onload = res;
      s.onerror = () => { s.remove(); i + 1 < PEERJS.length ? tryUrl(i + 1).then(res, rej) : rej(new Error('could not load the networking library')); };
      document.head.appendChild(s);
    });
    return (peerLib = tryUrl(0).catch((e) => { peerLib = null; throw e; }));
  }
  const newCode = () => [...Array(4)].map(() => CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]).join('');
  const cleanName = (n) => String(n || '').replace(/[^\w \-.!?]/g, '').trim().slice(0, 12).toUpperCase() || 'PLAYER';
  const r3 = (v) => Math.round(v * 1000) / 1000;
  const r1 = (v) => Math.round(v * 10) / 10, r2 = (v) => Math.round(v * 100) / 100;
  // one car's snapshot (players and host-run rivals alike)
  function pack(body, progress, finishTime) {
    const p = body.pos, q = body.q, v = body.vel, th = body.th;
    return {
      p: [r3(p.x), r3(p.y), r3(p.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], v: [r3(v.x), r3(v.y), r3(v.z)],
      th: [r3(th.L), r3(th.R), r3(th.B), r3(th.SL), r3(th.SR)], s: r1(progress),
      br: body.braking ? 1 : 0, sp: r1(body.fwdSpeed), f: finishTime || 0,
    };
  }

  // ---------------- room / transport ----------------
  // ev callbacks (all optional): roster(players), start(msg), state(id, msg), left(id, name), lost(text), status(text)
  class Net {
    constructor(ev) {
      this.ev = ev || {};
      this.peer = null; this.isHost = false; this.myId = -1; this.code = '';
      this.conns = new Map(); // host: id -> conn
      this.conn = null; // client: conn to host
      this.players = []; // [{ id, name, color }]
      this.rtt = 0; this.track = ''; this.race = 0;
      this.nextId = 1; this._sendAcc = 0; this._pingT = null;
      this._unload = () => this.leave();
      window.addEventListener('pagehide', this._unload);
    }
    get open() { return this.isHost ? !!this.peer && !this.peer.destroyed : !!this.conn && this.conn.open; }
    me() { return this.players.find((p) => p.id === this.myId); }
    emit(name, ...a) { if (this.ev[name]) this.ev[name](...a); }

    async host(name, track) {
      await loadPeer();
      this.isHost = true; this.myId = 0; this.track = track;
      for (let tries = 0; tries < 4; tries++) {
        const code = newCode();
        try { await this._openPeer(ID_PREFIX + code); this.code = code; break; }
        catch (e) { if (e.type !== 'unavailable-id' || tries === 3) throw e; }
      }
      this.players = [{ id: 0, name: cleanName(name), color: G.MP_COLORS[0] }];
      this.peer.on('connection', (c) => this._accept(c));
      // clients ping every 2 s: one that has been silent for 9 s is gone even if no close event ever came
      this._pingT = setInterval(() => { for (const [, c] of this.conns) if (performance.now() - c._rx > 9000) c._drop(); }, 2000);
      this.emit('roster', this.players);
      return this.code;
    }

    async join(code, name) {
      await loadPeer();
      code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      if (code.length !== 4) throw new Error('Room codes are 4 characters');
      this.isHost = false; this.code = code;
      await this._openPeer();
      const conn = (this.conn = this.peer.connect(ID_PREFIX + code, { serialization: 'json', reliable: true }));
      await new Promise((res, rej) => {
        const to = setTimeout(() => rej(new Error('No answer from room ' + code)), 12000);
        this._joinFail = (e) => { clearTimeout(to); rej(e); };
        conn.on('open', () => { conn.send({ t: 'hello', name: cleanName(name), v: 1 }); });
        conn.on('data', (m) => {
          this._rx = performance.now();
          if (m.t === 'welcome') { clearTimeout(to); this.myId = m.id; this.track = m.track; res(); }
          else if (m.t === 'full') { clearTimeout(to); rej(new Error('Room ' + code + ' is full')); }
          this._onClientMsg(m);
        });
        conn.on('close', () => { clearTimeout(to); if (this.myId < 0) rej(new Error('Connection closed')); else this._hostGone('Host left the room'); });
        conn.on('error', (e) => console.warn('[net] conn', e));
      });
      this._joinFail = null;
      this._pingT = setInterval(() => {
        if (this.conn && this.conn.open) this.conn.send({ t: 'ping', c: performance.now() });
        if (performance.now() - this._rx > 9000) this._hostGone('Lost the connection to the host');
      }, 2000);
    }

    _openPeer(id) {
      return new Promise((res, rej) => {
        const peer = (this.peer = id ? new window.Peer(id, { debug: 1 }) : new window.Peer({ debug: 1 }));
        let opened = false;
        peer.on('open', () => { opened = true; res(); });
        peer.on('error', (e) => {
          console.warn('[net]', e.type, e.message);
          const text = e.type === 'peer-unavailable' ? 'Room not found' : e.type === 'network' || e.type === 'server-error' || e.type === 'socket-error'
            ? 'Cannot reach the matchmaking server' : e.type === 'browser-incompatible' ? 'This browser has no WebRTC' : e.message;
          const err = Object.assign(new Error(text), { type: e.type });
          if (!opened) { peer.destroy(); rej(err); } else if (this._joinFail) this._joinFail(err);
        });
        // the broker connection is only needed to set up new connections: races keep going without it
        peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.disconnected && peer.reconnect(), 2000); });
      });
    }

    // host: a new phone wants in
    _accept(conn) {
      let id = -1;
      conn._rx = performance.now();
      conn.on('data', (m) => {
        conn._rx = performance.now();
        if (m.t === 'hello' && id < 0) {
          if (this.players.length >= MAX_PLAYERS) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 300); return; }
          id = this.nextId++;
          const used = this.players.map((p) => p.color);
          const color = G.MP_COLORS.find((c) => !used.includes(c)) || G.MP_COLORS[id % G.MP_COLORS.length];
          let name = cleanName(m.name);
          for (let k = 2; this.players.some((p) => p.name === name); k++) name = cleanName(m.name).slice(0, 10) + k;
          this.players.push({ id, name, color });
          this.conns.set(id, conn);
          conn.send({ t: 'welcome', id, track: this.track, code: this.code });
          this._sendRoster();
          return;
        }
        if (id < 0) return;
        if (m.t === 'ping') { conn.send({ t: 'pong', c: m.c }); return; }
        if (m.t === 'bye') { conn._drop(); return; }
        if (m.t === 'st') { m.id = id; this.emit('state', id, m); this.broadcast(m, id); }
        else if (m.t === 'tk') this.emit('world', m, id);
      });
      const drop = () => {
        if (id < 0 || !this.conns.has(id)) return;
        this.conns.delete(id);
        const p = this.players.find((q) => q.id === id);
        this.players = this.players.filter((q) => q.id !== id);
        this.broadcast({ t: 'left', id });
        this._sendRoster();
        this.emit('left', id, p ? p.name : '');
      };
      conn._drop = () => { drop(); try { conn.close(); } catch (e) { /* ignore */ } };
      conn.on('close', drop);
      conn.on('error', drop);
      // ICE can die without a close event (phone locked, Wi-Fi lost): watch the underlying channel too
      conn.on('iceStateChanged', (s) => { if (s === 'failed' || s === 'closed') drop(); });
    }

    _onClientMsg(m) {
      if (m.t === 'roster') { this.players = m.players; this.emit('roster', this.players); }
      else if (m.t === 'pong') { const rtt = performance.now() - m.c; this.rtt = this.rtt ? this.rtt * 0.7 + rtt * 0.3 : rtt; }
      else if (m.t === 'start') { this.race = m.race; this.emit('start', m); }
      else if (m.t === 'st') this.emit('state', m.id, m);
      else if (m.t === 'ai') for (const e of m.a) { e.r = m.r; e.ts = m.ts; this.emit('state', e.id, e); }
      else if (m.t === 'tf' || m.t === 'tl') this.emit('world', m);
      else if (m.t === 'bye') this._hostGone('Host left the room');
      else if (m.t === 'left') { const p = this.players.find((q) => q.id === m.id); this.emit('left', m.id, p ? p.name : ''); }
    }

    _hostGone(text) {
      if (this._gone) return;
      this._gone = true;
      clearInterval(this._pingT);
      this.emit('lost', text);
    }

    _sendRoster() { const m = { t: 'roster', players: this.players }; this.broadcast(m); this.emit('roster', this.players); }

    broadcast(m, except) { for (const [id, c] of this.conns) if (id !== except && c.open) c.send(m); }
    send(m) { if (this.isHost) this.broadcast(m); else if (this.conn && this.conn.open) this.conn.send(m); }

    // host only: everyone onto the grid. The countdown is sent as "GO in n seconds"; clients take off half a ping.
    // opts.traffic: density level or 'off' (every phone builds the same traffic from one seed); opts.ai: rivals the
    // host drives, gridded behind the players
    startRace(laps, opts = {}) {
      this.race++;
      const names = G.RIVAL_NAMES, cols = G.RIVAL_COLORS;
      const ai = [...Array(opts.ai || 0)].map((_, i) => ({ id: AI_ID + i, name: names[i % names.length], color: cols[i % cols.length], ai: true }));
      const m = {
        t: 'start', race: this.race, laps, track: this.track, grid: this.players.map((p) => p.id), cd: 3.999,
        traffic: opts.traffic || 'off', seed: (Math.random() * 2 ** 31) | 0, ai,
      };
      this.broadcast(m);
      return m;
    }

    // ~20 Hz state upload, called every frame while racing. lag = how far the physics trails the clock (the
    // unspent part of the fixed-step accumulator): the snapshot is stamped with the moment it really describes
    tick(dt, body, progress, finishTime, lag = 0) {
      this._sendAcc += dt;
      if (this._sendAcc < 1 / SEND_HZ) return;
      this._sendAcc %= 1 / SEND_HZ;
      this.send(Object.assign(pack(body, progress, finishTime), { t: 'st', id: this.myId, r: this.race, ts: performance.now() - lag * 1000 }));
    }

    leave() {
      window.removeEventListener('pagehide', this._unload);
      clearInterval(this._pingT);
      this._gone = true;
      // say goodbye first: a closed data channel can take a while to be noticed on the other side
      try { this.send({ t: 'bye' }); } catch (e) { /* ignore */ }
      try { if (this.conn) this.conn.close(); for (const c of this.conns.values()) c.close(); } catch (e) { /* ignore */ }
      try { if (this.peer) this.peer.destroy(); } catch (e) { /* ignore */ }
      this.conns.clear(); this.conn = null; this.peer = null;
    }
  }

  // ---------------- remote cars ----------------
  const _qa = new T.Quaternion(), _qb = new T.Quaternion();
  function nameTag(text, color) {
    const tex = G.canvasTexture(256, 64, (ctx, w, h) => {
      ctx.font = '700 34px Orbitron, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.strokeText(text, w / 2, h / 2);
      ctx.fillStyle = '#' + color.toString(16).padStart(6, '0'); ctx.fillText(text, w / 2, h / 2);
    });
    const sp = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false }));
    sp.scale.set(3.2, 0.8, 1); sp.position.y = 2.4;
    return sp;
  }

  class Remote {
    constructor(game, info) {
      this.game = game; this.id = info.id; this.name = info.name; this.color = info.color;
      this.model = G.buildRoadster(info.color, { shadows: game.Q.shadows && game.Q.level >= 3 });
      this.b = new G.Player(game, this.model); // only for its model sync / wheel visuals: never stepped
      this.pos = this.b.pos; this.th = this.b.th;
      this.tag = nameTag(this.name, info.color);
      this.model.group.add(this.tag);
      this.model.group.visible = false;
      game.scene.add(this.model.group);
      this.buf = []; this.off = null; this.lastRx = 0;
      this.s = -1e9; this.v = 0; this.fin = 0;
      this.alpha = 0; this.gone = false; this.seen = false;
      this.vel = new T.Vector3();
    }

    push(m, now) {
      const lt = now - m.ts; // = clock offset + one-way latency; the smallest sample is the best estimate
      if (this.off === null || lt < this.off) this.off = lt; else this.off += (lt - this.off) * 0.01;
      const last = this.buf[this.buf.length - 1];
      if (last && m.ts <= last.ts) return;
      this.buf.push(m);
      if (this.buf.length > 40) this.buf.shift();
      this.s = m.s; this.v = Math.max(0, m.sp); this.lastRx = now;
      if (m.f && !this.fin) this.fin = m.f;
      this.seen = true;
    }

    update(dt, now, t) {
      const b = this.b, buf = this.buf;
      const live = !this.gone && this.seen && now - this.lastRx < STALE;
      this.alpha = G.clamp(this.alpha + (live ? dt * 3 : -dt * 1.2), 0, 1);
      this.setAlpha(this.alpha);
      if (!buf.length) return;
      const rt = now - this.off - DELAY;
      let a = buf[0], c = null;
      for (let i = buf.length - 1; i >= 0; i--) if (buf[i].ts <= rt) { a = buf[i]; c = buf[i + 1] || null; break; }
      if (c) {
        const k = G.clamp((rt - a.ts) / Math.max(1, c.ts - a.ts), 0, 1);
        b.pos.set(G.lerp(a.p[0], c.p[0], k), G.lerp(a.p[1], c.p[1], k), G.lerp(a.p[2], c.p[2], k));
        b.q.copy(_qa.set(a.q[0], a.q[1], a.q[2], a.q[3]).normalize()).slerp(_qb.set(c.q[0], c.q[1], c.q[2], c.q[3]).normalize(), k);
        this.vel.set(G.lerp(a.v[0], c.v[0], k), G.lerp(a.v[1], c.v[1], k), G.lerp(a.v[2], c.v[2], k));
        const th = b.th;
        th.L = G.lerp(a.th[0], c.th[0], k); th.R = G.lerp(a.th[1], c.th[1], k); th.B = G.lerp(a.th[2], c.th[2], k);
        th.SL = G.lerp(a.th[3], c.th[3], k); th.SR = G.lerp(a.th[4], c.th[4], k);
      } else {
        // past the newest snapshot (late packet): coast on its velocity for a moment
        const e = G.clamp((rt - a.ts) / 1000, 0, 0.25);
        b.pos.set(a.p[0] + a.v[0] * e, a.p[1] + a.v[1] * e, a.p[2] + a.v[2] * e);
        b.q.set(a.q[0], a.q[1], a.q[2], a.q[3]).normalize();
        this.vel.set(a.v[0], a.v[1], a.v[2]);
        const th = b.th; th.L = a.th[0]; th.R = a.th[1]; th.B = a.th[2]; th.SL = a.th[3]; th.SR = a.th[4];
      }
      b.braking = !!a.br;
      b.vel.copy(this.vel);
      const sp = a.sp || 0;
      for (const w of b.wheels) { w.spin += sp * dt / 0.36; }
      b.syncModel();
      G.updateRoadsterFX(this.model, b.th, t, b.braking);
      const fx = this.game.fx, g = this.model.group;
      if (fx && this.alpha > 0.5) {
        g.updateMatrixWorld();
        if (b.th.L > 0.1 || b.th.R > 0.1) fx.steamUnder(g, b.th.L, b.th.R, 0, dt, this.vel);
        if (b.th.B > 0.1) fx.steamRear(g, b.th.B, dt, this.vel);
      }
    }

    // fade in / out: the car's own materials go transparent only while fading
    setAlpha(a) {
      const g = this.model.group;
      g.visible = a > 0.01;
      if (a === this._a) return;
      this._a = a;
      if (!this._mats) {
        this._mats = [];
        const own = (m) => {
          if (!m || m.isShaderMaterial) return m;
          const c = m.clone();
          this._mats.push({ m: c, op: m.opacity, tr: m.transparent });
          return c;
        };
        g.traverse((o) => { if (o.isMesh && o.material) o.material = Array.isArray(o.material) ? o.material.map(own) : own(o.material); });
      }
      for (const e of this._mats) { e.m.transparent = a < 1 || e.tr; e.m.opacity = e.op * a; e.m.depthWrite = a > 0.6; }
      this.tag.material.opacity = a;
    }

    dispose() { this.game.scene.remove(this.model.group); }
  }

  class Remotes {
    constructor(game) { this.game = game; this.map = new Map(); this.list = []; }
    ensure(info) {
      let r = this.map.get(info.id);
      if (!r) { r = new Remote(this.game, info); this.map.set(info.id, r); this.list.push(r); }
      return r;
    }
    get(id) { return this.map.get(id); }
    onState(id, m, info) {
      if (!info) return;
      this.ensure(info).push(m, performance.now());
    }
    markGone(id) { const r = this.map.get(id); if (r) r.gone = true; }
    update(dt, t) {
      const now = performance.now();
      for (const r of this.list) r.update(dt, now, t);
    }
    dispose() { for (const r of this.list) r.dispose(); this.map.clear(); this.list = []; }
  }

  // ---------------- shared world: host-run AI rivals and traffic ----------------
  // Every phone builds the same traffic (same count, models, colours, start spots) by running the constructor on one
  // seeded random stream. Each phone keeps simulating it, so it moves smoothly and you can hit it, while the host's
  // copy is the truth: 5 times a second for cars in their lanes, 15 for knocked-loose wrecks. A wreck a client knocks
  // loose is that client's for a moment: it streams the car to the host, which takes it over and passes it on.
  function seeded(seed, fn) {
    const rnd = Math.random;
    let a = seed >>> 0;
    Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    try { return fn(); } finally { Math.random = rnd; }
  }
  const FULL_HZ = 5, LOOSE_HZ = 15, OWN_MS = 1500;
  const looseOf = (c) => [c.id, c.dir, r2(c.x), r2(c.y), r2(c.z), r2(c.lvx), r2(c.lvy), r2(c.lvz), r3(c.yaw), r3(c.roll), r3(c.pitch), r2(c.yawV), r2(c.rollV), r2(c.pitchV), r2(c.timer)];

  class World {
    constructor(game, net, race) {
      this.game = game; this.net = net; this.race = race; this.host = net.isHost;
      this.tf = 0; this.tl = 0; this.ai = 0; this.tk = 0;
      const n = game.traffic ? game.traffic.cars.length : 0;
      this.prevLoose = new Uint8Array(n); this.prevTimer = new Float32Array(n); this.own = new Float64Array(n);
      // on the host the rivals are local cars: give them the same name tags the clients see
      if (this.host && game.rivals) for (const r of game.rivals.list) r.model.group.add(nameTag(r.name, r.color));
    }

    update(dt, lag) {
      const g = this.game, net = this.net, now = performance.now();
      if (!net.open) return;
      if (this.host) {
        const rv = g.rivals;
        // the host's pause menu must not stop everyone else's rivals and traffic
        if (g.state === 'paused' && g.prevState !== 'countdown') {
          this.pacc = (this.pacc || 0) + dt;
          for (let k = 0; this.pacc >= 1 / 120 && k < 8; k++) { this.pacc -= 1 / 120; if (rv) rv.step(1 / 120); }
          if (rv) rv.update(dt, true, g.player, g.progress);
          if (g.traffic) g.traffic.update(dt, g.player, g.player.near.s);
        }
        if (rv) {
          // rivals keep finishing after the host has (the host's own lap logic stops at its flag)
          const L = g.track.length;
          let fin = false;
          if (g.goAt && g.state !== 'countdown') for (const r of rv.list) if (!r.finished && r.s >= g.laps * L) { r.finished = true; r.finishTime = (now - g.goAt) / 1000; fin = true; }
          if (fin && g.finished) g.mpResults();
          if ((this.ai += dt) >= 1 / SEND_HZ) {
            this.ai %= 1 / SEND_HZ;
            net.broadcast({ t: 'ai', r: this.race, ts: now - lag * 1000, a: rv.list.map((r) => Object.assign(pack(r.b, r.s, r.finished ? r.finishTime : 0), { id: AI_ID + r.i })) });
          }
        }
        const tr = g.traffic;
        if (tr) {
          if ((this.tf += dt) >= 1 / FULL_HZ) {
            this.tf %= 1 / FULL_HZ;
            const a = [];
            for (const c of tr.cars) if (c.loose) a.push(0, 0, 0, -1, 0); else a.push(r1(c.s), r2(c.lat), r1(c.v), c.lane, r1(c.vT));
            net.broadcast({ t: 'tf', r: this.race, a, l: tr.cars.filter((c) => c.loose).map(looseOf), x: g.xings.clock });
          } else if ((this.tl += dt) >= 1 / LOOSE_HZ) {
            this.tl %= 1 / LOOSE_HZ;
            const l = tr.cars.filter((c) => c.loose).map(looseOf);
            if (l.length) net.broadcast({ t: 'tl', r: this.race, l });
          }
        }
        return;
      }
      // client: a car that went loose (or took a fresh hit) here, not by the host's word, was knocked by us
      const tr = g.traffic;
      if (!tr) return;
      const own = [];
      for (const c of tr.cars) {
        const i = c.id;
        if (c.loose && (!this.prevLoose[i] || c.timer < this.prevTimer[i] - 1e-4)) this.own[i] = now + OWN_MS;
        this.prevLoose[i] = c.loose ? 1 : 0; this.prevTimer[i] = c.timer;
        if (c.loose && this.own[i] > now) own.push(c);
      }
      if ((this.tk += dt) >= 1 / LOOSE_HZ && own.length) { this.tk = 0; net.send({ t: 'tk', r: this.race, l: own.map(looseOf) }); }
    }

    onMsg(m, from) {
      const tr = this.game.traffic;
      if (!tr || m.r !== this.race) return;
      const now = performance.now();
      if (m.t === 'tk') { if (this.host) for (const e of m.l) this.applyLoose(tr, e, 0); return; }
      const lat = this.net.rtt / 2000; // how old the host's numbers are by now
      if (m.t === 'tf') {
        if (m.x != null) this.game.xings.clock = m.x + lat; // everyone's lights change together
        const a = m.a, n = Math.min(tr.cars.length, a.length / 5);
        for (let i = 0; i < n; i++) {
          if (a[i * 5 + 3] < 0 || this.own[i] > now) continue;
          this.applyLane(tr, tr.cars[i], a[i * 5], a[i * 5 + 1], a[i * 5 + 2], a[i * 5 + 3], a[i * 5 + 4], lat);
        }
      }
      for (const e of m.l) if (!(this.own[e[0]] > now)) this.applyLoose(tr, e, lat);
    }

    applyLane(tr, c, s, latp, v, lane, vT, e) {
      const L = tr.track.length;
      if (c.loose) { c.loose = false; c.roll = c.pitch = c.rollV = c.pitchV = c.yawV = 0; c.lastAlong = NaN; c.latV = 0; }
      c.lane = lane; c.dir = lane < G.LANES_FWD.length ? 1 : -1; c.latT = tr.laneLat(lane); c.vT = vT; c.v = v;
      const st = G.wrap(s + v * c.dir * e, L);
      let d = G.wrap(st - c.s, L);
      if (d > L / 2) d -= L;
      // small drift is eased out, a big one (a respawn, a lane change we missed) snaps
      c.s = Math.abs(d) > 8 ? st : G.wrap(c.s + d * 0.5, L);
      c.lat = Math.abs(latp - c.lat) > 2 ? latp : c.lat + (latp - c.lat) * 0.5;
      tr.place(c);
      this.prevLoose[c.id] = 0; this.prevTimer[c.id] = c.timer;
    }

    applyLoose(tr, e, lat) {
      const c = tr.cars[e[0]];
      if (!c) return;
      c.loose = true; c.dir = e[1];
      c.lvx = e[5]; c.lvy = e[6]; c.lvz = e[7];
      c.x = e[2] + c.lvx * lat; c.y = e[3]; c.z = e[4] + c.lvz * lat;
      c.yaw = e[8]; c.roll = e[9]; c.pitch = e[10]; c.yawV = e[11]; c.rollV = e[12]; c.pitchV = e[13]; c.timer = e[14];
      c.hx = -Math.sin(c.yaw); c.hz = -Math.cos(c.yaw);
      this.prevLoose[c.id] = 1; this.prevTimer[c.id] = c.timer;
    }
  }

  G.Net = Net;
  G.Remotes = Remotes;
  G.MP_MAX = MAX_PLAYERS;
  G.MPWorld = World;
  G.mpSeeded = seeded;
  G.MP_AI_ID = AI_ID;
})();
