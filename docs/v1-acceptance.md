# Local v1 acceptance

M4K3R v1 is a local device planning application. The reference project is **Plan a drone** on the home screen. It combines a shared BOM, ESP32-C3 controller, four motors/propellers/ESCs, battery/regulator/IMU interfaces, editable printed frame/cradle/battery tray, a routed power PCB, firmware and static propulsion analysis.

## Release checks

The integrated source passes 201 unit/HTTP checks, recursive typechecking and a production build. The separate ten-test compiler/emulator suite passes all eight gated machine-code cases and its two unit cases. All 20 production browser workflows pass with compiler gates enabled, including actual Pico/ESP32 execution and a compiled Pico driving the circuit LED. Physical hardware flashing remains untested. Each packaged snapshot has a separate `release:check` report.

| Workflow | Acceptance evidence |
|---|---|
| Shared project | Save/reload, live updates, undo/redo and API/MCP commands work across views; components have one identity |
| Circuit | Drop and move parts, attach/edit wires, operate controls, see actual simulated LED/motor feedback |
| Mechanical | Configure catalog families, build sketches/features, mount components/CAD/boards, inspect mass/CG/inertia and fit, export STL/STEP/3MF |
| Electronics | Place/route two copper layers, vias and zones; diagnose ERC/DRC; export actual Gerber/drill/BOM/PnP/STEP with errors blocked |
| Firmware | Save recoverable source drafts, compile pinned Pico/ESP32 targets, execute actual binaries and inspect UART/GPIO; download the exact build |
| Coupling | Real Pico GPIO/PWM/ADC, SPI nRF24 and I²C MPU6050; ESP32 digital GPIO; analog scope/scenarios and planar skid-steer |
| Drone analysis | Automatic analysis with undoable input edits and measured CSV; rotor data from motor/propeller parts; assembly mass/rotor poses; thrust/torque/current/RPM, battery sag/limits, T/W, hover/runtime and prop clearance; bounded quaternion rigid-body preview with manual controls and replay |
| Delivery | Production browser suite, real compiler/emulator checks, fresh-home release archive smoke and included third-party notices |

## What the drone example establishes

The power PCB is a small routed interconnection board, with the flight electronics and motors explicitly off-board. Its DRC result establishes the implemented geometric rules, not a current-carrying/thermal qualification. The printed frame has actual motor and mounting holes; the cradle and tray remain editable CAD feature trees. Catalog geometry is a planning proxy and mass is labeled estimated unless a user supplies measured/vendor data.

Rotor data in the example lives on the motor and propeller parts and is illustrative. Replace it with measured data for the selected motor, propeller, ESC and battery before assessing an actual aircraft. The analysis does not infer thrust from kV. The ESP32 source is a bench pulse generator at minimum throttle, not a stabilizing flight controller. The example demonstrates planning and execution infrastructure; it does not establish flightworthiness.

## Supported fidelity and remaining scope

The v1 adapters execute actual MCU instructions. Pico PWM is averaged over each analog step, and its ADC receives circuit voltage. The ESP emulator adapter currently exposes sampled digital GPIO and UART; external ADC/PWM/I²C/SPI injection is unavailable. nRF24 uses an ideal addressed packet medium with explicit protocol limits. MPU6050 is a register-level sensor with injected motion rather than a complete flight dynamics model.

The flight preview uses six-degree-of-freedom rigid-body mechanics, assembly CG/inertia, static rotor loads, battery limits and conservative ground contact. Its manual throttle inputs are separate from executed firmware; it contains no stabilizing autopilot, wind, wake interaction, motor lag or detailed contact aerodynamics. RF propagation, FEA/thermal certification, arbitrary peripheral models, four-layer boards and advanced sweep/loft CAD remain separate work. Public distribution also requires a first-party license decision and review of bundled dependency/source obligations; the local release script does not publish anything.

## Commands

```sh
pnpm test
pnpm typecheck
pnpm build
M4K3R_E2E_PRODUCTION=1 pnpm test:e2e
M4K3R_FIRMWARE_E2E=1 pnpm test packages/firmware/src/e2e.test.ts packages/firmware/src/coupled.e2e.test.ts packages/firmware/src/radio.e2e.test.ts packages/firmware/src/i2c.e2e.test.ts
M4K3R_ESP_E2E=1 pnpm test packages/firmware/src/esp.test.ts apps/server/src/drone-firmware.e2e.test.ts
pnpm release:package
pnpm release:check
```

Real hardware Web Serial/flashing is initiated by the user selecting a physical port. Browser tests exercise the UI and protocol contract using isolated test transports; they cannot certify an unattached physical board.
