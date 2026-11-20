# model_comet2.py: COMET v2, modelled from scratch in Blender after models/source/comet_concept.png.
#   blender -b -P tools/model_comet2.py -- models/comet2.glb [--renders <dir>] [--blend models/source/comet2.blend]
# Open two-seat roadster: smooth lofted body whose fenders rise above a valley hood, boolean wheel arches and cockpit tub,
# seats, twin head fairings, wraparound windscreen, full-width light strips front and back, two recessed round nozzles.
# Game frame after glTF export: front -Z, up +Y. Here (Blender): front +Y, up +Z, ground z = 0.
# Wheels are not modelled: the game adds its own on the physics wheels (axles at y +1.42 / -1.45, centre z = wheelR - 0.01).
# Material names are what js/car.js keys on: paint, glass, light_head, light_tail; everything else keeps its own PBR material.
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DST = argv[0] if argv else 'comet2.glb'
opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
PNG, BLEND = opt('--renders'), opt('--blend')

WHEEL_R = 0.46                 # js kit.wheelR
AXLE_F, AXLE_R = 1.42, -1.45   # physics wheel stations (y)
WZ = WHEEL_R - 0.01            # wheel centre height
ARCH_R = 0.505

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

Y0, Y1 = -2.30, 2.32   # tail, nose
# centre-line top: low wedge nose, hood climbing to the cowl, cockpit (cut out later), flat rear deck, small kicked lip
ZTOP = pchip([(-2.30, 0.84), (-2.24, 0.905), (-2.1, 0.915), (-1.6, 0.915), (-0.9, 0.905), (-0.2, 0.9), (0.45, 0.885),
              (1.0, 0.82), (1.6, 0.74), (2.05, 0.665), (2.32, 0.62)])
# fender crown line: rises above the hood over both wheels, dips along the doors
ZBELT = pchip([(-2.30, 0.84), (-2.2, 0.93), (-1.95, 0.99), (-1.45, 1.025), (-0.9, 0.975), (-0.3, 0.935), (0.35, 0.94),
               (0.95, 0.985), (1.42, 1.0), (1.85, 0.9), (2.15, 0.74), (2.32, 0.63)])
WBELT = pchip([(-2.30, 0.78), (-2.15, 0.84), (-1.45, 0.89), (-0.6, 0.85), (0.3, 0.83), (1.42, 0.88), (2.05, 0.82), (2.22, 0.75), (2.32, 0.68)])
W = pchip([(-2.30, 0.90), (-2.2, 0.98), (-1.9, 1.04), (-1.45, 1.07), (-0.9, 1.035), (-0.2, 0.99), (0.5, 1.0),
           (1.0, 1.04), (1.42, 1.06), (1.8, 1.03), (2.05, 0.97), (2.22, 0.88), (2.32, 0.78)])
ZSH = pchip([(-2.30, 0.78), (-1.9, 0.86), (-1.45, 0.88), (-0.8, 0.80), (0.0, 0.77), (0.8, 0.82), (1.42, 0.87), (1.95, 0.76), (2.32, 0.58)])
ZWIDE = pchip([(-2.30, 0.56), (-1.45, 0.56), (0, 0.52), (1.42, 0.52), (2.32, 0.46)])
ZB = pchip([(-2.30, 0.30), (-2.15, 0.21), (-1.9, 0.17), (1.9, 0.17), (2.15, 0.2), (2.32, 0.25)])

COWL, ROOF_F, ROOF_R, DECK, SIDE_END = 0.45, 0.0, -0.8, -1.6, -1.2   # extra loft stations only (no roof on a roadster)
def control(y):
    """half cross-section control points, bottom centre -> top centre (x >= 0)"""
    w, zb, zt, zbl, wbl = W(y), ZB(y), ZTOP(y), ZBELT(y), WBELT(y)
    lo = [(0.0, zb), (w * 0.72, zb), (w * 0.94, zb + 0.035), (w * 0.99, zb + 0.15), (w, ZWIDE(y)), (w - 0.03, ZSH(y))]
    # crown of the fender at wbl, then the hood / deck falls to the centre line (a valley where the fenders stand proud)
    def hood(f):
        k = (1 - (1 - f) ** 2) if zbl > zt else f * f
        return (wbl * f, zt + (zbl - zt) * k)
    hp = [(wbl + (w - 0.03 - wbl) * 0.35, zbl - 0.02), hood(1.0), hood(0.8), hood(0.45), (0.0, zt)]
    return lo + hp   # 11 points, segments 0..9

SEG_N = [3, 2, 3, 4, 4, 3, 3, 3, 4, 4]
def seg_mat(s, y):
    return 2 if s <= 1 else 0

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


BV = bvh_of(body)
def surf_z(x, y):
    hit = BV.ray_cast(Vector((x, y, 3.0)), Vector((0, 0, -1)), 5.0)
    return hit[0].z if hit[0] is not None else ZTOP(y)

# ---------------- cockpit: a superellipse tub cut into the body, black inside ----------------
CK_Y, CK_HL, CK_HW, CK_E = -0.22, 0.64, 0.68, 3.2     # centre, half length, half width (top view), squareness
def ck_point(t, grow=0.0):
    c, s = math.cos(t), math.sin(t)
    return (math.copysign(abs(c) ** (2 / CK_E), c) * (CK_HW + grow), CK_Y + math.copysign(abs(s) ** (2 / CK_E), s) * (CK_HL + grow))
bm = bmesh.new()
outline = [ck_point(2 * math.pi * i / 72) for i in range(72)]
lo = [bm.verts.new((x, y, 0.42)) for x, y in outline]
hi = [bm.verts.new((x, y, 1.8)) for x, y in outline]
n = len(lo)
for i in range(n):
    bm.faces.new((lo[i], lo[(i + 1) % n], hi[(i + 1) % n], hi[i]))
bm.faces.new(list(reversed(lo))); bm.faces.new(hi)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
boolean(body, new_obj('cockpit', bm, ['black']))
BV = bvh_of(body)

parts = []
def box(name, size, loc, rot=(0, 0, 0), m='trim'):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for vt in bm.verts: vt.co = Vector((vt.co.x * size[0], vt.co.y * size[1], vt.co.z * size[2]))
    bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(size) * 0.25, segments=2, affect='EDGES')
    ob = new_obj(name, bm, [m]); ob.location = loc; ob.rotation_euler = rot; parts.append(ob); return ob

# seats: cushion + raked backrest, a centre console and the dash
for sx in (1, -1):
    box('seat', (0.42, 0.46, 0.1), (sx * 0.33, -0.28, 0.5))
    box('seat_back', (0.44, 0.1, 0.62), (sx * 0.33, -0.66, 0.8), (0.28, 0, 0))
box('console', (0.16, 0.9, 0.18), (0, -0.1, 0.52))
box('dash', (1.2, 0.18, 0.12), (0, 0.33, 0.8), (-0.3, 0, 0), 'black')

# head fairings: two painted humps behind the seats running back into the deck
for sx in (1, -1):
    bm = bmesh.new(); rows = []
    for y in np.linspace(-0.8, -1.95, 24):
        t = (y + 0.8) / -1.15                                   # 0 at the front, 1 at the tail end
        h = 0.40 * (1 - t ** 1.6)                               # height above the deck
        a = 0.17 * (1 - 0.45 * t)                               # half width
        zb = surf_z(sx * 0.33, y)
        row = []
        for k in range(17):
            ang = math.pi * k / 16
            row.append(bm.verts.new((sx * 0.33 + a * math.cos(ang), y, zb - 0.06 + (max(h, 0.003) + 0.06) * math.sin(ang))))
        rows.append(row)
    for k in range(len(rows) - 1):
        for i in range(16):
            bm.faces.new((rows[k][i], rows[k][i + 1], rows[k + 1][i + 1], rows[k + 1][i]))
    bm.faces.new(rows[0])                                       # flat front face
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    parts.append(new_obj('fairing', bm, ['paint']))

# wraparound windscreen: a raked glass band around the front of the cockpit, with a slim black frame on top
def screen():
    bm = bmesh.new(); bot, top = [], []
    N = 40
    for i in range(N + 1):
        t = -0.1 * math.pi + (1.2 * math.pi) * i / N             # front half of the outline, wrapping a little round the sides
        x, y = ck_point(t, 0.05)
        front = max(0.0, math.sin(t))
        h = 0.07 + 0.25 * front ** 0.6
        z = surf_z(x, y) - 0.01
        nx = x / (CK_HW + 0.05)
        bot.append(bm.verts.new((x, y, z)))
        top.append(bm.verts.new((x - nx * 0.05 * front, y - 0.75 * h, z + h)))
    for i in range(N):
        bm.faces.new((bot[i], bot[i + 1], top[i + 1], top[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    tops = [v.co.copy() for v in top]
    ob = new_obj('windscreen', bm, ['glass'])
    mo = ob.modifiers.new('s', 'SOLIDIFY'); mo.thickness = 0.012
    bpy.context.view_layer.objects.active = ob; bpy.ops.object.modifier_apply(modifier=mo.name)
    parts.append(ob)
    cu = bpy.data.curves.new('frame', 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = 0.011; cu.bevel_resolution = 2
    sp_ = cu.splines.new('POLY'); sp_.points.add(len(tops) - 1)
    for p, v in zip(sp_.points, tops): p.co = (v.x, v.y, v.z, 1)
    fo = bpy.data.objects.new('frame', cu); sc.collection.objects.link(fo)
    bpy.ops.object.select_all(action='DESELECT'); fo.select_set(True); bpy.context.view_layer.objects.active = fo
    bpy.ops.object.convert(target='MESH'); fo = bpy.context.view_layer.objects.active
    fo.data.materials.clear(); fo.data.materials.append(M['trim']); parts.append(fo)
screen()

# --- front: full-width LED strip with a shallow V in a black bezel, black lower intakes, splitter
bezel = [(-0.8, 0.52), (-0.3, 0.50), (0.0, 0.49), (0.3, 0.50), (0.8, 0.52), (0.8, 0.565), (0.0, 0.575), (-0.8, 0.565)]
parts.append(front_decal('strip_bezel', list(reversed(bezel)), 'trim', 0.003, 3))
strip = [(-0.78, 0.552), (-0.3, 0.538), (0.0, 0.53), (0.3, 0.538), (0.78, 0.552),
         (0.78, 0.540), (0.3, 0.526), (0.0, 0.518), (-0.3, 0.526), (-0.78, 0.540)]
parts.append(front_decal('headlight_strip', list(reversed(strip)), 'light_head', 0.007, 3))
intake = [(-0.5, 0.42), (0.5, 0.42), (0.4, 0.27), (-0.4, 0.27)]
parts.append(front_decal('intake', list(reversed(intake)), 'grille', 0.003))
for sx in (1, -1):
    si = [(0.58, 0.46), (0.76, 0.48), (0.74, 0.29), (0.64, 0.28), (0.55, 0.38)]
    si = [(sx * x, z) for x, z in si]
    parts.append(front_decal('corner_intake', si if sx < 0 else list(reversed(si)), 'grille', 0.003))
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
for vt in bm.verts: vt.co = Vector((vt.co.x * 1.6, vt.co.y * 0.4, vt.co.z * 0.03))
spl = new_obj('splitter', bm, ['trim']); spl.location = (0, 2.17, 0.175); parts.append(spl)

# --- sides: black rocker between the wheels
for sx in (1, -1):
    rk = [(-0.95, 0.29), (0.92, 0.29), (0.92, 0.215), (-0.95, 0.215)]
    parts.append(side_decal('rocker', rk if sx < 0 else list(reversed(rk)), 'trim', sx, 0.003))

# --- tail: full-width light strip in a black bezel, black rear panel, two recessed round nozzles
bz = [(-0.86, 0.835), (0.86, 0.835), (0.86, 0.75), (-0.86, 0.75)]
parts.append(rear_decal('tail_bezel', bz, 'trim', 0.003))
tl = [(-0.84, 0.80), (0.84, 0.80), (0.84, 0.78), (-0.84, 0.78)]
parts.append(rear_decal('tail_strip', tl, 'light_tail', 0.007))
panel = [(-0.80, 0.64), (0.80, 0.64), (0.74, 0.22), (-0.74, 0.22)]
parts.append(rear_decal('rear_panel', panel, 'trim', 0.003))
bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
for vt in bm.verts: vt.co = Vector((vt.co.x * 1.5, vt.co.y * 0.3, vt.co.z * 0.03))
dfo = new_obj('diffuser', bm, ['trim']); dfo.location = (0, -2.2, 0.2); parts.append(dfo)

NOZ_X, NOZ_Z, NOZ_R, NOZ_EXIT = 0.36, 0.43, 0.135, -2.33
for sx in (1, -1):
    x = sx * NOZ_X
    prof = [(NOZ_R * 0.8, -2.0), (NOZ_R, -2.05), (NOZ_R, -2.26), (NOZ_R * 1.12, -2.29), (NOZ_R * 1.12, NOZ_EXIT),
            (NOZ_R * 0.84, NOZ_EXIT + 0.005), (NOZ_R * 0.8, -2.12)]
    bm = bmesh.new(); segs = 48; rows = []
    for r_, y_ in prof:
        rows.append([bm.verts.new((x + r_ * math.cos(2 * math.pi * i / segs), y_, NOZ_Z + r_ * math.sin(2 * math.pi * i / segs))) for i in range(segs)])
    for k in range(len(rows) - 1):
        for i in range(segs):
            bm.faces.new((rows[k][i], rows[k][(i + 1) % segs], rows[k + 1][(i + 1) % segs], rows[k + 1][i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    parts.append(new_obj('nozzle', bm, ['darkmetal']))
    parts.append(cylinder('nozzle_back', NOZ_R * 0.8, 0.01, (x, -2.12, NOZ_Z), (math.pi / 2, 0, 0), 48, ('grille',)))
    for b in range(8):   # vanes inside the bore
        a = 2 * math.pi * b / 8
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for vt in bm.verts: vt.co = Vector((vt.co.x * 0.008, vt.co.y * 0.06, vt.co.z * NOZ_R * 0.78))
        bl = new_obj('vane', bm, ['trim'])
        bl.matrix_world = Matrix.Translation((x + math.cos(a) * NOZ_R * 0.4, -2.17, NOZ_Z + math.sin(a) * NOZ_R * 0.4)) @ Matrix.Rotation(-(a - math.pi / 2), 4, 'Y') @ Matrix.Rotation(0.45, 4, 'Z')
        parts.append(bl)
print('KIT rear [[%.2f, %.2f, %.2f], [%.2f, %.2f, %.2f]]  sideX %.2f' % (-NOZ_X, NOZ_Z, -NOZ_EXIT, NOZ_X, NOZ_Z, -NOZ_EXIT, W(0)))

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
car = body; car.name = 'comet2'
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
tris = sum(len(p.vertices) - 2 for p in car.data.polygons)
print('TRIS', tris)
bb = [car.matrix_world @ Vector(c) for c in car.bound_box]
print('BBOX x %.3f..%.3f  y %.3f..%.3f  z %.3f..%.3f' % (min(v.x for v in bb), max(v.x for v in bb), min(v.y for v in bb), max(v.y for v in bb), min(v.z for v in bb), max(v.z for v in bb)))

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
