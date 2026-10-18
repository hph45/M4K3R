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

Domains add their own commands (`cad.*`, `schematic.*`, …). `GET /api/commands` always lists the current set.

`component` and `net` args accept either an id or a name/ref.

## Endpoints

| Method | Path | |
|---|---|---|
| GET | `/api/commands` | Every command with its JSON Schema |
| GET / POST | `/api/projects` | List or create (`{ name }`) |
| GET / DELETE | `/api/projects/:id` | |
| POST | `/api/projects/:id/commands` | Apply a batch |
| POST | `/api/projects/:id/undo`, `/redo` | |
| GET | `/api/projects/:id/netlist` | Readable wiring, plus unconnected pins |
| POST | `/api/projects/:id/simulate` | Run the circuit. See below. |
| GET | `/api/parts?q=` | Search the built-in and user libraries |
| GET | `/api/parts/:id` | |
| PUT | `/api/parts/:id` | Create or replace a part in the user library |
| WS | `/ws` | Send `{ subscribe: id }`. Receive `{ project, version, patches }`. |
| GET | `/api/projects/:id/firmware/:doc/pins.h` | The generated pin header |
| POST | `/api/projects/:id/firmware/:doc/build` | `{ ok, hash, diagnostics, size, artifacts }`. See [firmware.md](firmware.md). |
| GET | `/api/projects/:id/firmware/:doc/build/:hash/firmware.uf2` | Also `firmware.elf` |
| POST | `/api/projects/:id/firmware/:doc/run` | `{ ms }` → `{ ok, serial, gpio, simulatedMs, wallMs }`, or `{ ok: false, diagnostics }` |

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
- `list_commands`
- `simulate`: the same as the endpoint, returned as compact text (final values plus ~20 points per waveform)
- `firmware_build`: compile a firmware doc, returns size or diagnostics
- `firmware_run`: build and run it on a simulated RP2040, returns serial output and GPIO states

New capabilities (schematic layout, PCB, CAD, simulation) show up as new commands plus read tools, such as `run_scenario` or `get_erc`. The API's shape stays the same.

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
