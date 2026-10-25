// game.js — boot, renderer & post FX, game states, camera, effects, scoring, UI wiring
(function () {
  const T = THREE;
  const { EffectComposer, RenderPass, UnrealBloomPass, ShaderPass, OutputPass } = ADDONS;
  const $ = (id) => document.getElementById(id);

  const QUALITY = {
    ultra: { level: 5, pr: 2, shadows: true, shadowSize: 2048, bloom: true, blur: true, particles: 6500, cityRange: 560, cityDensity: 1, lightCones: true, wetRoad: true, aa: true, lights: true },
    high: { level: 4, pr: 1.5, shadows: true, shadowSize: 2048, bloom: true, blur: true, particles: 4500, cityRange: 440, cityDensity: 0.95, lightCones: true, wetRoad: true, aa: true, lights: true },
    medium: { level: 3, pr: 1.25, shadows: true, shadowSize: 1024, bloom: true, blur: false, particles: 2800, cityRange: 330, cityDensity: 0.85, lightCones: false, wetRoad: true, aa: true, lights: true },
    low: { level: 2, pr: 1, shadows: false, shadowSize: 512, bloom: false, blur: false, particles: 1500, cityRange: 240, cityDensity: 0.7, lightCones: false, wetRoad: false, aa: false, lights: false },
    potato: { level: 1, pr: 0.7, shadows: false, shadowSize: 512, bloom: false, blur: false, particles: 700, cityRange: 160, cityDensity: 0.5, lightCones: false, wetRoad: false, aa: false, lights: false },
  };

  const DEFAULTS = {
    quality: G.isMobile ? 'medium' : 'high', tod: 'night', traffic: 'medium', laps: 3, rivals: 5, difficulty: 'normal', track: 'city',
    camera: 0, autoAccel: G.isTouch, tilt: false, sens: 1, showFps: false, touchUI: 'auto', vol: 0.7, shake: true,
    thrInvert: true, keys: null, // keys: { action: [code, code] }, null = defaults
  };

  const RadialShader = {
    uniforms: { tDiffuse: { value: null }, uAmount: { value: 0 }, uCenter: { value: new T.Vector2(0.5, 0.5) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uAmount; uniform vec2 uCenter; varying vec2 vUv;
      void main(){
        vec2 dir = vUv - uCenter; vec4 c = vec4(0.0); float tot = 0.0;
        float a = uAmount * smoothstep(0.08, 0.5, length(dir));
        for (int i = 0; i < 8; i++) { float t = float(i) / 7.0; float w = 1.0 - t * 0.6; c += texture2D(tDiffuse, vUv - dir * a * t) * w; tot += w; }
        c /= tot;
        float v = smoothstep(1.05, 0.3, length(dir * vec2(1.0, 0.85)));
        c.rgb *= mix(0.6, 1.0, v);
        gl_FragColor = c;
      }`,
  };

  // ---------------- effects (steam, smoke, sparks) ----------------
  class FX {
    constructor(game) {
      const Q = game.Q, tod = G.TOD[game.settings.tod];
      this.game = game;
      const puff = G.puffTexture();
      this.steam = new G.Particles(game.scene, Q.particles, { texture: puff, color: new T.Color(0.86, 0.9, 0.98).multiplyScalar(tod.steam) });
      this.smoke = new G.Particles(game.scene, Math.round(Q.particles * 0.35), { texture: puff, color: new T.Color(0.32, 0.32, 0.34).multiplyScalar(tod.steam) });
      this.sparks = new G.Particles(game.scene, 500, { texture: G.softSprite(), additive: true, color: new T.Color(5, 2.2, 0.6) });
      this.leaves = new G.Particles(game.scene, 300, { texture: G.softSprite(), color: new T.Color(0.22, 0.36, 0.1).multiplyScalar(tod.steam) });
      this.rate = Q.particles / 4500;
      this.acc = new Map();
      this.v = new T.Vector3(); this.d = new T.Vector3(); this.u = new T.Vector3(); this.f = new T.Vector3();
    }
    _n(key, rate, dt) { const a = (this.acc.get(key) || 0) + rate * dt; const n = Math.floor(a); this.acc.set(key, a - n); return n; }
    // under jets: nozzles FL, FR, RL, RR
    steamUnder(group, L, R, alt, dt, vel) {
      const m = group.matrixWorld;
      this.u.set(m.elements[4], m.elements[5], m.elements[6]).normalize();
      const intens = [L, R, L, R], xs = [-0.62, 0.62, -0.62, 0.62], zs = [-0.95, -0.95, 1.0, 1.0];
      for (let i = 0; i < 4; i++) {
        if (intens[i] < 0.05) continue;
        const n = this._n(group.id * 10 + i, 70 * this.rate * intens[i], dt);
        for (let k = 0; k < n; k++) {
          this.v.set(xs[i] + (Math.random() - 0.5) * 0.2, 0.0, zs[i] + (Math.random() - 0.5) * 0.2).applyMatrix4(m);
          const sp = 20 + Math.random() * 10;
          let vx = -this.u.x * sp + (Math.random() - 0.5) * 4, vy = -this.u.y * sp, vz = -this.u.z * sp + (Math.random() - 0.5) * 4;
          if (vel) { vx += vel.x * 0.55; vy += vel.y * 0.3; vz += vel.z * 0.55; }
          this.steam.emit(this.v.x, this.v.y, this.v.z, vx, vy, vz, 1.8 + Math.random() * 1.8, 0.5, 5 + Math.random() * 4, 0.42, { drag: 1.7, buoy: 0.9 });
        }
      }
    }
    steamRear(group, B, dt, speedOrVel) {
      const m = group.matrixWorld;
      this.f.set(m.elements[8], m.elements[9], m.elements[10]).normalize(); // local +Z (backwards)
      const n = this._n(group.id * 10 + 7, 160 * this.rate * B, dt);
      for (let k = 0; k < n; k++) {
        const x = [-0.6, -0.2, 0.2, 0.6][(Math.random() * 4) | 0];
        this.v.set(x, 0.5, 2.5).applyMatrix4(m);
        let cvx, cvy = 0, cvz;
        if (typeof speedOrVel === 'number') { cvx = -this.f.x * speedOrVel; cvz = -this.f.z * speedOrVel; }
        else { cvx = speedOrVel.x; cvy = speedOrVel.y; cvz = speedOrVel.z; }
        const sp = 34 + Math.random() * 10;
        this.steam.emit(this.v.x, this.v.y, this.v.z,
          cvx * 0.8 + this.f.x * sp + (Math.random() - 0.5) * 3, cvy * 0.5 + this.f.y * sp + Math.random() * 1.5, cvz * 0.8 + this.f.z * sp + (Math.random() - 0.5) * 3,
          1.4 + Math.random() * 1.4, 0.35, 4 + Math.random() * 3, 0.36, { drag: 2.4, buoy: 1.0, spread: 1 });
      }
    }
    tyreSmoke(x, z, amount, dt, vx, vz) {
      const n = this._n('ty' + Math.round(x * 3), 14 * this.rate * amount, dt);
      for (let k = 0; k < n; k++) this.smoke.emit(x, 0.25, z, vx * 0.3 + (Math.random() - 0.5) * 1.5, 0.3 + Math.random() * 0.5, vz * 0.3 + (Math.random() - 0.5) * 1.5, 0.9 + Math.random() * 0.6, 0.4, 2.2, 0.12, { drag: 2, buoy: 0.3 });
    }
    burst(x, y, z, n, vx = 0, vy = 0, vz = 0, power = 8) {
      for (let k = 0; k < n; k++) {
        this.sparks.emit(x, y, z, vx * 0.4 + (Math.random() - 0.5) * power, vy + Math.random() * power * 0.7, vz * 0.4 + (Math.random() - 0.5) * power,
          0.3 + Math.random() * 0.5, 0.18, 0.05, 1, { drag: 0.8, buoy: 0, grav: 14, spread: 2, spin: 0 });
      }
    }
    update(dt) { this.steam.update(dt); this.smoke.update(dt); this.sparks.update(dt); this.leaves.update(dt); }
  }

  // ---------------- game ----------------
  class Game {
    constructor() {
      this.settings = Object.assign({}, DEFAULTS, G.store.get('settings', {}));
      this.Q = QUALITY[this.settings.quality] || QUALITY.high;
      this.state = 'loading';
      this.mode = 'race';
      this.timeScale = 1;
      this.score = 0; this.combo = 1; this.comboT = 0;
      this.raceTime = 0; this.bestKey = this.settings.track === 'highway' ? 'bestLap_highway' : 'bestLap'; // lap records are per circuit
      this.bestLap = G.store.get(this.bestKey, 1e9);
      this.pickups = [];
      this.camMode = this.settings.camera | 0;
      this.camYaw = 0; this.camFocusY = 0; this.shake = 0;
      this.place = 1; this.racers = 1; this.lap = 1; this.laps = 3;
      this.t = 0;
    }

    async boot() {
      const S = this.settings, Q = this.Q;
      $('load-text').textContent = 'Building the city…';
      await new Promise((r) => setTimeout(r, 30));
      // renderer
      const canvas = $('c');
      const renderer = (this.renderer = new T.WebGLRenderer({ canvas, antialias: Q.aa, powerPreference: 'high-performance' }));
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.pr));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      renderer.toneMapping = T.ACESFilmicToneMapping;
      renderer.toneMappingExposure = G.TOD[S.tod].exposure;
      renderer.outputColorSpace = T.SRGBColorSpace;
      renderer.shadowMap.enabled = Q.shadows;
      renderer.shadowMap.type = T.PCFSoftShadowMap;
      G.maxAniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());

      this.scene = new T.Scene();
      this.camera = new T.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3500);

      // track & world
      G.setTrack(S.track);
      const track = (this.track = new G.Track());
      const L = track.length;
      const rampAt = [0.12, 0.25, 0.37, 0.5, 0.63, 0.77, 0.9];
      rampAt.forEach((f, i) => {
        // find a low-curvature spot near f
        let best = f * L, bk = 1e9;
        for (let d = -150; d <= 150; d += 10) { const k = track.curvatureAt(f * L + d); if (k < bk) { bk = k; best = f * L + d; } }
        const F = G.LANES_FWD; // wide roads: scatter them across the lanes
        track.addRamp(best, F[(i * (F.length > 3 ? 3 : 1)) % F.length], 15, 7, i % 3 === 2 ? 3.4 : 2.7);
      });
      track.buildMeshes(this.scene, Q);
      $('load-text').textContent = 'Lighting the streets…';
      await new Promise((r) => setTimeout(r, 10));
      this.city = G.buildCity(this);

      // player
      this.playerModel = G.buildRoadster(0xd9dcdf, { shadows: Q.shadows });
      this.scene.add(this.playerModel.group);
      this.player = new G.Player(this, this.playerModel);
      this.headlights = [];
      if (Q.lights) {
        for (const sx of [-0.62, 0.62]) {
          const sl = new T.SpotLight(0xf2f5ff, S.tod === 'night' ? 480 : 220, 140, 0.42, 0.7, 1.6);
          sl.position.set(sx, 0.55, -2.2);
          const tg = new T.Object3D(); tg.position.set(sx * 2.5, -1.5, -30);
          this.playerModel.group.add(sl, tg); sl.target = tg; this.headlights.push(sl);
        }
        this.jetLight = new T.PointLight(0x7fd0ff, 0, 18, 1.6);
        this.jetLight.position.set(0, -0.3, 0);
        this.playerModel.group.add(this.jetLight);
      }
      // live reflections on the player's paint and glass (high/ultra): a low-res cube camera riding with the car
      if (Q.level >= 4) {
        this.reflRT = new T.WebGLCubeRenderTarget(Q.level >= 5 ? 256 : 128, { type: T.HalfFloatType });
        this.reflCam = new T.CubeCamera(0.5, 450, this.reflRT);
        this.scene.add(this.reflCam);
        const pm = this.playerModel;
        pm.paint.envMap = pm.glass.envMap = this.reflRT.texture;
        pm.paint.envMapIntensity = 1.4;
        this.reflN = 0;
      }
      this.fx = new FX(this);
      this.buildPickups();

      // post
      this.setupPost();

      this.hud = new G.HUD(this);
      this.input = new G.Input();
      this.input.autoAccel = S.autoAccel; this.input.sens = S.sens; this.input.thrInvert = S.thrInvert;
      if (S.keys) this.input.setBinds(Object.assign(G.defaultKeys(), S.keys));
      if (S.tilt && G.isTouch) this.input.enableTilt(true);
      const useTouch = S.touchUI === 'on' || (S.touchUI === 'auto' && G.isTouch);
      if (useTouch) { document.body.classList.add('touch'); this.input.buildTouch($('touch')); }
      $('fps').classList.toggle('hidden', !S.showFps);

      this.wireUI();
      window.addEventListener('resize', () => this.resize());
      document.addEventListener('visibilitychange', () => { if (document.hidden && (this.state === 'race' || this.state === 'countdown')) this.pause(true); });

      // park on the grid for the menu
      this.player.place(L - 18, 5.4, 0);
      this.traffic = new G.Traffic(this, S.traffic);
      this.rivals = null;
      this.toMenu();
      let auto = null;
      try { auto = sessionStorage.getItem('rt-autostart'); sessionStorage.removeItem('rt-autostart'); } catch (e) { /* ignore */ }
      if (auto === 'race' || auto === 'free') this.startRace(auto);
      $('loading').classList.add('hidden');
      this.last = performance.now();
      renderer.setAnimationLoop((t) => this.frame(t));
    }

    setupPost() {
      const Q = this.Q, r = this.renderer;
      this.composer = null;
      if (!Q.bloom) return;
      const c = (this.composer = new EffectComposer(r));
      c.setPixelRatio(r.getPixelRatio());
      c.setSize(window.innerWidth, window.innerHeight);
      c.addPass(new RenderPass(this.scene, this.camera));
      // glow only from things that emit light (lamps, neon, headlights, jets): the threshold sits above anything a
      // lit surface or a wet-road reflection reaches, and the halo is kept small and soft
      this.bloom = new UnrealBloomPass(new T.Vector2(window.innerWidth, window.innerHeight), 0.22, 0.18, 1.35);
      c.addPass(this.bloom);
      if (Q.blur) { this.radial = new ShaderPass(RadialShader); c.addPass(this.radial); }
      c.addPass(new OutputPass());
    }

    resize() {
      const w = window.innerWidth, h = window.innerHeight;
      if (w === this._w && h === this._h) return;
      this._w = w; this._h = h;
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
      if (this.composer) this.composer.setSize(w, h);
    }

    buildPickups() {
      const tr = this.track;
      const geo = new T.CylinderGeometry(0.42, 0.42, 1.3, 16);
      const mat = new T.MeshStandardMaterial({ color: 0x9fdcff, emissive: 0x2a9cff, emissiveIntensity: 2.2, metalness: 0.6, roughness: 0.25 });
      const ringMat = new T.MeshBasicMaterial({ color: new T.Color(0.5, 2.5, 5), toneMapped: false });
      const ringGeo = new T.TorusGeometry(0.9, 0.06, 8, 32);
      const spots = [];
      for (let s = 200; s < tr.length - 100; s += 280) spots.push({ s, lat: G.pick(G.LANES_FWD), y: 1.3 });
      for (const r of tr.ramps) spots.push({ s: r.s + 30, lat: r.lat, y: 7 }); // reward the air
      for (const sp of spots) {
        const g = new T.Group();
        const can = new T.Mesh(geo, mat); g.add(can);
        const cap = new T.Mesh(new T.CylinderGeometry(0.2, 0.42, 0.25, 16), mat); cap.position.y = 0.77; g.add(cap);
        const ring = new T.Mesh(ringGeo, ringMat); ring.rotation.x = Math.PI / 2; g.add(ring);
        const p = tr.pointAt(sp.s, sp.lat, {});
        g.position.set(p.x, sp.y, p.z);
        this.scene.add(g);
        this.pickups.push({ g, ring, x: p.x, y: sp.y, z: p.z, active: true, t: 0 });
      }
    }

    // ---------------- UI ----------------
    wireUI() {
      const S = this.settings;
      const click = (id, fn) => $(id).addEventListener('click', (e) => { G.audio.init(); G.audio.tone(700, 0.05, 0.08, 'triangle'); fn(e); });
      click('btn-race', () => this.showPanel('setup', 'race'));
      click('btn-free', () => this.showPanel('setup', 'free'));
      click('btn-settings', () => this.showPanel('settings'));
      click('btn-controls', () => this.showPanel('controls'));
      document.querySelectorAll('[data-back]').forEach((b) => b.addEventListener('click', () => this.backPanel()));
      click('btn-go', () => {
        // another circuit means rebuilding the world: reload straight into the race
        if (S.track !== G.TRACK_ID) { try { sessionStorage.setItem('rt-autostart', this.pendingMode); } catch (e) { /* ignore */ } location.reload(); return; }
        this.startRace(this.pendingMode);
      });
      click('btn-pause', () => this.pause(true));
      click('btn-resume', () => this.pause(false));
      click('btn-restart', () => { this.pause(false, true); this.startRace(this.mode); });
      click('btn-quit', () => { this.pause(false, true); this.toMenu(); });
      click('btn-psettings', () => this.showPanel('settings'));
      click('btn-pcontrols', () => this.showPanel('controls'));
      click('btn-again', () => this.startRace(this.mode));
      click('btn-rmenu', () => this.toMenu());
      click('btn-cam', () => this.cycleCam());
      click('btn-full', () => this.fullscreen());
      click('rot-ok', () => $('rotate').classList.add('dismissed'));

      // segmented controls
      const seg = (id, key, conv = (v) => v) => {
        const el = $(id);
        if (!el) return; // an older cached index.html may not have this control yet
        const set = (v) => el.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === String(v)));
        set(S[key]);
        el.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { S[key] = conv(b.dataset.v); set(S[key]); this.saveSettings(key); }));
      };
      seg('s-traffic', 'traffic'); seg('s-laps', 'laps', Number); seg('s-rivals', 'rivals', Number); seg('s-diff', 'difficulty'); seg('s-tod', 'tod'); seg('s-track', 'track');
      seg('s-quality', 'quality'); seg('s-camera', 'camera', Number); seg('s-touch', 'touchUI');
      const tog = (id, key, after) => {
        const el = $(id); el.checked = !!S[key];
        el.addEventListener('change', () => { S[key] = el.checked; this.saveSettings(key); if (after) after(el.checked, el); });
      };
      tog('s-auto', 'autoAccel', (v) => (this.input.autoAccel = v));
      seg('s-thr', 'thrInvert', (v) => v === 'true');
      tog('s-fps', 'showFps', (v) => $('fps').classList.toggle('hidden', !v));
      tog('s-shake', 'shake');
      const rng = (id, key, after) => { const el = $(id); el.value = S[key]; el.addEventListener('input', () => { S[key] = Number(el.value); this.saveSettings(key); after && after(S[key]); }); };
      rng('s-vol', 'vol', (v) => G.audio.setVolume(v));
      rng('s-sens', 'sens', (v) => (this.input.sens = v));
      G.audio.setVolume(S.vol);
      this.wireControls();
      this.updateBestUI();
    }

    // CONTROLS panel: thruster direction, touch steering (stick / tilt), rebindable keyboard
    wireControls() {
      const S = this.settings, inp = this.input;
      $('ctl-touch').classList.toggle('hidden', !G.isTouch);
      $('ctl-keys').classList.toggle('hidden', G.isMobile);
      const thrHint = () => {
        const k = (a) => (G.isMobile ? '' : G.keyName((inp.binds[a] || [])[0]) + ' / ') + (a === 'thrL' ? 'L' : 'R');
        $('thr-hint').textContent = S.thrInvert
          ? `${k('thrL')} fires the LEFT thruster and pushes you right · ${k('thrR')} fires the right one and pushes you left.`
          : `${k('thrL')} slides you left · ${k('thrR')} slides you right.`;
      };
      thrHint();
      $('s-thr').addEventListener('click', () => { inp.thrInvert = S.thrInvert; thrHint(); });

      // steering: thumb stick or tilt (the tilt permission prompt on iOS needs this click)
      const steerEl = $('s-steer');
      const showSteer = () => {
        steerEl.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', b.dataset.v === (S.tilt ? 'tilt' : 'stick')));
        $('calib-row').classList.toggle('hidden', !S.tilt);
        $('steer-hint').textContent = S.tilt
          ? 'Turn the phone like a steering wheel. The stick zone still brakes (drag down) and accelerates if auto-accelerate is off.'
          : 'Drag anywhere on the left half of the screen to steer.';
      };
      steerEl.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
        const want = b.dataset.v === 'tilt';
        S.tilt = want; this.saveSettings('tilt'); showSteer();
        inp.enableTilt(want).then((ok) => {
          if (ok) { if (want) setTimeout(() => inp.calibrateTilt(), 300); return; }
          S.tilt = false; this.saveSettings('tilt'); showSteer();
          $('steer-hint').textContent = 'Tilt steering needs motion-sensor access, which was blocked on this device.';
        });
      }));
      $('btn-calib').addEventListener('click', () => { inp.calibrateTilt(); G.audio.tone(900, 0.05, 0.08, 'triangle'); });
      showSteer();

      // keyboard rebinding: two slots per action; a key belongs to one action at a time
      const box = $('keybinds');
      let pending = null;
      const save = () => { S.keys = inp.binds; G.store.set('settings', S); thrHint(); };
      const render = () => {
        box.innerHTML = G.KEY_ACTIONS.map(([id, label]) => `<div class="bind"><span>${label}</span>` +
          [0, 1].map((slot) => `<button data-a="${id}" data-s="${slot}" class="${pending && pending.id === id && pending.slot === slot ? 'wait' : ''}">` +
            (pending && pending.id === id && pending.slot === slot ? 'PRESS A KEY' : G.keyName((inp.binds[id] || [])[slot])) + '</button>').join('') + '</div>').join('');
      };
      const stop = () => { pending = null; inp.capture = null; render(); };
      box.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-a]');
        if (!b) return;
        pending = { id: b.dataset.a, slot: +b.dataset.s };
        render();
        inp.capture = (code) => {
          const binds = inp.binds, { id, slot } = pending;
          if (code === 'Escape') return stop();
          const list = (binds[id] || []).slice();
          if (code === 'Backspace' || code === 'Delete') list[slot] = null;
          else {
            for (const [a, codes] of Object.entries(binds)) binds[a] = (codes || []).map((c) => (c === code ? null : c)); // steal it from wherever it was
            list[slot] = code;
          }
          binds[id] = list;
          inp.setBinds(binds); save(); stop();
        };
      });
      $('btn-keys-reset').addEventListener('click', () => { inp.setBinds(G.defaultKeys()); S.keys = null; G.store.set('settings', S); stop(); thrHint(); });
      // leaving the panel mid-rebind cancels it
      document.querySelectorAll('#controls [data-back]').forEach((b) => b.addEventListener('click', () => { if (pending) stop(); }));
      render();
    }

    saveSettings(key) {
      G.store.set('settings', this.settings);
      if (key === 'quality' || key === 'touchUI') $('reload-note').classList.remove('hidden');
      if (key === 'tod') this.applyTod();
      if (key === 'camera') this.camMode = this.settings.camera;
    }

    // time of day applies live: sky, lights, fog, windows, exposure, headlights, steam tint
    applyTod() {
      const name = this.settings.tod, tod = G.TOD[name] || G.TOD.night;
      this.city.setTod(name);
      this.renderer.toneMappingExposure = tod.exposure;
      for (const sl of this.headlights) sl.intensity = tod.stars ? 480 : 220;
      this.fx.steam.mat.uniforms.uColor.value.setRGB(0.86, 0.9, 0.98).multiplyScalar(tod.steam);
      this.fx.smoke.mat.uniforms.uColor.value.setRGB(0.32, 0.32, 0.34).multiplyScalar(tod.steam);
    }

    showPanel(name, mode) {
      if (mode) { this.pendingMode = mode; $('setup-title').textContent = mode === 'race' ? 'STREET RACE' : 'FREE RIDE'; $('setup').classList.toggle('free', mode === 'free'); }
      this.panelStack = this.panelStack || [];
      const cur = document.querySelector('.panel.open');
      if (cur) { this.panelStack.push(cur.id); cur.classList.remove('open'); }
      $(name).classList.add('open');
    }
    backPanel() {
      const cur = document.querySelector('.panel.open');
      if (cur) cur.classList.remove('open');
      if (cur && cur.id === 'settings' && !$('reload-note').classList.contains('hidden')) { location.reload(); return; }
      const prev = (this.panelStack || []).pop();
      if (prev) $(prev).classList.add('open');
    }
    closePanels() { document.querySelectorAll('.panel.open').forEach((p) => p.classList.remove('open')); this.panelStack = []; }

    updateBestUI() { $('menu-best').textContent = this.bestLap < 1e8 ? 'Best lap  ' + G.fmtTime(this.bestLap) : ''; }

    fullscreen() {
      const d = document.documentElement;
      if (!document.fullscreenElement && d.requestFullscreen) {
        d.requestFullscreen({ navigationUI: 'hide' }).then(() => { if (screen.orientation && screen.orientation.lock) screen.orientation.lock('landscape').catch(() => {}); }).catch(() => {});
      } else if (document.exitFullscreen && document.fullscreenElement) document.exitFullscreen();
    }

    cycleCam() { this.camMode = (this.camMode + 1) % 3; this.settings.camera = this.camMode; G.store.set('settings', this.settings); }

    toMenu() {
      this.state = 'menu';
      this.closePanels();
      $('menu').classList.add('open');
      $('results').classList.remove('open');
      this.hud.show(false);
      document.body.classList.remove('playing');
      if (this.rivals) { this.rivals.dispose(); this.rivals = null; }
      this.player.place(this.track.length - 18, 5.4, 0);
      this.player.frozen = true;
      this.timeScale = 1;
      this.updateBestUI();
    }

    startRace(mode) {
      const S = this.settings, tr = this.track, L = tr.length;
      this.mode = mode;
      this.closePanels();
      $('results').classList.remove('open');
      G.audio.init();
      if (G.isMobile && !document.fullscreenElement) this.fullscreen();
      // rebuild traffic & rivals
      if (this.traffic) this.traffic.dispose();
      this.traffic = S.traffic === 'off' ? null : new G.Traffic(this, S.traffic);
      if (this.rivals) { this.rivals.dispose(); this.rivals = null; }
      const nR = mode === 'race' ? S.rivals : 0;
      this.racers = nR + 1;
      this.laps = mode === 'race' ? S.laps : 0;
      const slots = [];
      for (let k = 0; k < this.racers; k++) slots.push({ ds: -12 - Math.floor(k / 2) * 10 - (k % 2) * 4, lat: G.TRACK.grid[k % 2] });
      const pSlot = mode === 'race' ? Math.min(this.racers - 1, Math.floor(this.racers / 2)) : 0;
      const ps = slots.splice(pSlot, 1)[0];
      this.player.place(ps.ds, ps.lat, 0);
      this.player.fuel = 100; this.player.fuelLock = false; this._fuelFull = true; this._fuelLock = false;
      this.player.frozen = true;
      this.progress = ps.ds;
      this.lastS = G.wrap(ps.ds, L);
      if (nR > 0) { this.rivals = new G.Rivals(this, nR); this.rivals.grid(0, slots); }
      this.lap = 1; this.lapStart = 0; this.lastLapIdx = 0; this.lapTimes = [];
      this.raceTime = 0; this.score = 0; this.combo = 1; this.comboT = 0; this.finished = false;
      this.airT = 0; this.driftT = 0; this.driftScore = 0;
      for (const p of this.pickups) { p.active = true; p.g.visible = true; }
      this.city.resetTrees();
      this.hud.show(true); this.hud.setMode(mode === 'race');
      $('menu').classList.remove('open');
      document.body.classList.add('playing');
      this.input.calibrateTilt();
      this.state = 'countdown';
      this.cdT = mode === 'race' ? 3.999 : 1.5;
      this.cdLast = -1;
      this.camIntro = 0;
    }

    pause(on, silent) {
      if (on) {
        if (this.state !== 'race' && this.state !== 'countdown' && this.state !== 'wreck') return;
        this.prevState = this.state; this.state = 'paused';
        $('pause').classList.add('open');
        G.audio.update(null, false);
      } else if (this.state === 'paused') {
        this.state = this.prevState;
        this.closePanels();
        this.last = performance.now();
      }
      if (silent) this.closePanels();
    }

    resetPlayer() {
      if (this.state !== 'race' && this.state !== 'countdown') return;
      const n = this.player.near;
      const lat = G.LANES_FWD.reduce((a, b) => (Math.abs(b - n.lat) < Math.abs(a - n.lat) ? b : a));
      // find a free spot in that lane
      let s = n.s;
      if (this.traffic) for (let k = 0; k < 10; k++) {
        const blocked = this.traffic.cars.some((c) => Math.abs(c.lat - lat) < 2.5 && this.traffic.zoneDist(c.s, s) < c.t.len / 2 + 6);
        if (!blocked) break; s += 12;
      }
      this.player.place(s, lat, Math.min(this.player.speed * 0.6, 30));
      this.player.fuel = Math.max(this.player.fuel, 30);
      this.hud.popup('RESET', '', 'warn');
    }

    wreck() {
      if (this.state !== 'race') return;
      this.state = 'wreck';
      this.wreckT = 0;
      this.hud.message('WRECKED!', 1400);
      this.combo = 1;
      if (navigator.vibrate) try { navigator.vibrate([60, 40, 120]); } catch (e) { /* ignore */ }
    }

    // ---------------- events ----------------
    addScore(pts, n2, text, sub, cls) {
      this.combo = Math.min(10, this.comboT > 0 ? this.combo + 1 : 1);
      this.comboT = 4;
      const total = Math.round(pts * this.combo);
      this.score += total;
      this.player.fuel = Math.min(100, this.player.fuel + n2);
      this.hud.popup(text, (sub ? sub + '  ' : '') + '+' + total + (n2 ? `  ·  N₂ +${n2}` : ''), cls);
      G.audio.stunt();
    }
    onNearMiss(c, edge, oncoming) {
      const close = edge < 0.6;
      this.addScore((oncoming ? 250 : 150) * (close ? 1.5 : 1), oncoming ? 9 : 6, oncoming ? 'ONCOMING NEAR MISS' : close ? 'RAZOR CLOSE' : 'NEAR MISS', c.t.name);
      G.audio.whoosh();
    }
    onJumpOver(c) {
      this.addScore(c.t.bonus, 8 + Math.round(c.t.bonus / 80), `JUMPED A ${c.t.name}!`, '', 'big');
    }
    onTrafficHit(c, vrel, x, y, z) {
      this.fx.burst(x, y, z, Math.min(60, 6 + vrel * 1.5), this.player.vel.x, 2, this.player.vel.z, 6 + vrel * 0.2);
      G.audio.impact(vrel);
      this.addShake(Math.min(1, vrel / 25));
      if (vrel > 6) { this.combo = 1; this.comboT = 0; }
      if (navigator.vibrate && vrel > 5) try { navigator.vibrate(Math.min(120, vrel * 4)); } catch (e) { /* ignore */ }
      if (vrel > 38 && c.t.mass > 1000) this.wreck();
      else if (vrel > 8) this.hud.popup(c.loose ? 'TAKEDOWN' : 'CRASH', c.t.name, 'warn');
    }
    onWallHit(pos, vn, vt) {
      if (vn < 2.5) return;
      this.fx.burst(pos.x, pos.y + 0.4, pos.z, Math.min(40, vn * 3), this.player.vel.x, 1, this.player.vel.z, 5);
      G.audio.impact(vn);
      this.addShake(Math.min(0.8, vn / 20));
      if (vn > 8) { this.combo = 1; this.comboT = 0; }
    }
    onScrape(p, v) {
      this._scr = (this._scr || 0) + 1;
      if (this._scr % 3 === 0) this.fx.burst(p.x, p.y, p.z, 2, this.player.vel.x, 0.5, this.player.vel.z, 4);
    }
    onRivalHit(r, hit) {
      const d = r.pos.distanceTo(this.player.pos);
      if (d < 80) { this.fx.burst(r.pos.x, r.pos.y + 0.6, r.pos.z, 20, 0, 2, 0, 6); G.audio.impact(hit * Math.max(0.1, 1 - d / 80)); }
    }
    // the player touched another roadster (only the player's body reports here)
    onCarHit(self, other, v, x, y, z) {
      if (v < 2) return;
      G.audio.impact(v); this.fx.burst(x, y, z, Math.min(40, 6 + v * 1.5), self.vel.x, 2, self.vel.z, 5);
      this.addShake(Math.min(0.7, v / 20));
      if (v > 8) { this.combo = 1; this.comboT = 0; }
    }
    // any roadster (player or rival) snapped a street tree: wood chips and leaves; the player also feels it
    onTreeHit(body, tree, v) {
      const d = body.pos.distanceTo(this.player.pos);
      if (d < 90) {
        const fx = this.fx;
        for (let k = 0; k < 26; k++) {
          fx.leaves.emit(tree.x + (Math.random() - 0.5) * 3, 3 + Math.random() * 4, tree.z + (Math.random() - 0.5) * 3,
            body.vel.x * 0.3 + (Math.random() - 0.5) * 6, Math.random() * 3, body.vel.z * 0.3 + (Math.random() - 0.5) * 6,
            1.6 + Math.random() * 1.6, 0.35, 0.25, 1, { drag: 1.6, buoy: 0, grav: 3, spin: 6 });
        }
        fx.burst(tree.x, 0.9, tree.z, 10, body.vel.x, 1.5, body.vel.z, 4);
        G.audio.impact(Math.min(30, v * 0.6) * Math.max(0.15, 1 - d / 90));
      }
      if (body !== this.player) return;
      this.addShake(Math.min(0.7, v / 40));
      if (navigator.vibrate) try { navigator.vibrate(Math.min(90, 20 + v * 1.5)); } catch (e) { /* ignore */ }
      this.combo = 1; this.comboT = 0;
      if (this.state === 'race' || this.state === 'finished') this.hud.popup('TIMBER!', 'tree down', 'warn');
    }
    // N₂ meter cues: one sound as it runs dry, one when it is back to 100%
    fuelCues(p) {
      const full = p.fuel >= 99.5;
      if (p.fuelLock && !this._fuelLock) G.audio.fuelEmpty();
      if (full && this._fuelFull === false) G.audio.fuelFull();
      this._fuelLock = p.fuelLock; this._fuelFull = full;
    }
    addShake(a) { if (this.settings.shake) this.shake = Math.max(this.shake, a); }

    // ---------------- loop ----------------
    frame(now) {
      if (window.innerWidth !== this._w || window.innerHeight !== this._h) this.resize();
      let dt = Math.max(0, Math.min(0.05, (now - this.last) / 1000));
      this.last = now;
      if (this.state === 'paused') { this.consumeEvents(); this.render(0); return; }
      dt *= this.timeScale;
      this.t += dt;
      const p = this.player;
      const inp = this.input.update(dt, !p.grounded && p.altitude > 0.8);
      this.consumeEvents();

      const st = this.state;
      if (st === 'countdown') this.updateCountdown(dt);
      if (st === 'wreck') {
        this.wreckT += dt / Math.max(this.timeScale, 0.01);
        this.timeScale = this.wreckT < 1.0 ? 0.3 : 1;
        if (this.wreckT > 1.6) { this.timeScale = 1; this.state = 'race'; this.resetPlayer(); }
      }
      const driving = st === 'race' || st === 'countdown' || st === 'finished' || st === 'wreck';
      const ctrl = st === 'race' || st === 'finished' ? inp : NO_INPUT;
      if (st === 'countdown') { p.frozen = true; }
      else if (st !== 'menu') p.frozen = false;

      // physics substeps
      const h = 1 / 120;
      this.acc = (this.acc || 0) + dt;
      let steps = 0;
      while (this.acc >= h && steps < 8) {
        p.step(h, ctrl);
        if (this.traffic) this.traffic.collidePlayer(p);
        if (this.rivals) this.rivals.step(h); // same physics, traffic and car-vs-car rules as the player
        this.acc -= h; steps++;
      }
      if (steps === 8) this.acc = 0;
      p.syncModel();
      p.yawVis = Math.atan2(-(new T.Vector3(0, 0, -1).applyQuaternion(p.q).x), -(new T.Vector3(0, 0, -1).applyQuaternion(p.q).z));

      // progress
      const L = this.track.length;
      let ds = p.near.s - this.lastS;
      if (ds > L / 2) ds -= L; else if (ds < -L / 2) ds += L;
      this.lastS = p.near.s;
      if (Math.abs(ds) < 40) this.progress += ds;

      if (this.traffic && st !== 'countdown') {
        this.traffic.update(dt, p, p.near.s);
        if (st === 'race' || st === 'finished') this.traffic.detectStunts(p);
      }
      if (this.rivals) this.rivals.update(dt, st === 'race' || st === 'finished' || st === 'wreck', p, this.progress);

      if (st === 'race') this.updateRace(dt);
      if (driving) this.updateStunts(dt, ctrl);
      this.updatePickups(dt);
      this.updatePlayerFX(dt, ctrl);
      this.fx.update(dt);
      this.updateCamera(dt);
      this.city.update(dt, this.camera.position, p.pos);
      if (driving) this.hud.update(dt, this);
      if (driving) this.fuelCues(p);
      p.throttle = ctrl.throttle;
      p.ambThrust = 0;
      if (this.rivals) for (const r of this.rivals.list) { const d = r.pos.distanceTo(p.pos); if (d < 60) p.ambThrust += (r.th.L + r.th.B) * (1 - d / 60) * 0.3; }
      G.audio.update(p, driving && st !== 'paused');
      this.render(dt);
    }

    consumeEvents() {
      for (const e of this.input.consume()) {
        if (e === 'pause') { if (this.state === 'paused') this.pause(false); else this.pause(true); }
        else if (e === 'camera') this.cycleCam();
        else if (e === 'reset') this.resetPlayer();
        else if (e === 'mute') this.hud.message(G.audio.toggleMute() ? 'MUTED' : 'SOUND ON', 900);
        else if (e === 'fullscreen') this.fullscreen();
        else if (e === 'hud') document.body.classList.toggle('nohud');
      }
    }

    updateCountdown(dt) {
      this.cdT -= dt;
      this.camIntro = Math.min(1, this.camIntro + dt / 2.6);
      const n = Math.ceil(this.cdT);
      if (this.mode === 'race' && n !== this.cdLast && n >= 1 && n <= 3) { this.hud.countdown(String(n)); G.audio.beep(false); }
      this.cdLast = n;
      if (this.cdT <= 0) {
        this.state = 'race';
        this.hud.countdown('GO!', true);
        G.audio.beep(true);
        this.camIntro = 1;
        if (this.input.state.throttle > 0.5) { // launch boost
          const f = new T.Vector3(0, 0, -1).applyQuaternion(this.player.q);
          this.player.vel.addScaledVector(f, 9);
          this.hud.popup('LAUNCH!', '', '');
        }
      }
    }

    updateRace(dt) {
      this.raceTime += dt;
      const L = this.track.length;
      if (this.mode === 'race') {
        const lapIdx = Math.floor(this.progress / L);
        if (lapIdx > this.lastLapIdx && this.progress > 0) {
          this.lastLapIdx = lapIdx;
          const lt = this.raceTime - this.lapStart;
          this.lapStart = this.raceTime;
          this.lapTimes.push(lt);
          const isBest = lt < this.bestLap && lt > 25;
          if (isBest) { this.bestLap = lt; G.store.set(this.bestKey, lt); }
          if (lapIdx >= this.laps) { this.finish(); return; }
          this.hud.message(lapIdx === this.laps - 1 ? 'FINAL LAP' : `LAP ${lapIdx + 1}`, 1600);
          this.hud.popup('LAP ' + G.fmtTime(lt), isBest ? 'NEW BEST' : '', isBest ? 'big' : '');
        }
        this.lap = Math.max(1, lapIdx + 1);
        let place = 1;
        if (this.rivals) for (const r of this.rivals.list) {
          if (r.finished) { place++; continue; }
          if (r.s > this.progress) place++;
          if (r.s >= this.laps * L && !r.finished) { r.finished = true; r.finishTime = this.raceTime; }
        }
        this.place = place;
      }
    }

    finish() {
      this.state = 'finished';
      this.finished = true;
      const L = this.track.length;
      const rows = [{ name: 'YOU', time: this.raceTime, me: true }];
      if (this.rivals) for (const r of this.rivals.list) {
        const t = r.finished ? r.finishTime : this.raceTime + (this.laps * L - r.s) / Math.max(r.v, 35);
        rows.push({ name: r.name, time: t, color: r.color });
      }
      rows.sort((a, b) => a.time - b.time);
      const myPlace = rows.findIndex((r) => r.me) + 1;
      this.hud.message(myPlace === 1 ? 'YOU WIN!' : `FINISHED P${myPlace}`, 2500);
      $('res-title').textContent = myPlace === 1 ? 'VICTORY' : `P${myPlace} OF ${rows.length}`;
      $('res-rows').innerHTML = rows.map((r, i) => `<div class="row ${r.me ? 'me' : ''}"><span class="p">${i + 1}</span><span class="dot" style="background:${r.me ? '#ff2a3c' : '#' + r.color.toString(16).padStart(6, '0')}"></span><span class="n">${r.name}</span><span class="t">${G.fmtTime(r.time)}</span></div>`).join('');
      $('res-stats').innerHTML = `<div><b>${this.score.toLocaleString()}</b><small>STUNT SCORE</small></div><div><b>${G.fmtTime(Math.min(...this.lapTimes))}</b><small>BEST LAP</small></div><div><b>${G.fmtTime(this.bestLap)}</b><small>ALL-TIME BEST</small></div>`;
      setTimeout(() => { if (this.state === 'finished') { $('results').classList.add('open'); document.body.classList.remove('playing'); } }, 2600);
    }

    updateStunts(dt) {
      const p = this.player;
      if (this.comboT > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 1; }
      // airtime & tricks
      const air = !p.grounded && p.altitude > 0.9;
      if (air) { this.airT += dt; }
      else if (this.airT > 0) {
        const at = this.airT;
        const rolls = Math.floor(Math.abs(p.rollAcc) / (Math.PI * 2) + 0.2);
        const flips = Math.floor(Math.abs(p.pitchAcc) / (Math.PI * 2) + 0.2);
        const upright = new T.Vector3(0, 1, 0).applyQuaternion(p.q).y > 0.6;
        if (upright && this.state !== 'wreck') {
          if (rolls > 0) this.addScore(1200 * rolls, 15 * rolls, rolls > 1 ? `${rolls}x BARREL ROLL` : 'BARREL ROLL', '', 'big');
          if (flips > 0) this.addScore(1500 * flips, 18 * flips, flips > 1 ? `${flips}x FLIP` : 'FLIP', '', 'big');
          if (at > 1.0) this.addScore(Math.round(at * 220), Math.round(at * 4), 'AIR ' + at.toFixed(1) + 's', '');
        }
        if (at > 0.5) { G.audio.land(Math.abs(p.vel.y) + at * 3); this.addShake(Math.min(0.5, at * 0.15)); }
        this.airT = 0;
      }
      if (p.grounded) { p.rollAcc = 0; p.pitchAcc = 0; }
      // drift
      const drifting = p.grounded && Math.abs(p.sideSlip) > 0.28 && p.speed > 14;
      if (drifting) { this.driftT += dt; this.driftScore += dt * p.speed * 2.5; }
      else if (this.driftT > 0) {
        if (this.driftT > 1.0) this.addScore(Math.round(this.driftScore), Math.round(this.driftT * 3), 'DRIFT ' + this.driftT.toFixed(1) + 's', '');
        this.driftT = 0; this.driftScore = 0;
      }
    }

    updatePickups(dt) {
      const p = this.player.pos;
      for (const k of this.pickups) {
        if (!k.active) { k.t -= dt; if (k.t <= 0) { k.active = true; k.g.visible = true; } continue; }
        k.g.rotation.y += dt * 2;
        k.g.position.y = k.y + Math.sin(this.t * 3 + k.x) * 0.25;
        k.ring.scale.setScalar(1 + 0.12 * Math.sin(this.t * 6));
        const dx = p.x - k.x, dy = p.y + 0.6 - k.g.position.y, dz = p.z - k.z;
        if (dx * dx + dy * dy + dz * dz < 9 && (this.state === 'race' || this.state === 'finished')) {
          k.active = false; k.g.visible = false; k.t = 14;
          this.player.fuel = Math.min(100, this.player.fuel + 35);
          this.hud.popup('N₂ CANISTER', '+35 N₂', 'blue');
          G.audio.pickup();
        }
      }
    }

    updatePlayerFX(dt, inp) {
      const p = this.player, m = this.playerModel;
      G.updateRoadsterFX(m, p.th, this.t, p.braking);
      m.group.updateMatrixWorld();
      if (p.th.L > 0.05 || p.th.R > 0.05) this.fx.steamUnder(m.group, p.th.L, p.th.R, p.altitude, dt, p.vel);
      if (p.th.B > 0.05) this.fx.steamRear(m.group, p.th.B, dt, p.vel);
      if (this.jetLight) this.jetLight.intensity = (p.th.L + p.th.R) * 40 + p.th.B * 25 + (p.th.SL + p.th.SR) * 20;
      // faint tyre haze only in real slides (drifts) — the white clouds come from the thrusters alone
      if (p.grounded && Math.abs(p.sideSlip) > 0.35 && p.speed > 12) {
        const amt = Math.min(1, Math.abs(p.sideSlip) - 0.3);
        for (const i of [2, 3]) {
          const w = p.wheels[i];
          if (!w.contact) continue;
          const v = new T.Vector3(w.x, 0.2, w.z).applyQuaternion(p.q).add(p.pos);
          this.fx.tyreSmoke(v.x, v.z, amt, dt, p.vel.x, p.vel.z);
        }
      }
    }

    updateCamera(dt) {
      const cam = this.camera, p = this.player;
      const realDt = dt / Math.max(this.timeScale, 0.05);
      const f = new T.Vector3(0, 0, -1).applyQuaternion(p.q);
      let fx = f.x, fz = f.z;
      const fl = Math.hypot(fx, fz);
      if (fl < 0.3 && p.speed > 3) { fx = p.vel.x; fz = p.vel.z; }
      const targetYaw = Math.atan2(-fx, -fz);
      this.camFocusY = G.damp(this.camFocusY, p.pos.y, p.grounded ? 12 : 5, realDt);

      if (this.state === 'menu') {
        const a = this.t * 0.18;
        cam.position.set(p.pos.x + Math.sin(a) * 7.5, p.pos.y + 1.9 + Math.sin(this.t * 0.3) * 0.4, p.pos.z + Math.cos(a) * 7.5);
        cam.lookAt(p.pos.x, p.pos.y + 0.7, p.pos.z);
        cam.fov = 50; cam.updateProjectionMatrix();
        this.camYaw = targetYaw;
        if (this.radial) this.radial.uniforms.uAmount.value = 0;
        return;
      }

      this.camYaw = G.dampAngle(this.camYaw, targetYaw, p.grounded ? 6 : 2.5, realDt);
      const spdF = G.clamp(p.speed / 100, 0, 1.4);
      const mode = this.camMode;
      if (mode === 2) {
        const v = new T.Vector3(0, 1.0, -0.3).applyQuaternion(p.q).add(p.pos);
        cam.position.copy(v);
        cam.quaternion.copy(p.q);
      } else {
        // raised chase cam, tilted down a touch so the road ahead stays in view over the car
        const dist = (mode === 0 ? 7.0 : 11.0) + spdF * 1.6;
        const hgt = (mode === 0 ? 3.0 : 4.6) - spdF * 0.25;
        const sy = Math.sin(this.camYaw), cy = Math.cos(this.camYaw);
        let cx = p.pos.x + sy * dist, cz = p.pos.z + cy * dist;
        // keep camera inside the street canyon
        const n = this.track.nearest(cx, cz, p.near.i, this._cn || (this._cn = {}));
        if (Math.abs(n.lat) > 15) { const k = Math.abs(n.lat) - 15; cx -= n.rx * Math.sign(n.lat) * k; cz -= n.rz * Math.sign(n.lat) * k; }
        let cyPos = this.camFocusY + hgt;
        if (this.state === 'countdown' && this.mode === 'race') {
          // intro swoop from the side
          const k = 1 - Math.pow(1 - this.camIntro, 3);
          const a = this.camYaw + (1 - k) * 2.2;
          cx = G.lerp(p.pos.x + Math.sin(a) * 11, cx, k); cz = G.lerp(p.pos.z + Math.cos(a) * 11, cz, k);
          cyPos = G.lerp(p.pos.y + 3.4, cyPos, k);
        }
        cam.position.set(cx, cyPos, cz);
        cam.lookAt(p.pos.x - sy * 6, this.camFocusY + 0.9, p.pos.z - cy * 6);
      }
      // shake
      const thr = p.th.B * 0.6 + (p.th.L + p.th.R) * 0.2;
      const sh = (this.settings.shake ? thr * 0.05 : 0) + this.shake * 0.35;
      if (sh > 0.001) { cam.position.x += (Math.random() - 0.5) * sh; cam.position.y += (Math.random() - 0.5) * sh; cam.position.z += (Math.random() - 0.5) * sh; }
      this.shake = Math.max(0, this.shake - realDt * 2.5);
      const fov = (mode === 2 ? 72 : 60) + Math.min(28, p.speed * 0.17) + p.th.B * 6;
      cam.fov = G.damp(cam.fov, fov, 4, realDt);
      cam.updateProjectionMatrix();
      if (this.radial) this.radial.uniforms.uAmount.value = G.clamp((p.speed - 45) / 90, 0, 1) * 0.045 + p.th.B * 0.03;
    }

    render() {
      if (this.reflCam && this.reflN++ % (this.Q.level >= 5 ? 2 : 3) === 0) {
        const grp = this.playerModel.group, sm = this.renderer.shadowMap, au = sm.autoUpdate;
        grp.visible = false; sm.autoUpdate = false;
        this.reflCam.position.copy(grp.position).y += 0.9;
        this.reflCam.update(this.renderer, this.scene);
        grp.visible = true; sm.autoUpdate = au;
      }
      if (this.composer) this.composer.render(); else this.renderer.render(this.scene, this.camera);
    }
  }

  const NO_INPUT = { steer: 0, throttle: 0, brake: 0, handbrake: false, jump: false, thrL: false, thrR: false, boost: false, pitch: 0, rollAir: 0 };

  G.boot = function () {
    const game = (G.game = new Game());
    game.boot().catch((e) => { console.error(e); $('load-text').textContent = 'Error: ' + e.message; });
  };
})();
