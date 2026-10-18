# Simulation

Two tools, each good at one thing:

| | **Live sim** | **Circuit analysis** |
|---|---|---|
| Question | "Does the whole device work?" | "Is this circuit right?" |
| Runs | Firmware + circuit + physics together, interactively | One sheet or block, offline |
| Engine | Our engine: rp2040js + behavioral models + small MNA solver | ngspice (WASM) |
| Time scale | µs to minutes | ns to ms |
| Example | Press a button on a remote and watch a robot drive | An amplifier's gain and bandwidth |

Things outside electronics, like light, particles or RF propagation, are modeled as simple event sources, not physics.

## Live sim

### Nets are split into two kinds

- **Digital nets** are resolved by drive strength: strong, pull-up/down, or high-Z. Buttons and pull-ups live here. They're event-driven and cost nothing when idle.
- **Analog nets** are solved with MNA every step: batteries, regulators, motors, LEDs, RC filters, ADC inputs.

The netlister classifies each net automatically. An MCU pin connects to either kind through a **pin bridge**:
- An output drives an analog net as a voltage source with output resistance.
- An input reads an analog net through VIH/VIL thresholds, or through the ADC.

### Buses attach at the peripheral level

SPI and I²C devices hook into rp2040js peripheral callbacks (`onTransmit`, `onWriteByte`…) instead of bit-level pin edges. That makes them fast and synchronous. The binding comes from the netlist: if the nRF24's MOSI is wired to GP19, it's attached to SPI0, and it only sees traffic if the firmware enables SPI0 on GP19.
Trade-off: bit-banged protocols aren't supported in v1.

### Scheduler

One Web Worker. Simulated time is independent of wall time. The UI shows the realtime factor.

```
loop, quantum Δ = 10 µs (sim time):
  1. run each MCU for f_clk·Δ cycles       (bus traffic happens synchronously inside)
  2. solve analog nets (Newton–Raphson; PWM outputs averaged over their period)
  3. update MCU inputs from analog nets    (thresholds, ADC)
  4. step models (motor ODEs, battery SoC, timers)
  5. every 1 ms: step physics            every frame: post a snapshot to the UI
```

**PWM averaging** keeps the analog step large. A 20 kHz PWM into a motor is treated as its mean voltage. A net can opt into exact edges if its timing matters.

### Model API

```ts
interface Model {
  init(ctx: ModelContext): void           // declare pins, read params from part.json
  stamp?(m: Stamper, t: number): void     // analog: add conductances and sources to MNA
  onPin?(pin: string, level: Logic, t: number): void  // digital: react to input changes
  step?(t: number, dt: number): void      // advance internal state
  view?(): unknown                        // what the UI renders (LED glow, motor rpm, OLED pixels)
  input?(e: UserEvent): void              // user interaction (press a button)
}
```

Models live in `packages/sim/models/`, one file each, with a unit test against known values.

### Models needed for v1

| Model | Behavior |
|---|---|
| R, C, L | Linear MNA stamps |
| Diode / LED | Shockley + series R. LED brightness ∝ current. |
| Button / switch | Contact with configurable bounce (default 5 ms) |
| Battery | OCV(SoC) curve + internal R, coulomb counting |
| Regulator | Vout = min(Vset, Vin − Vdrop), quiescent current, current limit |
| Boost (behavioral) | Regulates to the setpoint from its divider, with ripple and efficiency |
| DC motor | `V = iR + L di/dt + Kₑω`, `J dω/dt = Kₜi − bω − τ_load`. Params come from datasheet stall/no-load numbers. |
| H-bridge (DRV8833) | IN1/IN2 truth table (fwd/rev/coast/brake), R_DS(on), nFAULT on overcurrent |
| RP2040 | rp2040js + pin bridges + ADC |
| nRF24L01+ | Register-level SPI model, TX/RX FIFOs, auto-ack/retries, IRQ. Radios share a virtual channel with distance-based loss. |
| SSD1306 | I²C commands → 128×64 framebuffer, shown in the UI and on the 3D model |
| microSD | SPI SD protocol over an in-memory FAT image. Files can be downloaded after a run. |
| BMP280 | I²C registers. Temperature and pressure come from the scenario. |
| Buzzer | Frequency/duty → audio (Web Audio) |
| Pulse source | Random (Poisson) events with configurable rate and amplitude distribution, e.g. for a light or particle sensor |
| Behavioral block | Stands in for a fast circuit, e.g. amp + peak detector + comparator. See blocks below. |

### Blocks: when a circuit is too fast for live sim

Some circuits, like a sensor front-end, work in nanoseconds, while the live sim steps in microseconds. The fix:

1. Put the fast circuit on its own **hierarchical sheet** (e.g. `FrontEnd`).
2. Assign the sheet a behavioral block model. Its params are expressions over the parts on that sheet, e.g. `gain = 1 + R5/R4` and `t_hold = R9*C7`.
3. Live sim uses the block. Circuit analysis uses the real parts.
4. **Consistency check:** ngspice runs a test pulse through both and flags it if they disagree by more than 5%.

### Physics

Ground vehicles use a planar differential/skid-steer model:
- Each track gets force from motor torque ÷ sprocket radius.
- Friction models lateral slip.
- Mass and inertia come from CAD mass properties.

It's rendered in the 3D assembly view. It's about 100 lines and needs no physics engine. (Add Rapier if we need collisions with obstacles.)

### Instruments

Click a net or component to probe it.

| Instrument | Shows |
|---|---|
| Scope | Analog nets vs time |
| Logic analyzer | Digital nets, with SPI/I²C/UART decode |
| Meter | V, I, P on any net or part |
| Serial monitor | MCU UART/USB serial |
| Power | Per-rail current, battery SoC, estimated runtime |

## Circuit analysis (ngspice)

- Pick a sheet and an analysis: `.op`, `.dc`, `.ac`, `.tran`. Probes are placed on the schematic.
- The netlister emits SPICE from the schematic, using each part's `spice.lib` or a generic model.
- Results plot in the same scope UI.

## Scenarios = tests

A scenario is a script of inputs and checks. It runs in the UI, and it also runs headless in CI.

```ts
scenario("forward then stop", async (s) => {
  s.press("remote.SW1"); s.press("remote.SW3")                  // L▲ + R▲
  await s.wait(2_000)
  s.expect(s.body("robot").distance()).toBeGreaterThan(0.4)    // m
  s.releaseAll()
  await s.wait(100)
  s.expect(s.model("robot.M1").rpm()).toBeCloseTo(0, 0)
})
```

Scenarios can be run from the UI, the API (`run_scenario`), or CI.

## Performance targets

| | Target |
|---|---|
| 2 MCUs + physics | ≥ 0.5× realtime on an M1 laptop |
| 1 MCU + peripherals | ≥ 1× realtime |
| Model step (whole project) | < 5% of the frame budget |
