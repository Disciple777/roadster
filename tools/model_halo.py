# HALO: 1950s jet-age teardrop with a bubble canopy, tail fins and a turbine at each end.
# Hand-modelled from models/source/halo_{front,rear}.png.
# blender -b -P tools/model_halo.py -- models/halo.glb [--renders DIR] [--blend models/source/halo.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.37, 0.76   # tyre tops stay under the fender skin (0.40 poked through the front fenders)
WZ = WR - 0.01

Y0, Y1 = -2.2, 2.4
W = pchip([(-2.2, 0.34), (-2.0, 0.66), (-1.75, 0.98), (-1.45, 1.06), (-1.0, 1.02), (-0.3, 0.93), (0.5, 0.93), (1.1, 0.98), (1.45, 1.0),
           (1.85, 0.94), (2.15, 0.78), (2.33, 0.56), (2.4, 0.3)])
ZB = pchip([(-2.2, 0.36), (-1.9, 0.22), (-1.5, 0.19), (1.6, 0.19), (2.1, 0.24), (2.33, 0.3), (2.4, 0.4)])
ZW = pchip([(-2.2, 0.52), (-1.5, 0.58), (-0.6, 0.52), (0.7, 0.52), (1.42, 0.72), (2.0, 0.6), (2.4, 0.48)])   # front fender bulge over the wheels
ZT = pchip([(-2.2, 0.64), (-1.9, 0.76), (-1.4, 0.84), (-0.5, 0.86), (0.6, 0.86), (1.42, 0.87), (1.9, 0.77), (2.25, 0.68), (2.4, 0.58)])
def control(y):
    w, zb, zw, zt = W(y), ZB(y), ZW(y), ZT(y)
    return [(0.0, zb), (w * 0.62, zb), (w * 0.93, zb + (zw - zb) * 0.35), (w, zw), (w * 0.94, zw + (zt - zw) * 0.6),
            (w * 0.62, zt - 0.02), (0.0, zt)]
body = loft('body', control, [3, 3, 3, 4, 4, 4], lambda s, y: 0, Y0, Y1)

# front arches open; rear wheels hidden under skirts (only the bottom of the tyre shows)
for sx in (1, -1):
    boolean(body, cylinder('arch', 0.42, 0.8, (sx * 0.95, AXLE_F, WZ), (0, math.pi / 2, 0), 64))
    boolean(body, cylinder('skirt', 0.62, 0.8, (sx * 0.95, AXLE_R, -0.16), (0, math.pi / 2, 0), 64))

# nose intake: a round hole with a turbine fan and spinner
IZ, IR = 0.47, 0.28
boolean(body, cylinder('intake', IR, 1.0, (0, 2.4, IZ), (math.pi / 2, 0, 0), 64))

# cockpit well under the canopy
CY, CRX, CRY = -0.05, 0.66, 0.95
ell = [(CRX * 0.95 * math.cos(2 * math.pi * i / 64), CY + CRY * 0.95 * math.sin(2 * math.pi * i / 64)) for i in range(64)]
boolean(body, section_loft('ck', [[(x, y, 0.5) for x, y in ell], [(x, y, 1.6) for x, y in ell]], ['black']))
refresh(body)
NOSE_Y = 2.3   # where the nose skin meets the intake (a surf_y probe misses down the hole)

def fan(cy, cz, r, facing, blades=24, m='darkmetal'):
    """a turbine face: twisted blades round a spinner cone pointing out of the car, a dark back plate"""
    s = facing   # +1 faces forward, -1 backward
    add(cylinder('fan_back', r, 0.01, (0, cy - s * 0.12, cz), (math.pi / 2, 0, 0), 48, ('grille',)))
    for b in range(blades):
        a = 2 * math.pi * b / blades
        bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1.0)
        for vt in bm.verts: vt.co = Vector((vt.co.x * 0.006, vt.co.y * 0.07, vt.co.z * r * 0.72))
        bl = new_obj('blade', bm, [m])
        bl.matrix_world = Matrix.Translation((math.cos(a) * r * 0.55, cy - s * 0.05, cz + math.sin(a) * r * 0.55)) @ Matrix.Rotation(-(a - math.pi / 2), 4, 'Y') @ Matrix.Rotation(0.55, 4, 'Z')
        add(bl)
    lathe('spinner', [(r * 0.3, -s * 0.1), (r * 0.3, 0.0), (r * 0.25, s * 0.06), (r * 0.12, s * 0.13), (0.0, s * 0.17)], (0, cy, cz), m='metal')

# front intake: chrome lip, fan inside
lathe('intake_lip', [(IR - 0.01, -0.3), (IR + 0.03, -0.3), (IR + 0.035, 0.0), (IR + 0.03, 0.025), (IR, 0.03), (IR - 0.02, 0.0)], (0, NOSE_Y, IZ), m='metal')
fan(NOSE_Y - 0.08, IZ, IR, 1)

# round headlights in chrome bezels either side of the intake
for sx in (1, -1):
    x, z = sx * 0.6, 0.5
    yf = surf_y(x, z)
    lathe('bezel', [(0.14, -0.08), (0.14, 0.0), (0.125, 0.025), (0.105, 0.03), (0.1, 0.0)], (x, yf, z), m='metal')
    lathe('lens', [(0.103, 0.0), (0.09, 0.02), (0.05, 0.03), (0.0, 0.032)], (x, yf, z), m='light_head')

# bubble canopy: half ellipsoid of glass, black frame ring and two hoops
CZ, CRZ = 0.78, 0.54
bm = bmesh.new()
bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=1.0)
bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -0.02], context='VERTS')
for v in bm.verts: v.co = Vector((v.co.x * CRX, CY + v.co.y * CRY, CZ + max(v.co.z, 0.0) * CRZ))
can = new_obj('canopy', bm, ['glass']); add(can)
ring_pts = [(CRX * 1.005 * math.cos(2 * math.pi * i / 64), CY + CRY * 1.005 * math.sin(2 * math.pi * i / 64), CZ + 0.06) for i in range(65)]
tube('canopy_ring', ring_pts, 0.022, 'trim')
for yo in (0.3, -0.35):
    k = math.sqrt(1 - (yo / CRY) ** 2)
    pts = [(CRX * k * 1.01 * math.cos(math.pi * i / 40), CY + yo, CZ + CRZ * k * 1.01 * math.sin(math.pi * i / 40)) for i in range(41)]
    tube('hoop', pts, 0.014, 'trim')
for sx in (1, -1):
    box('seat', (0.42, 0.42, 0.12), (sx * 0.3, -0.3, 0.6), m='black')
    box('seat_back', (0.44, 0.1, 0.5), (sx * 0.3, -0.56, 0.84), (0.22, 0, 0), m='black')
box('dash', (1.1, 0.24, 0.14), (0, 0.62, 0.8), (-0.3, 0, 0), m='black')

# tail fins: lens-section blades sweeping up off the rear fenders
FIN = bezier_pts([(-0.55, 0.62), (-0.8, 0.86), (-1.35, 0.98), (-1.85, 1.16), (-2.22, 1.46)], 8)[:-1] + \
      [(-2.22, 1.46), (-2.3, 1.43)] + bezier_pts([(-2.27, 1.32), (-2.12, 1.0), (-2.05, 0.8), (-2.0, 0.62)], 6)
FIN = [(p[0], p[1]) for p in FIN]
cy_, cz_ = sum(p[0] for p in FIN) / len(FIN), 0.62
for sx in (1, -1):
    x = sx * 0.6
    secs = []
    for dx, s in ((-0.07, 0.86), (-0.045, 0.96), (0.0, 1.0), (0.045, 0.96), (0.07, 0.86)):
        secs.append([(x + dx, cy_ + (y - cy_) * s, cz_ + (z - cz_) * s) for y, z in FIN])
    add(section_loft('fin', secs, ['paint']))

# tail turbine: grooved housing out of the tail cone, fan face looking back
TZ, TR, TEXIT = 0.5, 0.27, -2.48
lathe('housing', [(0.2, -1.75), (0.29, -1.95), (0.31, -2.3), (0.33, -2.33), (0.33, TEXIT), (TR, TEXIT + 0.01), (TR, -2.2)], (0, 0, TZ), m='darkmetal')
for k in range(5):
    y0 = -2.0 - k * 0.06
    lathe('groove', [(0.309, y0), (0.318, y0 - 0.01), (0.318, y0 - 0.03), (0.309, y0 - 0.04)], (0, 0, TZ), m='trim')
fan(TEXIT + 0.1, TZ, TR, -1)

# small round tail lamps on the fender tips
for sx in (1, -1):
    yb = surf_y(sx * 0.7, 0.5, front=False)
    lathe('tail_lamp', [(0.06, 0.04), (0.06, 0.0), (0.04, -0.012), (0.0, -0.015)], (sx * 0.7, yb, 0.5), m='light_tail')

finish(body, 'halo', WR, WX, wheel_w=0.32, rear=[(0, TEXIT, TZ)], side=(1.02, 0.45))
