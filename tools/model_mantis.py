# MANTIS: open-wheel single-seater, hand-modelled from models/source/mantis_{front,rear}.png.
# blender -b -P tools/model_mantis.py -- models/mantis.glb [--renders DIR] [--blend models/source/mantis.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.40, 0.98            # kit wheel radius / centre x (open wheels stand clear of the body)
HUB_X = WX - 0.18              # inner face of the tyre, where the suspension arms end

# ---------------- monocoque: needle nose -> cockpit -> engine cover -> round tail ----------------
Y0, Y1 = -1.80, 2.62
W = pchip([(-1.80, 0.22), (-1.5, 0.25), (-1.0, 0.30), (-0.5, 0.33), (0.0, 0.33), (0.5, 0.28), (1.0, 0.21), (1.6, 0.16), (2.2, 0.11), (2.62, 0.05)])
ZB = pchip([(-1.80, 0.17), (-1.4, 0.11), (1.0, 0.11), (1.8, 0.14), (2.3, 0.17), (2.62, 0.2)])
ZT = pchip([(-1.80, 0.64), (-1.4, 0.66), (-0.9, 0.66), (-0.5, 0.67), (0.3, 0.69), (0.8, 0.62), (1.4, 0.50), (2.0, 0.38), (2.62, 0.27)])
def control(y):
    w, zb, zt = W(y), ZB(y), ZT(y)
    zm = zb + (zt - zb) * 0.45
    return [(0.0, zb), (w * 0.7, zb), (w * 0.97, zb + 0.04), (w, zm), (w * 0.9, zt - (zt - zb) * 0.12), (w * 0.5, zt), (0.0, zt)]
SEG_N = [3, 2, 3, 3, 3, 3]
mono = loft('mono', control, SEG_N, lambda s, y: 2 if s == 0 else 0, Y0, Y1)

# cockpit: a rounded slot cut down into the tub
CK_Y, CK_HL, CK_HW, CK_E = -0.15, 0.40, 0.235, 3.0
def ck_point(t, grow=0.0):
    c, s = math.cos(t), math.sin(t)
    return (math.copysign(abs(c) ** (2 / CK_E), c) * (CK_HW + grow), CK_Y + math.copysign(abs(s) ** (2 / CK_E), s) * (CK_HL + grow))
outline = [ck_point(2 * math.pi * i / 64) for i in range(64)]
cut = section_loft('ck', [[(x, y, 0.36) for x, y in outline], [(x, y, 1.5) for x, y in outline]], ['black'])
boolean(mono, cut)

# side pods: rounded boxes either side of the tub, an intake at the front, tapering to the gearbox (coke bottle)
SPW = pchip([(0.42, 0.62), (0.2, 0.68), (-0.45, 0.68), (-1.05, 0.48), (-1.6, 0.25)])
SPT = pchip([(0.42, 0.50), (0.1, 0.53), (-0.5, 0.50), (-1.05, 0.40), (-1.6, 0.27)])
SPB = 0.13
pods = []
for sx in (1, -1):
    secs = []
    for y in np.linspace(0.42, -1.6, 30):
        xo, zt = SPW(y), SPT(y)
        rr = rounded([(0.15, SPB), (xo, SPB), (xo, zt), (0.15, zt)], 0.09, 4)
        # upper outer corner rounder than the rest
        secs.append([(sx * x, y, z) for x, z in rr])
    pods.append(section_loft('pod', secs, ['paint']))
# intakes: a black recessed mouth on each pod front
for sx in (1, -1):
    rr = rounded([(0.3, 0.18), (0.6, 0.18), (0.6, 0.47), (0.3, 0.47)], 0.07, 4)
    bm = bmesh.new(); vs = [bm.verts.new((sx * x, 0.425, z)) for x, z in rr]; bm.faces.new(vs if sx < 0 else list(reversed(vs)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); add(new_obj('intake', bm, ['grille']))

# airbox: a narrow hump behind the driver's head with an intake mouth, fading into the engine cover
secs = []
for y in np.linspace(-0.58, -1.55, 22):
    t = (y + 0.58) / -0.97
    hw = 0.13 - 0.05 * t
    top = 0.98 - 0.36 * t ** 1.3
    rr = rounded([(-hw, 0.55), (hw, 0.55), (hw * 0.8, top), (-hw * 0.8, top)], 0.06, 4)
    secs.append([(x, y, z) for x, z in rr])
add(section_loft('airbox', secs, ['paint']))
rr = rounded([(-0.085, 0.76), (0.085, 0.76), (0.07, 0.93), (-0.07, 0.93)], 0.04, 4)
bm = bmesh.new(); vs = [bm.verts.new((x, -0.575, z)) for x, z in rr]; bm.faces.new(list(reversed(vs)))
bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:]); add(new_obj('airbox_mouth', bm, ['grille']))

refresh_many([mono] + pods)

# seat and steering wheel in the cockpit
box('seat', (0.36, 0.42, 0.08), (0, -0.32, 0.42), m='black')
box('seat_back', (0.38, 0.08, 0.36), (0, -0.52, 0.56), (0.25, 0, 0), m='black')
box('wheel', (0.2, 0.03, 0.1), (0, 0.18, 0.66), (-0.4, 0, 0), m='trim')

# aeroscreen glass: dark teardrop on the cowl ahead of the cockpit
top_decal('screen', ellipse(0, 0.42, 0.18, 0.3, 40), 'glass', 0.005)

# halo: a tube hoop round the driver's head on a centre pylon
for sx in (1, -1):
    tube('halo', bezier_pts([(0, 0.46, 0.68), (0, 0.36, 0.86), (sx * 0.17, 0.14, 0.95), (sx * 0.25, -0.18, 0.94), (sx * 0.27, -0.42, 0.82), (sx * 0.28, -0.52, 0.66)], 10), 0.028, 'black')

# mirrors on stalks
for sx in (1, -1):
    tube('mirror_stalk', [(sx * 0.27, 0.36, 0.62), (sx * 0.38, 0.33, 0.76)], 0.012, 'black')
    box('mirror', (0.14, 0.04, 0.08), (sx * 0.42, 0.33, 0.8), m='black')

# side vents on the pods (black mesh behind the cockpit)
for sx in (1, -1):
    side_decal('vent', [(-0.2, 0.42), (-0.62, 0.40), (-0.66, 0.22), (-0.22, 0.2)], 'grille', sx, 0.004)

# floor plank and bargeboards
box('floor', (1.42, 2.4, 0.03), (0, -0.48, 0.10), m='trim', bevel=0.3)
for sx in (1, -1):
    box('barge', (0.02, 0.4, 0.2), (sx * 0.62, 0.72, 0.2), (0, 0, sx * 0.12), m='paint', bevel=0.2)

# ---------------- wings ----------------
def wing(name, span, chord, thick, loc, pitch, m='paint'):
    """an airfoil-ish plane: a flattened lozenge section swept along x"""
    secs = []
    prof = [(-0.5, 0.0), (-0.3, 0.55), (0.15, 0.5), (0.5, 0.05), (0.5, -0.05), (0.15, -0.25), (-0.3, -0.35)]
    for x in (-span / 2, span / 2):
        secs.append([(x, cy * chord, cz * thick) for cy, cz in prof])
    ob = section_loft(name, secs, [m])
    ob.location = loc; ob.rotation_euler = (pitch, 0, 0); parts.append(ob); return ob

# front: main plane + a raised flap, big endplates
wing('fw_main', 1.96, 0.36, 0.05, (0, 2.42, 0.12), -0.05)
wing('fw_flap', 1.9, 0.2, 0.035, (0, 2.24, 0.22), -0.45)
for sx in (1, -1):
    bm = bmesh.new()
    pl = [(2.66, 0.08), (2.0, 0.08), (2.0, 0.34), (2.2, 0.40), (2.58, 0.24)]
    vs = [bm.verts.new((sx * 0.99, y, z)) for y, z in pl]; f = bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=[f], thickness=0.03)
    add(new_obj('fw_end', bm, ['paint']))
# rear: main plane + flap on swan-neck posts, tall endplates
wing('rw_main', 1.66, 0.42, 0.06, (0, -2.02, 1.02), 0.12)
wing('rw_flap', 1.62, 0.24, 0.04, (0, -1.86, 1.17), 0.5)
for sx in (1, -1):
    bm = bmesh.new()
    pl = [(-2.32, 0.8), (-1.72, 0.92), (-1.72, 1.32), (-2.32, 1.3)]
    vs = [bm.verts.new((sx * 0.84, y, z)) for y, z in pl]; f = bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=[f], thickness=0.035)
    add(new_obj('rw_end', bm, ['paint']))
    tube('rw_post', bezier_pts([(sx * 0.13, -1.45, 0.6), (sx * 0.14, -1.75, 0.8), (sx * 0.15, -1.98, 1.0)], 8), 0.03, 'trim')

# ---------------- suspension: wishbones from the tub to the hub carriers ----------------
for y in (AXLE_F, AXLE_R):
    fr = y > 0
    for sx in (1, -1):
        ix = 0.17 if fr else 0.26
        for z_in, z_out in ((0.47, 0.50), (0.2, 0.24)):
            tube('arm', [(sx * ix, y + 0.24, z_in), (sx * HUB_X, y, z_out), (sx * ix, y - 0.24, z_in)], 0.017, 'black')
        tube('track', [(sx * ix, y + (0.1 if fr else -0.1), 0.33), (sx * HUB_X, y + (0.1 if fr else -0.1), 0.35)], 0.014, 'black')
        add(cylinder('upright', 0.1, 0.06, (sx * (HUB_X - 0.02), y, WR - 0.01), (0, math.pi / 2, 0), 24, ('darkmetal',)))

# ---------------- thruster: ribbed collar on the tail and one big nozzle ----------------
NZ, NR, NEXIT = 0.42, 0.21, -2.30
lathe('collar', [(0.18, -1.6), (0.255, -1.72), (0.27, -1.98), (0.25, -2.04), (0.22, -2.06)], (0, 0, NZ), m='darkmetal')
for k in range(5):
    lathe('rib', [(0.268, -1.76 - k * 0.045), (0.282, -1.77 - k * 0.045), (0.282, -1.79 - k * 0.045), (0.268, -1.80 - k * 0.045)], (0, 0, NZ), m='trim')
nozzle(0, NZ, NR, NEXIT, depth=0.28, vanes=10)

# tail light: a small red bar under the wing (rain light)
box('rain_light', (0.12, 0.02, 0.05), (0, -1.62, 0.12), m='light_tail', bevel=0.2)
# nose: small headlight slit each side of the nose tip
for sx in (1, -1):
    box('head', (0.05, 0.12, 0.02), (sx * 0.08, 2.36, 0.33), (0, 0.15 * sx, 0), m='light_head', bevel=0.2)

for p in pods: parts.append(p)
finish(mono, 'mantis', WR, WX, wheel_w=0.35, rear=[(0, NEXIT, NZ)], side=(0.72, 0.36))
