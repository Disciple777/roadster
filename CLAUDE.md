# RoadsterThruster

Browser racing game (three.js, no build step). Live at https://guatermelon.com/roadster/.

## Always ship, after every change
Every change, however small, ends with all of these, without asking first:
1. Commit (end the message with the Co-Authored-By line). Don't commit `models/source/*.blend1` or `tools/__pycache__/`.
2. Push `main` to GitHub.
3. Deploy live with `node tools/deploy.mjs`, then open the live site and check that it loads with no console errors.

Never print `.env.deploy` (it holds the FTP credentials).

## Cars
Full workflow and specs: **[docs/cars.md](docs/cars.md)**. In short:
- The cars in the game are **hand-modelled in Blender** by `tools/model_<id>.py` on the shared kit `tools/carlib.py`,
  from two ChatGPT concept images (`models/source/<id>_front.png`, `<id>_rear.png`). Show the user the concepts and wait
  for an OK before modelling.
- Garage roster and locks: `G.GARAGE_CARS` and `G.START_CARS` in `js/car.js`. Ctrl+Shift+U unlocks every car (testers).
- `showroom.html` lists every car, including the older AI-generated ones (COMET, BASTION from Meshy, PEBBLE from Tripo),
  which are not in the Garage. Their pipeline (Tripo multi-view → `tools/prep_car.py`) is at the end of docs/cars.md.
