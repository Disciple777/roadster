// sandbox.js — the physics sandbox (index.html?sandbox). A free ride with traffic and ramps, and a panel with every
// number in tuning.js on a slider: change one and the car (and the traffic) feel it at once. Drop tests, slow motion and
// a landing graph help judge bounce; COPY SETTINGS gives back only what changed, ready to paste into a chat.
// The sandbox's values are kept in localStorage and only ever applied here: the real game always uses tuning.js.
(function () {
  if (!/[?&]sandbox\b/.test(location.search)) return;
  const TU = G.TUNING, DEF = Object.assign({}, TU), KEYS = Object.keys(DEF);
  const STORE = 'sandboxTune', OPTS = 'sandboxOpts';
  const saved = G.store.get(STORE, {});
  for (const k of KEYS) if (typeof saved[k] === 'number' && isFinite(saved[k])) TU[k] = saved[k];
  G.retune();

  // slider ranges: sensible by hand where it matters, else 0 … 3× the default
  const RANGE = {
    gravity: [2, 40, 0.5], mass: [400, 4000, 50], springTravel: [0.2, 1.2, 0.01], bumpStop: [0.05, 0.8, 0.01],
    steerLowSpeed: [0.1, 1.2, 0.01], steerHighSpeed: [0.05, 0.8, 0.01], tyreGrip: [0.2, 4, 0.05],
    wallBounce: [1, 2, 0.01], carBounce: [1, 2, 0.01], trafficBounce: [1, 2, 0.01], maxSpin: [2, 30, 0.5],
    driftRearGrip: [0, 1, 0.01], driftRearSide: [0, 1, 0.01], trafficLooseMass: [0.1, 2, 0.05], trafficMass: [0.1, 5, 0.05],
    trafficLandBounce: [0, 1, 0.01], rearThrustFadeSpeed: [40, 400, 5], fuelRechargeDelay: [0, 3, 0.05],
  };
  const nice = (x) => { const p = Math.pow(10, Math.floor(Math.log10(x))), m = x / p; return (m < 1.5 ? 1 : m < 3.5 ? 2 : 5) * p; };
  const range = (k) => {
    if (RANGE[k]) return RANGE[k];
    const d = DEF[k], st = nice(d / 100);
    return [0, Math.ceil((d * 3) / st) * st, st];
  };
  const dec = (st) => Math.max(0, -Math.floor(Math.log10(st) + 1e-9));
  const fmt = (v, st) => (+v).toFixed(dec(st));

  // groups and notes come straight from the comments in tuning.js
  async function readNotes() {
    const groups = [], notes = {};
    try {
      const src = await (await fetch('js/tuning.js', { cache: 'no-store' })).text();
      let g = null;
      for (const line of src.split(/\r?\n/)) {
        const h = line.match(/\/\/ ----\s*(.+?)\s*----/);
        if (h) { g = { name: h[1].toUpperCase(), keys: [] }; groups.push(g); continue; }
        const m = line.match(/^\s*(\w+):\s*[-\d.]+,\s*\/\/\s*(.*)$/);
        if (m && m[1] in DEF) { notes[m[1]] = m[2].replace(/\s*\[[^\]]*\]\s*$/, ''); if (g) g.keys.push(m[1]); }
      }
    } catch (e) { /* offline: one flat list */ }
    const seen = new Set(groups.flatMap((g) => g.keys)), rest = KEYS.filter((k) => !seen.has(k));
    if (rest.length) groups.push({ name: 'OTHER', keys: rest });
    return { groups, notes };
  }

  const $ = (s, r = document) => r.querySelector(s);
  const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };

  class Sandbox {
    constructor() {
      this.opt = Object.assign({ wrecks: false, height: 6, speed: 0, pitch: 0, roll: 0, rampSpeed: 50, repeat: false, open: true }, G.store.get(OPTS, {}));
      this.hist = []; this.land = null; this.lastLand = null; this.prevContacts = 4; this.prevVy = 0; this.repeatT = -1;
      this.rows = {};
    }
    saveOpt() { G.store.set(OPTS, this.opt); }
    changed() { return KEYS.filter((k) => Math.abs(TU[k] - DEF[k]) > 1e-9); }
    set(k, v) {
      TU[k] = v; G.retune();
      const ch = {}; for (const c of this.changed()) ch[c] = TU[c];
      G.store.set(STORE, ch);
      this.paint(k);
    }

    // ---------------- start ----------------
    async start(game) {
      this.game = game;
      const S = game.settings;
      if (!G.trackOpen(G.TRACK_ID)) { S.track = 'city'; G.store.set('settings', S); location.reload(); return; }
      document.body.classList.add('sbx');
      game.startRace('free');
      const { groups, notes } = await readNotes();
      this.build(groups, notes);
    }

    // ---------------- panel ----------------
    build(groups, notes) {
      const g = this.game, S = g.settings;
      const root = (this.root = el('div', '', ''));
      root.id = 'sbx';
      root.classList.toggle('shut', !this.opt.open);
      document.body.classList.toggle('sbx-open', this.opt.open);
      const tracks = Object.keys(G.TRACKS).filter((id) => G.trackOpen(id))
        .map((id) => `<option value="${id}"${id === G.TRACK_ID ? ' selected' : ''}>${G.TRACKS[id].name}</option>`).join('');
      const cars = G.GARAGE_CARS.filter((id) => G.carUnlocked(id))
        .map((id) => `<option value="${id}"${id === S.car ? ' selected' : ''}>${G.carInfo(id).name}</option>`).join('');
      const dens = Object.keys(G.TRAFFIC_DENSITY).map((d) => `<option value="${d}">${d}</option>`).join('');
      root.innerHTML = `
        <button class="sbx-tab" data-a="toggle">PHYSICS SANDBOX</button>
        <div class="sbx-body">
          <div class="sbx-head"><b>PHYSICS <span>SANDBOX</span></b><a href="./">exit</a></div>
          <div class="sbx-copy">
            <button class="sbx-go" data-a="copy">COPY SETTINGS</button>
            <button data-a="resetAll">RESET ALL</button>
          </div>
          <div class="sbx-n" id="sbx-n"></div>
          <details open><summary>TEST TRACK</summary>
            <label>Track <select data-o="track">${tracks}</select></label>
            <label>Car <select data-o="car">${cars}</select></label>
            <label>Traffic <select data-o="traffic">${dens}</select></label>
            <label class="ck"><input type="checkbox" data-o="wrecks"> Big crashes wreck the car</label>
            <div class="sbx-row">Speed
              <button data-a="slow" data-v="1">1×</button><button data-a="slow" data-v="0.5">½×</button><button data-a="slow" data-v="0.25">¼×</button><button data-a="slow" data-v="0.1">⅒×</button>
            </div>
          </details>
          <details open><summary>LANDING TEST</summary>
            ${this.optSlider('height', 'Drop height', 0, 40, 0.5, 'm')}
            ${this.optSlider('speed', 'Forward speed', 0, 120, 1, 'm/s')}
            ${this.optSlider('pitch', 'Nose up / down', -60, 60, 1, '°')}
            ${this.optSlider('roll', 'Roll', -60, 60, 1, '°')}
            <div class="sbx-row"><button class="sbx-go" data-a="drop">DROP</button><label class="ck"><input type="checkbox" data-o="repeat"> repeat</label></div>
            ${this.optSlider('rampSpeed', 'Ramp run-up speed', 20, 120, 1, 'm/s')}
            <div class="sbx-row"><button data-a="ramp">NEXT RAMP</button></div>
            <canvas id="sbx-graph" width="300" height="150"></canvas>
            <div class="sbx-key"><i class="a"></i>height above road <i class="b"></i>suspension squash <i class="c"></i>bump stop</div>
            <div class="sbx-land" id="sbx-land">Drop the car or jump a ramp: the landing shows up here.</div>
          </details>
          <details><summary>TRAFFIC TOOLS</summary>
            <div class="sbx-row"><button data-a="park">PARK 4 CARS AHEAD</button><button data-a="launch">THROW A CAR UP</button></div>
            <div class="sbx-row"><button data-a="respawn">RESET TRAFFIC</button></div>
          </details>
          <input class="sbx-find" type="search" placeholder="find a setting…">
          <div id="sbx-vars"></div>
        </div>
        <div class="sbx-out hidden"><div><b>Paste this to Claudio</b><textarea readonly></textarea><button data-a="closeOut">CLOSE</button></div></div>`;
      document.body.appendChild(root);
      $('[data-o="traffic"]', root).value = S.traffic;
      $('[data-o="wrecks"]', root).checked = this.opt.wrecks;
      $('[data-o="repeat"]', root).checked = this.opt.repeat;

      const vars = $('#sbx-vars', root);
      for (const gr of groups) {
        const d = el('details', 'grp'); d.open = true;
        d.appendChild(el('summary', '', gr.name));
        for (const k of gr.keys) {
          const [mn, mx, st] = range(k);
          const r = el('div', 'sbx-var');
          r.dataset.k = k;
          r.title = notes[k] || '';
          r.innerHTML = `<div class="l"><span>${k}</span><input type="number" step="${st}"><button title="back to ${fmt(DEF[k], st)}">↺</button></div>
            <input type="range" min="${mn}" max="${Math.max(mx, DEF[k])}" step="${st}"><small>${notes[k] || ''} · default ${fmt(DEF[k], st)}</small>`;
          const [num, rng] = r.querySelectorAll('input');
          rng.addEventListener('input', () => this.set(k, +rng.value));
          num.addEventListener('change', () => { const v = +num.value; if (isFinite(v)) this.set(k, v); num.blur(); });
          $('button', r).addEventListener('click', () => this.set(k, DEF[k]));
          this.rows[k] = { r, num, rng, st };
          d.appendChild(r);
        }
        vars.appendChild(d);
      }
      for (const k of KEYS) this.paint(k);

      // sliders hand the arrow keys back to the car once you let go
      root.addEventListener('pointerup', (e) => { if (e.target.type === 'range' || e.target.type === 'checkbox' || e.target.tagName === 'BUTTON') setTimeout(() => e.target.blur(), 0); });
      root.addEventListener('change', (e) => { if (e.target.tagName === 'SELECT') e.target.blur(); });
      root.addEventListener('keydown', (e) => { if (e.code === 'Escape') e.target.blur(); e.stopPropagation(); });
      $('.sbx-find', root).addEventListener('input', (e) => {
        const q = e.target.value.trim().toLowerCase();
        for (const k of KEYS) this.rows[k].r.style.display = !q || k.toLowerCase().includes(q) || (this.rows[k].r.title || '').toLowerCase().includes(q) ? '' : 'none';
      });
      root.addEventListener('click', (e) => {
        const b = e.target.closest('[data-a]'); if (!b) return;
        const a = b.dataset.a;
        if (a === 'toggle') { this.opt.open = !this.opt.open; root.classList.toggle('shut', !this.opt.open); document.body.classList.toggle('sbx-open', this.opt.open); this.saveOpt(); }
        else if (a === 'copy') this.copy();
        else if (a === 'closeOut') $('.sbx-out', root).classList.add('hidden');
        else if (a === 'resetAll') { if (confirm('Put every value back to the game\'s current settings?')) for (const k of KEYS) this.set(k, DEF[k]); }
        else if (a === 'slow') { g.timeScale = +b.dataset.v; this.slow = +b.dataset.v; this.paintSlow(); }
        else if (a === 'drop') this.drop();
        else if (a === 'ramp') this.ramp();
        else if (a === 'park') this.park();
        else if (a === 'launch') this.launch();
        else if (a === 'respawn') this.newTraffic(S.traffic);
      });
      root.addEventListener('input', (e) => {
        const o = e.target.dataset.o; if (!o) return;
        if (o === 'track') { S.track = e.target.value; G.store.set('settings', S); location.reload(); }
        else if (o === 'car') { const id = (S.car = e.target.value); G.store.set('settings', S); G.loadCar(id).then(() => { if (S.car === id) g.setPlayerCar(id, S.paint); }); }
        else if (o === 'traffic') { S.traffic = e.target.value; G.store.set('settings', S); this.newTraffic(S.traffic); }
        else if (o === 'wrecks' || o === 'repeat') { this.opt[o] = e.target.checked; this.saveOpt(); }
        else if (o in this.opt) { this.opt[o] = +e.target.value; $(`[data-ov="${o}"]`, root).textContent = e.target.value; this.saveOpt(); }
      });
      this.slow = 1; this.paintSlow();
      this.graph = $('#sbx-graph', root).getContext('2d');
    }
    optSlider(k, label, mn, mx, st, unit) {
      return `<label class="opt">${label} <b><span data-ov="${k}">${this.opt[k]}</span> ${unit}</b><input type="range" data-o="${k}" min="${mn}" max="${mx}" step="${st}" value="${this.opt[k]}"></label>`;
    }
    paint(k) {
      const row = this.rows[k]; if (!row) return;
      row.num.value = fmt(TU[k], row.st); row.rng.value = TU[k];
      row.r.classList.toggle('ch', Math.abs(TU[k] - DEF[k]) > 1e-9);
      const n = this.changed().length;
      $('#sbx-n', this.root).textContent = n ? `${n} setting${n > 1 ? 's' : ''} changed (highlighted)` : 'Nothing changed yet: these are the game\'s settings.';
    }
    paintSlow() { this.root.querySelectorAll('[data-a="slow"]').forEach((b) => b.classList.toggle('on', +b.dataset.v === this.slow)); }

    copy() {
      const ch = this.changed(), out = $('.sbx-out', this.root), ta = $('textarea', out);
      if (!ch.length) { this.game.toast('NOTHING CHANGED YET'); return; }
      const lines = ch.map((k) => `${k}: ${DEF[k]} → ${+TU[k].toFixed(6)}`);
      const json = {}; for (const k of ch) json[k] = +TU[k].toFixed(6);
      const txt = `RoadsterThruster sandbox settings (${new Date().toISOString().slice(0, 10)})\n${lines.join('\n')}\n\n${JSON.stringify(json)}`;
      ta.value = txt; out.classList.remove('hidden');
      const done = () => this.game.toast('SETTINGS COPIED: PASTE THEM TO CLAUDIO');
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, () => { ta.select(); });
      else { ta.select(); try { document.execCommand('copy'); done(); } catch (e) { /* select is enough */ } }
    }

    // ---------------- tools ----------------
    live() { const g = this.game; if (g.state === 'wreck') { g.state = 'race'; } return g.state === 'race' || g.state === 'finished'; }
    lane() { const n = this.game.player.near; return G.LANES_FWD.reduce((a, b) => (Math.abs(b - n.lat) < Math.abs(a - n.lat) ? b : a)); }
    drop() {
      if (!this.live()) return;
      const p = this.game.player, o = this.opt, D = Math.PI / 180;
      p.place(p.near.s, this.lane(), o.speed);
      p.pos.y += o.height;
      p.q.multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(o.pitch * D, 0, -o.roll * D, 'YXZ')));
      this.land = null; this.repeatT = -1; this.prevContacts = 0;
    }
    ramp() {
      if (!this.live()) return;
      const g = this.game, tr = g.track, p = g.player, L = tr.length;
      if (!tr.ramps.length) { g.toast('NO RAMPS ON THIS TRACK'); return; }
      const ahead = tr.ramps.map((r) => ({ r, d: G.wrap(r.s - p.near.s - 80, L) })).sort((a, b) => a.d - b.d)[0].r;
      p.place(G.wrap(ahead.s - 70, L), ahead.lat, this.opt.rampSpeed); // a short run-up: no steering needed
      this.land = null; this.repeatT = -1;
    }
    newTraffic(d) {
      const g = this.game;
      if (g.traffic) { g.traffic.dispose(); g.traffic = null; }
      if (d !== 'off') { g.traffic = new G.Traffic(g, d); g.traffic.spawnAll(g.player.near.s, 70); }
    }
    // four cars stopped across the forward lanes ahead: something to crash into
    park() {
      const g = this.game, t = g.traffic, p = g.player, L = g.track.length;
      if (!t) { g.toast('TURN TRAFFIC ON FIRST'); return; }
      const far = t.cars.filter((c) => !c.loose).sort((a, b) => t.zoneDist(b.s, p.near.s) - t.zoneDist(a.s, p.near.s));
      const F = G.LANES_FWD.length;
      for (let i = 0; i < Math.min(4, far.length); i++) {
        const c = far[i];
        c.lane = i % F; c.s = G.wrap(p.near.s + 70 + Math.floor(i / F) * 12, L);
        t.initCar(c); c.vT = 0; c.v = 0; c.parked = true;
      }
    }
    launch() {
      const g = this.game, t = g.traffic, p = g.player, L = g.track.length;
      if (!t) { g.toast('TURN TRAFFIC ON FIRST'); return; }
      const c = t.cars.filter((c) => !c.loose).sort((a, b) => t.zoneDist(b.s, p.near.s) - t.zoneDist(a.s, p.near.s))[0];
      c.lane = 0; c.s = G.wrap(p.near.s + 45, L); t.initCar(c); c.v = 0;
      t.knock(c, 0, 13, 0, (Math.random() - 0.5) * 2);
      c.rollV = (Math.random() - 0.5) * 8; c.pitchV = (Math.random() - 0.5) * 3;
    }

    // ---------------- measuring ----------------
    // every physics step: spot touchdowns and follow the car until it settles
    sub(h) {
      const p = this.game.player, n = p.contacts, ws = p.wheels;
      let comp = 0; for (const w of ws) comp = Math.max(comp, w.comp);
      if (this.prevContacts === 0 && n > 0 && this.airT > 0.25 && this.prevVy < -1) {
        this.land = { impact: -this.prevVy, air: this.airT, bounces: 0, peak: 0, squash: 0, bump: false, t: 0, still: 0, alt0: null, done: false };
      }
      this.airT = n === 0 ? (this.airT || 0) + h : 0;
      const L = this.land;
      if (L && !L.done) {
        L.t += h;
        if (this.prevContacts > 0 && n === 0) L.bounces++;
        L.squash = Math.max(L.squash, comp);
        if (L.t > 0.05) L.upV = Math.max(L.upV || 0, p.vel.y);
        if (comp > TU.bumpStop) L.bump = true;
        L.peakAlt = Math.max(L.peakAlt || -1e9, L.t > 0.05 ? p.altitude : -1e9);
        if (Math.abs(p.vel.y) < 0.15 && n >= 3) L.still += h; else L.still = 0;
        if (L.still > 0.35 || L.t > 5) {
          L.done = true; L.settle = Math.max(0, L.t - L.still); L.rest = p.altitude;
          L.rebound = Math.max(0, (L.peakAlt || 0) - L.rest);
          this.lastLand = L; this.showLand(L);
          if (this.opt.repeat) this.repeatT = 1.2;
        }
      }
      this.prevContacts = n; this.prevVy = p.vel.y;
    }
    showLand(L) {
      const box = $('#sbx-land', this.root); if (!box) return;
      const pct = Math.round((L.squash / TU.springTravel) * 100);
      box.innerHTML = `<div><span>Hit the ground at</span><b>${L.impact.toFixed(1)} m/s</b></div>
        <div><span>Bounces (all wheels off again)</span><b>${L.bounces}</b></div>
        <div><span>Highest bounce above resting</span><b>${L.rebound.toFixed(2)} m</b></div>
        <div><span>Fastest it sprang back up</span><b>${(L.upV || 0).toFixed(1)} m/s</b></div>
        <div><span>Most squash</span><b>${L.squash.toFixed(2)} m · ${pct}%${L.bump ? ' · bump stop' : ''}</b></div>
        <div><span>Time to settle</span><b>${L.t > 5 ? '5+ s' : L.settle.toFixed(2) + ' s'}</b></div>`;
    }
    frame(dt) {
      const g = this.game, p = g.player;
      if (this.slow && g.state === 'race' && g.timeScale !== this.slow) g.timeScale = this.slow;
      if (this.repeatT > 0) { this.repeatT -= dt / Math.max(g.timeScale, 0.05); if (this.repeatT <= 0) this.drop(); }
      // keep parked cars parked
      if (g.traffic) for (const c of g.traffic.cars) if (c.parked) { if (c.loose) c.parked = false; else { c.vT = 0; c.v = 0; } }
      let comp = 0; for (const w of p.wheels) comp += w.comp; comp /= p.wheels.length;
      this.hist.push({ t: g.t, a: p.altitude, c: comp });
      while (this.hist.length && g.t - this.hist[0].t > 6) this.hist.shift();
      if ((this._gT = (this._gT || 0) + 1) % 2 === 0) this.draw();
    }
    draw() {
      const c = this.graph; if (!c || this.root.classList.contains('shut')) return;
      const W = c.canvas.width, H = c.canvas.height, hs = this.hist; if (hs.length < 2) return;
      c.clearRect(0, 0, W, H);
      const t1 = hs[hs.length - 1].t, t0 = t1 - 6, X = (t) => ((t - t0) / 6) * W;
      const top = H * 0.58;
      const aMax = Math.max(2, ...hs.map((q) => q.a)) * 1.05;
      c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, 0, W, top - 4); c.fillRect(0, top + 4, W, H - top - 4);
      c.font = '10px sans-serif'; c.fillStyle = 'rgba(255,255,255,0.45)';
      c.fillText(`${aMax.toFixed(1)} m`, 3, 11); c.fillText(`${TU.springTravel.toFixed(2)} m`, 3, top + 15);
      const line = (f, y0, y1, col) => { c.strokeStyle = col; c.lineWidth = 1.6; c.beginPath(); hs.forEach((q, i) => { const y = y1 + (y0 - y1) * f(q); i ? c.lineTo(X(q.t), y) : c.moveTo(X(q.t), y); }); c.stroke(); };
      line((q) => G.clamp(q.a / aMax, 0, 1), top - 4, 4, '#4fc3ff');
      const by = H - 2 - (H - top - 8) * (TU.bumpStop / TU.springTravel);
      c.strokeStyle = '#ff5a4f'; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(0, by); c.lineTo(W, by); c.stroke(); c.setLineDash([]);
      line((q) => G.clamp(q.c / TU.springTravel, 0, 1), H - 2, top + 6, '#ffb03b');
    }
  }

  G.sandbox = new Sandbox();
})();
