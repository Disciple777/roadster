# ATLAS: long grand-tourer with a bubble canopy, twin deck turbines and a swept arch over the tail.
# The prize for winning the World Tour. Hand-modelled from models/source/atlas_{front,rear}.png.
# blender -b -P tools/model_atlas.py -- models/atlas.glb [--renders DIR] [--blend models/source/atlas.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.42, 0.92
WZ = WR - 0.01

# ---------------- body: long bonnet, pinched waist, big rear haunches ----------------
Y0, Y1 = -2.5, 2.62
W = pchip([(-2.5, 0.92), (-2.3, 1.08), (-1.9, 1.15), (-1.45, 1.17), (-0.9, 1.12), (-0.3, 1.01), (0.3, 0.98), (0.9, 1.05),
           (1.42, 1.1), (1.9, 1.07), (2.3, 0.97), (2.52, 0.84), (2.62, 0.66)])
ZB = pchip([(-2.5, 0.3), (-2.2, 0.2), (-1.8, 0.16), (1.8, 0.16), (2.3, 0.15), (2.62, 0.14)])
ZW = pchip([(-2.5, 0.56), (-1.5, 0.56), (0.0, 0.46), (1.5, 0.46), (2.3, 0.36), (2.62, 0.24)])
ZF = pchip([(-2.5, 0.84), (-2.0, 0.95), (-1.45, 0.99), (-0.8, 0.9), (-0.2, 0.79), (0.5, 0.74), (1.42, 0.83), (2.0, 0.74),
            (2.35, 0.56), (2.62, 0.36)])
ZT = pchip([(-2.5, 0.78), (-2.0, 0.86), (-0.8, 0.87), (0.0, 0.84), (0.6, 0.8), (1.2, 0.74), (1.8, 0.65), (2.3, 0.5), (2.62, 0.34)])
def control(y):
    w, zb, zw, zf, zt = W(y), ZB(y), ZW(y), ZF(y), ZT(y)
    return [(0.0, zb), (w * 0.72, zb), (w * 0.97, zb + (zw - zb) * 0.45), (w, zw), (w * 0.95, zw + (zf - zw) * 0.65),
            (w * 0.8, zf), (w * 0.45, (zf + zt) / 2), (0.0, zt)]
body = loft('body', control, [3, 3, 3, 3, 3, 4, 3], lambda s, y: 0, Y0, Y1)

arches(body, WZ, WR + 0.07, x_in=0.62, depth=0.75)

# cockpit well under the canopy
CY, CRX, CRY = 0.3, 0.6, 1.02
ell = [(CRX * 0.94 * math.cos(2 * math.pi * i / 64), CY + CRY * 0.94 * math.sin(2 * math.pi * i / 64)) for i in range(64)]
boolean(body, section_loft('ck', [[(x, y, 0.55) for x, y in ell], [(x, y, 1.6) for x, y in ell]], ['black']))

# the turbines' mouths: bore the tail open behind each housing
TX, TZ, TR, TEXIT = 0.4, 1.0, 0.3, -2.56
for sx in (1, -1):
    boolean(body, cylinder('bore', TR + 0.01, 0.7, (sx * TX, -2.6, TZ), (math.pi / 2, 0, 0), 64))
refresh(body)

# ---------------- canopy: a teardrop bubble, longer than wide ----------------
CZ, CRZ = 0.74, 0.44
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.02], context='VERTS')
for v in bm.verts:
    yy = v.co.y
    # teardrop: the tail of the bubble stretched and lowered
    k = 1.0 + (0.18 * -yy if yy < 0 else 0.0)
    v.co = Vector((v.co.x * CRX * (1 - 0.12 * max(0.0, -yy)), CY + yy * CRY * k, CZ + max(v.co.z, 0.0) * CRZ * (1 - 0.25 * max(0.0, -yy))))
add(new_obj('canopy', bm, ['glass']))
ring_pts = []
for i in range(65):
    a = 2 * math.pi * i / 64; s = math.sin(a)
    k = 1.0 + (0.18 * -s if s < 0 else 0.0)
    ring_pts.append((CRX * 1.005 * math.cos(a) * (1 - 0.12 * max(0.0, -s)), CY + CRY * 1.005 * s * k, CZ + 0.05))
tube('canopy_ring', ring_pts, 0.022, 'trim')
for sx in (1, -1):
    box('seat', (0.4, 0.42, 0.12), (sx * 0.27, 0.2, 0.62), m='black')
    box('seat_back', (0.42, 0.1, 0.36), (sx * 0.27, -0.02, 0.8), (0.25, 0, 0), m='black')
box('dash', (1.0, 0.24, 0.14), (0, 0.98, 0.8), (-0.3, 0, 0), m='black')

# ---------------- nose: blade headlights, big lower intake, splitter ----------------
for sx in (1, -1):
    blade = [(sx * 0.98, 0.52), (sx * 0.9, 0.47), (sx * 0.5, 0.36), (sx * 0.42, 0.355), (sx * 0.5, 0.385), (sx * 0.92, 0.515)]
    front_decal('headlight', blade, 'light_head', 0.006)
front_decal('intake', rounded([(-0.62, 0.17), (0.62, 0.17), (0.5, 0.33), (-0.5, 0.33)], 0.05, 3), 'grille', 0.004)
box('splitter', (1.96, 0.42, 0.035), (0, 2.46, 0.12), m='trim', bevel=0.3)
for sx in (1, -1):
    box('strake', (0.03, 0.3, 0.12), (sx * 0.42, 2.48, 0.19), m='trim', bevel=0.2)
# bonnet vents either side of the crease
for sx in (1, -1):
    top_decal('bonnet_vent', rounded([(sx * 0.22, 1.55), (sx * 0.5, 1.7), (sx * 0.5, 1.95), (sx * 0.26, 1.85)], 0.04, 3), 'grille', 0.004)

# ---------------- flanks: deep scoops between the wheels ----------------
for sx in (1, -1):
    side_decal('scoop', rounded([(0.78, 0.62), (-0.45, 0.66), (-0.78, 0.34), (0.55, 0.3)], 0.06, 3), 'grille', sx, 0.004)
    side_decal('sill', [(0.9, 0.2), (-0.9, 0.2), (-0.9, 0.25), (0.9, 0.25)], 'trim', sx, 0.004)

# ---------------- tail: lamp blades, diffuser fins ----------------
for sx in (1, -1):
    rear_decal('tail_lamp', [(sx * 0.98, 0.63), (sx * 0.9, 0.6), (sx * 0.5, 0.56), (sx * 0.45, 0.575), (sx * 0.52, 0.59), (sx * 0.92, 0.635)], 'light_tail', 0.006)
rear_decal('diffuser', rounded([(-0.8, 0.2), (0.8, 0.2), (0.7, 0.44), (-0.7, 0.44)], 0.04, 3), 'grille', 0.004)
for x in (-0.62, -0.31, 0.0, 0.31, 0.62):
    box('fin', (0.035, 0.42, 0.22), (x, -2.36, 0.2), m='trim', bevel=0.2)

# ---------------- twin deck turbines ----------------
def fan(cx, cy, cz, r, facing, blades=26, m='darkmetal'):
    """a turbine face: twisted blades round a spinner cone, a dark back plate"""
    s = facing
    add(cylinder('fan_back', r, 0.01, (cx, cy - s * 0.12, cz), (math.pi / 2, 0, 0), 48, ('grille',)))
    for b in range(blades):
        a = 2 * math.pi * b / blades
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for vt in bm.verts: vt.co = Vector((vt.co.x * 0.006, vt.co.y * 0.07, vt.co.z * r * 0.72))
        bl = new_obj('blade', bm, [m])
        bl.matrix_world = Matrix.Translation((cx + math.cos(a) * r * 0.55, cy - s * 0.05, cz + math.sin(a) * r * 0.55)) @ Matrix.Rotation(-(a - math.pi / 2), 4, 'Y') @ Matrix.Rotation(0.55, 4, 'Z')
        add(bl)
    lathe('spinner', [(r * 0.3, -s * 0.1), (r * 0.3, 0.0), (r * 0.25, s * 0.06), (r * 0.12, s * 0.13), (0.0, s * 0.17)], (cx, cy, cz), m='metal')

for sx in (1, -1):
    x = sx * TX
    lathe('housing', [(0.04, -1.2), (0.2, -1.25), (0.31, -1.36), (0.36, -1.55), (0.37, -2.3), (0.385, -2.36), (0.385, TEXIT),
                      (TR, TEXIT + 0.01), (TR, -2.25)], (x, 0, TZ), m='paint')
    lathe('collar', [(0.375, -1.95), (0.392, -1.97), (0.392, -2.12), (0.375, -2.14)], (x, 0, TZ), m='darkmetal')
    lathe('lip', [(0.386, TEXIT + 0.04), (0.398, TEXIT + 0.02), (0.398, TEXIT), (TR, TEXIT - 0.005)], (x, 0, TZ), m='metal')
    fan(x, TEXIT + 0.12, TZ, TR, -1)

# ---------------- tail arch: two swept legs rise from the haunches beside the turbines, bow outwards and meet in a
# flattened crown over the canopy, the whole arch leaning back over the tail (models/source/atlas_tail_ref.png) ----------------
AZB, YB, LEAN = 0.98, -1.3, 0.75          # leg foot height and position, metres back per metre up
XF, XW, ZW, ZTOP = 0.88, 1.12, 1.7, 2.02   # foot / widest half-width, height of the widest point, crown height
leg = []
for k in range(25):                       # cubic: foot -> bowing out -> vertical at the widest point
    t = k / 24; P = [(XF, AZB - 0.16), (XF + 0.04, AZB + 0.3), (XW, ZW - 0.36), (XW, ZW)]
    leg.append(tuple(sum(c * p[i] for c, p in zip(((1 - t) ** 3, 3 * t * (1 - t) ** 2, 3 * t * t * (1 - t), t ** 3), P)) for i in (0, 1)))
crown = [(XW * math.cos(f), ZW + (ZTOP - ZW) * math.sin(f)) for f in np.linspace(0, math.pi, 49)]
c2 = [(-x, z) for x, z in leg] + list(reversed(crown))[1:-1] + list(reversed(leg))   # left foot -> crown -> right foot
c2 = np.array(c2); seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(c2, axis=0), axis=1))]
S = np.linspace(0, seg[-1], 161)
xs, zs = np.interp(S, seg, c2[:, 0]), np.interp(S, seg, c2[:, 1])
path = [Vector((x, YB - LEAN * (z - AZB), z)) for x, z in zip(xs, zs)]
prof = [(0.5, 0.0), (0.38, 0.38), (0.15, 0.5), (-0.2, 0.46), (-0.5, 0.12), (-0.5, -0.12), (-0.2, -0.46), (0.15, -0.5), (0.38, -0.38)]
secs = []
for i, p in enumerate(path):
    T = path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)]
    Cd = Vector((0, 1, 0))                                   # chord always fore-aft and level: fins in the legs, a wing in the crown
    Wd = Vector((-T.z, 0, T.x)).normalized()                 # thickness across the arch, in its own plane
    d = min(S[i], S[-1] - S[i]) / S[-1]                      # 0 at a foot, 0.5 at the crown
    foot = max(0.0, 1 - d / 0.16) ** 2                       # a smooth fillet into the haunch
    ch = 0.28 + 0.36 * foot + 0.06 * max(0.0, 1 - abs(d - 0.5) / 0.15)   # broad fins at the feet, a wider crown
    th = 0.09 + 0.06 * foot
    c0 = p + Cd * (0.5 * (ch - 0.28))                        # the foot grows forwards: the trailing edge stays one clean line
    secs.append([tuple(c0 + Cd * (u * ch) + Wd * (w * th)) for u, w in prof])
add(section_loft('arch', secs, ['paint']))

finish(body, 'atlas', WR, WX, wheel_w=0.36, rear=[(TX, TEXIT, TZ), (-TX, TEXIT, TZ)], side=(1.18, 0.45))
