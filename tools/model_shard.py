# SHARD: a faceted armoured sport truck, folded-steel slabs, a flat roof, hexagonal arches and a big
# octagonal turbine in the open cargo bed between two raked fins.
# Hand-modelled from models/source/shard_{front,rear}.png (the roof is flat here, at the user's request: no peak).
# blender -b -P tools/model_shard.py -- models/shard.glb [--renders DIR] [--blend models/source/shard.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.47, 0.95
WZ = WR - 0.01
# v2: the body rides DZ higher on the same wheels and the arches/flares open up, so there's more air above the tyres
# (v1 is kept in tools/model_shard_v1.py and models/source/shard_v1.glb)
DZ = 0.1

def lin(pts):
    ys, vs = zip(*pts)
    return lambda y: float(np.interp(y, ys, vs))

def facet(ob, deg=12):
    """split every crease sharper than deg so the slabs stay flat-shaded after finish() smooths the car"""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    sharp = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(deg)]
    bmesh.ops.split_edges(bm, edges=sharp)
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

def hull(name, pts, m):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_obj(name, bm, [m]); parts.append(ob); return ob

# ---------------- lower body: one slab-sided wedge, sharp nose, high tailgate ----------------
Y0, Y1 = -2.45, 2.5
W = lin([(-2.45, 0.98), (2.2, 1.0), (2.5, 0.92)])
ZB0 = lin([(-2.45, 0.52), (-2.2, 0.42), (2.15, 0.42), (2.5, 0.6)])
ZT0 = lin([(-2.45, 1.12), (-0.95, 1.14), (0.95, 1.12), (2.5, 0.9)])
ZB = lambda y: ZB0(y) + DZ
ZT = lambda y: ZT0(y) + DZ

def bsec(y, shrink=0.0):
    w, zb, zt = W(y) - shrink, ZB(y) + shrink, ZT(y) - shrink
    half = [(w - 0.16, zb), (w, zb + 0.16), (w, zt - 0.12), (w - 0.12, zt), (0.0, zt + 0.015)]
    poly = [(-x, z) for x, z in reversed(half[:-1])] + half
    return [(x, y, z) for x, z in poly]
ys = [-2.38, -2.2, -0.95, 0.95, 2.15, 2.42]
body = section_loft('body', [bsec(Y0, 0.05)] + [bsec(y) for y in ys] + [bsec(Y1, 0.04)], ['paint'])

# hexagonal wheel arches, flat on top
HEX = [(0.8, 0.0), (0.43, 0.65), (-0.43, 0.65), (-0.8, 0.0), (-0.43, -0.65), (0.43, -0.65)]
for y in (AXLE_F, AXLE_R):
    for sx in (1, -1):
        cut = section_loft('arch', [[(sx * x, y + a, WZ + b) for a, b in HEX] for x in (0.58, 1.5)], ['black'])
        boolean(body, cut)

# the open cargo bed
boolean(body, box('bed', (1.68, 1.06, 0.8), (0, -1.8, 1.18 + DZ), m='black', bevel=0, keep=False))
# the turbine's mouth through the tailgate
TZ, TR, TEXIT = 1.28 + DZ, 0.32, -2.52
boolean(body, cylinder('bore', 0.37, 0.4, (0, -2.42, TZ), (math.pi / 2, 0, 0), 8))

# ---------------- cabin: raked screen, FLAT roof, a steep rear facet down to the bed ----------------
CAB = [(1.2, 1.125 + DZ, 0.97), (-0.05, 1.66 + DZ, 0.7), (-0.82, 1.66 + DZ, 0.7), (-1.3, 1.16 + DZ, 0.95)]   # (y, top z, top half-width)
secs = []
for y, zt, wr in CAB:
    poly = [(-0.99, 0.98 + DZ), (0.99, 0.98 + DZ), (wr, zt), (-wr, zt)]
    secs.append([(x, y, z) for x, z in poly])
cabin = section_loft('cabin', secs, ['paint'])
parts.append(cabin)
facet(body); facet(cabin)
refresh_many([body, cabin])

# windscreen: cast onto its own plane from just in front of it
t = Vector((0, -1.25, 0.535)).normalized(); n = Vector((0, 0.535, 1.25)).normalized()
o = Vector((0, 0.575, 1.3925 + DZ)) + n * 0.3
decal('screen_frame', [(-0.9, -0.62), (0.9, -0.62), (0.67, 0.64), (-0.67, 0.64)], o, (1, 0, 0), t, -n, 'trim', 0.004)
decal('screen', [(-0.86, -0.59), (0.86, -0.59), (0.64, 0.61), (-0.64, 0.61)], o, (1, 0, 0), t, -n, 'glass', 0.008)
# rear window on the back facet
t2 = Vector((0, 0.48, 0.5)).normalized(); n2 = Vector((0, -0.5, 0.48)).normalized()
o2 = Vector((0, -1.06, 1.41 + DZ)) + n2 * 0.3
decal('rear_glass', [(-0.6, -0.17), (0.6, -0.17), (0.55, 0.2), (-0.55, 0.2)], o2, (1, 0, 0), t2, -n2, 'glass', 0.006)
def sd(name, poly, *a, **k): return side_decal(name, [(y, z + DZ) for y, z in poly], *a, **k)
for sx in (1, -1):
    sd('win_frame', [(1.04, 1.16), (0.06, 1.6), (-0.14, 1.6), (-0.14, 1.16)], 'trim', sx, 0.004)
    sd('glass', [(0.99, 1.18), (0.08, 1.58), (-0.11, 1.58), (-0.11, 1.18)], 'glass', sx, 0.008)
    sd('win_frame', [(-0.19, 1.16), (-0.19, 1.6), (-0.82, 1.6), (-1.1, 1.3), (-1.1, 1.16)], 'trim', sx, 0.004)
    sd('glass', [(-0.22, 1.18), (-0.22, 1.58), (-0.8, 1.58), (-1.07, 1.3), (-1.07, 1.18)], 'glass', sx, 0.008)
    # door shut lines and a flush handle
    for yy in (0.92, -0.96):
        sd('shut', [(yy + 0.006, 0.6), (yy - 0.006, 0.6), (yy - 0.006, 1.0), (yy + 0.006, 1.0)], 'trim', sx, 0.003, cuts=2)
    box('handle', (0.02, 0.16, 0.025), (sx * 1.0, -0.62, 0.92 + DZ), m='trim', bevel=0.2)

# ---------------- angular arch flares, rocker armour ----------------
OUT = [(1.0, -0.02), (0.53, 0.78), (-0.53, 0.78), (-1.0, -0.02)]
INN = [HEX[0], HEX[1], HEX[2], HEX[3]]
for y in (AXLE_F, AXLE_R):
    for sx in (1, -1):
        for k in range(3):
            quad = [INN[k], INN[k + 1], OUT[k + 1], OUT[k]]
            pts = [(sx * x, y + a, WZ + b) for a, b in quad for x in (0.94, 1.08)]
            pts += [(sx * 1.11, y + a, WZ + b) for a, b in quad[2:]]   # outer edge leans out a touch
            hull('flare', pts, 'paint')
for sx in (1, -1):
    hull('rocker', [(sx * x, y, z) for y in (0.42, -0.45) for x, z in ((0.9, 0.4 + DZ), (1.06, 0.44 + DZ), (1.04, 0.6 + DZ), (0.9, 0.62 + DZ))], 'darkmetal')

# ---------------- nose: full-width light bar, armoured skid plate ----------------
box('lightbar_frame', (1.84, 0.03, 0.075), (0, 2.495, 0.82 + DZ), m='trim', bevel=0.2)
box('lightbar', (1.8, 0.03, 0.03), (0, 2.51, 0.82 + DZ), m='light_head', bevel=0.2)
front_decal('intake', [(-0.6, 0.66 + DZ), (0.6, 0.66 + DZ), (0.55, 0.75 + DZ), (-0.55, 0.75 + DZ)], 'grille', 0.004)
box('skid_f', (1.6, 0.5, 0.06), (0, 2.32, 0.46 + DZ), (0.38, 0, 0), m='darkmetal', bevel=0.2)
for k in range(5):
    x = -0.5 + k * 0.25
    box('skid_tooth', (0.07, 0.2, 0.1), (x, 2.5, 0.5 + DZ), (0.38, 0, 0), m='black', bevel=0.2)

# ---------------- tail: light bar, diffuser ----------------
box('taillight_frame', (1.8, 0.03, 0.08), (0, -2.455, 0.8 + DZ), m='trim', bevel=0.2)
box('taillight', (1.76, 0.03, 0.035), (0, -2.47, 0.8 + DZ), m='light_tail', bevel=0.2)
box('skid_r', (1.7, 0.45, 0.06), (0, -2.3, 0.5 + DZ), (-0.38, 0, 0), m='darkmetal', bevel=0.2)
for k in range(5):
    x = -0.6 + k * 0.3
    box('diff_fin', (0.04, 0.34, 0.12), (x, -2.32, 0.52 + DZ), m='black', bevel=0.2)

# ---------------- the turbine in the bed, two raked fins ----------------
lathe('nacelle', [(0.26, -1.45), (0.36, -1.55), (0.38, -1.65), (0.38, -2.3), (0.36, -2.42), (0.36, -2.48)], (0, 0, TZ), segs=8, m='darkmetal')
for yb in (-1.8, -2.12):
    lathe('band', [(0.38, yb), (0.405, yb - 0.01), (0.405, yb - 0.06), (0.38, yb - 0.07)], (0, 0, TZ), segs=8, m='trim')
add(cylinder('intake', 0.27, 0.01, (0, -1.44, TZ), (math.pi / 2, 0, 0), 8, ('grille',)))
lathe('spinner', [(0.1, -1.44), (0.05, -1.36), (0.0, -1.33)], (0, 0, TZ), m='metal')
box('mount', (0.5, 0.9, 0.18), (0, -1.95, 0.88 + DZ), m='darkmetal', bevel=0.2)
nozzle(0, TZ, TR, TEXIT, depth=0.3, vanes=12, m='metal')
for sx in (1, -1):
    bm = bmesh.new()
    pl = [(-1.32, 1.1 + DZ), (-2.42, 1.1 + DZ), (-2.42, 1.95 + DZ), (-2.26, 1.97 + DZ)]
    vs = [bm.verts.new((sx * (0.86 + (z - 1.1 - DZ) * 0.22), y, z)) for y, z in pl]; f = bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=[f], thickness=0.06)
    add(new_obj('fin', bm, ['paint']))

finish(body, 'shard', WR, WX, wheel_w=0.4, rear=[(0, TEXIT, TZ)], side=(1.0, 0.62 + DZ), cam_h=1.15 + DZ)
