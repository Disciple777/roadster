// hud.js — speedometer, N2 tank, race info, minimap, stunt popups
(function () {
  const $ = (id) => document.getElementById(id);

  class HUD {
    constructor(game) {
      this.game = game;
      this.el = $('hud');
      this.speed = $('h-speed'); this.gear = $('h-gear');
      this.arc = $('h-arc');
      this.n2 = $('h-n2'); this.n2wrap = $('hud-n2'); this.n2pct = $('h-n2pct'); this.n2st = $('h-n2st'); this._n2s = '';
      this.tl = $('t-l'); this.tr = $('t-r'); this.tb = $('t-b');
      this.pos = $('h-pos'); this.posn = $('h-posn'); this.lap = $('h-lap'); this.time = $('h-time'); this.best = $('h-best');
      this.score = $('h-score'); this.combo = $('h-combo');
      this.pop = $('popups'); this.cd = $('countdown'); this.msg = $('h-msg');
      this.alt = $('h-alt');
      this.mm = $('minimap'); this.mctx = this.mm.getContext('2d');
      this.fps = $('fps');
      this.board = $('h-board');
      this.arcLen = 0;
      this.buildTrackPath();
      this._f = 0; this._ft = 0; this._fc = 0;
    }

    buildTrackPath() {
      const tr = this.game.track;
      const pts = [];
      for (let i = 0; i < tr.N; i += 4) pts.push([tr.px[i], tr.pz[i]]);
      this.mmPts = pts;
    }

    show(b) { this.el.classList.toggle('hidden', !b); }
    setMode(mode) { this.el.classList.toggle('free', mode === 'free'); this.el.classList.toggle('course', mode === 'course'); }
    // obstacle course hull meter; flash it when it takes a knock
    hull(h, hit) {
      const box = this.hullBox || (this.hullBox = $('h-hullbox'));
      $('h-hull').textContent = Math.max(0, Math.round(h)) + '%';
      $('h-hullbar').style.width = Math.max(0, h) + '%';
      box.classList.toggle('mid', h < 60 && h >= 30); box.classList.toggle('low', h < 30);
      if (hit) { box.classList.remove('hit'); void box.offsetWidth; box.classList.add('hit'); }
    }

    update(dt, g) {
      const p = g.player;
      const kmh = Math.round(p.speed * 3.6);
      this.speed.textContent = kmh;
      const frac = Math.min(1, kmh / 480);
      this.arc.style.strokeDashoffset = String(283 * (1 - frac * 0.75));
      this.arc.classList.toggle('hot', p.th.B > 0.3);
      this.n2.style.width = p.fuel.toFixed(1) + '%';
      this.n2pct.textContent = Math.round(p.fuel) + '%';
      // status: in use / recharging / full / empty (locked until it refills past the yellow mark)
      const st = p.fuelLock ? 'locked' : p.fuelUse ? 'use' : p.fuel >= 99.5 ? 'full' : p.fuelCharging ? 'charge' : 'wait';
      if (st !== this._n2s) {
        this._n2s = st;
        for (const c of ['locked', 'use', 'full', 'charge', 'wait']) this.n2wrap.classList.toggle(c, c === st);
        this.n2st.textContent = { locked: 'EMPTY · RECHARGING', use: 'IN USE', full: 'FULL', charge: 'RECHARGING', wait: 'LAND TO RECHARGE' }[st];
      }
      this.n2wrap.classList.toggle('low', p.fuel < 20 || p.fuelLock);
      // L / R light up for the key or button you're holding (inverted thrusters swap which way that pushes)
      const inv = g.input.thrInvert, sl = inv ? p.th.SR : p.th.SL, sr = inv ? p.th.SL : p.th.SR;
      this.tl.classList.toggle('on', p.th.L > 0.3 || sl > 0.3);
      this.tr.classList.toggle('on', p.th.R > 0.3 || sr > 0.3);
      this.tb.classList.toggle('on', p.th.B > 0.3);
      this.alt.textContent = p.altitude > 1.5 ? `ALT ${p.altitude.toFixed(1)} m` : '';
      if (g.mode !== 'free') {
        this.pos.textContent = g.place; this.posn.textContent = g.racers;
        this.lap.textContent = Math.min(g.lap, g.laps) + '/' + g.laps;
        this.time.textContent = G.fmtTime(g.raceTime);
        this.best.textContent = g.mode === 'course' ? (g.courseBest ? 'BEST ' + g.courseBest.toLocaleString() : '') : g.bestLap < 1e8 ? 'BEST ' + G.fmtTime(g.bestLap) : '';
      } else {
        this.time.textContent = G.fmtTime(g.raceTime);
      }
      this.score.textContent = g.score.toLocaleString();
      this.combo.textContent = g.combo > 1 ? 'x' + g.combo : '';
      this.drawMinimap(g);
      // fps
      this._fc++; this._ft += dt;
      if (this._ft > 0.5) { this.fps.textContent = Math.round(this._fc / this._ft) + ' fps'; this._fc = 0; this._ft = 0; }
    }

    drawMinimap(g) {
      const c = this.mctx, W = this.mm.width, H = this.mm.height;
      const p = g.player;
      c.clearRect(0, 0, W, H);
      c.save();
      c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); c.clip();
      c.fillStyle = 'rgba(8,10,16,0.62)'; c.fillRect(0, 0, W, H);
      const sc = W / 520;
      c.translate(W / 2, H / 2);
      const yaw = g.camYaw;
      c.rotate(yaw);
      c.scale(sc, sc);
      c.translate(-p.pos.x, -p.pos.z);
      c.lineJoin = 'round';
      c.strokeStyle = 'rgba(255,255,255,0.12)'; c.lineWidth = 34;
      c.beginPath(); this.mmPts.forEach(([x, z], i) => (i ? c.lineTo(x, z) : c.moveTo(x, z))); c.closePath(); c.stroke();
      c.strokeStyle = 'rgba(255,60,80,0.75)'; c.lineWidth = 6; c.stroke();
      // start line
      const s0 = g.track.sample(0, {});
      c.strokeStyle = '#fff'; c.lineWidth = 6; c.beginPath(); c.moveTo(s0.x - s0.rx * 16, s0.z - s0.rz * 16); c.lineTo(s0.x + s0.rx * 16, s0.z + s0.rz * 16); c.stroke();
      // traffic
      if (g.traffic) {
        c.fillStyle = 'rgba(200,200,210,0.55)';
        for (const t of g.traffic.cars) {
          const dx = t.x - p.pos.x, dz = t.z - p.pos.z;
          if (dx * dx + dz * dz > 300 * 300) continue;
          c.fillRect(t.x - 3, t.z - 3, 6, 6);
        }
      }
      // pickups
      c.fillStyle = '#5fd4ff';
      for (const k of g.pickups) if (k.active) { c.beginPath(); c.arc(k.x, k.z, 5, 0, 7); c.fill(); }
      // rivals
      if (g.rivals) for (const r of g.rivals.list) {
        c.fillStyle = '#' + r.color.toString(16).padStart(6, '0');
        c.beginPath(); c.arc(r.pos.x, r.pos.z, 9, 0, 7); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 2; c.stroke();
      }
      // other phones in a multiplayer race
      if (g.remotes) for (const r of g.remotes.list) {
        if (r.alpha < 0.05) continue;
        c.globalAlpha = r.alpha;
        c.fillStyle = '#' + r.color.toString(16).padStart(6, '0');
        c.beginPath(); c.arc(r.pos.x, r.pos.z, 10, 0, 7); c.fill();
        c.strokeStyle = '#fff'; c.lineWidth = 3; c.stroke();
        c.globalAlpha = 1;
      }
      c.restore();
      // player arrow (always up)
      c.save(); c.translate(W / 2, H / 2);
      c.rotate(-(p.yawVis - yaw) || 0);
      c.fillStyle = '#ff2a3c'; c.strokeStyle = '#fff'; c.lineWidth = 2;
      c.beginPath(); c.moveTo(0, -11); c.lineTo(7, 8); c.lineTo(0, 4); c.lineTo(-7, 8); c.closePath(); c.fill(); c.stroke();
      c.restore();
      c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 2; c.beginPath(); c.arc(W / 2, H / 2, W / 2 - 2, 0, Math.PI * 2); c.stroke();
    }

    popup(text, sub, cls = '') {
      const d = document.createElement('div');
      d.className = 'popup ' + cls;
      d.innerHTML = `<b>${text}</b>${sub ? `<small>${sub}</small>` : ''}`;
      this.pop.appendChild(d);
      while (this.pop.children.length > 4) this.pop.firstChild.remove();
      setTimeout(() => d.remove(), 1700);
    }

    countdown(text, go) {
      this.cd.textContent = text;
      this.cd.className = 'show' + (go ? ' go' : '');
      void this.cd.offsetWidth;
      clearTimeout(this._cdT);
      this._cdT = setTimeout(() => (this.cd.className = ''), go ? 900 : 800);
    }

    message(text, ms = 1500) {
      this.msg.textContent = text; this.msg.classList.add('show');
      clearTimeout(this._mT); this._mT = setTimeout(() => this.msg.classList.remove('show'), ms);
    }
  }
  G.HUD = HUD;
})();
