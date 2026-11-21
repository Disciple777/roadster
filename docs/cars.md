# Cars

How the RoadsterThruster cars are made, and the numbers they have to fit.

## The roster

| id | name | how it was made | in the Garage |
|---|---|---|---|
| thruster | THRUSTER | built in code (`js/car.js`) | from the start |
| mantis | MANTIS | `tools/model_mantis.py` | from the start |
| ridgeback | RIDGEBACK | `tools/model_ridgeback.py` | from the start |
| halo | HALO | `tools/model_halo.py` | locked |
| brick | BRICK | `tools/model_brick.py` | locked |
| rhino | RHINO | `tools/model_rhino.py` | locked |
| comet2 | COMET v2 | `tools/model_comet2.py` | locked |
| bastion2 | BASTION v2 | `tools/model_bastion2.py` | locked |
| comet, bastion | COMET, BASTION | Meshy + `tools/prep_car.py` | showroom only |
| pebble | PEBBLE | Tripo + `tools/prep_car.py` | showroom only |

### Locks
In `js/car.js`:
- `G.GARAGE_CARS` is the Garage list, in display order.
- `G.START_CARS` are the cars you can pick on a first run. Every other Garage car shows greyed out with a padlock.
- Clicking a locked car previews it on the live car as a cyan **hologram** (`G.HOLO`, a scanline/static shader; the
  game loop ticks its time) and shows the unlock goal with progress. `S.car` stays on the last car you can drive, and
  leaving the Garage or starting anything (`endPreview()`, called from `backPanel` and `closePanels`) swaps it back.
- `G.carUnlocked(id)` decides. It is true for a start car, when "unlock all" is on (localStorage `rt_unlockAll`), or when
  the id is in localStorage `rt_unlockedCars`.
- **Ctrl+Shift+U** anywhere in the game toggles "unlock all" and shows a toast. Pressing it again locks them back, and if
  you were driving a locked car you are put back in THRUSTER.
- On load, a saved car that is no longer in the Garage or is locked falls back to THRUSTER.

### Unlock goals
`G.UNLOCKS` in `js/car.js`, one goal per locked car, each with `of() → [done, needed]`:

| car | goal | recorded in |
|---|---|---|
| HALO | finish a Street Race on every track | `finish()` adds the track to `rt_progress.tracks` |
| BRICK | win an Official Street Race (`G.unofficial` empty, P1) | `finish()` sets `officialWin` |
| RHINO | clear every Stunt Challenge level (practice counts) | `rt_chalLvl_<i>`, written by `challenge.js complete()` |
| COMET v2 | complete the official Obstacle Course without wrecking (solo or multiplayer) | `finishCourse()` sets `courseDone` |
| BASTION v2 | finish a multiplayer race with at least one other person | `mpProgress()` sets `mpRaced` |

`game.checkUnlocks()` runs after each of those (and once at startup, so old progress counts). It moves met goals into
`rt_unlockedCars` and shows a "NEW CAR UNLOCKED" toast per car. To add a goal: add an `G.UNLOCKS` entry, record its
progress with `G.progress({...})` where it happens, and call `this.checkUnlocks()` there.

To add a car to the game: add its `G.CARS` entry, then put its id in `G.GARAGE_CARS` (and in `G.START_CARS` if it should
be free).

## Making a hand-built car

### 1. Concept
In one ChatGPT chat: a front 3/4 view of the car in flat matte grey, then "the exact same car from a rear 3/4 view".
Save them as `models/source/<id>_front.png` and `models/source/<id>_rear.png` (these are committed).
**Show both to the user and wait for an OK before modelling.**

#### Prompts
Keep each car's prompt here, so it can be re-run or tweaked.

**ATLAS** (prize for winning the World Tour):
> Concept art of a futuristic grand-touring race car for an arcade racing game, front three-quarter view from slightly
> above, on a plain light grey studio background. A long, low, wide two-seater GT: a long sculpted bonnet with a sharp
> centre crease, slim wraparound LED headlight blades, a big lower air intake, a teardrop bubble canopy set well back,
> deep side scoops behind the front wheels, and muscular rear haunches. Its signature is a large thin hoop wing: a
> ring-shaped aerofoil that rises from both rear haunches and arches over the tail like a planet's orbit, and inside it
> sit two big round rocket thruster nozzles in the tail. Simple dark wheels. Clean hard-surface
> design with simple readable shapes, easy to model in 3D. The whole car is flat matte grey clay, no decals, no text.

Then, in the same chat: "Now the exact same car from a rear three-quarter view, same style, flat matte grey."

### 2. Model script
Write `tools/model_<id>.py`. It starts with:
```python
import sys, os; sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from carlib import *
```
then builds the body, adds parts and ends with `finish(...)`. `tools/model_brick.py` (boxy) and
`tools/model_halo.py` (round, lathed parts) are good templates.

Run it (Blender 5.2):
```
blender -b -P tools/model_<id>.py -- models/<id>.glb --renders <tmpdir>/<id> --blend models/source/<id>.blend
python tools/sheet.py <tmpdir>/<id>
```
`--renders` writes six views (front34, rear34, side, front, rear, top) with stand-in wheels, and `sheet.py` puts them on
one `sheet.jpg`. Compare it with the concepts and iterate. `--blend` saves the scene for hand inspection (commit the
`.blend`, delete the `.blend1` backups).

### 3. Frame and fixed numbers
- Blender frame: **front +Y, up +Z, ground z = 0**, metres. The glTF export turns this into the game's front -Z, up +Y.
- The physics wheels are fixed for every car: **front axle y = +1.42, rear axle y = -1.45**. The wheel centre height
  is `wheelR - 0.01`.
- Wheels are *not* modelled. The game adds its own wheels on the physics wheels, sized by the kit's `wheelR`
  (radius) and `wheelX` (half track). The tyre half-width is `0.16 * wheelR / 0.37`. Cut arches big enough for them:
  arch radius ≈ wheelR + 0.07.
- Typical sizes: body length about 4.2–5.1 m (y -2.5 … +2.6), half-width 0.95–1.25 m, wheelR 0.40–0.52.
- Keep it light: 15k–40k triangles. `finish()` prints `TRIS` and `BBOX`. A BBOX much bigger than the car means a
  decal missed the body and flew off (see below).

### 4. Materials
Use carlib's names. The game swaps the first four for its own.
- `paint` is the body colour, recoloured in the Garage.
- `glass`
- `light_head` and `light_tail` glow at night and when braking.
- Fixed-look materials: `black`, `trim`, `grille`, `metal`, `darkmetal`, `rubber`, `amber`.

### 5. carlib toolbox (`tools/carlib.py`)
- **Shapes and profiles**
  - `pchip(points)` makes a smooth monotone profile (y → value). Use it for width, floor, waist and top lines.
  - `loft(name, control, ...)` makes a smooth body from a section function `control(y) → [(x, z)…]` (half
    section, mirrored).
  - `section_loft(name, sections, mats)` makes a body from explicit closed sections. Use it for chamfered or boxy bodies
    and cabins.
  - `rounded(poly, r)` rounds a polygon's corners. `ellipse(...)` and `bezier_pts(ctrl, n)` make outlines and paths.
- **Combining**
  - `boolean(target, cutter, op)` cuts or unions: wheel arches, cockpits, thruster bays. Call `refresh(body)` after
    cutting, before any decal or `surf_*` probe.
- **Parts**
  - `box`, `cylinder`, `tube(name, pts, r, m)` (cage tubes, rails, wipers), `lathe(name, profile, centre)` (lamps,
    bezels, pods, nozzles).
  - `nozzle(x, z, r, exit_y)` is a thruster nozzle with vanes.
- **Placing parts on the skin**
  - `surf_z / surf_x / surf_y` probe the body surface so parts can sit on it.
- **Decals**
  - `front_decal`, `rear_decal`, `side_decal`, `top_decal`, and the general `decal(...)`, project a 2D outline onto
    the body as a thin offset patch: shut lines, windows, grilles, lights, vents.
  - The rays start 0.6 m outside the bounding plane and travel at most 4 m. For a windscreen or anything recessed,
    use `decal()` with a custom origin close to the surface (e.g. y 1.3–1.6 for a windscreen).
  - Decals tear on sharp chamfers. Use boxes or lathed parts there instead.
- **`finish(body, id, wheelR, wheelX, wheel_w, rear=[(x, y, z)…], side=(x, y), cam_h)`**
  - Joins everything, smooths the shading, prints the numbers and writes the renders, the .blend and the GLB.
  - `rear` is the nozzle exit centres (Blender coordinates).
  - `side` is where the side thruster puffs come out.

### 6. Game entry
`finish()` prints the lines you need:
```
KIT rear [[x, z, -y], …]
KIT sideX … sideY …
KIT wheelR … wheelX …
```
Add the car to `G.CARS` in `js/car.js`:
```js
{
  id: 'brick', name: 'BRICK', desc: 'One line for the Garage.',
  glb: 'models/brick.glb', v: 1, hand: true,
  kit: { rear: [[-0.32, 0.42, 2.34], [0.32, 0.42, 2.34]], rearW: 1.1, sideX: 0.92, sideY: 0.6, wheelR: 0.43, wheelX: 0.86 },
},
```
- `rear` holds the thruster flame origins (game frame), straight from the KIT line.
- `rearW` scales the flame width to the nozzle: about 1 for small nozzles and 2 for big turbines.
- `hand: true` means the GLB keeps its own materials. There is no `shade` or `mask`, which only the AI-textured cars
  need.
- Bump `v` whenever the GLB changes, so browsers fetch the new file.

Then add it to `G.GARAGE_CARS` (see Locks).

### 7. Check in the showroom
Open `showroom.html` locally (the `roadster` preview server, port 8080). Pick the car, check it from all sides, with the
thrusters on, and in the chase-cam view. Send the user a side-by-side of concept vs. showroom.

If the browser pane is hidden, the page canvas is 0×0. To capture, render offscreen with a fresh camera:
```js
const R = SHOWROOM.renderer, W = 900, H = 560, rt = new THREE.WebGLRenderTarget(W, H, { samples: 4 });
const cam = new THREE.PerspectiveCamera(32, W / H, 0.05, 200); cam.position.set(4.6, 1.9, -5.4); cam.lookAt(0, 0.65, 0);
R.setRenderTarget(rt); R.render(SHOWROOM.scene, cam); /* readRenderTargetPixels → 2D canvas (flip rows) → toDataURL */
R.setRenderTarget(null);
```
Camera z < 0 is the front of the car.

### 8. Ship
Commit the script, GLB, `.blend` and `js/car.js` changes, push, then run `node tools/deploy.mjs` (see CLAUDE.md).

## AI-generated cars (older pipeline, showroom only)
Use **Tripo** (studio.tripo3d.ai), not Meshy: Meshy's meshes come out dented.

1. In one ChatGPT chat, make:
   - a front 3/4 concept;
   - "the exact same car from a rear 3/4 view" (flat matte grey);
   - straight orthographic front, left-side and back views of that same car. Tripo's multi-view wants straight-on
     views.
2. In Tripo, choose HD Model and the multi-view icon, and fill the Front / Left / Back slots.
   - Geometry & Texture: Ultra Mesh, 4K texture, Remove Lighting, PBR.
   - Set **Polycount 150000**. The default 3000 comes out faceted.
3. Export the GLB to `models/source/X_tripo.glb`. Raw GLBs stay out of git.
4. Run `blender -b -P tools/prep_car.py -- models/source/X_tripo.glb models/X.glb --yaw 0 --tris 200000 --analyze <tmpdir>`.
   - Check the renders. If the printed WHEELS are wrong, pass `--wheels yFront,yRear,radius` (source units).
   - prep_car.py clears stale normals, cuts round wheel arches (`--arch 1`) and takes shading normals from a smoothed
     copy (`--nsmooth 14`).
5. Add a `G.CARS` entry from the `KIT` line, with `shade` low (~0.05) and a paint `mask`.

COMET and BASTION came from Meshy with `--yaw -90`.
