// particles.js — instanced billboard particles (steam, tyre smoke, sparks) + thruster jet plumes
(function () {
  const T = THREE;

  class Particles {
    constructor(scene, max, { texture, additive = false, color = new T.Color(1, 1, 1) } = {}) {
      this.max = max;
      const geo = new T.InstancedBufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
      geo.setAttribute('uv', new T.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
      geo.setIndex([0, 1, 2, 0, 2, 3]);
      this.off = new Float32Array(max * 3);
      this.dat = new Float32Array(max * 4); // size, alpha, rot, shade
      this.aOff = new T.InstancedBufferAttribute(this.off, 3).setUsage(T.DynamicDrawUsage);
      this.aDat = new T.InstancedBufferAttribute(this.dat, 4).setUsage(T.DynamicDrawUsage);
      geo.setAttribute('aOff', this.aOff);
      geo.setAttribute('aDat', this.aDat);
      geo.instanceCount = max;
      const uniforms = T.UniformsUtils.merge([T.UniformsLib.fog, { uColor: { value: color } }]);
      uniforms.map = { value: texture };
      this.mat = new T.ShaderMaterial({
        uniforms, fog: true, transparent: true, depthWrite: false,
        blending: additive ? T.AdditiveBlending : T.NormalBlending,
        vertexShader: `
          attribute vec3 aOff; attribute vec4 aDat;
          varying vec2 vUv; varying float vA; varying float vS; varying float vFogD;
          void main(){
            vUv = uv; vA = aDat.y; vS = aDat.w;
            vec4 mv = modelViewMatrix * vec4(aOff, 1.0);
            float c = cos(aDat.z), s = sin(aDat.z);
            vec2 p = position.xy * aDat.x;
            mv.xy += vec2(c*p.x - s*p.y, s*p.x + c*p.y);
            vFogD = -mv.z;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform sampler2D map; uniform vec3 uColor; uniform float fogDensity;
          varying vec2 vUv; varying float vA; varying float vS; varying float vFogD;
          void main(){
            vec4 t = texture2D(map, vUv);
            float fogF = 1.0 - exp(-fogDensity*fogDensity*vFogD*vFogD);
            float a = t.a * vA * (1.0 - fogF * 0.85);
            if (a < 0.002) discard;
            gl_FragColor = vec4(uColor * t.rgb * vS, a);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      });
      this.mesh = new T.Mesh(geo, this.mat);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 5;
      scene.add(this.mesh);
      this.vel = new Float32Array(max * 3);
      this.age = new Float32Array(max).fill(1);
      this.life = new Float32Array(max).fill(1);
      this.s0 = new Float32Array(max); this.s1 = new Float32Array(max);
      this.a0 = new Float32Array(max); this.rv = new Float32Array(max);
      this.drag = new Float32Array(max); this.buoy = new Float32Array(max);
      this.grav = new Float32Array(max); this.shade = new Float32Array(max);
      this.spread = new Uint8Array(max);
      this.head = 0; this.alive = 0;
    }

    emit(x, y, z, vx, vy, vz, life, s0, s1, a0, o = {}) {
      const i = this.head; this.head = (this.head + 1) % this.max;
      this.off[i * 3] = x; this.off[i * 3 + 1] = y; this.off[i * 3 + 2] = z;
      this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
      this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1; this.a0[i] = a0;
      this.dat[i * 4 + 2] = Math.random() * 6.28; this.rv[i] = (Math.random() - 0.5) * (o.spin ?? 1.2);
      this.drag[i] = o.drag ?? 2.0; this.buoy[i] = o.buoy ?? 0.6; this.grav[i] = o.grav ?? 0;
      this.shade[i] = o.shade ?? 1; this.spread[i] = o.spread ?? 1;
    }

    update(dt) {
      const off = this.off, dat = this.dat, vel = this.vel;
      for (let i = 0; i < this.max; i++) {
        if (this.age[i] >= this.life[i]) { dat[i * 4] = 0; continue; }
        const a = (this.age[i] += dt);
        const t = a / this.life[i];
        if (t >= 1) { dat[i * 4] = 0; continue; }
        const k = Math.exp(-this.drag[i] * dt);
        let vx = vel[i * 3] * k, vy = vel[i * 3 + 1] * k, vz = vel[i * 3 + 2] * k;
        vy += (this.buoy[i] - this.grav[i]) * dt;
        let x = off[i * 3] + vx * dt, y = off[i * 3 + 1] + vy * dt, z = off[i * 3 + 2] + vz * dt;
        const sz = this.s0[i] + (this.s1[i] - this.s0[i]) * (1 - (1 - t) * (1 - t));
        const floor = this.spread[i] === 2 ? 0.05 : sz * 0.28;
        if (y < floor) {
          y = floor;
          if (vy < 0) {
            if (this.spread[i] === 1) {
              // steam hitting the ground billows outward
              const sp = -vy * 0.75, hl = Math.hypot(vx, vz);
              let dx, dz;
              if (hl > 0.5) { dx = vx / hl; dz = vz / hl; } else { const r = Math.random() * 6.28; dx = Math.cos(r); dz = Math.sin(r); }
              const r2 = (Math.random() - 0.5) * 1.6, c = Math.cos(r2), s = Math.sin(r2);
              vx += (dx * c - dz * s) * sp; vz += (dx * s + dz * c) * sp; vy = 0;
            } else { vy = -vy * 0.3; vx *= 0.6; vz *= 0.6; }
          }
        }
        vel[i * 3] = vx; vel[i * 3 + 1] = vy; vel[i * 3 + 2] = vz;
        off[i * 3] = x; off[i * 3 + 1] = y; off[i * 3 + 2] = z;
        const fin = t < 0.06 ? t / 0.06 : 1;
        dat[i * 4] = sz;
        dat[i * 4 + 1] = this.a0[i] * fin * Math.pow(1 - t, 1.4);
        dat[i * 4 + 2] += this.rv[i] * dt;
        dat[i * 4 + 3] = this.shade[i];
      }
      this.aOff.needsUpdate = true; this.aDat.needsUpdate = true;
    }
  }
  G.Particles = Particles;

  // ---------- thruster jet plume material/geometry ----------
  let jetGeo = null;
  G.jetMaterial = function (color = new T.Color(0.55, 0.85, 1.6)) {
    return new T.ShaderMaterial({
      transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
      uniforms: { uColor: { value: color }, uI: { value: 0 }, uT: { value: 0 } },
      vertexShader: `varying float vL; varying vec3 vN; varying vec3 vV; varying float vAng;
        void main(){ vL = 1.0 - uv.y; vAng = uv.x; vec4 mv = modelViewMatrix * vec4(position,1.0);
        vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 uColor; uniform float uI; uniform float uT; varying float vL; varying vec3 vN; varying vec3 vV; varying float vAng;
        void main(){
          float e = abs(dot(normalize(vN), normalize(vV)));
          float core = pow(e, 2.5);
          float fl = 0.75 + 0.25 * sin(vL * 40.0 - uT * 60.0 + vAng * 6.28);
          float diamonds = 0.8 + 0.2 * sin(vL * 26.0 - uT * 12.0);
          float a = pow(1.0 - vL, 1.6) * uI * fl * diamonds;
          vec3 c = mix(uColor, vec3(1.6, 1.8, 2.2), core * (1.0 - vL));
          gl_FragColor = vec4(c * a * (0.35 + core), 1.0);
        }`,
    });
  };
  G.jetGeometry = function () {
    if (!jetGeo) {
      jetGeo = new T.CylinderGeometry(0.07, 0.3, 1, 14, 1, true);
      jetGeo.translate(0, -0.5, 0); // nozzle at origin, plume extends along -Y
    }
    return jetGeo;
  };
})();
