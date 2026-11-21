// traffic.js — instanced city traffic in both directions, lane following, knock-around wrecks,
// roofs you can land on, near-miss / jump-over detection
(function () {
  const T = THREE;
  const { mergeGeometries, toCreasedNormals, RoundedBoxGeometry } = ADDONS;


  const BODY_COLS = [0xc8ccd2, 0x1c1e22, 0x7d1f22, 0x24456e, 0xe9e9e6, 0x5a5f66, 0x2f5a3c, 0xb88a2a, 0x8b8f96, 0x3d2a4f, 0xd9542a];

  // Every vertex carries a colour and a finish (the 'paint' attribute): 1 = body paint, which takes the instance colour;
  // 0 = glossy and fixed (glass, chrome, a white trailer); 2 = matte and fixed (rubber, plastic trim).
  const BODY = [1, 1, 1], GLASS = [0.035, 0.045, 0.06], BLACK = [0.03, 0.03, 0.035], TYRE = [0.045, 0.045, 0.05],
    TRIM = [0.075, 0.075, 0.085], CHROME = [0.66, 0.67, 0.7], ALLOY = [0.48, 0.49, 0.52], PLATE = [0.8, 0.8, 0.74],
    WHITE = [0.9, 0.9, 0.89], STEEL = [0.3, 0.31, 0.33], DOOR = [0.7, 0.71, 0.73];
  const HEAD = [2.0, 1.95, 1.75], DRL = [1.5, 1.6, 1.7], TAILC = [1.7, 0.05, 0.04], AMBER = [1.7, 0.75, 0.08];
  const MATTE = new Set([BLACK, TYRE, TRIM, PLATE, STEEL]);
  const fin = (c) => (c === BODY ? 1 : MATTE.has(c) ? 2 : 0);

  function tag(geo, c) {
    const n = geo.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    geo.setAttribute('color', new T.BufferAttribute(col, 3));
    geo.setAttribute('paint', new T.BufferAttribute(new Float32Array(n).fill(fin(c)), 1));
    return geo;
  }
  function part(list, geo, c, x, y, z, ry = 0, rx = 0) {
    if (geo.index) geo = geo.toNonIndexed();
    if (geo.attributes.uv) geo.deleteAttribute('uv');
    if (rx) geo.rotateX(rx);
    if (ry) geo.rotateY(ry);
    geo.translate(x, y, z);
    list.push(tag(geo, c));
  }
  const box = (w, h, d) => new T.BoxGeometry(w, h, d);
  const rbox = (w, h, d, r = 0.18) => new RoundedBoxGeometry(w, h, d, 2, r);
  const cylZ = (r, len, seg = 12) => new T.CylinderGeometry(r, r, len, seg).rotateX(Math.PI / 2);
  // a side profile [[z, y], ...] extruded w wide across the car, centred on x
  function prism(list, pts, w, c, x = 0) {
    const g = new T.ExtrudeGeometry(new T.Shape(pts.map(([z, y]) => new T.Vector2(z, y))), { depth: w, bevelEnabled: false });
    part(list, g.rotateY(-Math.PI / 2), c, x + w / 2, 0, 0);
  }
  // a thin strip along a path of points, w wide along the unit vector off, visible from both sides
  function ribbon(list, path, off, w, c) {
    const pos = [], h = w / 2;
    for (let i = 0; i < path.length - 1; i++) {
      const a = path[i], b = path[i + 1];
      const A = [a[0] - off[0] * h, a[1] - off[1] * h, a[2] - off[2] * h], B = [a[0] + off[0] * h, a[1] + off[1] * h, a[2] + off[2] * h];
      const C = [b[0] + off[0] * h, b[1] + off[1] * h, b[2] + off[2] * h], D = [b[0] - off[0] * h, b[1] - off[1] * h, b[2] - off[2] * h];
      pos.push(...A, ...B, ...C, ...A, ...C, ...D, ...A, ...C, ...B, ...A, ...D, ...C);
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.computeVertexNormals();
    list.push(tag(g, c));
  }

  // Smooth lofted car body. Sections: [z, wLow, yBottom, yBelt, wBelt, yRoof, wRoof] (half widths), front (-Z) first.
  // Side windows sit between belt and roof inside glassZ; steep roof panels become windscreens.
  const CR = (a, b, c, d, t) => 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
  function loft(list, secs, glassZ, SUB = 3) {
    const prof = ([z, wl, yb, ybt, wb, yr, wr]) =>
      [z, [[0, yb], [wl - 0.05, yb], [wl, yb + 0.14], [wl + 0.015, (yb + ybt) / 2], [wb, ybt], [wr, yr], [0, yr + 0.025]]];
    const P = secs.map(prof);
    const S = [];
    for (let k = 0; k < P.length - 1; k++) {
      const a = P[Math.max(0, k - 1)], b = P[k], c = P[k + 1], d = P[Math.min(P.length - 1, k + 2)];
      for (let i = 0; i < SUB; i++) {
        const t = i / SUB;
        S.push([CR(a[0], b[0], c[0], d[0], t), b[1].map((_, j) => [
          CR(a[1][j][0], b[1][j][0], c[1][j][0], d[1][j][0], t),
          CR(a[1][j][1], b[1][j][1], c[1][j][1], d[1][j][1], t)])]);
      }
    }
    S.push(P[P.length - 1]);
    const pos = [], col = [], pf = [];
    const tri = (A, B, C, c) => { pos.push(...A, ...B, ...C); col.push(...c, ...c, ...c); const f = fin(c); pf.push(f, f, f); };
    for (let k = 0; k < S.length - 1; k++) {
      const [z0, p0] = S[k], [z1, p1] = S[k + 1];
      const zm = (z0 + z1) / 2;
      for (let j = 0; j < 6; j++) {
        let c = j === 0 ? BLACK : BODY;
        if (j === 4 && zm > glassZ[0] && zm < glassZ[1] && p0[5][1] - p0[4][1] > 0.25 && p1[5][1] - p1[4][1] > 0.25) c = GLASS;
        if (j === 5 && Math.abs((p1[5][1] - p0[5][1]) / (z1 - z0)) > 0.42) c = GLASS;
        for (const sx of [1, -1]) {
          const A = [p0[j][0] * sx, p0[j][1], z0], B = [p0[j + 1][0] * sx, p0[j + 1][1], z0];
          const C = [p1[j + 1][0] * sx, p1[j + 1][1], z1], D = [p1[j][0] * sx, p1[j][1], z1];
          if (sx > 0) { tri(A, B, C, c); tri(A, C, D, c); } else { tri(A, C, B, c); tri(A, D, C, c); }
        }
      }
    }
    // end caps (fan from the profile centre), all body colour
    for (const [k, front] of [[0, true], [S.length - 1, false]]) {
      const [z, p] = S[k];
      const ctr = [0, (p[0][1] + p[6][1]) / 2, z];
      for (let j = 0; j < 6; j++) for (const sx of [1, -1]) {
        const a = [p[j][0] * sx, p[j][1], z], b = [p[j + 1][0] * sx, p[j + 1][1], z];
        if (front === (sx > 0)) tri(ctr, b, a, BODY); else tri(ctr, a, b, BODY);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new T.Float32BufferAttribute(col, 3));
    g.setAttribute('paint', new T.Float32BufferAttribute(pf, 1));
    list.push(toCreasedNormals(g, 0.7));
  }
  // the loft's sections, linearly, at z; and the body side's x at height y there
  function profAt(secs, z) {
    let k = 0;
    while (k < secs.length - 2 && secs[k + 1][0] < z) k++;
    const a = secs[k], b = secs[k + 1], t = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0])));
    const v = a.map((x, i) => x + (b[i] - x) * t);
    return { wl: v[1], yb: v[2], ybt: v[3], wb: v[4], yr: v[5], wr: v[6] };
  }
  function sideX(p, y) {
    const y0 = p.yb + 0.14, ym = (p.yb + p.ybt) / 2;
    if (y <= y0) return p.wl;
    if (y <= ym) return p.wl + 0.015 * (y - y0) / (ym - y0);
    return p.wl + 0.015 + (p.wb - p.wl - 0.015) * Math.min(1, (y - ym) / (p.ybt - ym));
  }
  // door shut lines, window pillars, the black seal under the side glass, door handles
  function shut(list, secs, z, y0, y1) {
    for (const sx of [1, -1]) {
      const p = profAt(secs, z), path = [];
      for (let i = 0; i <= 4; i++) { const y = y0 + (y1 - y0) * i / 4; path.push([sx * (sideX(p, y) + 0.01), y, z]); }
      ribbon(list, path, [0, 0, 1], 0.014, TRIM);
    }
  }
  function pillar(list, secs, z, w = 0.09) {
    const p = profAt(secs, z);
    for (const sx of [1, -1]) ribbon(list, [[sx * (p.wb + 0.012), p.ybt, z], [sx * (p.wr + 0.012), p.yr - 0.01, z]], [0, 0, 1], w, BLACK);
  }
  function seal(list, secs, z0, z1) {
    for (const sx of [1, -1]) {
      const path = [];
      for (let i = 0; i <= 8; i++) { const z = z0 + (z1 - z0) * i / 8, p = profAt(secs, z); path.push([sx * (p.wb + 0.012), p.ybt + 0.012, z]); }
      ribbon(list, path, [0, 1, 0], 0.035, TRIM);
    }
  }
  function handles(list, secs, zs, c = CHROME) {
    for (const z of zs) for (const sx of [1, -1]) {
      const p = profAt(secs, z), y = p.ybt - 0.11;
      part(list, box(0.025, 0.035, 0.15), c, sx * (sideX(p, y) + 0.012), y, z);
    }
  }
  function mirrors(list, x, y, z, c = BODY) {
    for (const sx of [1, -1]) {
      part(list, box(0.12, 0.04, 0.06), TRIM, sx * (x - 0.03), y - 0.06, z + 0.04);
      part(list, rbox(0.17, 0.12, 0.1, 0.035), c, sx * (x + 0.07), y, z);
      part(list, box(0.14, 0.09, 0.01), GLASS, sx * (x + 0.07), y, z + 0.051);
    }
  }
  // the dark wheel well behind a tyre and its lip, on a body side at x
  function arch(list, x, r, z, lip = BODY) {
    for (const sx of [1, -1]) {
      part(list, new T.CircleGeometry(r + 0.07, 14, 0, Math.PI), BLACK, sx * (x + 0.004), r, z, sx * Math.PI / 2);
      part(list, new T.TorusGeometry(r + 0.09, 0.03, 4, 14, Math.PI), lip, sx * (x + 0.006), r, z, sx * Math.PI / 2);
    }
  }
  // a tyre with rounded shoulders and a recessed rim (spokes = 0: a truck's steel wheel with lug nuts)
  function wheelAt(list, x, r, z, w = 0.24, rim = ALLOY, spokes = 5) {
    const sx = Math.sign(x), fx = x + sx * w / 2;
    const prof = [[0.62, -0.5], [0.88, -0.5], [0.97, -0.42], [1, -0.22], [1, 0.22], [0.97, 0.42], [0.88, 0.5], [0.62, 0.5]];
    part(list, new T.LatheGeometry(prof.map(([a, b]) => new T.Vector2(a * r, b * w)), 16).rotateZ(Math.PI / 2), TYRE, x, r, z);
    part(list, new T.CylinderGeometry(r * 0.62, r * 0.62, 0.02, 14).rotateZ(Math.PI / 2), spokes ? TRIM : rim, fx - sx * 0.07, r, z);
    part(list, new T.TorusGeometry(r * 0.6, 0.024, 4, 16).rotateY(Math.PI / 2), rim, fx - sx * 0.012, r, z);
    for (let k = 0; k < spokes; k++) {
      const sp = new T.BoxGeometry(0.03, r * 0.48, 0.065).translate(0, r * 0.32, 0).rotateX(k / spokes * Math.PI * 2);
      part(list, sp, rim, fx - sx * 0.03, r, z);
    }
    if (!spokes) for (let k = 0; k < 8; k++) {
      const a = k / 8 * Math.PI * 2;
      part(list, new T.CylinderGeometry(0.022, 0.022, 0.04, 6).rotateZ(Math.PI / 2), CHROME, fx - sx * 0.06, r + Math.sin(a) * r * 0.3, z + Math.cos(a) * r * 0.3);
    }
    part(list, new T.CylinderGeometry(r * 0.13, r * 0.16, 0.05, 8).rotateZ(Math.PI / 2), spokes ? rim : CHROME, fx - sx * (spokes ? 0.03 : 0.07), r, z);
  }
  // headlamps swept back round the front corners (front is -Z), with a housing and a running-light strip
  function headlamps(l, b, x, y, z, w = 0.38, h = 0.11, sweep = 0.24) {
    for (const sx of [1, -1]) {
      part(b, box(w + 0.04, h + 0.03, 0.05), BLACK, sx * x, y, z + 0.02, -sx * sweep);
      part(l, box(w, h, 0.05), HEAD, sx * x, y + 0.01, z, -sx * sweep);
      part(l, box(w * 0.85, 0.022, 0.05), DRL, sx * x, y - h / 2 - 0.005, z - 0.004, -sx * sweep);
    }
  }
  function taillamps(l, b, x, y, z, w = 0.42, h = 0.13, sweep = 0.24) {
    for (const sx of [1, -1]) {
      part(b, box(w + 0.04, h + 0.04, 0.05), BLACK, sx * x, y, z - 0.02, sx * sweep);
      part(l, box(w, h, 0.05), TAILC, sx * x, y, z, sx * sweep);
    }
  }
  const plate = (list, y, z) => part(list, box(0.52, 0.12, 0.02), PLATE, 0, y, z);
  function grille(list, w, h, y, z, frame = CHROME, bars = 3) {
    part(list, box(w + 0.06, h + 0.06, 0.03), frame, 0, y, z + 0.01);
    part(list, box(w, h, 0.03), BLACK, 0, y, z);
    for (let i = 1; i <= bars; i++) part(list, box(w, 0.018, 0.02), frame, 0, y - h / 2 + h * i / (bars + 1), z - 0.016);
  }

  const TYPES = [
    {
      id: 'sedan', name: 'CAR', len: 4.6, wid: 1.85, hgt: 1.48, mass: 1500, weight: 30, vmin: 21, vmax: 31, bonus: 300,
      build(b, l) {
        const S = [
          [-2.30, 0.80, 0.30, 0.66, 0.76, 0.70, 0.68],
          [-2.05, 0.90, 0.24, 0.78, 0.88, 0.80, 0.78],
          [-1.05, 0.925, 0.24, 0.86, 0.90, 0.92, 0.82],
          [-0.50, 0.925, 0.24, 0.89, 0.89, 1.40, 0.70],
          [0.35, 0.925, 0.24, 0.90, 0.88, 1.46, 0.70],
          [1.05, 0.925, 0.24, 0.92, 0.88, 1.38, 0.68],
          [1.65, 0.915, 0.25, 0.95, 0.88, 1.00, 0.80],
          [2.30, 0.86, 0.32, 0.92, 0.82, 0.95, 0.74],
        ];
        loft(b, S, [-0.7, 1.4]);
        for (const z of [-1.45, 1.45]) { arch(b, 0.94, 0.34, z); for (const sx of [1, -1]) wheelAt(b, sx * 0.84, 0.34, z, 0.24); }
        shut(b, S, -0.98, 0.42, 0.86); shut(b, S, 0.34, 0.38, 0.88); shut(b, S, 1.08, 0.78, 0.9);
        pillar(b, S, 0.34); seal(b, S, -0.55, 1.3); handles(b, S, [-0.12, 0.92]);
        mirrors(b, 0.9, 0.95, -0.5);
        grille(b, 0.66, 0.14, 0.52, -2.315);
        part(b, box(1.15, 0.09, 0.04), BLACK, 0, 0.36, -2.31);
        plate(b, 0.43, -2.33);
        headlamps(l, b, 0.56, 0.6, -2.3, 0.36, 0.09);
        for (const sx of [1, -1]) part(l, box(0.12, 0.04, 0.03), AMBER, sx * 0.62, 0.37, -2.315);
        taillamps(l, b, 0.58, 0.8, 2.31, 0.42, 0.12);
        part(b, box(1.5, 0.1, 0.04), BLACK, 0, 0.4, 2.31);
        plate(b, 0.6, 2.325);
        part(b, cylZ(0.035, 0.14, 8), CHROME, 0.5, 0.33, 2.3);
      },
    },
    {
      id: 'suv', name: 'SUV', len: 4.9, wid: 2.0, hgt: 1.85, mass: 2100, weight: 22, vmin: 20, vmax: 29, bonus: 350,
      build(b, l) {
        const S = [
          [-2.45, 0.92, 0.40, 0.86, 0.90, 0.92, 0.82],
          [-2.15, 0.98, 0.36, 1.00, 0.97, 1.05, 0.90],
          [-1.30, 1.00, 0.36, 1.08, 0.98, 1.14, 0.92],
          [-0.85, 1.00, 0.36, 1.10, 0.97, 1.74, 0.86],
          [0.20, 1.00, 0.36, 1.10, 0.96, 1.82, 0.86],
          [1.70, 1.00, 0.36, 1.10, 0.96, 1.80, 0.86],
          [2.25, 0.98, 0.38, 1.10, 0.94, 1.72, 0.84],
          [2.45, 0.95, 0.42, 1.05, 0.90, 1.55, 0.82],
        ];
        loft(b, S, [-1.0, 2.2]);
        for (const z of [-1.55, 1.55]) { arch(b, 1.015, 0.4, z, TRIM); for (const sx of [1, -1]) wheelAt(b, sx * 0.9, 0.4, z, 0.27, ALLOY, 6); }
        for (const sx of [1, -1]) part(b, box(0.03, 0.14, 2.0), TRIM, sx * 1.012, 0.47, 0);   // lower cladding
        shut(b, S, -1.02, 0.56, 1.07); shut(b, S, 0.42, 0.52, 1.08); shut(b, S, 1.28, 0.9, 1.09);
        pillar(b, S, 0.42); pillar(b, S, 1.62, 0.16); seal(b, S, -0.9, 2.1); handles(b, S, [0.1, 1.15]);
        mirrors(b, 0.97, 1.2, -0.85);
        for (const sx of [1, -1]) {   // roof rails
          part(b, box(0.05, 0.045, 2.6), TRIM, sx * 0.72, 1.9, 0.4);
          for (const z of [-0.8, 0.4, 1.6]) part(b, box(0.06, 0.07, 0.12), TRIM, sx * 0.72, 1.86, z);
        }
        grille(b, 0.92, 0.26, 0.68, -2.465, CHROME, 3);
        part(b, box(1.75, 0.18, 0.06), TRIM, 0, 0.5, -2.46);
        part(b, box(0.8, 0.05, 0.05), ALLOY, 0, 0.44, -2.49);
        plate(b, 0.5, -2.5);
        headlamps(l, b, 0.68, 0.84, -2.44, 0.38, 0.1);
        taillamps(l, b, 0.74, 1.12, 2.45, 0.3, 0.16, 0.3);
        part(b, box(1.8, 0.2, 0.06), TRIM, 0, 0.52, 2.46);
        plate(b, 0.86, 2.465);
      },
    },
    {
      id: 'van', name: 'VAN', len: 5.4, wid: 2.05, hgt: 2.45, mass: 2800, weight: 12, vmin: 19, vmax: 27, bonus: 450,
      build(b, l) {
        const S = [
          [-2.70, 0.95, 0.40, 0.98, 0.95, 1.04, 0.90],
          [-2.35, 1.00, 0.36, 1.14, 1.00, 1.26, 0.95],
          [-1.65, 1.02, 0.36, 1.20, 1.00, 2.36, 0.97],
          [0.00, 1.025, 0.36, 1.22, 1.01, 2.40, 0.98],
          [2.60, 1.025, 0.36, 1.25, 1.01, 2.40, 0.98],
          [2.70, 1.00, 0.40, 1.25, 0.99, 2.38, 0.96],
        ];
        loft(b, S, [-2.4, -1.1]);
        for (const z of [-1.8, 1.8]) { arch(b, 1.04, 0.38, z, TRIM); for (const sx of [1, -1]) wheelAt(b, sx * 0.93, 0.38, z, 0.25, ALLOY, 5); }
        pillar(b, S, -1.12, 0.07); seal(b, S, -1.6, -1.12);
        shut(b, S, -1.35, 0.84, 1.2); shut(b, S, -0.9, 0.55, 2.2); handles(b, S, [-1.0]);
        // the sliding door on the kerb side (+X): its outline and rail
        const p = profAt(S, 0.4);
        ribbon(b, [[sideX(p, 0.6) + 0.01, 0.6, 0.6], [sideX(p, 1.4) + 0.01, 1.4, 0.6], [sideX(p, 2.2) + 0.01, 2.2, 0.6]], [0, 0, 1], 0.014, TRIM);
        part(b, box(0.03, 0.03, 1.5), TRIM, 1.04, 2.2, -0.15);
        part(b, box(0.03, 0.035, 0.15), CHROME, 1.04, 1.2, 0.45);
        mirrors(b, 1.02, 1.45, -1.6, TRIM);
        grille(b, 1.0, 0.22, 0.8, -2.715, TRIM, 2);
        part(b, box(1.98, 0.2, 0.09), TRIM, 0, 0.52, -2.7);
        plate(b, 0.52, -2.75);
        headlamps(l, b, 0.7, 0.9, -2.69, 0.32, 0.13, 0.2);
        // rear doors: two windows, the split, handles
        for (const sx of [1, -1]) part(b, box(0.8, 0.55, 0.02), GLASS, sx * 0.46, 1.85, 2.705);
        part(b, box(0.016, 1.75, 0.02), TRIM, 0, 1.45, 2.71);
        part(b, box(0.15, 0.035, 0.03), CHROME, 0.14, 1.35, 2.715);
        for (const sx of [1, -1]) part(l, box(0.14, 0.5, 0.04), TAILC, sx * 0.88, 1.15, 2.71);
        part(b, box(2.02, 0.18, 0.12), TRIM, 0, 0.5, 2.7);
        plate(b, 0.76, 2.715);
        part(l, box(0.5, 0.04, 0.02), TAILC, 0, 2.33, 2.715);
      },
    },
    {
      id: 'bus', name: 'BUS', len: 12, wid: 2.55, hgt: 3.2, mass: 12000, weight: 6, vmin: 16, vmax: 22, bonus: 800, outer: true,
      build(b, l) {
        part(b, rbox(2.55, 2.75, 12, 0.22), BODY, 0, 1.78, 0);
        // a band of side windows with black pillars, the seal below it, the livery stripe
        part(b, box(2.57, 0.95, 10.2), GLASS, 0, 2.3, 0.6);
        for (let z = -4.5; z <= 5.75; z += 1.275) part(b, box(2.59, 0.97, 0.08), BLACK, 0, 2.3, z);
        part(b, box(2.585, 0.05, 10.25), TRIM, 0, 1.8, 0.6);
        part(b, box(2.58, 0.16, 12.02), [0.75, 0.12, 0.1], 0, 1.15, 0);
        // the front door on the +X side
        part(b, box(0.03, 2.25, 1.2), TRIM, 1.28, 1.6, -5.15);
        part(b, box(0.04, 2.1, 1.08), GLASS, 1.285, 1.6, -5.15);
        part(b, box(0.05, 2.1, 0.03), BLACK, 1.29, 1.6, -5.15);
        // front: big screen, destination sign, bumper, lamps, mirrors on arms
        part(b, box(2.35, 1.4, 0.05), GLASS, 0, 2.0, -6.0);
        part(b, box(2.1, 0.3, 0.05), TRIM, 0, 2.88, -6.0);
        part(l, box(1.6, 0.14, 0.02), AMBER, 0, 2.88, -6.03);
        part(b, box(2.52, 0.3, 0.14), TRIM, 0, 0.56, -6.0);
        plate(b, 0.6, -6.08);
        for (const sx of [1, -1]) {
          part(b, box(0.48, 0.2, 0.04), BLACK, sx * 0.9, 0.95, -6.0);
          part(l, box(0.4, 0.13, 0.03), HEAD, sx * 0.9, 0.96, -6.02);
          part(l, box(0.12, 0.08, 0.03), AMBER, sx * 1.12, 0.78, -6.01);
          part(b, box(0.25, 0.04, 0.4), TRIM, sx * 1.36, 2.75, -6.15);
          part(b, box(0.08, 0.42, 0.2), TRIM, sx * 1.46, 2.45, -6.35);
        }
        // rear: window, engine grille, lamp clusters, bumper
        part(b, box(2.1, 0.7, 0.04), GLASS, 0, 2.55, 6.0);
        part(b, box(1.8, 0.62, 0.04), TRIM, 0, 1.25, 6.01);
        for (let i = 0; i < 5; i++) part(b, box(1.7, 0.03, 0.02), STEEL, 0, 1.0 + i * 0.12, 6.03);
        for (const sx of [1, -1]) part(l, box(0.2, 0.5, 0.04), TAILC, sx * 1.05, 1.15, 6.02);
        part(b, box(2.52, 0.28, 0.14), TRIM, 0, 0.56, 6.0);
        plate(b, 0.75, 6.03);
        part(b, rbox(2.2, 0.3, 4, 0.1), [0.62, 0.62, 0.64], 0, 3.25, 1.2);   // roof air-con pod
        arch(b, 1.276, 0.5, -4.0, TRIM); arch(b, 1.276, 0.5, 3.6, TRIM);
        for (const sx of [1, -1]) {
          wheelAt(b, sx * 1.12, 0.5, -4.0, 0.3, STEEL, 0);
          wheelAt(b, sx * 1.12, 0.5, 3.6, 0.3, STEEL, 0); wheelAt(b, sx * 0.8, 0.5, 3.6, 0.3, STEEL, 0);
        }
      },
    },
    {
      id: 'semi', name: 'SEMI', len: 16, wid: 2.55, hgt: 3.9, mass: 20000, weight: 7, vmin: 17, vmax: 23, bonus: 1000, outer: true,
      build(b, l) {
        // tractor: frame, long hood, cab, sleeper under a roof fairing
        part(b, box(1.0, 0.3, 6.7), TRIM, 0, 0.85, -4.6);
        prism(b, [[-7.75, 0.85], [-7.75, 1.82], [-7.62, 1.96], [-6.25, 2.12], [-6.25, 0.85]], 2.0, BODY);
        prism(b, [[-6.3, 0.9], [-6.3, 2.15], [-6.06, 2.95], [-5.95, 3.03], [-4.85, 3.03], [-4.85, 0.9]], 2.4, BODY);
        part(b, rbox(2.4, 2.55, 1.1, 0.08), BODY, 0, 2.25, -4.32);
        prism(b, [[-5.95, 3.0], [-3.78, 3.0], [-3.78, 3.86], [-4.35, 3.86]], 2.3, BODY);
        grille(b, 1.15, 0.9, 1.38, -7.78, CHROME, 6);
        part(b, box(2.45, 0.32, 0.26), CHROME, 0, 0.66, -7.86);
        plate(b, 0.66, -8.0);
        headlamps(l, b, 0.84, 1.15, -7.76, 0.3, 0.15, 0.3);
        part(b, box(2.1, 0.78, 0.04), GLASS, 0, 2.55, -6.2, 0, 0.3);
        part(b, box(0.06, 0.8, 0.05), BLACK, 0, 2.55, -6.2, 0, 0.3);
        for (let i = -2; i <= 2; i++) part(l, box(0.1, 0.06, 0.04), AMBER, i * 0.3, 3.08, -5.97);
        for (const sx of [1, -1]) {
          // fender over the steer tyre, door window and shut line, tanks, stacks, mirrors, steps
          part(b, new T.CylinderGeometry(0.64, 0.64, 0.38, 14, 1, true, -0.15, Math.PI + 0.3).rotateZ(Math.PI / 2), BODY, sx * 1.0, 0.52, -7.0);
          part(b, box(0.04, 0.62, 0.8), GLASS, sx * 1.205, 2.5, -5.6);
          part(b, box(0.03, 1.9, 0.02), TRIM, sx * 1.21, 1.9, -5.0);
          part(b, cylZ(0.32, 1.2, 14), CHROME, sx * 1.0, 0.88, -5.4);
          part(b, box(0.3, 0.06, 0.5), STEEL, sx * 1.2, 0.5, -6.0);
          part(b, new T.CylinderGeometry(0.075, 0.075, 2.7, 8), CHROME, sx * 1.26, 2.55, -4.95);
          part(b, box(0.3, 0.03, 0.03), TRIM, sx * 1.33, 2.5, -6.15);
          part(b, box(0.06, 0.45, 0.16), TRIM, sx * 1.48, 2.5, -6.15);
          part(b, box(0.45, 0.6, 0.02), TRIM, sx * 1.0, 0.6, -1.25);
        }
        for (const z of [-7.0]) for (const sx of [1, -1]) wheelAt(b, sx * 1.02, 0.52, z, 0.3, CHROME, 0);
        for (const z of [-3.05, -1.85]) for (const sx of [1, -1]) { wheelAt(b, sx * 1.05, 0.52, z, 0.28, CHROME, 0); wheelAt(b, sx * 0.76, 0.52, z, 0.28, STEEL, 0); }
        // trailer: white box, rails, landing gear, skirts, rear doors, underride bar, tandem axle
        part(b, rbox(2.55, 2.65, 11.4, 0.06), WHITE, 0, 2.575, 2.3);
        part(b, box(2.57, 0.12, 11.42), TRIM, 0, 1.29, 2.3);
        part(b, box(1.0, 0.25, 3.2), TRIM, 0, 1.08, 6.2);
        for (const sx of [1, -1]) {
          part(b, box(0.08, 0.95, 0.08), STEEL, sx * 0.8, 0.72, -1.2);
          part(b, box(0.2, 0.04, 0.2), STEEL, sx * 0.8, 0.25, -1.2);
          part(b, box(0.03, 0.62, 4.6), STEEL, sx * 1.2, 0.9, 2.0);
          part(b, box(0.5, 0.6, 0.02), TRIM, sx * 0.95, 0.6, 7.5);
          for (const z of [-2.5, 0.5, 3.5, 6.5]) part(l, box(0.03, 0.06, 0.1), AMBER, sx * 1.285, 3.8, z);
          for (const z of [5.6, 6.9]) { wheelAt(b, sx * 1.05, 0.52, z, 0.28, STEEL, 0); wheelAt(b, sx * 0.76, 0.52, z, 0.28, STEEL, 0); }
          part(b, box(0.03, 2.45, 0.03), CHROME, sx * 0.32, 2.55, 8.02);
          part(b, box(0.03, 2.45, 0.03), CHROME, sx * 0.95, 2.55, 8.02);
          part(l, box(0.28, 0.12, 0.04), TAILC, sx * 0.95, 1.0, 8.04);
          part(l, box(0.08, 0.06, 0.03), TAILC, sx * 1.15, 3.82, 8.02);
          part(b, box(0.08, 0.6, 0.08), STEEL, sx * 0.7, 0.8, 7.85);
        }
        part(b, box(0.02, 2.5, 0.02), TRIM, 0, 2.55, 8.015);
        part(b, box(2.5, 0.25, 0.1), TRIM, 0, 1.0, 7.97);
        part(b, box(2.3, 0.12, 0.12), STEEL, 0, 0.55, 7.85);
      },
    },
    {
      id: 'box', name: 'TRUCK', len: 8, wid: 2.4, hgt: 3.4, mass: 7000, weight: 7, vmin: 18, vmax: 25, bonus: 700, outer: true,
      build(b, l) {
        // cab-over cab
        prism(b, [[-4.0, 0.75], [-4.0, 1.55], [-3.92, 2.55], [-3.75, 2.7], [-2.2, 2.7], [-2.2, 0.75]], 2.2, BODY);
        part(b, box(2.0, 0.85, 0.04), GLASS, 0, 2.02, -3.98, 0, 0.08);
        part(b, box(0.05, 0.85, 0.05), BLACK, 0, 2.02, -3.99, 0, 0.08);
        grille(b, 1.5, 0.3, 1.3, -4.02, TRIM, 3);
        part(b, box(2.25, 0.3, 0.16), TRIM, 0, 0.66, -4.05);
        plate(b, 0.66, -4.14);
        headlamps(l, b, 0.8, 1.16, -4.02, 0.34, 0.14, 0.15);
        for (const sx of [1, -1]) {
          part(l, box(0.12, 0.06, 0.03), AMBER, sx * 0.98, 0.98, -4.02);
          part(b, box(0.04, 0.72, 0.95), GLASS, sx * 1.105, 2.05, -3.3);
          part(b, box(0.03, 1.75, 0.02), TRIM, sx * 1.11, 1.65, -2.72);
          part(b, box(0.03, 0.035, 0.15), CHROME, sx * 1.115, 1.6, -2.9);
          part(b, box(0.3, 0.05, 0.45), STEEL, sx * 1.0, 0.45, -2.7);
          part(b, box(0.28, 0.03, 0.03), TRIM, sx * 1.22, 2.25, -3.75);
          part(b, box(0.06, 0.45, 0.16), TRIM, sx * 1.36, 2.1, -3.75);
          part(b, box(0.03, 0.08, 3.6), STEEL, sx * 1.12, 0.75, 0.6);   // side guard
          part(b, cylZ(0.24, 0.9, 12), STEEL, sx * 0.85, 0.75, -1.6);
        }
        arch(b, 1.11, 0.48, -3.0, TRIM);
        // the box: white, a floor sill, a roll-up door, lamps, underride bar
        part(b, box(1.0, 0.25, 7.6), TRIM, 0, 0.85, 0.1);
        part(b, rbox(2.4, 2.35, 6.0, 0.05), WHITE, 0, 2.225, 1.0);
        part(b, box(2.41, 0.1, 6.02), TRIM, 0, 1.06, 1.0);
        part(b, box(2.15, 2.1, 0.02), DOOR, 0, 2.2, 4.005);
        for (let y = 1.35; y < 3.2; y += 0.22) part(b, box(2.15, 0.015, 0.02), STEEL, 0, y, 4.015);
        part(b, box(0.3, 0.04, 0.04), CHROME, 0, 1.25, 4.03);
        part(b, box(2.4, 0.3, 0.1), TRIM, 0, 0.9, 3.95);
        part(b, box(2.1, 0.12, 0.12), STEEL, 0, 0.5, 3.92);
        plate(b, 0.9, 4.01);
        for (const sx of [1, -1]) {
          part(l, box(0.24, 0.14, 0.04), TAILC, sx * 0.95, 0.9, 4.01);
          part(l, box(0.06, 0.06, 0.03), TAILC, sx * 1.12, 3.32, 4.02);
          part(l, box(0.03, 0.06, 0.06), AMBER, sx * 1.205, 3.32, -1.95);
          part(b, box(0.08, 0.45, 0.08), STEEL, sx * 0.75, 0.7, 3.9);
          part(b, box(0.5, 0.5, 0.02), TRIM, sx * 0.9, 0.55, 3.3);
          wheelAt(b, sx * 1.0, 0.48, -3.0, 0.28, STEEL, 0);
          wheelAt(b, sx * 1.0, 0.48, 2.6, 0.28, STEEL, 0); wheelAt(b, sx * 0.7, 0.48, 2.6, 0.28, STEEL, 0);
        }
      },
    },
    {
      id: 'hatch', name: 'CAR', len: 4.1, wid: 1.78, hgt: 1.48, mass: 1250, weight: 16, vmin: 21, vmax: 30, bonus: 300,
      build(b, l) {
        const S = [
          [-2.05, 0.78, 0.30, 0.68, 0.75, 0.72, 0.68],
          [-1.85, 0.86, 0.25, 0.78, 0.84, 0.82, 0.76],
          [-1.05, 0.885, 0.25, 0.86, 0.86, 0.94, 0.78],
          [-0.45, 0.885, 0.25, 0.88, 0.85, 1.44, 0.68],
          [0.60, 0.885, 0.25, 0.90, 0.84, 1.47, 0.68],
          [1.55, 0.88, 0.27, 0.93, 0.82, 1.40, 0.66],
          [1.95, 0.84, 0.32, 0.92, 0.78, 1.18, 0.66],
          [2.05, 0.80, 0.36, 0.90, 0.75, 1.10, 0.64],
        ];
        loft(b, S, [-0.6, 1.7]);
        for (const z of [-1.3, 1.3]) { arch(b, 0.9, 0.32, z); for (const sx of [1, -1]) wheelAt(b, sx * 0.79, 0.32, z, 0.23, ALLOY, 4); }
        shut(b, S, -0.88, 0.42, 0.86); shut(b, S, 0.42, 0.38, 0.89); shut(b, S, 1.12, 0.72, 0.92);
        pillar(b, S, 0.42); pillar(b, S, 1.45, 0.14); seal(b, S, -0.5, 1.62); handles(b, S, [0.0, 0.95]);
        mirrors(b, 0.86, 0.95, -0.45);
        grille(b, 0.6, 0.1, 0.5, -2.065, TRIM, 1);
        part(b, box(1.1, 0.12, 0.04), BLACK, 0, 0.37, -2.06);
        plate(b, 0.42, -2.075);
        headlamps(l, b, 0.55, 0.62, -2.05, 0.34, 0.1, 0.3);
        taillamps(l, b, 0.62, 0.95, 2.06, 0.26, 0.14, 0.35);
        part(b, box(1.45, 0.12, 0.04), BLACK, 0, 0.45, 2.06);
        plate(b, 0.7, 2.065);
      },
    },
    {
      id: 'pickup', name: 'PICKUP', len: 5.4, wid: 2.0, hgt: 1.9, mass: 2300, weight: 10, vmin: 20, vmax: 28, bonus: 380,
      build(b, l) {
        const S = [
          [-2.70, 0.92, 0.45, 0.95, 0.92, 1.00, 0.85],
          [-2.45, 1.00, 0.40, 1.10, 0.99, 1.14, 0.94],
          [-1.25, 1.00, 0.40, 1.16, 0.98, 1.24, 0.94],
          [-0.75, 1.00, 0.40, 1.18, 0.97, 1.82, 0.86],
          [0.20, 1.00, 0.40, 1.19, 0.96, 1.86, 0.86],
          [0.45, 1.00, 0.40, 1.19, 0.96, 1.84, 0.86],
        ];
        loft(b, S, [-0.9, 0.42]);
        part(b, box(1.4, 0.42, 0.02), GLASS, 0, 1.55, 0.455);
        // the bed: sides, front wall, floor, tailgate
        for (const sx of [1, -1]) part(b, box(0.08, 0.78, 2.25), BODY, sx * 0.96, 0.8, 1.6);
        part(b, box(1.92, 0.05, 2.25), TRIM, 0, 0.72, 1.6);
        part(b, box(1.84, 0.4, 0.05), BODY, 0, 0.98, 0.5);
        part(b, box(2.0, 0.78, 0.08), BODY, 0, 0.8, 2.68);
        part(b, box(0.2, 0.04, 0.03), TRIM, 0, 1.05, 2.725);
        for (const z of [-1.75, 1.85]) { arch(b, 1.015, 0.41, z, TRIM); for (const sx of [1, -1]) wheelAt(b, sx * 0.9, 0.41, z, 0.28, ALLOY, 6); }
        shut(b, S, -0.95, 0.62, 1.15); shut(b, S, 0.3, 0.55, 1.17); pillar(b, S, -0.1); seal(b, S, -0.75, 0.4);
        handles(b, S, [-0.35, 0.15]);
        mirrors(b, 0.97, 1.25, -0.75);
        grille(b, 1.2, 0.34, 0.78, -2.715, CHROME, 2);
        part(b, box(1.95, 0.2, 0.14), CHROME, 0, 0.5, -2.72);
        plate(b, 0.5, -2.8);
        headlamps(l, b, 0.76, 0.86, -2.69, 0.3, 0.14, 0.25);
        for (const sx of [1, -1]) part(l, box(0.1, 0.36, 0.04), TAILC, sx * 0.92, 1.0, 2.725);
        part(b, box(2.0, 0.18, 0.15), CHROME, 0, 0.5, 2.78);
        plate(b, 0.5, 2.86);
      },
    },
  ];
  G.TRAFFIC_TYPES = TYPES;

  // the body material: only paint takes the instance colour; trim and tyres go matte
  G.trafficBodyMaterial = () => {
    const m = new T.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.38, metalness: 0.45, clearcoat: 0.8, clearcoatRoughness: 0.12 });
    m.onBeforeCompile = (s) => {
      s.vertexShader = s.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float paint;\nvarying float vFin;')
        .replace('#include <color_vertex>', '#include <color_vertex>\nvFin = paint;\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = color.xyz * mix(vec3(1.0), instanceColor.xyz, step(0.5, paint) * step(paint, 1.5));\n#endif');
      s.fragmentShader = s.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying float vFin;')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nif (vFin > 1.5) { metalnessFactor = 0.0; roughnessFactor = 0.75; }')
        .replace('#include <lights_physical_fragment>', '#include <lights_physical_fragment>\n#ifdef USE_CLEARCOAT\nif (vFin > 1.5) material.clearcoat = 0.0;\n#endif');
    };
    m.customProgramCacheKey = () => 'traffic-paint';
    return m;
  };

  const DENSITY = { off: 0, light: 45, medium: 95, heavy: 165, insane: 260 };
  G.TRAFFIC_DENSITY = DENSITY;

  class Traffic {
    constructor(game, density) {
      this.game = game;
      const track = (this.track = game.track);
      // the counts are tuned for the 3.8 km, six-lane city loop: keep cars-per-lane-km about the same elsewhere
      const n = Math.round((DENSITY[density] ?? 95) * G.clamp(track.length * G.LANES.length / (3807 * 6), 0.5, 1.6));
      // cross streets: a few cars per lane that loop across their junction (kept apart from this.cars, which
      // multiplayer syncs lane by lane)
      this.xings = game.xings && game.xings.list.length ? game.xings : null;
      const perLane = density === 'light' ? 2 : density === 'heavy' || density === 'insane' ? 4 : 3;
      const xn = this.xings ? this.xings.list.length * 2 * perLane : 0;
      this.cars = [];
      this.xcars = [];
      this.near = [];
      this.group = new T.Group();
      game.scene.add(this.group);
      const totalW = TYPES.reduce((a, t) => a + t.weight, 0);
      const counts = TYPES.map(() => 0);
      const assign = [];
      for (let i = 0; i < n + xn; i++) {
        let r = Math.random() * totalW, ti = 0;
        while (r > TYPES[ti].weight) { r -= TYPES[ti].weight; ti++; }
        assign.push(ti); counts[ti]++;
      }
      const shadows = game.Q.shadows;
      this.meshes = TYPES.map((t, ti) => {
        if (!counts[ti]) return null;
        const b = [], l = [];
        t.build(b, l);
        const bg = mergeGeometries(b), lg = mergeGeometries(l);
        const bm = new T.InstancedMesh(bg, G.trafficBodyMaterial(), counts[ti]);
        const lm = new T.InstancedMesh(lg, new T.MeshBasicMaterial({ vertexColors: true, toneMapped: false }), counts[ti]);
        bm.castShadow = shadows; bm.frustumCulled = false; lm.frustumCulled = false;
        bm.instanceMatrix.setUsage(T.DynamicDrawUsage); lm.instanceMatrix.setUsage(T.DynamicDrawUsage);
        this.group.add(bm, lm);
        return { bm, lm, used: 0 };
      });
      // blob shadows
      this.blobs = new T.InstancedMesh(new T.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
        new T.MeshBasicMaterial({ map: G.blobShadowTexture(), color: 0x000000, transparent: true, opacity: 0.55, depthWrite: false, blending: T.MultiplyBlending, premultipliedAlpha: true }), Math.max(1, n + xn));
      this.blobs.material.blending = T.CustomBlending;
      this.blobs.material.blendEquation = T.AddEquation;
      this.blobs.material.blendSrc = T.ZeroFactor;
      this.blobs.material.blendDst = T.OneMinusSrcColorFactor;
      this.blobs.material.color.setScalar(0.62);
      this.blobs.material.opacity = 1;
      this.blobs.frustumCulled = false; this.blobs.renderOrder = 1;
      this.group.add(this.blobs);
      this.blobs.count = n + xn;

      const col = new T.Color();
      for (let i = 0; i < n + xn; i++) {
        const ti = assign[i], t = TYPES[ti];
        const mesh = this.meshes[ti];
        const idx = mesh.used++;
        mesh.bm.setColorAt(idx, col.set(t.id === 'bus' ? G.pick([0xf2c230, 0xe9e9e6, 0x2c6fb7, 0xc0302c]) : G.pick(BODY_COLS)));
        const c = {
          id: i, ti, t, idx, s: 0, lane: 0, lat: 0, latT: 0, v: 0, vT: 0, dir: 1,
          x: 0, y: 0, z: 0, yaw: 0, hx: 0, hz: -1,
          loose: false, lvx: 0, lvy: 0, lvz: 0, yawV: 0, roll: 0, rollV: 0, pitch: 0, pitchV: 0, timer: 0,
          lastAlong: NaN, cd: 0, latV: 0,
        };
        if (i < n) { this.cars.push(c); continue; }
        // cross car: junction xi, heading dir along the junction's +r, u = position along it (0 = circuit centreline)
        const k = i - n, per = 2 * perLane;
        Object.assign(c, { xc: true, xi: (k / per) | 0, dir: k % per < perLane ? 1 : -1, u: 0 });
        this.xcars.push(c);
      }
      this.all = this.cars.concat(this.xcars);
      for (const c of this.xcars) {
        const k = this.xcars.filter((o) => o.xi === c.xi && o.dir === c.dir).indexOf(c);
        this.initCross(c, G.WALK_OUT + 6 + k * 13);
      }
      for (const m of this.meshes) if (m && m.bm.instanceColor) m.bm.instanceColor.needsUpdate = true;
      this._s = {}; this._n = {};
      this._gq = {};
      this.spawnAll(0, 70);
    }

    laneLat(lane) { return G.LANES[lane]; }

    // ---------- cross streets ----------
    // put a cross car `back` metres short of the circuit's centreline on its way in
    initCross(c, back) {
      c.u = -c.dir * back;
      c.vT = G.rand(11, 15); c.v = c.vT * 0.7;
      c.loose = false; c.roll = 0; c.pitch = 0; c.rollV = 0; c.pitchV = 0; c.yawV = 0; c.timer = 0; c.lastAlong = NaN; c.latV = 0;
      this.placeCross(c);
    }
    placeCross(c) {
      const X = this.xings.list[c.xi], off = -c.dir * G.XING.LANE; // drive on the right
      c.x = X.x + X.rx * c.u + X.tx * off; c.z = X.z + X.rz * c.u + X.tz * off;
      c.hx = X.rx * c.dir; c.hz = X.rz * c.dir;
      c.yaw = Math.atan2(-c.hx, -c.hz);
      c.y = Math.abs(c.u) > G.ROAD_HALF ? 0.17 : 0;
      c.s = G.wrap(X.s + off, this.track.length); c.lat = c.u;
    }
    // follow the car ahead, stop at the line on red, loop back to the far end once across
    updateCross(dt) {
      const xs = this.xings, WO = G.WALK_OUT;
      const groups = new Map();
      for (const c of this.xcars) {
        if (c.loose) continue;
        const key = c.xi * 2 + (c.dir > 0 ? 1 : 0);
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(c);
      }
      for (const arr of groups.values()) {
        arr.sort((a, b) => a.dir * a.u - b.dir * b.u);
        for (let k = 0; k < arr.length; k++) {
          const c = arr[k], X = xs.list[c.xi], pos = c.dir * c.u;
          let gap = 1e9, lv = 0;
          if (k + 1 < arr.length) { const ld = arr[k + 1]; gap = ld.dir * ld.u - pos - (c.t.len + ld.t.len) / 2; lv = ld.v; }
          const st = xs.cross(c.xi), line = -(WO + 0.6) - pos - c.t.len / 2;
          if (st !== 'G' && line > -0.5 && (st === 'Y' ? line > (c.v * c.v) / 10 : line > (c.v * c.v) / 18 - 1) && line < gap) { gap = line; lv = 0; }
          const safe = 4 + c.v * 0.9;
          let target = c.vT;
          if (gap < safe) target = Math.min(target, lv * G.clamp(gap / safe, 0, 1));
          if (gap < 1.2) c.v = Math.min(c.v, lv * 0.9);
          c.v = Math.max(0, c.v + G.clamp(target - c.v, -9 * dt, 3 * dt));
          c.u += c.v * c.dir * dt;
          // out the far end: rejoin at the back of the queue on the near end
          const out = X.ext[c.dir > 0 ? 1 : 0], back = X.ext[c.dir > 0 ? 0 : 1];
          if (c.dir * c.u > out) {
            const tail = arr.reduce((m, o) => (o !== c ? Math.min(m, o.dir * o.u) : m), 1e9);
            c.u = c.dir * Math.min(-back, tail - c.t.len - 7);
            c.v = c.vT * 0.8;
          }
          this.placeCross(c);
        }
      }
    }
    // the lanes running the same way as this one (indices into G.LANES)
    laneGroup(lane) { const nf = G.LANES_FWD.length; return lane < nf ? [0, nf] : [nf, G.LANES.length]; }
    // trucks and buses keep out of the fast (leftmost) third of their side
    laneOk(t, lane) { const [a, b] = this.laneGroup(lane); return !t.outer || lane - a >= (b - a) / 3; }

    pickLane(t) {
      let lane;
      do lane = (Math.random() * G.LANES.length) | 0; while (!this.laneOk(t, lane));
      return lane;
    }

    // spread cars along the track keeping clear of the zone around s0
    spawnAll(s0, clear) {
      const L = this.track.length;
      for (const c of this.cars) {
        let tries = 0;
        do {
          c.lane = this.pickLane(c.t);
          c.s = Math.random() * L;
          tries++;
        } while (tries < 40 && (this.zoneDist(c.s, s0) < clear || !this.freeAt(c, c.lane, c.s)));
        this.initCar(c);
      }
    }
    zoneDist(a, b) { const L = this.track.length; const d = Math.abs(G.wrap(a - b, L)); return Math.min(d, L - d); }
    freeAt(c, lane, s) {
      for (const o of this.cars) {
        if (o === c || o.loose || o.lane !== lane || o.v === undefined) continue;
        if (this.zoneDist(o.s, s) < (o.t.len + c.t.len) / 2 + 10) return false;
      }
      return true;
    }
    initCar(c) {
      c.dir = c.lane < G.LANES_FWD.length ? 1 : -1;
      c.lat = c.latT = this.laneLat(c.lane);
      c.vT = G.rand(c.t.vmin, c.t.vmax) * (G.TRACK.traffic || 1);
      c.v = c.vT * 0.9;
      c.loose = false; c.roll = 0; c.pitch = 0; c.rollV = 0; c.pitchV = 0; c.timer = 0; c.lastAlong = NaN; c.y = 0;
      this.place(c);
    }

    respawnFar(c, ps) {
      const L = this.track.length;
      for (let k = 0; k < 30; k++) {
        const s = G.wrap(ps + G.rand(260, L - 260), L);
        const lane = this.pickLane(c.t);
        if (this.freeAt(c, lane, s)) { c.s = s; c.lane = lane; this.initCar(c); return; }
      }
    }

    place(c) {
      const p = this.track.sample(c.s, this._s);
      c.x = p.x + p.rx * c.lat; c.z = p.z + p.rz * c.lat;
      // heading with slight lane-change angle
      const a = Math.atan2(c.latV, Math.max(c.v, 1));
      const hx = p.tx * c.dir, hz = p.tz * c.dir;
      const ca = Math.cos(a), sa = Math.sin(a);
      // rotate heading towards +right by a (right of travel for dir=+1 is +r)
      c.hx = hx * ca + p.rx * sa; c.hz = hz * ca + p.rz * sa;
      c.yaw = Math.atan2(-c.hx, -c.hz);
      this.track.groundAt(c.x, c.z, this._gq, this.track.heightAt(c.s) + 1);
      c.y = c.gy = this._gq.h;
      if (this.track.gaps.length) { const y = this.track.gapLift(c.s); if (y != null) c.y = c.gy = y; } // over a gap: it jumps too
    }

    update(dt, player, playerS) {
      const L = this.track.length;
      // lane lists
      const NL = G.LANES.length, lanes = G.LANES.map(() => []);
      for (const c of this.cars) {
        if (!c.loose) { lanes[c.lane].push(c); continue; }
        // a slow wreck sitting in a lane is an obstacle the cars behind brake for and steer around
        if (c.y - (c.gy || 0) > 1 || Math.hypot(c.lvx, c.lvz) > 4 || c.y < this.track.heightAt(c.s) - 3) continue;
        for (let ln = 0; ln < NL; ln++) if (Math.abs(this.laneLat(ln) - c.lat) < 1.9) lanes[ln].push(c);
      }
      for (let ln = 0; ln < NL; ln++) {
        const arr = lanes[ln];
        arr.sort((a, b) => a.s - b.s);
        const n = arr.length;
        for (let k = 0; k < n; k++) {
          const c = arr[k];
          if (c.loose) continue;
          let gap = 1e9, lead = null;
          if (n > 1) {
            lead = c.dir > 0 ? arr[(k + 1) % n] : arr[(k - 1 + n) % n];
            const d = c.dir > 0 ? G.wrap(lead.s - c.s, L) : G.wrap(c.s - lead.s, L);
            gap = d - (c.t.len + lead.t.len) / 2;
          }
          // player as obstacle (traffic brakes a little for you)
          const safe = 5 + c.v * 1.0;
          let target = c.vT;
          let lv = lead && lead.loose ? 0 : lead ? lead.v : 0;
          // traffic lights at the cross streets: the stop line acts like a parked car
          const stop = this.xings ? this.xings.stopGap(c) : 1e9;
          const atLight = stop < gap;
          if (atLight) { gap = stop; lv = 0; }
          if (gap < safe) target = Math.min(target, lv * G.clamp(gap / safe, 0, 1));
          if (gap < 1.5) c.v = Math.min(c.v, lv * 0.9);
          c.v += G.clamp(target - c.v, -9 * dt, 2.8 * dt);
          c.v = Math.max(0, c.v);
          // lane change when stuck behind slower car
          if (!atLight && gap < safe * 1.6 && c.v < c.vT - 3 && Math.abs(c.lat - c.latT) < 0.2 && Math.random() < dt * 0.6) {
            const [a, b] = this.laneGroup(c.lane);
            const nl = G.pick([c.lane - 1, c.lane + 1].filter((x) => x >= a && x < b));
            if (nl !== undefined && this.laneOk(c.t, nl) && this.freeAt(c, nl, c.s)) { c.lane = nl; c.latT = this.laneLat(nl); }
          }
        }
      }
      if (this.xings) this.updateCross(dt);
      const pPos = player.pos;
      this.near.length = 0;
      for (const c of this.all) {
        if (c.xc && !c.loose) { /* moved in updateCross */ } else if (!c.loose) {
          const old = c.lat;
          c.lat = G.damp(c.lat, c.latT, 1.6, dt);
          c.latV = (c.lat - old) / dt;
          c.s = G.wrap(c.s + c.v * c.dir * dt, L);
          this.place(c);
        } else { this.updateLoose(c, dt, playerS); this.collideLoose(c); }
        const dx = c.x - pPos.x, dz = c.z - pPos.z;
        if (dx * dx + dz * dz < 40 * 40) this.near.push(c); else c.lastAlong = NaN;
        if (c.cd > 0) c.cd -= dt;
      }
      this.writeInstances();
    }

    updateLoose(c, dt, playerS) {
      c.timer += dt;
      c.lvy -= G.GRAV * dt;
      c.x += c.lvx * dt; c.y += c.lvy * dt; c.z += c.lvz * dt;
      this.track.groundAt(c.x, c.z, this._gq, c.y + 0.5);
      const gh = c.gy = this._gq.h;
      const onGround = c.y <= gh + 0.01;
      if (onGround) {
        c.y = gh;
        if (c.lvy < -4) { c.lvy *= -0.25; c.rollV *= 0.6; c.pitchV *= 0.6; } else c.lvy = 0;
        const hs = Math.hypot(c.lvx, c.lvz);
        if (hs > 0.01) { const k = Math.max(0, hs - 9 * dt) / hs; c.lvx *= k; c.lvz *= k; }
        c.yawV *= Math.exp(-2.5 * dt);
        // settle roll/pitch to nearest stable (upright or on the roof)
        const tr = Math.abs(c.roll) > Math.PI / 2 ? Math.sign(c.roll) * Math.PI : 0;
        c.roll = G.damp(c.roll, tr, 5, dt); c.rollV *= Math.exp(-6 * dt);
        c.pitch = G.damp(c.pitch, 0, 5, dt); c.pitchV *= Math.exp(-6 * dt);
      }
      c.yaw += c.yawV * dt; c.roll += c.rollV * dt; c.pitch += c.pitchV * dt;
      c.hx = -Math.sin(c.yaw); c.hz = -Math.cos(c.yaw);
      // walls (a cross car still in its side street has none)
      this.track.nearest(c.x, c.z, -1, this._n);
      const lim = G.WALL - c.t.wid / 2;
      const X = c.xc ? this.xings.list[c.xi] : null;
      const inSide = X && Math.abs((c.x - X.x) * X.tx + (c.z - X.z) * X.tz) < G.XING.HALF;
      if (!inSide && Math.abs(this._n.lat) > lim) {
        const sg = Math.sign(this._n.lat), nx = this._n.rx * sg, nz = this._n.rz * sg;
        const pen = Math.abs(this._n.lat) - lim;
        c.x -= nx * pen; c.z -= nz * pen;
        const vn = c.lvx * nx + c.lvz * nz;
        if (vn > 0) { c.lvx -= nx * vn * 1.4; c.lvz -= nz * vn * 1.4; }
      }
      c.s = this._n.s; c.lat = this._n.lat;
      // a knocked cross car goes back to its street once it has settled out of sight
      if (c.xc) {
        const dx = c.x - this.game.player.pos.x, dz = c.z - this.game.player.pos.z;
        if (c.timer > 6 && dx * dx + dz * dz > 70 * 70) this.initCross(c, X.ext[c.dir > 0 ? 0 : 1]);
        return;
      }
      // a car that was only nudged and came to rest upright, lined up with its own side of the road, drives on
      if (onGround && c.timer > 1.5 && Math.hypot(c.lvx, c.lvz) < 0.6 && Math.abs(c.roll) < 0.15 && Math.abs(c.pitch) < 0.15) {
        const n = this._n, nf = G.LANES_FWD.length, lanes = c.dir > 0 ? G.LANES_FWD.map((_, i) => i) : G.LANES_ONC.map((_, i) => nf + i);
        const ln = lanes.reduce((a, b) => (Math.abs(this.laneLat(b) - n.lat) < Math.abs(this.laneLat(a) - n.lat) ? b : a));
        const p = this.track.sample(n.s, this._s);
        const al = (c.hx * p.tx + c.hz * p.tz) * c.dir;
        // roughly lined up (a nudge mid lane-change): ease the nose straight first, the way a driver would
        if (Math.abs(this.laneLat(ln) - n.lat) < 1.6 && al > 0.8 && al < 0.995) {
          const want = Math.atan2(-p.tx * c.dir, -p.tz * c.dir);
          let dy = want - c.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          c.yaw += G.clamp(dy, -0.5 * dt, 0.5 * dt); c.hx = -Math.sin(c.yaw); c.hz = -Math.cos(c.yaw);
        } else if (Math.abs(this.laneLat(ln) - n.lat) < 1.6 && al >= 0.995) {
          c.loose = false; c.lane = ln; c.lat = n.lat; c.latT = this.laneLat(ln); c.latV = 0; c.v = 0;
          c.roll = c.pitch = c.rollV = c.pitchV = c.yawV = 0; c.lastAlong = NaN;
          return;
        }
      }
      const dx = c.x - this.game.player.pos.x, dz = c.z - this.game.player.pos.z;
      if (c.timer > 9 && dx * dx + dz * dz > 150 * 150) this.respawnFar(c, playerS);
      else if (c.timer > 2.5 && c.y < this.track.heightAt(c.s) - 8) this.respawnFar(c, playerS); // gone down a gap
    }

    // a knocked-loose car hitting other traffic: same OBB + mass impulse rules as a roadster hitting traffic
    collideLoose(c) {
      if (Math.hypot(c.lvx, c.lvz) < 2) return;
      for (const o of this.all) {
        if (o === c) continue;
        const dx = o.x - c.x, dz = o.z - c.z;
        if (dx * dx + dz * dz > 100 || Math.abs(o.y - c.y) > 2.2) continue;
        const axes = [[c.hx, c.hz], [-c.hz, c.hx], [o.hx, o.hz], [-o.hz, o.hx]];
        let minO = 1e9, nx = 0, nz = 0, sep = false;
        for (const [ax, az] of axes) {
          const rc = Math.abs(c.hx * ax + c.hz * az) * c.t.len / 2 + Math.abs(-c.hz * ax + c.hx * az) * c.t.wid / 2;
          const ro = Math.abs(o.hx * ax + o.hz * az) * o.t.len / 2 + Math.abs(-o.hz * ax + o.hx * az) * o.t.wid / 2;
          const d = dx * ax + dz * az, ov = rc + ro - Math.abs(d);
          if (ov <= 0) { sep = true; break; }
          if (ov < minO) { minO = ov; const sg = d > 0 ? 1 : -1; nx = ax * sg; nz = az * sg; } // c -> o
        }
        if (sep) continue;
        if (!o.loose) this.knock(o, 0, 0, 0, 0);
        const mc = c.t.mass, mo = o.t.mass * (o.loose ? 0.7 : 1);
        c.x -= nx * minO * mo / (mc + mo); c.z -= nz * minO * mo / (mc + mo);
        if (o.loose) { o.x += nx * minO * mc / (mc + mo); o.z += nz * minO * mc / (mc + mo); }
        const ovx = o.loose ? o.lvx : o.hx * o.v, ovz = o.loose ? o.lvz : o.hz * o.v;
        const vrel = (ovx - c.lvx) * nx + (ovz - c.lvz) * nz;
        if (vrel >= 0) continue;
        const j = -1.25 * vrel / (1 / mc + 1 / mo);
        c.lvx -= nx * j / mc; c.lvz -= nz * j / mc;
        const dv = j / mo;
        this.knock(o, nx * dv, dv > 1.2 ? Math.min(6, dv * 0.2) : 0, nz * dv, (Math.random() - 0.5) * dv * 0.2);
      }
    }

    knock(c, dvx, dvy, dvz, spin) {
      if (!c.loose) {
        c.loose = true; c.timer = 0;
        c.lvx = c.hx * c.v; c.lvz = c.hz * c.v; c.lvy = 0;
        c.yawV = 0; c.rollV = 0; c.pitchV = 0;
      }
      c.lvx += dvx; c.lvy += dvy; c.lvz += dvz;
      c.yawV += spin;
      const m = Math.hypot(dvx, dvz);
      c.rollV += (Math.random() - 0.5) * m * 0.25;
      c.pitchV += (Math.random() - 0.5) * m * 0.12;
      c.timer = 0;
    }

    writeInstances() {
      const m4 = this._m4 || (this._m4 = new T.Matrix4());
      const e = new T.Euler(0, 0, 0, 'YXZ'), q = new T.Quaternion(), p = new T.Vector3(), s1 = new T.Vector3(1, 1, 1), sb = new T.Vector3();
      for (const c of this.all) {
        e.set(c.pitch, c.yaw, c.roll);
        q.setFromEuler(e);
        p.set(c.x, c.y, c.z);
        m4.compose(p, q, s1);
        const mesh = this.meshes[c.ti];
        mesh.bm.setMatrixAt(c.idx, m4); mesh.lm.setMatrixAt(c.idx, m4);
        const gy = c.gy || 0, air = Math.max(0, c.y - gy);
        p.set(c.x, gy + 0.04, c.z);
        sb.set(c.t.wid * 1.5, 1, c.t.len * 1.25).multiplyScalar(Math.max(0.3, 1 - air * 0.1));
        q.setFromAxisAngle(_up, c.yaw);
        m4.compose(p, q, sb);
        this.blobs.setMatrixAt(c.id, m4);
      }
      for (const m of this.meshes) if (m) { m.bm.instanceMatrix.needsUpdate = true; m.lm.instanceMatrix.needsUpdate = true; }
      this.blobs.instanceMatrix.needsUpdate = true;
    }

    // roofs as ground for the player's wheels
    roofAt(x, z, yRef, out, list = this.near) {
      for (const c of list) {
        if (Math.abs(c.roll) > 0.35 || Math.abs(c.pitch) > 0.35) continue;
        const top = c.y + c.t.hgt;
        if (top <= out.h || top > yRef + 0.05) continue;
        const dx = x - c.x, dz = z - c.z;
        const along = dx * c.hx + dz * c.hz, side = dx * -c.hz + dz * c.hx;
        if (Math.abs(along) < c.t.len / 2 - 0.15 && Math.abs(side) < c.t.wid / 2 - 0.05) {
          out.h = top; out.nx = 0; out.ny = 1; out.nz = 0;
          if (c.loose) { out.vx = c.lvx; out.vy = 0; out.vz = c.lvz; } else { out.vx = c.hx * c.v; out.vy = 0; out.vz = c.hz * c.v; }
          out.roof = c;
        }
      }
      return out;
    }

    // traffic within r of a point (for AI roadsters, which need their own neighbourhood)
    gatherNear(x, z, r, out) {
      out.length = 0;
      for (const c of this.all) { const dx = c.x - x, dz = c.z - z; if (dx * dx + dz * dz < r * r) out.push(c); }
      return out;
    }

    // roadster OBB (player or AI) vs traffic OBB (2D SAT + height) — called each physics substep
    collidePlayer(pl, list = this.near) {
      const fwd = _a.set(0, 0, -1).applyQuaternion(pl.q); fwd.y = 0;
      if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
      fwd.normalize();
      const pfx = fwd.x, pfz = fwd.z, prx = -pfz, prz = pfx;
      const PL = 4.6, PW = 2.05, MP = 1400;
      for (const c of list) {
        const top = c.y + c.t.hgt;
        if (pl.pos.y + 0.18 > top - 0.25) continue;     // above the roof
        if (pl.pos.y + 1.2 < c.y) continue;              // under a flying car
        const dx = c.x - pl.pos.x, dz = c.z - pl.pos.z;
        const chx = c.hx, chz = c.hz, crx = -chz, crz = chx;
        const CL = c.t.len, CW = c.t.wid;
        let minO = 1e9, nx = 0, nz = 0;
        const axes = [[pfx, pfz], [prx, prz], [chx, chz], [crx, crz]];
        let sep = false;
        for (const [ax, az] of axes) {
          const pr = Math.abs(pfx * ax + pfz * az) * PL / 2 + Math.abs(prx * ax + prz * az) * PW / 2;
          const cr = Math.abs(chx * ax + chz * az) * CL / 2 + Math.abs(crx * ax + crz * az) * CW / 2;
          const d = dx * ax + dz * az;
          const o = pr + cr - Math.abs(d);
          if (o <= 0) { sep = true; break; }
          if (o < minO) { minO = o; const sg = d > 0 ? -1 : 1; nx = ax * sg; nz = az * sg; }
        }
        if (sep) continue;
        // touching a car hands this one over to physics (a lane-changer can't just shove you aside)
        if (!c.loose) this.knock(c, 0, 0, 0, 0);
        const MT = c.t.mass * (c.loose ? 0.7 : 1);
        const wp = MT / (MP + MT), wc = MP / (MP + MT);
        pl.pos.x += nx * minO * wp; pl.pos.z += nz * minO * wp;
        if (c.loose) { c.x -= nx * minO * wc; c.z -= nz * minO * wc; }
        const cvx = c.loose ? c.lvx : c.hx * c.v, cvz = c.loose ? c.lvz : c.hz * c.v;
        const vrel = (pl.vel.x - cvx) * nx + (pl.vel.z - cvz) * nz;
        if (vrel < 0) {
          const j = -(1.25) * vrel / (1 / MP + 1 / MT);
          pl.vel.x += nx * j / MP; pl.vel.z += nz * j / MP;
          const dv = j / MT;
          // tangential scrub
          const tx = -nz, tz = nx;
          const vt = (pl.vel.x - cvx) * tx + (pl.vel.z - cvz) * tz;
          pl.vel.x -= tx * vt * 0.08; pl.vel.z -= tz * vt * 0.08;
          const side = (pl.pos.x - c.x) * c.hx + (pl.pos.z - c.z) * c.hz;
          pl.w.y += (Math.random() - 0.5) * Math.abs(vrel) * 0.05 + Math.sign(vt) * Math.abs(vrel) * 0.015;
          this.knock(c, -nx * dv, dv > 1.2 ? Math.min(9, dv * 0.25 + (dv > 6 ? 2 : 0)) : 0, -nz * dv, (Math.sign(side) || 1) * dv * 0.12);
          pl.onTrafficHit(c, -vrel, pl.pos.x - nx * 1.0, pl.pos.y + 0.6, pl.pos.z - nz * 1.0);
        }
      }
    }

    // near miss / jump-over detection (once per frame)
    detectStunts(pl) {
      for (const c of this.near) {
        const dx = pl.pos.x - c.x, dz = pl.pos.z - c.z;
        const along = dx * c.hx + dz * c.hz, side = dx * -c.hz + dz * c.hx;
        const prev = c.lastAlong;
        c.lastAlong = along;
        if (isNaN(prev) || c.loose || c.cd > 0) continue;
        if (Math.sign(prev) === Math.sign(along)) continue;
        const cvx = c.hx * c.v, cvz = c.hz * c.v;
        const rel = Math.hypot(pl.vel.x - cvx, pl.vel.z - cvz);
        if (rel < 10) continue;
        const top = c.y + c.t.hgt;
        const edge = Math.abs(side) - c.t.wid / 2 - 1.02;
        if (pl.pos.y > top - 0.3 && Math.abs(side) < c.t.wid / 2 + 1.5) {
          c.cd = 1.5; this.game.onJumpOver(c);
        } else if (edge > 0 && edge < 1.4 && pl.pos.y < top) {
          c.cd = 1.5; this.game.onNearMiss(c, edge, c.dir < 0 && !c.xc);
        }
      }
    }

    dispose() {
      this.game.scene.remove(this.group);
      this.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    }
  }
  const _a = new T.Vector3(), _up = new T.Vector3(0, 1, 0);
  G.Traffic = Traffic;
})();
