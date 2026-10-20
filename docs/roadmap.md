# Roadmap

## Local v1 release candidate

The original interrupted preview is integrated. The active milestone is a complete local device-planning workflow, using **Plan a drone** as the reference project. [Acceptance criteria and fidelity limits](v1-acceptance.md) define what is tested.

| Workstream | Implemented |
|---|---|
| Projects | Shared component/BOM identity, live updates, reversible command batches, API/MCP parity and persisted JSON/source files |
| Circuit and schematic | Drag/drop parts, direct wires, manual bends, labels/junctions/no-connects, multi-unit symbols, ERC and visible motor/LED simulation |
| PCB | Two-layer placement/routing, vias/zones, net classes, off-board components, ratsnest, DRC, actual Gerber/Excellon/BOM/PnP/STEP ZIP and board 3D |
| Mechanical | Constrained sketches/features, face sketches/splines, configurable catalog families, printable templates, assemblies/mounts, exact mass/inertia/solid fit and STL/STEP/3MF |
| Firmware | Recoverable Monaco editor, pinned Pico/ESP32 compilation, exact artifacts, real CPU execution, serial/GPIO, user-triggered physical serial/C3 flashing controls |
| Device simulation | Pico GPIO/PWM/ADC + hardware SPI/I²C adapters, nRF24/MPU6050 models, scenarios/instruments, planar skid-steer, static propulsion/battery analysis and bounded manual-control rigid-body flight preview |
| Reference drone | ESP32, ESC/motor/propeller/battery/IMU interfaces, editable frame/cradle/tray, mounted hardware, routed power PCB, bench firmware and explicit rotor estimates |
| Local delivery | Host-specific archive, startup/setup/check scripts, dependency notices and pinned source archives; final snapshot validation follows integration |

The local v1 implementation is integrated. Unit, production-browser and real MCU suites cover the workflows above. Use `pnpm release:check` to verify each generated host archive; the task board and generated release report record the latest evidence. This is a local release candidate, not a public distribution announcement.

## Validation gates

1. Unit/HTTP checks, recursive typecheck and production build pass.
2. Production browser workflows cover persistent edits/undo, circuit feedback, mechanical mounting/export, board routing/fabrication, firmware drafts and hardware-control boundaries.
3. Real Arduino binaries execute in Pico/ESP32 emulators. PWM/ADC, two-MCU radio, I²C sensor and saved drone coupling use machine-code tests.
4. Drone geometry has no unintended positive-volume collisions or keepout intrusions; its board passes the implemented DRC. Estimated mass/rotor data remains identified.
5. A release archive starts with Node 24 on a matching host, uses an empty isolated project home, evaluates CAD/assembly and exports printable output without installing a compiler on startup.

## Subsequent work

- More measured parts/propulsion datasets and manufacturer geometry imports.
- Detailed SPICE/precision analog, more peripheral devices and richer debugging.
- Higher-fidelity RF, aerodynamics, contact, thermal and structural analysis.
- Hierarchical sheet ports, more PCB layers, push-and-shove and broader manufacturing checks.
- Sweep/loft and additional production CAD/drawing workflows.
- Physical hardware and manufacturer fabrication validation, plus public distribution licensing decisions.

These are distinct from the supported, tested v1 adapters. A simulated result is scoped to its documented models; unsupported behavior is reported rather than fabricated.
