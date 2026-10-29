// tuning.js — the car's handling numbers in one place. Edit a value, save, reload the page.
// Thruster forces are in "car weights": 1.0 pushes as hard as gravity pulls the car down.
// Notes in brackets give the original value, so you can always go back.
(function () {
  G.TUNING = {
    // ---- world / body ----
    gravity: 12,             // m/s² pull on the car (also traffic and loops) [12]
    mass: 1400,              // kg; heavier = more momentum in crashes, needs more force to move [1400]

    // ---- engine & brakes ----
    enginePower: 520000,     // watts; sets the top speed and how fast you pull at high speed [520000]
    maxDriveForce: 19000,    // N; launch / low-speed acceleration [19000]
    brakeForce: 26000,       // N [26000]
    airDrag: 0.55,           // drag per m/s of speed; higher = lower top speed [0.55]
    downforce: 0.9,          // grip from speed while on the ground [0.9]

    // ---- tyres & steering ----
    tyreGrip: 1.35,          // friction; higher = sticks harder in corners [1.35]
    corneringFront: 9500,    // front tyre side stiffness; higher = sharper turn-in [9500]
    corneringRear: 10000,    // rear tyre side stiffness; lower = drifts more easily [10000]
    steerLowSpeed: 0.72,     // max wheel angle (radians) when slow [0.72]
    steerHighSpeed: 0.24,    // max wheel angle (radians) at 110 m/s and above [0.24]

    // ---- suspension ----
    springStiffness: 40000,  // N/m; higher = stiffer, bouncier [40000]
    damperBump: 5600,        // damping when the wheel goes up [5600]
    damperRebound: 9500,     // damping when the wheel drops back [9500]

    // ---- thrusters ----
    underThrust: 1.35,       // Space: all four under-thrusters together, in car weights [1.35]
    rearThrust: 1.7,         // Shift: rear boost, in car weights [1.7]
    rearThrustFadeSpeed: 185,// m/s where the rear boost has faded to its minimum [185]
    sideThrust: 2.6,         // side thrusters, in car weights [1.3 before the 2× buff]
    thrustCeiling: 22,       // metres above ground before thrusters start losing power [22]
    thrustFadeRange: 26,     // metres above the ceiling over which they fade to 25% [26]

    // ---- thruster fuel (tank is 100) ----
    fuelUnder: 13,           // per second, per side of under-thrusters [13]
    fuelRear: 17,            // per second for the rear boost [17]
    fuelSide: 11,            // per second per side thruster [11]
    fuelRecharge: 8,         // per second while on the ground and not thrusting [8]
    fuelRechargeDelay: 0.5,  // seconds after the last thrust before recharging starts [0.5]

    // ---- air control ----
    airPitch: 7000,          // nose up / down torque in the air [7000]
    airYaw: 6500,            // turning torque in the air [6500]
    airRoll: 6000,           // barrel-roll torque in the air [6000]
  };
})();
