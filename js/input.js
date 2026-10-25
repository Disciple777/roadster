// input.js — keyboard, gamepad, touch (floating joystick + thruster cluster) and optional tilt steering
(function () {
  class Input {
    constructor() {
      this.keys = new Set();
      this.state = { steer: 0, throttle: 0, brake: 0, handbrake: false, jump: false, thrL: false, thrR: false, boost: false, pitch: 0, rollAir: 0 };
      this.events = [];
      this.kSteer = 0;
      this.touch = { active: false, steer: 0, y: 0, btn: new Set() };
      this.tilt = { on: false, neutral: null, val: 0 };
      this.autoAccel = false;
      this.sens = 1;
      this.lastDevice = 'keyboard';
      this.bindKeys();
    }

    bindKeys() {
      const ev = { KeyC: 'camera', KeyR: 'reset', KeyP: 'pause', Escape: 'pause', KeyM: 'mute', KeyF: 'fullscreen', KeyH: 'hud' };
      window.addEventListener('keydown', (e) => {
        if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
        if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(e.code)) e.preventDefault();
        if (!e.repeat && ev[e.code]) this.events.push(ev[e.code]);
        this.keys.add(e.code);
        this.lastDevice = 'keyboard';
        if (G.audio) G.audio.init(); // a race started straight after a reload has had no click to unlock sound yet
      });
      window.addEventListener('keyup', (e) => this.keys.delete(e.code));
      window.addEventListener('blur', () => this.keys.clear());
    }

    // ---------- touch UI ----------
    buildTouch(root) {
      this.touchRoot = root;
      root.innerHTML = `
        <div class="t-zone" id="t-zone"></div>
        <div class="t-stick hidden" id="t-stick"><div class="t-knob" id="t-knob"></div></div>
        <div class="t-cluster" id="t-cluster">
          <div class="tb tb-boost" data-btn="boost"><span class="ic">&#x23E9;</span><b>BOOST</b></div>
          <div class="tb tb-jump" data-btn="jump"><span class="ic">&#x2B06;&#xFE0E;</span><b>JUMP</b></div>
          <div class="tb tb-l" data-btn="thrL"><b>L</b><i>THR</i></div>
          <div class="tb tb-r" data-btn="thrR"><b>R</b><i>THR</i></div>
          <div class="tb tb-brake" data-btn="brake"><b>BRAKE</b></div>
          <div class="tb tb-drift" data-btn="handbrake"><b>DRIFT</b></div>
        </div>
        <div class="t-hint" id="t-hint">drag to steer</div>`;
      const zone = root.querySelector('#t-zone'), stick = root.querySelector('#t-stick'), knob = root.querySelector('#t-knob');
      const cluster = root.querySelector('#t-cluster');
      let stickId = null, ox = 0, oy = 0;
      const R = 50;
      const onStick = (t) => {
        let dx = t.clientX - ox, dy = t.clientY - oy;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          // let the origin follow the thumb so steering never "sticks"
          ox += dx * (1 - R / d); oy += dy * (1 - R / d);
          stick.style.left = ox + 'px'; stick.style.top = oy + 'px';
          dx = t.clientX - ox; dy = t.clientY - oy;
        }
        knob.style.transform = `translate(${dx}px, ${dy}px)`;
        let sx = dx / R; const sy = dy / R;
        const dz = 0.07;
        sx = Math.abs(sx) < dz ? 0 : Math.sign(sx) * (Math.abs(sx) - dz) / (1 - dz);
        this.touch.steer = Math.sign(sx) * Math.pow(Math.abs(sx), 1.1);
        this.touch.y = Math.abs(sy) < 0.15 ? 0 : sy;
      };
      zone.addEventListener('touchstart', (e) => {
        e.preventDefault();
        G.audio.init();
        if (stickId !== null) return;
        const t = e.changedTouches[0];
        stickId = t.identifier; ox = t.clientX; oy = t.clientY;
        stick.style.left = ox + 'px'; stick.style.top = oy + 'px';
        stick.classList.remove('hidden');
        root.querySelector('#t-hint').classList.add('gone');
        knob.style.transform = 'translate(0,0)';
        this.touch.active = true; this.lastDevice = 'touch';
      }, { passive: false });
      const moveEnd = (e, end) => {
        for (const t of e.changedTouches) {
          if (t.identifier !== stickId) continue;
          if (end) { stickId = null; stick.classList.add('hidden'); this.touch.steer = 0; this.touch.y = 0; }
          else onStick(t);
        }
      };
      zone.addEventListener('touchmove', (e) => { e.preventDefault(); moveEnd(e, false); }, { passive: false });
      zone.addEventListener('touchend', (e) => moveEnd(e, true));
      zone.addEventListener('touchcancel', (e) => moveEnd(e, true));

      // cluster: every active touch is hit-tested, so thumbs can slide between buttons
      const btnTouches = new Map();
      const refresh = () => {
        const set = new Set();
        for (const [, name] of btnTouches) if (name) set.add(name);
        for (const el of cluster.querySelectorAll('[data-btn]')) el.classList.toggle('on', set.has(el.dataset.btn));
        const was = this.touch.btn;
        if (set.size > was.size && navigator.vibrate) try { navigator.vibrate(8); } catch (e) { /* ignore */ }
        this.touch.btn = set;
      };
      const hit = (t) => {
        const el = document.elementFromPoint(t.clientX, t.clientY);
        const b = el && el.closest && el.closest('[data-btn]');
        return b ? b.dataset.btn : null;
      };
      const onBtn = (e) => {
        e.preventDefault();
        G.audio.init();
        this.lastDevice = 'touch';
        for (const t of e.changedTouches) {
          if (e.type === 'touchend' || e.type === 'touchcancel') btnTouches.delete(t.identifier);
          else btnTouches.set(t.identifier, hit(t));
        }
        refresh();
      };
      for (const type of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) cluster.addEventListener(type, onBtn, { passive: false });
    }

    enableTilt(on) {
      this.tilt.on = on;
      if (!on) return Promise.resolve(true);
      const add = () => {
        if (this._tiltBound) return;
        this._tiltBound = true;
        window.addEventListener('deviceorientation', (e) => {
          const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
          let v = ang === 90 ? e.beta : ang === -90 || ang === 270 ? -e.beta : e.gamma;
          if (v == null) return;
          if (this.tilt.neutral == null) this.tilt.neutral = 0;
          this.tilt.val = v;
        });
      };
      if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
        return DeviceOrientationEvent.requestPermission().then((r) => { if (r === 'granted') { add(); return true; } this.tilt.on = false; return false; }).catch(() => { this.tilt.on = false; return false; });
      }
      add();
      return Promise.resolve(true);
    }
    calibrateTilt() { this.tilt.neutral = this.tilt.val; }

    pollGamepad() {
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      for (const gp of pads) {
        if (!gp || !gp.connected) continue;
        const b = (i) => gp.buttons[i] ? gp.buttons[i].value || (gp.buttons[i].pressed ? 1 : 0) : 0;
        const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
        const st = dz(gp.axes[0] || 0), py = dz(gp.axes[3] || 0), rx = dz(gp.axes[2] || 0);
        const any = Math.abs(st) + Math.abs(py) + gp.buttons.reduce((a, x) => a + x.value, 0);
        if (any > 0.05) this.lastDevice = 'gamepad';
        const prev = this._gpPrev || {};
        const edge = (i, name) => { const p = b(i) > 0.5; if (p && !prev[i]) this.events.push(name); prev[i] = p; };
        edge(3, 'camera'); edge(9, 'pause'); edge(8, 'reset');
        this._gpPrev = prev;
        return { steer: Math.sign(st) * Math.pow(Math.abs(st), 1.15), pitch: -py, roll: rx, throttle: b(7), brake: b(6), jump: b(0) > 0.5, thrL: b(4) > 0.5, thrR: b(5) > 0.5, boost: b(2) > 0.5, hand: b(1) > 0.5 };
      }
      return null;
    }

    update(dt, airborne) {
      const k = this.keys, s = this.state;
      const kl = k.has('KeyA') || k.has('ArrowLeft'), kr = k.has('KeyD') || k.has('ArrowRight');
      const ku = k.has('KeyW') || k.has('ArrowUp'), kd = k.has('KeyS') || k.has('ArrowDown');
      const target = (kr ? 1 : 0) - (kl ? 1 : 0);
      const rate = target === 0 ? 26 :(Math.sign(target) !== Math.sign(this.kSteer) ? 22 : 16);
      this.kSteer += G.clamp(target - this.kSteer, -rate * dt, rate * dt);

      let steer = this.kSteer, throttle = ku ? 1 : 0, brake = kd ? 1 : 0;
      let pitch = 0, roll = 0;
      let jump = k.has('Space'), thrL = k.has('KeyQ'), thrR = k.has('KeyE'), boost = k.has('ShiftLeft') || k.has('ShiftRight');
      let hand = k.has('KeyX') || k.has('ControlRight');

      const gp = this.pollGamepad();
      if (gp) {
        if (Math.abs(gp.steer) > Math.abs(steer)) steer = gp.steer;
        throttle = Math.max(throttle, gp.throttle); brake = Math.max(brake, gp.brake);
        if (airborne && Math.abs(gp.pitch) > 0.1) pitch = gp.pitch;
        roll = gp.roll;
        jump = jump || gp.jump; thrL = thrL || gp.thrL; thrR = thrR || gp.thrR; boost = boost || gp.boost; hand = hand || gp.hand;
      }

      if (this.touch.active) {
        const tb = this.touch.btn;
        let ts = this.touch.steer * this.sens;
        if (this.tilt.on) ts = G.clamp((this.tilt.val - (this.tilt.neutral || 0)) / 17, -1, 1) * this.sens;
        if (Math.abs(ts) > Math.abs(steer)) steer = G.clamp(ts, -1, 1);
        const ty = this.touch.y;
        if (this.autoAccel) { if (!tb.has('brake')) throttle = Math.max(throttle, ty > 0.5 ? 0 : 1); }
        else if (ty < -0.25) throttle = Math.max(throttle, Math.min(1, -ty * 1.3));
        if (ty > 0.5 && !airborne) brake = Math.max(brake, (ty - 0.5) * 2);
        if (tb.has('brake')) { brake = 1; throttle = 0; }
        jump = jump || tb.has('jump'); thrL = thrL || tb.has('thrL'); thrR = thrR || tb.has('thrR');
        boost = boost || tb.has('boost'); hand = hand || tb.has('handbrake');
      }

      s.steer = G.clamp(steer, -1, 1); s.throttle = throttle; s.brake = brake; s.handbrake = hand;
      s.jump = jump; s.thrL = thrL; s.thrR = thrR; s.boost = boost; s.pitch = pitch; s.rollAir = roll;
      return s;
    }

    consume() { const e = this.events; this.events = []; return e; }
  }
  G.Input = Input;
})();
