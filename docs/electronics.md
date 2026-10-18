# Electronics

Parts, schematic and PCB: one netlist, three views.

## Parts

A part is a small folder:

```
parts/drv8833/
  part.json            metadata, pins, parameters, model bindings
  symbol.kicad_sym
  footprint.kicad_mod
  model.step
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
  "sim":   { "model": "h-bridge-drv8833", "params": { "rdsOn": 0.36 } },
  "spice": { "lib": "spice.lib", "subckt": "DRV8833" }
}
```

- **Pin types:** `power_in`, `power_out`, `input`, `output`, `bidir`, `passive`, `open_drain`, `nc`
- **MCU pins** also list their functions (`GPIO`, `PWM5A`, `SPI0_TX`, `I2C0_SDA`, `ADC0`), which ERC and the firmware tools use
- **Sources:** symbols, footprints and 3D models are imported from the KiCad libraries. We only write `part.json` and the sim bindings.
- **Generic passives** (R, C, L, LED, diode) are one part each with a value and a package

## Schematic

- Sheets, symbols, wires, junctions, net labels, power ports, no-connect flags
- **Hierarchical sheets**, which also act as simulation blocks (see [simulation.md](simulation.md))
- Auto-numbered refdes, and properties edited inline
- Net names flow everywhere: PCB, SPICE netlist, and the firmware pin header

### ERC

Runs live and shows results in a small bottom panel.

| Rule | Example |
|---|---|
| Unconnected input or power pin | nSLEEP floating |
| Output-to-output conflict | Two push-pull outputs on one net |
| Voltage domain mismatch | 5 V signal into a 3.3 V-only pin |
| Missing pull-up | I²C bus without pull-ups |
| Missing decoupling | IC power pin with no cap on its net |
| Pin function | `PWM` net on a pin without PWM, or two SPI buses fighting over one pin |
| Rail budget | Total load on a regulator exceeds its rating |

## PCB

- 2-layer for v1 (4-layer later)
- Board outline drawn directly or linked to a CAD sketch
- Footprints are placed from the schematic, and a ratsnest shows unrouted connections
- Interactive routing with walkaround (push-and-shove later), vias, and width presets per net class
- Copper zones (pours) with thermal reliefs
- Live 3D board view

### Net classes and DRC

| Class | Default width | Use |
|---|---|---|
| Default | 0.25 mm | Signals |
| Power | 0.5 mm | Logic rails |
| Motor | 1.0 mm | Motor and battery current |
| HV | 0.3 mm, 0.5 mm clearance | High-voltage nets (e.g. 30 V bias) |

DRC defaults come from JLCPCB's standard capabilities (0.127 mm trace/space, 0.3 mm drill).
It checks clearance, width, annular ring, drill sizes, board-edge clearance, unrouted nets, and courtyard overlap.
A trace-width helper (IPC-2221) suggests a width from net current.

## Fab outputs

One click produces a zip with:
- Gerber X2 + Excellon drill
- BOM (CSV)
- Pick-and-place (CSV)
- Board STEP

Formats match what JLCPCB and PCBWay expect.

## Interop

| | v1 | Later |
|---|---|---|
| KiCad symbols, footprints, 3D | Import | — |
| KiCad project | — | Import and export |
| SPICE netlist | Export | — |

## Done when

A multi-board design can be captured, pass ERC/DRC, and export fab files that a fab house accepts.
