# model_bastion2.py: BASTION v2, modelled from scratch in Blender after models/source/bastion_front.png / bastion_rear.png.
#   blender -b -P tools/model_bastion2.py -- models/bastion2.glb [--renders <dir>] [--blend models/source/bastion2.blend]
# Smooth lofted body (analytic cross-sections, so no dents), boolean wheel arches, and the details as their own parts:
# glass, LED headlights, ring tail lights, intakes, hood and side vents, mirrors, ducktail, diffuser and twin turbines.
# Game frame after glTF export: front -Z, up +Y. Here (Blender): front +Y, up +Z, ground z = 0.
# Wheels are not modelled: the game adds its own on the physics wheels (axles at y +1.42 / -1.45, centre z = wheelR - 0.01).
# Material names are what js/car.js keys on: paint, glass, light_head, light_tail; everything else keeps its own PBR material.
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DST = argv[0] if argv else 'bastion2.glb'
opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
PNG, BLEND = opt('--renders'), opt('--blend')

WHEEL_R = 0.42                 # js kit.wheelR
AXLE_F, AXLE_R = 1.42, -1.45   # physics wheel stations (y)
WZ = WHEEL_R - 0.01            # wheel centre height
ARCH_R = 0.47

# ---------------- scene + materials ----------------
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene

def mat(name, col, rough=0.5, metal=0.0, emit=None, emit_s=0.0, double=False):
    m = bpy.data.materials.new(name)
    try: m.use_nodes = True
    except Exception: pass
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    if emit:
        b.inputs['Emission Color'].default_value = (*emit, 1)
        b.inputs['Emission Strength'].default_value = emit_s
    m.use_backface_culling = not double
    return m

M = {
    'paint': mat('paint', (0.62, 0.63, 0.65), 0.3, 0.5),
    'glass': mat('glass', (0.02, 0.022, 0.026), 0.08, 0.0),
    'black': mat('black', (0.008, 0.008, 0.009), 0.92, 0.0, double=True),
    'trim': mat('trim', (0.018, 0.019, 0.022), 0.3, 0.3),
    'grille': mat('grille', (0.004, 0.004, 0.005), 0.95, 0.0, double=True),
    'metal': mat('metal', (0.35, 0.36, 0.38), 0.3, 1.0),
    'darkmetal': mat('darkmetal', (0.06, 0.062, 0.068), 0.35, 1.0),
    'light_head': mat('light_head', (1, 1, 1), 0.2, 0, (1, 1, 1.05), 6),
    'light_tail': mat('light_tail', (0.8, 0.02, 0.02), 0.3, 0, (1, 0.02, 0.03), 5),
}

def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(M[m])
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    return ob

# ---------------- 1D profile curves (monotone cubic, no overshoot) ----------------
def pchip(pts):
    xs = np.array([p[0] for p in pts], float); ys = np.array([p[1] for p in pts], float)
    h = np.diff(xs); d = np.diff(ys) / h; m = np.zeros_like(ys)
    for i in range(1, len(xs) - 1):
        if d[i - 1] * d[i] > 0:
            w1, w2 = 2 * h[i] + h[i - 1], h[i] + 2 * h[i - 1]
            m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
    m[0], m[-1] = d[0], d[-1]
    def f(x):
        x = min(max(x, xs[0]), xs[-1])
        i = int(min(max(np.searchsorted(xs, x) - 1, 0), len(xs) - 2))
        t = (x - xs[i]) / h[i]
        return ((2 * t**3 - 3 * t**2 + 1) * ys[i] + (t**3 - 2 * t**2 + t) * h[i] * m[i]
                + (-2 * t**3 + 3 * t**2) * ys[i + 1] + (t**3 - t**2) * h[i] * m[i + 1])
    return f

Y0, Y1 = -2.36, 2.36   # tail, nose
# centre-line top: nose, long hood, raked screen, roof, fastback, deck, ducktail lip
ZTOP = pchip([(-2.36, 1.035), (-2.31, 1.065), (-2.18, 1.03), (-1.95, 1.0), (-1.65, 1.0), (-1.2, 1.115), (-0.8, 1.215),
              (-0.45, 1.262), (-0.15, 1.258), (0.2, 1.16), (0.62, 0.985), (1.2, 0.905), (1.8, 0.83), (2.15, 0.75), (2.36, 0.69)])
ZBELT = pchip([(-2.36, 0.97), (-2.2, 0.985), (-1.9, 0.97), (-1.4, 0.925), (-0.6, 0.885), (0.3, 0.875), (0.62, 0.9),
               (1.1, 0.955), (1.45, 0.965), (1.85, 0.9), (2.15, 0.78), (2.36, 0.69)])
WBELT = pchip([(-2.36, 0.74), (-2.2, 0.82), (-1.9, 0.87), (-1.45, 0.89), (-0.6, 0.865), (0.3, 0.855), (0.62, 0.84),
               (1.4, 0.83), (2.0, 0.8), (2.25, 0.76), (2.36, 0.72)])
W = pchip([(-2.36, 0.90), (-2.25, 0.98), (-2.0, 1.05), (-1.45, 1.10), (-0.95, 1.07), (-0.45, 0.995), (0.25, 0.985),
           (0.85, 1.025), (1.42, 1.065), (1.9, 1.04), (2.15, 0.99), (2.3, 0.93), (2.36, 0.87)])
ZSH = pchip([(-2.36, 0.86), (-1.9, 0.88), (-1.45, 0.86), (-0.9, 0.79), (-0.2, 0.765), (0.6, 0.79), (1.42, 0.9), (1.95, 0.84), (2.2, 0.72), (2.36, 0.64)])
ZWIDE = pchip([(-2.36, 0.58), (-1.45, 0.55), (0, 0.5), (1.42, 0.5), (2.36, 0.44)])
ZB = pchip([(-2.36, 0.30), (-2.2, 0.21), (-1.95, 0.17), (1.95, 0.17), (2.2, 0.185), (2.36, 0.22)])

COWL, ROOF_F, ROOF_R, DECK = 0.62, -0.12, -0.55, -1.62  # glass stations
SIDE_END = -1.24                                          # rear tip of the side window
sat = lambda v: min(1.0, max(0.0, v))
def cabin(y):  # 0 on hood / deck, 1 under the roof: ramps along the A and C pillars
    return min(sat((COWL - y) / (COWL - ROOF_F)), sat((y - DECK) / (ROOF_R - DECK)))

def control(y):
    """half cross-section control points, bottom centre -> top centre (x >= 0)"""
    w, zb, zt, zbl, wbl = W(y), ZB(y), ZTOP(y), ZBELT(y), WBELT(y)
    c = cabin(y)
    lo = [(0.0, zb), (w * 0.72, zb), (w * 0.94, zb + 0.035), (w * 0.99, zb + 0.15), (w, ZWIDE(y)), (w - 0.035, ZSH(y))]
    hood = lambda f: (wbl * f, zt + (zbl - zt) * f * f)   # domed hood / deck across the car
    hp = [hood(1.0), hood(0.94), hood(0.87), hood(0.45), (0.0, zt)]
    cp = [(wbl, zbl), (0.665, zt - 0.072), (0.615, zt - 0.04), (0.33, zt - 0.008), (0.0, zt)]
    up = [(a[0] + (b[0] - a[0]) * c, a[1] + (b[1] - a[1]) * c) for a, b in zip(hp, cp)]
    return lo + up   # 11 points, segments 0..9

SEG_N = [3, 2, 3, 4, 4, 4, 5, 2, 3, 4]   # samples per segment
def seg_mat(s, y):
    if s <= 1: return 2                       # underbody: black
    if s == 6 and cabin(y) > 0.01 and y > SIDE_END: return 1   # side glass
    if s >= 8:
        if ROOF_F < y < COWL or DECK < y < ROOF_R: return 1      # windscreen, rear glass
    return 0

def catmull(P, n_per, closed=True):
    """centripetal Catmull-Rom through a closed loop of 2D points; returns samples and the segment index of each"""
    out, segs = [], []
    N = len(P)
    for i in range(N):
        p0, p1, p2, p3 = (np.array(P[(i + k) % N]) for k in (-1, 0, 1, 2))
        def tj(ti, a, b): return ti + max(np.linalg.norm(b - a), 1e-5) ** 0.5
        t0 = 0; t1 = tj(t0, p0, p1); t2 = tj(t1, p1, p2); t3 = tj(t2, p2, p3)
        n = n_per[i]
        for k in range(n):
            t = t1 + (t2 - t1) * k / n
            A1 = (t1 - t) / (t1 - t0) * p0 + (t - t0) / (t1 - t0) * p1
            A2 = (t2 - t) / (t2 - t1) * p1 + (t - t1) / (t2 - t1) * p2
            A3 = (t3 - t) / (t3 - t2) * p2 + (t - t2) / (t3 - t2) * p3
            B1 = (t2 - t) / (t2 - t0) * A1 + (t - t0) / (t2 - t0) * A2
            B2 = (t3 - t) / (t3 - t1) * A2 + (t - t1) / (t3 - t1) * A3
            out.append((t2 - t) / (t2 - t1) * B1 + (t - t1) / (t2 - t1) * B2); segs.append(i)
    return out, segs

def ring(y):
    half = control(y)
    loop = half + [(-x, z) for x, z in reversed(half[1:-1])]   # right half up, left half down
    nper = SEG_N + list(reversed(SEG_N))
    pts, segs = catmull(loop, nper)
    segs = [s if s < 10 else 19 - s for s in segs]                 # mirror segment ids
    return pts, segs

# ---------------- body loft ----------------
def stations():
    ys = set(np.round(np.arange(Y0, Y1 + 1e-6, 0.025), 4).tolist())
    ys |= {COWL, ROOF_F, ROOF_R, DECK, SIDE_END, Y0, Y1}
    # tighter near the ends so the rounded nose / tail corners stay round
    ys |= set(np.round(np.linspace(Y1 - 0.12, Y1, 9), 4).tolist()) | set(np.round(np.linspace(Y0, Y0 + 0.12, 9), 4).tolist())
    return sorted(ys)

def build_body():
    bm = bmesh.new()
    Ys = stations()
    rings = []
    for y in Ys:
        pts, segs = ring(y)
        rings.append(([bm.verts.new((p[0], y, p[1])) for p in pts], segs))
    n = len(rings[0][0])
    for k in range(len(Ys) - 1):
        (a, sa), (b, _) = rings[k], rings[k + 1]
        ym = (Ys[k] + Ys[k + 1]) / 2
        for i in range(n):
            f = bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
            f.material_index = seg_mat(sa[i], ym)
    # end caps: fan from the centre
    for k, nose in ((0, False), (len(Ys) - 1, True)):
        vs = rings[k][0]
        cz = sum(v.co.z for v in vs) / n
        c = bm.verts.new((0, Ys[k], cz))
        for i in range(n):
            tri = (c, vs[i], vs[(i + 1) % n]) if nose else (c, vs[(i + 1) % n], vs[i])
            f = bm.faces.new(tri); f.material_index = 0
    bm.normal_update()
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj('body', bm, ['paint', 'glass', 'black', 'trim'])

body = build_body()

def boolean(target, cutter, op='DIFFERENCE'):
    m = target.modifiers.new('b', 'BOOLEAN'); m.object = cutter; m.operation = op; m.solver = 'EXACT'
    try: m.material_mode = 'TRANSFER'
    except Exception: pass
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

def cylinder(name, r, depth, loc, rot, verts=64, mats=('black',)):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=verts, radius1=r, radius2=r, depth=depth)
    ob = new_obj(name, bm, list(mats))
    ob.location = loc; ob.rotation_euler = rot
    return ob

# wheel arches: one cutter per wheel, from just inside the track to past the flare; its walls become the black wheel well
for y in (AXLE_F, AXLE_R):
    for sx in (1, -1):
        c = cylinder('arch', ARCH_R, 0.75, (sx * (0.6 + 0.375), y, WZ), (0, math.pi / 2, 0))
        boolean(body, c)

# ---------------- surface decals: shapes projected onto the body ----------------
def bvh_of(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.transform(ob.matrix_world)
    t = BVHTree.FromBMesh(bm); bm.free(); return t
BV = bvh_of(body)

def decal(name, poly, origin, u, v, d, matname, off=0.004, cuts=3, thick=0.0):
    """poly: 2D points in the (u, v) plane at origin; projected along d onto the body, lifted by off along the surface normal"""
    bm = bmesh.new()
    O, U, V, D = Vector(origin), Vector(u).normalized(), Vector(v).normalized(), Vector(d).normalized()
    vs = [bm.verts.new(O + U * p[0] + V * p[1]) for p in poly]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(cuts):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for vt in bm.verts:
        hit = BV.ray_cast(vt.co - D * 0.6, D, 3.0)
        if hit[0] is not None:
            vt.co = hit[0] + hit[1] * off
    bm.normal_update()
    # face the decal outwards (same way as the surface under it)
    bm.faces.ensure_lookup_table(); f0 = bm.faces[0]
    hit = BV.find_nearest(f0.calc_center_median())
    if hit[0] is not None and f0.normal.dot(hit[1]) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    if thick:
        ret = bmesh.ops.extrude_face_region(bm, geom=bm.faces[:])
        nv = [g for g in ret['geom'] if isinstance(g, bmesh.types.BMVert)]
        for vt in nv:
            hit = BV.find_nearest(vt.co)
            vt.co += hit[1] * thick
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_obj(name, bm, [matname])

def mirror_x(poly): return [(-x, y) for x, y in reversed(poly)]

FRONT = (0, 3.2, 0)
def front_decal(name, poly, mat_, off=0.004, cuts=3):  # drawn in (x, z) seen from the front, projected backwards
    return decal(name, poly, FRONT, (-1, 0, 0), (0, 0, 1), (0, -1, 0), mat_, off, cuts)
def rear_decal(name, poly, mat_, off=0.004, cuts=3):   # drawn in (x, z) seen from behind (x to the car's right... i.e. +x)
    return decal(name, poly, (0, -3.2, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), mat_, off, cuts)
def side_decal(name, poly, mat_, sx, off=0.004, cuts=3):  # drawn in (y, z) on the +x / -x flank
    return decal(name, poly, (sx * 2.0, 0, 0), (0, 1, 0), (0, 0, 1), (-sx, 0, 0), mat_, off, cuts)
def top_decal(name, poly, mat_, off=0.004, cuts=3):    # drawn in (x, y) from above
    return decal(name, poly, (0, 0, 2.5), (1, 0, 0), (0, 1, 0), (0, 0, -1), mat_, off, cuts)

parts = []
# --- front: angular LED headlights at the corners, a big trapezoid intake, two side intakes, black splitter
for sx in (1, -1):
    hl = [(0.46, 0.665), (0.84, 0.685), (0.87, 0.64), (0.80, 0.585), (0.52, 0.595)]
    hl = [(sx * x, z) for x, z in hl]
    parts.append(front_decal('headlamp', hl if sx < 0 else list(reversed(hl)), 'trim', 0.004))
    for z0, x0, x1 in ((0.648, 0.54, 0.80), (0.618, 0.56, 0.79)):
        bar = [(x0, z0 + 0.008), (x1, z0 + 0.022), (x1, z0 + 0.008), (x0, z0 - 0.006)]
        bar = [(sx * x, z) for x, z in bar]
        parts.append(front_decal('drl', bar if sx < 0 else list(reversed(bar)), 'light_head', 0.008, 2))
intake = [(-0.44, 0.52), (0.44, 0.52), (0.32, 0.23), (-0.32, 0.23)]
parts.append(front_decal('intake', list(reversed(intake)), 'grille', 0.003))
for sx in (1, -1):
    si = [(0.56, 0.52), (0.82, 0.53), (0.80, 0.30), (0.46, 0.26)]
    si = [(sx * x, z) for x, z in si]
    parts.append(front_decal('side_intake', si if sx < 0 else list(reversed(si)), 'grille', 0.003))
# splitter
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
for vt in bm.verts: vt.co = Vector((vt.co.x * 1.62, vt.co.y * 0.42, vt.co.z * 0.035))
sp = new_obj('splitter', bm, ['trim']); sp.location = (0, 2.2, 0.17); parts.append(sp)

# --- hood vents and side vents behind the front wheels
for sx in (1, -1):
    hv = [(0.30, 1.02), (0.50, 1.04), (0.51, 0.92), (0.31, 0.90)]
    hv = [(sx * x, y) for x, y in hv]
    parts.append(top_decal('hood_vent', hv if sx > 0 else list(reversed(hv)), 'grille', 0.003))
    sv = [(0.76, 0.76), (0.86, 0.76), (0.66, 0.40), (0.57, 0.42)]
    parts.append(side_decal('side_vent', sv if sx < 0 else list(reversed(sv)), 'grille', sx, 0.003))
    # door handle
    hd = [(-0.62, 0.755), (-0.48, 0.755), (-0.48, 0.73), (-0.62, 0.73)]
    parts.append(side_decal('handle', hd if sx < 0 else list(reversed(hd)), 'trim', sx, 0.006, 2))

# --- mirrors: a teardrop pod on a short stalk at the base of each A pillar
for sx in (1, -1):
    bm = bmesh.new(); bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=1.0)
    for vt in bm.verts:
        x, y, z = vt.co
        sq = 1 - 0.35 * max(0.0, -y)   # taper towards the back
        vt.co = Vector((x * 0.13 * sq, y * 0.085, z * 0.07 * sq))
    mo = new_obj('mirror', bm, ['trim']); mo.location = (sx * 0.93, 0.40, 1.03); parts.append(mo)
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for vt in bm.verts: vt.co = Vector((vt.co.x * 0.2, vt.co.y * 0.06, vt.co.z * 0.03))
    st = new_obj('mirror_stalk', bm, ['trim']); st.location = (sx * 0.84, 0.41, 0.985); st.rotation_euler = (0, sx * 0.35, 0); parts.append(st)

# --- tail: black band with four ring lights, diffuser, twin turbine thrusters
band = [(-0.80, 0.93), (0.80, 0.93), (0.84, 0.86), (0.80, 0.70), (-0.80, 0.70), (-0.84, 0.86)]
parts.append(rear_decal('tail_band', band, 'trim', 0.003))
for x in (-0.66, -0.44, 0.44, 0.66):
    for r_, mn, th in ((0.072, 'light_tail', 0.016),):
        bm = bmesh.new(); bmesh.ops.create_circle(bm, segments=40, radius=1.0)
        t = new_obj('tail_ring', bm, [mn]); bpy.data.objects.remove(t, do_unlink=True)
        tor = bpy.data.meshes.new('ring')
        bm = bmesh.new()
        segs, rs = 40, 10
        verts = []
        for i in range(segs):
            a = 2 * math.pi * i / segs
            row = []
            for j in range(rs):
                b = 2 * math.pi * j / rs
                rr = r_ + th * math.cos(b)
                row.append(bm.verts.new((rr * math.cos(a), th * math.sin(b) * 1.4, rr * math.sin(a))))
            verts.append(row)
        for i in range(segs):
            for j in range(rs):
                bm.faces.new((verts[i][j], verts[(i + 1) % segs][j], verts[(i + 1) % segs][(j + 1) % rs], verts[i][(j + 1) % rs]))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
        ob = new_obj('tail_ring', bm, [mn]); ob.location = (x, -2.372, 0.815); parts.append(ob)
    # dark lens in the middle of each ring
    bm = bmesh.new(); bmesh.ops.create_circle(bm, cap_ends=True, segments=32, radius=0.062)
    for vt in bm.verts: vt.co = Vector((vt.co.x, 0, vt.co.y))
    ob = new_obj('tail_lens', bm, ['glass']); ob.location = (x, -2.366, 0.815); ob.rotation_euler = (0, 0, math.pi); parts.append(ob)

# diffuser: a black block under the tail, open in the middle for the turbines, with fins
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
for vt in bm.verts: vt.co = Vector((vt.co.x * 1.7, vt.co.y * 0.36, vt.co.z * 0.2))
df = new_obj('diffuser', bm, ['trim']); df.location = (0, -2.22, 0.26); parts.append(df)
for sx in (1, -1):
    gi = [(sx * 0.58, 0.55), (sx * 0.86, 0.55), (sx * 0.88, 0.36), (sx * 0.62, 0.36)]
    parts.append(rear_decal('rear_vent', gi if sx > 0 else list(reversed(gi)), 'grille', 0.003))

TURB_X, TURB_Z, TURB_R = 0.30, 0.37, 0.165
TURB_EXIT = -2.56
for sx in (1, -1):
    x = sx * TURB_X
    # casing: a lathe profile (r, y) from intake end to exit lip
    prof = [(0.0, -2.05), (TURB_R * 0.92, -2.08), (TURB_R, -2.16), (TURB_R, -2.44), (TURB_R * 1.06, -2.47), (TURB_R * 1.06, -2.53),
            (TURB_R * 0.98, TURB_EXIT), (TURB_R * 0.86, TURB_EXIT + 0.01), (TURB_R * 0.86, -2.4)]
    bm = bmesh.new(); segs = 48; rows = []
    for r_, y_ in prof:
        rows.append([bm.verts.new((x + r_ * math.cos(2 * math.pi * i / segs), y_, TURB_Z + r_ * math.sin(2 * math.pi * i / segs))) for i in range(segs)])
    for k in range(len(rows) - 1):
        for i in range(segs):
            bm.faces.new((rows[k][i], rows[k][(i + 1) % segs], rows[k + 1][(i + 1) % segs], rows[k + 1][i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_obj('turbine', bm, ['darkmetal']); parts.append(ob)
    # banded rings on the casing
    for yb in (-2.22, -2.32):
        c = cylinder('turbine_band', TURB_R * 1.035, 0.03, (x, yb, TURB_Z), (math.pi / 2, 0, 0), 48, ('metal',)); parts.append(c)
    # fan: hub cone plus 14 twisted blades just inside the exit
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.055, radius2=0.012, depth=0.09)
    hub = new_obj('turbine_hub', bm, ['metal']); hub.location = (x, -2.46, TURB_Z); hub.rotation_euler = (math.pi / 2, 0, 0); parts.append(hub)
    for b in range(14):
        a = 2 * math.pi * b / 14
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for vt in bm.verts: vt.co = Vector((vt.co.x * 0.006, vt.co.y * 0.05, vt.co.z * (TURB_R * 0.8)))
        bl = new_obj('blade', bm, ['metal'])
        bl.location = (x + math.cos(a) * TURB_R * 0.45, -2.43, TURB_Z + math.sin(a) * TURB_R * 0.45)
        bl.rotation_euler = (0, -(a - math.pi / 2), 0)
        bl.rotation_mode = 'XYZ'
        bl.matrix_world = Matrix.Translation(bl.location) @ Matrix.Rotation(-(a - math.pi / 2), 4, 'Y') @ Matrix.Rotation(0.5, 4, 'Z')
        parts.append(bl)

# --- ducktail lip: a thin wing of paint following the rear deck edge, kicked up
lip = []
bm = bmesh.new()
xs = np.linspace(-0.86, 0.86, 41)
rows = []
for x in xs:
    zt = ZTOP(-2.30) - 0.09 * (abs(x) / 0.86) ** 2 + 0.01
    sect = [(-2.22, zt - 0.005), (-2.33, zt + 0.012), (-2.42, zt + 0.04), (-2.425, zt + 0.025), (-2.34, zt - 0.03), (-2.24, zt - 0.03)]
    rows.append([bm.verts.new((x, y, z)) for y, z in sect])
for k in range(len(rows) - 1):
    for i in range(len(rows[0])):
        bm.faces.new((rows[k][i], rows[k][(i + 1) % len(rows[0])], rows[k + 1][(i + 1) % len(rows[0])], rows[k + 1][i]))
for row, rev in ((rows[0], False), (rows[-1], True)):
    f = bm.faces.new(list(reversed(row)) if rev else row)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
parts.append(new_obj('ducktail', bm, ['paint']))

# ---------------- finish: shading, join by material-friendly objects ----------------
for ob in [body] + parts:
    if ob.type != 'MESH': continue
    for p in ob.data.polygons: p.use_smooth = True
    try: ob.data.set_sharp_from_angle(angle=math.radians(40))
    except Exception: pass

bpy.ops.object.select_all(action='DESELECT')
for ob in parts: ob.select_set(True)
body.select_set(True); bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
car = body; car.name = 'bastion2'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tris = sum(len(p.vertices) - 2 for p in car.data.polygons)
print('TRIS', tris)
bb = [car.matrix_world @ Vector(c) for c in car.bound_box]
print('BBOX x %.3f..%.3f  y %.3f..%.3f  z %.3f..%.3f' % (min(v.x for v in bb), max(v.x for v in bb), min(v.y for v in bb), max(v.y for v in bb), min(v.z for v in bb), max(v.z for v in bb)))
print('KIT rear [[%.2f, %.2f, %.2f], [%.2f, %.2f, %.2f]]' % (-TURB_X, TURB_Z, -TURB_EXIT, TURB_X, TURB_Z, -TURB_EXIT))

# ---------------- preview renders (with stand-in wheels) ----------------
if PNG:
    os.makedirs(PNG, exist_ok=True)
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 1100, 620
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.8, 0.82, 0.85, 1)
    w.node_tree.nodes['Background'].inputs[1].default_value = 0.9
    tmp = []
    tyre = mat('tyre', (0.02, 0.02, 0.02), 0.9)
    for y in (AXLE_F, AXLE_R):
        for sx in (1, -1):
            bpy.ops.mesh.primitive_cylinder_add(radius=WHEEL_R, depth=0.3, location=(sx * 0.92, y, WZ), rotation=(0, math.pi / 2, 0))
            o = bpy.context.object; o.data.materials.append(tyre); tmp.append(o)
    bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0)); fl = bpy.context.object
    fl.data.materials.append(mat('floor', (0.5, 0.5, 0.52), 0.6)); tmp.append(fl)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); tmp.append(sun)
    sun.data.energy = 3.5; sun.rotation_euler = (0.6, 0.2, 0.9)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; tmp.append(cam)
    cam.data.lens = 50
    views = [('front34', (-4.2, 6.0, 1.9)), ('rear34', (4.4, -6.0, 2.1)), ('side', (8.5, 0, 0.75)), ('front', (0, 8.5, 0.8)),
             ('rear', (0, -8.5, 0.9)), ('top', (0, 0.001, 9.5))]
    for name, loc in views:
        cam.location = loc
        d = Vector((0, 0, 0.6)) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PNG, name + '.png')
        bpy.ops.render.render(write_still=True)
    for o in tmp: bpy.data.objects.remove(o, do_unlink=True)

if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
bpy.ops.object.select_all(action='DESELECT'); car.select_set(True)
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
print('WROTE', DST)
