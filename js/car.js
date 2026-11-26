// car.js — the roadster model (faceted wedge body, light bars, nozzles) and the player's raycast-vehicle physics
(function () {
  const T = THREE;

  // ---------------- model ----------------
  // Crisp faceted wedge (flat panels, sharp creases) after the reference photos: low nose with a full-width light bar,
  // fender blades over the front wheels, rising rear fins, one big tinted canopy, dark sills and real wheel arches.
  // Half profile points, bottom centre round to roof centre:
  //  0 bottom centre, 1 floor edge, 2 wheel-well inner, 3 sill bottom, 4 sill top, 5 shoulder crease,
  //  6 fender/fin peak, 7 deck/glass base, 8 canopy shoulder, 9 roof centre
  // Key stations: [z, wSill, yBot, ySillTop, wShoulder, yShoulder, wPeak, yPeak, wDeck, yDeck, wCanopy, yCanopy, yRoof]
  const KEYS = [
    [-2.36, 0.84, 0.30, 0.34, 0.90, 0.52, 0.84, 0.550, 0.40, 0.520, 0.20, 0.515, 0.515],
    [-2.28, 0.90, 0.23, 0.31, 0.96, 0.57, 0.89, 0.610, 0.45, 0.590, 0.22, 0.590, 0.590],
    [-1.90, 0.93, 0.20, 0.33, 0.99, 0.70, 0.91, 0.770, 0.50, 0.730, 0.25, 0.725, 0.725],
    [-1.42, 0.93, 0.20, 0.34, 1.00, 0.86, 0.92, 0.905, 0.55, 0.870, 0.32, 0.870, 0.875],
    [-1.00, 0.92, 0.20, 0.34, 0.99, 0.86, 0.90, 0.900, 0.68, 0.880, 0.50, 0.950, 0.965],
    [-0.55, 0.91, 0.20, 0.34, 0.98, 0.86, 0.90, 0.905, 0.86, 0.890, 0.64, 1.110, 1.150],
    [-0.10, 0.91, 0.20, 0.34, 0.98, 0.87, 0.90, 0.915, 0.87, 0.900, 0.68, 1.210, 1.255],
    [0.35, 0.91, 0.20, 0.34, 0.99, 0.88, 0.91, 0.930, 0.88, 0.915, 0.68, 1.220, 1.265],
    [0.90, 0.92, 0.20, 0.35, 1.02, 0.89, 0.93, 0.950, 0.86, 0.930, 0.62, 1.120, 1.160],
    [1.35, 0.94, 0.20, 0.36, 1.03, 0.90, 0.94, 0.970, 0.74, 0.945, 0.46, 1.000, 1.020],
    [1.75, 0.95, 0.20, 0.37, 1.03, 0.91, 0.95, 1.000, 0.64, 0.905, 0.34, 0.905, 0.915],
    [2.05, 0.95, 0.21, 0.38, 1.02, 0.91, 0.95, 1.020, 0.62, 0.900, 0.30, 0.905, 0.905],
    [2.30, 0.94, 0.25, 0.40, 1.00, 0.89, 0.93, 1.015, 0.62, 0.925, 0.30, 0.930, 0.930],
    [2.36, 0.90, 0.29, 0.42, 0.96, 0.87, 0.89, 0.975, 0.60, 0.900, 0.30, 0.900, 0.900],
  ];
  const WHEEL_Z = [-1.42, 1.45], ARCH_R = 0.45, WHEEL_Y = 0.36;
  const GLASS_Z = [-1.0, 1.75];

  function keyAt(z) {
    let k = 0;
    while (k < KEYS.length - 2 && KEYS[k + 1][0] < z) k++;
    const a = KEYS[k], b = KEYS[k + 1], t = G.clamp((z - a[0]) / (b[0] - a[0]), 0, 1);
    return a.map((v, i) => v + (b[i] - v) * t);
  }
  function archY(z) {
    let y = -1;
    for (const wz of WHEEL_Z) { const d = z - wz; if (Math.abs(d) < ARCH_R) y = Math.max(y, WHEEL_Y + Math.sqrt(ARCH_R * ARCH_R - d * d)); }
    return y;
  }
  function profileAt(z) {
    const [, wl, yb, ys, wsh, ysh, wft, yft, wgb, ygb, wgs, ygs, yr] = keyAt(z);
    const p = [[0, yb], [0.64, yb], [0.66, yb + 0.02], [wl, yb + 0.03], [wl + 0.02, ys], [wsh, ysh], [wft, yft], [wgb, ygb], [wgs, ygs], [0, yr]];
    const ay = archY(z);
    if (ay > 0) for (let j = 2; j <= 4; j++) if (p[j][1] < ay) p[j][1] = ay; // cut the wheel arch
    return p;
  }
  function matFor(z, j) {
    if (j <= 3) return 2; // floor, wheel wells, dark sills
    if (j >= 7 && z > GLASS_Z[0] && z < GLASS_Z[1]) return 1;
    return 0;
  }

  function bodyGeometry() {
    // dense stations so the arches are round; key stations included so creases stay exactly where drawn
    const zs = new Set(KEYS.map((k) => k[0]));
    for (let z = -2.36; z < 2.36; z += 0.04) zs.add(+z.toFixed(3));
    for (const wz of WHEEL_Z) for (const d of [-ARCH_R, ARCH_R]) zs.add(wz + d);
    for (const gz of GLASS_Z) zs.add(gz);
    const Z = [...zs].sort((a, b) => a - b);
    const S = Z.map((z) => [z, profileAt(z)]);
    const NP = S[0][1].length;
    const tris = [[], [], []];
    const P = (k, j, sx) => { const [z, pts] = S[k]; return [pts[j][0] * sx, pts[j][1], z]; };
    for (let k = 0; k < S.length - 1; k++) {
      const zm = (S[k][0] + S[k + 1][0]) / 2;
      for (let j = 0; j < NP - 1; j++) {
        const m = matFor(zm, j);
        const A = P(k, j, 1), B = P(k, j + 1, 1), C = P(k + 1, j + 1, 1), D = P(k + 1, j, 1);
        tris[m].push(A, B, C, A, C, D);
        const A2 = P(k, j, -1), B2 = P(k, j + 1, -1), C2 = P(k + 1, j + 1, -1), D2 = P(k + 1, j, -1);
        tris[m].push(A2, C2, B2, A2, D2, C2);
      }
    }
    // nose and tail faces: dark below the shoulder, paint above
    const cap = (k, front) => {
      const [z, pts] = S[k];
      const c = [0, (pts[0][1] + pts[NP - 1][1]) / 2, z];
      for (let j = 0; j < NP - 1; j++) {
        const m = j >= (front ? 3 : 5) ? 0 : 2;
        const a = [pts[j][0], pts[j][1], z], b = [pts[j + 1][0], pts[j + 1][1], z];
        const a2 = [-pts[j][0], pts[j][1], z], b2 = [-pts[j + 1][0], pts[j + 1][1], z];
        if (front) { tris[m].push(c, b, a, c, a2, b2); } else { tris[m].push(c, a, b, c, b2, a2); }
      }
    };
    cap(0, true);
    cap(S.length - 1, false);
    const pos = [];
    const g = new T.BufferGeometry();
    let start = 0;
    for (let m = 0; m < 3; m++) {
      for (const v of tris[m]) pos.push(v[0], v[1], v[2]);
      g.addGroup(start, tris[m].length, m);
      start += tris[m].length;
    }
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    return ADDONS.toCreasedNormals(g, 0.33);
  }

  // 5-blade aero wheel face: one swept blade, instanced round the hub
  function bladeGeometry() {
    const s = new T.Shape();
    s.moveTo(-0.035, 0.05); s.lineTo(0.035, 0.05);
    s.quadraticCurveTo(0.09, 0.17, 0.115, 0.275); s.lineTo(0.02, 0.28);
    s.quadraticCurveTo(0.0, 0.16, -0.035, 0.05);
    const g = new T.ExtrudeGeometry(s, { depth: 0.035, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 1, curveSegments: 6 });
    g.rotateY(Math.PI / 2); // face +X, blade lies in the YZ plane
    return g;
  }

  // metallic flake: tiny per-cell normal jitter on the base coat only (the clear coat stays glass-smooth),
  // faded out with distance so it sparkles up close and never shimmers far away
  const addFlakes = (mat) => {
    mat.onBeforeCompile = (sh) => {
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFlakeP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlakeP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
varying vec3 vFlakeP;
vec3 flakeHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
{ vec3 fp = vFlakeP * 260.0; float fade = 1.0 -smoothstep(0.35, 1.0, length(fwidth(fp)));
  normal = normalize(normal + (flakeHash(floor(fp)) - 0.5) * 0.35 * fade); }`);
    };
    mat.customProgramCacheKey = () => 'flakes';
    return mat;
  };

  let plateTex = null;
  // kit = { rear: [[x,y,z] x4], sideX, sideY, wheelR?, wheelX? } builds only the shared hardware (wheels, thrusters, jets) with no body,
  // for a GLB car body to sit on (see G.buildCar)
  G.buildRoadster = function (paintHex, { shadows = true, kit = null } = {}) {
    const group = new T.Group();
    const paint = addFlakes(new T.MeshPhysicalMaterial({ color: paintHex, metalness: 0.7, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.03 }));
    const glass = new T.MeshPhysicalMaterial({ color: 0x22120a, metalness: 0.05, roughness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.05, envMapIntensity: 0.5 });
    const trim = new T.MeshPhysicalMaterial({ color: 0x0b0c0e, metalness: 0.3, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const satin = new T.MeshStandardMaterial({ color: 0x141518, metalness: 0.5, roughness: 0.6 });
    if (!kit) {
      const body = new T.Mesh(bodyGeometry(), [paint, glass, trim]);
      body.castShadow = shadows; body.receiveShadow = false;
      group.add(body);
    }

    const addAny = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); group.add(m); return m;
    };
    const add = kit ? () => null : addAny; // body-only details: skipped when a GLB body supplies its own
    // nose: two slim light blades angled in towards a body-colour gap, dark intake band and splitter below
    const front = new T.MeshBasicMaterial({ color: new T.Color(1.6, 1.6, 1.75), toneMapped: false });
    for (const sx of [-1, 1]) add(new T.BoxGeometry(0.66, 0.022, 0.03), front, sx * 0.53, 0.505, -2.372, 0, 0, sx * 0.05);
    add(new T.BoxGeometry(1.62, 0.1, 0.03), new T.MeshStandardMaterial({ color: 0x050506, metalness: 0.6, roughness: 0.25 }), 0, 0.44, -2.37);
    add(new T.BoxGeometry(1.2, 0.05, 0.03), satin, 0, 0.335, -2.37);
    // hood: a pair of dark heat vents ahead of the windscreen, laid along the hood's slope
    for (const sx of [-1, 1]) add(new T.BoxGeometry(0.3, 0.012, 0.2), trim, sx * 0.3, 0.822, -1.55, -0.28, 0, 0);
    // gull-wing door shut lines: thin dark strips laid on the side between sill top and shoulder crease
    const seamMat = new T.MeshBasicMaterial({ color: 0x050506 });
    for (const zc of [-0.92, 0.98]) {
      const pr = profileAt(zc), a = pr[4], b = pr[5];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[0] - a[0], b[1] - a[1]);
      for (const sx of [-1, 1]) add(new T.BoxGeometry(0.004, len, 0.012), seamMat, sx * ((a[0] + b[0]) / 2 + 0.004), (a[1] + b[1]) / 2, zc, 0, 0, -sx * ang);
    }
    // amber side markers behind the front arches
    const amber = new T.MeshBasicMaterial({ color: new T.Color(1.2, 0.45, 0.04), toneMapped: false });
    for (const sx of [-1, 1]) add(new T.BoxGeometry(0.01, 0.025, 0.12), amber, sx * 0.995, 0.8, -0.8);
    // tail: a red blade at each corner joined by a thin line under the ducktail lip, body-colour panel, dark diffuser with four nozzles
    const tail = new T.MeshBasicMaterial({ color: new T.Color(1.5, 0.04, 0.05), toneMapped: false });
    for (const sx of [-1, 1]) add(new T.BoxGeometry(0.5, 0.05, 0.03), tail, sx * 0.68, 0.83, 2.372);
    add(new T.BoxGeometry(0.88, 0.012, 0.03), tail, 0, 0.83, 2.372);
    add(new T.BoxGeometry(1.7, 0.2, 0.02), paint, 0, 0.7, 2.37);
    add(new T.BoxGeometry(1.7, 0.3, 0.42), trim, 0, 0.42, 2.17);
    for (let i = -2; i <= 2; i++) add(new T.BoxGeometry(0.025, 0.16, 0.4), satin, i * 0.34, 0.38, 2.2);
    // rear nozzles (4)
    const ring = new T.MeshStandardMaterial({ color: 0x8a8d92, metalness: 1, roughness: 0.22 });
    const rearGlow = new T.MeshBasicMaterial({ color: new T.Color(0.05, 0.08, 0.12), toneMapped: false });
    const nozGeo = new T.CylinderGeometry(0.075, 0.085, 0.2, 18, 1, true);
    const lipGeo = new T.TorusGeometry(0.08, 0.012, 6, 18);
    const discGeo = new T.CircleGeometry(0.075, 16);
    const rearPos = kit ? kit.rear : [-0.5, -0.17, 0.17, 0.5].map((x) => [x, 0.5, 2.4]);
    const jetsRear = [];
    const jetMatRear = G.jetMaterial(new T.Color(0.6, 0.85, 1.5));
    for (const [x, y, z] of rearPos) {
      add(nozGeo, ring, x, y, z - 0.1, Math.PI / 2, 0, 0);
      add(lipGeo, ring, x, y, z);
      add(discGeo, rearGlow, x, y, z - 0.15, 0, 0, 0);
      const j = new T.Mesh(G.jetGeometry(), jetMatRear);
      j.position.set(x, y, z); j.rotation.x = -Math.PI / 2; // plume -Y -> +Z (backwards)
      j.userData.w = (kit && kit.rearW) || 1; // plume width for bigger nozzles
      j.scale.set(1, 0.001, 1); j.visible = false; j.frustumCulled = false;
      group.add(j); jetsRear.push(j);
    }
    // plate
    if (!plateTex) plateTex = G.canvasTexture(128, 40, (ctx, W, H) => {
      ctx.fillStyle = '#d8d8d4'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#222'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('RDSTR', W / 2, H / 2 + 1);
    });
    add(new T.PlaneGeometry(0.42, 0.13), new T.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }), 0, 0.68, 2.382);
    // wing: a low, narrower blade inside the body width, short posts rising out of the ducktail, red light tips
    const foil = new T.Shape();
    foil.moveTo(0, 0); foil.quadraticCurveTo(0.12, 0.05, 0.46, 0.012); foil.lineTo(0.46, -0.005); foil.quadraticCurveTo(0.2, 0.0, 0, -0.015);
    const wingGeo = new T.ExtrudeGeometry(foil, { depth: 1.72, bevelEnabled: false, curveSegments: 8 });
    wingGeo.translate(-0.23, 0, -0.86); wingGeo.rotateY(-Math.PI / 2);
    add(wingGeo, trim, 0, 1.13, 2.1, 0.1, 0, 0);
    const postGeo = new T.BoxGeometry(0.04, 0.24, 0.14);
    for (const sx of [-1, 1]) {
      add(postGeo, trim, sx * 0.42, 1.02, 2.12, -0.2, 0, 0);
      add(new T.BoxGeometry(0.03, 0.025, 0.38), tail, sx * 0.865, 1.13, 2.1, 0.1, 0, 0);
    }
    // under thrusters (4): FL, FR, RL, RR
    const underGlow = new T.MeshBasicMaterial({ color: new T.Color(0.05, 0.08, 0.12), toneMapped: false, side: T.DoubleSide });
    const jetMatUnder = G.jetMaterial(new T.Color(0.5, 0.85, 1.7));
    const underPos = [[-0.42, -0.95], [0.42, -0.95], [-0.42, 0.95], [0.42, 0.95]];
    const jetsUnder = [];
    for (const [x, z] of underPos) {
      addAny(new T.CylinderGeometry(0.12, 0.13, 0.1, 14, 1, true), ring, x, 0.19, z);
      addAny(discGeo, underGlow, x, 0.17, z, Math.PI / 2, 0, 0);
      const j = new T.Mesh(G.jetGeometry(), jetMatUnder);
      j.position.set(x, 0.15, z); j.scale.set(1.2, 0.001, 1.2); j.visible = false; j.frustumCulled = false;
      group.add(j); jetsUnder.push(j);
    }
    // flank thrusters (2 per side, in the doors): jetsSide[0..1] on the left flank fire left (E: push right),
    // jetsSide[2..3] on the right flank fire right (Q: push left)
    const sideGlow = new T.MeshBasicMaterial({ color: new T.Color(0.05, 0.08, 0.12), toneMapped: false, side: T.DoubleSide });
    const jetsSide = [];
    const sideX = kit ? kit.sideX : 1.0, sideY = kit ? kit.sideY : 0.5;
    for (const sx of [-1, 1]) for (const z of [-0.5, 0.45]) {
      addAny(new T.CylinderGeometry(0.09, 0.1, 0.08, 14, 1, true), ring, sx * sideX, sideY, z, 0, 0, Math.PI / 2);
      addAny(new T.CircleGeometry(0.09, 14), sideGlow, sx * (sideX - 0.03), sideY, z, 0, sx * Math.PI / 2, 0);
      const j = new T.Mesh(G.jetGeometry(), jetMatUnder);
      j.position.set(sx * (sideX + 0.03), sideY, z); j.rotation.z = sx * Math.PI / 2; // plume -Y -> outwards
      j.scale.set(1, 0.001, 1); j.visible = false; j.frustumCulled = false;
      group.add(j); jetsSide.push(j);
    }

    // wheels: low-profile tyre, dark aero face with 5 swept blades, brake disc and a caliper that doesn't spin
    const tyreMat = new T.MeshStandardMaterial({ color: 0x0d0d0e, roughness: 0.88 });
    const faceMat = new T.MeshPhysicalMaterial({ color: 0x07080a, metalness: 0.6, roughness: 0.25, clearcoat: 1 });
    const bladeMat = new T.MeshStandardMaterial({ color: 0x5c6066, metalness: 0.9, roughness: 0.3 });
    const discMat = new T.MeshStandardMaterial({ color: 0x6a6c70, metalness: 0.9, roughness: 0.45 });
    const caliperMat = new T.MeshStandardMaterial({ color: 0x1a1b1e, metalness: 0.4, roughness: 0.4 });
    const tp = [[0.29, -0.155], [0.33, -0.16], [0.358, -0.15], [0.368, -0.12], [0.37, -0.05], [0.37, 0.05], [0.368, 0.12], [0.358, 0.15], [0.33, 0.16], [0.29, 0.155]];
    const tyreGeo = new T.LatheGeometry(tp.map(([r, y]) => new T.Vector2(r, y)), 40); tyreGeo.rotateZ(Math.PI / 2);
    const barrelGeo = new T.CylinderGeometry(0.29, 0.29, 0.3, 32, 1, true); barrelGeo.rotateZ(Math.PI / 2);
    const rimLipGeo = new T.TorusGeometry(0.287, 0.012, 6, 40); rimLipGeo.rotateY(Math.PI / 2);
    const faceGeo = new T.CircleGeometry(0.285, 36); faceGeo.rotateY(Math.PI / 2);
    const hubGeo = new T.CylinderGeometry(0.055, 0.065, 0.04, 14); hubGeo.rotateZ(Math.PI / 2);
    const blade = bladeGeometry();
    const discGeo2 = new T.CylinderGeometry(0.22, 0.22, 0.025, 28); discGeo2.rotateZ(Math.PI / 2);
    const caliperGeo = new T.BoxGeometry(0.07, 0.16, 0.1);
    const wheels = [];
    const wp = [[-0.88, WHEEL_Z[0], true], [0.88, WHEEL_Z[0], true], [-0.88, WHEEL_Z[1], false], [0.88, WHEEL_Z[1], false]];
    for (const [x, z, fr] of wp) {
      const side = Math.sign(x);
      // kit.frontOne: a three-wheeler. Physics keeps both front contact points; one wheel is drawn on the centre line
      // (dressed on both faces) and the other is hidden
      const one = !!(kit && kit.frontOne && fr);
      const pivot = new T.Group(); pivot.position.set(one ? 0 : x, WHEEL_Y, z);
      if (one && side > 0) pivot.visible = false;
      // hold: a GLB body with bigger arches scales the wheel up and lifts it (the body is lifted by the same amount
      // in tools/prep_car.py) so the tyre still meets the ground where the physics wheel does
      const hold = new T.Group(); pivot.add(hold);
      if (kit && kit.wheelR) {
        hold.scale.setScalar(kit.wheelR / 0.37);
        hold.position.set(one ? 0 : side * ((kit.wheelX || 0.88) - 0.88), kit.wheelR - 0.37, 0);
      }
      const spin = new T.Group(); hold.add(spin);
      const tyre = new T.Mesh(tyreGeo, tyreMat); tyre.castShadow = shadows; spin.add(tyre);
      spin.add(new T.Mesh(barrelGeo, satin));
      for (const sd of one ? [-1, 1] : [side]) {
        const lip = new T.Mesh(rimLipGeo, bladeMat); lip.position.x = sd * 0.14; spin.add(lip);
        const face = new T.Mesh(faceGeo, faceMat); face.position.x = sd * 0.1; face.rotation.y = sd > 0 ? 0 : Math.PI; spin.add(face);
        for (let s = 0; s < 5; s++) {
          const b = new T.Mesh(blade, bladeMat);
          b.position.x = sd * 0.1 + (sd > 0 ? 0 : -0.035);
          b.rotation.x = (s / 5) * Math.PI * 2 * sd; b.scale.z = sd; spin.add(b);
        }
        const hub = new T.Mesh(hubGeo, bladeMat); hub.position.x = sd * 0.13; spin.add(hub);
      }
      const disc = new T.Mesh(discGeo2, discMat); disc.position.x = side * 0.02; spin.add(disc);
      const cal = new T.Mesh(caliperGeo, caliperMat); cal.position.set(side * 0.055, 0.15, fr ? 0.08 : -0.08); hold.add(cal);
      group.add(pivot);
      wheels.push({ pivot, spin, front: fr, x, z });
    }
    return { group, wheels, jetsUnder, jetsRear, jetsSide, rearGlow, underGlow, sideGlow, tail, paint, glass, jetMatRear, jetMatUnder };
  };

  // ---------------- car roster ----------------
  // GLB bodies are generated in flat light grey and painted here: a shader mask picks the grey body panels out of the
  // texture (mid luminance, low saturation) and tints them with the chosen colour under a clearcoat with metal flake.
  // Glass, tyres, trim and lights keep their texture. The GLB is already scaled and centred by tools/prep_car.py:
  // front towards -Z, wheel centres on the physics wheels, its own wheels cut away (the code wheels spin and steer).
  G.CARS = [
    { id: 'thruster', name: 'THRUSTER', desc: 'The original faceted wedge. Four rear nozzles, gull-wing doors.' },
    {
      id: 'comet', name: 'COMET', desc: 'Low open-top roadster with a long hood and twin rear thrusters.', glb: 'models/comet.glb', v: 4,
      kit: { rear: [[-0.42, 0.5, 2.38], [-0.3, 0.5, 2.38], [0.3, 0.5, 2.38], [0.42, 0.5, 2.38]], sideX: 0.97, sideY: 0.5,
        wheelR: 0.464, wheelX: 0.98 },
      shade: 0.05, // Meshy bakes blotchy shading into the albedo; the real lighting does that job
      mask: { lumLo: 0.05, lumHi: 0.13, whiteLo: 0.8, whiteHi: 0.95, satLo: 0.1, satHi: 0.22 },
    },
    {
      id: 'comet2', name: 'COMET', desc: 'Hand-built open two-seater: wedge nose with a full-width light strip, wraparound screen, twin head fairings.',
      glb: 'models/comet2.glb', v: 3, hand: true, // modelled in Blender by tools/model_comet2.py
      kit: { rear: [[-0.36, 0.43, 2.33], [0.36, 0.43, 2.33]], rearW: 1.6, sideX: 1.03, sideY: 0.5, wheelR: 0.46, wheelX: 0.94 },
    },
    {
      id: 'bastion',name: 'BASTION', desc: 'Widebody grand tourer with a long hood, ducktail and twin rear thrusters.', glb: 'models/bastion.glb', v: 1,
      kit: { rear: [[-0.3, 0.33, 2.42], [0.3, 0.33, 2.42]], rearW: 1.8, sideX: 1.05, sideY: 0.5,
        wheelR: 0.437, wheelX: 0.955 },
      shade: 0.05,
      mask: { lumLo: 0.05, lumHi: 0.13, whiteLo: 0.97, whiteHi: 1.01, satLo: 0.1, satHi: 0.22 }, // no white parts: Meshy baked a bright roof highlight
    },
    {
      id: 'bastion2', name: 'BASTION', desc: 'Hand-built widebody grand tourer: long domed hood, ducktail, four ring tail lights and twin turbines.',
      glb: 'models/bastion2.glb', v: 2, hand: true, // modelled in Blender by tools/model_bastion2.py, no AI texture
      kit: { rear: [[-0.3, 0.37, 2.56], [0.3, 0.37, 2.56]], rearW: 1.8, sideX: 1.06, sideY: 0.5, wheelR: 0.42, wheelX: 0.92 },
    },
    {
      id: 'pebble', name: 'PEBBLE', desc: 'Bubbly city pod on oversized wheels, with a panoramic canopy and one round tail thruster.', glb: 'models/pebble.glb', v: 1,
      kit: { rear: [[0, 0.9, 2.42]], rearW: 1.1, sideX: 1.55, sideY: 0.8,
        wheelR: 0.684, wheelX: 1.357 },
      shade: 0.05,
      mask: { lumLo: 0.05, lumHi: 0.13, whiteLo: 0.97, whiteHi: 1.01, satLo: 0.1, satHi: 0.22 },
    },
    // hand-built in Blender by tools/model_<id>.py (shared kit in tools/carlib.py)
    {
      id: 'mantis', name: 'MANTIS', desc: 'Open-wheel single-seater: needle nose, side pods, halo, big wings and one ribbed tail thruster.',
      glb: 'models/mantis.glb', v: 1, hand: true,
      kit: { rear: [[0, 0.42, 2.3]], rearW: 1.7, sideX: 0.72, sideY: 0.36, wheelR: 0.40, wheelX: 0.98 },
    },
    {
      id: 'ridgeback', name: 'RIDGEBACK', desc: 'Long-travel desert buggy: faceted tub, full roll cage, roof light bar, twin thrusters on the cage.',
      glb: 'models/ridgeback.glb', v: 1, hand: true,
      kit: { rear: [[-0.3, 1.36, 2.12], [0.3, 1.36, 2.12]], rearW: 1.6, sideX: 0.9, sideY: 0.75, wheelR: 0.52, wheelX: 1.15 },
    },
    {
      id: 'halo', name: 'HALO', desc: '1950s jet-age teardrop: bubble canopy, tail fins, skirted rear wheels and a turbine at each end.',
      glb: 'models/halo.glb', v: 2, hand: true,
      kit: { rear: [[0, 0.5, 2.48]], rearW: 2.1, sideX: 1.02, sideY: 0.45, wheelR: 0.37, wheelX: 0.76 },
    },
    {
      id: 'brick', name: 'BRICK', desc: 'Boxy 80s rally hatch: bolt-on flares, roof wing, four rally lamps and twin thrusters in the bumper.',
      glb: 'models/brick.glb', v: 1, hand: true,
      kit: { rear: [[-0.32, 0.42, 2.34], [0.32, 0.42, 2.34]], rearW: 1.1, sideX: 0.92, sideY: 0.6, wheelR: 0.43, wheelX: 0.86 },
    },
    {
      id: 'rhino', name: 'RHINO', desc: 'Armoured off-roader: slit windows, ram plows, roof rails and two big thrusters on the roof corners.',
      glb: 'models/rhino.glb', v: 1, hand: true,
      kit: { rear: [[-0.46, 1.95, 2.44], [0.46, 1.95, 2.44]], rearW: 2.1, sideX: 1.1, sideY: 0.85, wheelR: 0.52, wheelX: 1.10 },
    },
    {
      id: 'atlas', name: 'ATLAS', desc: 'The World Tour champion GT: bubble canopy, two big deck turbines and a swept arch over the tail.',
      glb: 'models/atlas.glb', v: 2, hand: true,
      kit: { rear: [[0.4, 1.0, 2.56], [-0.4, 1.0, 2.56]], rearW: 2.1, sideX: 1.18, sideY: 0.45, wheelR: 0.42, wheelX: 0.92 },
    },
    {
      id: 'shard', name: 'SHARD', desc: 'Folded-steel armoured truck: flat slab roof, hexagonal arches and a big turbine in the cargo bed.',
      glb: 'models/shard.glb', v: 2, hand: true,
      kit: { rear: [[0, 1.38, 2.52]], rearW: 2.2, sideX: 1.0, sideY: 0.72, wheelR: 0.47, wheelX: 0.95 },
    },
    {
      // Showroom-only remodel of SHARD, closer to the concept images: taller body, more room above the arches.
      id: 'shard2', name: 'SHARD v2', desc: 'Folded-steel armoured truck, tall and slab-sided: flat slab roof, big hexagonal arches and a turbine riding high in the cargo bed.',
      glb: 'models/shard2.glb', v: 1, hand: true,
      kit: { rear: [[0, 1.7, 2.52]], rearW: 2.2, sideX: 1.0, sideY: 0.72, wheelR: 0.47, wheelX: 0.95 },
    },
    {
      id: 'tuktuk', name: 'TUK TUK', desc: 'A three-wheel rickshaw from the lake road: one front wheel, a canopy on posts, a big wing and two rocket nozzles.',
      glb: 'models/tuktuk.glb', v: 1, hand: true,
      kit: { rear: [[0.32, 0.6, 2.62], [-0.32, 0.6, 2.62]], rearW: 1.7, sideX: 0.7, sideY: 0.55, wheelR: 0.38, wheelX: 0.88, frontOne: true },
    },
    {
      // Showroom-only remodel of TUK TUK, closer to the concept images. Not in G.GARAGE_CARS until Oscar picks it.
      id: 'tuktuk2', name: 'TUK TUK v2', desc: 'A three-wheel rickshaw from the lake road: one front wheel under a big round headlight, a curled canopy, a pleated bench and two ribbed rocket nozzles.',
      glb: 'models/tuktuk2.glb', v: 1, hand: true,
      kit: { rear: [[0.3, 0.5, 2.52], [-0.3, 0.5, 2.52]], rearW: 1.7, sideX: 1.0, sideY: 0.6, wheelR: 0.34, wheelX: 0.86, frontOne: true },
    },
  ];
  G.PAINTS = [
    { name: 'Arctic', hex: 0xd9dcdf }, { name: 'Rosso', hex: 0xb3121b }, { name: 'Ember', hex: 0xe0561a }, { name: 'Solar', hex: 0xe8b51c },
    { name: 'Venom', hex: 0x5fae2a }, { name: 'Lagoon', hex: 0x0f8c8c }, { name: 'Cobalt', hex: 0x1c4fc4 }, { name: 'Midnight', hex: 0x18213f },
    { name: 'Violet', hex: 0x6a2bb3 }, { name: 'Sakura', hex: 0xe87fa8 }, { name: 'Graphite', hex: 0x3a3d42 }, { name: 'Onyx', hex: 0x0c0d0f },
  ];
  // Garage roster, in display order. START_CARS can be picked from the first run; the rest show locked.
  // The Meshy/Tripo cars (comet, bastion, pebble) and the v2 remodels (tuktuk2, shard2) stay showroom-only. Ctrl+Shift+U toggles "unlock all" for testing.
  G.GARAGE_CARS = ['thruster', 'mantis', 'ridgeback', 'halo', 'brick', 'rhino', 'comet2', 'bastion2', 'atlas', 'shard', 'tuktuk'];
  G.START_CARS = ['thruster', 'mantis', 'ridgeback'];
  G.carInfo = (id) => G.CARS.find((c) => c.id === id) || G.CARS[0];
  // the free web demo drives the START_CARS only; the rest need the FULL GAME and then their own goal (js/account.js)
  G.carUnlocked = (id) => G.START_CARS.includes(id) || (G.isFull() && (G.store.get('unlockAll', false) || G.store.get('unlockedCars', []).includes(id)));

  // ---- unlocks: each locked Garage car has one goal. Progress lives in localStorage rt_progress
  // ({ tracks: [ids with a finished street race], officialWin, courseDone, mpRaced, tourWin, fjordWin, atitlanWin }); stunt levels count from
  // rt_chalLvl_<i> (any cleared level, practice included). G.checkUnlocks() moves met goals into rt_unlockedCars.
  const prog = () => G.store.get('progress', {});
  G.progress = (patch) => { const p = Object.assign(prog(), patch); G.store.set('progress', p); return p; };
  G.UNLOCKS = {
    halo: { goal: 'Finish a Street Race on every track', of: () => [Object.keys(G.TRACKS).filter((t) => (prog().tracks || []).includes(t)).length, Object.keys(G.TRACKS).length] },
    brick: { goal: 'Win an Official Street Race (2 laps, heavy traffic, 7 rivals, PRO)', of: () => [prog().officialWin ? 1 : 0, 1] },
    rhino: { goal: 'Clear every Stunt Challenge level', of: () => { const n = (G.CHAL_LEVELS || []).length || 15; let k = 0; for (let i = 0; i < n; i++) if (G.store.get('chalLvl_' + i, 0) > 0) k++; return [k, n]; } },
    comet2: { goal: 'Complete the Obstacle Course without wrecking', of: () => [prog().courseDone ? 1 : 0, 1] },
    bastion2: { goal: 'Race a friend in Multiplayer', of: () => [prog().mpRaced ? 1 : 0, 1] },
    atlas: { goal: 'Win the World Tour', of: () => [prog().tourWin ? 1 : 0, 1] },
    shard: { goal: "Win a Street Race on DEVIL'S FJORD", of: () => [prog().fjordWin ? 1 : 0, 1] },
    tuktuk: { goal: 'Win a Street Race on LAKE ATITLÁN', of: () => [prog().atitlanWin ? 1 : 0, 1] },
  };
  // "goal (k/n)" for the Garage
  G.unlockHint = (id) => { if (!G.isFull() && !G.START_CARS.includes(id)) return 'FULL GAME'; const u = G.UNLOCKS[id]; if (!u) return ''; const [k, n] = u.of(); return n > 1 ? `${u.goal} (${k}/${n})` : u.goal; };
  // newly earned cars (their ids), saved as unlocked
  G.checkUnlocks = () => {
    const have = G.store.get('unlockedCars', []), fresh = [];
    for (const [id, u] of Object.entries(G.UNLOCKS)) { const [k, n] = u.of(); if (k >= n && !have.includes(id)) { have.push(id); fresh.push(id); } }
    if (fresh.length) G.store.set('unlockedCars', have);
    return fresh;
  };

  // a locked car previewed in the Garage: a flickering cyan hologram with scanlines and static (G.HOLO.uniforms.t ticks in the game loop)
  G.HOLO = new T.ShaderMaterial({
    uniforms: { t: { value: 0 } },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, side: T.DoubleSide,
    vertexShader: `varying vec3 vN; varying vec3 vV; varying vec3 vW;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vec4 mv = viewMatrix * w;
        vN = normalize(normalMatrix * normal); vV = -mv.xyz; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float t; varying vec3 vN; varying vec3 vV; varying vec3 vW;
      float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main() {
        float rim = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0);
        float scan = 0.55 + 0.45 * sin(vW.y * 90.0 - t * 9.0);
        float band = smoothstep(0.0, 0.08, abs(fract(vW.y * 0.6 - t * 0.35) - 0.5));
        float stat = h(floor(gl_FragCoord.xy / 2.0) + floor(t * 30.0));
        float flick = 0.85 + 0.15 * sin(t * 37.0) * sin(t * 13.0);
        float a = (0.16 + rim * 1.1) * scan * flick * (0.65 + 0.7 * stat) * mix(1.8, 1.0, band);
        gl_FragColor = vec4(vec3(0.35, 0.85, 1.0) * a, 1.0);
      }`,
  });
  G.hologram = (model) => model.group.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isSprite) return;
    if (o.isMesh && o.geometry.attributes.normal) { o.material = G.HOLO; o.castShadow = false; } else o.visible = false;
  });

  const glbCache = {}, glbReady = {};
  // load (once) and prepare a car's GLB; resolves to null for code-built cars or if the file is missing
  G.loadCar = function (id) {
    const car = G.carInfo(id);
    if (!car.glb) return Promise.resolve(null);
    if (!glbCache[id]) {
      glbCache[id] = new ADDONS.GLTFLoader().loadAsync(car.glb + '?v=' + (car.v || 1)).then((gltf) => {
        const meshes = [];
        gltf.scene.traverse((o) => { if (o.isMesh) meshes.push(o); });
        // average grey of the masked body texels, so any paint colour lands at its true value
        const src = meshes[0] && meshes[0].material;
        const gray = src && src.map ? maskedGray(src.map.image, car.mask) : 0.5;
        return (glbReady[id] = { scene: gltf.scene, gray });
      }).catch((e) => { console.warn('car ' + id + ' failed to load', e); delete glbCache[id]; return null; }); // a later pick retries
    }
    return glbCache[id];
  };

  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  function bodyMask(r, g, b, M) {
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b, mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    const sat = mx > 1e-4 ? (mx - mn) / mx : 0;
    return { l, m: sstep(M.lumLo, M.lumHi, l) * (1 - sstep(M.whiteLo, M.whiteHi, l)) * (1 - sstep(M.satLo, M.satHi, sat)) };
  }
  function maskedGray(img, M) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 128;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0, 128, 128);
      const d = ctx.getImageData(0, 0, 128, 128).data;
      let sw = 0, sl = 0;
      for (let i = 0; i < d.length; i += 4) {
        const { l, m } = bodyMask(lin(d[i] / 255), lin(d[i + 1] / 255), lin(d[i + 2] / 255), M);
        sw += m; sl += m * l;
      }
      return sw > 1 ? sl / sw : 0.5;
    } catch (e) { return 0.5; }
  }

  // paint finishes: rough/metal = body paint, coat/coatRough = clear coat, flat = how much of the AI normal map is
  // ignored on paint (1 = all), flake = metal flake sparkle. 'gloss' is the original look.
  G.FINISHES = {
    gloss: { name: 'Gloss metallic', rough: 0.36, metal: 0.6, coat: 1, coatRough: 0.03, flat: 0.85, flake: 0.35 },
    soft: { name: 'Soft gloss', rough: 0.45, metal: 0.45, coat: 1, coatRough: 0.18, flat: 1, flake: 0.25 },
    satin: { name: 'Satin', rough: 0.55, metal: 0.3, coat: 0.6, coatRough: 0.4, flat: 1, flake: 0.15 },
    matte: { name: 'Matte', rough: 0.8, metal: 0.1, coat: 0, coatRough: 0.6, flat: 1, flake: 0 },
    pearl: { name: 'Pearl', rough: 0.4, metal: 0.25, coat: 1, coatRough: 0.12, flat: 1, flake: 0.6 },
  };
  G.setFinish = function (model, f) {
    const m = model && model.paint, u = m && m.userData.u;
    if (!m) return;
    if (!u) { m.roughness = f.rough; m.metalness = f.metal; m.clearcoat = f.coat; m.clearcoatRoughness = f.coatRough; return; } // code-built THRUSTER
    u.uFin.value.set(f.rough, f.metal, f.flat, f.flake);
    m.clearcoat = f.coat; m.clearcoatRoughness = f.coatRough;
  };

  function paintMaterial(src, car, gray, paintHex) {
    const mat = new T.MeshPhysicalMaterial({
      map: src.map, normalMap: src.normalMap, roughnessMap: src.roughnessMap, metalnessMap: src.metalnessMap,
      aoMap: src.aoMap, emissiveMap: src.emissiveMap, emissive: src.emissive, color: 0xffffff,
      roughness: src.roughnessMap ? 1 : 0.6, metalness: src.metalnessMap ? 1 : 0.1,
      clearcoat: 1, clearcoatRoughness: 0.03,
    });
    if (src.normalMap) mat.normalScale.copy(src.normalScale);
    const M = car.mask;
    const u = mat.userData.u = {
      uPaint: { value: new T.Color(paintHex) }, uGray: { value: Math.max(0.05, gray) }, uShade: { value: car.shade ?? 1 },
      uMask: { value: new T.Vector4(M.lumLo, M.lumHi, M.whiteLo, M.whiteHi) }, uSat: { value: new T.Vector2(M.satLo, M.satHi) },
      uFin: { value: new T.Vector4() },
    };
    const F = G.FINISHES.gloss;
    u.uFin.value.set(F.rough, F.metal, F.flat, F.flake);
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u);
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vFlakeP;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFlakeP = position;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
uniform vec3 uPaint; uniform float uGray; uniform float uShade; uniform vec4 uMask; uniform vec2 uSat; uniform vec4 uFin;
varying vec3 vFlakeP;
vec3 flakeHash(vec3 p) { p = fract(p * vec3(0.1031, 0.1030, 0.0973)); p += dot(p, p.yxz + 33.33); return fract((p.xxy + p.yxx) * p.zyx); }`)
        .replace('#include <map_fragment>', `#include <map_fragment>
float paintMask;
{ vec3 c = diffuseColor.rgb; float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float mx = max(c.r, max(c.g, c.b)), sat = mx > 1e-4 ? (mx - min(c.r, min(c.g, c.b))) / mx : 0.0;
  paintMask = smoothstep(uMask.x, uMask.y, l) * (1.0 - smoothstep(uMask.z, uMask.w, l)) * (1.0 - smoothstep(uSat.x, uSat.y, sat));
  diffuseColor.rgb = mix(c, uPaint * mix(1.0, clamp(l / uGray, 0.35, 1.6), uShade), paintMask); }`)
        .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
roughnessFactor = mix(roughnessFactor, uFin.x, paintMask); metalnessFactor = mix(metalnessFactor, uFin.y, paintMask);`)
        .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(mix(normal, nonPerturbedNormal, paintMask * uFin.z)); // the AI normal map is lumpy on panels
{ vec3 fp = vFlakeP * 260.0; float fade = (1.0 - smoothstep(0.35, 1.0, length(fwidth(fp)))) * paintMask;
  normal = normalize(normal + (flakeHash(floor(fp)) - 0.5) * uFin.w * fade); }`)
        .replace('#include <lights_physical_fragment>', `#include <lights_physical_fragment>
material.clearcoat *= mix(0.25, 1.0, paintMask);`);
    };
    mat.customProgramCacheKey = () => 'carpaint';
    return mat;
  }

  // build any car in the roster. GLB cars must have been loaded with G.loadCar first; until then (or if the file
  // is missing) the THRUSTER stands in. Returns the same model shape as buildRoadster.
  G.buildCar = function (id, paintHex, opts = {}) {
    const car = G.carInfo(id);
    const asset = car.glb && glbReady[id];
    if (!asset) return G.buildRoadster(paintHex, opts);
    const model = G.buildRoadster(paintHex, Object.assign({}, opts, { kit: car.kit }));
    const body = asset.scene.clone(true);
    let paint = null;
    if (car.hand) {
      // hand-built in Blender: parts come split by material name; paint, glass and lights get the game's own materials
      const head = new T.MeshBasicMaterial({ color: new T.Color(1.6, 1.6, 1.75), toneMapped: false });
      const swap = { paint: model.paint, glass: model.glass, light_head: head, light_tail: model.tail };
      body.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = opts.shadows !== false; o.receiveShadow = false;
        const name = (o.material && o.material.name) || '';
        if (swap[name]) o.material = swap[name];
      });
      model.group.add(body);
      model.carId = id;
      return model;
    }
    body.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = opts.shadows !== false; o.receiveShadow = false;
      paint = paint || paintMaterial(o.material, car, asset.gray, paintHex);
      o.material = paint;
    });
    model.group.add(body);
    model.paint = paint; model.glass = paint; // the reflection probe feeds both
    model.carId = id;
    return model;
  };
  // cockpit camera spot for a car model, in car space ({ y, z }, forward is -z), worked out once per car from its own
  // geometry: along the centre line, the lowest eye that sits above the body under it and still sees the road 9 m ahead
  // over everything in front of it. Cars with a low open cockpit keep the eye near the driver; a car with a tall cabin
  // or a tinted bubble gets a bonnet cam just ahead of it.
  const eyeCache = {};
  G.cockpitEye = function (model) {
    const key = model.carId || 'thruster';
    if (eyeCache[key]) return eyeCache[key];
    const skip = new Set(model.wheels.map((w) => w.pivot));
    model.group.updateMatrixWorld(true);
    const inv = new T.Matrix4().copy(model.group.matrixWorld).invert(), m = new T.Matrix4(), v = new T.Vector3();
    const pts = [];
    const walk = (o) => {
      if (skip.has(o) || !o.visible) return;
      if (o.isMesh && !o.material.isShaderMaterial && o.geometry.attributes.position) {
        const pos = o.geometry.attributes.position, step = Math.max(1, Math.floor(pos.count / 60000));
        m.multiplyMatrices(inv, o.matrixWorld);
        for (let i = 0; i < pos.count; i += step) {
          v.fromBufferAttribute(pos, i).applyMatrix4(m);
          if (Math.abs(v.x) < 0.7) pts.push(v.x, v.y, v.z);
        }
      }
      for (const c of o.children) walk(c);
    };
    walk(model.group);
    let nose = 0;
    for (let i = 2; i < pts.length; i += 3) nose = Math.min(nose, pts[i]);
    const D = 9, DRIVER = -0.3;
    let best = { y: 1.0, z: DRIVER }, bestScore = Infinity;
    for (let zc = 0.1; zc >= nose + 0.45; zc -= 0.1) {
      let roof = 0.5, need = 0;
      for (let i = 0; i < pts.length; i += 3) {
        const x = pts[i], y = pts[i + 1], z = pts[i + 2];
        if (Math.abs(x) < 0.45 && Math.abs(z - zc) < 0.3) roof = Math.max(roof, y);
        const d = zc - z;
        if (d > 0.3 && d < D - 1) need = Math.max(need, (y + 0.05) / (1 - d / D));
      }
      const y = Math.max(roof + 0.12, need);
      const score = y + 0.35 * Math.abs(zc - DRIVER);
      if (score < bestScore) { bestScore = score; best = { y, z: zc }; }
    }
    return (eyeCache[key] = best);
  };

  G.setPaint = function (model, hex) {
    if (model.paint && model.paint.userData.u) model.paint.userData.u.uPaint.value.setHex(hex);
    else if (model.paint) model.paint.color.setHex(hex);
  };

  // update visual thruster bits. th = {L, R, B, SL, SR} in 0..1
  G.updateRoadsterFX = function (model, th, t, braking) {
    const u = [th.L, th.R, th.L, th.R];
    const ui = Math.max(th.L, th.R), bi = th.B;
    model.jetMatUnder.uniforms.uI.value = 1.3; model.jetMatUnder.uniforms.uT.value = t;
    model.jetMatRear.uniforms.uI.value = 1.3; model.jetMatRear.uniforms.uT.value = t;
    for (let i = 0; i < 4; i++) {
      const j = model.jetsUnder[i];
      const v = u[i];
      j.visible = v > 0.02;
      const fl = 0.9 + Math.random() * 0.2;
      j.scale.set(0.9 + v * 0.5, v * 3.2 * fl, 0.9 + v * 0.5);
    }
    for (const r of model.jetsRear) { // a kit car can have any number of rear nozzles
      const fl = 0.9 + Math.random() * 0.2, w = r.userData.w || 1;
      r.visible = bi > 0.02;
      r.scale.set((0.9 + bi * 0.4) * w, bi * 4.5 * fl, (0.9 + bi * 0.4) * w);
    }
    const sl = th.SL || 0, sr = th.SR || 0;
    for (let i = 0; i < 4; i++) {
      const v = i < 2 ? sr : sl, j = model.jetsSide[i];
      j.visible = v > 0.02;
      j.scale.set(0.8 + v * 0.4, v * 2.6 * (0.9 + Math.random() * 0.2), 0.8 + v * 0.4);
    }
    const si = Math.max(sl, sr);
    model.sideGlow.color.setRGB(0.05 + si * 2, 0.08 + si * 3, 0.12 + si * 5);
    model.underGlow.color.setRGB(0.05 + ui * 2, 0.08 + ui * 3, 0.12 + ui * 5);
    model.rearGlow.color.setRGB(0.05 + bi * 2, 0.08 + bi * 3, 0.12 + bi * 5);
    model.tail.color.setRGB(braking ? 9 : 3.5, braking ? 0.2 : 0.08, braking ? 0.25 : 0.1);
  };

  // ---------------- player physics ----------------
  // the tweakable numbers live in js/tuning.js
  const TU = G.TUNING;
  const ANCHOR_Y = 0.8, WR = 0.36;
  let GRAV, REST, KS, CS, CS_REB, MAXC, MASS, POWER, FMAX, BRAKE, KDRAG, DOWNF, MU, CLAT_F, CLAT_R, F_UNDER, F_BACK, F_SIDE;
  // read G.TUNING into the working numbers. Runs once here; the physics sandbox calls it again after every change
  G.retune = () => {
    GRAV = G.GRAV = TU.gravity;
    REST = TU.springTravel; KS = TU.springStiffness; CS = TU.damperBump; CS_REB = TU.damperRebound; MAXC = TU.bumpStop;
    MASS = TU.mass;
    POWER = TU.enginePower; FMAX = TU.maxDriveForce; BRAKE = TU.brakeForce; KDRAG = TU.airDrag; DOWNF = TU.downforce;
    MU = TU.tyreGrip; CLAT_F = TU.corneringFront; CLAT_R = TU.corneringRear;
    F_UNDER = TU.underThrust * MASS * GRAV; F_BACK = TU.rearThrust * MASS * GRAV; F_SIDE = TU.sideThrust * MASS * GRAV;
  };
  G.retune();
  const BODY_PTS = [
    [0.95, 0.22, 2.1], [-0.95, 0.22, 2.1], [0.95, 0.22, -2.1], [-0.95, 0.22, -2.1],
    [0.55, 1.18, 0.4], [-0.55, 1.18, 0.4], [0.55, 1.05, -0.5], [-0.55, 1.05, -0.5],
    [1.05, 0.6, 0], [-1.05, 0.6, 0], [0, 0.45, -2.35], [0, 0.6, 2.35], [0, 1.2, 2.0],
  ];

  const WO_LIM = 12; // a car this far off the centre line is past the barriers anyway
  const altEffSide = (alt) => (alt < TU.thrustCeiling ? 1 : Math.max(0.25, 1 - (alt - TU.thrustCeiling) / TU.thrustFadeRange));
  const _v = [...Array(12)].map(() => new T.Vector3());
  const _q = new T.Quaternion(), _qi = new T.Quaternion();
  const gq = {};

  class Player {
    constructor(game, model) {
      this.game = game; this.model = model;
      this.pos = new T.Vector3(); this.vel = new T.Vector3();
      this.q = new T.Quaternion(); this.w = new T.Vector3();
      this.I = new T.Vector3(TU.inertiaPitch, TU.inertiaYaw, TU.inertiaRoll);
      this.wheels = model.wheels.map((w) => ({ x: w.x, z: w.z, front: w.front, comp: 0, len: REST, contact: false, spin: 0, spinV: 0, slip: 0 }));
      this.fuel = 100; this.fuelLock = false; this.fuelUse = false; this.fuelIdle = 0; this.fuelCharging = false;
      this.th = { L: 0, R: 0, B: 0, SL: 0, SR: 0 };
      this.steerAngle = 0;
      this.grounded = false; this.airTime = 0; this.contacts = 0;
      this.near = { i: -1 };
      this.speed = 0; this.fwdSpeed = 0; this.slipMax = 0; this.sideSlip = 0;
      this.flipT = 0; this.wallHit = 0; this.braking = false;
      this.rollAcc = 0; this.pitchAcc = 0;
      this.frozen = false;
      this.altitude = 0;
    }

    place(s, lat, speed = 0) {
      const tr = this.game.track;
      const p = tr.sample(s, {});
      const y = tr.heightAt(s);
      this.pos.set(p.x + p.rx * lat, y + 0.02, p.z + p.rz * lat);
      this.q.setFromAxisAngle(_v[0].set(0, 1, 0), Math.atan2(-p.tx, -p.tz));
      this.vel.set(p.tx * speed, 0, p.tz * speed);
      this.w.set(0, 0, 0);
      this.ride = null;
      for (const w of this.wheels) { w.comp = 0.1; w.len = REST - 0.1; w.spinV = 0; }
      this.near.i = -1;
      tr.nearest(this.pos.x, this.pos.z, -1, this.near, y);
      this.flipT = 0; this.airTime = 0;
    }

    ground(x, z, yRef) {
      this.game.track.groundAt(x, z, gq, yRef);
      if (this.game.traffic) this.game.traffic.roofAt(x, z, yRef, gq, this.tnear);
      if (this.game.course) this.game.course.groundAt(x, z, yRef, gq);
      return gq;
    }

    step(dt, inp) {
      const rider = this.game.chalRun ? this.game.chalRun.world : this.game.course;
      if (this.ride && rider) { rider.rideStep(this, dt, inp); return; } // on a loop: follows the track
      const pos = this.pos, vel = this.vel, q = this.q, w = this.w;
      this.I.set(TU.inertiaPitch, TU.inertiaYaw, TU.inertiaRoll);
      const up = _v[0].set(0, 1, 0).applyQuaternion(q);
      const fwd = _v[1].set(0, 0, -1).applyQuaternion(q);
      const right = _v[2].set(1, 0, 0).applyQuaternion(q);
      const F = _v[3].set(0, -GRAV * MASS, 0);
      const Tq = _v[4].set(0, 0, 0);
      const tmp = _v[5], r = _v[6], fv = _v[7];
      const addForce = (f, at) => { F.add(f); r.subVectors(at, pos); Tq.add(fv.crossVectors(r, f)); };

      const vF = vel.dot(fwd);
      this.fwdSpeed = vF;
      const spd = vel.length();

      // steering: tighter at low speed
      const steerMax = G.lerp(TU.steerLowSpeed, TU.steerHighSpeed, G.clamp(Math.abs(vF) / 110, 0, 1));
      this.steerAngle = inp.steer * steerMax;

      // throttle / brake / reverse
      let throttle = inp.throttle, brake = inp.brake, reverse = 0;
      if (brake > 0.1 && vF < 1.5 && throttle < 0.1) { reverse = brake; brake = 0; }
      if (this.frozen) { throttle = 0; brake = 1; reverse = 0; }
      this.braking = brake > 0.1 || (reverse > 0 && vF > 0.5);
      const hand = inp.handbrake || this.frozen;

      // --- suspension & tyres ---
      let contacts = 0; this.slipMax = 0;
      const driveTotal = throttle * Math.min(FMAX, POWER / Math.max(Math.abs(vF), 6)) - reverse * 7000;
      for (const wh of this.wheels) {
        const A = tmp.set(wh.x, ANCHOR_Y, wh.z).applyQuaternion(q).add(pos);
        wh.contact = false;
        if (up.y < 0.25) { wh.len = REST; wh.comp = 0; continue; }
        const g = this.ground(A.x, A.z, A.y);
        const dist = (A.y - g.h) / up.y;
        const len = dist - WR;
        if (len >= REST) { wh.len = REST; wh.comp = 0; wh.spinV *= 0.995; continue; }
        const comp = REST - len;
        const compV = (comp - wh.comp) / dt;
        wh.comp = comp; wh.len = Math.max(len, REST - MAXC);
        // firmer rebound than bump damping (like real shocks) so landings settle instead of springing back up
        let Fs = KS * comp + (compV > 0 ? CS : CS_REB) * compV;
        if (comp > MAXC) Fs += KS * TU.bumpStopStiffness * (comp - MAXC) + CS * TU.bumpStopDamping * compV;
        Fs = G.clamp(Fs, 0, MASS * GRAV * TU.maxWheelForce);
        wh.contact = true; contacts++;
        // contact point
        const P = _v[8].copy(A).addScaledVector(up, -dist);
        const n = _v[9].set(g.nx, g.ny, g.nz);
        // wheel axes
        const wf = _v[10].copy(fwd);
        if (wh.front) { const c = Math.cos(this.steerAngle), s = Math.sin(this.steerAngle); wf.multiplyScalar(c).addScaledVector(right, s); }
        wf.addScaledVector(n, -wf.dot(n)).normalize();
        const wr = _v[11].crossVectors(wf, n);
        // contact velocity relative to the surface (bus roofs move!)
        r.subVectors(P, pos);
        const vP = fv.crossVectors(w, r).add(vel);
        vP.x -= g.vx; vP.y -= g.vy; vP.z -= g.vz;
        const vl = vP.dot(wf), vs = vP.dot(wr);
        const load = Fs + (this.grounded ? DOWNF * spd * spd * 0.25 : 0);
        let grip = MU * load * (this.gripMul || 1); // gripMul: an oil slick on the obstacle course
        let fLat = -vs * (wh.front ? CLAT_F : CLAT_R);
        if (!wh.front && hand) { grip *= TU.driftRearGrip; fLat *= TU.driftRearSide; }
        let fLong = driveTotal / 4;
        const bF = brake * BRAKE / 4 + (!wh.front && hand ? TU.driftBrake : 0);
        fLong -= G.clamp(vl * 2500, -bF, bF);
        fLong -= vl * 25;
        const mag = Math.hypot(fLat, fLong);
        let slip = 0;
        if (mag > grip) { const k = grip / mag; fLat *= k; fLong *= k; slip = (mag - grip) / grip; }
        wh.slip = slip; this.slipMax = Math.max(this.slipMax, slip, Math.abs(vs) > 4 ? (Math.abs(vs) - 4) / 8 : 0);
        // apply
        const f = _v[5].copy(up).multiplyScalar(Fs).addScaledVector(wf, fLong).addScaledVector(wr, fLat);
        addForce(f, P);
        // visual wheel spin
        const wantSpin = !wh.front && hand ? 0 : (throttle > 0.8 && slip > 0.3 && !wh.front ? vl / WR + 30 : vl / WR);
        wh.spinV = wantSpin;
        // re-fetch overwritten vectors
        up.set(0, 1, 0).applyQuaternion(q); fwd.set(0, 0, -1).applyQuaternion(q); right.set(1, 0, 0).applyQuaternion(q);
      }
      this.contacts = contacts;

      // --- body contact points (roof, nose, corners) ---
      let bodyContact = false; const elev = this.game.track.elev;
      for (const bp of BODY_PTS) {
        const P = _v[8].set(bp[0], bp[1], bp[2]).applyQuaternion(q).add(pos);
        const g = this.ground(P.x, P.z, elev ? Math.min(P.y + 0.4, pos.y + 0.6) : P.y + 0.4); // capped: a roof point under a deck must not take it for ground
        const depth = g.h - P.y;
        if (depth <= 0) continue;
        bodyContact = true;
        const n = _v[9].set(g.nx, g.ny, g.nz);
        r.subVectors(P, pos);
        const vP = _v[10].crossVectors(w, r).add(vel);
        vP.x -= g.vx; vP.z -= g.vz;
        const vn = vP.dot(n);
        const Fn = Math.max(0, TU.bodyStiffness * depth - TU.bodyDamping * vn);
        const vt = vP.addScaledVector(n, -vn);
        const vtl = vt.length();
        const f = _v[11].copy(n).multiplyScalar(Fn);
        if (vtl > 0.01) f.addScaledVector(vt, -Math.min(TU.bodyFriction * Fn, vtl * 4000) / vtl);
        addForce(f, P);
        if (vtl > 6 && Fn > 2000) this.onScrape(P, vtl);
      }

      const grounded = contacts > 0;
      this.grounded = grounded;

      // --- aero ---
      F.addScaledVector(vel, -KDRAG * spd);
      if (grounded) F.addScaledVector(up, -DOWNF * spd * spd * 0.5);

      // --- thrusters ---
      const g0 = this.ground(pos.x, pos.z, pos.y + 0.5), trk = this.game.track;
      // over a gap the thrusters work off the road level (else they'd fade over the drop and nothing could fly it)
      let gref = trk.gaps.length && this.near.i >= 0 && trk.gapAt(this.near.s) ? Math.max(g0.h, trk.heightAt(this.near.s) - 1) : g0.h;
      if (trk.thrustRef) gref = Math.max(gref, trk.thrustRef(pos.x, pos.z));
      this.altitude = pos.y - gref;
      if (this.fuel <= 0.5) this.fuelLock = true;
      if (this.fuelLock && this.fuel > 12) this.fuelLock = false;
      const can = !this.fuelLock && !this.frozen;
      // Space fires all four under-thrusters; Space+Q / Space+E keeps only that side's pair lit (roll / flip).
      // Q / E on their own fire the flank thrusters: Q pushes the car left, E pushes it right
      const wantL = can && inp.jump && (!inp.thrR || inp.thrL) ? 1 : 0;
      const wantR = can && inp.jump && (!inp.thrL || inp.thrR) ? 1 : 0;
      const wantSL = can && inp.thrL && !inp.jump ? 1 : 0;
      const wantSR = can && inp.thrR && !inp.jump ? 1 : 0;
      const wantB = can && inp.boost ? 1 : 0;
      // quick spool-up, quick cut
      this.th.L = G.damp(this.th.L, wantL, wantL ? 18 : 12, dt);
      this.th.R = G.damp(this.th.R, wantR, wantR ? 18 : 12, dt);
      this.th.B = G.damp(this.th.B, wantB, wantB ? 14 : 10, dt);
      this.th.SL = G.damp(this.th.SL, wantSL, wantSL ? 18 : 12, dt);
      this.th.SR = G.damp(this.th.SR, wantSR, wantSR ? 18 : 12, dt);
      // flank thrust goes through the centre of mass so it slides the car sideways without rolling it
      const side = this.th.SR - this.th.SL;
      if (Math.abs(side) > 0.01) F.addScaledVector(right, F_SIDE * side * altEffSide(this.altitude));
      const altEff = altEffSide(this.altitude);
      if (this.th.L > 0.01) addForce(_v[5].copy(up).multiplyScalar(F_UNDER * this.th.L * altEff), _v[8].set(-0.62, 0.3, 0).applyQuaternion(q).add(pos));
      if (this.th.R > 0.01) addForce(_v[5].copy(up).multiplyScalar(F_UNDER * this.th.R * altEff), _v[8].set(0.62, 0.3, 0).applyQuaternion(q).add(pos));
      // under-thrusters hold the nose level: they roll the car side to side but never pitch it down
      const underOn = Math.min(1, this.th.L + this.th.R);
      if (underOn > 0.05) Tq.addScaledVector(right, (-fwd.y * 26000 - w.dot(right) * 7000) * underOn);
      if (this.th.B > 0.01) {
        const eff = G.clamp(1 - Math.max(0, vF) / TU.rearThrustFadeSpeed, 0.15, 1);
        F.addScaledVector(fwd, F_BACK * this.th.B * eff);
      }
      this.fuel -= ((wantL + wantR) * TU.fuelUnder + wantB * TU.fuelRear + (wantSL + wantSR) * TU.fuelSide) * dt;
      // recharge on the ground, after a short pause since the thrusters were last fired
      this.fuelUse = wantL + wantR + wantB + wantSL + wantSR > 0;
      this.fuelIdle = this.fuelUse ? 0 : this.fuelIdle + dt;
      this.fuelCharging = !this.noRecharge && grounded && this.fuelIdle > TU.fuelRechargeDelay && this.fuel < 100;
      if (this.fuelCharging) this.fuel += TU.fuelRecharge * dt;
      this.fuel = G.clamp(this.fuel, 0, 100);
      if (this.infFuel) { this.fuel = 100; this.fuelLock = false; }

      // --- assists / air control ---
      const singleSide = Math.abs(this.th.L - this.th.R) > 0.3;
      const worldUp = _v[5].set(0, 1, 0);
      const levelAxis = _v[8].crossVectors(up, worldUp);
      if (!grounded) {
        _q.copy(q);
        const pitchT = _v[9].copy(right).multiplyScalar(inp.pitch * TU.airPitch);
        const yawT = _v[10].copy(up).multiplyScalar(-inp.steer * TU.airYaw);
        Tq.add(pitchT).add(yawT);
        if (inp.rollAir) Tq.addScaledVector(fwd, inp.rollAir * TU.airRoll);
        if (!singleSide && !inp.rollAir && Math.abs(inp.pitch) < 0.1) Tq.addScaledVector(levelAxis, TU.autoLevelAir);
        w.multiplyScalar(Math.exp(-TU.spinDampAir * dt));
      } else {
        if (!singleSide) Tq.addScaledVector(levelAxis, up.y > 0.3 ? TU.autoLevelGround : 0);
        // steering assist: nudge the yaw rate toward what the arrows ask for so the car answers the input quickly
        const yawTarget = -inp.steer * G.clamp(spd / 12, 0, 1) * TU.steerAssist * Math.sign(vF || 1);
        const yawErr = yawTarget - w.dot(up);
        if (Math.abs(inp.steer) > 0.05 && Math.sign(yawErr) === Math.sign(yawTarget)) Tq.addScaledVector(up, yawErr * this.I.y * 4 * Math.abs(inp.steer));
        // stability: catch over-rotation and settle leftover spin once the arrows are released (~0.06 s, so the car stops turning when you let go)
        else if (!hand && contacts >= 3) Tq.addScaledVector(up, yawErr * this.I.y * (Math.abs(inp.steer) > 0.05 ? 4 : 16));
        // grip assist: bend sideways velocity into forward motion so the car goes where it points instead of sliding
        if (!hand && contacts >= 3 && spd > 2 && !(this.gripMul < 0.9)) {
          // energy-safe: forward speed only gains part of what the slide loses, so total speed can never rise
          const vs = vel.dot(right), vsNew = vs * Math.exp(-TU.gripAssist * dt);
          const vfNew = Math.sign(vF || 1) * Math.sqrt(vF * vF + (vs * vs - vsNew * vsNew) * 0.7);
          F.addScaledVector(right, (vsNew - vs) * MASS / dt);
          F.addScaledVector(fwd, (vfNew - vF) * MASS / dt);
        }
        w.multiplyScalar(Math.exp(-TU.spinDampGround * dt));
      }

      // --- integrate ---
      const yPrev = pos.y;
      _qi.copy(q).invert();
      const tl = _v[9].copy(Tq).applyQuaternion(_qi);
      tl.x /= this.I.x; tl.y /= this.I.y; tl.z /= this.I.z;
      tl.applyQuaternion(q);
      w.addScaledVector(tl, dt);
      if (w.lengthSq() > TU.maxSpin * TU.maxSpin) w.setLength(TU.maxSpin);
      vel.addScaledVector(F, dt / MASS);
      pos.addScaledVector(vel, dt);
      _q.set(w.x * dt * 0.5, w.y * dt * 0.5, w.z * dt * 0.5, 0).multiply(q);
      q.set(q.x + _q.x, q.y + _q.y, q.z + _q.z, q.w + _q.w).normalize();

      // trick tracking
      if (!grounded && !bodyContact) {
        this.rollAcc += w.dot(fwd) * dt;
        this.pitchAcc += w.dot(right) * dt;
      }

      // --- walls (building line) ---
      const tr = this.game.track;
      tr.nearest(pos.x, pos.z, this.near.i, this.near, grounded ? pos.y - 0.5 : undefined);
      const lim = G.WALL - 1.1;
      const lat = this.near.lat;
      if (Math.abs(lat) > lim) {
        const sg = Math.sign(lat);
        const nx = this.near.rx * sg, nz = this.near.rz * sg;
        const pen = Math.abs(lat) - lim;
        pos.x -= nx * pen; pos.z -= nz * pen;
        const vn = vel.x * nx + vel.z * nz;
        if (vn > 0) {
          vel.x -= nx * vn * TU.wallBounce; vel.z -= nz * vn * TU.wallBounce;
          const tx = this.near.tx, tz = this.near.tz;
          const vt = vel.x * tx + vel.z * tz;
          const loss = Math.min(0.25, vn * 0.012);
          vel.x -= tx * vt * loss; vel.z -= tz * vt * loss;
          w.y += -sg * Math.sign(vt) * vn * 0.04;
          this.onWallHit(pos, vn, Math.abs(vt));
        } else if (Math.abs(vel.x * this.near.tx + vel.z * this.near.tz) > 8) {
          this.onScrape(pos, 10);
        }
      }

      // --- decks overhead and footbridges (elevated circuits) ---
      if (tr.elev) {
        const c = tr.groundAt(pos.x, pos.z, gq, pos.y).ceil;
        if (pos.y + 1.25 > c) {
          pos.y = c - 1.25;
          if (vel.y > 0) { const vn = vel.y; vel.y = -vn * 0.3; vel.x *= 0.9; vel.z *= 0.9; this.onWallHit(pos, vn, this.speed); }
        }
        for (const b of tr.bridges) {
          if (b.wall && this.r) continue; // the AI doesn't time the geysers: they let it through
          if (pos.y + 1.2 < b.y0 || pos.y > b.y1 - 0.3) continue; // body spans pos.y+0.2 .. +1.2: on top is fine
          const dx = pos.x - b.x, dz = pos.z - b.z, along = dx * b.tx + dz * b.tz;
          const reach = b.hl + 2.2;
          if (Math.abs(along) > reach || Math.abs(dx * b.rx + dz * b.rz) > b.hw) continue;
          const vt = vel.x * b.tx + vel.z * b.tz, sg = vt !== 0 ? -Math.sign(vt) : Math.sign(along) || 1;
          pos.x += b.tx * (sg * reach - along); pos.z += b.tz * (sg * reach - along);
          if (vt * sg < 0) {
            vel.x -= b.tx * vt * 1.3; vel.z -= b.tz * vt * 1.3;
            w.x += (Math.random() - 0.5) * 2; w.z += (Math.random() - 0.5) * 2;
            this.onWallHit(pos, Math.abs(vt), 0);
          }
        }
        // a heavy landing (a ski jump comes down at 30 m/s) must not punch through the deck in one substep: anything
        // that crossed the road surface from above this step is put back on it (wild circuits never cross over themselves)
        if (tr.wild && !tr.gapAt(this.near.s) && Math.abs(this.near.lat) < WO_LIM) {
          const hr = tr.heightAt(this.near.s);
          if (yPrev >= hr - 0.25 && pos.y < hr - 0.25) { pos.y = hr - 0.25; if (vel.y < 0) vel.y *= -0.1; }
        }
        // the far wall of a gap: a car that comes up short hits the cliff instead of popping up onto the road
        for (const gp of tr.gaps) {
          const d = tr.sd(this.near.s, gp.s1);
          if (d < -2.3 || d > 2.3 || pos.y > gp.hFar - 0.8) continue; // the body reaches the far face
          const tx = this.near.tx, tz = this.near.tz, back = d + 2.3;
          pos.x -= tx * back; pos.z -= tz * back;
          const vt = vel.x * tx + vel.z * tz;
          if (vt > 0) { vel.x -= tx * vt * 1.25; vel.z -= tz * vt * 1.25; this.onWallHit(pos, vt, 0); w.x += (Math.random() - 0.5) * 2; }
        }
        // tunnel portals: the rock face (or the gallery's lintel) over the mouth is a wall. A car that jumps at the portal
        // above the opening bounces off it instead of being pulled down into the tunnel
        for (const t of tr.tunnels) {
          for (const [ps, out] of [[t.s0, -1], [t.s1, 1]]) {
            const u = -out * tr.sd(this.near.s, ps); // metres past the portal plane, into the tunnel
            if (u < -2.3 || u > 2.3) continue;
            const mouth = tr.heightAt(ps) + t.h;
            if (pos.y + 1.25 < mouth || (t.side && pos.y > mouth + 2.2)) continue; // through the opening / over a gallery's low lintel
            const tx = this.near.tx, tz = this.near.tz, push = out * (u + 2.3);
            pos.x += tx * push; pos.z += tz * push;
            const vt = vel.x * tx + vel.z * tz, vin = -out * vt;
            if (vin > 0) { vel.x -= tx * vt * 1.3; vel.z -= tz * vt * 1.3; this.onWallHit(pos, vin, 0); w.x += (Math.random() - 0.5) * 2; w.z += (Math.random() - 0.5) * 2; }
          }
        }
        // dropped off a deck somehow: put the car back on its road (a gap lets you watch the fall a little first)
        if (pos.y < tr.heightAt(this.near.s) - (tr.gaps.length && tr.gapAt(this.near.s) ? 10 : 4)) this.onFlipped();
      }

      // --- street trees: solid until hit, then they snap and the car loses a good chunk of its speed ---
      const city = !this.game.chalRun && this.game.city;
      const th = city && city.hitTrees(this);
      if (th) {
        const keep = G.clamp(0.72 - th.speed * 0.003, 0.5, 0.72);
        vel.x *= keep; vel.z *= keep;
        w.y -= Math.sign(th.side || 1) * Math.sign(th.along || 1) * G.clamp(th.speed * 0.02, 0.2, 1.1);
        this.onTreeHit(th.tree, th.speed);
      }

      // --- obstacle-course set pieces ---
      if (this.game.course) this.game.course.collide(this);
      if (this.game.chalRun) this.game.chalRun.world.collide(this);

      // safety: never fall through the world
      if (pos.y < tr.floorY - 2) { pos.y = tr.floorY + 0.5; vel.y = 0; }

      // flipped & stuck -> auto reset
      if (up.y < 0.15 && spd < 5) { this.flipT += dt; if (this.flipT > 1.6) this.onFlipped(); } else this.flipT = 0;

      this.speed = Math.hypot(vel.x, vel.z);
      const hv = this.speed > 1 ? (vel.x * right.x + vel.z * right.z) / this.speed : 0;
      this.sideSlip = grounded ? Math.asin(G.clamp(hv, -1, 1)) : 0;
      for (const wh of this.wheels) wh.spin += wh.spinV * dt;
    }

    // events — the player's go to the game (sound, score, shake); AI bodies override these
    onScrape(p, v) { this.game.onScrape(p, v); }
    onWallHit(p, vn, vt) { this.game.onWallHit(p, vn, vt); }
    onFlipped() { this.game.resetPlayer(); }
    onTrafficHit(c, vrel, x, y, z) { this.game.onTrafficHit(c, vrel, x, y, z); }
    onCarHit(other, vrel, x, y, z) { this.game.onCarHit(this, other, vrel, x, y, z); }
    onTreeHit(tree, v) { this.game.onTreeHit(this, tree, v); }

    syncModel() {
      const m = this.model;
      m.group.position.copy(this.pos);
      m.group.quaternion.copy(this.q);
      for (let i = 0; i < 4; i++) {
        const wh = this.wheels[i], mw = m.wheels[i];
        mw.pivot.position.y = ANCHOR_Y - Math.min(wh.len, REST);
        mw.pivot.rotation.y = wh.front ? -this.steerAngle : 0;
        mw.spin.rotation.x = -wh.spin;
      }
    }
  }
  G.Player = Player;

  // roadster vs roadster (player or AI, same rules both ways): 2D OBB overlap, equal masses,
  // impulse at the contact point so an off-centre shunt spins both cars the same way a real one would
  const CAR_L = 4.6, CAR_W = 2.05;
  const _f = (b, out) => { out.set(0, 0, -1).applyQuaternion(b.q); out.y = 0; if (out.lengthSq() < 0.01) out.set(0, 0, -1); return out.normalize(); };
  const _fa = new T.Vector3(), _fb = new T.Vector3();
  G.collideCars = function (A, B) {
    if (Math.abs(A.pos.y - B.pos.y) > 1.1) return;
    const dx = B.pos.x - A.pos.x, dz = B.pos.z - A.pos.z;
    if (dx * dx + dz * dz > 25) return;
    const fa = _f(A, _fa), fb = _f(B, _fb);
    const axes = [[fa.x, fa.z], [-fa.z, fa.x], [fb.x, fb.z], [-fb.z, fb.x]];
    let minO = 1e9, nx = 0, nz = 0;
    for (const [ax, az] of axes) {
      const ra = Math.abs(fa.x * ax + fa.z * az) * CAR_L / 2 + Math.abs(-fa.z * ax + fa.x * az) * CAR_W / 2;
      const rb = Math.abs(fb.x * ax + fb.z * az) * CAR_L / 2 + Math.abs(-fb.z * ax + fb.x * az) * CAR_W / 2;
      const d = dx * ax + dz * az, o = ra + rb - Math.abs(d);
      if (o <= 0) return;
      if (o < minO) { minO = o; const sg = d > 0 ? 1 : -1; nx = ax * sg; nz = az * sg; } // n points A -> B
    }
    // split the overlap evenly (equal masses)
    A.pos.x -= nx * minO * 0.5; A.pos.z -= nz * minO * 0.5;
    B.pos.x += nx * minO * 0.5; B.pos.z += nz * minO * 0.5;
    // contact point: midway between the two surfaces along n
    const cx = (A.pos.x + B.pos.x) / 2, cz = (A.pos.z + B.pos.z) / 2;
    const rax = cx - A.pos.x, raz = cz - A.pos.z, rbx = cx - B.pos.x, rbz = cz - B.pos.z;
    // point velocities including yaw (w.y): v + w x r  ->  (vx + wy*rz, vz - wy*rx)
    const vax = A.vel.x + A.w.y * raz, vaz = A.vel.z - A.w.y * rax;
    const vbx = B.vel.x + B.w.y * rbz, vbz = B.vel.z - B.w.y * rbx;
    const vrel = (vbx - vax) * nx + (vbz - vaz) * nz;
    if (vrel >= 0) return;
    const ca = rax * nz - raz * nx, cb = rbx * nz - rbz * nx; // lever arms about y
    const Iy = A.I.y;
    const j = -TU.carBounce * vrel / (2 / MASS + (ca * ca + cb * cb) / Iy);
    A.vel.x -= nx * j / MASS; A.vel.z -= nz * j / MASS;
    B.vel.x += nx * j / MASS; B.vel.z += nz * j / MASS;
    A.w.y += ca * j / Iy; B.w.y -= cb * j / Iy; // (r x J).y with J = -n j on A, +n j on B
    // a little sideways scrub between the panels
    const tx = -nz, tz = nx, vt = (vbx - vax) * tx + (vbz - vaz) * tz;
    const jt = G.clamp(-vt * MASS * 0.04, -0.3 * j, 0.3 * j);
    A.vel.x -= tx * jt / MASS; A.vel.z -= tz * jt / MASS;
    B.vel.x += tx * jt / MASS; B.vel.z += tz * jt / MASS;
    const y = (A.pos.y + B.pos.y) / 2 + 0.6;
    A.onCarHit(B, -vrel, cx, y, cz); B.onCarHit(A, -vrel, cx, y, cz);
  };
})();
