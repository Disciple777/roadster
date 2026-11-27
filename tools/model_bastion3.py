"""Build the Showroom Bastion from its paired front and rear concept images.

Blender: -P tools/model_bastion3.py -- models/bastion3.glb --blend models/source/bastion3.blend
Use --renders DIR for the two studio views. Coordinates follow carlib: front is +Y.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import (AXLE_F, AXLE_R, BLEND, DST, PNG, M, Vector, add, arches, bezier_pts,
                    bmesh, boolean, box, bpy, cylinder, front_decal, lathe, loft, mat, new_obj, np,
                    parts, pchip, refresh, rounded, sc, section_loft, side_decal, surf_x,
                    surf_y, surf_z, top_decal, tube)


WHEEL_R, TRACK = .395, .918
HUB = WHEEL_R - .01
TURBINE_X, TURBINE_Z, TURBINE_EXIT = .306, .333, -2.575

M.update({
    'paint': mat('paint', (.195, .194, .194), .39, .24),
    'glass': mat('Bastion smoked glass', (.009, .0095, .011), .25, .0),
    'rubber': mat('Tire rubber', (.013, .014, .015), .79),
    'wheel': mat('Graphite wheel finish', (.051, .053, .056), .36, .76),
    'rim': mat('Diamond-cut alloy', (.36, .375, .393), .29, .8),
    'rotor': mat('Brake rotor', (.18, .169, .157), .49, .69),
    'titanium': mat('Turbine titanium', (.145, .143, .145), .37, .76),
    'honeycomb': mat('Grille honeycomb', (.048, .047, .046), .48, .38, double=True),
    'gasket': mat('Window gasket', (.008, .009, .01), .4),
    'seam': mat('Panel gaps', (.057, .057, .059), .55),
    'light_head': mat('light_head', (.8, .85, .88), .27, emit=(.93, .96, 1), emit_s=1.3),
    'light_tail': mat('Bastion red taillights', (.56, .006, .008), .26, emit=(1, .014, .009), emit_s=1.05),
})
M['glass'].node_tree.nodes['Principled BSDF'].inputs['Specular IOR Level'].default_value = .21
for material in M.values():
    material.diffuse_color = material.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value


# Sections run from the tail forward. The roof and shoulders share the same
# continuous skin, with fuller rear quarters and a relief cut into each sill.
def profile(column):
    return pchip([(row[0], row[column]) for row in SECTIONS])


#    station  crown  glass edge height/width  max width  shoulder height  sill
SECTIONS = [
    (-2.365,  .934, .929, .750, .967, .890, .166),
    (-2.245,  .963, .950, .808, 1.000, .918, .157),
    (-1.970,  .985, .938, .842, 1.032, .935, .157),
    (-1.570, 1.018, .897, .793, 1.072, .917, .154),
    (-1.290, 1.107, .863, .779, 1.060, .883, .153),
    (-1.020, 1.214, .842, .777, 1.007, .839, .150),
    (-.745,  1.307, .825, .771, .954, .796, .146),
    (-.440,  1.347, .820, .765, .936, .785, .144),
    (-.135,  1.340, .823, .765, .932, .785, .144),
    (.130,   1.281, .841, .773, .935, .802, .147),
    (.350,   1.157, .875, .791, .948, .832, .147),
    (.595,    .982, .916, .812, .968, .864, .150),
    (.850,    .954, .910, .832, 1.004, .881, .155),
    (1.250,   .922, .902, .841, 1.054, .899, .159),
    (1.580,   .888, .877, .835, 1.068, .881, .159),
    (1.910,   .841, .841, .824, 1.033, .845, .159),
    (2.185,   .778, .760, .819, .998, .765, .163),
    (2.365,   .713, .691, .807, .975, .702, .166),
]
z_top, z_belt, w_belt, w_body, z_shoulder, z_sill = [profile(i) for i in range(1, 7)]
roof_width = pchip([(-1.65, .746), (-1.00, .595), (-.55, .616), (-.24, .626),
                   (.075, .632), (.39, .67), (.69, .794)])


def section(y):
    w, s, side, crown = w_body(y), z_sill(y), z_shoulder(y), z_top(y)
    cabin = np.clip((crown - z_belt(y)) / .30, 0, 1) if -1.65 < y < .69 else 0
    door = math.exp(-((y + .13) / .88)**4)
    hood = math.exp(-((y - 1.37) / .73)**4) * .023
    edge = w_belt(y)
    return [
        (0, s), (.72*w, s), (.94*w, s + .017), (.99*w, s + .067),
        (w - .071*door, .385), (w, side - .105), (w - .036, side - .030),
        (edge, z_belt(y)),
        ((1-cabin)*.88*edge + cabin*roof_width(y), crown - .058*cabin + (z_belt(y)-crown)*.58*(1-cabin)),
        (.49*edge, crown - .011*cabin + hood), (0, crown),
    ]


body = loft('Continuous body shell', section, [2, 3, 3, 5, 6, 6, 5, 12, 8, 9],
            lambda segment, y: 2 if segment < 2 else 0, -2.365, 2.365,
            step=.027, extra=[row[0] for row in SECTIONS])
bm = bmesh.new()
bm.from_mesh(body.data)
end_edges = [edge for edge in bm.edges if all(abs(abs(v.co.y)-2.365) < .0001 for v in edge.verts)]
bmesh.ops.subdivide_edges(bm, edges=end_edges, cuts=4, use_grid_fill=True)
bm.to_mesh(body.data)
bm.free()
for vertex in body.data.vertices:
    x, y, z = vertex.co
    # Sweep the bumpers back into their adjoining fenders. Both reference
    # photos show rounded corners and a near-vertical central fascia.
    front = max(0, (y - 1.50) / .865)**1.29
    rear = max(0, (-y - 1.92) / .445)**2
    vertex.co.y += rear*.172*abs(x)**2.5 - front*.362*abs(x)**2.35
    vertex.co.y += front*.049*(1 - ((z - .40)/.38)**2) - rear*.022*(1 - ((z - .56)/.47)**2)
    # A swept crease above each lamp picks up the raised outer fender.
    lamp_crease = math.exp(-((z - (.575 + .18*(abs(x)-.47))) / .061)**2)
    side_weight = min(1, max(0, (abs(x)-.38)/.22))
    vertex.co.y -= front*.052*lamp_crease*side_weight
arches(body, HUB, .419, x_in=.722, depth=.63)
add(body)
refresh(body)


def satin_line(name, points, radius, material='seam', closed=False):
    return tube(name, points, radius, material, res=0, closed=closed)


def top_line(name, outline, radius=.0023, closed=False):
    satin_line(name, [(x, y, surf_z(x, y) + .0017) for x, y in outline], radius, closed=closed)


def side_line(name, outline, sign, radius=.0023, material='seam', closed=False):
    satin_line(name, [(sign*(surf_x(y, z, sign) + .0014), y, z) for y, z in outline],
               radius, material, closed)


# Bonded glass has its own outlines, with painted pillars breaking up the
# surfaces and a slim black divider between the two side panes.
for name, corners, radius in [
    ('Windscreen', [(-.757, .583), (.757, .583), (.581, -.045), (-.581, -.045)], .107),
    ('Fastback glass', [(-.538, -.762), (.538, -.762), (.618, -1.534), (-.618, -1.534)], .075),
]:
    top_decal(name + ' bonded edge', rounded(corners, radius, 6), 'gasket', .0038, 3)
    center = np.mean(corners, axis=0)
    inner = [tuple(center + (np.array(point) - center)*(.984, .983)) for point in corners]
    top_decal(name, rounded(inner, radius*.94, 6), 'glass', .0067, 4)

window = [(.533,.907), (.164,1.199), (-.040,1.267), (-.350,1.282),
          (-.670,1.232), (-.997,1.105), (-1.245,.961), (-1.232,.931),
          (-.890,.879), (-.501,.853), (-.063,.866), (.286,.890)]
for sign in (-1, 1):
    side_decal('Side glass gasket', rounded(window, .060, 5), 'gasket', sign, .0055, 3)
    center = np.mean(window, axis=0)
    inner = [tuple(center + (np.array(point)-center)*(.986, .960)) for point in window]
    side_decal('Side glass', rounded(inner, .055, 5), 'glass', sign, .0082, 4)
    side_decal('B-pillar', [(-.620,.863), (-.651,.863), (-.555,1.246), (-.530,1.250)],
               'gasket', sign, .012, 4)
    door = [(.528,.891), (.579,.772), (.556,.407), (.473,.247), (.216,.215),
            (-.615,.218), (-.795,.270), (-.862,.478), (-.913,.673), (-.863,.799), (-.670,.874)]
    side_line('Door shut line', bezier_pts(door, 9), sign)
    handle = rounded([(-.684,.765), (-.515,.774), (-.521,.737), (-.660,.730)], .018, 6)
    side_decal('Handle pocket', handle, 'seam', sign, .003, 3)
    side_decal('Body-color handle', rounded([(-.674,.766),(-.527,.773),(-.534,.748),(-.669,.742)],
                                          .014, 5), 'paint', sign, .009, 3)
    side_line('Rear bumper shut line', bezier_pts([(-2.270,.708),(-2.110,.690),(-1.907,.641)], 8), sign)

    # A separate painted sill blends into the base of each wheel arch.
    sill_rows = []
    for y in np.linspace(-1.045, 1.014, 37):
        fade = .4 + .6*math.sin(math.pi*(y + 1.045)/2.059)**.42
        x = surf_x(y, .218, sign)
        sill_rows.append([(sign*(x-.050), y, .155), (sign*(x+.045*fade), y, .160),
                          (sign*(x+.056*fade), y, .178), (sign*(x-.019), y, .247),
                          (sign*(x-.073), y, .244)])
    add(section_loft('Pressed side skirt', sill_rows, ['paint']))

    stand_x = surf_x(.337, .934, sign)
    satin_line('Mirror mount', [(sign*stand_x,.345,.936),(sign*(stand_x+.066),.337,.958),
                               (sign*.903,.321,.997)], .030, 'trim')
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=1)
    for vertex in bm.verts:
        x, y, z = vertex.co
        vertex.co = (sign*(.916 + x*.121), .308 + y*.091 - x*.021, 1.009 + z*.055 + y*.007)
    add(new_obj('Mirror housing', bm, ['trim']))
    box('Mirror glass', (.143, .014, .054), (sign*.928, .236, 1.012), (0, 0, sign*-.12), 'glass')

hood_outline = [(-.784,.606),(-.628,1.288),(-.625,1.765),(-.650,2.095),(-.617,2.216),
                (-.34,2.306),(0,2.337),(.34,2.306),(.617,2.216),(.650,2.095),
                (.625,1.765),(.628,1.288),(.784,.606),(.35,.601),(0,.599),(-.35,.601)]
top_line('Hood shut line', bezier_pts(hood_outline + hood_outline[:1], 10), .002, True)


def inside(point, poly):
    x, y = point
    hit = False
    for (ax, ay), (bx, by) in zip(poly, poly[1:] + poly[:1]):
        if (ay > y) != (by > y) and x < (bx - ax)*(y - ay)/(by - ay) + ax:
            hit = not hit
    return hit


def lattice(name, outline, project, pitch, thickness):
    """Flat-sided hex webs projected onto the floor of each intake."""
    xmin, ymin = np.min(outline, axis=0)
    xmax, ymax = np.max(outline, axis=0)
    corners = [(pitch*math.cos(i*math.tau/6), pitch*math.sin(i*math.tau/6)) for i in range(6)]
    bm = bmesh.new()
    seen = set()
    for col, x in enumerate(np.arange(xmin-pitch, xmax+pitch, 1.5*pitch)):
        for y in np.arange(ymin-pitch + (col % 2)*pitch*.866, ymax+pitch, pitch*math.sqrt(3)):
            for (ux, uy), (vx, vy) in zip(corners, corners[1:] + corners[:1]):
                p, q = (x+ux, y+uy), (x+vx, y+vy)
                key = tuple(sorted((tuple(round(v, 5) for v in p), tuple(round(v, 5) for v in q))))
                if key in seen or not (inside(p, outline) and inside(q, outline)):
                    continue
                seen.add(key)
                dx, dy = -(vy-uy)*thickness/pitch, (vx-ux)*thickness/pitch
                face = [(p[0]+dx,p[1]+dy),(p[0]-dx,p[1]-dy),
                        (q[0]-dx,q[1]-dy),(q[0]+dx,q[1]+dy)]
                bm.faces.new([bm.verts.new(project(a, b)) for a, b in face])
    if bm.faces:
        ob = add(new_obj(name, bm, ['honeycomb']))
        solid = ob.modifiers.new('Grille web depth', 'SOLIDIFY')
        solid.thickness = .0016
    else:
        bm.free()


def facet_point(x, z, sign, depth):
    y = surf_y(x, z, sign > 0, default=sign*2.16)
    return (x, y - sign*depth, z)


def inset(name, corners, sign, depth, taper, material='grille', pitch=0, radius=.038):
    """Cut a true recessed pocket with a radiused outline and a painted lead-in."""
    poly = rounded(corners, radius, 6)
    poly = [(a[0]+(b[0]-a[0])*t, a[1]+(b[1]-a[1])*t)
            for a, b in zip(poly, poly[1:]+poly[:1])
            for t in np.arange(max(1, math.ceil(math.dist(a, b)/.05)))/max(1, math.ceil(math.dist(a, b)/.05))]
    center = np.mean(poly, axis=0)
    inner = [tuple(center + (np.array(point)-center)*taper) for point in poly]
    layers = [[facet_point(x, z, sign, d) for x, z in ring] for ring, d in [
        (poly, -.120), (poly, -.004), (inner, depth*.70), (inner, depth),
    ]]
    cutter = section_loft(name + ' cutter', layers, ['paint', material],
                          mat_of=lambda strip, i: int(strip >= 2))
    # A plain ngon cap would get material slot zero. The pocket floor and its
    # dark lower wall share the same material.
    cutter.data.polygons[-1].material_index = 1
    boolean(body, cutter)
    if pitch:
        lattice(name + ' honeycomb', inner, lambda x,z: facet_point(x,z,sign,depth*.91), pitch, .00105)


def mirrored(poly, sign):
    return [(sign*x, z) for x, z in poly]


# The BVH stays on the original body while the openings are cut, so every
# pocket, its grille and its lamps share the same curved fascia datum.
inset('Central intake', [(-.405,.476),(.405,.476),(.560,.177),(-.560,.177)],
      1, .105, (.91,.86), pitch=.014, radius=.051)
for sign in (-1, 1):
    inset('Bumper corner duct', mirrored([(.564,.466),(.885,.499),(.923,.436),(.915,.216),(.710,.200)],sign),
          1, .084, (.87,.85), pitch=.0125)
    head = [(.449,.544),(.518,.611),(.863,.673),(.934,.674),(.905,.605),(.872,.580)]
    front_decal('Smoked headlight housing', rounded(mirrored(head,sign),.027,6), 'gasket', .0058, 3)
    for start, end in [(.526,.682),(.714,.872)]:
        rail = [(sign*x, .559 + (x-.526)*.126) for x in np.linspace(start,end,16)]
        satin_line('White running light', [facet_point(x,z,1,-.009) for x,z in rail], .0048, 'light_head')
        optic = [(start,.574 + (start-.526)*.145), (end,.574+(end-.526)*.145),
                 (end,.595+(end-.526)*.15), (start+.012,.595+(start-.526)*.15)]
        front_decal('Smoked projector lens', rounded(mirrored(optic,sign),.009,4), 'trim', .008, 3)

    hood_vent = rounded(mirrored([(.364,1.036),(.584,1.073),(.560,.853),(.352,.831)],sign), .036, 6)
    top_decal('Hood vent recess', hood_vent, 'grille', .0045, 3)
    grille_center = np.mean(hood_vent, axis=0)
    hood_grille = [tuple(grille_center + (np.array(p) - grille_center)*.9) for p in hood_vent]
    lattice('Hood intake screen', hood_grille, lambda x,y:(x,y,surf_z(x,y)+.0075), .012, .001)

    side_vent = rounded([(.758,.757),(.936,.794),(.898,.638),(.785,.355),(.739,.382)], .036, 6)
    side_decal('Front fender outlet', side_vent, 'grille', sign, .004, 4)
    grille_center = np.mean(side_vent, axis=0)
    side_grille = [tuple(grille_center + (np.array(p) - grille_center)*.94) for p in side_vent]
    lattice('Fender outlet screen', side_grille,
            lambda y,z:(sign*(surf_x(y,z,sign)+.0075),y,z), .013, .00105)
    side_line('Fender outlet divider', [(y,.572+(y-.76)*.05) for y in np.linspace(.754,.866,8)],
              sign, .009, 'trim')


def fascia_lip(name, points, front):
    rows = []
    for x,y,z in bezier_pts(points, 8):
        d = 1 if front else -1
        rows.append([(x,y+d*.005,z-.012),(x,y+d*.004,z+.007),
                     (x,y-d*.023,z+.017),(x,y-d*.170,z+.014),(x,y-d*.185,z-.010)])
    return add(section_loft(name, rows, ['trim']))


front_lip = [(0,2.427,.153),(.43,2.365,.153),(.59,2.301,.138),(.83,2.191,.141),(.983,2.024,.157)]
fascia_lip('Full-width front splitter', [(-x,y,z) for x,y,z in reversed(front_lip[1:])] + front_lip, True)

inset('Recessed full-width lamp panel', [(-.862,.863),(.862,.863),(.908,.708),(.808,.668),(-.808,.668),(-.908,.708)],
      -1, .067, (.965,.89), 'trim', radius=.072)
inset('Diffuser opening', [(-.741,.168),(-.653,.409),(-.544,.453),(.544,.453),(.653,.409),(.741,.168)],
      -1, .180, (.94,.89), 'trim', radius=.043)
for sign in (-1, 1):
    inset('Rear bumper outlet', mirrored([(.696,.427),(.927,.471),(.915,.264),(.800,.220)],sign),
          -1, .085, (.86,.85), pitch=.013, radius=.038)
    fascia_lip('Rear bumper lower blade', [(sign*.692,-2.360,.151),(sign*.826,-2.337,.152),
                                           (sign*.972,-2.195,.168)], False)
    add(section_loft('Diffuser strake', [[(x,-2.352,.151),(x,-2.320,.219),(x,-2.115,.261),(x,-2.135,.159)]
                                        for x in (sign*.657,sign*.680)], ['trim']))

for x in (-.747, -.524, .524, .747):
    z = .771
    y = surf_y(x, z, False) + .014
    lathe('Round taillight bezel', [(.083,.029),(.093,.002),(.090,-.026),(.076,-.029),(.068,-.012)],
          (x,y,z), m='trim')
    ring = [(x + .071*math.cos(a), y-.030, z + .071*math.sin(a)) for a in np.linspace(0,math.tau,64,endpoint=False)]
    satin_line('Red LED taillight ring', ring, .0062, 'light_tail', True)
    lathe('Smoked taillight lens', [(.068,-.022),(.059,-.025),(.026,-.024),(.0001,-.022)], (x,y,z), m='glass')

# The deck lid and spoiler meet at the root, with a continuous scooped lip.
ducktail = []
for x in np.linspace(-.938,.938,73):
    u = abs(x)/.938
    tuck = .181*u**3
    z = .939 - .048*u*u
    h = .116*(1 - .70*u**8)
    ducktail.append([(x,-2.054+tuck,z-.025), (x,-2.107+tuck,z-.004),
                     (x,-2.219+tuck,z+.020), (x,-2.351+tuck,z+h*.82),
                     (x,-2.401+tuck,z+h), (x,-2.421+tuck,z+h*.87),
                     (x,-2.373+tuck,z+.027), (x,-2.357+tuck,z-.022)])
add(section_loft('Integrated ducktail', ducktail, ['paint']))

for sign in (-1, 1):
    center = (sign*TURBINE_X, TURBINE_EXIT, TURBINE_Z)
    lathe('Flared turbine housing', [(.117,.345),(.173,.284),(.198,.214),(.204,.103),
          (.190,.031),(.183,.015),(.179,.006),(.163,.008),(.152,.061),(.146,.125),(.138,.213)],
          center, segs=64, m='titanium')
    lathe('Machined turbine lip', [(.177,.008),(.180,.002),(.175,-.005),(.163,-.004),(.159,.011)],
          center, segs=64, m='metal')
    for offset, r in [(.104,.202),(.145,.203),(.181,.201),(.228,.189)]:
        lathe('Turbine case rib', [(r-.002,offset-.004),(r+.004,offset-.002),
                                  (r+.004,offset+.003),(r-.002,offset+.006)], center, segs=48, m='darkmetal')
    x, y, z = center
    add(cylinder('Turbine backplate', .142, .012, (x,y+.179,z), (math.pi/2,0,0), 64, ('grille',)))
    lathe('Turbine center cone', [(.051,.190),(.048,.123),(.031,.090),(.017,.077),(.0001,.072)], center, m='darkmetal')
    for a in np.linspace(0, math.tau, 19, endpoint=False):
        rows = []
        for r, d, sweep, width in [(.047,.153,.40,.006),(.078,.123,.29,.008),(.118,.093,.13,.007),(.155,.081,0,.004)]:
            angle = a + sweep
            rows.append([(x+r*math.cos(angle+da),y+d+dy,z+r*math.sin(angle+da))
                         for da,dy in [(-width,.040),(width,.025),(width,0),(-width,-.012)]])
        add(section_loft('Swept turbine vane', rows, ['darkmetal']))


def export_copy(objects, name):
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
    result = bpy.context.object
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    result.name = name
    return result


body_objects = list(parts)
lathe('Low-profile tire', [(.271,-.144),(.329,-.152),(.361,-.143),(.382,-.129),(.394,-.103),
      (.395,-.073),(.390,-.070),(.390,-.063),(.395,-.060),(.395,-.025),(.390,-.022),
      (.390,-.015),(.395,-.012),(.395,.029),(.390,.033),(.390,.040),(.395,.043),(.395,.073),
      (.390,.077),(.390,.084),(.395,.088),(.391,.105),(.382,.125),(.354,.145),(.315,.154),
      (.271,.151),(.271,-.144)], (0,0,0), axis='x', segs=96, m='rubber')
lathe('Polished deep-dish rim', [(.282,-.128),(.299,.105),(.308,.139),(.306,.153),(.298,.161),
      (.287,.161),(.280,.152),(.280,.132),(.277,.120),(.261,.086),(.254,.058),(.263,.047),
      (.279,.047),(.290,.113)], (0,0,0), axis='x', segs=96, m='rim')
add(cylinder('Brake rotor', .231, .017, (.024,0,0), (0,math.pi/2,0), 72, ('rotor',)))
add(cylinder('Hub center cap', .059, .018, (.112,0,0), (0,math.pi/2,0), 40, ('wheel',)))
lathe('Hub cap bevel', [(.056,.120),(.063,.114),(.065,.102),(.086,.092),(.097,.080),(.093,.053),
      (.016,.042)], (0,0,0), axis='x', m='wheel')
for i in range(10):
    angle = i*math.tau/10
    rows = []
    for r, x, sweep, width in [(.074,.093,.15,.017),(.106,.092,.06,.018),(.168,.086,-.075,.011),
                                 (.228,.082,-.127,.013),(.270,.091,-.10,.019)]:
        a = angle + sweep
        rows.append([(x+dx,r*math.cos(a)-off*math.sin(a),r*math.sin(a)+off*math.cos(a))
                     for dx,off in [(.008,-width),(.008,width),(-.015,width*.81),(-.015,-width*.81)]])
    add(section_loft('Concave wheel spoke', rows, ['wheel']))
for a in np.linspace(0, math.tau, 5, endpoint=False):
    add(cylinder('Lug bolt', .009, .010, (.104,.073*math.cos(a),.073*math.sin(a)),
                 (0,math.pi/2,0), 8, ('darkmetal',)))

for obj in parts:
    for face in obj.data.polygons:
        face.use_smooth = True
    obj.data.set_sharp_from_angle(angle=math.radians(43))

body_export = export_copy(body_objects, 'Bastion v3')
wheel_objects = parts[len(body_objects):]
wheel_export = export_copy(wheel_objects, 'BastionWheel')
body_export.select_set(True)
bpy.ops.export_scene.gltf(filepath=os.path.abspath(DST), export_format='GLB', use_selection=True,
                          export_apply=True, export_yup=True)
bpy.data.objects.remove(body_export, do_unlink=True)

wheels = bpy.data.collections.new('Mounted wheels')
sc.collection.children.link(wheels)
for y in (AXLE_F, AXLE_R):
    for sign in (-1, 1):
        instance = wheel_export.copy()
        instance.name = ('Front' if y > 0 else 'Rear') + (' left wheel' if sign < 0 else ' right wheel')
        instance.location = (sign*TRACK, y, HUB)
        instance.scale.x = sign
        wheels.objects.link(instance)
bpy.data.objects.remove(wheel_export, do_unlink=True)
for obj in wheel_objects:
    bpy.data.objects.remove(obj, do_unlink=True)


studio = bpy.data.collections.new('Studio')
sc.collection.children.link(studio)


def move_to_studio(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    studio.objects.link(obj)
    obj.hide_set(True)


bpy.ops.mesh.primitive_plane_add(size=200, location=(0,0,-.011))
floor = bpy.context.object
floor.name = 'Seamless gray floor'
floor.data.materials.append(mat('Gray studio floor', (.63,.62,.61), .79))
move_to_studio(floor)
world = bpy.data.worlds.new('Gray studio')
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = (.55,.56,.60,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value = .56
sc.world = world

for name, locus, target, power, size, height in [
    ('Large key softbox', (1.8,3.8,5.6), (0,.2,.1), 680, 5.5, 4.1),
    ('Front fill', (-3.9,2.7,3.0), (0,.5,.55), 310, 3.8, 3.9),
    ('Rear strip softbox', (2.9,-3.9,4.5), (0,-.9,.55), 550, 4.8, 2.6),
    ('Far side fill', (-3.9,-2.1,3.6), (0,-.5,.7), 400, 5.4, 3.6),
]:
    light = bpy.data.lights.new(name, 'AREA')
    light.energy, light.shape, light.size, light.size_y = power, 'RECTANGLE', size, height
    obj = bpy.data.objects.new(name, light)
    obj.location = locus
    obj.rotation_euler = (Vector(target)-obj.location).to_track_quat('-Z','Y').to_euler()
    studio.objects.link(obj)

cameras = {}
for name, locus in [('front', (-5.32,6.89,2.60)), ('rear', (-5.30,-6.92,2.68))]:
    camera = bpy.data.cameras.new(name.title() + ' reference angle')
    camera.lens = 62
    obj = bpy.data.objects.new(camera.name, camera)
    obj.location = locus
    obj.rotation_euler = (Vector((0,0,.54))-obj.location).to_track_quat('-Z','Y').to_euler()
    studio.objects.link(obj)
    cameras[name] = obj
sc.camera = cameras['front']
sc.render.engine = 'CYCLES'
sc.cycles.samples = 24
sc.cycles.use_denoising = True
sc.render.resolution_x, sc.render.resolution_y = 1440, 810
sc.view_settings.view_transform = 'AgX'
sc.render.image_settings.file_format = 'PNG'
bpy.ops.object.select_all(action='DESELECT')
for area in bpy.context.screen.areas:
    if area.type == 'VIEW_3D':
        view = area.spaces.active
        view.overlay.show_overlays = False
        view.shading.color_type = 'MATERIAL'
        view.shading.show_cavity = True
        view.region_3d.view_rotation = (sc.camera.location-Vector((0,0,.62))).to_track_quat('Z','Y')
        view.region_3d.view_distance = 6.6
        view.region_3d.view_location = (0,0,.62)

if BLEND:
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(BLEND))
if PNG:
    os.makedirs(PNG, exist_ok=True)
    for name, camera in cameras.items():
        sc.camera = camera
        sc.render.filepath = os.path.join(PNG, name + '.png')
        bpy.ops.render.render(write_still=True)
    sc.camera = cameras['front']
