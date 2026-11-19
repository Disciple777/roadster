# RoadsterThruster

Browser racing game (three.js, no build step). Live at https://guatermelon.com/roadster/.

## Always ship
When a task is done, always do all three without asking:
1. Commit (end the message with the Co-Authored-By line).
2. Push `main` to GitHub.
3. Deploy live with `node tools/deploy.mjs`, then open the live site and check it loads.

## Adding a car
Use **Tripo** (studio.tripo3d.ai), not Meshy: Meshy's meshes come out dented.
ChatGPT, one chat: front 3/4 concept, then "the exact same car from a rear 3/4 view" (flat matte gray), then straight
orthographic front, left side and back views of that same car (Tripo's multi-view wants straight-on views) →
Tripo, HD Model, multi-view icon: Front / Left / Back slots. Geometry & Texture: Ultra Mesh, 4K texture, Remove Lighting,
PBR, **Polycount 150000** (the default 3000 is faceted) → export GLB → `models/source/X_tripo.glb` →
`blender -b -P tools/prep_car.py -- models/source/X_tripo.glb models/X.glb --yaw 0 --tris 200000 --analyze <tmpdir>` →
check the renders; if the printed WHEELS are wrong, pass `--wheels yFront,yRear,radius` (source units) →
add an entry to `G.CARS` in `js/car.js` using the `KIT wheelR … wheelX …` line the script prints, place the `rear` nozzles on the model's ports.
Raw GLBs stay out of git (`models/source/*.glb`); the concept PNGs are kept.
prep_car.py clears stale normals, cuts round wheel arches (`--arch 1`) and takes shading normals from a smoothed copy (`--nsmooth 14`).
In `G.CARS` keep `shade` low (~0.05). Older cars (COMET, BASTION) came from Meshy with `--yaw -90`.
