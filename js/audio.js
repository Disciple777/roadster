// audio.js — fully synthesized sound: electric motor whine, thruster hiss/roar, wind, tyres, impacts
(function () {
  class Audio {
    constructor() { this.ctx = null; this.vol = G.store.get('vol', 0.7); this.muted = false; }

    init() {
      if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain(); this.master.gain.value = this.vol;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
      this.master.connect(comp); comp.connect(ctx.destination);

      // noise buffer
      const len = ctx.sampleRate * 2, buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;
      const noise = () => { const n = ctx.createBufferSource(); n.buffer = buf; n.loop = true; n.start(); return n; };

      // motor: two detuned oscillators + whine
      this.motorGain = ctx.createGain(); this.motorGain.gain.value = 0;
      const mf = ctx.createBiquadFilter(); mf.type = 'lowpass'; mf.frequency.value = 1800; mf.Q.value = 2;
      this.o1 = ctx.createOscillator(); this.o1.type = 'sawtooth';
      this.o2 = ctx.createOscillator(); this.o2.type = 'square';
      this.o3 = ctx.createOscillator(); this.o3.type = 'sine';
      const g1 = ctx.createGain(); g1.gain.value = 0.18; const g2 = ctx.createGain(); g2.gain.value = 0.08; const g3 = ctx.createGain(); g3.gain.value = 0.22;
      this.o1.connect(g1).connect(mf); this.o2.connect(g2).connect(mf); this.o3.connect(g3).connect(mf);
      mf.connect(this.motorGain).connect(this.master);
      this.mf = mf;
      this.o1.start(); this.o2.start(); this.o3.start();

      // thruster: roar (low noise) + hiss (band noise)
      this.thrGain = ctx.createGain(); this.thrGain.gain.value = 0;
      const lo = ctx.createBiquadFilter(); lo.type = 'lowpass'; lo.frequency.value = 380;
      const hi = ctx.createBiquadFilter(); hi.type = 'bandpass'; hi.frequency.value = 2600; hi.Q.value = 0.6;
      const loG = ctx.createGain(); loG.gain.value = 1.4; const hiG = ctx.createGain(); hiG.gain.value = 0.5;
      const n1 = noise(); n1.connect(lo).connect(loG).connect(this.thrGain);
      n1.connect(hi).connect(hiG).connect(this.thrGain);
      this.thrGain.connect(this.master);
      this.hiF = hi;

      // wind
      this.windGain = ctx.createGain(); this.windGain.gain.value = 0;
      const wf = ctx.createBiquadFilter(); wf.type = 'bandpass'; wf.frequency.value = 600; wf.Q.value = 0.4;
      noise().connect(wf).connect(this.windGain).connect(this.master);
      this.wf = wf;

      // tyre squeal
      this.tyreGain = ctx.createGain(); this.tyreGain.gain.value = 0;
      const tf = ctx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 1500; tf.Q.value = 8;
      noise().connect(tf).connect(this.tyreGain).connect(this.master);
      this.tf = tf;

      // rival / ambience thrusters (distance-based)
      this.ambGain = ctx.createGain(); this.ambGain.gain.value = 0;
      const af = ctx.createBiquadFilter(); af.type = 'lowpass'; af.frequency.value = 900;
      noise().connect(af).connect(this.ambGain).connect(this.master);
    }

    setVolume(v) { this.vol = v; G.store.set('vol', v); if (this.master) this.master.gain.value = this.muted ? 0 : v; }
    toggleMute() { this.muted = !this.muted; if (this.master) this.master.gain.value = this.muted ? 0 : this.vol; return this.muted; }
    suspend(b) { if (!this.ctx) return; if (b) this.ctx.suspend(); else this.ctx.resume(); }

    update(p, active) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime, k = 0.06;
      if (!active || !p) {
        for (const g of [this.motorGain, this.thrGain, this.windGain, this.tyreGain, this.ambGain]) g.gain.setTargetAtTime(0, t, 0.1);
        return;
      }
      const sp = Math.abs(p.fwdSpeed);
      const f = 70 + sp * 5.5;
      this.o1.frequency.setTargetAtTime(f, t, k);
      this.o2.frequency.setTargetAtTime(f * 1.505, t, k);
      this.o3.frequency.setTargetAtTime(380 + sp * 16, t, k);
      this.mf.frequency.setTargetAtTime(700 + sp * 30 + p.throttle * 1500, t, k);
      this.motorGain.gain.setTargetAtTime(0.05 + p.throttle * 0.14 + Math.min(sp / 90, 1) * 0.06, t, k);
      const th = Math.min(1.6, p.th.L + p.th.R + p.th.B * 1.2 + (p.th.SL + p.th.SR) * 0.7);
      this.thrGain.gain.setTargetAtTime(th * 0.42, t, 0.03);
      this.hiF.frequency.setTargetAtTime(1800 + th * 1200, t, 0.05);
      this.windGain.gain.setTargetAtTime(Math.min(0.5, (sp / 110) ** 2 * 0.5), t, 0.1);
      this.wf.frequency.setTargetAtTime(300 + sp * 8, t, 0.1);
      const sq = p.grounded ? G.clamp(p.slipMax * 0.6, 0, 0.32) * Math.min(1, sp / 8) : 0;
      this.tyreGain.gain.setTargetAtTime(sq, t, 0.05);
      this.ambGain.gain.setTargetAtTime(G.clamp(p.ambThrust || 0, 0, 0.3), t, 0.1);
    }

    // one-shots
    burst({ freq = 400, q = 1, dur = 0.3, gain = 0.5, type = 'lowpass', sweep = 0 } = {}) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const n = ctx.createBufferSource(); n.buffer = this.noiseBuf;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(40, freq * sweep), t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      n.connect(f).connect(g).connect(this.master);
      n.start(t, Math.random()); n.stop(t + dur + 0.05);
    }
    tone(freq, dur = 0.15, gain = 0.2, type = 'sine', slide = 0) {
      if (!this.ctx) return;
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }
    // contact is resolved 120x a second, so one crash reports many hits: play a bump at most every ~0.25 s
    // (a hit twice as hard may cut in after 0.1 s) and keep the loudest ones from stacking
    impact(s) {
      if (!this.ctx || s < 2.5) return;
      const now = this.ctx.currentTime, since = now - (this._impT || -9);
      if (since < 0.25 && !(since > 0.1 && s > (this._impS || 0) * 2)) return;
      this._impT = now; this._impS = s;
      const k = Math.min(1, s / 40) * (since < 0.5 ? 0.7 : 1);
      this.burst({ freq: 900, dur: 0.25 + k * 0.4, gain: 0.22 + k * 0.45 });
      this.tone(70 + Math.random() * 20, 0.3 + k * 0.3, 0.22 + k * 0.3, 'sine', 0.5);
      if (s > 12) this.burst({ freq: 3500, q: 2, type: 'bandpass', dur: 0.35, gain: 0.25 * k });
    }
    whoosh() { this.burst({ freq: 2500, q: 1.5, type: 'bandpass', dur: 0.45, gain: 0.35, sweep: 0.25 }); }
    pickup() { this.tone(660, 0.12, 0.18, 'triangle', 1.5); setTimeout(() => this.tone(990, 0.18, 0.15, 'triangle', 1.3), 70); }
    stunt() { this.tone(520, 0.1, 0.12, 'square', 1.6); }
    beep(hi) { this.tone(hi ? 880 : 440, hi ? 0.5 : 0.22, 0.22, 'square'); }
    // N₂ meter: a falling "power down" when it runs dry, a bright two-note chime when it is full again
    fuelEmpty() { this.tone(520, 0.35, 0.16, 'sawtooth', 0.35); setTimeout(() => this.tone(260, 0.3, 0.12, 'square', 0.5), 120); }
    fuelFull() { this.tone(880, 0.12, 0.13, 'triangle', 1.0); setTimeout(() => this.tone(1320, 0.22, 0.12, 'triangle', 1.0), 90); }
    land(s) { this.burst({ freq: 300, dur: 0.3, gain: Math.min(0.7, s / 15) }); }
  }
  G.audio = new Audio();
})();
