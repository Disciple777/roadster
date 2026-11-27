"""Build the Showroom Tuk Tuk v3 from the front and rear clay references.

Blender: -P tools/model_tuktuk3.py -- models/tuktuk3.glb --blend models/source/tuktuk3.blend
Coordinates follow carlib: +Y is the nose. The Showroom instances the exported wheel on its axles.
"""
import os
import sys
import math

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import (bpy, np, Vector, AXLE_F, AXLE_R, M, parts, sc, DST, BLEND, boolean,
                    add, box, tube, lathe, cylinder, mat, rounded, section_loft)

R, TRACK = .41, .88
HUB = R - .01
M['seat'] = mat('Graphite upholstery', (.105, .10, .098), .58)
M['rail'] = mat('Satin alloy', (.31, .32, .33), .4, .48)
M['exhaust'] = mat('Brushed titanium', (.28, .28, .29), .42, .65, double=True)
M['throat'] = mat('Sooted exhaust interior', (.027, .026, .026), .78, double=True)
M['lining'] = mat('Charcoal lining', (.055, .055, .056), .73)
M['tire'] = mat('Tire compound', (.032, .031, .030), .85)
M['hub'] = mat('Graphite wheel enamel', (.15, .15, .145), .45, .42)
M['pane'] = mat('Clear windscreen', (.73, .85, .87), .12, double=True)
M['pane'].node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value = .14
M['pane'].surface_render_method = 'BLENDED'
for material in M.values():
    shader = material.node_tree.nodes.get('Principled BSDF')
    material.diffuse_color = (*shader.inputs['Base Color'].default_value[:3],
                              shader.inputs['Alpha'].default_value)


def loft(name, rings, material='paint'):
    return add(section_loft(name, rings, [material]))


def edge_round(obj, radius, segments=3):
    bevel = obj.modifiers.new('Pressed edge radius', 'BEVEL')
    bevel.width, bevel.segments = radius, segments
    bevel.limit_method = 'ANGLE'
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=bevel.name)
    return obj


def profile(name, yz, xs, material='paint', radius=.025):
    return edge_round(loft(name, [[(x, y, z) for y, z in yz] for x in xs], material), radius)


def pad(name, size, center, radius, material='paint', tilt=0):
    return edge_round(box(name, size, center, (tilt, 0, 0), m=material, bevel=0), radius, 5)


def pipe(name, points, radius, material='rail'):
    return tube(name, fillet_path(points, radius * 3.6), radius, material)


def fillet_path(points, radius):
    # Preserve the straight spans between short quadratic corner fillets.
    corners = rounded(points, radius, 8)
    return [points[0], *corners[9:-9], points[-1]]


# A continuous pressed footboard and stepped flanks. The outer skin returns
# inboard under the rear bench, leaving clearance for the rear tires.
deck = pad('Footboard pressing', (1.59, 2.79, .12), (0, -.145, .40), .054)
boolean(deck, cylinder('Front wheel clearance',.55,.50,(0,AXLE_F,HUB),(0,math.pi/2,0)))
pad('Inset floor mat', (1.47, 2.09, .024), (0, -.13, .466), .011, 'lining')
for x in [-.59, -.40, .40, .59]:
    pad('Floor rib', (.016, 1.9, .012), (x, .02, .482), .005, 'lining')
side_profile = [(1.31,.35), (1.33,.47), (.12,.48), (.07,.69), (-.45,.69),
                (-.57,1.04), (-.91,1.04), (-1.03,1.26), (-2.01,1.26),
                (-2.1,1.04), (-1.7,.91), (-1.10,.89), (-.84,.36)]
for sign in (-1, 1):
    profile('Stepped side pressing', side_profile, (sign*.71, sign*.815))

# Apron is a shallow, convex pressing. Its lower saddle clears the single wheel.
nose_rows = [(.38,.69,1.28), (.49,.71,1.32), (.83,.755,1.46),
             (1.17,.79,1.62), (1.45,.81,1.71), (1.63,.81,1.70)]
def apron_ring(z, width, y):
    def point(t, inset):
        saddle = .56 * max(0, 1 - (abs(t)*width/.36)**2)**.52
        return (width*t, y - .20*t*t - inset, z + saddle*max(0, (1.03-z)/.65))
    ts = np.linspace(-1,1,45)
    return [point(t,0) for t in ts] + [point(t,.102) for t in reversed(ts)]
apron = edge_round(loft('Convex leg shield', [apron_ring(*r) for r in nose_rows]), .022)

# The outer windshield surround and inner gasket share the geometry of the
# crowned apron. Both outlines have separately drawn, rounded corners.
def windshield(x,z,offset=0):
    return (x, 1.70 - .31*(z-1.63) - .20*(x/.81)**2 + offset, z)
def outline(bottom,top,wb,wt,corner):
    polygon=rounded([(-wb,bottom),(wb,bottom),(wt,top),(-wt,top)],corner,11)
    ring=[]
    for i, (a,b) in enumerate(zip(polygon,polygon[1:]+polygon[:1])):
        samples=20 if (i+1)%12==0 else 1
        ring.extend((a[0]+(b[0]-a[0])*j/samples,a[1]+(b[1]-a[1])*j/samples)
                    for j in range(samples))
    return ring
outer = outline(1.60,2.935,.81,.74,.135)
inner = outline(1.82,2.78,.671,.617,.145)
def surround():
    loops = [[windshield(x,z,off) for x,z in ring] for ring,off in
             [(outer,-.097),(outer,0),(inner,0),(inner,-.097)]]
    # Wrap the four perimeter strips without capping the window aperture.
    import bmesh
    from carlib import new_obj
    bm=bmesh.new()
    rows=[[bm.verts.new(p) for p in ring] for ring in loops]
    for j,row in enumerate(rows):
        nxt=rows[(j+1)%4]
        for i in range(len(row)):
            k=(i+1)%len(row)
            bm.faces.new((row[i],row[k],nxt[k],nxt[i]))
    bmesh.ops.recalc_face_normals(bm,faces=bm.faces[:])
    return edge_round(add(new_obj('One-piece windscreen surround',bm,['paint'])),.022)
surround()
tube('Glazing rubber', [windshield(x,z,-.012) for x,z in inner], .019,'rubber',closed=True)
# A grid across the pane follows the bowed surround, keeping the wiper on its surface.
levels=np.linspace(1.82,2.78,33)
def halfwidth(z):
    edges=list(zip(inner, inner[1:]+inner[:1]))
    return max([x1+(x2-x1)*(z-z1)/(z2-z1) for (x1,z1),(x2,z2) in edges
                if abs(z2-z1)>1e-8 and min(z1,z2)-1e-7<=z<=max(z1,z2)+1e-7])
glass=[]
for z in levels:
    xs=np.linspace(-halfwidth(z),halfwidth(z),17)
    glass.append([windshield(x,z,-.026) for x in xs]+[windshield(x,z,-.031) for x in reversed(xs)])
loft('Curved laminated windshield',glass,'pane')
tube('Single wiper arm',[windshield(-x,1.855+(x+.12)*.92,.032) for x in np.linspace(-.12,.365,18)],.012,'darkmetal')
tube('Rubber wiper blade',[windshield(-x,1.855+(x+.12)*.92,.045) for x in np.linspace(.075,.40,16)],.018,'rubber')
for s in (-1,1):
    pipe('Mirror stem',[(s*.76,1.45,1.73),(s*.90,1.49,1.81),(s*1.02,1.51,1.91)],.025)
    lathe('Round mirror shell',[(0,.026),(.105,.025),(.135,.012),(.139,-.01),(.128,-.028),(0,-.028)],
          (s*1.035,1.51,1.955),m='rail')
    add(cylinder('Mirror silver',.122,.007,(s*1.035,1.476,1.955),(math.pi/2,0,0),48,('metal',)))

lathe('Headlamp bucket',[(.12,-.12),(.201,-.075),(.222,-.022),(.225,.045),(.214,.067),(.183,.068)],
      (0,1.686,1.375),m='paint')
lathe('Headlamp seal',[(.185,.063),(.193,.065),(.18,.073)],(0,1.686,1.375),m='rubber')
lathe('Domed headlamp lens',[(.184,.060),(.17,.077),(.12,.096),(.055,.106),(0,.109)],
      (0,1.686,1.375),m='light_head')

def fender(name, x, y, half, radius, first, last):
    rings=[]
    for a in np.radians(np.linspace(first,last,55)):
        row=[]
        for across, height in [(-1,-.015),(-1,.01),(-.95,.037),(-.77,.061),(-.46,.074),(0,.079),
                               (.46,.074),(.77,.061),(.95,.037),(1,.01),(1,-.015),(.91,-.025),
                               (.71,.016),(0,.035),(-.71,.016),(-.91,-.025)]:
            r=radius+height
            row.append((x+across*half,y+r*math.cos(a),HUB+r*math.sin(a)))
        rings.append(row)
    return loft(name,rings)
fender('Front scooter mudguard',0,AXLE_F,.247,.482,7,167)
for s in (-1,1):
    pipe('Front fork',[(s*.174,AXLE_F,HUB),(s*.174,1.42,.69),(s*.13,1.43,.925)],.031,'darkmetal')
    fender('Rear wheel eyebrow',s*TRACK,AXLE_R,.219,.466,4,176)

# Separate driver and passenger seats, with crowned upholstery rolls.
pad('Driver seat pedestal',(.88,.63,.49),(0,.54,.715),.065)
pad('Driver cushion',(.94,.66,.16),(0,.55,1.015),.073,'seat')
pad('Driver squab',(.94,.176,.53),(0,.29,1.27),.083,'seat',-.075)
pad('Dash', (1.17,.19,.14),(0,1.38,1.52),.065,'lining')
pipe('Steering column',[(0,1.36,1.18),(0,1.20,1.49)],.042,'darkmetal')
pipe('Handlebar',[(-.32,1.11,1.44),(-.22,1.24,1.51),(.22,1.24,1.51),(.32,1.11,1.44)],.028,'rubber')
pad('Rear bench plinth',(1.47,1.18,.55),(0,-1.42,.88),.082,'lining')
pad('Wraparound rear ledge',(1.76,1.30,.17),(0,-1.45,1.18),.077)
pad('Bench seat base',(1.53,.77,.17),(0,-1.34,1.295),.08,'seat')
pad('Bench back shell',(1.53,.205,.69),(0,-1.727,1.63),.09,'seat',.14)
for i in range(4):
    x=(i-1.5)*.365
    pad('Backrest bolster',(.401,.215,.69),(x,-1.69,1.66),.084,'seat',.14)
    pad('Bench pleat',(.389,.71,.135),(x,-1.32,1.33),.055,'seat')
for s in (-1,1):
    pipe('Passenger grab rail',[(s*.81,-.59,1.01),(s*.81,-.59,1.47),
          (s*.81,-.77,1.52),(s*.81,-1.88,1.52),(s*.77,-2.005,1.52),(s*.56,-2.02,1.52)],.043)
    pipe('Aft rail foot',[(s*.77,-1.98,1.22),(s*.77,-1.98,1.51)],.037)
    pipe('Mid canopy pillar',[(s*.762,.08,.52),(s*.762,.08,2.72),(s*.73,.13,3.00)],.048)
    pipe('Raked rear pillar',[(s*.754,-1.68,1.24),(s*.754,-1.87,2.60),(s*.72,-1.81,2.844)],.058)
tube('Rear rail bridge',[(-.565,-2.02,1.52),(.565,-2.02,1.52)],.043,'rail')

# Two short, slotted exhaust bells with deep throats and individual folded cowls.
for s in (-1,1):
    x=s*.412
    yz=[(-1.73,.38),(-2.24,.38),(-2.38,.50),(-2.38,.89),(-2.25,1.046),(-1.73,1.046)]
    profile('Pressed exhaust housing',yz,(x-.397,x+.397),'exhaust',.052)
    lathe('Rolled nozzle lip',[(.27,-1.99),(.343,-2.085),(.35,-2.16),(.343,-2.29),
          (.313,-2.46),(.304,-2.475),(.281,-2.473),(.272,-2.454)],(x,-.17,.686),m='exhaust')
    lathe('Exhaust throat',[(.279,-2.46),(.267,-2.38),(.242,-2.21),(.20,-2.12),(0,-2.115)],
          (x,-.17,.686),m='throat')
    add(cylinder('Recessed exhaust back',.254,.015,(x,-2.405,.686),(math.pi/2,0,0),48,('throat',)))
    for a in np.linspace(0,2*math.pi,12,endpoint=False):
        def flute(r,y):
            return (x+r*math.cos(a),y-.17,.686+r*math.sin(a))
        tube('Stamped flute',[flute(.345,-2.295),flute(.339,-2.334),flute(.322,-2.422)],.0065,'darkmetal')

# The canopy has a crowned cross-section, rolled drip edge and a downward
# scallop over each rear pillar. The two transverse joints follow the crown.
def canopy_point(t,u):
    # t across width; u from rear to front. Round the four plan corners.
    end_round=.14*abs(t)**8
    y=(-2.105+end_round)*(1-u)+(1.86-end_round)*u
    x=t*(.866+.05*math.sin(math.pi*u)**.6)
    dip=.182*math.exp(-((y+1.84)/.25)**2)*abs(t)**3
    z=2.978+.094*(1-t*t)+.045*math.sin(math.pi*u)-.135*u**7-.053*(1-u)**8-dip
    return x,y,z
def canopy_section(u):
    ts=np.linspace(-1,1,31)
    upper=[canopy_point(t,u) for t in ts]
    # The leading edge is visibly thinner than the side and rear valance.
    depth=.115-.068*u**8
    lower=[(x*.987,y,z-depth+.014*(1-t*t)) for (x,y,z),t in zip(upper,ts)]
    return upper+[(upper[-1][0]+.008,upper[-1][1],upper[-1][2]-.026)]+list(reversed(lower))+[
        (upper[0][0]-.008,upper[0][1],upper[0][2]-.026)]
for start,end in [(0,.354),(.356,.697),(.699,1)]:
    edge_round(loft('Canopy pressing',[canopy_section(u) for u in np.linspace(start,end,28)]),.016)
for u in [.355,.698]:
    tube('Canopy joint',[(x,y,z-.007) for x,y,z in [canopy_point(t,u) for t in np.linspace(-1,1,31)]],
         .008,'lining')
for s in (-1,1):
    profile('Spoiler pedestal',[(-1.56,3.015),(-1.82,2.99),(-1.94,3.228),(-1.76,3.235)],
            (s*.48,s*.57),radius=.019)
wing=[(-1.56,3.24),(-1.64,3.27),(-1.83,3.285),(-2.00,3.278),(-2.018,3.25),(-1.87,3.23),(-1.63,3.22)]
profile('Aerodynamic spoiler blade',wing,(-.895,.895),radius=.02)
for s in (-1,1):
    profile('Spoiler end plate',[(-1.52,3.204),(-1.61,3.29),(-1.80,3.365),(-2.05,3.374),
             (-2.032,3.326),(-1.92,3.21),(-1.68,3.188)],(s*.875,s*.91),radius=.016)

# Keep the individual pressings editable in the .blend; join only an export copy.
for obj in parts:
    for face in obj.data.polygons:
        face.use_smooth=True
    obj.data.set_sharp_from_angle(angle=math.radians(44))
body_objects=list(parts)
wheel_collection=bpy.data.collections.new('Wheels')
sc.collection.children.link(wheel_collection)
for x,y in [(0,AXLE_F),(-TRACK,AXLE_R),(TRACK,AXLE_R)]:
    start=len(parts)
    lathe('Tire',[(.245,-.125),(.335,-.144),(.391,-.122),(.409,-.082),(.409,-.058),
                  (.403,-.054),(.41,-.049),(.41,.049),(.403,.054),(.409,.058),(.409,.082),
                  (.392,.12),(.336,.145),(.245,.125),(.245,-.125)],(x,y,HUB),axis='x',m='tire')
    for s in [-1,1]:
        lathe('Pressed hub',[(.25,s*.121),(.248,s*.135),(.225,s*.139),(.204,s*.117),
              (.135,s*.124),(.10,s*.142),(.086,s*.15),(0,s*.151)],(x,y,HUB),axis='x',m='hub')
    if x==0:
        front_wheel=parts[start:]
    for obj in parts[start:]:
        for face in obj.data.polygons:
            face.use_smooth=True
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        wheel_collection.objects.link(obj)

def view(direction):
    for area in bpy.context.screen.areas:
        if area.type=='VIEW_3D':
            space=area.spaces.active
            space.overlay.show_overlays=False
            space.shading.type='SOLID'
            space.shading.color_type='MATERIAL'
            space.shading.light='STUDIO'
            space.shading.background_type='VIEWPORT'
            space.shading.background_color=(.37,.38,.40)
            space.shading.show_cavity=True
            space.shading.cavity_type='WORLD'
            space.shading.cavity_valley_factor=1.15
            space.region_3d.view_rotation=Vector(direction).to_track_quat('Z','Y')
            space.region_3d.view_distance=4.8
            space.region_3d.view_location=(0,-.24,1.65)
            space.region_3d.view_perspective='ORTHO'
view((-5,5.25,1.68))
bpy.ops.object.select_all(action='DESELECT')
bpy.context.preferences.filepaths.save_version=0
if BLEND:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
def export_copy(objects, name):
    bpy.ops.object.select_all(action='DESELECT')
    for obj in objects:
        copy=obj.copy()
        copy.data=obj.data.copy()
        sc.collection.objects.link(copy)
        copy.select_set(True)
        bpy.context.view_layer.objects.active=copy
    bpy.ops.object.join()
    result=bpy.context.object
    result.name=name
    return result

export_object=export_copy(body_objects,'Tuk Tuk v3')
wheel=export_copy(front_wheel,'TukTukWheel')
for vertex in wheel.data.vertices:
    vertex.co-=Vector((0,AXLE_F,HUB))
export_object.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(DST), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
bpy.data.objects.remove(export_object,do_unlink=True)
bpy.data.objects.remove(wheel,do_unlink=True)
print('Built Tuk Tuk v3:',len(body_objects),'body components and three preview wheels')
