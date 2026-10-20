# Electronics

Parts, schematic and PCB: one netlist, three views.

## Parts

A part is a small folder:

```
parts/drv8833/
  part.json            metadata, pins, symbol, footprint, model bindings
  spice.lib            optional
```

```jsonc
// part.json (abridged)
{
  "name": "DRV8833", "mpn": "DRV8833PWPR", "datasheet": "https://…",
  "pins": [
    { "num": "1",  "name": "nSLEEP", "type": "input" },
    { "num": "12", "name": "VM",     "type": "power_in", "v": [2.7, 10.8] }
  ],
  "symbol":    { "source": "KiCad Driver_Motor:DRV8833PWP", "units": [{ "graphics": […], "pins": […] }] },
  "footprint": { "source": "KiCad Package_SO:HTSSOP-16-…", "pads": […], "graphics": […], "courtyard": {…} },
  "model3d":   "https://…/HTSSOP-16-….step",
  "sim":   { "model": "h-bridge-drv8833", "params": { "rdsOn": 0.36 } },
  "spice": { "lib": "spice.lib", "subckt": "DRV8833" }
}
```

- **Pin types:** `power_in`, `power_out`, `input`, `output`, `bidir`, `passive`, `open_drain`, `nc`
- **MCU pins** also list their functions (`GPIO`, `PWM5A`, `SPI0_TX`, `I2C0_SDA`, `ADC0`), which ERC and the firmware tools use
- **Sources:** symbols, footprints and 3D models are imported from the official KiCad libraries by name (`Driver_Motor:DRV8833PWP`) or from `.kicad_sym` / `.kicad_mod` files. Downloads are cached in `M4K3R_HOME/.cache/kicad`.
- **Generic passives** (R, C, L, LED, diode) are one part each with a value and a package
- Built-in parts are regenerated from KiCad with `pnpm --filter @m4k3r/parts builtins`. Pin numbers follow KiCad: LEDs and diodes are 1 = K, 2 = A.

### Geometry

Symbol and footprint geometry lives in `part.json`, so vendoring a part into a project copies everything it needs.
Lengths are in mm with y pointing down; angles are degrees counter-clockwise.

| | Contains |
|---|---|
| `symbol` | `units[]`, each with `graphics` and `pins` (`num`, `at` = connection point, `rot` = direction toward the body, `length`, `hidden`). Pin names and types come from `pins`. Also `pinNameOffset`, `hidePinNames`, `hidePinNumbers`. |
| `footprint` | `pads[]` (`num`, `type`, `shape`, `at`, `rot`, `size`, `drill`, `layers`), `graphics` on silkscreen, fab and courtyard layers, and `courtyard` bounds |
| `graphics` | `poly`, `rect`, `circle`, `arc` (start, mid, end), and `text`, where `${REFERENCE}` and `${VALUE}` are filled in per component |

## Schematic

The Wiring tab is a visual circuit canvas; Details retains the component/net list. Drag parts from the tray, move bodies, and drag pin-to-pin to attach wires. Release on empty space or Escape cancels. Click pins for the named Connect/Disconnect bar. Placements and drawing edits use shared undo/history. Pinless mechanical parts belong in assemblies and are filtered out of electrical placement.

**Arrange** groups parts by the nets they share and draws power rails and many-pin nets as power symbols or net labels, so circuits wired by agents stay readable. When the catalog lacks a part, **Search KiCad libraries** in the parts tray searches every official library by name (e.g. `ESP32-S3`) and imports the picked symbol with its default footprint.

Direct wire dragging changes the canonical electrical net and records editable bends atomically. Select a path (or choose it under Editable wire paths) to drag bend handles; double-click a segment to add a bend. Body movement updates endpoints while preserving explicit bends. Removing a drawn path keeps the electrical net; disconnect pins explicitly to change connectivity.

Select pins to mark/clear intentional no-connects. Wired no-connect flags cause ERC errors instead of silently disconnecting pins. Select a net to place a draggable name label or explicit junction marker. Labels follow the canonical net name. Crossings of different nets do not merge them; junction dots annotate the selected net.

Imported multi-unit components place each gate independently with one shared physical component/pin list. Place unplaced adds remaining gates. References/properties remain shared. Hierarchical sheet ports and simulation-block hierarchy remain later extensions; current sheets share the project netlist.

Run/Pause/Reset operates live analog simulation directly on the canvas: rotating motor fan/RPM, LED glow, held buttons/switches and solved net readings. Missing ground is explicit: select a return net and Set ground. Moving symbols preserves live state; electrical edits reset it. Firmware + circuit runs compiled code as an explicit batch snapshot with serial output; it is distinct from live analog stepping.

### Electrical rules

Live ERC appears in the inspector and at `GET /api/projects/:id/erc` / MCP `schematic_check`. It checks unconnected input/power pins, no-connect conflicts, driven-output conflicts, incompatible declared voltage ranges, missing open-drain pull-ups, missing IC decoupling and named PWM/SPI/I2C pin functions. Warnings require engineering judgment. Rail-current budgets require ratings/load metadata and are not inferred from part appearance.

For static DC checks, an explicitly configured battery referenced to a net named GND/0 establishes its **nominal** voltage; a regulator establishes its setpoint only with a known input, explicit ground and configured dropout headroom. ERC compares those values against declared `pin.voltage` ranges, reports conflicting sources, and warns when a rated net's voltage remains unknown. It does not infer rails from names such as 3V3, arbitrary resistors, switches or MCU outputs. Battery voltage varies with charge/load, so this nominal check does not certify worst-case voltage or replace simulation and measurement. Catalog ratings use the [Pico VSYS specification](https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf) and [ESP32-C3 recommended supply conditions](https://documentation.espressif.com/ESP32-C3_Datasheet_en.pdf); project-vendored parts retain their existing metadata until explicitly updated.

The built-in Pico's VSYS pin 39 is rated 1.8–5.5 V. The ESP32-C3-DevKitM-1's 3V3 header pins 2 and 3 use the 3.0–3.6 V recommended supply range; the [DevKit guide](https://documentation.espressif.com/esp-dev-kits/en/latest/esp32c3/esp32-c3-devkitm-1/index.html) documents powering through these headers. These are supply ratings, not complete GPIO absolute-maximum or power-sequencing checks.

## PCB and fabrication

The implemented two-layer placement/routing/via/outline/zone editor, geometric DRC, real fabrication ZIP and assembly geometry are documented in [PCB](pcb.md). Create New PCB from the New document menu. Off-board motors, batteries and modules can remain in the shared project/assembly while being explicitly excluded from a carrier PCB.

## Interoperability

KiCad symbol/footprint import preserves vendored geometry. SPICE export uses shared nets. Fabrication exports actual Gerber X2, Excellon PTH/NPTH, BOM, SMT pick-and-place and exact board STEP. Native KiCad project import/export and four-layer boards remain later extensions. Review CAM files and confirm fabricator conventions before ordering.
