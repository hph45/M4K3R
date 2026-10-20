# Simulation

## Working now

Run the circuit directly in **Wiring** or a schematic with **Run circuit**. Motor
symbols show a rotating fan and RPM; LEDs glow, and nearby button/switch controls
operate the simulated contacts. **Pause circuit** freezes the current state and
**Reset circuit** starts again from rest. This uses the first saved simulation's
settings, or defaults when there is none; viewing or running a circuit creates no
documents.

For saved scope setups, choose **New simulation…** from the command palette and
click **Run** in that workspace.
Hold a push button to close its contact, click an SPDT switch to change position, and
watch LED brightness, motor speed, battery charge and component current. Motors
retain an explicit Spinning/Paused/Stopped label when reduced motion disables
the animation. **Pause**
keeps state, **Step** advances 1 ms (or one larger solver step), and **Reset** starts
again from rest. The speed selector requests a realtime factor; the readout shows
the factor the worker achieves. Circuit edits and changes to the solver step restart
the session. Scope probes retain the latest 600 samples, with a separate vertical
scale for each trace. Press **⌘/Ctrl+Enter** to run or pause the open simulation.

The current solver handles R, C, L, diode, LED, NMOS, battery, push button, SPDT
switch, voltage source, DC motor, regulator, H-bridge and aggregate ESC/motor/propeller
models. Name the ground net **GND** or **0**.
Parts without a model are ignored with a visible warning. Firmware simulation is
also coupled to the circuit as described below. Pinless mechanical parts do not
need an electrical model. General peripheral devices, RF propagation and SPICE-level
analog are on the [roadmap](roadmap.md).

Simulation documents save `analysis` (`tran` or `op`), `duration`, fixed `step`,
requested live `speed`, `probes`, and timed `inputs`. Times are numeric seconds in
the saved data. Create one with `doc.create` and `kind: "simulation"`; change any
subset of its settings with `sim.update`, for example:

```json
{"type":"sim.update","args":{"doc":"Power","duration":0.5,"probes":["V(VBAT)","I(BT1)"],"inputs":[{"t":0.1,"ref":"SW1","action":"press"},{"t":0.3,"ref":"SW1","action":"release"}]}}
```

Run the saved analysis through the `simulation_run` MCP tool with `{project, doc}`
or `POST /api/projects/:id/simulation/:doc/run` with optional `{maxPoints}`.
The existing `simulate` tool and `POST /api/projects/:id/simulate` still accept an
ad hoc analysis. Saved transient duration controls headless runs; the interactive
workspace keeps running until paused. Live button/switch interactions affect the
current session and are cleared by Reset; timed inputs remain part of the saved
setup. `createSession(project, {step})` exposes the same stepping, inputs, snapshots
and probe reads to other integrations.

## Firmware and circuit together

Choose a firmware document under **Firmware + circuit** in a simulation or the
Wiring circuit toolbar. The local server compiles the real source, executes the
machine code in lockstep with the analog solver, and returns a paused circuit
snapshot with GPIO, serial and scope results. The default browser batch spans
100 ms. This is distinct from the continuously interactive analog worker.

`POST /api/projects/:id/simulation/coupled` accepts `firmware` document ids/names,
`duration` seconds, `step`, `probes`, timed `inputs` and optional `vehicle` settings.
The `firmware_simulate_circuit` MCP tool accepts the same fields plus `project`.
Build diagnostics are returned when compilation fails. Runs have a 30-second wall
budget and explicitly report partial completion. All documents must target
different MCU components.

- RP2040 uses genuine UF2 machine code in rp2040js. Output pads have a modeled
  30 Ω resistance; pulls are 50 kΩ. Digital inputs have 0.3/0.7 VDD hysteresis.
  Actual executed PWM edges are averaged within each analog step. GPIO26–29
  receive solved voltages through the emulated 12-bit ADC.
- ESP32 uses the pinned official Espressif emulator through its verified adapter.
  Digital GPIO coupling is available. External ADC, averaged PWM and I²C/SPI
  peripheral injection are not exposed by this adapter. Sampled servo pulses may
  drive the ESC model; analog steps must resolve the pulse widths.
- MCU logic supply defaults to an ideal 3.3 V. Boot/brownout behavior, power draw,
  pad protection and damage are not inferred from the analog supply rail.

The aggregate `esc-propeller` model requires explicit propeller diameter, `ct`,
`cp`, `fullRpm`, reference `voltage` and efficiency. It never derives thrust from
kV alone. `signalMode: "servo"` decodes 1–2 ms pulses (configurable `minPulse` and
`maxPulse`) and stops after 100 ms without valid pulses. `signalMode: "average"`
accepts averaged 0–3.3 V control. RPM follows a configurable spin-up time. A
brushless motor wired to all three phase outputs shares the ESC aggregate
RPM/thrust/torque state for visualization; three-phase electrical waveforms are
not modeled.

## Propulsion and device feasibility

Create a **device-analysis** document, link an assembly and supply battery/rotor
data. `device.analysis.set` updates its data; `device_analyze` or
`GET /api/projects/:id/device-analysis/:doc` evaluates it. The UI shows assembled
mass, CG and world inertia, per-rotor thrust/torque/current/RPM, maximum thrust to
weight, collective hover, loaded battery voltage, charge-based runtime and
propeller clearance checks.

Rotor performance is either a user-supplied measured curve with test voltage and
source, or explicit generic Ct/Cp coefficients with a source and reference RPM/
voltage. The UI imports CSV columns `throttle,thrust_N,current_A` with optional
`rpm,torque_Nm`. Throttle is 0…1; values must be SI. Measured curves cover 0…1
and nondecreasing thrust and current over the modeled operating region. Their thrust is not extrapolated across
voltage. Maximum and hover are validated separately against the test voltage:
an operating point more than 5% away is unvalidated. An unvalidated maximum and
thrust/weight ratio are withheld even when hover remains valid; raw full-throttle
predictions remain explicitly available as `rawMaximum`. Missing torque stays unknown. Generic coefficients and generic
catalog masses are labeled estimates.

The voltage/current operating point solves `V = Voc - I(V)R`. Hover finds equal
collective throttle providing upward force equal to assembled weight and reports
the residual moment about CG. Prop clearance uses horizontal disc/AABB envelopes,
not exact aerodynamic geometry. Unknown assembly masses prevent an affirmative
feasibility result; overlapping prop envelopes and exceeded battery limits have
their own result states. These are static feasibility estimates, not proof of
flight stability, a flight controller, structural strength or safe operation.
The maximum available thrust respects battery current and loaded-voltage limits;
the raw full-throttle estimate can exceed them. Unknown placed component masses
are reported as `missingMass`, with `massComplete: false` and a known-mass subtotal.
Assembly collisions and keepout conflicts also prevent an affirmative result.

## Rigid-body flight preview

After analyzing a device, use **Rigid-body flight preview** to set collective or
individual rotor throttle, initial roll/pitch, CG altitude and duration. The server
computes a deterministic trajectory, then the browser replays the rotor layout,
altitude, attitude and battery traces. **Use estimated hover throttle** provides
the static collective operating point; it does not stabilize or trim the aircraft.

`POST /api/projects/:id/device-analysis/:doc/flight` and MCP
`device_flight_preview` use the same calculation. The core `simulateFlight(data,
geometry, options)` is browser-safe and has no firmware/toolchain dependency.
Runs are bounded to 10 seconds, fixed steps from 0.5 to 20 ms, 100 timed control
changes and approximately 400 returned frames. The default step is 5 ms. Timed
controls take effect at the first solver step at or after their requested time.

The model uses assembly mass, CG, full symmetric CG inertia, rotor positions and
axes. It applies gravity, per-rotor thrust, lever-arm torque and airframe reaction
torque to a six-degree-of-freedom rigid body, with normalized quaternion
orientation. World +Z is up; returned position/velocity are world meters/m/s,
body angular velocity is rad/s, and displayed roll/pitch/yaw are degrees.
Quaternions are `[w,x,y,z]` and rotate body vectors into world space. Rotor CW/CCW
is viewed from the positive local rotor axis toward the rotor: a CW rotor spins
along −axis, so its reaction torque on the airframe is along +axis.

The electrical operating point includes constant battery open-circuit voltage,
internal-resistance sag, electronics draw and usable-charge accounting. A common
throttle scale caps all requested rotor commands at the battery voltage/current
limits. Charge exhaustion removes thrust; ground contact uses rotated assembly
bounding-box corners and stops motion. Missing mass, invalid inertia, unresolved
mechanical conflicts, missing measured reaction torque, or a requested voltage
outside a measured curve's 5% validation band produce explicit errors.

This preview executes manual theoretical controls. It is separate from real
Pico/ESP firmware execution and does not claim an ESP flight-control closed loop.
There is no autopilot, attitude hold, aerodynamic wake interaction, forward-flight
propeller correction, wind, flexible structure, motor lag, full battery discharge
curve, terrain, bounce or ground-contact torque. Optional linear/angular drag
coefficients are user inputs rather than inferred aerodynamic measurements.
The MPU6050 coupled adapter is not driven by this flight trajectory. Real firmware
can be tested against circuit peripherals separately; validated flight software,
sensor dynamics and flight-controller tuning remain further work.

## Scenarios and planar vehicles

Saved simulations accept `checks`: `{t,probe,min?,max?,equals?,tolerance?}`. Edit and
run them in **Scenario assertions**, with `simulation_scenario`, or by posting to
`/api/projects/:id/simulation/:doc/scenario`. Checks run after deterministic timed
inputs and report actual sample time, measured value and explicit pass/fail.

The **Planar vehicle** panel links assembly mass and yaw inertia, then accepts
wheel radius and left/right DC motor refs. Parameters can also be set through
`sim.update` under `vehicle` (or `null` to disable). Motor current produces net
shaft torque; chassis wheel speed feeds back through motor back-EMF. Limited
traction, rolling resistance and yaw damping drive the planar position/heading
view in analog and coupled runs. Terrain, collisions, lateral slip, transmission
losses and motor rotor inertia added to chassis inertia are not modeled.

## Virtual radio model

The nRF24 model supports hardware-SPI register access, channel/address matching,
static/dynamic payloads, RX/TX FIFO state, IRQ, basic ACK and MAX_RT. The coupled
runner discovers `nrf24` component wiring to a Pico hardware SPI bus and connects
the actual rp2040js peripheral. Two independently compiled Pico programs exchanging
a packet through these adapters are covered by a gated machine-code E2E test.
The register/command reference is the [Nordic nRF24L01+ specification](https://docs-be.nordicsemi.com/bundle/nRF24L01P_PS_v1.0/raw/resource/enus/nRF24L01P_PS_v1.0.pdf).

This is an ideal virtual medium: RF loss/propagation/timing, ACK payloads, retries
over simulated time, bit-banged SPI and multiple radios on one MCU SPI bus are not
implemented. ESP32 bus injection is not implemented by the current adapter.

The Pico coupled runner also exposes a real hardware-I²C callback bus. Parts
explicitly identified as `mpu6050` (part id or `props.sensorModel`) bind to a subset
of the [TDK MPU6050 register map](https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Register-Map.pdf): identity, power/range settings and injected accelerometer,
gyro and temperature values. The default input is stationary +Z gravity with zero
rotation; planar vehicle yaw can drive the gyro. A gated E2E compiles actual Pico
`Wire` code and verifies its output changes when the physical sensor input changes.
DMP, sensor FIFO, noise, data-ready interrupt timing and six-axis flight dynamics
remain unsupported. A generic IMU connector does not imply this specific chip.

## Model API

A model is a factory keyed by `part.sim.model`. It runs once (init) and returns the instance:

```ts
type ModelFactory = (ctx: ModelContext) => Model   // ctx: pin(name) → node, num("value") from props then sim.params,
                                                   //      node()/branch() for internal unknowns, v(node)
interface Model {
  nonlinear?: boolean                     // stamp depends on the solution → Newton iterations
  stamp(s: Stamper): void                 // analog: conductance(), current(), voltage(), add(); s.dt = ∞ at DC
  step?(t: number, dt: number): void      // advance internal state after an accepted step
  current?(): number                      // main current through the part
  view?(): View                           // what the UI renders (LED brightness, motor rpm, battery soc)
  input?(e: SimInput): void               // user interaction: { t, ref, action: "press" }
}
```

Models live in `packages/sim/src/models/`, one file each, tested against analytic results.

**Solver:** dense LU with partial pivoting, refactored only when the matrix changes, so a linear circuit costs one forward/back substitution per step. Newton–Raphson with junction limiting, and gmin stepping if the operating point won't converge. C and L use backward Euler: first-order, but it never rings on switch edges or contact bounce, and the live-sim step is far below circuit time constants. Transients start from rest (capacitors discharged, motors stopped), like powering on.
