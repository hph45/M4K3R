# API

The UI and AI agents use the same API. Every edit is a **command**, and every command shows up live in any open browser tab.

## Connect an agent

```bash
claude mcp add --transport http m4k3r http://localhost:4400/mcp
```

Or call the HTTP API directly. It's plain JSON, no auth, localhost only.

## Commands

```jsonc
POST /api/projects/:id/commands
{ "label": "Wire motor driver", "commands": [
  { "type": "component.add", "args": { "part": "resistor", "props": { "value": "10k" } } },
  { "type": "net.connect",   "args": { "pins": ["U1.GP10", "U2.AIN1"], "name": "L_IN1" } }
]}
→ { "version": 12, "results": [{ "id": "c_…", "ref": "R1" }, { "net": "L_IN1" }] }
```

A batch is atomic: all of it applies, or none of it does. It counts as one undo step.

| Command | Args | Does |
|---|---|---|
| `project.rename` | `name` | |
| `variable.set` | `name, value` | Sets a project variable (`"65 mm"`, `"pcb_w + 4"`) |
| `variable.remove` | `name` | |
| `part.vendor` | `part` | Copies a part definition into the project. Done automatically by `component.add`. |
| `component.add` | `part, ref?, props?` | Adds a component. `ref` is auto-numbered by the part's prefix. |
| `component.update` | `component, ref?, props?` | |
| `component.remove` | `component` | Also removes its pins from all nets |
| `net.connect` | `pins[], name?` | Connects the pins, merging nets when needed |
| `net.disconnect` | `pins[]` | |
| `net.rename` | `net, name` | |
| `doc.create` | `kind, name, data?` | Creates a doc of a registered kind (`part-studio`, `schematic`…) |
| `doc.rename`, `doc.remove` | `doc, …` | |
| `schematic.place` | `doc, component, x, y, rotation?` | Place/move/rotate a symbol in mm; connectivity stays in project nets |
| `schematic.add` | `doc, part, x, y, rotation?, props?` | Add a part and place its symbol atomically |
| `schematic.autoplace` | `doc, all?` | Place missing symbols, or rearrange the sheet |
| `schematic.remove` | `doc, component` | Unplace a symbol without deleting the component |
| `sim.update` | `doc, analysis?, duration?, step?, speed?, probes?, inputs?, checks?, vehicle?` | Update saved simulation settings; numeric times in seconds |
| `device.analysis.set` | `doc, data` | Save assembly link, battery, payload and sourced rotor performance inputs |
| `cad.sketch.add` | `doc, id?, plane?, offset?, entities?, constraints?` | Add a constrained planar sketch |
| `cad.feature.add/update/remove/move` | See `/api/commands` | Edit the parametric feature history |
| `cad.material.set` | `doc, material` | Set density for mass properties |

Domains add their own commands (`cad.*`, `schematic.*`, …). `GET /api/commands` always lists the current set.

`component` and `net` args accept either an id or a name/ref.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/api/health` | Status, release version and registered domains |
| GET | `/api/commands` | Every command with its JSON Schema |
| GET / POST | `/api/projects` | List or create (`{ name }`) |
| POST | `/api/demo` | Create an editable starter project with schematic, simulation, enclosure and firmware docs |
| POST | `/api/demo/drone` | Create the editable ESP32 mechanical/electrical/firmware/propulsion integration example |
| GET / DELETE | `/api/projects/:id` | |
| POST | `/api/projects/:id/commands` | Apply a batch |
| POST | `/api/projects/:id/undo`, `/redo` | |
| GET | `/api/projects/:id/netlist` | Readable wiring, plus unconnected pins |
| POST | `/api/projects/:id/simulate` | Run the circuit. See below. |
| POST | `/api/projects/:id/simulation/:doc/run` | Run a saved simulation setup; optional `{ maxPoints }` |
| GET | `/api/projects/:id/cad/:doc/mesh` | Triangle meshes, solved sketches, feature statuses and first error; optional `?until=featureId` for rollback |
| GET | `/api/projects/:id/cad/:doc/properties` | Bounds, volume (mm³), area and material mass (g); optional `?until=` and `?material=` |
| GET | `/api/projects/:id/cad/:doc/export.stl` | Download binary STL; `.step` downloads named STEP solids |
| GET | `/api/parts?q=` | Search the built-in and user libraries |
| GET | `/api/parts/:id` | |
| PUT | `/api/parts/:id` | Create or replace a part in the user library |
| POST | `/api/parts/import` | Import a KiCad part into the user library (see below). Returns `{ part, warnings }`. |
| GET | `/api/kicad/symbols?q=&lib=` | Search symbols across all KiCad libraries (top 50 `Library:Name`, best first); `lib` limits it to one. Without `q`, lists a library's symbols, or the libraries. |
| GET | `/api/kicad/footprints?lib=&q=` | Search footprint names in a KiCad library, or list libraries when `lib` is omitted |
| WS | `/ws` | Send `{ subscribe: id }`. Receive `{ project, version, patches }`. |
| GET | `/api/projects/:id/firmware/:doc/pins.h` | The generated pin header |
| POST | `/api/projects/:id/firmware/:doc/build` | `{ ok, hash, diagnostics, size, artifacts }`. See [firmware.md](firmware.md). |
| GET | `/api/projects/:id/firmware/:doc/build/:hash/firmware.uf2` | Also `firmware.elf`; ESP32 builds return `.bin`, `.bootloader.bin`, `.partitions.bin` and `.merged.bin` |
| POST | `/api/projects/:id/firmware/:doc/run` | `{ ms }` → `{ ok, serial, gpio, simulatedMs, wallMs }`, or `{ ok: false, diagnostics }` |

```jsonc
POST /api/parts/import
{ "symbol": "Driver_Motor:DRV8833PWP", "id": "drv8833", "overrides": { "category": "driver" } }
```

`symbol` is a `Library:Name` from the official KiCad libraries, or the contents of a `.kicad_sym` file (add `name` if it has several symbols).
`footprint` works the same way with `.kicad_mod` files. It defaults to the symbol's own footprint; pass `null` for none.
Pin alternates become pin `functions`. `warnings` lists pins without pads and pads without pins.
Symbol search uses an index of every official symbol, built on first use (under a minute), cached under `M4K3R_HOME/.cache/kicad/` and refreshed weekly; add `refresh=1` to rebuild it now.

## MCP tools

Each tool is a thin wrapper over an endpoint:
- `list_projects`
- `create_project`
- `get_project`
- `get_netlist`
- `apply_commands`
- `undo`
- `redo`
- `search_parts`
- `get_part`
- `save_part`
- `import_kicad_part`
- `search_kicad_symbols`, `search_kicad_footprints`
- `list_commands`
- `simulate`: the same as the endpoint, returned as compact text (final values plus ~20 points per waveform)
- `simulation_run`: run a saved simulation document with `{ project, doc, maxPoints? }`
- `cad_properties`: evaluate a part studio and read feature status, dimensions and mass
- `cad_export`: export STL/STEP/3MF to a local path
- `firmware_build`: compile a firmware doc, returns size or diagnostics
- `firmware_run`: build and execute actual RP2040 or supported ESP32 machine code, returns serial output, GPIO states and capability/time limits

New capabilities (schematic layout, PCB, CAD, simulation) show up as new commands plus read tools, such as `run_scenario` or `get_erc`. The API's shape stays the same.

## Integrated v1 domains

Exact schemas are discoverable at `/api/commands` and through MCP `list_commands`. These domains preserve the same command/undo/live-update model.

| Domain | Read/run/export HTTP paths under `/api/projects/:id` | MCP tools |
|---|---|---|
| Schematic | `/erc` | `schematic_check` |
| PCB | `/pcb/:doc/geometry`, `/drc`, `/mesh`, `/export.step`, `/fabrication.zip` | `pcb_check`, `pcb_geometry`, `pcb_export` |
| Assembly | `/assembly/:doc/mesh`, `/properties`, `/export.step`, `/export.stl`, `/export.3mf` | `assembly_properties`, `assembly_export` |
| Device | GET `/device-analysis/:doc`, POST `/device-analysis/:doc/flight` | `device_analyze`, `device_flight_preview` |
| Coupled firmware | POST `/simulation/coupled` | `firmware_simulate_circuit` |
| Scenarios | POST `/simulation/:doc/scenario` | `simulation_scenario` |

PCB export blocks DRC errors by default. `pcb.exclude` identifies off-board components. See [PCB](pcb.md) and [assembly](assembly.md) for coordinate systems, supported checks and exact export options.

Coupled run input: `{firmware:["Pico target"],duration:0.1,step:0.00001,probes:["V(LED)"],inputs:[]}`. Firmware documents must name their target component. Supported Pico adapters include GPIO, averaged PWM, ADC feedback, hardware SPI nRF24 and I²C MPU6050. ESP32 supports digital GPIO in the current adapter; warnings describe unsupported peripherals. Real binaries are built and run, and partial runs are explicitly identified.

## Device feasibility and flight theory

Create a `device-analysis` document and set its inputs with `device.analysis.set`.
The assembly name or id supplies mass in grams, world CG in mm and CG inertia in
g·mm². Battery fields are volts, amp-hours and ohms; `addedMass` is grams and
`electronicsCurrent` is amperes.

Rotors default to the parts. With an empty `rotors` list, every placed motor (a
component with a `kv` or `maxRpm` prop, or a part named "motor") is a rotor, paired
with the propeller placed on its axis. Rotor data comes from component props, which
default to the part's props, so swapping or editing a part changes the analysis:

| Part | Props |
|---|---|
| Propeller | `diameter` (mm), `ct`, `cp`, `dataSource` |
| Motor | `maxRpm` (loaded, at `referenceVoltage`), `referenceVoltage` (V), `efficiency` (0–1, else 0.8 assumed), `direction` (`cw`/`ccw`), `dataSource` |

A rotor entry needs only `component` (motor ref). `propeller`, `diameter`,
`direction` and `performance` are optional overrides. Direction is viewed from the
positive local rotor axis toward the rotor; airframe reaction torque opposes the
rotor spin. A rotor without a direction is assumed clockwise and flagged.

`performance` is either sourced `{kind:"coefficients",ct,cp,maxRpm,
referenceVoltage,efficiency,source}` or `{kind:"measured",voltage,source,
points:[{throttle,thrust,current,rpm?,torque?}]}`. Measured throttle spans 0…1 with
unique throttle values and nondecreasing thrust/current; force/current/torque use
N/A/N·m. Missing measured torque remains unknown and prevents 6DOF preview. Missing
part data is reported as missing; thrust is never inferred from kV.

`GET /device-analysis/:doc` returns the full JSON: mass (`assemblyMass` +
`addedMass`), completeness, CG/inertia, resolved `rotors`, prop and assembly
conflicts, battery-limited `maximum`, equal-collective `hover`, `rawMaximum`, and
explicit missing data/assumptions. Per-part "mass is an estimate" notes are grouped
into one warning, with the refs in `estimatedMass`. Maximum and hover voltage
validity are checked separately. An unvalidated maximum/TWR is `null` even if
hover is valid. `inputComplete` describes structural/performance input
completeness; contextual voltage validity is reported for each operating point.

MCP `device_analyze({project,doc})` returns a short text summary: status, mass with
its breakdown, thrust/weight, maximum usable thrust (g and N), hover throttle,
current and runtime, per-rotor values, rotor data sources, missing data and
checks. Pass `full: true` for the full JSON.

```jsonc
POST /api/projects/:id/device-analysis/:doc/flight
{
  "duration": 2, "step": 0.005,
  "throttle": 0.6, "rotorThrottle": { "M1": 0.62 },
  "altitude": 1, "attitude": [0, 5, 0],
  "velocity": [0, 0, 0], "angularVelocity": [0, 0, 0],
  "controls": [{ "t": 1, "throttle": 0.5 }]
}
```

MCP `device_flight_preview` accepts these same fields plus `{project,doc}`.
Duration is at most 10 s, step is 0.0005…0.02 s, throttle is 0…1, initial altitude
is meters, attitude is roll/pitch/yaw degrees, velocity is world m/s and angular
velocity is body rad/s. Optional `linearDrag` (N·s/m) and `angularDrag`
(N·m·s/rad) default to zero. A timed control replaces collective and per-rotor
overrides at the next solver step; unmentioned rotors use its collective value.

The result has `status` (`duration`, `ground-contact` or `battery-depleted`),
actual `t`, rotor `layout`, mass/CG/inertia, `warnings`, `assumptions` and bounded
`frames`. Frames contain time, world position/velocity, body-to-world quaternion
`[w,x,y,z]`, body angular velocity, Euler attitude, loaded voltage/current,
usedAh, battery-limit throttleScale, groundClearance and each rotor's applied
throttle/thrust/torque/RPM. Uniform command scaling respects battery current and
minimum voltage; conservative ground contact stops motion. These are manual
rigid-body theoretical trajectories, separate from executed firmware and without
an autopilot or full aerodynamic/sensor model. See [simulation](simulation.md)
for exact supported scope and assumptions.

## Simulate

```jsonc
POST /api/projects/:id/simulate
{ "analysis": "tran", "duration": "200ms", "probes": ["LED", "M1.rpm", "I(BT1)"],
  "inputs": [{ "t": "50ms", "ref": "SW1", "action": "press" }] }
→ { "t": 0.2, "voltages": { "VBAT": 4.19, "LED": 2.94 }, "currents": { "BT1": 0.065, … },
    "views": { "M1": { "rpm": 210, "current": 0.052 }, … },
    "waveforms": { "time": [0.01, …], "series": { "V(LED)": […], "M1.rpm": […], "I(BT1)": […] } },
    "warnings": [], "stats": { "steps": 20000, "ms": 12 } }
```

- `analysis`: `op` (DC operating point) or `tran` (from power-on, with `duration` and optional `step`, default min(10 µs, duration/1000)).
- Times are seconds or strings like `"50ms"`. Values are SI.
- `probes`: net names, `V(NET)`, `I(REF)` or `REF.field` from a part's view. Default: every net and part current.
- `inputs`: buttons take `press`/`release`, switches `A`/`B`/`toggle`.
- `maxPoints` caps waveform length (default 500).
- Ground is the net named `GND`. Parts without a sim model are skipped with a warning.
