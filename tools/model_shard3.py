"""Build the Showroom Shard from shard_front.png and shard_rear.png.

Blender: -P tools/model_shard3.py -- models/shard3.glb --blend models/source/shard3.blend
Use --renders DIR for the front and rear studio views. Front is +Y.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import (AXLE_F, AXLE_R, BLEND, DST, M, PNG, Vector, add, bmesh, boolean,
                    box, bpy, cylinder, lathe, mat, new_obj, np, parts, refresh,
                    sc, section_loft, side_decal, surf_x, surf_y)


WHEEL_R, TRACK = .490, .974
HUB_Z = WHEEL_R - .01
TURBINE_Z, TURBINE_EXIT = 1.603, -2.341

M.update({
    'screen': mat('Shard graphite glass', (.006, .0065, .008), .46, double=True),
    'quarter': mat('Shard front quarter glass', (.011, .012, .014), .48, double=True),
    'seal': mat('Window rubber', (.006, .007, .009), .55, double=True),
    'seam': mat('Body panel gaps', (.014, .014, .015), .60, double=True),
    'skid': mat('Skid plate graphite', (.095, .096, .098), .45, .35),
    'bed': mat('Bed liner', (.024, .026, .027), .72),
    'turbine': mat('Turbine graphite', (.091, .094, .100), .43, .59),
    'case_panel': mat('Turbine outer panels', (.144, .146, .151), .39, .48),
    'blade': mat('Turbine blades', (.037, .038, .042), .46, .50, double=True),
    'rim': mat('Graphite wheel alloy', (.065, .067, .070), .44, .47),
    'rim_edge': mat('Machined wheel lip', (.077, .079, .083), .47, .48),
    'rubber': mat('All-terrain tire rubber', (.020, .021, .022), .87),
})
paint_shader = M['paint'].node_tree.nodes['Principled BSDF']
paint_shader.inputs['Base Color'].default_value = (.155, .156, .162, 1)
paint_shader.inputs['Roughness'].default_value = .43
paint_shader.inputs['Metallic'].default_value = .28
for name in ('screen', 'quarter'):
    M[name].node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = .047
M['light_head'].node_tree.nodes['Principled BSDF'].inputs['Emission Strength'].default_value = 1.6
for material in M.values():
    material.diffuse_color = material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value


def mesh(name, points, faces, material='paint', recalc=False):
    bm = bmesh.new()
    vertices = [bm.verts.new(p) for p in points]
    for indices in faces:
        bm.faces.new([vertices[i] for i in indices])
    if recalc:
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    return add(new_obj(name, bm, [material]))


def chamfer(obj, width):
    bevel = obj.modifiers.new('Small edge chamfer', 'BEVEL')
    bevel.width = width
    bevel.segments = 1
    bevel.limit_method = 'ANGLE'
    bevel.angle_limit = math.radians(13)
    return obj


def mirror(points, sign):
    return [(sign*x,y,z) for x,y,z in points]


# Shoulder, door plane and lower bevel are carried through the slab body.
# At the nose, swept end faces meet at the subtle centerline fold.
def body_section(y, width, sill, shoulder, deck, sweep=0, rake=0):
    top_width = width - .065
    half = [(0,sill),(.83*width,sill),(.96*width,sill+.095),
            (width,sill+.205),(width-.018,shoulder-.032),
            (top_width,shoulder),(.78*top_width,shoulder+.69*(deck-shoulder)),(0,deck)]
    side = [(-x,z) for x,z in reversed(half[1:-1])]
    return [(x,y-sweep*(abs(x)/width)-rake*(deck-z),z) for x,z in half + side]


sections = [
    (-2.466, 1.019, .563, 1.392, 1.391, -.086, -.043),
    (-2.225, 1.065, .467, 1.446, 1.456),
    (-1.550, 1.079, .421, 1.447, 1.455),
    (-.920,  1.056, .409, 1.405, 1.420),
    (.936,   1.037, .407, 1.295, 1.398),
    (1.596,  1.025, .433, 1.199, 1.252),
    (2.190,  1.005, .489, 1.108, 1.117),
    (2.465,   .977, .599, 1.059, 1.076, .125, .227),
]
rings = [body_section(*row) for row in sections]
count = len(rings[0])
faces = [(i*count+j,i*count+(j+1)%count,(i+1)*count+(j+1)%count,(i+1)*count+j)
         for i in range(len(rings)-1) for j in range(count)]
ridge = count//2
for start in (0, (len(rings)-1)*count):
    faces.append(tuple(range(start,start+ridge+1)))
    faces.append((start, *range(start+ridge,start+count)))
body = mesh('Folded main shell', [point for row in rings for point in row], faces, recalc=True)

arch = [(.660,-.240),(.672,.016),(.360,.591),(-.360,.591),(-.672,.016),(-.660,-.240)]
for y in (AXLE_F, AXLE_R):
    for sign in (-1,1):
        cut = section_loft('Wheel house cutter', [[(sign*x,y+a,HUB_Z+z) for a,z in arch]
                                                   for x in (.67,1.38)], ['black'])
        boolean(body, cut)

bed = [(0.735,-2.299),(.777,-2.197),(.767,-1.179),(.635,-1.037),
       (-.635,-1.037),(-.767,-1.179),(-.777,-2.197),(-.735,-2.299)]
cut = section_loft('Bed pocket cutter', [[(x,y,z) for x,y in bed] for z in (.919,2.0)], ['bed'])
boolean(body, cut)
refresh(body)

# Cabin glass is set directly into the four planar faces. The main roof
# keeps the flat profile of the existing Shard, with wide painted C-pillars.
def inset_glass(name, corners, material):
    center = Vector(tuple(sum(p[i] for p in corners)/4 for i in range(3)))
    glass = [tuple(center.lerp(Vector(p), .978)) for p in corners]
    mesh(name + ' gasket', corners + glass, [(i,(i+1)%4,(i+1)%4+4,i+4) for i in range(4)], 'seal')
    mesh(name, glass, [(0,1,2,3)], material)


def pair(point):
    return [(-point[0],*point[1:]), point]


cowl_ramp = (.848,.936,1.370)
roof_front = (.722,.345,1.791)
roof_rear = (.735,-.887,1.808)
belt_rear = (.970,-.859,1.419)
sail_end = (.978,-1.544,1.443)
left_a,right_a = pair(cowl_ramp)
left_b,right_b = pair(roof_front)
left_c,right_c = pair(roof_rear)
inset_glass('Wraparound windshield', [left_a,right_a,right_b,left_b], 'screen')
lower = [left_b, right_b, right_c, left_c]
upper = [(x,y,z+.022) for x,y,z in lower]
chamfer(add(section_loft('Flat roof pressing', [lower,upper], ['paint'])), .005)

for sign in (-1,1):
    a,b,c,d,e = [Vector(p) for p in mirror([cowl_ramp,roof_front,roof_rear,belt_rear,sail_end], sign)]
    upper_divider = b.lerp(c, .184)
    lower_divider = a.lerp(d, .307)
    inset_glass('Front quarter window', [tuple(p) for p in (a,lower_divider,upper_divider,b)], 'quarter')
    inset_glass('Door window', [tuple(p) for p in (lower_divider,d,c,upper_divider)], 'screen')
    shoulder_fold = [tuple(a),tuple(lower_divider),tuple(d),
                     (sign*1.059,-.906,1.367),(sign*1.038,.388,1.283),(sign*1.029,.932,1.254)]
    shoulder_faces = [(0,1,4,5),(1,2,3,4)]
    mesh('Upper door shoulder pressing', shoulder_fold,
         [f if sign > 0 else f[::-1] for f in shoulder_faces])
    triangle = [tuple(p) for p in (c,d,e)]
    # A second facet runs from the shoulder of the sail towards the bed.
    inner = (sign*.684,-1.360,1.446)
    point_list = [*triangle,inner,(sign*.972,-.911,1.373),(sign*.977,-1.543,1.393)]
    faces = [(0,1,2),(0,2,3),(1,4,5,2),(2,5,3)]
    mesh('Sculpted rear sail panel', point_list, [f[::-1] if sign > 0 else f for f in faces])

    # Door shut lines are laid onto the slab and continue over its folded sill.
    lines = [[(.383,1.281),(.343,1.236),(.304,.866),(.305,.729)],
             [(-.859,1.419),(-.841,1.252),(-.733,.621),(-.691,.532)],
             [(-.691,.532),(-.448,.502),(.284,.525)]]
    for line in lines:
        for (y0,z0),(y1,z1) in zip(line,line[1:]):
            side_decal('Door shut line', [(y0-.005,z0),(y0+.004,z0),(y1+.004,z1),(y1-.005,z1)],
                       'seam', sign, .0025, 1)
    side_decal('Flush door pull pocket', [(-.771,1.135),(-.578,1.137),(-.589,1.104),(-.767,1.103)],
               'seam', sign, .0031, 2)
    side_decal('Inset door pull', [(-.768,1.134),(-.590,1.136),(-.596,1.122),(-.765,1.120)],
               'skid', sign, .0046, 2)

inset_glass('Rear cab window', [right_c,left_c,(-.677,-1.351,1.450),(.677,-1.351,1.450)], 'screen')


# Each wheel surround is a single fold around the arch. Its inner return
# shades the housing and the outer facets reach back into the door skins.
shoulder = [(.802,-.137),(.787,.045),(.455,.720),(-.455,.720),(-.787,.045),(-.802,-.137)]
outer_lip = [(.714,-.165),(.714,.032),(.399,.635),(-.399,.635),(-.714,.032),(-.714,-.165)]
arch_return = [(y,max(z,-.165)) for y,z in arch]
for axle in (AXLE_F, AXLE_R):
    for sign in (-1,1):
        paths = [
            [(sign*(surf_x(axle+y,HUB_Z+z,sign,default=.979)-.012),axle+y,HUB_Z+z) for y,z in shoulder],
            [(sign*(1.157+.39*min(0,z)),axle+y,HUB_Z+z) for y,z in outer_lip],
            [(sign*(1.151+.39*min(0,z)),axle+y,HUB_Z+z) for y,z in arch_return],
            [(sign*.791,axle+y,HUB_Z+z) for y,z in arch_return],
        ]
        # Build across the path so the start and finish of the flare are capped.
        strips = [list(row) for row in zip(*paths)]
        add(section_loft('Faceted wheel arch surround', strips, ['paint','black'],
                         mat_of=lambda station, strip: int(strip >= 2)))

for sign in (-1,1):
    sill = [(-.776,.996,.523,.325),(-.647,1.071,.606,.326),(-.501,1.115,.692,.340),
            (.419,1.113,.692,.342),(.603,1.084,.596,.337),(.719,1.022,.466,.331)]
    rows = [mirror([(x-.118,y,low),(x+.009,y,low),(x+.043,y,low+.146),
                     (x-.074,y,high),(x-.160,y,high-.034)], sign) for y,x,high,low in sill]
    chamfer(add(section_loft('Folded rocker armor', rows, ['skid'])), .007)
    panel = mirror([(1.153,.100,.515),(1.151,-.385,.515),(1.121,-.434,.344),(1.123,.004,.344)],sign)
    mesh('Rocker service panel', panel, [(0,1,2,3)] if sign > 0 else [(3,2,1,0)], 'turbine')


def fascia_strip(name, width, center_z, height, direction, offset, material):
    # Sample the ends, breaks in the slab, and both sides of the center fold.
    xs = [-width, -.83*width, -.42*width, 0, .42*width, .83*width, width]
    points = [(x,surf_y(x,z,direction > 0,default=direction*2.37)+direction*offset,z)
              for x in xs for z in (center_z-height/2,center_z+height/2)]
    faces = [(i,i+1,i+3,i+2) for i in range(0,len(points)-2,2)]
    return mesh(name, points, faces if direction > 0 else [f[::-1] for f in faces], material)


for direction, name, z, width in [(1,'Nose',1.010,.948),(-1,'Tailgate',1.328,.980)]:
    fascia_strip(name + ' light bar channel', width+.012,z,.078,direction,.005,'trim')
    fascia_strip(name + ' white light bar', width,z,.042,direction,.010,'light_head')
fascia_strip('Nose lower air gap', .852,.625,.043,1,.008,'seal')
fascia_strip('Tailgate lower break', .899,.614,.087,-1,.006,'seal')

for direction, name in [(1,'Front'),(-1,'Rear')]:
    rows = []
    for x in (-.977,-.900,-.729,-.42,0,.42,.729,.900,.977):
        width = abs(x)
        sweep = (.087 if direction == 1 else .049)*width
        tip = max(0,width-.79)/.187
        raised = .041 if .72 < width < .94 else 0
        projection = .092 if direction == 1 else .150
        def point(y,z):
            return (x,direction*(y-sweep-.13*tip),z+.085*tip)
        rows.append([point(2.177,.568),point(2.311+projection*.75,.568+raised),
                     point(2.437+projection,.489),point(2.415+projection,.412),
                     point(2.300+projection*.68,.330),point(2.183,.327)])
    guard = add(section_loft(name + ' shaped skid plate', rows, ['skid']))
    for i,x in enumerate((-.746,-.437,-.155,.155,.437,.746)):
        zz = .394 if 0 < i < 5 else .454
        height = .140 if 0 < i < 5 else .072
        width = .059 if 0 < i < 5 else .104
        # The vertical channels lean with the slanted face of the guard.
        outline = [(x-width/2,zz-height/2),(x+width/2,zz-height/2),
                   (x+width/2-.052,zz+height/2),(x-width/2-.052,zz+height/2)]
        cutter = section_loft(name + ' skid vent cutter', [[(a,direction*y,z) for a,z in outline]
                                                           for y in (2.286,2.80)], ['black'])
        boolean(guard, cutter)
    chamfer(guard, .004)

for y in (-2.149,-1.863,-1.562,-1.266):
    box('Cargo floor rib', (1.356,.046,.039), (0,y,.943), m='skid')
box('Turbine cradle', (.633,1.008,.309), (0,-1.747,1.080), m='bed')


def radial(radius, y, angle):
    return (radius*math.cos(angle),y,TURBINE_Z+radius*math.sin(angle))


case = [(.313,-1.062),(.375,-1.088),(.407,-1.230),(.429,-1.425),(.444,-1.497),
        (.447,-1.973),(.433,-2.075),(.414,-2.217),(.387,TURBINE_EXIT),
        (.365,TURBINE_EXIT),(.344,-2.278),(.341,-2.135),(.295,-1.336),
        (.301,-1.128),(.313,-1.062)]
angles = [math.tau*(i+.5)/12 for i in range(12)]
add(section_loft('Twelve-sided turbine shell', [[radial(r,y,a) for a in angles] for r,y in case],
                 ['turbine','case_panel','grille'], False,
                 mat_of=lambda strip, i: 2 if strip >= 9 else int(strip in (0,7,8))))
for i,a in enumerate(angles):
    b = angles[(i+1)%len(angles)]
    if b < a:
        b += math.tau
    for name, begin, end, low, high in [('Mid-case armor',-1.458,-2.039,.447,.457),
                                       ('Forward case armor',-1.160,-1.430,.381,.430)]:
        points = [radial(low,begin,a+.018),radial(low,begin,b-.018),
                  radial(high,end,b-.018),radial(high,end,a+.018)]
        inner = [(x*.984,y,TURBINE_Z+(z-TURBINE_Z)*.984) for x,y,z in points]
        chamfer(add(section_loft(name, [inner,points], ['case_panel'])), .005)

for direction, y, radius in [(1,-1.079,.302),(-1,TURBINE_EXIT,.353)]:
    add(cylinder('Dark turbine cavity',radius,.018,(0,y-direction*.188,TURBINE_Z),
                 (math.pi/2,0,0),24,('grille',)))
    for a in np.linspace(0,math.tau,15,endpoint=False):
        profile = [(.091,.113,.278,.10),(radius*.61,.115,.139,.071),(radius,.105,.008,.041)]
        rows = [[radial(r, y-direction*(depth+d), a+sweep+v)
                 for d,v in [(0,-width),(.032,-width),(.070,width),(.024,width)]]
                for r,depth,sweep,width in profile]
        add(section_loft('Faceted turbine vane',rows,['blade']))
    spinner = [(.135,y-direction*.147),(.121,y-direction*.093),(.097,y-direction*.073),
               (.0001,y-direction*.073)]
    lathe('Rotor center cap',spinner,(0,0,TURBINE_Z),segs=10,m='turbine')

for sign in (-1,1):
    # The leading edge sweeps aft towards a tall tip. The cross-sections
    # also taper in thickness at the top, with a machined highlight edge.
    fin = [(-1.343,1.445,.843,.107),(-2.136,1.445,.858,.111),
           (-2.355,2.265,.952,.031),(-2.070,2.218,.930,.036)]
    rows = [[(sign*(x+s*width/2),y,z) for y,z,x,width in fin] for s in (-1,1)]
    chamfer(add(section_loft('Swept bed fin',rows,['paint'])),.008)


def join_export(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        copy = obj.copy()
        copy.data = obj.data.copy()
        sc.collection.objects.link(copy)
        copy.select_set(True)
        bpy.context.view_layer.objects.active = copy
        for modifier in list(copy.modifiers):
            bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.ops.object.join()
    joined = bpy.context.object
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    joined.name = name
    return joined


body_parts = list(parts)
tire = lathe('All-terrain tire carcass', [(.299,-.196),(.346,-.206),(.414,-.201),
              (.447,-.185),(.465,-.145),(.476,-.093),(.476,.093),(.465,.145),(.448,.184),
              (.419,.202),(.344,.211),(.299,.195),(.299,-.196)], (0,0,0), axis='x', segs=80, m='rubber')
for face in tire.data.polygons:
    face.use_smooth = True

# Five staggered rows of tread blocks wrap from sidewall to sidewall.
bm = bmesh.new()
chamfered_rectangle = [(-.5,-.30),(-.32,-.5),(.31,-.5),(.5,-.30),
                       (.5,.30),(.31,.5),(-.32,.5),(-.5,.30)]
for row,(x,radius,width) in enumerate([(-.166,.477,.072),(-.087,.487,.079),
                                       (0,.490,.075),(.087,.487,.079),(.166,.477,.072)]):
    for block in range(27):
        angle = math.tau*(block+.5*(row%2))/27
        loops = []
        for amount,depth in [(1.07,-.031),(1,0),(.88,.003 if row != 2 else 0)]:
            loop = []
            for across,around in chamfered_rectangle:
                t = angle + .178*around*amount + .033*across*math.copysign(1,row-1.8)
                r = radius + depth - .28*max(0,abs(x+across*width)-.139)
                loop.append(bm.verts.new((x+across*width*amount,r*math.cos(t),r*math.sin(t))))
            loops.append(loop)
        for lower_loop, upper_loop in zip(loops,loops[1:]):
            for i in range(8):
                j = (i+1)%8
                bm.faces.new((lower_loop[i],lower_loop[j],upper_loop[j],upper_loop[i]))
        bm.faces.new(loops[-1])
bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:])
add(new_obj('Staggered tread blocks',bm,['rubber']))

lathe('Deep-dish wheel rim', [(.288,-.176),(.293,.137),(.302,.175),(.299,.203),(.290,.211),
      (.269,.211),(.262,.206),(.255,.152),(.254,.080),(.249,.044),(.237,.041)],
      (0,0,0),axis='x',segs=35,m='rim_edge')
add(cylinder('Brake rotor',.211,.018,(.012,0,0),(0,math.pi/2,0),40,('darkmetal',)))
for a in np.linspace(0,math.tau,5,endpoint=False):
    rows = []
    for r,x,w in [(.073,.160,.040),(.116,.152,.048),(.193,.116,.034),(.259,.152,.027)]:
        rows.append([(x+dx,r*math.cos(a)-off*math.sin(a),r*math.sin(a)+off*math.cos(a))
                     for dx,off in [(.012,-w),(.019,0),(.012,w),(-.062,.8*w),(-.062,-.8*w)]])
    chamfer(add(section_loft('Pressed truck wheel spoke',rows,['rim'])),.007)
lathe('Octagonal hub cap', [(.103,.099),(.101,.149),(.092,.181),(.075,.193),(.0001,.193)],
      (0,0,0),axis='x',segs=8,m='rim')

body_export = join_export(body_parts,'Shard v3')
wheel_parts = parts[len(body_parts):]
wheel_export = join_export(wheel_parts,'ShardWheel')
body_export.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(DST),export_format='GLB',use_selection=True,
                          export_apply=True,export_yup=True)
bpy.data.objects.remove(body_export,do_unlink=True)
mounted_wheels = bpy.data.collections.new('Mounted wheels')
sc.collection.children.link(mounted_wheels)
for axle in (AXLE_F,AXLE_R):
    for sign in (-1,1):
        wheel = wheel_export.copy()
        wheel.name = ('Front' if axle > 0 else 'Rear') + (' left wheel' if sign < 0 else ' right wheel')
        wheel.location = (sign*TRACK,axle,HUB_Z)
        wheel.scale.x = sign
        mounted_wheels.objects.link(wheel)
bpy.data.objects.remove(wheel_export,do_unlink=True)
for obj in wheel_parts:
    bpy.data.objects.remove(obj,do_unlink=True)


studio = bpy.data.collections.new('Studio')
sc.collection.children.link(studio)
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.010))
floor = bpy.context.object
floor.name = 'Neutral gray studio floor'
floor.data.materials.append(mat('Matte gray floor',(.50,.50,.51),.75))
for collection in list(floor.users_collection):
    collection.objects.unlink(floor)
studio.objects.link(floor)
floor.hide_set(True)
world = bpy.data.worlds.new('Studio ambient')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.65,.65,.67,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .52
sc.world = world


def point_at(obj, target):
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()


for name,pos,power,size in [('Key softbox',(1.8,3.0,6.4),770,6.1),
                            ('Front fill',(-4.5,4.1,4.2),500,4.9),
                            ('Rear fill',(-3.4,-4.2,4.4),600,5.4),
                            ('Rim light',(4.0,-3.8,5.3),530,4.2)]:
    light = bpy.data.lights.new(name,'AREA')
    light.energy, light.size = power,size
    obj = bpy.data.objects.new(name,light)
    obj.location = pos
    point_at(obj,(0,0,.8))
    studio.objects.link(obj)

cameras = {}
for name,pos,target in [('front',(-7.60,6.30,2.87),(0,.02,.95)),
                        ('rear',(-7.80,-6.26,2.93),(0,-.08,.96))]:
    camera = bpy.data.cameras.new(name.title() + ' reference angle')
    camera.lens = 61
    obj = bpy.data.objects.new(camera.name,camera)
    obj.location = pos
    point_at(obj,target)
    studio.objects.link(obj)
    cameras[name] = obj
sc.camera = cameras['front']
sc.render.engine = 'CYCLES'
sc.cycles.samples = 20
sc.cycles.use_denoising = True
sc.render.resolution_x,sc.render.resolution_y = 1440,810
sc.render.image_settings.file_format = 'PNG'
sc.view_settings.view_transform = 'AgX'
bpy.ops.object.select_all(action='DESELECT')
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        view = area.spaces.active
        view.overlay.show_overlays = False
        view.shading.color_type = 'MATERIAL'
        view.shading.show_cavity = True
        view.region_3d.view_location = (0,0,1.02)
        view.region_3d.view_rotation = (sc.camera.location-Vector((0,0,1.02))).to_track_quat('Z','Y')
        view.region_3d.view_distance = 7.3

if BLEND:
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
if PNG:
    os.makedirs(PNG,exist_ok=True)
    for name,camera in cameras.items():
        sc.camera = camera
        sc.render.filepath = os.path.join(PNG,name+'.png')
        bpy.ops.render.render(write_still=True)
    sc.camera = cameras['front']
