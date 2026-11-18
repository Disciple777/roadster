# RoadsterThruster

Browser racing game (three.js, no build step). Live at https://guatermelon.com/roadster/.

## Always ship
When a task is done, always do all three without asking:
1. Commit (end the message with the Co-Authored-By line).
2. Push `main` to GitHub.
3. Deploy live with `node tools/deploy.mjs`, then open the live site and check it loads.

## Adding a car
ChatGPT concept images in one chat: front 3/4 first, then "the exact same car from a rear 3/4 view" (flat matte gray) →
Meshy workspace, Image to 3D, turn on **Multi-view**: front image in Main View, rear image in Back (Meshy 7, texture on, 35 credits) → GLB in `models/source/` →
`blender -b -P tools/prep_car.py -- models/source/X_meshy.glb models/X.glb --yaw -90 --tris 200000` →
add an entry to `G.CARS` in `js/car.js` using the `KIT wheelR … wheelX …` line the script prints.
Raw Meshy GLBs stay out of git (`models/source/*.glb`); the concept PNGs are kept.
prep_car.py clears Meshy's stale normals, cuts round wheel arches (`--arch 1`) and takes shading normals from a smoothed copy (`--nsmooth 14`) so panels don't look dented.
In `G.CARS` keep `shade` low (~0.05): Meshy bakes blotchy lighting into the albedo.
