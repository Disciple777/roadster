# TUK TUK: an auto-rickshaw with a rounded cab and one headlight, an open passenger bay with a pleated
# bench and grab rails, a long canopy on thin posts with a big wing on top, and two ribbed rocket nozzles
# under the rear deck.
# Hand-modelled from models/source/tuktuk_{front,rear}.png, with ONE front wheel (the concepts show two side by side;
# the user asked for one). The game draws it from the kit flag frontOne.
# blender -b -P tools/model_tuktuk.py -- models/tuktuk.glb [--renders DIR] [--blend models/source/tuktuk.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX, WW = 0.38, 0.88, 0.28
WZ = WR - 0.01
FY = AXLE_F

def hull(name, pts, m):
    bm = bmesh.new()
    for p in pts: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    ob = new_obj(name, bm, [m]); parts.append(ob); return ob

def rrect(w, h, cx, cy, r, n=3):
    return rounded([(cx + w, cy - h), (cx + w, cy + h), (cx - w, cy + h), (cx - w, cy - h)], r, n)

def panel(name, pts, thick, m):
    bm = bmesh.new(); f = bm.faces.new([bm.verts.new(p) for p in pts])
    bmesh.ops.solidify(bm, geom=[f], thickness=thick)
    return add(new_obj(name, bm, [m]))

# ---------------- the cab: a rounded nose, plan slices stacked from the floor up to the scuttle ----------------
CAB = [(0.34, 0.86, 1.0, 0.3), (0.7, 0.86, 1.06, 0.34), (0.9, 0.86, 1.92, 0.48), (1.05, 0.86, 2.1, 0.52),
       (1.25, 0.86, 2.13, 0.545), (1.42, 0.86, 2.05, 0.55)]          # (z, back y, front y, half width)
secs = []
for z, yb, yf, w in CAB:
    poly = rrect(w, (yf - yb) / 2, 0, (yf + yb) / 2, 0.26, 4)
    secs.append([(x, y, z) for x, y in poly])
cab = section_loft('cab', secs, ['paint'])
# a well for the single front wheel, leaving the cab's flanks as fork shrouds
boolean(cab, cylinder('well', 0.47, 0.4, (0, FY, WZ), (0, math.pi / 2, 0), 32))
parts.append(cab)

# front mudguard: a curved slab over the one wheel
mg = []
for k in range(15):
    a = math.radians(-15 + k * 9.5)            # from just below the hub in front, up and over towards the cab
    ca, sa = math.cos(a), math.sin(a)
    prof = [(-0.24, 0.47), (0.24, 0.47), (0.26, 0.5), (0.24, 0.54), (-0.24, 0.54), (-0.26, 0.5)]
    mg.append([(x, FY + r * ca, WZ + r * sa) for x, r in prof])
add(section_loft('mudguard', mg, ['paint']))
for sx in (1, -1):
    tube('fork', [(sx * 0.17, FY, WZ), (sx * 0.17, FY - 0.08, 0.95)], 0.035, 'darkmetal')
add(cylinder('hub', 0.05, 0.38, (0, FY, WZ), (0, math.pi / 2, 0), 16, ('darkmetal',)))

# the round headlight on the nose
HZ = 1.02
lathe('bezel', [(0.13, 2.1), (0.165, 2.14), (0.17, 2.17), (0.15, 2.19)], (0, 0, HZ), segs=32, m='paint')
lathe('lamp', [(0.0, 2.2), (0.08, 2.195), (0.14, 2.18), (0.15, 2.16)], (0, 0, HZ), segs=32, m='light_head')

# windscreen: a framed pane raked back a touch, up to the canopy
SB, ST = (2.02, 1.42), (1.9, 2.02)            # (y, z) of its bottom and top edge
def scr(x, t, inset=0.0):
    y = SB[0] + (ST[0] - SB[0]) * t; z = SB[1] + (ST[1] - SB[1]) * t
    return (x, y, z)
frame = [scr(0.53, 0.02), scr(0.51, 0.98), scr(-0.51, 0.98), scr(-0.53, 0.02)]
tube('screen_frame', bezier_pts([frame[0], frame[1], frame[2], frame[3], frame[0]], 6), 0.035, 'paint', closed=True)
for sx in (1, -1):
    tube('a_pillar', [scr(sx * 0.54, -0.05), scr(sx * 0.51, 1.0)], 0.045, 'paint')
panel('screen', [scr(0.5, 0.06), scr(0.48, 0.94), scr(-0.48, 0.94), scr(-0.5, 0.06)], 0.012, 'glass')
tube('wiper', [scr(-0.05, 0.1), scr(0.3, 0.62)], 0.012, 'trim')
tube('wiper_arm', [scr(-0.05, 0.1, ), (-0.05, 2.06, 1.47)], 0.014, 'trim')
# round mirrors on stalks
for sx in (1, -1):
    tube('mirror_stalk', bezier_pts([(sx * 0.53, 2.0, 1.45), (sx * 0.68, 2.03, 1.52), (sx * 0.76, 2.05, 1.62)], 5), 0.018, 'trim')
    add(cylinder('mirror', 0.1, 0.03, (sx * 0.79, 2.05, 1.68), (math.pi / 2, 0, 0), 24, ('paint',)))
    add(cylinder('mirror_glass', 0.085, 0.01, (sx * 0.79, 2.031, 1.68), (math.pi / 2, 0, 0), 24, ('glass',)))
# handlebar inside the cab
tube('bars', bezier_pts([(-0.32, 1.02, 1.34), (-0.22, 1.12, 1.4), (0.22, 1.12, 1.4), (0.32, 1.02, 1.34)], 5), 0.022, 'trim')

# ---------------- the open bay: floor, low side sills, the driver's seat ----------------
box('floor', (1.24, 1.5, 0.1), (0, 0.15, 0.37), m='paint', bevel=0.2)
for sx in (1, -1):
    box('sill', (0.07, 1.45, 0.3), (sx * 0.6, 0.15, 0.5), m='paint', bevel=0.2)
box('seat_box', (0.64, 0.5, 0.42), (0, 0.48, 0.62), m='paint', bevel=0.12)
box('seat', (0.62, 0.48, 0.11), (0, 0.5, 0.88), m='trim', bevel=0.35)
box('seat_back', (0.62, 0.11, 0.46), (0, 0.24, 1.15), (-0.12, 0, 0), m='trim', bevel=0.25)

# ---------------- rear body: a deck over the axle, boxy fenders, a tunnel for the nozzles ----------------
RB = []
for y, zb, zt, w in [(-0.5, 0.45, 0.98, 0.69), (-0.56, 0.42, 1.02, 0.72), (-2.2, 0.42, 1.02, 0.72), (-2.3, 0.46, 0.98, 0.69)]:
    RB.append([(x, y, z) for x, z in rrect(w, (zt - zb) / 2, 0, (zt + zb) / 2, 0.07, 3)])
rear = section_loft('rear_body', RB, ['paint'])
boolean(rear, box('tunnel', (1.3, 0.8, 0.46), (0, -2.3, 0.6), m='black', bevel=0, keep=False))
parts.append(rear)
# the step: a slightly narrower upper ledge round the deck
box('ledge', (1.36, 1.72, 0.06), (0, -1.42, 1.04), m='paint', bevel=0.3)
for sx in (1, -1):
    f = hull('fender', [(sx * x, y, z) for x in (0.7, 1.07) for y, z in
                        [(-0.86, 0.42), (-1.0, 0.86), (-1.9, 0.86), (-2.04, 0.42)]], 'paint')
    boolean(f, cylinder('arch', 0.45, 0.6, (sx * 0.9, AXLE_R, WZ), (0, math.pi / 2, 0), 40))
    box('taillight', (0.16, 0.03, 0.07), (sx * 0.52, -2.31, 0.9), m='light_tail', bevel=0.25)

# twin ribbed rocket nozzles under the deck
NZ, NR, NX, NEXIT = 0.6, 0.24, 0.32, -2.62
box('nozzle_mount', (1.1, 0.4, 0.34), (0, -1.98, 0.66), m='darkmetal', bevel=0.15)
for sx in (1, -1):
    x = sx * NX
    lathe('nozzle_body', [(0.2, -1.8), (0.26, -1.86), (0.26, -2.34), (0.24, -2.36)], (x, 0, NZ), segs=40, m='darkmetal')
    for yb in (-1.94, -2.22):
        lathe('ring', [(0.26, yb), (0.29, yb - 0.02), (0.29, yb - 0.1), (0.26, yb - 0.12)], (x, 0, NZ), segs=40, m='metal')
        for b in range(10):
            a = 2 * math.pi * (b + 0.5) / 10
            box('rib', (0.03, 0.1, 0.03), (x + math.cos(a) * 0.295, yb - 0.06, NZ + math.sin(a) * 0.295), (0, -a, 0), m='darkmetal', bevel=0.2)
    nozzle(x, NZ, NR, NEXIT, depth=0.3, vanes=10, m='metal')

# ---------------- passenger bench: pleated backrest, tube grab rails ----------------
box('bench', (1.3, 0.56, 0.14), (0, -0.92, 1.12), m='trim', bevel=0.35)
for k in range(4):
    box('pleat', (0.315, 0.15, 0.56), (-0.48 + k * 0.32, -1.32, 1.44), (0.1, 0, 0), m='trim', bevel=0.3)
box('bench_back', (1.34, 0.08, 0.5), (0, -1.43, 1.36), (0.1, 0, 0), m='paint', bevel=0.2)
for sx in (1, -1):
    tube('grab', bezier_pts([(sx * 0.72, -0.62, 1.02), (sx * 0.72, -0.64, 1.3), (sx * 0.72, -0.8, 1.34), (sx * 0.72, -1.55, 1.34)], 5), 0.028, 'paint')
tube('back_rail', bezier_pts([(0.72, -1.55, 1.34), (0.7, -1.62, 1.34), (0, -1.62, 1.34), (-0.7, -1.62, 1.34), (-0.72, -1.55, 1.34)], 4), 0.028, 'paint')
for sx in (1, -1):
    tube('rail_leg', [(sx * 0.7, -1.62, 1.34), (sx * 0.7, -1.62, 1.04)], 0.026, 'paint')

# ---------------- the canopy on its posts, with a wing on top ----------------
ROOF = [(2.3, 1.98, 0.58, 0.05), (2.22, 2.05, 0.72, 0.07), (1.95, 2.1, 0.79, 0.07), (1.0, 2.13, 0.81, 0.07), (0.0, 2.14, 0.81, 0.07),
        (-1.0, 2.13, 0.81, 0.07), (-1.65, 2.11, 0.81, 0.08), (-1.95, 2.03, 0.8, 0.1), (-2.1, 1.9, 0.77, 0.1), (-2.16, 1.78, 0.72, 0.08)]
rs = []
for y, zt, w, th in ROOF:
    top = [(w * c, zt + 0.06 * (1 - c * c)) for c in np.linspace(1, -1, 13)]
    loop = [(w + 0.015, zt - th * 0.5)] + top + [(-w - 0.015, zt - th * 0.5), (-w + 0.04, zt - th), (w - 0.04, zt - th)]
    rs.append([(x, y, z) for x, z in loop])
roof = section_loft('roof', rs, ['paint'])
parts.append(roof)
for ys, zt in ((0.95, 2.13), (-0.55, 2.135)):    # two panel seams across the canopy
    tube('seam', [(0.8 * c, ys, zt + 0.06 * (1 - c * c) + 0.004) for c in np.linspace(1, -1, 13)], 0.009, 'trim')
# posts: behind the cab, mid-bay, and the two at the back that lean in under the canopy's tail
for sx in (1, -1):
    tube('b_pillar', [(sx * 0.55, 0.9, 1.4), (sx * 0.55, 0.9, 2.1)], 0.04, 'paint')
    tube('mid_post', [(sx * 0.6, -0.1, 0.62), (sx * 0.6, -0.1, 2.1)], 0.035, 'paint')
    tube('rear_post', bezier_pts([(sx * 0.68, -1.68, 1.04), (sx * 0.68, -1.72, 1.6), (sx * 0.62, -1.82, 1.95)], 5), 0.045, 'paint')
# the wing: two raked struts and a cambered blade with turned-up tips
WZG, WY = 2.42, -2.0
for sx in (1, -1):
    hull('strut', [(sx * x, y, z) for x in (0.4, 0.45) for y, z in [(-1.72, 2.15), (-2.02, 2.08), (-2.14, WZG - 0.03), (-1.98, WZG - 0.03)]], 'paint')
blade = []
for x in np.linspace(-0.98, 0.98, 15):
    lift = 0.1 * max(0.0, (abs(x) - 0.7) / 0.28) ** 2
    prof = [(0.2, 0.0), (0.12, 0.03), (-0.04, 0.038), (-0.2, 0.012), (-0.2, -0.006), (-0.02, -0.012), (0.14, -0.012)]
    blade.append([(x, WY + a, WZG + lift + b - a * 0.12) for a, b in prof])
add(section_loft('wing', blade, ['paint']))

finish(cab, 'tuktuk', WR, WX, wheel_w=WW, rear=[(NX, NEXIT, NZ), (-NX, NEXIT, NZ)], side=(0.78, 0.7), cam_h=1.6, front_one=True, cam_d=1.3)
