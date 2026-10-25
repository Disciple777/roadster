// city.js — sky, lighting, buildings with procedural windows, street lights, neon, landmarks
(function () {
  const T = THREE;

  const TOD = {
    night: {
      zenith: 0x03050d, horizon: 0x272a3c, glow: 0x553844, fog: 0x0e121e, fogDensity: 0.0021,
      hemiSky: 0x33405e, hemiGround: 0x151015, hemi: 0.55, moon: 0x9fb4ff, moonI: 0.7,
      sunDir: [-0.45, 0.6, -0.65], env: 0.45, litRatio: 0.34, win: 1.45, stars: 1, exposure: 1.05,
      lampPool: 0.65, steam: 0.85,
    },
    sunset: {
      zenith: 0x14183a, horizon: 0xff8a4a, glow: 0xffb070, fog: 0x7a5a6a, fogDensity: 0.0021,
      hemiSky: 0xffc8a0, hemiGround: 0x2a2030, hemi: 1.0, moon: 0xffb27a, moonI: 2.6,
      sunDir: [0.75, 0.16, -0.62], env: 0.9, litRatio: 0.22, win: 0.9, stars: 0, exposure: 0.9,
      lampPool: 0.35, steam: 1.05,
    },
  };
  G.TOD = TOD;

  G.buildCity = function (game) {
    const { scene, track, Q } = game;
    const tod = TOD[game.settings.tod] || TOD.night;
    const R = G.rng(1234);
    const city = { tod, update: null };

    // ---------- sky ----------
    const skyMat = new T.ShaderMaterial({
      side: T.BackSide, depthWrite: false, fog: false,
      uniforms: {
        uZen: { value: new T.Color(tod.zenith) }, uHor: { value: new T.Color(tod.horizon) },
        uGlow: { value: new T.Color(tod.glow) }, uSun: { value: new T.Vector3(...tod.sunDir).normalize() },
        uStars: { value: tod.stars }, uTime: { value: 0 }, uNight: { value: tod.stars },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position.z = gl_Position.w; }`,
      fragmentShader: `
        uniform vec3 uZen, uHor, uGlow, uSun; uniform float uStars, uTime, uNight; varying vec3 vDir;
        float h31(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
        void main(){
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 col = mix(uHor, uZen, smoothstep(-0.02, 0.45, y));
          col = mix(col, uGlow, exp(-abs(y)*14.0) * 0.6);
          float sd = max(dot(d, uSun), 0.0);
          if (uNight > 0.5) {
            col += vec3(0.6,0.7,1.0) * pow(sd, 400.0) * 0.6;
            col += vec3(1.0) * smoothstep(0.9994, 0.9997, sd) * 2.5;
          } else {
            col += vec3(1.0,0.6,0.3) * pow(sd, 8.0) * 0.7;
            col += vec3(1.0,0.85,0.6) * smoothstep(0.9990, 0.9995, sd) * 6.0;
          }
          if (uStars > 0.0 && y > 0.0) {
            vec3 p = d * 260.0; vec3 c = floor(p); float h = h31(c);
            if (h > 0.9965) { vec3 f = fract(p) - 0.5; float s = 1.0 - smoothstep(0.0, 0.18, length(f));
              col += vec3(0.9,0.95,1.0) * s * (h - 0.9965) * 300.0 * (0.6 + 0.4*sin(uTime*3.0 + h*90.0)) * smoothstep(0.0,0.25,y); }
          }
          if (y < 0.0) col = mix(col, uHor * 0.3, smoothstep(0.0, -0.1, y));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    const sky = new T.Mesh(new T.SphereGeometry(3000, 32, 16), skyMat);
    sky.frustumCulled = false; sky.renderOrder = -10;
    scene.add(sky);
    scene.fog = new T.FogExp2(tod.fog, tod.fogDensity);
    scene.background = new T.Color(tod.fog);

    // ---------- lights ----------
    const hemi = new T.HemisphereLight(tod.hemiSky, tod.hemiGround, tod.hemi);
    scene.add(hemi);
    const sun = new T.DirectionalLight(tod.moon, tod.moonI);
    const sunDir = new T.Vector3(...tod.sunDir).normalize();
    sun.position.copy(sunDir).multiplyScalar(120);
    if (Q.shadows) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
      const c = sun.shadow.camera;
      c.left = -45; c.right = 45; c.top = 45; c.bottom = -45; c.near = 10; c.far = 320;
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
    }
    scene.add(sun); scene.add(sun.target);
    city.sun = sun; city.sunDir = sunDir;

    // environment map: dark sky with city-light panels -> nice reflections on car paint
    const makeEnv = (tod, rr) => {
      const pm = new T.PMREMGenerator(game.renderer);
      const envScene = new T.Scene();
      envScene.background = new T.Color(tod.zenith).lerp(new T.Color(tod.horizon), 0.4);
      const envBox = (color, x, y, z, sx, sy, sz) => {
        const m = new T.Mesh(new T.BoxGeometry(sx, sy, sz), new T.MeshBasicMaterial({ color }));
        m.position.set(x, y, z); envScene.add(m);
      };
      envBox(new T.Color(tod.horizon).multiplyScalar(1.2), 0, -3, 0, 60, 4, 60);
      envBox(new T.Color(tod.hemiGround), 0, -12, 0, 80, 2, 80);
      const pal = [0xffb070, 0x70c8ff, 0xff4060, 0xffffff, 0xff9040];
      for (let i = 0; i < 18; i++) {
        const a = (i / 18) * Math.PI * 2;
        envBox(new T.Color(pal[i % pal.length]).multiplyScalar(tod.stars ? 2.5 : 1.2),
          Math.cos(a) * 22, 1 + rr() * 6, Math.sin(a) * 22, 1 + rr() * 3, 0.4 + rr() * 3, 1 + rr() * 3);
      }
      envBox(new T.Color(1, 1, 1).multiplyScalar(3), 0, 18, 0, 14, 0.5, 4);
      if (scene.environment) scene.environment.dispose();
      scene.environment = pm.fromScene(envScene, 0.03).texture;
      scene.environmentIntensity = tod.env;
      pm.dispose();
      envScene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    };
    makeEnv(tod, R);

    // ---------- ground ----------
    const groundTex = G.canvasTexture(256, 256, (ctx, W, H) => {
      ctx.fillStyle = '#1d1e22'; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 6000; i++) { const g = 20 + R() * 30 | 0; ctx.fillStyle = `rgba(${g},${g},${g + 4},0.5)`; ctx.fillRect(R() * W, R() * H, 2, 2); }
    }, { repeat: true });
    groundTex.repeat.set(400, 400);
    const ground = new T.Mesh(new T.PlaneGeometry(5000, 5000), new T.MeshStandardMaterial({ map: groundTex, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
    scene.add(ground);

    // ---------- buildings ----------
    const blds = []; // {x,z,w,d,h,yaw,row,sg,s}
    const exclusions = [{ x: -250, z: -205, r: 75 }]; // sky-ramp plaza
    const excluded = (x, z, pad) => exclusions.some((e) => (x - e.x) ** 2 + (z - e.z) ** 2 < (e.r + pad) ** 2);
    const okCorners = (cx, cz, w, d, yaw, minD) => {
      const c = Math.cos(yaw), s = Math.sin(yaw);
      for (const [a, b] of [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2], [0, 0]]) {
        const x = cx + a * c + b * s, z = cz - a * s + b * c;
        if (track.distToRoad(x, z, minD + 30) < minD) return false;
      }
      return true;
    };
    // street-facing rows
    for (const sg of [1, -1]) {
      let s = 0;
      while (s < track.length) {
        const w = 14 + R() * 18, d = 14 + R() * 16;
        let h = 10 + R() * 45;
        if (R() < 0.12) h = 70 + R() * 90;
        const p = track.sample(s + w / 2, {});
        const lat = sg * (G.WALK_OUT + 1.5 + d / 2);
        const cx = p.x + p.rx * lat, cz = p.z + p.rz * lat;
        const yaw = Math.atan2(-p.tz, p.tx); // local X along the road, local Z (depth) lateral
        if (!excluded(cx, cz, 10) && okCorners(cx, cz, w, d, yaw, G.WALK_OUT + 0.8))
          blds.push({ x: cx, z: cz, w, d, h, yaw, row: true, sg, s: s + w / 2 });
        s += w + 1 + R() * 3;
      }
    }
    // grid fill
    const cs = 52, margin = Q.cityRange;
    for (let gx = track.minX - margin; gx < track.maxX + margin; gx += cs) {
      for (let gz = track.minZ - margin; gz < track.maxZ + margin; gz += cs) {
        for (let k = 0; k < 4; k++) {
          if (R() > Q.cityDensity * (G.TRACK.fill || 1)) continue;
          const lx = gx + (k & 1) * 23 + 11.5, lz = gz + (k >> 1) * 23 + 11.5;
          const w = 13 + R() * 8, d = 13 + R() * 8;
          const dist = track.distToRoad(lx, lz, margin + 30);
          if (dist < 52 + Math.max(w, d) * 0.6 || dist > margin) continue;
          if (excluded(lx, lz, 15)) continue;
          const cd = Math.hypot(lx - 0, lz - 30);
          let h = 12 + R() * 30 + 110 * Math.exp(-((cd / 420) ** 2)) * R();
          if (R() < 0.05) h += 60 + R() * 60;
          blds.push({ x: lx, z: lz, w, d, h, yaw: 0 });
        }
      }
    }

    // facade archetypes: 0 glass office tower, 1 brick residential, 2 stone / concrete office, 3 modern ribbon-window block
    const STYLE_WALLS = [
      [0x2c3a48, 0x243242, 0x34424e, 0x202c38, 0x3c4854],
      [0x8a4632, 0x7a3e2e, 0x9c5a42, 0x6e3a2c, 0xa06a50, 0x5c3b32],
      [0xbdb4a2, 0xa89f8e, 0xcfc8b8, 0x948e84, 0xb0a58c],
      [0xdadcde, 0xa2a8ae, 0x767c82, 0xc4c8cb, 0x8a8478],
    ];
    const STYLE_DIMS = [[3.8, 4.2, 1.5, 1.8], [3.0, 3.3, 2.6, 3.4], [3.5, 3.9, 2.2, 3.0], [3.4, 3.8, 5.0, 7.0]]; // floor height range, bay width range
    const pickStyle = (h) => {
      const r = R();
      if (h > 60) return r < 0.6 ? 0 : r < 0.85 ? 2 : 3;
      if (h > 28) return r < 0.25 ? 0 : r < 0.5 ? 2 : r < 0.75 ? 3 : 1;
      return r < 0.5 ? 1 : r < 0.8 ? 2 : 3;
    };
    // massing: tall buildings get a podium and one or two setback tiers that share the facade
    const parts = []; // {b, k: footprint scale, h, style, podium}
    for (const b of blds) {
      b.style = pickStyle(b.h);
      const D = STYLE_DIMS[b.style], pal = STYLE_WALLS[b.style];
      b.fh = G.lerp(D[0], D[1], R()); b.bay = G.lerp(D[2], D[3], R()); b.seed = R();
      b.col = new T.Color(pal[(R() * pal.length) | 0]).multiplyScalar(0.88 + R() * 0.24);
      b.topK = 1;
      if (!(b.h > (b.row ? 55 : 40) && R() < 0.65)) { parts.push({ b, k: 1, h: b.h, style: b.style }); continue; }
      const hp = b.row ? 24 + R() * 6 : 10 + R() * 10;
      // glass towers often sit on a stone podium
      parts.push({ b, k: 1, h: hp, style: b.style === 0 && R() < 0.5 ? 2 : b.style, podium: true });
      if (b.h > 95) {
        parts.push({ b, k: 0.78, h: b.h * 0.72, style: b.style });
        b.topK = 0.52;
      } else b.topK = 0.66 + R() * 0.14;
      parts.push({ b, k: b.topK, h: b.h, style: b.style });
    }
    const bGeo = new T.BoxGeometry(1, 1, 1); bGeo.translate(0, 0.5, 0);
    const fGeo = bGeo.clone(); // facade boxes carry a per-instance style attribute
    const aStyle = new Float32Array(parts.length * 4);
    const bMesh = new T.InstancedMesh(fGeo, (city.bMat = makeBuildingMaterial(tod, Q.level >= 3)), parts.length);
    const m4 = new T.Matrix4(), qq = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), up = new T.Vector3(0, 1, 0), col = new T.Color();
    parts.forEach((pt, i) => {
      const b = pt.b, own = pt.style === b.style, D = STYLE_DIMS[pt.style];
      qq.setFromAxisAngle(up, b.yaw); ps.set(b.x, 0, b.z); sc.set(b.w * pt.k, pt.h, b.d * pt.k);
      m4.compose(ps, qq, sc); bMesh.setMatrixAt(i, m4);
      bMesh.setColorAt(i, own ? b.col : col.set(STYLE_WALLS[2][(b.seed * 5) | 0]));
      aStyle.set([pt.style, b.seed, own ? b.fh : D[0], own ? b.bay : D[2]], i * 4);
    });
    fGeo.setAttribute('aStyle', new T.InstancedBufferAttribute(aStyle, 4));
    bMesh.castShadow = Q.shadows; bMesh.receiveShadow = Q.shadows;
    bMesh.frustumCulled = false;
    scene.add(bMesh);
    city.buildings = blds;

    // cornices / parapet caps on masonry tops and podiums
    const corn = parts.filter((pt) => pt.style === 1 || pt.style === 2 || pt.podium);
    const cMesh = new T.InstancedMesh(bGeo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 }), corn.length);
    corn.forEach((pt, i) => {
      const b = pt.b, o = pt.style === 1 ? 0.8 : 0.5;
      qq.setFromAxisAngle(up, b.yaw); ps.set(b.x, pt.h - 0.65, b.z); sc.set(b.w * pt.k + o, 0.65, b.d * pt.k + o);
      m4.compose(ps, qq, sc); cMesh.setMatrixAt(i, m4);
      cMesh.setColorAt(i, col.set(pt.style === 1 ? 0x8f8a80 : pt.style === 0 ? 0x3a3f46 : 0x9a958a));
    });
    cMesh.castShadow = Q.shadows; cMesh.frustumCulled = false;
    scene.add(cMesh);

    // rooftop equipment: lift cores, AC units, water tanks on old brick, masts on towers
    const roofBoxes = [], tanks = [], masts = [];
    for (const b of blds) {
      const w = b.w * b.topK, d = b.d * b.topK, c = Math.cos(b.yaw), s = Math.sin(b.yaw);
      const at = (lx, lz) => [b.x + lx * c + lz * s, b.z - lx * s + lz * c];
      if (b.h > 20 && R() < 0.7) {
        const [x, z] = at((R() - 0.5) * w * 0.3, (R() - 0.5) * d * 0.3);
        roofBoxes.push([x, b.h, z, w * (0.22 + R() * 0.15), 2.6 + R() * 2.5, d * (0.22 + R() * 0.15), b.yaw]);
      }
      const nAC = Math.min(6, (w * d / 70) | 0);
      for (let k = 0; k < nAC; k++) {
        const [x, z] = at((R() - 0.5) * (w - 3), (R() - 0.5) * (d - 3));
        roofBoxes.push([x, b.h, z, 1.4 + R() * 1.2, 0.9 + R() * 0.6, 1.0 + R() * 1.4, b.yaw]);
      }
      if (b.style === 1 && b.h < 45 && R() < 0.55) { const [x, z] = at((R() - 0.5) * (w - 5), (R() - 0.5) * (d - 5)); tanks.push([x, b.h, z, 1.3 + R() * 0.6]); }
      if (b.h > 70 && R() < 0.6) masts.push([b.x, b.h, b.z, 6 + R() * 12]);
    }
    const roofMat = new T.MeshStandardMaterial({ color: 0x3e4044, roughness: 0.7, metalness: 0.3 });
    const rMesh = new T.InstancedMesh(bGeo, roofMat, roofBoxes.length);
    roofBoxes.forEach((r, i) => { qq.setFromAxisAngle(up, r[6]); m4.compose(ps.set(r[0], r[1], r[2]), qq, sc.set(r[3], r[4], r[5])); rMesh.setMatrixAt(i, m4); });
    rMesh.frustumCulled = false; rMesh.castShadow = Q.shadows;
    scene.add(rMesh);
    const tankParts = [new T.CylinderGeometry(1, 1, 2.4, 12).translate(0, 2.6, 0), new T.ConeGeometry(1.08, 0.7, 12).translate(0, 4.15, 0)];
    for (const [x, z] of [[-0.6, -0.6], [0.6, -0.6], [0.6, 0.6], [-0.6, 0.6]]) tankParts.push(new T.BoxGeometry(0.12, 1.4, 0.12).translate(x, 0.7, z));
    const tMesh = new T.InstancedMesh(ADDONS.mergeGeometries(tankParts), new T.MeshStandardMaterial({ color: 0x5a4636, roughness: 0.9 }), tanks.length);
    tanks.forEach((t, i) => { m4.compose(ps.set(t[0], t[1], t[2]), qq.identity(), sc.set(t[3], t[3], t[3])); tMesh.setMatrixAt(i, m4); });
    tMesh.frustumCulled = false; tMesh.castShadow = Q.shadows;
    scene.add(tMesh);
    const mastGeo = new T.CylinderGeometry(0.06, 0.22, 1, 5); mastGeo.translate(0, 0.5, 0);
    const mMesh = new T.InstancedMesh(mastGeo, roofMat, masts.length);
    masts.forEach((t, i) => { m4.compose(ps.set(t[0], t[1], t[2]), qq.identity(), sc.set(1, t[3], 1)); mMesh.setMatrixAt(i, m4); });
    mMesh.frustumCulled = false;
    scene.add(mMesh);
    // red aviation lights on the tallest roofs (mast tip when there is one)
    const tall = blds.filter((b) => b.h > 60);
    const beaconMat = new T.MeshBasicMaterial({ color: new T.Color(2.5, 0.1, 0.08), toneMapped: false });
    const beacons = new T.InstancedMesh(new T.SphereGeometry(0.45, 8, 6), beaconMat, tall.length);
    tall.forEach((b, i) => { const mt = masts.find((m) => m[0] === b.x && m[2] === b.z); m4.makeTranslation(b.x, b.h + (mt ? mt[3] : 1), b.z); beacons.setMatrixAt(i, m4); });
    beacons.frustumCulled = false;
    scene.add(beacons);

    // shop awnings over the storefronts of street-facing masonry buildings (bays match the facade shader)
    const AWN = [0x6a1f1f, 0x1f4a2e, 0x1f2f55, 0x5a4a2a, 0x2a2a2e, 0x7a3a12, 0x3d2a4a];
    const awn = [];
    for (const b of blds) {
      if (!b.row || b.style === 0) continue;
      const p = track.sample(b.s, {}), nx = -b.sg * p.rx, nz = -b.sg * p.rz;
      const nS = Math.max(1, Math.round(b.w / 6.5)), sw = b.w / nS;
      for (let k = 0; k < nS; k++) {
        if (R() > 0.45) continue;
        const lx = (k + 0.5) * sw - b.w / 2;
        awn.push([b.x + p.tx * lx + nx * (b.d / 2 + 0.02), b.z + p.tz * lx + nz * (b.d / 2 + 0.02), Math.atan2(nx, nz), sw - 1.3, AWN[(R() * AWN.length) | 0]]);
      }
    }
    const awnGeo = new T.BoxGeometry(1, 0.06, 1.5); awnGeo.translate(0, 0, 0.75); awnGeo.rotateX(0.32);
    const aMesh = new T.InstancedMesh(awnGeo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), awn.length);
    awn.forEach((a, i) => { qq.setFromAxisAngle(up, a[2]); m4.compose(ps.set(a[0], 3.45, a[1]), qq, sc.set(a[3], 1, 1)); aMesh.setMatrixAt(i, m4); aMesh.setColorAt(i, col.set(a[4])); });
    aMesh.frustumCulled = false; aMesh.castShadow = Q.shadows;
    scene.add(aMesh);

    // neon signs on street-facing buildings
    const signTex = G.canvasTexture(128, 256, (ctx, W, H) => {
      ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 7; ctx.strokeRect(10, 10, W - 20, H - 20);
      ctx.fillStyle = '#fff';
      for (let k = 0; k < 6; k++) ctx.fillRect(30 + (k % 2) * 14, 30 + k * 34, 50 - (k % 3) * 10, 16);
    }, { srgb: false });
    const neonCols = [[5, 0.3, 2.5], [0.3, 3.5, 5], [5, 1.6, 0.2], [0.8, 5, 0.6], [5, 0.2, 0.3], [1.2, 0.8, 5]];
    const signs = blds.filter((b) => b.row && R() < 0.42);
    const signMat = new T.MeshBasicMaterial({ map: signTex, blending: T.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false, fog: true });
    const sMesh = new T.InstancedMesh(new T.PlaneGeometry(1, 1), signMat, signs.length);
    signs.forEach((b, i) => {
      const vertical = R() < 0.6;
      const sw = vertical ? 2.5 + R() * 1.5 : 7 + R() * 6, sh = vertical ? 7 + R() * 7 : 2 + R() * 1.5;
      const yy = Math.min(b.h - sh / 2 - 1, 6 + R() * 14);
      if (yy < sh / 2 + 3) { sMesh.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
      // face towards the road: building local +/-Z faces forward/back; road is along local -X*sg ... use lateral offset
      const p = track.sample(b.s, {});
      const nx = -b.sg * p.rx, nz = -b.sg * p.rz; // pointing back to the road
      const off = b.d / 2 + 0.25;
      ps.set(b.x + nx * off, yy, b.z + nz * off);
      qq.setFromAxisAngle(up, Math.atan2(nx, nz));
      sc.set(sw, sh, 1);
      m4.compose(ps, qq, sc); sMesh.setMatrixAt(i, m4);
      const c = G.pick(neonCols); sMesh.setColorAt(i, col.setRGB(c[0], c[1], c[2]));
    });
    sMesh.frustumCulled = false;
    scene.add(sMesh);

    // ---------- street lights ----------
    const lamps = [];
    for (const sg of [1, -1]) for (let s = sg > 0 ? 0 : 20; s < track.length; s += 40) lamps.push({ s, sg });
    const poleGeo = new T.CylinderGeometry(0.12, 0.18, 9, 6); poleGeo.translate(0, 4.5, 0);
    const armGeo = new T.BoxGeometry(0.15, 0.15, 3.2);
    const headGeo = new T.BoxGeometry(0.5, 0.14, 1.1);
    const poleMat = new T.MeshStandardMaterial({ color: 0x2b2e33, roughness: 0.5, metalness: 0.7 });
    const pole = new T.InstancedMesh(poleGeo, poleMat, lamps.length);
    const arm = new T.InstancedMesh(armGeo, poleMat, lamps.length);
    const headMat = new T.MeshBasicMaterial({ color: new T.Color(2.0, 1.85, 1.6), toneMapped: false });
    const head = new T.InstancedMesh(headGeo, headMat, lamps.length);
    const poolTex = G.softSprite();
    const poolMat = new T.MeshBasicMaterial({ map: poolTex, color: new T.Color(1.0, 0.86, 0.68).multiplyScalar(tod.lampPool), blending: T.AdditiveBlending, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
    const pools = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), poolMat, lamps.length);
    city.poolMat = poolMat;
    let cones = null;
    if (Q.lightCones) {
      const coneGeo = new T.CylinderGeometry(0.3, 4.2, 8.6, 16, 1, true); coneGeo.translate(0, -4.3, 0);
      const coneMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uI: { value: tod.stars ? 0.06 : 0.02 } },
        vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying float vD; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); vD = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uI; varying float vY; varying vec3 vN; varying vec3 vV; varying float vD; void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); gl_FragColor = vec4(vec3(1.0,0.9,0.75) * uI * e * pow(vY, 1.4) * (1.0 - smoothstep(18.0, 70.0, vD)), 1.0); }`,
      });
      cones = new T.InstancedMesh(coneGeo, coneMat, lamps.length); city.coneMat = coneMat;
      cones.frustumCulled = false;
    }
    lamps.forEach((l, i) => {
      const p = track.sample(l.s, {});
      const yaw = Math.atan2(-p.tx, -p.tz);
      const lat = l.sg * (G.WALK_OUT - 0.8);
      const x = p.x + p.rx * lat, z = p.z + p.rz * lat;
      qq.setFromAxisAngle(up, yaw);
      m4.compose(ps.set(x, 0, z), qq, sc.set(1, 1, 1)); pole.setMatrixAt(i, m4);
      const ax = p.x + p.rx * (lat - l.sg * 1.6), az = p.z + p.rz * (lat - l.sg * 1.6);
      const qa = new T.Quaternion().setFromAxisAngle(up, yaw + Math.PI / 2);
      m4.compose(ps.set(ax, 9, az), qa, sc.set(1, 1, 1)); arm.setMatrixAt(i, m4);
      const hx = p.x + p.rx * (lat - l.sg * 3.0), hz = p.z + p.rz * (lat - l.sg * 3.0);
      m4.compose(ps.set(hx, 8.9, hz), qa, sc.set(1, 1, 1)); head.setMatrixAt(i, m4);
      if (cones) { m4.compose(ps.set(hx, 8.8, hz), qq, sc.set(1, 1, 1)); cones.setMatrixAt(i, m4); }
      m4.compose(ps.set(hx, 0.025, hz), qq, sc.set(17, 1, 17)); pools.setMatrixAt(i, m4);
    });
    for (const m of [pole, arm, head, pools]) { m.frustumCulled = false; scene.add(m); }
    pole.castShadow = Q.shadows;
    if (cones) scene.add(cones);

    // ---------- street trees: leaf-card crowns, branching trunks, iron grates, between the lamps ----------
    let treeTime = null;
    if (Q.level >= 2) {
      const trees = [];
      for (let s = 0; s < track.length - 40; s += 40) trees.push({ s: s + 13, sg: 1 }, { s: s + 27, sg: 1 }, { s: s + 7, sg: -1 }, { s: s + 33, sg: -1 });
      // one texture of overlapping leaves; dense in the middle, ragged at the rim so card edges never show
      const leafTex = G.canvasTexture(256, 256, (ctx, W, H) => {
        const r = G.rng(21);
        for (let i = 0; i < 700; i++) {
          const a = r() * Math.PI * 2, d = Math.pow(r(), 0.75) * W * 0.46;
          const x = W / 2 + Math.cos(a) * d, y = H / 2 + Math.sin(a) * d;
          const hue = 78 + r() * 40, lit = 16 + r() * 30 + (1 - d / (W * 0.46)) * 8;
          ctx.fillStyle = `hsl(${hue},${38 + r() * 25}%,${lit}%)`;
          ctx.beginPath(); ctx.ellipse(x, y, 4.5 + r() * 4, 2 + r() * 1.8, r() * Math.PI, 0, Math.PI * 2); ctx.fill();
        }
      });
      // crown = cloud of crossed leaf cards inside an ellipsoid; normals point out from the centre so it shades as one soft volume
      const crownGeo = (seed, rx, ry, cy, n) => {
        const r = G.rng(seed), pos = [], nor = [], uv = [], vc = [], idx = [];
        const v = new T.Vector3(), a = new T.Vector3(), b = new T.Vector3(), nrm = new T.Vector3(), q = new T.Quaternion(), e = new T.Euler();
        for (let i = 0; i < n; i++) {
          const th = r() * Math.PI * 2, ph = Math.acos(2 * r() - 1), rad = 0.4 + 0.6 * Math.sqrt(r());
          const c = new T.Vector3(Math.sin(ph) * Math.cos(th) * rx * rad, cy + Math.cos(ph) * ry * rad, Math.sin(ph) * Math.sin(th) * rx * rad);
          const s = 1.5 + r() * 1.2;
          q.setFromEuler(e.set(r() * Math.PI, r() * Math.PI, r() * Math.PI));
          a.set(s / 2, 0, 0).applyQuaternion(q); b.set(0, s / 2, 0).applyQuaternion(q);
          nrm.set(c.x / rx, (c.y - cy) / ry + 0.35, c.z / rx).normalize();
          // self-shadowing: darker underneath and inside the crown
          const shade = 0.42 + 0.58 * G.clamp((c.y - cy + ry) / (2 * ry), 0, 1) * (0.55 + 0.45 * rad);
          const base = pos.length / 3;
          for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            v.copy(c).addScaledVector(a, sx).addScaledVector(b, sy);
            pos.push(v.x, v.y, v.z); nor.push(nrm.x, nrm.y, nrm.z); uv.push((sx + 1) / 2, (sy + 1) / 2); vc.push(shade, shade, shade);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
        const g = new T.BufferGeometry();
        g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
        g.setAttribute('normal', new T.Float32BufferAttribute(nor, 3));
        g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
        g.setAttribute('color', new T.Float32BufferAttribute(vc, 3));
        g.setIndex(idx);
        return g;
      };
      const crowns = [crownGeo(31, 2.4, 2.0, 5.5, 60), crownGeo(47, 1.75, 2.7, 6.0, 52)]; // broad plane tree, oval linden
      const tParts = [new T.CylinderGeometry(0.11, 0.2, 4.6, 7).translate(0, 2.3, 0)];
      for (let k = 0; k < 4; k++) {
        const br = new T.CylinderGeometry(0.035, 0.08, 2.1, 5).translate(0, 1.05, 0);
        br.rotateZ(0.5 + (k % 2) * 0.25); br.rotateY(k * 1.75 + 0.4); br.translate(0, 3.0 + k * 0.35, 0);
        tParts.push(br);
      }
      const trunkGeo = ADDONS.mergeGeometries(tParts);
      const grateGeo = new T.BoxGeometry(1.5, 0.03, 1.5).translate(0, 0.175, 0);
      treeTime = { value: 0 };
      const leafMat = new T.MeshStandardMaterial({ map: leafTex, alphaTest: 0.42, side: T.DoubleSide, vertexColors: true, roughness: 0.82 });
      leafMat.onBeforeCompile = (sh) => {
        // gentle wind sway, more at the top of the crown, out of phase per tree
        sh.uniforms.uTime = treeTime;
        sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
            float ph = instanceMatrix[3].x * 0.37 + instanceMatrix[3].z * 0.21;
            float sw = max(position.y - 3.2, 0.0) * 0.035;
            transformed.x += sin(uTime * 1.3 + ph) * sw;
            transformed.z += sin(uTime * 1.7 + ph * 1.3) * sw * 0.6;
          #endif`);
      };
      const trunkMat = new T.MeshStandardMaterial({ color: 0x4a3d33, roughness: 0.95 });
      const counts = [0, 0], kind = trees.map((t, i) => (G.rng(i * 7 + 3)() < 0.5 ? 0 : 1));
      kind.forEach((k) => counts[k]++);
      const leaves = crowns.map((g, k) => new T.InstancedMesh(g, leafMat, counts[k]));
      const trunk = new T.InstancedMesh(trunkGeo, trunkMat, trees.length);
      const grate = new T.InstancedMesh(grateGeo, new T.MeshStandardMaterial({ color: 0x1c1d20, roughness: 0.55, metalness: 0.6 }), trees.length);
      const tr = G.rng(9), leafCol = new T.Color(), used = [0, 0];
      trees.forEach((t, i) => {
        const p = track.sample(t.s, {});
        const lat = t.sg * (G.WALK_OUT - 1.4);
        const x = p.x + p.rx * lat, z = p.z + p.rz * lat;
        const k = 0.85 + tr() * 0.35;
        qq.setFromAxisAngle(up, tr() * Math.PI * 2);
        m4.compose(ps.set(x, 0.16, z), qq, sc.set(k, k * (0.92 + tr() * 0.16), k));
        trunk.setMatrixAt(i, m4);
        const L = leaves[kind[i]], j = used[kind[i]]++;
        L.setMatrixAt(j, m4);
        // most trees healthy green, a few yellower / darker
        leafCol.setHSL(0.22 + tr() * 0.06, 0.25 + tr() * 0.2, 0.82 + tr() * 0.18);
        L.setColorAt(j, leafCol);
        m4.compose(ps.set(x, 0, z), qq, sc.set(1, 1, 1)); grate.setMatrixAt(i, m4);
      });
      for (const m of [trunk, grate, ...leaves]) { m.frustumCulled = false; scene.add(m); }
      for (const m of [trunk, ...leaves]) m.castShadow = Q.shadows;
    }

    // ---------- start / finish gantry ----------
    const g0 = track.sample(0, {});
    const gantry = new T.Group();
    gantry.position.set(g0.x, 0, g0.z);
    gantry.rotation.y = Math.atan2(-g0.tx, -g0.tz);
    const darkMetal = new T.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.4, metalness: 0.8 });
    for (const sx of [-1, 1]) {
      const p = new T.Mesh(new T.BoxGeometry(1, 9, 1), darkMetal); p.position.set(sx * (G.WALK_OUT - 2.5), 4.5, 0); p.castShadow = true; gantry.add(p);
    }
    const banTex = G.canvasTexture(1024, 128, (ctx, W, H) => {
      ctx.fillStyle = '#08090b'; ctx.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 32) for (let y = 0; y < 32; y += 16) { if (((x / 32) + (y / 16)) % 2 < 1) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 32, 16); ctx.fillRect(x, H - 32 + y, 32, 16); } }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 54px Orbitron, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ROADSTER  THRUSTER', W / 2, H / 2 + 2);
    });
    const banner = new T.Mesh(new T.BoxGeometry(2 * G.WALK_OUT - 4, 2.4, 0.6), [darkMetal, darkMetal, darkMetal, darkMetal,
      new T.MeshBasicMaterial({ map: banTex }), new T.MeshBasicMaterial({ map: banTex })]);
    banner.position.y = 8.2; gantry.add(banner);
    const strip = new T.Mesh(new T.BoxGeometry(2 * G.WALK_OUT - 4.4, 0.12, 0.7), new T.MeshBasicMaterial({ color: new T.Color(2.2, 0.08, 0.1), toneMapped: false }));
    strip.position.y = 6.95; gantry.add(strip);
    const lineTex = G.canvasTexture(256, 32, (ctx, W, H) => { for (let x = 0; x < W; x += 16) for (let y = 0; y < H; y += 16) { ctx.fillStyle = ((x + y) / 16) % 2 < 1 ? '#eee' : '#111'; ctx.fillRect(x, y, 16, 16); } });
    const line = new T.Mesh(new T.PlaneGeometry(2 * G.ROAD_HALF, 2), new T.MeshStandardMaterial({ map: lineTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
    line.rotation.x = -Math.PI / 2; line.position.y = 0.015; gantry.add(line);
    scene.add(gantry);

    // ---------- landmark: the curved sky ramp from the reveal ----------
    buildSkyRamp(scene, Q);

    // ---------- distant mountains silhouette ring (sunset reads better) ----------
    {
      const segs = 96, pos = [], idx = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2, rr = 2200;
        const hgt = 60 + 90 * Math.abs(Math.sin(a * 3.0 + 1.0)) + 50 * Math.abs(Math.sin(a * 7.3)) + R() * 20;
        pos.push(Math.cos(a) * rr, -10, Math.sin(a) * rr, Math.cos(a) * rr, hgt, Math.sin(a) * rr);
        if (i < segs) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const g = new T.BufferGeometry(); g.setAttribute('position', new T.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      const mtn = new T.Mesh(g, new T.MeshBasicMaterial({ color: new T.Color(tod.horizon).multiplyScalar(0.25), side: T.DoubleSide, fog: false }));
      city.mtnMat = mtn.material;
      mtn.position.set((track.minX + track.maxX) / 2, 0, (track.minZ + track.maxZ) / 2);
      scene.add(mtn);
    }

    let tAcc = 0;
    city.update = (dt, camPos, focus) => {
      tAcc += dt;
      sky.position.copy(camPos);
      skyMat.uniforms.uTime.value = tAcc;
      beaconMat.color.setRGB(Math.sin(tAcc * 3) > 0.2 ? 6 : 0.4, 0.15, 0.12);
      if (treeTime) treeTime.value = tAcc;
      // shadow camera follows the focus (player)
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, 160);
    };
    // switch night <-> sunset live: everything that was baked from the TOD table at build time
    city.setTod = (name) => {
      const t = TOD[name] || TOD.night;
      city.tod = t;
      const su = skyMat.uniforms;
      su.uZen.value.set(t.zenith); su.uHor.value.set(t.horizon); su.uGlow.value.set(t.glow);
      su.uSun.value.set(...t.sunDir).normalize(); su.uStars.value = t.stars; su.uNight.value = t.stars;
      scene.fog.color.set(t.fog); scene.fog.density = t.fogDensity; scene.background.set(t.fog);
      hemi.color.set(t.hemiSky); hemi.groundColor.set(t.hemiGround); hemi.intensity = t.hemi;
      sun.color.set(t.moon); sun.intensity = t.moonI; sunDir.set(...t.sunDir).normalize();
      makeEnv(t, G.rng(1234));
      city.bMat.userData.setTod(t);
      city.poolMat.color.setRGB(1.0, 0.86, 0.68).multiplyScalar(t.lampPool);
      if (city.coneMat) city.coneMat.uniforms.uI.value = t.stars ? 0.06 : 0.02;
      city.mtnMat.color.set(t.horizon).multiplyScalar(0.25);
    };
    return city;
  };

  // procedural facades. Per instance: aStyle = (archetype, seed, floor height, bay width).
  // Windows are laid out in face-local metres so every facade starts and ends on a pier, floors line up across setback tiers,
  // the ground floor is a storefront, and lit windows fake a room behind the glass (ceiling glow, side falloff, blinds, furniture).
  function makeBuildingMaterial(tod, detail) {
    const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0.0 });
    // kept outside the compiled shader so a time-of-day change can retune them live
    const u = (m.userData.u = { uLit: { value: 0 }, uWin: { value: 0 }, uSkyRef: { value: new T.Color() } });
    m.userData.setTod = (tod) => { u.uLit.value = tod.litRatio; u.uWin.value = tod.win; u.uSkyRef.value.set(tod.horizon).lerp(new T.Color(tod.glow), 0.5); };
    m.userData.setTod(tod);
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = 'attribute vec4 aStyle; varying vec3 vWPos; varying vec3 vWN; varying float vFaceU; flat varying vec4 vSty; flat varying vec2 vFaceWT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 bIM = mat4(1.0);
        #ifdef USE_INSTANCING
          bIM = instanceMatrix;
        #endif
        vec4 bWP = modelMatrix * bIM * vec4(position, 1.0);
        vWPos = bWP.xyz;
        vWN = normalize(mat3(modelMatrix * bIM) * normal);
        vec3 bS = vec3(length(bIM[0].xyz), length(bIM[1].xyz), length(bIM[2].xyz));
        float sideX = step(0.5, abs(normal.x));
        vFaceU = mix(position.x * bS.x + 0.5 * bS.x, position.z * bS.z + 0.5 * bS.z, sideX);
        // flat: a 'constant' varying still jitters by ~1e-6 across a triangle, enough to scramble the hashes below
        vFaceWT = vec2(mix(bS.x, bS.z, sideX), (modelMatrix * bIM * vec4(0.0, 1.0, 0.0, 1.0)).y);
        vSty = aStyle;`);
      sh.fragmentShader = (detail ? '#define BLD_DETAIL 1\n' : '') +
        'uniform float uLit; uniform float uWin; uniform vec3 uSkyRef; varying vec3 vWPos; varying vec3 vWN; varying float vFaceU; flat varying vec4 vSty; flat varying vec2 vFaceWT;\n' +
        `float bh21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
        float rectAA(vec2 f, vec4 r, vec2 aw){ vec2 a = smoothstep(r.xy - aw, r.xy + aw, f); vec2 b = 1.0 - smoothstep(r.zw - aw, r.zw + aw, f); return a.x*a.y*b.x*b.y; }
        ` + sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 bn = normalize(vWN);
          float sty = floor(vSty.x + 0.5), seed = vSty.y * 97.0, fh = vSty.z, bay = vSty.w;
          float u = vFaceU, W = vFaceWT.x, top = vFaceWT.y, y = vWPos.y;
          const float gH = 4.6;
          float pier = sty == 1.0 ? 0.9 : (sty == 0.0 ? 0.3 : 0.6);
          float nb = max(1.0, floor((W - 2.0 * pier) / bay + 0.5));
          float bw = (W - 2.0 * pier) / nb;
          vec2 g = vec2((u - pier) / bw, (y - gH) / fh);
          vec2 aw = fwidth(g) * 0.7 + 1e-4;
          float far = smoothstep(0.18, 0.5, max(aw.x, aw.y));
          float su = u / (W / max(1.0, floor(W / 6.5 + 0.5)));
          float sAw = fwidth(su) + 1e-4;
          vec3 wall = diffuseColor.rgb;
          if (abs(bn.y) < 0.5) {
            vec2 cell = floor(g), f = fract(g);
            float nFl = floor((top - 1.5 - gH) / fh);
            float body = step(0.0, g.x) * step(g.x, nb) * step(0.0, g.y) * step(cell.y, nFl - 1.0);
            vec4 wr = sty == 0.0 ? vec4(0.04, 0.25, 0.96, 0.97)
                    : sty == 1.0 ? vec4(0.27, 0.27, 0.73, 0.80)
                    : sty == 2.0 ? vec4(0.17, 0.21, 0.83, 0.84)
                    :              vec4(-0.01, 0.30, 1.01, 0.86);
            float win = rectAA(f, wr, aw) * body;
            if (sty == 3.0) { float mf = fract(g.x * 4.0); win *= mix(smoothstep(0.0, 0.03 + aw.x * 4.0, min(mf, 1.0 - mf)), 0.93, far); }
            if (sty == 0.0) win = mix(win, 0.72 * body, far);

            // ---- wall material
            float dirt = mix(0.62, 1.0, smoothstep(0.0, 9.0, y)) * (0.9 + 0.1 * bh21(vec2(floor(u * 1.3), seed)));
            #ifdef BLD_DETAIL
            if (sty == 1.0) {
              vec2 bq = vec2(u / 0.24, y / 0.085); bq.x += 0.5 * mod(floor(bq.y), 2.0);
              vec2 bwd = fwidth(bq) + 1e-4; float bfar = smoothstep(0.25, 0.6, max(bwd.x, bwd.y));
              float brick = rectAA(fract(bq), vec4(0.05, 0.12, 0.95, 0.88), bwd);
              vec3 bc = wall * (0.82 + 0.36 * bh21(floor(bq) + seed));
              bc = mix(vec3(0.36, 0.34, 0.31), bc, brick);
              wall = mix(bc, wall * 0.92, bfar);
            } else if (sty == 2.0) {
              vec2 pq = vec2(u / 1.5, y / (fh * 0.5)); vec2 pw = fwidth(pq) + 1e-4;
              float joint = 1.0 - rectAA(fract(pq), vec4(0.015, 0.03, 0.985, 0.97), pw);
              wall *= (0.92 + 0.14 * bh21(floor(pq) + seed)) * (1.0 - 0.35 * joint * (1.0 - smoothstep(0.2, 0.5, max(pw.x, pw.y))));
            } else if (sty == 3.0) {
              float sq = u / 1.2; float sw2 = fwidth(sq) + 1e-4;
              float seam = 1.0 - smoothstep(0.0, 0.04 + sw2, min(fract(sq), 1.0 - fract(sq)));
              wall *= 1.0 - 0.25 * seam * (1.0 - smoothstep(0.2, 0.5, sw2));
              roughnessFactor = 0.45; metalnessFactor = 0.35;
            }
            #endif
            if (sty == 0.0) {
              // spandrel glass + aluminium mullions
              float mull = (1.0 - win) * body * (1.0 - step(0.08, f.y)) ;
              wall = mix(wall, vec3(0.2, 0.21, 0.22), mull * (1.0 - far));
              roughnessFactor = 0.18; metalnessFactor = 0.55;
            }
            if (sty == 1.0 || sty == 2.0) {
              // sills under, lintels over the windows, and a frame
              float sill = rectAA(f, vec4(wr.x - 0.04, wr.y - 0.06, wr.z + 0.04, wr.y), aw) * body;
              float lint = rectAA(f, vec4(wr.x - 0.03, wr.w, wr.z + 0.03, wr.w + 0.05), aw) * body * step(sty, 1.5);
              wall = mix(wall, vec3(0.62, 0.6, 0.56), (sill + lint) * (1.0 - far));
            }
            // string course over the shops and a lighter band at the parapet
            float band = (step(gH - 0.35, y) * step(y, gH) + step(top - 1.2, y)) * step(0.5, abs(sty - 0.0));
            wall = mix(wall, wall * 1.25 + 0.04, band * 0.6);
            wall *= dirt;

            // ---- windows: dark reflective glass, some lit with a fake interior
            float office = sty == 1.0 ? 0.0 : 1.0;
            float rk = bh21(cell + seed);
            float zone = bh21(vec2(cell.y, floor(cell.x / 5.0)) + seed * 1.7);
            float lit = office > 0.5 ? step(zone, uLit) * step(0.1, rk) : step(rk, uLit);
            float r2 = bh21(cell.yx + seed * 0.53 + 7.0);
            vec3 warm = mix(vec3(1.0, 0.6, 0.3), vec3(1.0, 0.78, 0.52), r2);
            vec3 cool = mix(vec3(0.8, 0.88, 1.0), vec3(1.0, 0.94, 0.84), r2);
            vec3 wc = office > 0.5 ? cool : (r2 > 0.92 ? vec3(0.42, 0.55, 1.0) : warm);
            vec2 wq = clamp((f - wr.xy) / (wr.zw - wr.xy), 0.0, 1.0);
            float room = mix(0.4, 1.0, smoothstep(0.0, 0.95, wq.y)) * (1.0 - 0.45 * pow(abs(wq.x - 0.5) * 2.0, 2.0));
            if (office > 0.5) room *= 0.8 + 0.5 * smoothstep(0.84, 0.97, wq.y);
            else {
              float bl = bh21(cell + seed + 3.0);
              room = mix(room, 0.5 + 0.15 * r2, step(1.0 - bl * 0.9, wq.y) * step(bl, 0.6));
              float fur = step(wq.y, 0.18 + 0.25 * bh21(cell + 5.0)) * step(abs(wq.x - bh21(cell + 9.0)), 0.22);
              room *= 1.0 - 0.6 * fur;
            }
            room = mix(room, 0.7, far);
            float wlit = mix(lit, uLit * 0.92, far) * win;
            vec3 glass = sty == 0.0 ? vec3(0.025, 0.04, 0.055) : vec3(0.02, 0.022, 0.026);
            diffuseColor.rgb = mix(wall, glass, win);
            roughnessFactor = mix(roughnessFactor, 0.05, win);
            metalnessFactor = mix(metalnessFactor, 0.0, win);
            totalEmissiveRadiance += wc * room * wlit * uWin * 0.62;
            // glass picks up the sky glow at grazing angles (dark, unlit panes most of all)
            float fres = pow(1.0 - clamp(dot(normalize(cameraPosition - vWPos), bn), 0.0, 1.0), 3.0);
            totalEmissiveRadiance += uSkyRef * win * (1.0 - wlit * 0.8) * (0.08 + 0.9 * fres) * (sty == 0.0 ? 1.0 : 0.6);
            // unlit rooms are not pitch black
            totalEmissiveRadiance += wc * win * (1.0 - wlit) * 0.012 * uWin;

            // ---- ground floor: shopfronts (glass lobby on towers)
            if (y < gH) {
              float sf = fract(su), sId = floor(su);
              float open = sty == 0.0 ? 1.0 : step(0.22, bh21(vec2(sId, seed * 3.1)));
              float x0 = sty == 0.0 ? 0.02 : 0.07;
              float yTop = sty == 0.0 ? 4.25 : 3.3;
              float gl = smoothstep(x0 - sAw, x0 + sAw, sf) * (1.0 - smoothstep(1.0 - x0 - sAw, 1.0 - x0 + sAw, sf)) * step(0.35, y) * step(y, yTop);
              float midM = smoothstep(0.004, 0.012 + sAw, abs(sf - 0.62)); // door mullion
              float sp = sty == 0.0 ? 1.0 : midM;
              float sh0 = bh21(vec2(sId, seed + 4.0)), sh1 = bh21(vec2(sId, seed + 6.0));
              vec3 shopC = sh0 < 0.45 ? vec3(1.0, 0.74, 0.48) : (sh0 < 0.8 ? vec3(1.0, 0.9, 0.76) : vec3(0.84, 0.92, 1.0));
              float sgrad = (0.3 + 0.7 * smoothstep(0.3, yTop, y)) * (0.8 + 0.2 * sin(sf * 6.2832 * 2.0 + sh1 * 6.0));
              // goods on shelves: small coloured blocks, thin shelf edges, a counter in front
              // shelf rows 0.56 m apart; each row holds products of varied width/height standing on the shelf
              float srow = floor(y / 0.56), fy = fract(y / 0.56);
              float pw = 0.07 + 0.08 * bh21(vec2(srow, sId + 11.0));
              vec2 pc = vec2(floor(u / pw + srow * 0.37), srow);
              float pfar = smoothstep(0.25, 0.7, fwidth(u / pw));
              float goods = step(0.4, sh1) * step(0.35, y) * step(y, 2.5);
              float prod = step(0.09, fy) * step(fy, 0.32 + 0.5 * bh21(pc + 5.0)) * step(0.06, fract(u / pw + srow * 0.37));
              vec3 pcol = vec3(0.6) + 0.8 * vec3(bh21(pc + 1.0), bh21(pc + 2.0), bh21(pc + 3.0));
              shopC *= mix(vec3(1.0), mix(pcol, vec3(0.95), pfar), goods * 0.35 * prod);
              sgrad *= mix(1.0, mix(prod * (0.8 + 0.3 * bh21(pc + sId)) + (1.0 - prod) * 0.55, 0.85, pfar), goods);
              sgrad *= 1.0 - goods * 0.6 * step(fy, 0.07) * (1.0 - pfar);
              float counter = step(y, 1.1) * step(abs(sf - 0.3 - 0.4 * sh1), 0.16);
              sgrad *= 1.0 - 0.75 * counter;
              sgrad *= 0.7 + 0.5 * bh21(vec2(sId, seed + 8.0)); // some shops brighter than others
              // shutters on closed shops
              float shut = (1.0 - open) * gl;
              float slat = 0.75 + 0.25 * step(0.5, fract(y * 6.0));
              vec3 base = mix(wall * 0.55, vec3(0.03), gl * open * sp);
              base = mix(base, vec3(0.32, 0.33, 0.34) * slat, shut);
              base = mix(base, vec3(0.12, 0.12, 0.13), (1.0 - gl) * step(0.35, y) * 0.5);
              diffuseColor.rgb = base;
              roughnessFactor = mix(0.8, 0.06, gl * open);
              totalEmissiveRadiance = shopC * gl * open * sp * sgrad * uWin * (sty == 0.0 ? 0.42 : 0.5);
              // fascia sign with lettering
              if (sty != 0.0) {
                float fas = step(3.55, y) * step(y, 4.35) * smoothstep(0.08, 0.1, sf) * (1.0 - smoothstep(0.9, 0.92, sf));
                vec3 sgc = vec3(bh21(vec2(sId, 1.0)), bh21(vec2(sId, 2.0)), bh21(vec2(sId, 3.0)));
                sgc = normalize(sgc + 0.15) * 1.1;
                float lx = (sf - 0.25) / 0.5;
                float letters = step(0.0, lx) * step(lx, 1.0) * step(3.75, y) * step(y, 4.15) * step(0.35, fract(lx * 9.0)) * step(bh21(vec2(floor(lx * 9.0), sId)), 0.85);
                diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.05), fas);
                totalEmissiveRadiance += sgc * letters * fas * open * uWin * 1.1 * (1.0 - far);
              }
            }
          } else if (bn.y > 0.5) {
            // roof membrane / gravel
            diffuseColor.rgb = vec3(0.13, 0.13, 0.14) * (0.85 + 0.3 * bh21(floor(vWPos.xz * 0.5)));
            roughnessFactor = 0.95;
          }
        }`);
    };
    return m;
  }

  // curved concrete quarter-pipe tower with red edge lights + truss, like the reveal event
  function buildSkyRamp(scene, Q) {
    const grp = new T.Group();
    const prof = [];
    const Rr = 30;
    for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; prof.push([Rr - Rr * Math.cos(a) * 0 + 0, 0]); prof[i] = [Math.sin(a) * Rr, Rr - Math.cos(a) * Rr]; }
    for (let i = 1; i <= 8; i++) prof.push([Rr, Rr + i * 3]);
    for (let i = 1; i <= 10; i++) { const a = (i / 10) * 0.7; prof.push([Rr - (1 - Math.cos(a)) * 25, Rr + 24 + Math.sin(a) * 25]); }
    const W = 12, pos = [], uv = [], idx = [];
    let acc = 0;
    prof.forEach((p, i) => {
      if (i > 0) acc += Math.hypot(p[0] - prof[i - 1][0], p[1] - prof[i - 1][1]);
      pos.push(-W / 2, p[1], -p[0], W / 2, p[1], -p[0]);
      uv.push(0, acc / 12, 1, acc / 12);
      if (i < prof.length - 1) { const k = i * 2; idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
    });
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals();
    const tex = G.canvasTexture(256, 256, (ctx, Wd, H) => {
      ctx.fillStyle = '#8c8c8a'; ctx.fillRect(0, 0, Wd, H);
      const r = G.rng(9);
      for (let i = 0; i < 4000; i++) { const c = 110 + r() * 50 | 0; ctx.fillStyle = `rgba(${c},${c},${c},0.4)`; ctx.fillRect(r() * Wd, r() * H, 2, 2); }
      ctx.fillStyle = '#eee'; ctx.fillRect(Wd * 0.62, 0, 5, H);
      ctx.fillStyle = '#ff2a3c'; ctx.fillRect(0, 0, 6, H); ctx.fillRect(Wd - 6, 0, 6, H);
    }, { repeat: true });
    const ramp = new T.Mesh(g, new T.MeshStandardMaterial({ map: tex, roughness: 0.8, side: T.DoubleSide }));
    ramp.castShadow = true; ramp.receiveShadow = true;
    grp.add(ramp);
    // red edge strips
    const edgeMat = new T.MeshBasicMaterial({ color: new T.Color(2.5, 0.1, 0.12), toneMapped: false });
    for (const sx of [-1, 1]) {
      const pts = prof.map((p) => new T.Vector3(sx * W / 2, p[1] + 0.05, -p[0]));
      const tube = new T.Mesh(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 80, 0.12, 5, false), edgeMat);
      grp.add(tube);
    }
    // truss
    const trussMat = new T.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.5, metalness: 0.8 });
    for (let i = 0; i < 6; i++) {
      const z = -Rr - 2 - (i % 2) * 4, x = (i < 3 ? -1 : 1) * (W / 2 - 1 + (i % 3) * 0);
      const col = new T.Mesh(new T.BoxGeometry(0.8, 58, 0.8), trussMat);
      col.position.set(x * ((i % 3) / 2 + 0.5), 29, z - (i % 3) * 2); col.castShadow = true; grp.add(col);
    }
    for (let y = 6; y < 56; y += 7) {
      const beam = new T.Mesh(new T.BoxGeometry(W, 0.4, 0.4), trussMat); beam.position.set(0, y, -Rr - 3); grp.add(beam);
      const diag = new T.Mesh(new T.BoxGeometry(0.3, 9, 0.3), trussMat); diag.position.set(0, y + 3.5, -Rr - 4); diag.rotation.z = 0.9; grp.add(diag);
    }
    // floodlights
    const flood = new T.Mesh(new T.BoxGeometry(6, 1.2, 0.6), new T.MeshBasicMaterial({ color: new T.Color(2.5, 2.5, 2.5), toneMapped: false }));
    flood.position.set(0, 62, -Rr + 2); grp.add(flood);
    grp.position.set(-250, 0, -205);
    grp.rotation.y = Math.PI; // bottom faces the main straight
    scene.add(grp);
  }
})();
