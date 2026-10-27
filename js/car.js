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
    [0.90, 0.92, 0.20, 0.35, 1.02, 0.89, 0.93, 0.960, 0.86, 0.935, 0.63, 1.150, 1.195],
    [1.35, 0.94, 0.20, 0.36, 1.03, 0.90, 0.94, 1.000, 0.74, 0.955, 0.48, 1.040, 1.065],
    [1.75, 0.95, 0.20, 0.37, 1.03, 0.91, 0.95, 1.080, 0.64, 0.900, 0.34, 0.910, 0.920],
    [2.05, 0.95, 0.21, 0.38, 1.02, 0.91, 0.95, 1.120, 0.62, 0.880, 0.30, 0.885, 0.885],
    [2.30, 0.94, 0.25, 0.40, 1.00, 0.89, 0.93, 1.100, 0.62, 0.860, 0.30, 0.860, 0.860],
    [2.36, 0.90, 0.29, 0.42, 0.96, 0.87, 0.89, 1.040, 0.60, 0.840, 0.30, 0.840, 0.840],
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
{ vec3 fp = vFlakeP * 260.0; float fade = 1.0 - smoothstep(0.35, 1.0, length(fwidth(fp)));
  normal = normalize(normal + (flakeHash(floor(fp)) - 0.5) * 0.35 * fade); }`);
    };
    mat.customProgramCacheKey = () => 'flakes';
    return mat;
  };

  let plateTex = null;
  G.buildRoadster = function (paintHex, { shadows = true } = {}) {
    const group = new T.Group();
    const paint = addFlakes(new T.MeshPhysicalMaterial({ color: paintHex, metalness: 0.7, roughness: 0.36, clearcoat: 1, clearcoatRoughness: 0.03 }));
    const glass = new T.MeshPhysicalMaterial({ color: 0x22120a, metalness: 0.05, roughness: 0.1, clearcoat: 0.5, clearcoatRoughness: 0.05, envMapIntensity: 0.5 });
    const trim = new T.MeshPhysicalMaterial({ color: 0x0b0c0e, metalness: 0.3, roughness: 0.45, clearcoat: 0.6, clearcoatRoughness: 0.2 });
    const satin = new T.MeshStandardMaterial({ color: 0x141518, metalness: 0.5, roughness: 0.6 });
    const body = new T.Mesh(bodyGeometry(), [paint, glass, trim]);
    body.castShadow = shadows; body.receiveShadow = false;
    group.add(body);

    const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
      const m = new T.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); group.add(m); return m;
    };
    // nose: full-width light bar on the leading edge, dark intake band and splitter below
    const front = new T.MeshBasicMaterial({ color: new T.Color(1.6, 1.6, 1.75), toneMapped: false });
    add(new T.BoxGeometry(1.72, 0.02, 0.03), front, 0, 0.505, -2.372);
    add(new T.BoxGeometry(1.62, 0.1, 0.03), new T.MeshStandardMaterial({ color: 0x050506, metalness: 0.6, roughness: 0.25 }), 0, 0.44, -2.37);
    add(new T.BoxGeometry(1.2, 0.05, 0.03), satin, 0, 0.335, -2.37);
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
    // tail: full-width red bar under the deck lip, body-colour panel, dark diffuser with four nozzles
    const tail = new T.MeshBasicMaterial({ color: new T.Color(1.5, 0.04, 0.05), toneMapped: false });
    add(new T.BoxGeometry(1.86, 0.035, 0.03), tail, 0, 0.83, 2.372);
    add(new T.BoxGeometry(1.7, 0.2, 0.02), paint, 0, 0.7, 2.37);
    add(new T.BoxGeometry(1.7, 0.3, 0.42), trim, 0, 0.42, 2.17);
    for (let i = -2; i <= 2; i++) add(new T.BoxGeometry(0.025, 0.16, 0.4), satin, i * 0.34, 0.38, 2.2);
    // rear nozzles (4)
    const ring = new T.MeshStandardMaterial({ color: 0x8a8d92, metalness: 1, roughness: 0.22 });
    const rearGlow = new T.MeshBasicMaterial({ color: new T.Color(0.05, 0.08, 0.12), toneMapped: false });
    const nozGeo = new T.CylinderGeometry(0.075, 0.085, 0.2, 18, 1, true);
    const lipGeo = new T.TorusGeometry(0.08, 0.012, 6, 18);
    const discGeo = new T.CircleGeometry(0.075, 16);
    const rearX = [-0.5, -0.17, 0.17, 0.5];
    const jetsRear = [];
    const jetMatRear = G.jetMaterial(new T.Color(0.6, 0.85, 1.5));
    for (const x of rearX) {
      add(nozGeo, ring, x, 0.5, 2.3, Math.PI / 2, 0, 0);
      add(lipGeo, ring, x, 0.5, 2.4);
      add(discGeo, rearGlow, x, 0.5, 2.25, 0, 0, 0);
      const j = new T.Mesh(G.jetGeometry(), jetMatRear);
      j.position.set(x, 0.5, 2.4); j.rotation.x = -Math.PI / 2; // plume -Y -> +Z (backwards)
      j.scale.set(1, 0.001, 1); j.visible = false; j.frustumCulled = false;
      group.add(j); jetsRear.push(j);
    }
    // plate
    if (!plateTex) plateTex = G.canvasTexture(128, 40, (ctx, W, H) => {
      ctx.fillStyle = '#d8d8d4'; ctx.fillRect(0, 0, W, H);
      ctx.fillStyle = '#222'; ctx.font = 'bold 26px Arial'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('RDSTR', W / 2, H / 2 + 1);
    });
    add(new T.PlaneGeometry(0.42, 0.13), new T.MeshStandardMaterial({ map: plateTex, roughness: 0.5 }), 0, 0.68, 2.382);
    // wing: thin airfoil wider than the body, swan-neck posts, endplates with red light strips
    const foil = new T.Shape();
    foil.moveTo(0, 0); foil.quadraticCurveTo(0.12, 0.05, 0.46, 0.012); foil.lineTo(0.46, -0.005); foil.quadraticCurveTo(0.2, 0.0, 0, -0.015);
    const wingGeo = new T.ExtrudeGeometry(foil, { depth: 2.12, bevelEnabled: false, curveSegments: 8 });
    wingGeo.translate(-0.23, 0, -1.06); wingGeo.rotateY(-Math.PI / 2);
    add(wingGeo, trim, 0, 1.26, 2.08, 0.1, 0, 0);
    const postGeo = new T.BoxGeometry(0.04, 0.34, 0.16);
    for (const sx of [-1, 1]) {
      add(postGeo, trim, sx * 0.5, 1.1, 2.14, -0.25, 0, 0);
      const ep = new T.Shape(); ep.moveTo(0, 0); ep.lineTo(0.5, 0.04); ep.lineTo(0.5, -0.12); ep.lineTo(0.1, -0.2); ep.lineTo(0, -0.08);
      const epGeo = new T.ExtrudeGeometry(ep, { depth: 0.02, bevelEnabled: false }); epGeo.rotateY(-Math.PI / 2);
      add(epGeo, trim, sx * 1.07 + (sx < 0 ? 0.02 : 0), 1.3, 1.84);
      add(new T.BoxGeometry(0.025, 0.025, 0.42), tail, sx * 1.075, 1.26, 2.08, 0.15, 0, 0);
    }
    // under thrusters (4): FL, FR, RL, RR
    const underGlow = new T.MeshBasicMaterial({ color: new T.Color(0.05, 0.08, 0.12), toneMapped: false, side: T.DoubleSide });
    const jetMatUnder = G.jetMaterial(new T.Color(0.5, 0.85, 1.7));
    const underPos = [[-0.42, -0.95], [0.42, -0.95], [-0.42, 0.95], [0.42, 0.95]];
    const jetsUnder = [];
    for (const [x, z] of underPos) {
      add(new T.CylinderGeometry(0.12, 0.13, 0.1, 14, 1, true), ring, x, 0.19, z);
      add(discGeo, underGlow, x, 0.17, z, Math.PI / 2, 0, 0);
      const j = new T.Mesh(G.jetGeometry(), jetMatUnder);
      j.position.set(x, 0.15, z); j.scale.set(1.2, 0.001, 1.2); j.visible = false; j.frustumCulled = false;
      group.add(j); jetsUnder.push(j);
    }
    // flank thrusters (2 per side, in the doors): jetsSide[0..1] on the left flank fire left (E: push right),
    // jetsSide[2..3] on the right flank fire right (Q: push left)
    const sideGlow = new T.MeshBasicMaterial({ color: new T.Color(0.05, 0.08, 0.12), toneMapped: false, side: T.DoubleSide });
    const jetsSide = [];
    for (const sx of [-1, 1]) for (const z of [-0.5, 0.45]) {
      add(new T.CylinderGeometry(0.09, 0.1, 0.08, 14, 1, true), ring, sx * 1.0, 0.5, z, 0, 0, Math.PI / 2);
      add(new T.CircleGeometry(0.09, 14), sideGlow, sx * 0.97, 0.5, z, 0, sx * Math.PI / 2, 0);
      const j = new T.Mesh(G.jetGeometry(), jetMatUnder);
      j.position.set(sx * 1.03, 0.5, z); j.rotation.z = sx * Math.PI / 2; // plume -Y -> outwards
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
      const pivot = new T.Group(); pivot.position.set(x, WHEEL_Y, z);
      const spin = new T.Group(); pivot.add(spin);
      const tyre = new T.Mesh(tyreGeo, tyreMat); tyre.castShadow = shadows; spin.add(tyre);
      spin.add(new T.Mesh(barrelGeo, satin));
      const lip = new T.Mesh(rimLipGeo, bladeMat); lip.position.x = side * 0.14; spin.add(lip);
      const face = new T.Mesh(faceGeo, faceMat); face.position.x = side * 0.1; face.rotation.y = side > 0 ? 0 : Math.PI; spin.add(face);
      for (let s = 0; s < 5; s++) {
        const b = new T.Mesh(blade, bladeMat);
        b.position.x = side * 0.1 + (side > 0 ? 0 : -0.035);
        b.rotation.x = (s / 5) * Math.PI * 2 * side; b.scale.z = side; spin.add(b);
      }
      const hub = new T.Mesh(hubGeo, bladeMat); hub.position.x = side * 0.13; spin.add(hub);
      const disc = new T.Mesh(discGeo2, discMat); disc.position.x = side * 0.02; spin.add(disc);
      const cal = new T.Mesh(caliperGeo, caliperMat); cal.position.set(side * 0.055, 0.15, fr ? 0.08 : -0.08); pivot.add(cal);
      group.add(pivot);
      wheels.push({ pivot, spin, front: fr, x, z });
    }
    return { group, wheels, jetsUnder, jetsRear, jetsSide, rearGlow, underGlow, sideGlow, tail, paint, glass, jetMatRear, jetMatUnder };
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
      const r = model.jetsRear[i];
      r.visible = bi > 0.02;
      r.scale.set(0.9 + bi * 0.4, bi * 4.5 * fl, 0.9 + bi * 0.4);
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
  const GRAV = 12;
  const REST = 0.55, ANCHOR_Y = 0.8, WR = 0.36, KS = 40000, CS = 5600, CS_REB = 9500, MAXC = 0.36;
  const MASS = 1400;
  const POWER = 520000, FMAX = 19000, BRAKE = 26000, KDRAG = 0.55, DOWNF = 0.9;
  const MU = 1.35, CLAT_F = 9500, CLAT_R = 10000;
  const F_UNDER = 1.35 * MASS * GRAV, F_BACK = 1.7 * MASS * GRAV, F_SIDE = 1.3 * MASS * GRAV;
  const BODY_PTS = [
    [0.95, 0.22, 2.1], [-0.95, 0.22, 2.1], [0.95, 0.22, -2.1], [-0.95, 0.22, -2.1],
    [0.55, 1.18, 0.4], [-0.55, 1.18, 0.4], [0.55, 1.05, -0.5], [-0.55, 1.05, -0.5],
    [1.05, 0.6, 0], [-1.05, 0.6, 0], [0, 0.45, -2.35], [0, 0.6, 2.35], [0, 1.2, 2.0],
  ];

  const altEffSide = (alt) => (alt < 22 ? 1 : Math.max(0.25, 1 - (alt - 22) / 26));
  const _v = [...Array(12)].map(() => new T.Vector3());
  const _q = new T.Quaternion(), _qi = new T.Quaternion();
  const gq = {};

  class Player {
    constructor(game, model) {
      this.game = game; this.model = model;
      this.pos = new T.Vector3(); this.vel = new T.Vector3();
      this.q = new T.Quaternion(); this.w = new T.Vector3();
      this.I = new T.Vector3(3400, 3900, 1400);
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
      this.pos.set(p.x + p.rx * lat, 0.02, p.z + p.rz * lat);
      this.q.setFromAxisAngle(_v[0].set(0, 1, 0), Math.atan2(-p.tx, -p.tz));
      this.vel.set(p.tx * speed, 0, p.tz * speed);
      this.w.set(0, 0, 0);
      this.ride = null;
      for (const w of this.wheels) { w.comp = 0.1; w.len = REST - 0.1; w.spinV = 0; }
      this.near.i = -1;
      tr.nearest(this.pos.x, this.pos.z, -1, this.near);
      this.flipT = 0; this.airTime = 0;
    }

    ground(x, z, yRef) {
      this.game.track.groundAt(x, z, gq);
      if (this.game.traffic) this.game.traffic.roofAt(x, z, yRef, gq, this.tnear);
      if (this.game.course) this.game.course.groundAt(x, z, yRef, gq);
      return gq;
    }

    step(dt, inp) {
      if (this.ride && this.game.course) { this.game.course.rideStep(this, dt, inp); return; } // on a loop: follows the track
      const pos = this.pos, vel = this.vel, q = this.q, w = this.w;
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
      const steerMax = G.lerp(0.72, 0.24, G.clamp(Math.abs(vF) / 110, 0, 1));
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
        if (comp > MAXC) Fs += KS * 10 * (comp - MAXC) + CS * 3 * compV;
        Fs = G.clamp(Fs, 0, MASS * GRAV * 6);
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
        let grip = MU * load;
        let fLat = -vs * (wh.front ? CLAT_F : CLAT_R);
        if (!wh.front && hand) { grip *= 0.42; fLat *= 0.35; }
        let fLong = driveTotal / 4;
        const bF = brake * BRAKE / 4 + (!wh.front && hand ? 9000 : 0);
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
      let bodyContact = false;
      for (const bp of BODY_PTS) {
        const P = _v[8].set(bp[0], bp[1], bp[2]).applyQuaternion(q).add(pos);
        const g = this.ground(P.x, P.z, P.y + 0.4);
        const depth = g.h - P.y;
        if (depth <= 0) continue;
        bodyContact = true;
        const n = _v[9].set(g.nx, g.ny, g.nz);
        r.subVectors(P, pos);
        const vP = _v[10].crossVectors(w, r).add(vel);
        vP.x -= g.vx; vP.z -= g.vz;
        const vn = vP.dot(n);
        const Fn = Math.max(0, 160000 * depth - 9000 * vn);
        const vt = vP.addScaledVector(n, -vn);
        const vtl = vt.length();
        const f = _v[11].copy(n).multiplyScalar(Fn);
        if (vtl > 0.01) f.addScaledVector(vt, -Math.min(0.55 * Fn, vtl * 4000) / vtl);
        addForce(f, P);
        if (vtl > 6 && Fn > 2000) this.onScrape(P, vtl);
      }

      const grounded = contacts > 0;
      this.grounded = grounded;

      // --- aero ---
      F.addScaledVector(vel, -KDRAG * spd);
      if (grounded) F.addScaledVector(up, -DOWNF * spd * spd * 0.5);

      // --- thrusters ---
      const g0 = this.ground(pos.x, pos.z, pos.y + 0.5);
      this.altitude = pos.y - g0.h;
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
      const altEff = this.altitude < 22 ? 1 : Math.max(0.25, 1 - (this.altitude - 22) / 26);
      if (this.th.L > 0.01) addForce(_v[5].copy(up).multiplyScalar(F_UNDER * this.th.L * altEff), _v[8].set(-0.62, 0.3, 0).applyQuaternion(q).add(pos));
      if (this.th.R > 0.01) addForce(_v[5].copy(up).multiplyScalar(F_UNDER * this.th.R * altEff), _v[8].set(0.62, 0.3, 0).applyQuaternion(q).add(pos));
      // under-thrusters hold the nose level: they roll the car side to side but never pitch it down
      const underOn = Math.min(1, this.th.L + this.th.R);
      if (underOn > 0.05) Tq.addScaledVector(right, (-fwd.y * 26000 - w.dot(right) * 7000) * underOn);
      if (this.th.B > 0.01) {
        const eff = G.clamp(1 - Math.max(0, vF) / 185, 0.15, 1);
        F.addScaledVector(fwd, F_BACK * this.th.B * eff);
      }
      this.fuel -= (wantL + wantR) * 13 * dt + wantB * 17 * dt + (wantSL + wantSR) * 11 * dt;
      // recharge on the ground, after a short pause since the thrusters were last fired
      this.fuelUse = wantL + wantR + wantB + wantSL + wantSR > 0;
      this.fuelIdle = this.fuelUse ? 0 : this.fuelIdle + dt;
      this.fuelCharging = grounded && this.fuelIdle > 0.5 && this.fuel < 100;
      if (this.fuelCharging) this.fuel += 8 * dt;
      this.fuel = G.clamp(this.fuel, 0, 100);

      // --- assists / air control ---
      const singleSide = Math.abs(this.th.L - this.th.R) > 0.3;
      const worldUp = _v[5].set(0, 1, 0);
      const levelAxis = _v[8].crossVectors(up, worldUp);
      if (!grounded) {
        _q.copy(q);
        const pitchT = _v[9].copy(right).multiplyScalar(inp.pitch * 7000);
        const yawT = _v[10].copy(up).multiplyScalar(-inp.steer * 6500);
        Tq.add(pitchT).add(yawT);
        if (inp.rollAir) Tq.addScaledVector(fwd, inp.rollAir * 6000);
        if (!singleSide && !inp.rollAir && Math.abs(inp.pitch) < 0.1) Tq.addScaledVector(levelAxis, 5200);
        w.multiplyScalar(Math.exp(-0.9 * dt));
      } else {
        if (!singleSide) Tq.addScaledVector(levelAxis, up.y > 0.3 ? 3500 : 0);
        // steering assist: nudge the yaw rate toward what the arrows ask for so the car answers the input quickly
        const yawTarget = -inp.steer * G.clamp(spd / 12, 0, 1) * 1.35 * Math.sign(vF || 1);
        const yawErr = yawTarget - w.dot(up);
        if (Math.abs(inp.steer) > 0.05 && Math.sign(yawErr) === Math.sign(yawTarget)) Tq.addScaledVector(up, yawErr * this.I.y * 4 * Math.abs(inp.steer));
        // stability: catch over-rotation and settle leftover spin once the arrows are released (~0.06 s, so the car stops turning when you let go)
        else if (!hand && contacts >= 3) Tq.addScaledVector(up, yawErr * this.I.y * (Math.abs(inp.steer) > 0.05 ? 4 : 16));
        // grip assist: bend sideways velocity into forward motion so the car goes where it points instead of sliding
        if (!hand && contacts >= 3 && spd > 2) {
          // energy-safe: forward speed only gains part of what the slide loses, so total speed can never rise
          const vs = vel.dot(right), vsNew = vs * Math.exp(-6 * dt);
          const vfNew = Math.sign(vF || 1) * Math.sqrt(vF * vF + (vs * vs - vsNew * vsNew) * 0.7);
          F.addScaledVector(right, (vsNew - vs) * MASS / dt);
          F.addScaledVector(fwd, (vfNew - vF) * MASS / dt);
        }
        w.multiplyScalar(Math.exp(-0.25 * dt));
      }

      // --- integrate ---
      _qi.copy(q).invert();
      const tl = _v[9].copy(Tq).applyQuaternion(_qi);
      tl.x /= this.I.x; tl.y /= this.I.y; tl.z /= this.I.z;
      tl.applyQuaternion(q);
      w.addScaledVector(tl, dt);
      if (w.lengthSq() > 144) w.setLength(12);
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
      tr.nearest(pos.x, pos.z, this.near.i, this.near);
      const lim = G.WALL - 1.1;
      const lat = this.near.lat;
      if (Math.abs(lat) > lim) {
        const sg = Math.sign(lat);
        const nx = this.near.rx * sg, nz = this.near.rz * sg;
        const pen = Math.abs(lat) - lim;
        pos.x -= nx * pen; pos.z -= nz * pen;
        const vn = vel.x * nx + vel.z * nz;
        if (vn > 0) {
          vel.x -= nx * vn * 1.35; vel.z -= nz * vn * 1.35;
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

      // --- street trees: solid until hit, then they snap and the car loses a good chunk of its speed ---
      const city = this.game.city;
      const th = city && city.hitTrees(this);
      if (th) {
        const keep = G.clamp(0.72 - th.speed * 0.003, 0.5, 0.72);
        vel.x *= keep; vel.z *= keep;
        w.y -= Math.sign(th.side || 1) * Math.sign(th.along || 1) * G.clamp(th.speed * 0.02, 0.2, 1.1);
        this.onTreeHit(th.tree, th.speed);
      }

      // --- obstacle-course set pieces ---
      if (this.game.course) this.game.course.collide(this);

      // safety: never fall through the world
      if (pos.y < -2) { pos.y = 0.5; vel.y = 0; }

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
    const j = -1.25 * vrel / (2 / MASS + (ca * ca + cb * cb) / Iy);
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
  G.GRAV = GRAV;
})();
