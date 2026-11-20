# RHINO: armoured off-road truck with slit windows, a ram plow, roof rails and two big thrusters on the roof corners.
# Hand-modelled from models/source/rhino_{front,rear}.png.
# blender -b -P tools/model_rhino.py -- models/rhino.glb [--renders DIR] [--blend models/source/rhino.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.52, 1.10
WZ = WR - 0.01

# ---------------- lower hull: chamfered armour slab, box flares round the wheels ----------------
Y0, Y1 = -2.1, 2.2
WB = 1.02
WF = pchip([(-2.1, 1.1), (-2.02, 1.22), (-0.86, 1.22), (-0.66, 1.02), (0.64, 1.02), (0.84, 1.21), (2.02, 1.21), (2.2, 1.08)])
ZB = pchip([(-2.1, 0.62), (-1.95, 0.56), (1.9, 0.56), (2.2, 0.6)])
ZT = pchip([(-2.1, 1.32), (-1.0, 1.33), (0.95, 1.33), (1.6, 1.26), (2.2, 1.16)])
ZFT = 1.13

def section(y, shrink=0.0):
    wf, zb, zt = max(WF(y), WB + 0.001) - shrink, ZB(y) + shrink, ZT(y) - shrink
    wb = WB - shrink
    half = [(wf - 0.12, zb), (wf, zb + 0.12), (wf, ZFT - 0.07), (wf - 0.07, ZFT), (wb, ZFT + 0.06), (wb, zt - 0.13),
            (wb - 0.14, zt), (wb * 0.45, zt + 0.02)]
    poly = [(-x, z) for x, z in reversed(half)] + half
    return [(x, y, z) for x, z in rounded(poly, 0.02, 2)]
ys = sorted(set(np.round(np.linspace(Y0 + 0.05, Y1 - 0.05, 120), 4).tolist()))
body = section_loft('body', [section(Y0, 0.05)] + [section(y) for y in ys] + [section(Y1, 0.05)], ['paint'])
for y in (AXLE_F, AXLE_R):
    for sx in (1, -1):
        boolean(body, cylinder('arch', 0.6, 0.9, (sx * 1.15, y, WZ), (0, math.pi / 2, 0), 64))

# ---------------- armoured cabin: short raked screen under a brow, flat roof, chamfered edges ----------------
CAB = [(0.98, 1.34, 0.9), (0.55, 1.8, 0.84), (0.5, 1.88, 0.86), (0.38, 2.0, 0.86), (-0.4, 2.02, 0.86), (-1.6, 2.02, 0.86),
       (-1.96, 1.98, 0.86), (-2.08, 1.62, 0.92), (-2.1, 1.36, 0.98)]   # (y, roof z, roof half-width)
secs = []
for y, t, wr in CAB:
    wl = 0.99
    half = [(wl, 1.25), (wl, max(min(t - 0.2, 1.8), 1.34)), (wr, t), (0.0, t + 0.01)]
    poly = [(-x, z) for x, z in reversed(half[:-1])] + half[:-1]
    secs.append([(x, y, z) for x, z in rounded(poly, 0.02, 2)])
cabin = section_loft('cabin', secs, ['paint'])

# thruster bays cut into the rear roof corners
TX, TZ, TR, TEXIT = 0.46, 1.95, 0.27, -2.44
for sx in (1, -1):
    boolean(cabin, cylinder('bay', TR + 0.04, 1.4, (sx * TX, -2.2, TZ), (math.pi / 2, 0, 0), 48))
parts.append(cabin)
refresh_many([body, cabin])

# slit windows with black frames
def window(fn, frame, glass, *a):
    fn('win_frame', frame, 'trim', *a, off=0.005)
    fn('glass', glass, 'glass', *a, off=0.009)
screen = lambda n, poly, m, off=0.004: decal(n, poly, (0, 1.6, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0), m, off)
for sx in (1, -1):
    window(screen, [(sx * 0.03, 1.45), (sx * 0.8, 1.45), (sx * 0.76, 1.74), (sx * 0.03, 1.74)],
           [(sx * 0.06, 1.47), (sx * 0.77, 1.47), (sx * 0.73, 1.72), (sx * 0.06, 1.72)])
    window(side_decal, [(0.42, 1.6), (-0.3, 1.6), (-0.3, 1.82), (0.36, 1.82)], [(0.39, 1.62), (-0.27, 1.62), (-0.27, 1.8), (0.34, 1.8)], sx)
    window(side_decal, [(-0.48, 1.6), (-1.32, 1.6), (-1.32, 1.82), (-0.48, 1.82)], [(-0.51, 1.62), (-1.29, 1.62), (-1.29, 1.8), (-0.51, 1.8)], sx)
    # door shut lines, hinges and handles
    for yy, zt in ((0.62, 1.68), (-0.38, 1.9), (-1.42, 1.9)):
        side_decal('shut', [(yy + 0.007, 0.7), (yy - 0.007, 0.7), (yy - 0.007, zt), (yy + 0.007, zt)], 'trim', sx, 0.003, cuts=2)
    for yy, z in ((0.56, 1.0), (0.56, 1.5), (-0.44, 1.0), (-0.44, 1.5)):
        box('hinge', (0.05, 0.08, 0.12), (sx * 1.0, yy, z), m='darkmetal', bevel=0.2)
    for yy in (-0.25, -1.28):
        box('handle', (0.05, 0.14, 0.05), (sx * 1.0, yy, 1.35), m='darkmetal', bevel=0.3)
    # rear quarter vent
    side_decal('vent', [(-1.55, 1.55), (-1.85, 1.55), (-1.85, 1.75), (-1.55, 1.75)], 'grille', sx, 0.004)
    for k in range(4):
        z = 1.57 + k * 0.045
        side_decal('slat', [(-1.55, z), (-1.85, z), (-1.85, z + 0.02), (-1.55, z + 0.02)], 'trim', sx, 0.008, cuts=1)
    # mirrors
    box('mirror', (0.08, 0.2, 0.26), (sx * 1.22, 0.72, 1.6), m='black', bevel=0.15)
    tube('mirror_arm', [(sx * 0.99, 0.74, 1.45), (sx * 1.12, 0.74, 1.45), (sx * 1.18, 0.72, 1.5)], 0.025, 'black')
    # running board between the flares
    box('step', (0.14, 1.36, 0.06), (sx * 1.06, 0.0, 0.62), m='black', bevel=0.2)
    for yy in (-0.5, 0.5):
        box('step_mount', (0.1, 0.05, 0.08), (sx * 1.0, yy, 0.66), m='black', bevel=0.2)
# hood seams and scoops
top_decal('hood_seam', [(-0.42, 1.0), (-0.41, 1.0), (-0.41, 2.0), (-0.42, 2.0)], 'trim', 0.003, cuts=2)
top_decal('hood_seam', [(0.41, 1.0), (0.42, 1.0), (0.42, 2.0), (0.41, 2.0)], 'trim', 0.003, cuts=2)
for sx in (1, -1):
    x = sx * 0.66
    box('scoop', (0.22, 0.14, 0.06), (x, 1.5, surf_z(x, 1.5, 1.3) + 0.02), (-0.06, 0, 0), m='paint', bevel=0.2)
    box('scoop_mouth', (0.17, 0.01, 0.035), (x, 1.575, surf_z(x, 1.5, 1.3) + 0.03), m='grille', bevel=0.1)
# roof hatch
box('roof_hatch', (0.7, 0.5, 0.04), (0, 0.0, 2.03), m='paint', bevel=0.2)

# ---------------- nose: LED bars, armoured grille, bull bar, ram plow ----------------
front_decal('grille_frame', rounded([(-0.42, 0.7), (0.42, 0.7), (0.42, 1.02), (-0.42, 1.02)], 0.04, 2), 'trim', 0.004)
front_decal('grille', [(-0.38, 0.73), (0.38, 0.73), (0.38, 0.99), (-0.38, 0.99)], 'grille', 0.007)
for k in range(5):
    z = 0.76 + k * 0.045
    front_decal('grille_bar', [(-0.38, z), (0.38, z), (0.38, z + 0.018), (-0.38, z + 0.018)], 'trim', 0.011, cuts=1)
for sx in (1, -1):
    # lamp housings are boxes on the flat nose plate (decals tear on its chamfered edge)
    box('hl_frame', (0.36, 0.04, 0.12), (sx * 0.68, Y1, 0.96), m='trim', bevel=0.2)
    box('hl', (0.28, 0.02, 0.04), (sx * 0.68, Y1 + 0.02, 0.96), m='light_head', bevel=0.2)
    box('fog_frame', (0.24, 0.04, 0.1), (sx * 0.72, Y1, 0.77), m='trim', bevel=0.2)
    box('fog', (0.16, 0.02, 0.04), (sx * 0.72, Y1 + 0.02, 0.77), m='light_head', bevel=0.2)

def plow(name, y_face, sgn):
    """a wedge bumper: deep at the top, angled back underneath, three vertical ribs and two shackles"""
    secs = []
    for x in (-1.05, -0.95, 0.95, 1.05):
        inset = 0.06 if abs(x) > 1.0 else 0.0
        prof = [(y_face - sgn * 0.3, 0.68), (y_face - sgn * inset, 0.68), (y_face - sgn * inset, 0.56), (y_face - sgn * (0.12 + inset), 0.34), (y_face - sgn * 0.3, 0.34)]
        secs.append([(x, y, z) for y, z in prof])
    add(section_loft(name, secs, ['paint']))
    for x in (-0.4, 0.0, 0.4):
        box('rib', (0.1, 0.06, 0.3), (x, y_face + sgn * 0.0, 0.5), (sgn * 0.12, 0, 0), m='paint', bevel=0.15)
    for sx in (1, -1):
        pts = [(sx * 0.75 + 0.06 * math.cos(2 * math.pi * i / 16), y_face + sgn * 0.03, 0.6 + 0.06 * math.sin(2 * math.pi * i / 16)) for i in range(17)]
        tube('shackle', pts, 0.016, 'darkmetal')
    # bull bar: black tube loops round the lamps
    tube('bar', [(-0.95, y_face - sgn * 0.05, 0.66), (-0.95, y_face + sgn * 0.08, 0.86), (-0.5, y_face + sgn * 0.08, 0.86), (-0.5, y_face + sgn * 0.02, 0.66)], 0.04, 'black')
    tube('bar', [(0.95, y_face - sgn * 0.05, 0.66), (0.95, y_face + sgn * 0.08, 0.86), (0.5, y_face + sgn * 0.08, 0.86), (0.5, y_face + sgn * 0.02, 0.66)], 0.04, 'black')
    tube('bar', [(-0.5, y_face + sgn * 0.08, 0.86), (-0.5, y_face + sgn * 0.12, 0.94), (0.5, y_face + sgn * 0.12, 0.94), (0.5, y_face + sgn * 0.08, 0.86)], 0.04, 'black')
plow('plow_f', 2.4, 1)

# ---------------- tail: lamp clusters, door panel, plow, roof thrusters ----------------
refresh_many([body, cabin])
rear_decal('door_panel', rounded([(-0.62, 0.86), (0.62, 0.86), (0.62, 1.5), (-0.62, 1.5)], 0.06, 2), 'trim', 0.003)
rear_decal('door_panel_in', rounded([(-0.6, 0.88), (0.6, 0.88), (0.6, 1.48), (-0.6, 1.48)], 0.05, 2), 'paint', 0.005)
for poly in ([(-0.6, 0.8), (0.6, 0.8), (0.6, 0.815), (-0.6, 0.815)], [(-0.6, 1.3), (0.6, 1.3), (0.6, 1.315), (-0.6, 1.315)],
             [(-0.6, 0.8), (-0.585, 0.8), (-0.585, 1.315), (-0.6, 1.315)], [(0.585, 0.8), (0.6, 0.8), (0.6, 1.315), (0.585, 1.315)]):
    rear_decal('door_line', poly, 'trim', 0.004, cuts=2)
for sx in (1, -1):
    rear_decal('tl_frame', rounded([(sx * 0.68, 0.98), (sx * 0.95, 0.98), (sx * 0.95, 1.26), (sx * 0.68, 1.26)], 0.03, 2), 'trim', 0.004)
    for z in (1.03, 1.15):
        rear_decal('tl', [(sx * 0.72, z), (sx * 0.91, z), (sx * 0.91, z + 0.07), (sx * 0.72, z + 0.07)], 'light_tail', 0.008)
    for z in (0.9, 1.2):
        box('rear_hinge', (0.06, 0.05, 0.1), (sx * 0.63, -2.1, z), m='darkmetal', bevel=0.2)
plow('plow_r', -2.36, -1)

for sx in (1, -1):
    x = sx * TX
    lathe('pod', [(0.16, -1.15), (0.24, -1.3), (TR + 0.02, -1.5), (TR + 0.02, -2.2), (TR, TEXIT + 0.12)], (x, 0, TZ), m='darkmetal')
    for y0, w in ((-1.55, 0.14), (-2.0, 0.18)):
        lathe('pod_ring', [(TR + 0.01, y0), (TR + 0.06, y0 - 0.02), (TR + 0.06, y0 - w), (TR + 0.01, y0 - w - 0.02)], (x, 0, TZ), m='black', segs=24)
    nozzle(x, TZ, TR, TEXIT, depth=0.32, vanes=10, lip=1.1, m='black')
    # saddle mounting the pod in its bay
    box('pod_saddle', (0.16, 0.5, 0.12), (x, -1.75, TZ - TR - 0.02), m='darkmetal', bevel=0.2)

# ---------------- roof rails ----------------
for sx in (1, -1):
    x = sx * 0.66
    tube('rail', [(x, 0.45, 2.03), (x, 0.38, 2.17), (x, 0.25, 2.19), (x, -1.2, 2.19), (x, -1.33, 2.17), (x, -1.4, 2.03)], 0.035, 'black')
    for yy in (0.38, -0.4, -1.33):
        box('rail_foot', (0.08, 0.1, 0.16), (x, yy, 2.08), m='black', bevel=0.2)

finish(body, 'rhino', WR, WX, wheel_w=0.5, rear=[(-TX, TEXIT, TZ), (TX, TEXIT, TZ)], side=(1.1, 0.85), cam_h=1.4)
