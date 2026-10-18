import type { Graphic, PartSymbol, Pin, PinType, SymbolPin } from "@m4k3r/core"
import { bezierPoints, type XY } from "./geometry"
import { child, children, hidden, isList, num, nums, parseSExpr, value, type SList } from "./sexpr"

export interface KicadSymbol {
  name: string
  /** Every property, e.g. Reference, Value, Footprint, Datasheet, Description */
  properties: Record<string, string>
  pins: Pin[]
  symbol: PartSymbol
}

const PIN_TYPES: Record<string, PinType> = {
  input: "input",
  output: "output",
  bidirectional: "bidir",
  tri_state: "bidir",
  passive: "passive",
  free: "passive",
  unspecified: "passive",
  power_in: "power_in",
  power_out: "power_out",
  open_collector: "open_drain",
  open_emitter: "open_drain",
  no_connect: "nc",
  unconnected: "nc",
}

const ESCAPED: Record<string, string> = { slash: "/", backslash: "\\", lt: "<", gt: ">", colon: ":", dblquote: '"' }

/** KiCad pin text → plain name: "~{SLEEP}" → "nSLEEP", "A{slash}B" → "A/B", "~" → "". */
export function cleanName(name: string): string {
  if (name === "~") return ""
  return name
    .replace(/~\{([^}]*)\}/g, (_, x: string) => (/^n[A-Z0-9]|n$|_N$|#$/.test(x) ? x : `n${x}`))
    .replace(/\{(\w+)\}/g, (m, x: string) => ESCAPED[x] ?? m)
}

/** The symbols defined in a .kicad_sym file, by name. */
export function symbolDefs(text: string): Map<string, SList> {
  const root = parseSExpr(text)
  if (!isList(root) || root[0] !== "kicad_symbol_lib") throw new Error("Not a KiCad symbol library (.kicad_sym)")
  return new Map(children(root, "symbol").map((s) => [String(s[1]), s]))
}

/**
 * Import one symbol from the contents of one or more .kicad_sym files (a derived symbol's parent may be in another).
 * `name` may be omitted when the first file defines a single symbol.
 */
export function importSymbol(files: string | string[], name?: string): KicadSymbol {
  const libs = [files].flat().map(symbolDefs)
  const defs = new Map(libs.toReversed().flatMap((lib) => [...lib]))
  if (!name) {
    const names = [...(libs[0]?.keys() ?? [])]
    if (names.length !== 1) throw new Error(`File has ${names.length} symbols; pass a name: ${names.slice(0, 30).join(", ")}`)
    name = names[0]!
  }

  // Resolve inheritance: graphics and pins come from the root parent, properties are overridden by each child.
  let body = defs.get(name)
  if (!body) throw new Error(`No symbol "${name}"`)
  const chain = [body]
  for (let parent = value(body, "extends"); parent; parent = value(body, "extends")) {
    body = defs.get(parent)
    if (!body) throw new Error(`Symbol "${name}" extends "${parent}", which wasn't found`)
    if (chain.includes(body)) throw new Error(`Symbol "${name}" has circular inheritance`)
    chain.push(body)
  }
  const props = new Map(chain.toReversed().flatMap((def) => children(def, "property").map((p): [string, SList] => [String(p[1]), p])))
  const properties = Object.fromEntries([...props].map(([key, p]) => [key, String(p[2] ?? "")]))
  const texts = ["Reference", "Value"].flatMap((key) => {
    const p = props.get(key)
    return p && !hidden(p) ? [text(`\${${key.toUpperCase()}}`, p)] : []
  })

  // Sub-symbols are named <name>_<unit>_<style>. Unit 0 is shared by all units; style 2 is the De Morgan form.
  const subs = children(body, "symbol").flatMap((s) => {
    const m = /_(\d+)_(\d+)$/.exec(String(s[1]))
    return m && Number(m[2]) <= 1 ? [{ unit: Number(m[1]), node: s }] : []
  })
  const unitNums = [...new Set(subs.map((s) => s.unit).filter((u) => u > 0))].sort((a, b) => a - b)
  const pins: Pin[] = []
  const units = (unitNums.length ? unitNums : [1]).map((u) => {
    const nodes = subs.filter((s) => s.unit === 0 || s.unit === u).map((s) => s.node)
    const unitPins: SymbolPin[] = []
    for (const p of nodes.flatMap((n) => children(n, "pin"))) {
      const pinNum = value(p, "number") ?? ""
      const [x = 0, y = 0, rot = 0] = nums(child(p, "at"))
      unitPins.push({ num: pinNum, at: [x, -y || 0], rot, length: num(value(p, "length")), ...(hidden(p) && { hidden: true }) })
      if (pins.some((q) => q.num === pinNum)) continue
      const functions = children(p, "alternate").map((a) => cleanName(String(a[1])))
      pins.push({
        num: pinNum,
        name: cleanName(value(p, "name") ?? "") || pinNum,
        type: PIN_TYPES[String(p[1])] ?? "passive",
        ...(functions.length ? { functions } : {}),
      })
    }
    const unitName = nodes.map((n) => value(n, "unit_name")).find((n) => n)
    return {
      ...(unitName && { name: unitName }),
      graphics: [...nodes.flatMap((n) => n.filter(isList).flatMap(graphic)), ...texts],
      pins: unitPins,
    }
  })

  const pinNames = child(body, "pin_names")
  return {
    name,
    properties,
    pins,
    symbol: {
      units,
      pinNameOffset: pinNames ? num(value(pinNames, "offset")) : 0.508,
      ...(hidden(pinNames) && { hidePinNames: true }),
      ...(hidden(child(body, "pin_numbers")) && { hidePinNumbers: true }),
    },
  }
}

const xy = (l: SList | undefined): XY => {
  const [x = 0, y = 0] = nums(l)
  return [x, -y || 0]
}

function stroke(g: SList) {
  const fill = value(child(g, "fill") ?? [], "type")
  return {
    width: num(value(child(g, "stroke") ?? [], "width")),
    ...(fill === "outline" && { fill: "outline" as const }),
    ...((fill === "background" || fill === "color") && { fill: "background" as const }),
  }
}

function text(str: string, g: SList): Graphic {
  const [x = 0, y = 0, r = 0] = nums(child(g, "at"))
  const size = nums(child(child(child(g, "effects") ?? [], "font") ?? [], "size"))[0] ?? 1.27
  // Text angles in symbol libraries are stored in tenths of a degree by some KiCad versions.
  const rot = Math.abs(r) > 360 ? r / 10 : r
  return { type: "text", text: str, at: [x, -y || 0], size, ...(rot ? { rot } : {}) }
}

function graphic(g: SList): Graphic[] {
  switch (g[0]) {
    case "rectangle":
      return [{ type: "rect", start: xy(child(g, "start")), end: xy(child(g, "end")), ...stroke(g) }]
    case "circle":
      return [{ type: "circle", center: xy(child(g, "center")), radius: num(value(g, "radius")), ...stroke(g) }]
    case "arc":
      return [{ type: "arc", start: xy(child(g, "start")), mid: xy(child(g, "mid")), end: xy(child(g, "end")), ...stroke(g) }]
    case "polyline":
    case "bezier": {
      const pts = children(child(g, "pts") ?? [], "xy").map(xy)
      return [{ type: "poly", pts: g[0] === "bezier" ? bezierPoints(pts) : pts, ...stroke(g) }]
    }
    case "text":
      return hidden(g) ? [] : [text(cleanName(String(g[1])), g)]
    default:
      return []
  }
}
