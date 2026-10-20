import { CommandError, commands, defineCommand, findComponent, findDoc, findNet, PartId, PinRef, resolvePin, type Graphic, type Part, type Project, type SymbolPin } from "@m4k3r/core"
import { z } from "zod"
import { arrange } from "./layout"

export * from "./pcb-schema"
export * from "./pcb-geometry"
export * from "./checks"
export * from "./board-mesh"
export * from "./router"
export * from "./layout"

export const SymbolPlacement = z.object({
  component: z.string(),
  x: z.number().finite(),
  y: z.number().finite(),
  rotation: z.number().int().multipleOf(90).default(0),
  unit: z.number().int().nonnegative().optional().describe("Zero-based imported symbol unit (gate)"),
})
export type SymbolPlacement = z.infer<typeof SymbolPlacement>

/** Connectivity belongs to project.nets. This document stores only the sheet's presentation. */
const SheetPoint = z.tuple([z.number().finite(), z.number().finite()])
export const SchematicData = z.object({
  symbols: z.array(SymbolPlacement).default([]),
  wires: z.array(z.object({ id: z.string(), net: z.string(), from: PinRef, to: PinRef, bends: z.array(SheetPoint).default([]) })).default([]),
  labels: z.array(z.object({ id: z.string(), net: z.string(), at: SheetPoint })).default([]),
  junctions: z.array(z.object({ id: z.string(), net: z.string(), at: SheetPoint })).default([]),
  noConnects: z.array(PinRef).default([]),
}).refine(
  (data) => new Set(data.symbols.map((s) => `${s.component}/${s.unit ?? 0}`)).size === data.symbols.length,
  { message: "A symbol unit can be placed only once per schematic" },
)
export type SchematicData = z.infer<typeof SchematicData>
export const schematicDoc = (p: Project, doc: string) => findDoc(p, doc, "schematic").data as SchematicData
export type XY = [number, number]

/** First unit for v1; parts without imported geometry receive a readable pin box. */
export function symbolGeometry(part: Part, index = 0): { graphics: Graphic[]; pins: SymbolPin[]; bounds: { min: XY; max: XY } } {
  const unit = part.symbol?.units[index]
  const half = Math.ceil(part.pins.length / 2)
  const height = Math.max(8, (half + 1) * 2.54)
  const pins: SymbolPin[] = unit?.pins ?? part.pins.map((pin, i) => ({
    num: pin.num,
    at: [i < half ? -12 : 12, -height / 2 + ((i % half) + 1) * 2.54] as XY,
    rot: i < half ? 0 : 180,
    length: 3,
  }))
  const graphics: Graphic[] = unit?.graphics ?? [{ type: "rect", start: [-9, -height / 2], end: [9, height / 2], width: 0.25, fill: "background" }]
  const points: XY[] = pins.map((pin) => pin.at)
  for (const g of graphics) {
    if (g.type === "poly") points.push(...g.pts)
    else if (g.type === "rect" || g.type === "arc") points.push(g.start, g.end, ...(g.type === "arc" ? [g.mid] : []))
    else if (g.type === "circle") points.push([g.center[0] - g.radius, g.center[1] - g.radius], [g.center[0] + g.radius, g.center[1] + g.radius])
    else points.push(g.at)
  }
  return {
    graphics, pins,
    bounds: {
      min: [Math.min(-3, ...points.map((p) => p[0])), Math.min(-3, ...points.map((p) => p[1]))],
      max: [Math.max(3, ...points.map((p) => p[0])), Math.max(3, ...points.map((p) => p[1]))],
    },
  }
}

/** Rotate a local point counterclockwise in a coordinate system whose y points down. */
export function symbolPoint(symbol: SymbolPlacement, point: XY): XY {
  const angle = -symbol.rotation * Math.PI / 180
  return [symbol.x + point[0] * Math.cos(angle) - point[1] * Math.sin(angle), symbol.y + point[0] * Math.sin(angle) + point[1] * Math.cos(angle)]
}

const Doc = z.string().describe("Schematic doc id or name")
export const schematicCommands = [
  defineCommand({
    type: "schematic.add",
    summary: "Add a library component and place its symbol at a canvas position in one undoable command",
    args: z.object({ doc: Doc, part: PartId, x: z.number().finite(), y: z.number().finite(), rotation: z.number().int().multipleOf(90).default(0), props: z.record(z.string(), z.string()).optional() }),
    run(p, { doc, part, x, y, rotation, props }, ctx) {
      const data = schematicDoc(p, doc)
      const add = commands.get("component.add")!
      const component = add.run(p, add.args.parse({ part, props }), ctx) as { id: string; ref: string }
      if (!p.parts[part]?.pins.length) throw new CommandError("Pinless mechanical parts belong in an assembly, not an electrical schematic")
      data.symbols.push({ component: component.id, x, y, rotation })
      return component
    },
  }),
  defineCommand({
    type: "schematic.place",
    summary: "Place or move a component symbol on a schematic (mm). Connectivity is unchanged.",
    args: z.object({ doc: Doc, component: z.string(), x: z.number().finite(), y: z.number().finite(), rotation: z.number().int().multipleOf(90).optional(), unit: z.number().int().nonnegative().optional() }),
    run(p, { doc, component, x, y, rotation, unit }) {
      const data = schematicDoc(p, doc)
      const c = findComponent(p, component)
      if (!p.parts[c.part]?.pins.length) throw new CommandError("Pinless mechanical parts belong in an assembly")
      if ((unit ?? 0) >= (p.parts[c.part]?.symbol?.units.length ?? 1)) throw new CommandError(`${c.ref} has no symbol unit ${(unit ?? 0) + 1}`)
      const existing = data.symbols.find((s) => s.component === c.id && (s.unit ?? 0) === (unit ?? 0))
      if (existing) Object.assign(existing, { x, y, rotation: rotation ?? existing.rotation })
      else data.symbols.push({ component: c.id, x, y, rotation: rotation ?? 0, ...(unit === undefined ? {} : { unit }) })
    },
  }),
  defineCommand({
    type: "schematic.remove",
    summary: "Remove a symbol from this sheet, keeping the component and its connections",
    args: z.object({ doc: Doc, component: z.string(), unit: z.number().int().nonnegative().optional() }),
    run(p, { doc, component, unit }) {
      const data = schematicDoc(p, doc)
      const c = findComponent(p, component)
      if (!data.symbols.some((s) => s.component === c.id)) throw new CommandError(`${c.ref} is not placed on this sheet`)
      data.symbols = data.symbols.filter((s) => s.component !== c.id || unit !== undefined && (s.unit ?? 0) !== unit)
    },
  }),
  defineCommand({
    type: "schematic.autoplace",
    summary: "Place unplaced components, grouped by shared signal nets. all=true rearranges the whole sheet.",
    args: z.object({ doc: Doc, all: z.boolean().default(false) }),
    run(p, { doc, all }) {
      const data = schematicDoc(p, doc)
      const components = p.components.filter((c) => p.parts[c.part]?.pins.length).sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
      const alive = new Set(components.map((c) => c.id))
      data.symbols = all ? [] : data.symbols.filter((s) => alive.has(s.component))
      const items = components.flatMap((c) => {
        const part = p.parts[c.part]!
        // Motors get room below for the canvas's live rpm readout.
        const below = part.sim?.model === "dc-motor" || /motor/i.test(part.id) ? 24 : 0
        return Array.from({ length: part.symbol?.units.length ?? 1 }, (_, unit) => {
          // The canvas writes the reference over the value in two lines, on the right of a vertical symbol.
          const { bounds, pins } = symbolGeometry(part, unit), title = Math.max(`${c.ref}.A`.length * 1.25, (c.props.value || part.name).length * .95)
          const side = pins.every((pin) => pin.rot % 180 !== 0)
          const sides = Object.fromEntries(pins.map((pin) => [pin.num, -Math.round(Math.cos(pin.rot * Math.PI / 180))]))
          return { component: c.id, unit, bounds, title: side ? bounds.max[0] - bounds.min[0] + 1 + title : title, below, sides }
        })
          .filter((item) => !data.symbols.some((s) => s.component === c.id && (s.unit ?? 0) === item.unit))
      })
      // Additions go below whatever is already on the sheet.
      const below = data.symbols.flatMap((s) => {
        const part = p.parts[p.components.find((c) => c.id === s.component)?.part ?? ""]
        if (!part) return []
        const { min, max } = symbolGeometry(part, s.unit ?? 0).bounds
        return [[s.x + min[0], s.y + max[1]] as XY]
      })
      const origin: XY = below.length ? [Math.min(...below.map((b) => b[0])), Math.max(...below.map((b) => b[1])) + 30] : [30, 30]
      for (const [key, [x, y]] of arrange(items, p.nets, origin)) {
        const [component, unit] = key.split("/")
        data.symbols.push({ component: component!, x, y, rotation: 0, ...(Number(unit) ? { unit: Number(unit) } : {}) })
      }
      return { placed: data.symbols.length }
    },
  }),
  defineCommand({ type: "schematic.wire.add", summary: "Connect two canonical pins and save their editable wire bends atomically", args: z.object({ doc: Doc, pins: z.tuple([z.string(), z.string()]), bends: z.array(SheetPoint).default([]), name: z.string().min(1).optional() }), run(p, { doc, pins, bends, name }, ctx) { const d = schematicDoc(p, doc), from = resolvePin(p, pins[0]), to = resolvePin(p, pins[1]); if (from.component === to.component && from.pin === to.pin) throw new CommandError("Choose two different pins"); const connect = commands.get("net.connect")!; const result = connect.run(p, connect.args.parse({ pins, name }), ctx) as { net: string }; const id = ctx.newId("w"); d.wires ??= []; d.wires.push({ id, net: findNet(p, result.net).id, from, to, bends }); return { id, net: result.net } } }),
  defineCommand({ type: "schematic.wire.update", summary: "Edit the bends of a drawn wire without changing connectivity", args: z.object({ doc: Doc, id: z.string(), bends: z.array(SheetPoint) }), run(p, { doc, id, bends }) { const w = schematicDoc(p, doc).wires?.find((w) => w.id === id); if (!w) throw new CommandError(`No wire ${id}`); w.bends = bends } }),
  defineCommand({ type: "schematic.no-connect", summary: "Mark/unmark pins intentionally unconnected; wired flags are reported by ERC", args: z.object({ doc: Doc, pins: z.array(z.string()).min(1), marked: z.boolean().default(true) }), run(p, { doc, pins, marked }) { const d = schematicDoc(p, doc), refs = pins.map((s) => resolvePin(p, s)); d.noConnects ??= []; d.noConnects = d.noConnects.filter((p) => !refs.some((r) => r.component === p.component && r.pin === p.pin)); if (marked) d.noConnects.push(...refs) } }),
  defineCommand({ type: "schematic.label.set", summary: "Place or move a net-name label linked to shared connectivity", args: z.object({ doc: Doc, net: z.string(), at: SheetPoint, id: z.string().optional() }), run(p, { doc, net, at, id }, ctx) { const d = schematicDoc(p, doc), n = findNet(p, net); d.labels ??= []; const old = id && d.labels.find((l) => l.id === id); if (old) Object.assign(old, { net: n.id, at }); else { id = ctx.newId("label"); d.labels.push({ id, net: n.id, at }) } return { id } } }),
  defineCommand({ type: "schematic.junction.add", summary: "Mark an explicit junction on a shared net (crossing different nets stay separate)", args: z.object({ doc: Doc, net: z.string(), at: SheetPoint }), run(p, { doc, net, at }, ctx) { const d = schematicDoc(p, doc), id = ctx.newId("j"); d.junctions ??= []; d.junctions.push({ id, net: findNet(p, net).id, at }); return { id } } }),
  defineCommand({ type: "schematic.annotation.remove", summary: "Remove a wire path, net label or junction drawing while keeping the canonical electrical net", args: z.object({ doc: Doc, id: z.string() }), run(p, { doc, id }) { const d = schematicDoc(p, doc); if (![...(d.wires ?? []), ...(d.labels ?? []), ...(d.junctions ?? [])].some((v) => v.id === id)) throw new CommandError(`No annotation ${id}`); d.wires = (d.wires ?? []).filter((v) => v.id !== id); d.labels = (d.labels ?? []).filter((v) => v.id !== id); d.junctions = (d.junctions ?? []).filter((v) => v.id !== id) } }),
]
