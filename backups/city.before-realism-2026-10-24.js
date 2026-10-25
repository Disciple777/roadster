// city.js — sky, lighting, buildings with procedural windows, street lights, neon, landmarks
(function () {
  const T = THREE;

  const TOD = {
    night: {
      zenith: 0x02040b, horizon: 0x1b2036, glow: 0x3a2234, fog: 0x0b0f1a, fogDensity: 0.0021,
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
        uStars: { value: tod.stars }, uTime: { value: 0 }, uNight: { value: game.settings.tod === 'night' ? 1 : 0 },
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
      envBox(new T.Color(pal[i % pal.length]).multiplyScalar(game.settings.tod === 'night' ? 2.5 : 1.2),
        Math.cos(a) * 22, 1 + R() * 6, Math.sin(a) * 22, 1 + R() * 3, 0.4 + R() * 3, 1 + R() * 3);
    }
    envBox(new T.Color(1, 1, 1).multiplyScalar(3), 0, 18, 0, 14, 0.5, 4);
    scene.environment = pm.fromScene(envScene, 0.03).texture;
    scene.environmentIntensity = tod.env;
    pm.dispose();

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
    const blds = []; // {x,z,w,d,h,yaw,c}
    const tints = [0x8a8f99, 0x6d7380, 0x9a9488, 0x5a6270, 0xa8acb4, 0x4c5260, 0x7a7068, 0x3c4250];
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
          blds.push({ x: cx, z: cz, w, d, h, yaw, c: G.pick(tints), row: true, sg, s: s + w / 2 });
        s += w + 1 + R() * 3;
      }
    }
    // grid fill
    const cs = 52, margin = Q.cityRange;
    for (let gx = track.minX - margin; gx < track.maxX + margin; gx += cs) {
      for (let gz = track.minZ - margin; gz < track.maxZ + margin; gz += cs) {
        for (let k = 0; k < 4; k++) {
          if (R() > Q.cityDensity) continue;
          const lx = gx + (k & 1) * 23 + 11.5, lz = gz + (k >> 1) * 23 + 11.5;
          const w = 13 + R() * 8, d = 13 + R() * 8;
          const dist = track.distToRoad(lx, lz, margin + 30);
          if (dist < 52 + Math.max(w, d) * 0.6 || dist > margin) continue;
          if (excluded(lx, lz, 15)) continue;
          const cd = Math.hypot(lx - 0, lz - 30);
          let h = 12 + R() * 30 + 110 * Math.exp(-((cd / 420) ** 2)) * R();
          if (R() < 0.05) h += 60 + R() * 60;
          blds.push({ x: lx, z: lz, w, d, h, yaw: 0, c: G.pick(tints) });
        }
      }
    }
    const bGeo = new T.BoxGeometry(1, 1, 1); bGeo.translate(0, 0.5, 0);
    const bMat = makeBuildingMaterial(tod);
    const bMesh = new T.InstancedMesh(bGeo, bMat, blds.length);
    const m4 = new T.Matrix4(), qq = new T.Quaternion(), sc = new T.Vector3(), ps = new T.Vector3(), up = new T.Vector3(0, 1, 0), col = new T.Color();
    blds.forEach((b, i) => {
      qq.setFromAxisAngle(up, b.yaw); ps.set(b.x, 0, b.z); sc.set(b.w, b.h, b.d);
      m4.compose(ps, qq, sc); bMesh.setMatrixAt(i, m4);
      bMesh.setColorAt(i, col.set(b.c).multiplyScalar(0.8 + R() * 0.4));
    });
    bMesh.castShadow = Q.shadows; bMesh.receiveShadow = Q.shadows;
    bMesh.frustumCulled = false;
    scene.add(bMesh);
    city.buildings = blds;

    // rooftops: penthouse boxes + beacons
    const roofs = blds.filter((b) => b.h > 28 && R() < 0.55);
    const rMesh = new T.InstancedMesh(bGeo, new T.MeshStandardMaterial({ color: 0x2a2d33, roughness: 0.8 }), roofs.length);
    roofs.forEach((b, i) => {
      qq.setFromAxisAngle(up, b.yaw); ps.set(b.x, b.h, b.z); sc.set(b.w * (0.3 + R() * 0.3), 2 + R() * 5, b.d * (0.3 + R() * 0.3));
      m4.compose(ps, qq, sc); rMesh.setMatrixAt(i, m4);
    });
    rMesh.frustumCulled = false;
    scene.add(rMesh);
    const tall = blds.filter((b) => b.h > 60);
    const beaconMat = new T.MeshBasicMaterial({ color: new T.Color(2.5, 0.1, 0.08), toneMapped: false });
    const beacons = new T.InstancedMesh(new T.SphereGeometry(0.6, 8, 6), beaconMat, tall.length);
    tall.forEach((b, i) => { m4.makeTranslation(b.x, b.h + 1, b.z); beacons.setMatrixAt(i, m4); });
    beacons.frustumCulled = false;
    scene.add(beacons);

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
    let cones = null;
    if (Q.lightCones) {
      const coneGeo = new T.CylinderGeometry(0.3, 4.2, 8.6, 16, 1, true); coneGeo.translate(0, -4.3, 0);
      const coneMat = new T.ShaderMaterial({
        transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
        uniforms: { uI: { value: game.settings.tod === 'night' ? 0.06 : 0.02 } },
        vertexShader: `varying float vY; varying vec3 vN; varying vec3 vV; varying float vD; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position,1.0); vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); vD = length(mv.xyz); gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform float uI; varying float vY; varying vec3 vN; varying vec3 vV; varying float vD; void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.5); gl_FragColor = vec4(vec3(1.0,0.9,0.75) * uI * e * pow(vY, 1.4) * (1.0 - smoothstep(18.0, 70.0, vD)), 1.0); }`,
      });
      cones = new T.InstancedMesh(coneGeo, coneMat, lamps.length);
      cones.frustumCulled = false;
    }
    lamps.forEach((l, i) => {
      const p = track.sample(l.s, {});
      const yaw = Math.atan2(-p.tx, -p.tz);
      const lat = l.sg * 15.2;
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

    // ---------- street trees in sidewalk planters, between the lamps ----------
    if (Q.level >= 2) {
      const trees = [];
      for (let s = 0; s < track.length - 40; s += 40) trees.push({ s: s + 13, sg: 1 }, { s: s + 27, sg: 1 }, { s: s + 7, sg: -1 }, { s: s + 33, sg: -1 });
      const trunkGeo = new T.CylinderGeometry(0.11, 0.17, 3.2, 6); trunkGeo.translate(0, 1.6, 0);
      const crownGeo = new T.IcosahedronGeometry(1.7, 1); crownGeo.scale(1, 1.15, 1); crownGeo.translate(0, 4.4, 0);
      const crown2 = new T.IcosahedronGeometry(1.25, 1); crown2.translate(0.5, 5.6, -0.3);
      const leafGeo = ADDONS.mergeGeometries([crownGeo.toNonIndexed(), crown2.toNonIndexed()]);
      // jitter the crown so every tree isn't a perfect ball
      const lp = leafGeo.attributes.position, jr = G.rng(5);
      for (let i = 0; i < lp.count; i += 3) {
        const k = 0.85 + jr() * 0.3;
        for (let v = 0; v < 3; v++) lp.setXYZ(i + v, lp.getX(i + v) * k, 4.6 + (lp.getY(i + v) - 4.6) * k, lp.getZ(i + v) * k);
      }
      leafGeo.computeVertexNormals();
      const planterGeo = new T.BoxGeometry(1.5, 0.22, 1.5); planterGeo.translate(0, 0.11, 0);
      const trunk = new T.InstancedMesh(trunkGeo, new T.MeshStandardMaterial({ color: 0x3a2c22, roughness: 0.9 }), trees.length);
      const leaves = new T.InstancedMesh(leafGeo, new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, flatShading: true }), trees.length);
      const planter = new T.InstancedMesh(planterGeo, new T.MeshStandardMaterial({ color: 0x55565a, roughness: 0.85 }), trees.length);
      const tr = G.rng(9), leafCol = new T.Color();
      trees.forEach((t, i) => {
        const p = track.sample(t.s, {});
        const lat = t.sg * 14.6;
        const x = p.x + p.rx * lat, z = p.z + p.rz * lat;
        const k = 0.8 + tr() * 0.45;
        qq.setFromAxisAngle(up, tr() * Math.PI * 2);
        m4.compose(ps.set(x, 0, z), qq, sc.set(k, k, k)); trunk.setMatrixAt(i, m4); leaves.setMatrixAt(i, m4);
        m4.compose(ps.set(x, 0, z), qq, sc.set(1, 1, 1)); planter.setMatrixAt(i, m4);
        leafCol.setHSL(0.24 + tr() * 0.08, 0.35 + tr() * 0.2, 0.13 + tr() * 0.07);
        leaves.setColorAt(i, leafCol);
      });
      for (const m of [trunk, leaves, planter]) { m.frustumCulled = false; scene.add(m); }
      leaves.castShadow = trunk.castShadow = Q.shadows;
    }

    // ---------- start / finish gantry ----------
    const g0 = track.sample(0, {});
    const gantry = new T.Group();
    gantry.position.set(g0.x, 0, g0.z);
    gantry.rotation.y = Math.atan2(-g0.tx, -g0.tz);
    const darkMetal = new T.MeshStandardMaterial({ color: 0x1b1d21, roughness: 0.4, metalness: 0.8 });
    for (const sx of [-1, 1]) {
      const p = new T.Mesh(new T.BoxGeometry(1, 9, 1), darkMetal); p.position.set(sx * 13.5, 4.5, 0); p.castShadow = true; gantry.add(p);
    }
    const banTex = G.canvasTexture(1024, 128, (ctx, W, H) => {
      ctx.fillStyle = '#08090b'; ctx.fillRect(0, 0, W, H);
      for (let x = 0; x < W; x += 32) for (let y = 0; y < 32; y += 16) { if (((x / 32) + (y / 16)) % 2 < 1) { ctx.fillStyle = '#fff'; ctx.fillRect(x, y, 32, 16); ctx.fillRect(x, H - 32 + y, 32, 16); } }
      ctx.fillStyle = '#fff'; ctx.font = 'bold 54px Orbitron, Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText('ROADSTER  THRUSTER', W / 2, H / 2 + 2);
    });
    const banner = new T.Mesh(new T.BoxGeometry(28, 2.4, 0.6), [darkMetal, darkMetal, darkMetal, darkMetal,
      new T.MeshBasicMaterial({ map: banTex }), new T.MeshBasicMaterial({ map: banTex })]);
    banner.position.y = 8.2; gantry.add(banner);
    const strip = new T.Mesh(new T.BoxGeometry(27.6, 0.12, 0.7), new T.MeshBasicMaterial({ color: new T.Color(2.2, 0.08, 0.1), toneMapped: false }));
    strip.position.y = 6.95; gantry.add(strip);
    const lineTex = G.canvasTexture(256, 32, (ctx, W, H) => { for (let x = 0; x < W; x += 16) for (let y = 0; y < H; y += 16) { ctx.fillStyle = ((x + y) / 16) % 2 < 1 ? '#eee' : '#111'; ctx.fillRect(x, y, 16, 16); } });
    const line = new T.Mesh(new T.PlaneGeometry(24, 2), new T.MeshStandardMaterial({ map: lineTex, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -1 }));
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
      mtn.position.set((track.minX + track.maxX) / 2, 0, (track.minZ + track.maxZ) / 2);
      scene.add(mtn);
    }

    let tAcc = 0;
    city.update = (dt, camPos, focus) => {
      tAcc += dt;
      sky.position.copy(camPos);
      skyMat.uniforms.uTime.value = tAcc;
      beaconMat.color.setRGB(Math.sin(tAcc * 3) > 0.2 ? 6 : 0.4, 0.15, 0.12);
      // shadow camera follows the focus (player)
      sun.target.position.copy(focus);
      sun.position.copy(focus).addScaledVector(sunDir, 160);
    };
    return city;
  };

  function makeBuildingMaterial(tod) {
    const m = new T.MeshStandardMaterial({ color: 0xffffff, roughness: 0.78, metalness: 0.15 });
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uLit = { value: tod.litRatio };
      sh.uniforms.uWin = { value: tod.win };
      sh.vertexShader = 'varying vec3 vWPos; varying vec3 vWN; varying vec2 vSeed;\n' + sh.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
        mat4 bIM = mat4(1.0);
        #ifdef USE_INSTANCING
          bIM = instanceMatrix;
        #endif
        vec4 bWP = modelMatrix * bIM * vec4(position, 1.0);
        vWPos = bWP.xyz;
        vWN = normalize(mat3(modelMatrix * bIM) * normal);
        vSeed = (modelMatrix * bIM * vec4(0.0, 0.0, 0.0, 1.0)).xz;`);
      sh.fragmentShader = 'uniform float uLit; uniform float uWin; varying vec3 vWPos; varying vec3 vWN; varying vec2 vSeed;\n' +
        'float bh21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }\n' +
        sh.fragmentShader.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 bn = normalize(vWN);
          if (abs(bn.y) < 0.5) {
            vec2 tg = normalize(vec2(-bn.z, bn.x));
            float u = dot(vWPos.xz, tg) / 2.7;
            float v = (vWPos.y - 0.6) / 3.5;
            vec2 cell = floor(vec2(u, v));
            vec2 f = fract(vec2(u, v));
            float wmask = step(0.16, f.x) * step(f.x, 0.84) * step(0.2, f.y) * step(f.y, 0.8) * step(0.0, v);
            float r = bh21(cell + floor(vSeed * 0.1));
            float floorLit = step(bh21(vec2(cell.y, floor(vSeed.x*0.1)) ), 0.85);
            float lit = step(r, uLit) * floorLit;
            float r2 = bh21(cell.yx + floor(vSeed.yx * 0.021) + 7.0);
            vec3 wc = mix(vec3(1.0, 0.7, 0.4), vec3(0.65, 0.82, 1.0), step(0.62, r2));
            wc *= 0.45 + r2 * 0.9;
            float aa = clamp(1.0 - 1.2 * max(fwidth(u), fwidth(v)), 0.0, 1.0);
            float wm = mix(0.42, wmask, aa);
            float litm = mix(uLit * 0.8, lit, aa);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.035, 0.045, 0.06), wm * 0.85);
            roughnessFactor = mix(roughnessFactor, 0.12, wm);
            totalEmissiveRadiance += wc * wm * litm * uWin;
            // street level shop glow
            float shop = (1.0 - step(0.0, v)) * step(-0.17, v) * step(0.65, bh21(floor(vec2(u*0.25, 3.0)) + floor(vSeed * 0.1)));
            totalEmissiveRadiance += vec3(1.0, 0.8, 0.55) * shop * uWin * 0.5;
          } else {
            diffuseColor.rgb *= 0.45;
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
