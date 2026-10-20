import { Part, type PartInput } from "@m4k3r/core"
import type { KicadFootprint } from "./footprint"
import type { KicadSymbol } from "./symbol"

export interface PartOptions {
  id?: string
  /** Fields that replace the imported ones, e.g. { name, category, props, sim } */
  overrides?: Partial<PartInput>
  /** Shown in the part, e.g. "Device:R" */
  symbolSource?: string
  footprintSource?: string
  /** URL or path of the 3D model */
  model3d?: string
}

/** Pretty JSON for part.json files, with arrays of numbers on one line, e.g. "at": [1.27, -2.54]. */
export const partJson = (value: unknown) =>
  JSON.stringify(value, null, 2).replace(/\[\n[\d\s,.eE+-]+\]/g, (m) => `[${m.slice(1, -1).trim().split(/,\s*/).join(", ")}]`) + "\n"

/** Lowercase id from a symbol name: "RaspberryPi_Pico" → "raspberrypi_pico". */
export const partId = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "") || "part"

/** Build a part from an imported symbol and an optional footprint. Warnings list pins and pads that don't match. */
export function kicadPart(sym: KicadSymbol, fp: KicadFootprint | undefined, opts: PartOptions = {}) {
  const p = sym.properties
  const datasheet = p.Datasheet && p.Datasheet !== "~" ? p.Datasheet : undefined
  const part = Part.parse({
    id: opts.id ?? partId(sym.name),
    name: p.Value || sym.name,
    description: p.Description ?? p.ki_description ?? "",
    refPrefix: (p.Reference ?? "").toUpperCase().replace(/[^A-Z]/g, "") || "U",
    ...(datasheet && { datasheet }),
    pins: sym.pins,
    symbol: { ...(opts.symbolSource && { source: opts.symbolSource }), ...sym.symbol },
    ...(fp && { footprint: { ...(opts.footprintSource && { source: opts.footprintSource }), ...fp.footprint } }),
    ...(opts.model3d && { model3d: opts.model3d }),
    ...opts.overrides,
  })

  const warnings: string[] = []
  if (part.footprint) {
    const pads = new Set(part.footprint.pads.map((pad) => pad.num).filter(Boolean))
    const pins = new Set(part.pins.map((pin) => pin.num))
    const noPad = part.pins.filter((pin) => !pads.has(pin.num) && pin.type !== "nc").map((pin) => `${pin.num} ${pin.name}`)
    const noPin = [...pads].filter((num) => !pins.has(num))
    if (noPad.length) warnings.push(`Pins without a pad: ${noPad.join(", ")}`)
    if (noPin.length) warnings.push(`Pads without a pin: ${noPin.join(", ")}`)
  }
  return { part, warnings }
}
