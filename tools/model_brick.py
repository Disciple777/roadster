# BRICK: boxy 80s rally hatch with bolt-on box flares, roof wing and a rally-lamp pod.
# Hand-modelled from models/source/brick_{front,rear}.png.
# blender -b -P tools/model_brick.py -- models/brick.glb [--renders DIR] [--blend models/source/brick.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.43, 0.86
WZ = WR - 0.01

# ---------------- lower body: a slab-sided box with bolt-on flares round each axle ----------------
Y0, Y1 = -2.0, 2.06
WB = 0.9                                                       # body side, outside the flares
WF = pchip([(-2.0, 0.98), (-1.94, 1.07), (-0.98, 1.07), (-0.8, 0.9), (0.78, 0.9), (0.96, 1.06), (1.96, 1.06), (2.06, 0.98)])
ZB = pchip([(-2.0, 0.36), (-1.88, 0.3), (1.9, 0.3), (2.06, 0.36)])
ZT = pchip([(-2.0, 0.98), (-1.0, 0.98), (0.78, 0.97), (1.6, 0.93), (2.06, 0.9)])
ZFT = 0.86                                                     # top of the flares

def section(y, shrink=0.0):
    wf, zb, zt = max(WF(y), WB + 0.001) - shrink, ZB(y) + shrink, ZT(y) - shrink
    wb = WB - shrink
    half = [(wf - 0.1, zb), (wf, zb + 0.09), (wf, ZFT - 0.03), (wf - 0.03, ZFT), (wb, ZFT + 0.05), (wb, zt - 0.04),
            (wb - 0.05, zt), (wb * 0.45, zt + 0.012)]
    poly = [(-x, z) for x, z in reversed(half)] + half
    return [(x, y, z) for x, z in rounded(poly, 0.025, 2)]
ys = sorted(set(np.round(np.linspace(Y0 + 0.03, Y1 - 0.03, 120), 4).tolist()))
body = section_loft('body', [section(Y0, 0.03)] + [section(y) for y in ys] + [section(Y1, 0.03)], ['paint'])

for y in (AXLE_F, AXLE_R):
    for sx in (1, -1):
        boolean(body, cylinder('arch', 0.48, 0.8, (sx * 1.0, y, WZ), (0, math.pi / 2, 0), 64))

# ---------------- greenhouse: tall boxy cabin, raked screen, near-upright hatch ----------------
CAB = [(0.80, 0.985, 0.88), (0.55, 1.17, 0.84), (0.30, 1.36, 0.8), (0.04, 1.55, 0.75), (-0.2, 1.565, 0.75), (-1.0, 1.57, 0.75),
       (-1.62, 1.56, 0.75), (-1.74, 1.54, 0.76), (-1.84, 1.3, 0.82), (-1.95, 1.0, 0.88)]   # (y, roof z, roof half-width)
secs = []
for y, t, wr in CAB:
    zb = 0.92
    wl = 0.88
    half = [(wl, zb), (wl, min(t, 1.0)), (wr, max(t - 0.035, min(t, 1.0) + 0.001)), (wr - 0.04, t), (0.0, t + 0.01)]
    poly = [(-x, z) for x, z in reversed(half[:-1])] + half[:-1]
    secs.append([(x, y, z) for x, z in rounded(poly, 0.02, 2)])
cabin = section_loft('cabin', secs, ['paint'])
parts.append(cabin)
refresh_many([body, cabin])

# glass with black rubber frames
def window(fn, frame, glass, *a):
    fn('win_frame', frame, 'trim', *a, off=0.005)
    fn('glass', glass, 'glass', *a, off=0.009)
front_win = [(-0.7, 1.02), (0.7, 1.02), (0.63, 1.52), (-0.63, 1.52)]
screen = lambda n, poly, m, off=0.004: decal(n, poly, (0, 1.3, 0), (1, 0, 0), (0, 0, 1), (0, -1, 0), m, off)   # cast from just over the hood
window(screen, front_win, [(-0.66, 1.045), (0.66, 1.045), (0.6, 1.5), (-0.6, 1.5)])
window(rear_decal, [(-0.7, 1.08), (0.7, 1.08), (0.66, 1.5), (-0.66, 1.5)], [(-0.66, 1.1), (0.66, 1.1), (0.62, 1.48), (-0.62, 1.48)])
for sx in (1, -1):
    window(side_decal, [(0.66, 1.02), (-0.42, 1.02), (-0.42, 1.5), (0.06, 1.5)], [(0.62, 1.045), (-0.39, 1.045), (-0.39, 1.48), (0.08, 1.48)], sx)
    window(side_decal, [(-0.5, 1.02), (-1.66, 1.02), (-1.6, 1.5), (-0.5, 1.5)], [(-0.53, 1.045), (-1.62, 1.045), (-1.57, 1.48), (-0.53, 1.48)], sx)
    # door shut lines and handle
    for yy in (0.74, -0.46):
        side_decal('shut', [(yy + 0.006, 0.36), (yy - 0.006, 0.36), (yy - 0.006, 0.99), (yy + 0.006, 0.99)], 'trim', sx, 0.003, cuts=2)
    box('handle', (0.03, 0.14, 0.04), (sx * 0.905, -0.3, 0.9), m='trim', bevel=0.3)
    # side vent with slats on the front face of the rear flare
    side_decal('vent', [(-0.8, 0.5), (-0.95, 0.5), (-0.95, 0.83), (-0.8, 0.83)], 'grille', sx, 0.004)
    for k in range(6):
        z = 0.53 + k * 0.05
        side_decal('slat', [(-0.8, z), (-0.95, z), (-0.95, z + 0.018), (-0.8, z + 0.018)], 'trim', sx, 0.008, cuts=1)
    # mirrors
    box('mirror', (0.06, 0.16, 0.11), (sx * 1.0, 0.6, 1.1), m='black', bevel=0.2)
    tube('mirror_stalk', [(sx * 0.86, 0.62, 1.02), (sx * 0.98, 0.6, 1.07)], 0.015, 'black')
    # mudflaps behind every wheel
    for y in (AXLE_F, AXLE_R):
        box('mudflap', (0.2, 0.015, 0.32), (sx * 0.94, y - 0.52, 0.26), m='black', bevel=0.1)

# wipers
for sx in (1, -1):
    tube('wiper', [(sx * 0.05, 0.82, 1.0), (sx * 0.5, 0.62, 1.12)], 0.009, 'trim')
tube('rear_wiper', [(0.0, -1.9, 1.1), (0.36, -1.83, 1.3)], 0.009, 'trim')

# ---------------- nose: square lamps, slatted grille, four rally lamps on the hood ----------------
front_decal('grille_frame', [(-0.43, 0.6), (0.43, 0.6), (0.43, 0.84), (-0.43, 0.84)], 'trim', 0.004)
front_decal('grille', [(-0.4, 0.62), (0.4, 0.62), (0.4, 0.82), (-0.4, 0.82)], 'grille', 0.007)
for k in range(5):
    z = 0.64 + k * 0.036
    front_decal('grille_bar', [(-0.4, z), (0.4, z), (0.4, z + 0.012), (-0.4, z + 0.012)], 'trim', 0.01, cuts=1)
for sx in (1, -1):
    front_decal('hl_frame', [(sx * 0.45, 0.6), (sx * 0.8, 0.6), (sx * 0.8, 0.84), (sx * 0.45, 0.84)], 'trim', 0.004)
    front_decal('hl', [(sx * 0.48, 0.63), (sx * 0.77, 0.63), (sx * 0.77, 0.81), (sx * 0.48, 0.81)], 'light_head', 0.008)
# front bumper with a mesh intake
box('bumper_f', (2.0, 0.26, 0.3), (0, 2.13, 0.43), m='paint', bevel=0.12)
refresh_many([body, cabin] + [p for p in parts if p.name.startswith('bumper')])
front_decal('intake_f', rounded([(-0.55, 0.36), (0.55, 0.36), (0.55, 0.5), (-0.55, 0.5)], 0.02, 2), 'grille', 0.004)
for sx in (1, -1):
    front_decal('fog_mesh', [(sx * 0.68, 0.36), (sx * 0.9, 0.36), (sx * 0.9, 0.5), (sx * 0.68, 0.5)], 'grille', 0.004)
# rally lamp pod: four round lamps on a black bar at the front of the hood
zl = surf_z(0, 1.86, 0.92)
box('lamp_bar', (0.92, 0.1, 0.05), (0, 1.86, zl + 0.03), m='black', bevel=0.2)
for k in range(4):
    x = -0.345 + k * 0.23
    c = (x, 1.86, zl + 0.13)
    lathe('lamp_pot', [(0.07, -0.1), (0.1, -0.06), (0.105, 0.02), (0.1, 0.04), (0.09, 0.03)], c, m='black')
    lathe('lamp_lens', [(0.092, 0.025), (0.06, 0.04), (0.0, 0.045)], c, m='light_head')
    tube('lamp_stem', [(x, 1.82, zl + 0.04), (x, 1.82, zl + 0.06)], 0.02, 'black')
# hood vents
for sx in (1, -1):
    top_decal('hood_vent', [(sx * 0.3, 1.3), (sx * 0.56, 1.3), (sx * 0.56, 1.42), (sx * 0.3, 1.42)], 'grille', 0.004)

# ---------------- tail: square lamps, black panel, bumper with twin thrusters ----------------
refresh_many([body, cabin])
rear_decal('tail_panel', [(-0.5, 0.64), (0.5, 0.64), (0.5, 0.9), (-0.5, 0.9)], 'trim', 0.004)
rear_decal('tail_grille', [(-0.46, 0.67), (0.46, 0.67), (0.46, 0.87), (-0.46, 0.87)], 'grille', 0.007)
for k in range(5):
    z = 0.69 + k * 0.036
    rear_decal('tail_bar', [(-0.46, z), (0.46, z), (0.46, z + 0.012), (-0.46, z + 0.012)], 'trim', 0.01, cuts=1)
for sx in (1, -1):
    rear_decal('tl_frame', [(sx * 0.53, 0.6), (sx * 0.85, 0.6), (sx * 0.85, 0.92), (sx * 0.53, 0.92)], 'trim', 0.004)
    rear_decal('tl', [(sx * 0.56, 0.7), (sx * 0.82, 0.7), (sx * 0.82, 0.89), (sx * 0.56, 0.89)], 'light_tail', 0.008)
    rear_decal('rev', [(sx * 0.56, 0.63), (sx * 0.82, 0.63), (sx * 0.82, 0.68), (sx * 0.56, 0.68)], 'light_head', 0.008)
TX, TZ, TR, TEXIT = 0.32, 0.42, 0.13, -2.34
bumper = box('bumper_r', (2.04, 0.26, 0.32), (0, -2.08, 0.44), m='paint', bevel=0.12, keep=False)
for sx in (1, -1):
    boolean(bumper, cylinder('noz_hole', TR * 1.05, 0.6, (sx * TX, -2.1, TZ), (math.pi / 2, 0, 0), 48))
parts.append(bumper)
refresh(bumper)
for sx in (1, -1):
    rear_decal('mesh_r', [(sx * 0.62, 0.34), (sx * 0.92, 0.34), (sx * 0.92, 0.5), (sx * 0.62, 0.5)], 'grille', 0.004)
    lathe('noz_can', [(TR * 0.95, -1.95), (TR * 1.02, -2.0), (TR * 1.02, -2.24)], (sx * TX, 0, TZ), m='darkmetal')
    for k in range(3):
        y0 = -2.22 - k * 0.025
        lathe('noz_rib', [(TR * 1.02, y0), (TR * 1.1, y0 - 0.005), (TR * 1.1, y0 - 0.012), (TR * 1.02, y0 - 0.017)], (sx * TX, 0, TZ), m='trim')
    nozzle(sx * TX, TZ, TR, TEXIT, depth=0.14, vanes=8, m='metal')

# ---------------- roof wing on two posts, tall endplates ----------------
box('wing', (1.86, 0.44, 0.045), (0, -1.66, 1.8), (0.1, 0, 0), m='paint', bevel=0.3)
for sx in (1, -1):
    box('wing_post', (0.05, 0.16, 0.24), (sx * 0.42, -1.64, 1.67), (0.25, 0, 0), m='paint', bevel=0.2)
    bm = bmesh.new()
    pl = [(-1.42, 1.84), (-1.9, 1.86), (-1.92, 1.64), (-1.62, 1.62)]
    vs = [bm.verts.new((sx * 0.93, y, z)) for y, z in pl]; f = bm.faces.new(vs)
    bmesh.ops.solidify(bm, geom=[f], thickness=0.035)
    add(new_obj('wing_end', bm, ['paint']))

finish(body, 'brick', WR, WX, wheel_w=0.37, rear=[(-TX, TEXIT, TZ), (TX, TEXIT, TZ)], side=(0.92, 0.6))
