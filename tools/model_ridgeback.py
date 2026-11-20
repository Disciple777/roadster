# RIDGEBACK: long-travel desert buggy, hand-modelled from models/source/ridgeback_{front,rear}.png.
# blender -b -P tools/model_ridgeback.py -- models/ridgeback.glb [--renders DIR] [--blend models/source/ridgeback.blend]
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *

WR, WX = 0.52, 1.15
HUB_X = WX - 0.24

# ---------------- faceted tub: chamfered sections, narrow at the bottom, flared at the shoulders ----------------
Y0, Y1 = -1.68, 1.98
ZB = pchip([(-1.68, 0.62), (-1.4, 0.47), (1.5, 0.47), (1.98, 0.64)])
ZT = pchip([(-1.68, 0.96), (-1.0, 0.98), (0.5, 0.98), (1.4, 0.92), (1.98, 0.80)])
ZC = pchip([(-1.68, 0.96), (-1.0, 0.98), (0.4, 1.0), (0.7, 1.04), (1.4, 0.98), (1.98, 0.82)])
WB = pchip([(-1.68, 0.46), (-1.3, 0.52), (1.5, 0.52), (1.98, 0.42)])
WT = pchip([(-1.68, 0.76), (-1.3, 0.88), (-0.95, 0.84), (0.4, 0.80), (0.8, 0.86), (1.5, 0.86), (1.98, 0.6)])
def section(y):
    zb, zt, zc, wb, wt = ZB(y), ZT(y), ZC(y), WB(y), WT(y)
    zm = zb + (zt - zb) * 0.55
    half = [(wb, zb), (wt - 0.03, zm), (wt, zt - 0.07), (wt - 0.08, zt), (wt * 0.45, zc)]
    poly = [(-x, z) for x, z in reversed(half)] + half
    return [(x, y, z) for x, z in rounded(poly, 0.035, 2)]
ys = sorted(set(np.round(np.linspace(Y0, Y1, 60), 4).tolist()))
body = section_loft('tub', [section(y) for y in ys], ['paint', 'black'])

# open cockpit
cut = box('ck', (1.32, 1.72, 1.6), (0, -0.30, 1.42), m='black', bevel=0.04, keep=False)
boolean(body, cut)
refresh(body)

# hood scoops and vents
for sx in (1, -1):
    top_decal('hood_vent', [(sx * 0.22, 1.05), (sx * 0.5, 1.12), (sx * 0.48, 1.24), (sx * 0.24, 1.2)], 'grille', 0.004)
    top_decal('fender_vent', [(sx * 0.6, 0.85), (sx * 0.8, 0.85), (sx * 0.8, 1.05), (sx * 0.62, 1.0)], 'grille', 0.004)
# headlights: angled slits at the nose corners, three cells each
for sx in (1, -1):
    poly = [(0.38, 0.73), (0.62, 0.76), (0.62, 0.81), (0.4, 0.80)]
    front_decal('hl_bezel', [(sx * x, z) for x, z in poly], 'trim', 0.004)
    for k in range(3):
        x0 = 0.41 + k * 0.07
        front_decal('hl', [(sx * x0, 0.75 + k * 0.004), (sx * (x0 + 0.055), 0.755 + k * 0.004), (sx * (x0 + 0.055), 0.795), (sx * x0, 0.79)], 'light_head', 0.007)
# tail: red bars and a black mesh centre panel
for sx in (1, -1):
    rear_decal('tail', [(sx * 0.42, 0.86), (sx * 0.74, 0.86), (sx * 0.72, 0.92), (sx * 0.44, 0.93)], 'light_tail', 0.006)
rear_decal('rear_mesh', [(-0.36, 0.62), (0.36, 0.62), (0.36, 0.9), (-0.36, 0.9)], 'grille', 0.004)
# side: black lower panel behind the front wheel
for sx in (1, -1):
    side_decal('side_panel', [(0.55, 0.55), (-1.05, 0.55), (-1.05, 0.7), (0.6, 0.66)], 'trim', sx, 0.004)

# skid plates front and back, with slots
for yy, pitch, sgn in ((1.92, 0.75, 1), (-1.62, -0.75, -1)):
    box('skid', (0.86, 0.42, 0.035), (0, yy + sgn * 0.08, 0.47), (pitch, 0, 0), m='paint', bevel=0.2)
    for k in (-1, 0, 1):
        box('slot', (0.06, 0.16, 0.012), (k * 0.14, yy + sgn * 0.13, 0.47 + 0.05), (pitch, 0, 0), m='grille', bevel=0.3)

# cabin: two bucket seats, dash, windscreen
for sx in (1, -1):
    box('seat', (0.42, 0.44, 0.12), (sx * 0.32, -0.45, 0.66), m='black')
    box('seat_back', (0.44, 0.12, 0.72), (sx * 0.32, -0.74, 1.0), (0.2, 0, 0), m='black')
box('dash', (1.2, 0.3, 0.16), (0, 0.42, 0.96), (-0.3, 0, 0), m='black')
bm = bmesh.new()
vs = [bm.verts.new(p) for p in ((-0.66, 0.56, 1.0), (0.66, 0.56, 1.0), (0.6, 0.06, 1.66), (-0.6, 0.06, 1.66))]
bm.faces.new(vs); ws = new_obj('windscreen', bm, ['glass'])
mo = ws.modifiers.new('s', 'SOLIDIFY'); mo.thickness = 0.012
bpy.context.view_layer.objects.active = ws; bpy.ops.object.modifier_apply(modifier=mo.name); add(ws)

# ---------------- roll cage, body colour ----------------
CR = 0.042
def cage(pts, r=CR, smooth=True):
    tube('cage', bezier_pts(pts, 8) if smooth and len(pts) > 2 else pts, r, 'paint')
def both(pts, **k):
    cage(pts, **k); cage([(-x, y, z) for x, y, z in pts], **k)
# A-pillars, roof rails running back and down to the tail, main hoop
both([(0.70, 0.62, 0.98), (0.66, 0.30, 1.38), (0.60, 0.04, 1.68), (0.62, -0.5, 1.76), (0.60, -1.1, 1.62), (0.55, -1.6, 1.28), (0.5, -1.9, 0.98)])
both([(0.62, -0.72, 1.74), (0.70, -0.82, 1.3), (0.76, -0.88, 0.98)])
both([(0.72, 0.5, 1.22), (0.74, -0.2, 1.26), (0.76, -0.86, 1.22)], smooth=False)       # door bar
both([(0.72, 0.3, 0.99), (0.73, -0.3, 1.24), (0.66, -0.8, 1.6)], smooth=False)       # door diagonal
cage([(-0.60, 0.04, 1.68), (0.60, 0.04, 1.68)], smooth=False)
cage([(-0.62, -0.72, 1.74), (0.62, -0.72, 1.74)], smooth=False)
cage([(-0.58, -1.35, 1.48), (0.58, -1.35, 1.48)], smooth=False)
both([(0.62, -0.72, 1.74), (0.0, -1.35, 1.48)], smooth=False)                          # roof X
# front: tubes from the cowl over the hood corners down to the bumper, bumper cage with uprights
both([(0.66, 0.62, 1.0), (0.56, 1.25, 1.02), (0.46, 1.9, 0.86), (0.42, 2.14, 0.72)])
cage([(0.42, 2.14, 0.72), (0.2, 2.18, 0.73), (-0.2, 2.18, 0.73), (-0.42, 2.14, 0.72)])
cage([(0.44, 2.1, 0.74), (0.34, 2.1, 0.48), (-0.34, 2.1, 0.48), (-0.44, 2.1, 0.74)], smooth=False)
both([(0.15, 2.17, 0.73), (0.13, 2.1, 0.48)], smooth=False)
cage([(-0.38, 2.15, 0.62), (0.38, 2.15, 0.62)], smooth=False)
front_grille = box('bumper_mesh', (0.6, 0.02, 0.22), (0, 2.08, 0.6), m='grille', bevel=0.1)
# rear: bumper cage
both([(0.76, -1.5, 0.97), (0.62, -1.9, 0.98), (0.0, -1.98, 0.98)])
cage([(0.5, -1.92, 0.98), (0.38, -1.9, 0.56), (-0.38, -1.9, 0.56), (-0.5, -1.92, 0.98)], smooth=False)
both([(0.18, -1.96, 0.98), (0.16, -1.9, 0.56)], smooth=False)
cage([(-0.42, -1.93, 0.77), (0.42, -1.93, 0.77)], smooth=False)

# roof light bar: black housing on two brackets, eight lamp cells
box('lightbar', (1.1, 0.12, 0.11), (0, 0.06, 1.82), m='black', bevel=0.15)
for sx in (1, -1):
    box('lb_mount', (0.04, 0.04, 0.12), (sx * 0.48, 0.05, 1.73), m='black', bevel=0.2)
for k in range(8):
    box('lamp', (0.1, 0.01, 0.065), (-0.455 + k * 0.13, 0.122, 1.82), m='light_head', bevel=0.15)

# ---------------- long-travel suspension: wishbones and coilovers ----------------
def coilover(a, b):
    a, b = np.array(a), np.array(b)
    tube('shock_body', [tuple(a), tuple(a + (b - a) * 0.55)], 0.03, 'darkmetal')
    tube('shock_rod', [tuple(a + (b - a) * 0.5), tuple(b)], 0.016, 'metal')
    ax = (b - a) / np.linalg.norm(b - a)
    u = np.cross(ax, [1, 0, 0]); u /= np.linalg.norm(u); v = np.cross(ax, u)
    pts = []
    for i in range(120):
        t = i / 119
        c = a + (b - a) * (0.12 + 0.75 * t)
        ang = t * 2 * math.pi * 9
        pts.append(tuple(c + (u * math.cos(ang) + v * math.sin(ang)) * 0.065))
    tube('spring', pts, 0.012, 'metal', res=1)
for y in (AXLE_F, AXLE_R):
    for sx in (1, -1):
        zc = WR - 0.01
        tube('arm_lo', [(sx * 0.5, y + 0.32, 0.5), (sx * HUB_X, y, zc - 0.12), (sx * 0.5, y - 0.32, 0.5)], 0.028, 'black')
        tube('arm_hi', [(sx * 0.52, y + 0.26, 0.74), (sx * HUB_X, y, zc + 0.14), (sx * 0.52, y - 0.26, 0.74)], 0.024, 'black')
        add(cylinder('upright', 0.12, 0.08, (sx * (HUB_X - 0.03), y, zc), (0, math.pi / 2, 0), 24, ('darkmetal',)))
        coilover((sx * 0.8, y + 0.04, 0.48), (sx * 0.6, y + 0.02, 1.12 if y < 0 else 0.95))

# ---------------- twin thrusters on top of the rear cage ----------------
TX, TZ, TR, TEXIT = 0.3, 1.36, 0.2, -2.12
for sx in (1, -1):
    x = sx * TX
    lathe('pod', [(0.1, -0.7), (0.16, -0.8), (0.17, -1.2), (0.215, -1.3), (0.225, -1.78), (0.2, -1.84)], (x, 0, TZ), m='black')
    for k in range(4):
        y0 = -1.38 - k * 0.11
        lathe('rib', [(0.222, y0), (0.238, y0 - 0.01), (0.238, y0 - 0.04), (0.222, y0 - 0.05)], (x, 0, TZ), m='darkmetal')
    nozzle(x, TZ, TR, TEXIT, depth=0.3, vanes=8, m='black')
    tube('noz_mount', [(x, -1.1, TZ - 0.16), (sx * 0.58, -1.15, 1.6)], 0.02, 'darkmetal', keep=True)

finish(body, 'ridgeback', WR, WX, wheel_w=0.45, rear=[(-TX, TEXIT, TZ), (TX, TEXIT, TZ)], side=(0.9, 0.75), cam_h=1.3)
