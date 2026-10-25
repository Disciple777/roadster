Camera snapshot taken 2026-10-23, before raising/tilting the chase camera.
To restore the old camera: copy the updateCamera() function from
game.camera-before-2026-10-23.js back into js/game.js (or replace the whole file
if nothing else in game.js changed since). Old chase values:
  near cam (mode 0): distance 6.4 + speed*1.6, height 2.1 - speed*0.25
  far cam  (mode 1): distance 10.5 + speed*1.6, height 3.6 - speed*0.25
  look target: 4 m ahead of the car, 1.0 m above it
camera-before.png shows the old view.
