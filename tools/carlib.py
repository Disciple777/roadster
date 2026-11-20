# carlib.py: shared Blender helpers for the hand-modelled cars (tools/model_*.py written after COMET v2).
# A car script does:  import sys, os; sys.path.insert(0, os.path.dirname(__file__)); from carlib import *
# then builds a body with loft(), cuts arches / cockpits with boolean(), adds parts and calls finish().
# Frame: front +Y, up +Z, ground z = 0 (the glTF export turns this into the game's front -Z, up +Y).
# Wheels are not modelled: the game adds its own on the physics wheels (axles at y +1.42 / -1.45).
# Material names that js/car.js swaps for its own: paint, glass, light_head, light_tail.
import bpy, bmesh, math, sys, os
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

AXLE_F, AXLE_R = 1.42, -1.45

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
DST = argv[0] if argv else 'car.glb'
opt = lambda k: argv[argv.index(k) + 1] if k in argv else None
PNG, BLEND = opt('--renders'), opt('--blend')

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
    'rubber': mat('rubber', (0.012, 0.012, 0.013), 0.85, 0.0),
    'light_head': mat('light_head', (1, 1, 1), 0.2, 0, (1, 1, 1.05), 6),
    'light_tail': mat('light_tail', (0.8, 0.02, 0.02), 0.3, 0, (1, 0.02, 0.03), 5),
    'amber': mat('amber', (0.9, 0.4, 0.03), 0.3, 0, (1, 0.45, 0.04), 3),
}

parts = []

def new_obj(name, bm, mats):
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(M[m])
    ob = bpy.data.objects.new(name, me); sc.collection.objects.link(ob)
    return ob

def add(ob):
    parts.append(ob); return ob

# ---------------- 1D profile curves (monotone cubic, no overshoot) ----------------
def pchip(pts):
    pts = sorted(pts)
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

sat = lambda v: min(1.0, max(0.0, v))
lerp = lambda a, b, t: a + (b - a) * t

def catmull(P, n_per):
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

# ---------------- lofted body ----------------
def loft(name, control, seg_n, seg_mat, y0, y1, extra=(), step=0.025, mats=('paint', 'glass', 'black', 'trim'), x0=0.0, z_shift=None):
    """control(y) -> half section, bottom centre -> top centre (x >= 0); seg_n samples per segment;
    seg_mat(segment, y) -> material index. Rings are mirrored across x = 0 (or x0) and joined along y, ends capped."""
    K = len(seg_n)
    def ring(y):
        half = control(y)
        loop = half + [(-x, z) for x, z in reversed(half[1:-1])]
        pts, segs = catmull(loop, list(seg_n) + list(reversed(seg_n)))
        return pts, [s if s < K else 2 * K - 1 - s for s in segs]
    ys = set(np.round(np.arange(y0, y1 + 1e-6, step), 4).tolist()) | set(extra) | {y0, y1}
    ys |= set(np.round(np.linspace(y1 - 0.12, y1, 9), 4).tolist()) | set(np.round(np.linspace(y0, y0 + 0.12, 9), 4).tolist())
    Ys = sorted(ys)
    bm = bmesh.new(); rings = []
    for y in Ys:
        pts, segs = ring(y)
        rings.append(([bm.verts.new((x0 + p[0], y, p[1])) for p in pts], segs))
    n = len(rings[0][0])
    for k in range(len(Ys) - 1):
        (a, sa), (b, _) = rings[k], rings[k + 1]
        ym = (Ys[k] + Ys[k + 1]) / 2
        for i in range(n):
            f = bm.faces.new((a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]))
            f.material_index = seg_mat(sa[i], ym)
    for k, nose in ((0, False), (len(Ys) - 1, True)):
        vs = rings[k][0]
        cz = sum(v.co.z for v in vs) / n
        c = bm.verts.new((x0, Ys[k], cz))
        for i in range(n):
            f = bm.faces.new((c, vs[i], vs[(i + 1) % n]) if nose else (c, vs[(i + 1) % n], vs[i])); f.material_index = 0
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_obj(name, bm, list(mats))

def section_loft(name, sections, mats, closed_ends=True, mat_of=None):
    """sections: list of closed loops of 3D points, all the same length, joined in order"""
    bm = bmesh.new(); rows = [[bm.verts.new(p) for p in s] for s in sections]
    n = len(rows[0])
    for k in range(len(rows) - 1):
        for i in range(n):
            f = bm.faces.new((rows[k][i], rows[k][(i + 1) % n], rows[k + 1][(i + 1) % n], rows[k + 1][i]))
            if mat_of: f.material_index = mat_of(k, i)
    if closed_ends:
        bm.faces.new(rows[0]); bm.faces.new(list(reversed(rows[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return new_obj(name, bm, list(mats))

def boolean(target, cutter, op='DIFFERENCE'):
    m = target.modifiers.new('b', 'BOOLEAN'); m.object = cutter; m.operation = op; m.solver = 'EXACT'
    try: m.material_mode = 'TRANSFER'
    except Exception: pass
    bpy.context.view_layer.objects.active = target
    bpy.ops.object.modifier_apply(modifier=m.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

def cylinder(name, r, depth, loc, rot, verts=64, mats=('black',), r2=None, caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=verts, radius1=r, radius2=r if r2 is None else r2, depth=depth)
    ob = new_obj(name, bm, list(mats))
    ob.location = loc; ob.rotation_euler = rot
    return ob

def arches(body, wz, r, x_in=0.6, depth=0.75):
    """one cylinder cutter per wheel, from just inside the track outwards; its walls become the wheel well"""
    for y in (AXLE_F, AXLE_R):
        for sx in (1, -1):
            boolean(body, cylinder('arch', r, depth, (sx * (x_in + depth / 2), y, wz), (0, math.pi / 2, 0)))

def box(name, size, loc, rot=(0, 0, 0), m='trim', bevel=0.25, keep=True):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
    for vt in bm.verts: vt.co = Vector((vt.co.x * size[0], vt.co.y * size[1], vt.co.z * size[2]))
    if bevel: bmesh.ops.bevel(bm, geom=bm.edges[:], offset=min(size) * bevel, segments=2, affect='EDGES')
    ob = new_obj(name, bm, [m]); ob.location = loc; ob.rotation_euler = rot
    if keep: parts.append(ob)
    return ob

def tube(name, pts, r, m='trim', res=3, keep=True, closed=False):
    """a round tube along a polyline (a bevelled curve turned into a mesh)"""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'; cu.bevel_depth = r; cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
    for p, v in zip(sp.points, pts): p.co = (v[0], v[1], v[2], 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu); sc.collection.objects.link(ob)
    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
    bpy.ops.object.convert(target='MESH'); ob = bpy.context.view_layer.objects.active
    ob.data.materials.clear(); ob.data.materials.append(M[m])
    if keep: parts.append(ob)
    return ob

def bezier_pts(ctrl, n=12):
    """smooth path through control points (Catmull-Rom, open), for bent tubes"""
    P = [np.array(c, float) for c in ctrl]
    P = [P[0] * 2 - P[1]] + P + [P[-1] * 2 - P[-2]]
    out = []
    for i in range(1, len(P) - 2):
        p0, p1, p2, p3 = P[i - 1], P[i], P[i + 1], P[i + 2]
        for k in range(n):
            t = k / n
            out.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
    out.append(P[-2])
    return [tuple(p) for p in out]

def lathe(name, prof, centre, axis='y', segs=48, m='darkmetal', keep=True, cap=False):
    """revolve (radius, along) pairs round an axis through centre; 'y' points along the car"""
    cx, cy, cz = centre
    bm = bmesh.new(); rows = []
    for r_, a_ in prof:
        row = []
        for i in range(segs):
            c, s = math.cos(2 * math.pi * i / segs) * r_, math.sin(2 * math.pi * i / segs) * r_
            row.append(bm.verts.new((cx + c, cy + a_, cz + s) if axis == 'y' else (cx + a_, cy + c, cz + s) if axis == 'x' else (cx + c, cy + s, cz + a_)))
        rows.append(row)
    for k in range(len(rows) - 1):
        for i in range(segs):
            bm.faces.new((rows[k][i], rows[k][(i + 1) % segs], rows[k + 1][(i + 1) % segs], rows[k + 1][i]))
    if cap: bm.faces.new(rows[-1])
    bmesh.ops.remove_doubles(bm, verts=bm.verts[:], dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_obj(name, bm, [m])
    if keep: parts.append(ob)
    return ob

def nozzle(x, z, r, exit_y, depth=0.3, vanes=8, lip=1.12, m='darkmetal', back=True):
    """a round rear thruster: a bell open to the back with a flared lip, a dark back plate and turbine vanes inside"""
    y_in = exit_y + depth
    prof = [(r * 0.8, y_in + 0.02), (r, y_in - 0.03), (r, exit_y + 0.07), (r * lip, exit_y + 0.04), (r * lip, exit_y),
            (r * 0.84, exit_y + 0.005), (r * 0.8, exit_y + 0.21)]
    lathe('nozzle', prof, (x, 0, z), m=m)
    if back: add(cylinder('nozzle_back', r * 0.8, 0.01, (x, exit_y + 0.21, z), (math.pi / 2, 0, 0), 48, ('grille',)))
    for b in range(vanes):
        a = 2 * math.pi * b / vanes
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for vt in bm.verts: vt.co = Vector((vt.co.x * 0.008, vt.co.y * 0.06, vt.co.z * r * 0.78))
        bl = new_obj('vane', bm, ['trim'])
        bl.matrix_world = Matrix.Translation((x + math.cos(a) * r * 0.4, exit_y + 0.16, z + math.sin(a) * r * 0.4)) @ Matrix.Rotation(-(a - math.pi / 2), 4, 'Y') @ Matrix.Rotation(0.45, 4, 'Z')
        add(bl)

# ---------------- surface decals: shapes projected onto a target mesh ----------------
BV = None
def bvh_of(ob):
    bm = bmesh.new(); bm.from_mesh(ob.data); bm.transform(ob.matrix_world)
    t = BVHTree.FromBMesh(bm); bm.free(); return t

def refresh(ob):
    global BV
    BV = bvh_of(ob)

def refresh_many(obs):
    """BVH over several objects at once (body + separate panels such as side pods)"""
    global BV
    bm = bmesh.new()
    for ob in obs:
        tmp = bmesh.new(); tmp.from_mesh(ob.data); tmp.transform(ob.matrix_world)
        me = bpy.data.meshes.new('_t'); tmp.to_mesh(me); tmp.free(); bm.from_mesh(me); bpy.data.meshes.remove(me)
    BV = BVHTree.FromBMesh(bm); bm.free()

def surf_z(x, y, default=0.0):
    hit = BV.ray_cast(Vector((x, y, 4.0)), Vector((0, 0, -1)), 6.0)
    return hit[0].z if hit[0] is not None else default

def surf_x(y, z, sx=1, default=0.0):
    hit = BV.ray_cast(Vector((sx * 3.0, y, z)), Vector((-sx, 0, 0)), 6.0)
    return abs(hit[0].x) if hit[0] is not None else default

def surf_y(x, z, front=True, default=0.0):
    s = 1 if front else -1
    hit = BV.ray_cast(Vector((x, s * 4.0, z)), Vector((0, -s, 0)), 8.0)
    return hit[0].y if hit[0] is not None else default

def decal(name, poly, origin, u, v, d, matname, off=0.004, cuts=3, thick=0.0):
    bm = bmesh.new()
    O, U, V, D = Vector(origin), Vector(u).normalized(), Vector(v).normalized(), Vector(d).normalized()
    vs = [bm.verts.new(O + U * p[0] + V * p[1]) for p in poly]
    bm.faces.new(vs)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for _ in range(cuts):
        bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=1, use_grid_fill=True)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    for vt in bm.verts:
        hit = BV.ray_cast(vt.co - D * 0.6, D, 4.0)
        if hit[0] is not None:
            vt.co = hit[0] + hit[1] * off
    bm.normal_update()
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
    ob = new_obj(name, bm, [matname]); parts.append(ob); return ob

def _wind(poly, want_ccw):
    a = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
    return poly if (a > 0) == want_ccw else list(reversed(poly))
# each takes its 2D polygon in any winding; the decal is turned to face outwards from the surface
def front_decal(name, poly, m, off=0.004, cuts=3, thick=0.0):   # (x, z) seen from the front, projected backwards
    return decal(name, poly, (0, 4.0, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0), m, off, cuts, thick)
def rear_decal(name, poly, m, off=0.004, cuts=3, thick=0.0):    # (x, z) seen from behind, projected forwards
    return decal(name, poly, (0, -4.0, 0), (1, 0, 0), (0, 0, 1), (0, 1, 0), m, off, cuts, thick)
def side_decal(name, poly, m, sx, off=0.004, cuts=3, thick=0.0):  # (y, z) on the +x / -x flank
    return decal(name, poly, (sx * 2.5, 0, 0), (0, 1, 0), (0, 0, 1), (-sx, 0, 0), m, off, cuts, thick)
def top_decal(name, poly, m, off=0.004, cuts=3, thick=0.0):     # (x, y) from above
    return decal(name, poly, (0, 0, 3.5), (1, 0, 0), (0, 1, 0), (0, 0, -1), m, off, cuts, thick)
def both_sides(fn, poly_right, *a, **k):
    """call a front/rear/top decal for a shape drawn on the +x side and its mirror"""
    fn(*((poly_right,) + a), **k); fn(*(([(-x, y) for x, y in poly_right],) + a), **k)

def rounded(poly, r=0.05, n=4):
    """round the corners of a convex polygon"""
    out = []
    N = len(poly)
    for i in range(N):
        p0, p1, p2 = (np.array(poly[(i + k) % N], float) for k in (-1, 0, 1))
        a, b = p0 - p1, p2 - p1
        la, lb = np.linalg.norm(a), np.linalg.norm(b)
        rr = min(r, la * 0.45, lb * 0.45)
        s, e = p1 + a / la * rr, p1 + b / lb * rr
        for k in range(n + 1):
            t = k / n
            out.append(tuple((1 - t) ** 2 * s + 2 * (1 - t) * t * p1 + t * t * e))
    return out

def ellipse(cx, cy, rx, ry, n=32):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]

# ---------------- finish: shading, join, renders, export ----------------
def finish(body, name, wheel_r, wheel_x, wheel_w=0.3, rear=None, side=None, cam_h=1.0):
    for ob in [body] + parts:
        if ob.type != 'MESH': continue
        for p in ob.data.polygons: p.use_smooth = True
        try: ob.data.set_sharp_from_angle(angle=math.radians(40))
        except Exception: pass
    bpy.ops.object.select_all(action='DESELECT')
    for ob in parts: ob.select_set(True)
    body.select_set(True); bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    car = body; car.name = name
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    print('TRIS', sum(len(p.vertices) - 2 for p in car.data.polygons))
    bb = [car.matrix_world @ Vector(c) for c in car.bound_box]
    print('BBOX x %.3f..%.3f  y %.3f..%.3f  z %.3f..%.3f' % (min(v.x for v in bb), max(v.x for v in bb), min(v.y for v in bb), max(v.y for v in bb), min(v.z for v in bb), max(v.z for v in bb)))
    if rear: print('KIT rear', [[round(x, 3), round(z, 3), round(-y, 3)] for x, y, z in rear])
    if side: print('KIT sideX %.2f sideY %.2f' % side)
    print('KIT wheelR %.3f wheelX %.3f' % (wheel_r, wheel_x))
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
                bpy.ops.mesh.primitive_cylinder_add(radius=wheel_r, depth=wheel_w, location=(sx * wheel_x, y, wheel_r - 0.01), rotation=(0, math.pi / 2, 0))
                o = bpy.context.object; o.data.materials.append(tyre); tmp.append(o)
        bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 0, 0)); fl = bpy.context.object
        fl.data.materials.append(mat('floor', (0.5, 0.5, 0.52), 0.6)); tmp.append(fl)
        sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun); tmp.append(sun)
        sun.data.energy = 3.5; sun.rotation_euler = (0.6, 0.2, 0.9)
        cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam; tmp.append(cam)
        cam.data.lens = 50
        views = [('front34', (-4.2, 6.0, 1.9 * cam_h)), ('rear34', (4.4, -6.0, 2.1 * cam_h)), ('side', (8.5, 0, 0.75 * cam_h)),
                 ('front', (0, 8.5, 0.8 * cam_h)), ('rear', (0, -8.5, 0.9 * cam_h)), ('top', (0, 0.001, 9.5))]
        for vname, loc in views:
            cam.location = loc
            d = Vector((0, 0, 0.6 * cam_h)) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
            sc.render.filepath = os.path.join(PNG, vname + '.png')
            bpy.ops.render.render(write_still=True)
        for o in tmp: bpy.data.objects.remove(o, do_unlink=True)
    if BLEND:
        bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
    bpy.ops.object.select_all(action='DESELECT'); car.select_set(True)
    bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True, export_apply=True, export_yup=True)
    print('WROTE', DST)
