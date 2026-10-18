// Gives the built-in parts their KiCad symbols and default footprints: pnpm --filter @m4k3r/parts builtins
// Pin names stay as they are; pin numbers follow the KiCad symbol (matched by name unless mapped below).
import { readFileSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { Part } from "@m4k3r/core"
import { KicadLibrary, partJson } from "../src/index"
import { fileCache } from "../src/node"

const BUILTINS: Record<string, { symbol: string; footprint: string; pins?: Record<string, string> }> = {
  battery: { symbol: "Device:Battery_Cell", footprint: "Connector_JST:JST_PH_B2B-PH-K_1x02_P2.00mm_Vertical" },
  capacitor: { symbol: "Device:C", footprint: "Capacitor_SMD:C_0603_1608Metric" },
  "dc-motor": { symbol: "Motor:Motor_DC", footprint: "Connector_Wire:SolderWire-0.5sqmm_1x02_P4.8mm_D0.9mm_OD2.3mm" },
  diode: { symbol: "Device:D", footprint: "Diode_SMD:D_SOD-123" },
  "header-1x2": { symbol: "Connector_Generic:Conn_01x02", footprint: "Connector_PinHeader_2.54mm:PinHeader_1x02_P2.54mm_Vertical" },
  "header-1x4": { symbol: "Connector_Generic:Conn_01x04", footprint: "Connector_PinHeader_2.54mm:PinHeader_1x04_P2.54mm_Vertical" },
  inductor: { symbol: "Device:L", footprint: "Inductor_SMD:L_0805_2012Metric" },
  led: { symbol: "Device:LED", footprint: "LED_SMD:LED_0603_1608Metric" },
  nmos: { symbol: "Transistor_FET:Q_NMOS_GSD", footprint: "Package_TO_SOT_SMD:SOT-23" },
  "push-button": { symbol: "Switch:SW_Push", footprint: "Button_Switch_THT:SW_PUSH_6mm" },
  resistor: { symbol: "Device:R", footprint: "Resistor_SMD:R_0603_1608Metric" },
  // KiCad's SW_SPDT names its throws A and C around a common pin 2 named B.
  "switch-spdt": {
    symbol: "Switch:SW_SPDT",
    footprint: "Button_Switch_THT:SW_Slide_SPDT_Straight_CK_OS102011MS2Q",
    pins: { A: "1", COM: "2", B: "3" },
  },
}

const dir = resolve(import.meta.dirname, "../../../library/parts")
const home = process.env.M4K3R_HOME ?? join(homedir(), "M4K3R")
const kicad = new KicadLibrary(fileCache(join(home, ".cache/kicad")))

for (const [id, spec] of Object.entries(BUILTINS)) {
  const file = join(dir, id, "part.json")
  const old = Part.parse(JSON.parse(readFileSync(file, "utf8")))
  const { part: imported, warnings } = await kicad.importPart({ symbol: spec.symbol, footprint: spec.footprint })
  const pins = old.pins
    .map((pin) => ({ ...pin, num: spec.pins?.[pin.name] ?? imported.pins.find((p) => p.name === pin.name)?.num ?? pin.num }))
    .sort((a, b) => a.num.localeCompare(b.num, undefined, { numeric: true }))
  const { symbol, footprint, model3d } = imported
  const part = Part.parse({ ...old, pins, symbol, footprint, model3d })
  writeFileSync(file, partJson(part))
  const changed = old.pins.filter((p) => pins.find((q) => q.name === p.name)!.num !== p.num)
  console.log(id.padEnd(12), spec.symbol, spec.footprint, changed.length ? `renumbered ${changed.map((p) => p.name)}` : "")
  for (const w of warnings) console.log("  ", w)
}
