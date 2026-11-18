"""Prepare an AI-generated car GLB (Meshy / Tripo) for RoadsterThruster.

Run:
  blender -b -P tools/prep_car.py -- IN.glb OUT.glb [--yaw DEG] [--analyze PNGDIR]

What it does
  * joins all meshes, applies transforms, optional yaw so the nose faces -Z
  * finds the four wheels from the lowest geometry and fits the car so its
    wheel centres land on the physics wheels (z -1.42 / +1.45, y 0.36, x +-0.88)
  * deletes the AI wheels (faces inside the wheel cylinders) -- the game
    draws its own spinning / steering wheels
  * decimates to a game budget and writes JPEG textures inside the GLB
"""
import bpy, bmesh, sys, math
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:]
SRC, DST = argv[0], argv[1]
def opt(name, default=None, cast=str):
    return cast(argv[argv.index(name) + 1]) if name in argv else default
YAW = opt('--yaw', 0.0, float)
PNG = opt('--analyze')
TRIS = opt('--tris', 60000, int)
CUT = opt('--cut', 1.0, float)          # wheel cut radius multiplier

WZ_F, WZ_R, WY, WX, WR = -1.42, 1.45, 0.36, 0.88, 0.37

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)
meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes: o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
if len(meshes) > 1: bpy.ops.object.join()
car = bpy.context.view_layer.objects.active
# unparent, keep world transform, then bake it
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
for o in list(bpy.context.scene.objects):
    if o is not car: bpy.data.objects.remove(o, do_unlink=True)

# Blender is Z-up; glTF -Z forward == Blender +Y forward. Work in Blender
# coords: forward(+Y blender) == -Z game, up = +Z blender, right = +X.
me = car.data
if YAW:
    me.transform(Matrix.Rotation(math.radians(YAW), 4, 'Z'))
vs = [v.co.copy() for v in me.vertices]
mn = Vector((min(v.x for v in vs), min(v.y for v in vs), min(v.z for v in vs)))
mx = Vector((max(v.x for v in vs), max(v.y for v in vs), max(v.z for v in vs)))
print('BOUNDS', tuple(round(c, 3) for c in mn), tuple(round(c, 3) for c in mx))
L, H, Wd = mx.y - mn.y, mx.z - mn.z, mx.x - mn.x
print('SIZE len %.3f wid %.3f hgt %.3f  verts %d faces %d' % (L, Wd, H, len(vs), len(me.polygons)))

# ---- wheel finding: low vertices, outer sides, cluster along length ----
low = [v for v in vs if v.z < mn.z + H * 0.28 and abs(v.x - (mn.x + mx.x) / 2) > Wd * 0.28]
bins = 60
hist = [0] * bins
for v in low:
    hist[min(bins - 1, int((v.y - mn.y) / L * bins))] += 1
print('LOWHIST', hist)
half = bins // 2
def peak(lo, hi):
    best = max(range(lo, hi), key=lambda i: hist[i])
    # centroid of contiguous region above 25% of peak
    th = hist[best] * 0.25
    a = best
    while a > lo and hist[a - 1] > th: a -= 1
    b = best
    while b < hi - 1 and hist[b + 1] > th: b += 1
    ys = [v.y for v in low if a <= int((v.y - mn.y) / L * bins) <= b]
    return (min(ys) + max(ys)) / 2, (max(ys) - min(ys)) / 2
yR, rR = peak(0, half)            # blender -Y = game +Z = rear
yF, rF = peak(half, bins)         # blender +Y = front
r_ai = (rR + rF) / 2
zc = mn.z + r_ai
print('WHEELS front y %.3f rear y %.3f radius %.3f centre z %.3f' % (yF, yR, r_ai, zc))
outer = [v.x for v in low]
track = (max(outer) - min(outer)) / 2
print('TRACK half-width outer %.3f' % track)

# ---- fit: wheelbase -> 2.87, wheel centre height -> 0.36 ----
s = (WZ_R - WZ_F) / (yF - yR)
midY = (yF + yR) / 2
cx = (mn.x + mx.x) / 2
# game z = -blender y, so wheel midpoint (game z 0.015) = blender y -0.015
# bigger AI wheels: the game scales its wheels to match (kit.wheelR) and the body rides
# higher by the same amount so the tyres still touch the ground
rw = round(r_ai * s * 0.97, 3)
WYB = WY + max(0.0, rw - WR)
print('KIT wheelR %.3f bodyLift %.3f wheelX %.3f' % (rw, WYB - WY, track * s - 0.13))
T = Matrix.Translation(Vector((0, -(WZ_R + WZ_F) / 2, WYB))) @ Matrix.Scale(s, 4) @ Matrix.Translation(Vector((-cx, -midY, -zc)))
me.transform(T)
print('SCALE %.4f -> length %.3f width %.3f height %.3f, AI wheel r %.3f, track %.3f' %
      (s, L * s, Wd * s, H * s, r_ai * s, track * s))

# ---- cut AI wheels ----
if CUT > 0:
    bm = bmesh.new(); bm.from_mesh(me)
    centres = [(-(WZ_F), ), (-(WZ_R), )]
    rc = r_ai * s * CUT * 1.04
    xin = track * s * 0.55
    kill = []
    for f in bm.faces:
        c = f.calc_center_median()
        if abs(c.x) < xin: continue
        for gz in (WZ_F, WZ_R):
            by = -gz
            if (c.y - by) ** 2 + (c.z - WYB) ** 2 < rc * rc:
                kill.append(f); break
    print('CUT faces', len(kill), 'of', len(bm.faces))
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(me); bm.free()

# ---- decimate ----
tri = sum(len(p.vertices) - 2 for p in me.polygons)
if tri > TRIS:
    m = car.modifiers.new('dec', 'DECIMATE'); m.ratio = TRIS / tri
    bpy.ops.object.modifier_apply(modifier='dec')
print('TRIS', sum(len(p.vertices) - 2 for p in me.polygons))

# ---- optional preview renders ----
if PNG:
    import os
    os.makedirs(PNG, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = 'BLENDER_EEVEE_NEXT' if 'BLENDER_EEVEE_NEXT' in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties['engine'].enum_items] else 'BLENDER_EEVEE'
    sc.render.resolution_x, sc.render.resolution_y = 900, 500
    w = bpy.data.worlds.new('w'); sc.world = w; w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[1].default_value = 1.2
    # reference wheels (red discs) where physics wheels are
    ref = bpy.data.materials.new('ref'); ref.diffuse_color = (1, 0, 0, 1)
    for gz in (WZ_F, WZ_R):
        for gx in (WX, -WX):
            bpy.ops.mesh.primitive_cylinder_add(radius=rw, depth=0.25, location=(gx, -gz, WYB), rotation=(0, math.pi / 2, 0))
            bpy.context.object.data.materials.append(ref)
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); sc.collection.objects.link(sun)
    sun.data.energy = 4; sun.rotation_euler = (0.7, 0.3, 0.8)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); sc.collection.objects.link(cam); sc.camera = cam
    cam.data.type = 'ORTHO'; cam.data.ortho_scale = 6
    for name, loc, rot in [('side', (12, 0, 0.6), (math.pi / 2, 0, math.pi / 2)),
                           ('top', (0, 0, 12), (0, 0, 0)),
                           ('front', (0, 12, 0.6), (math.pi / 2, 0, math.pi)),
                           ('persp', (6, 7, 3.5), None)]:
        cam.location = loc
        if rot: cam.rotation_euler = rot; cam.data.type = 'ORTHO'
        else:
            cam.data.type = 'PERSP'
            d = Vector((0, 0, 0.5)) - Vector(loc); cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        sc.render.filepath = os.path.join(PNG, name + '.png')
        bpy.ops.render.render(write_still=True)
    for o in list(sc.objects):
        if o is not car and o.type != 'CAMERA': bpy.data.objects.remove(o, do_unlink=True)

bpy.ops.object.select_all(action='DESELECT'); car.select_set(True)
car.name = 'body'
bpy.ops.export_scene.gltf(filepath=DST, export_format='GLB', use_selection=True,
                          export_image_format='JPEG', export_jpeg_quality=88,
                          export_apply=True, export_yup=True)
print('WROTE', DST)
