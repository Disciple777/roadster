// tuning.js — the car's handling numbers in one place. Edit a value, save, reload the page, or try them live in the
// physics sandbox (index.html?sandbox), whose COPY SETTINGS button gives back just the values you changed.
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
    springTravel: 0.55,      // metres of wheel travel below the body; also the ride height [0.55]
    bumpStop: 0.36,          // compression (m) where the bump stop starts [0.36]
    bumpStopStiffness: 10,   // bump stop spring, times springStiffness [10]
    bumpStopDamping: 3,      // bump stop damping, times damperBump [3]
    maxWheelForce: 6,        // most one wheel can push, in car weights [6]

    // ---- body ----
    inertiaPitch: 3400,      // how hard the car is to pitch (nose up / down); lower = flips faster [3400]
    inertiaYaw: 3900,        // how hard it is to spin flat [3900]
    inertiaRoll: 1400,       // how hard it is to barrel-roll [1400]
    bodyStiffness: 160000,   // N/m when the body itself (roof, nose, corners) hits the ground [160000]
    bodyDamping: 9000,       // damping of those body hits; higher = less bounce off the body [9000]
    bodyFriction: 0.55,      // body scraping along the ground [0.55]
    spinDampAir: 0.9,        // how fast spin dies away in the air, per second [0.9]
    spinDampGround: 0.25,    // the same on the ground [0.25]
    maxSpin: 12,             // fastest the car can rotate, rad/s [12]
    autoLevelAir: 5200,      // torque that rights the car in the air when you're not steering it [5200]
    autoLevelGround: 3500,   // the same on the ground [3500]

    // ---- driving assists ----
    steerAssist: 1.35,       // yaw rate (rad/s) the steering asks for at full lock [1.35]
    gripAssist: 6,           // how fast sideways sliding is turned into forward motion [6]
    driftRearGrip: 0.42,     // rear grip while drifting, times normal [0.42]
    driftRearSide: 0.35,     // rear side stiffness while drifting, times normal [0.35]
    driftBrake: 9000,        // N of rear-wheel braking while drifting [9000]

    // ---- crashes ----
    wallBounce: 1.35,        // 1 = stops dead against a wall, 2 = full bounce [1.35]
    carBounce: 1.25,         // roadster against roadster, same scale [1.25]
    trafficBounce: 1.25,     // roadster against traffic, same scale [1.25]

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

    // ---- traffic (the NPC cars once they're knocked loose) ----
    trafficMass: 1,          // times each car's own mass (sedan 1500 kg, bus 12000…) [1]
    trafficLooseMass: 0.7,   // a car already knocked loose weighs this much in later hits [0.7]
    trafficLandBounce: 0.25, // how much of its fall speed a car bounces back up with [0.25]
    trafficBounceSpeed: 4,   // m/s it must land faster than to bounce at all [4]
    trafficSlide: 9,         // m/s² a sliding car slows down on the ground [9]
    trafficSpinDamp: 2.5,    // how fast a sliding car stops spinning [2.5]
    trafficSettle: 5,        // how fast a car tips back onto its wheels (or roof) [5]
    trafficTumbleDamp: 6,    // how fast tumbling dies away on the ground [6]
    trafficKnockLift: 0.25,  // upward kick per m/s of hit [0.25]
    trafficKnockLiftMax: 9,  // most upward kick, m/s [9]
    trafficKnockRoll: 0.25,  // random roll from a hit [0.25]
    trafficKnockPitch: 0.12, // random pitch from a hit [0.12]
  };
})();
