# TUK TUK v2: a closer take on models/source/tuktuk_{front,rear}.png than model_tuktuk.py.
# Taller and on smaller wheels like the concepts: a rounded cab with a bulging nose, one big headlight and a wide
# mudguard over the single front wheel; a thick canopy that curls down at both ends, on a fat pillar behind the cab,
# a post at the deck's front and two rear posts that sweep back into its tail; a notched rear deck carrying a pleated
# bench inside a tube rail, big round fenders over the rear wheels, and two fat ribbed rocket nozzles underneath.
# ONE front wheel (the concepts show two side by side; the user asked for one): the game draws it from the kit flag frontOne.
# blender -b -P tools/model_tuktuk2.py -- models/tuktuk2.glb [--renders DIR] [--blend models/source/tuktuk2.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.34, 0.86
WW = 2 * 0.16 * WR / 0.37
WZ = WR - 0.01
FY = AXLE_F

def hull(name, pts, m):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_obj(name, bm, [m]); parts.append(ob); return ob

def rrect(w, h, cx, cy, r, n=4):
    return rounded([(cx + w, cy - h), (cx + w, cy + h), (cx - w, cy + h), (cx - w, cy - h)], r, n)

def panel(name, pts, thick, m):
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new(p) for p in pts])
    bmesh.ops.solidify(bm, geom=[f], thickness=thick)
    return add(new_obj(name, bm, [m]))

def prism(name, poly_yz, x0, x1, m='paint', bev=0.025, keep=True):
    """a side profile (y, z) pushed across from x0 to x1, edges softened"""
    bm = bmesh.new()
    f = bm.faces.new([bm.verts.new((x0, y, z)) for y, z in poly_yz])
    r = bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in [e for e in r['geom'] if isinstance(e, bmesh.types.BMVert)]: v.co.x = x1
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    if bev: bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bev, segments=2, affect='EDGES', clamp_overlap=True)
    ob = new_obj(name, bm, [m])
    if keep: parts.append(ob)
    return ob

def arc_band(name, cx, cy, cz, prof, a0, a1, n=18, m='paint'):
    """a mudguard: the closed cross-section prof [(x, radius)…] swept round the wheel axis from angle a0 to a1 (0 = front)"""
    secs = []
    for k in range(n):
        a = math.radians(a0 + (a1 - a0) * k / (n - 1)); ca, sa = math.cos(a), math.sin(a)
        secs.append([(cx + x, cy + r * ca, cz + r * sa) for x, r in prof])
    return add(section_loft(name, secs, [m]))

# ---------------- the cab: plan slices stacked from the floor to the scuttle, the nose bulging at the headlight ----------------
CAB = [(0.40, 0.98, 1.58, 0.5, 0.26), (0.62, 0.98, 1.68, 0.52, 0.27), (0.85, 0.98, 1.84, 0.56, 0.28),
       (1.0, 0.98, 1.92, 0.58, 0.26), (1.14, 0.98, 1.93, 0.58, 0.24), (1.27, 0.98, 1.9, 0.58, 0.2),
       (1.36, 0.98, 1.85, 0.57, 0.17), (1.40, 0.98, 1.83, 0.55, 0.15)]     # (z, back y, front y, half width, corner r)
cab = section_loft('cab', [[(x, y, z) for x, y in rrect(w, (yf - yb) / 2, 0, (yf + yb) / 2, r, 5)] for z, yb, yf, w, r in CAB], ['paint'])
# an arch right through for the single front wheel, so it shows from the side as in the concepts
boolean(cab, cylinder('well', 0.47, 1.8, (0, FY, WZ), (0, math.pi / 2, 0), 48))
parts.append(cab)

# the wide front mudguard over the one wheel, its nose flared forward under the headlight
arc_band('mudguard', 0, FY, WZ, [(-0.24, 0.39), (0.24, 0.39), (0.27, 0.43), (0.25, 0.47), (-0.25, 0.47), (-0.27, 0.43)], -8, 112, 22)
for sx in (1, -1):
    tube('fork', [(sx * 0.19, FY, WZ), (sx * 0.19, FY - 0.06, 0.86)], 0.035, 'darkmetal')
add(cylinder('hub', 0.05, 0.4, (0, FY, WZ), (0, math.pi / 2, 0), 16, ('darkmetal',)))

# the big round headlight in a deep bezel on the nose
HZ = 1.03
lathe('bezel', [(0.15, 1.84), (0.21, 1.89), (0.22, 1.95), (0.205, 1.99), (0.18, 1.995)], (0, 0, HZ), segs=48, m='paint')
lathe('lamp', [(0.0, 2.012), (0.08, 2.007), (0.15, 1.99), (0.182, 1.975)], (0, 0, HZ), segs=48, m='light_head')

# windscreen: a big upright pane in a thick round-cornered frame, up to the canopy's front lip
SB, ST = (1.835, 1.38), (1.74, 2.07)            # (y, z) of its bottom and top edge
def scr(x, t):
    return (x, SB[0] + (ST[0] - SB[0]) * t, SB[1] + (ST[1] - SB[1]) * t)
def scr_loop(hw, t0, t1, rr):
    h = (t1 - t0) * (ST[1] - SB[1]) / 2
    ring = rounded([(hw, -h), (hw, h), (-hw, h), (-hw, -h)], rr, 4)
    tm = (t0 + t1) / 2
    return [scr(x, tm + z / (ST[1] - SB[1])) for x, z in ring]
tube('screen_frame', scr_loop(0.47, 0.04, 0.97, 0.12), 0.05, 'paint', closed=True)
for sx in (1, -1):    # fat A-pillars: the cab's flanks carried up to the canopy
    hull('a_pillar', [(sx * x, y, z) for x in (0.46, 0.58) for y, z in [(1.83, 1.34), (1.62, 1.34), (1.74, 2.12), (1.6, 2.12)]], 'paint')
panel('screen', scr_loop(0.46, 0.06, 0.95, 0.1), 0.012, 'glass')
tube('wiper', [scr(-0.1, 0.1), scr(0.32, 0.72)], 0.013, 'trim')
tube('wiper_arm', [scr(-0.1, 0.1), (-0.1, 1.87, 1.41)], 0.016, 'trim')
# round mirrors on stalks off the A-pillars
for sx in (1, -1):
    tube('mirror_stalk', bezier_pts([(sx * 0.57, 1.78, 1.5), (sx * 0.7, 1.8, 1.55), (sx * 0.78, 1.82, 1.66)], 5), 0.018, 'trim')
    add(cylinder('mirror', 0.1, 0.035, (sx * 0.82, 1.82, 1.74), (math.pi / 2, 0, 0), 28, ('paint',)))
    add(cylinder('mirror_glass', 0.085, 0.01, (sx * 0.82, 1.84, 1.74), (math.pi / 2, 0, 0), 28, ('glass',)))
# handlebar on the dash
tube('bars', bezier_pts([(-0.34, 0.9, 1.34), (-0.24, 1.0, 1.44), (0.24, 1.0, 1.44), (0.34, 0.9, 1.34)], 5), 0.024, 'trim')
tube('stem', [(0, 1.0, 1.44), (0, 1.08, 1.36)], 0.03, 'trim')

# ---------------- the open bay: floor, low side sills, the driver's seat on its box ----------------
box('floor', (1.2, 0.74, 0.08), (0, 0.62, 0.4), m='paint', bevel=0.2)
for sx in (1, -1):
    box('sill', (0.08, 0.72, 0.24), (sx * 0.6, 0.62, 0.48), m='paint', bevel=0.25)
    tube('b_pillar', [(sx * 0.52, 1.02, 1.36), (sx * 0.56, 1.02, 2.2)], 0.06, 'paint')   # the cab's back corners, up to the canopy
box('seat_box', (0.7, 0.44, 0.44), (0, 0.7, 0.64), m='paint', bevel=0.1)
box('seat', (0.72, 0.46, 0.12), (0, 0.71, 0.92), m='trim', bevel=0.35)
for k in range(3):
    box('seat_pleat', (0.235, 0.12, 0.4), (-0.24 + k * 0.24, 0.5, 1.16), (-0.12, 0, 0), m='trim', bevel=0.3)

# ---------------- rear body: a notched side profile rising to the deck, a nozzle housing, round fenders ----------------
DECK = 1.0
deck_prof = [(0.34, 0.38), (0.34, 0.68), (0.2, 0.7), (0.06, DECK), (-1.98, DECK), (-2.02, 0.95), (-2.02, 0.62), (-1.9, 0.38)]
prism('rear_body', deck_prof, -0.68, 0.68, bev=0.03)
box('deck_rim', (1.42, 2.08, 0.05), (0, -0.96, DECK + 0.01), m='paint', bevel=0.3)
box('housing', (1.12, 0.36, 0.42), (0, -1.94, 0.52), m='paint', bevel=0.12)
box('housing_lip', (1.3, 0.1, 0.08), (0, -2.08, 0.76), m='paint', bevel=0.3)
for sx in (1, -1):
    arc_band('fender', sx * 0.86, AXLE_R, WZ, [(sx * x, r) for x, r in [(-0.22, 0.42), (0.19, 0.42), (0.23, 0.47), (0.22, 0.53), (0.17, 0.57), (-0.22, 0.57)]], -14, 194, 28)
    box('taillight', (0.18, 0.03, 0.07), (sx * 0.5, -2.035, 0.86), m='light_tail', bevel=0.25)

# twin fat ribbed rocket nozzles out of the housing
NZ, NR, NX, NEXIT = 0.5, 0.25, 0.3, -2.52
for sx in (1, -1):
    x = sx * NX
    lathe('nozzle_body', [(0.2, -1.8), (0.25, -1.86), (0.25, -2.24), (0.23, -2.26)], (x, 0, NZ), segs=40, m='darkmetal')
    for yb in (-1.98, -2.16):
        lathe('ring', [(0.25, yb), (0.28, yb - 0.02), (0.28, yb - 0.1), (0.25, yb - 0.12)], (x, 0, NZ), segs=40, m='metal')
        for b in range(10):
            a = 2 * math.pi * (b + 0.5) / 10
            box('rib', (0.03, 0.1, 0.03), (x + math.cos(a) * 0.285, yb - 0.06, NZ + math.sin(a) * 0.285), (0, -a, 0), m='darkmetal', bevel=0.2)
    nozzle(x, NZ, NR, NEXIT, depth=0.3, vanes=10, m='metal')

# ---------------- passenger bench: cushion, five-pleat backrest, tube rail round it ----------------
box('bench', (1.3, 1.22, 0.14), (0, -0.44, DECK + 0.1), m='trim', bevel=0.3)
for k in range(5):
    box('pleat', (0.255, 0.13, 0.56), (-0.52 + k * 0.26, -1.12, DECK + 0.4), (0.1, 0, 0), m='trim', bevel=0.3)
box('bench_back', (1.34, 0.08, 0.56), (0, -1.22, DECK + 0.38), (0.1, 0, 0), m='paint', bevel=0.2)
RZ, RB = DECK + 0.34, -1.5
for sx in (1, -1):
    tube('grab', bezier_pts([(sx * 0.7, 0.04, DECK), (sx * 0.7, 0.02, RZ - 0.06), (sx * 0.7, -0.1, RZ), (sx * 0.7, RB + 0.1, RZ)], 6), 0.03, 'paint')
    tube('rail_leg', [(sx * 0.66, RB, RZ), (sx * 0.66, RB, DECK)], 0.028, 'paint')
tube('back_rail', bezier_pts([(0.7, RB + 0.1, RZ), (0.68, RB, RZ), (0, RB, RZ), (-0.68, RB, RZ), (-0.7, RB + 0.1, RZ)], 5), 0.03, 'paint')

# ---------------- the canopy: a thick shell, crowned across, curling down at the front lip and the tail ----------------
ROOF = [(2.05, 2.12, 2.0, 0.5), (2.0, 2.2, 1.97, 0.6), (1.92, 2.26, 1.99, 0.64), (1.7, 2.31, 2.06, 0.66), (1.0, 2.35, 2.15, 0.71),
        (0.0, 2.36, 2.16, 0.75), (-1.0, 2.35, 2.15, 0.76), (-1.55, 2.32, 2.11, 0.76), (-1.85, 2.27, 2.02, 0.76),
        (-2.02, 2.18, 1.92, 0.74), (-2.12, 2.07, 1.85, 0.7), (-2.17, 1.97, 1.84, 0.62)]   # (y, top z, bottom z, half width)
rs = []
for y, zt, zb, w in ROOF:
    top = [(w * c, zt - 0.06 * c * c) for c in np.linspace(1, -1, 15)]
    zs = zt - 0.06
    sec =top + [(-w - 0.02, zs - 0.03), (-w - 0.02, (zs + zb) / 2), (-w + 0.03, zb), (w - 0.03, zb), (w + 0.02, (zs + zb) / 2), (w + 0.02, zs - 0.03)]
    rs.append([(x, y, z) for x, z in sec])
add(section_loft('roof', rs, ['paint']))
for ys, zt in ((0.85, 2.34), (-0.65, 2.345)):    # two panel seams across the canopy
    tube('seam', [((0.69 if ys > 0 else 0.745) * c, ys, zt - 0.06 * c * c + 0.006) for c in np.linspace(1, -1, 15)], 0.01, 'trim')
# posts: one at the deck's front, and the two rear ones sweeping back into the canopy's tail
for sx in (1, -1):
    tube('mid_post', [(sx * 0.66, 0.26, 0.5), (sx * 0.66, 0.26, 2.22)], 0.04, 'paint')
    tube('rear_post', bezier_pts([(sx * 0.66, -1.58, DECK), (sx * 0.66, -1.6, 1.55), (sx * 0.66, -1.7, 1.86), (sx * 0.64, -1.92, 2.04)], 6), 0.055, 'paint')

# the wing: two raked blade struts off the canopy's tail and a wide cambered blade with curled-up tips
WZG, WY = 2.7, -1.98
for sx in (1, -1):
    hull('strut', [(sx * x, y, z) for x in (0.38, 0.47) for y, z in [(-1.3, 2.31), (-1.78, 2.26), (-2.08, WZG - 0.03), (-1.84, WZG - 0.02)]], 'paint')
blade = []
for x in np.linspace(-1.0, 1.0, 21):
    t = max(0.0, (abs(x) - 0.66) / 0.34)
    lift = 0.2 * t ** 2.2
    prof = [(0.22, 0.0), (0.13, 0.035), (-0.05, 0.045), (-0.22, 0.015), (-0.22, -0.008), (-0.02, -0.014), (0.15, -0.014)]
    blade.append([(x, WY + a * (1 - 0.25 * t), WZG + lift + b - a * 0.12) for a, b in prof])
add(section_loft('wing', blade, ['paint']))

finish(cab, 'tuktuk2', WR, WX, wheel_w=WW, rear=[(NX, NEXIT, NZ), (-NX, NEXIT, NZ)], side=(1.0, 0.6), cam_h=1.7, front_one=True, cam_d=1.35)
