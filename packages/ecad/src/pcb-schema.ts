import { CommandError, defineCommand, findComponent, findDoc, findNet, type Project } from "@m4k3r/core"
import { z } from "zod"

export const Point2 = z.tuple([z.number().finite(), z.number().finite()])
export type Point2 = z.infer<typeof Point2>
export const CopperLayer = z.enum(["F.Cu", "B.Cu"])
export type CopperLayer = z.infer<typeof CopperLayer>
export const BoardPlacement = z.object({ component: z.string(), at: Point2, rotation: z.number().finite().default(0), side: z.enum(["top", "bottom"]).default("top") })
export type BoardPlacement = z.infer<typeof BoardPlacement>
export const Track = z.object({ id: z.string(), net: z.string(), layer: CopperLayer, width: z.number().positive(), points: z.array(Point2).min(2) })
export type Track = z.infer<typeof Track>
export const Via = z.object({ id: z.string(), net: z.string(), at: Point2, diameter: z.number().positive().default(0.7), drill: z.number().positive().default(0.3) })
export const BoardHole = z.object({ id: z.string(), at: Point2, diameter: z.number().positive() })
export const Zone = z.object({ id: z.string(), net: z.string(), layer: CopperLayer, outline: z.array(Point2).min(3), clearance: z.number().nonnegative().default(0.25), thermal: z.boolean().default(true), spokeWidth: z.number().positive().default(0.3) })
export type Zone = z.infer<typeof Zone>
export const NetClass = z.object({ name: z.string().min(1), width: z.number().positive(), clearance: z.number().nonnegative() })
export const PcbData = z.object({
  outline: z.array(Point2).min(3).default([[0, 0], [80, 0], [80, 60], [0, 60]]),
  thickness: z.number().positive().default(1.6),
  excluded: z.array(z.string()).default([]).describe("Explicit off-board component IDs; remain in the project/assembly BOM"),
  placements: z.array(BoardPlacement).default([]), tracks: z.array(Track).default([]), vias: z.array(Via).default([]), holes: z.array(BoardHole).default([]), zones: z.array(Zone).default([]),
  rules: z.object({ clearance: z.number().nonnegative().default(0.2), minWidth: z.number().positive().default(0.127), minDrill: z.number().positive().default(0.3), annularRing: z.number().nonnegative().default(0.15), edgeClearance: z.number().nonnegative().default(0.25) }).default({ clearance: 0.2, minWidth: 0.127, minDrill: 0.3, annularRing: 0.15, edgeClearance: 0.25 }),
  netClasses: z.array(NetClass).default([{ name: "Default", width: 0.25, clearance: 0.2 }, { name: "Power", width: 0.5, clearance: 0.2 }, { name: "Motor", width: 1, clearance: 0.2 }, { name: "HV", width: 0.3, clearance: 0.5 }]),
  assignments: z.record(z.string(), z.string()).default({}),
}).refine((d) => new Set(d.placements.map((p) => p.component)).size === d.placements.length, "Each component can be placed once on a board").refine((d) => d.vias.every((v) => v.drill < v.diameter), "Via drill must be smaller than its copper diameter")
export type PcbData = z.infer<typeof PcbData>
export const pcbDoc = (p: Project, doc: string) => findDoc(p, doc, "pcb").data as PcbData

export function polygonArea(points: Point2[]) { return points.reduce((sum, p, i) => { const q = points[(i + 1) % points.length]!; return sum + p[0] * q[1] - q[0] * p[1] }, 0) / 2 }
const cross = (a: Point2, b: Point2, c: Point2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
export function segmentsCross(a: Point2, b: Point2, c: Point2, d: Point2) { return cross(a, b, c) * cross(a, b, d) < -1e-12 && cross(c, d, a) * cross(c, d, b) < -1e-12 }
export function validateOutline(points: Point2[]) {
  if (Math.abs(polygonArea(points)) < 1e-6) throw new CommandError("Outline has zero area")
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!, b = points[(i + 1) % points.length]!
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) throw new CommandError("Outline contains a zero-length edge")
    for (let j = i + 2; j < points.length; j++) if ((j + 1) % points.length !== i && segmentsCross(a, b, points[j]!, points[(j + 1) % points.length]!)) throw new CommandError("Outline crosses itself")
  }
}

const Doc = z.string().describe("PCB document id or name")
const Net = z.string().describe("Shared net id or name")
export const pcbCommands = [
  defineCommand({ type: "pcb.sync", summary: "Place missing electrical footprints and remove deleted components from the board", args: z.object({ doc: Doc }), run(p, { doc }) {
    const d = pcbDoc(p, doc)
    const eligible = p.components.filter((c) => p.parts[c.part]?.pins.length && p.parts[c.part]?.footprint && !(d.excluded ?? []).includes(c.id))
    d.placements = d.placements.filter((v) => eligible.some((c) => c.id === v.component))
    const min = [Math.min(...d.outline.map((p) => p[0])), Math.min(...d.outline.map((p) => p[1]))]
    for (const c of eligible) if (!d.placements.some((v) => v.component === c.id)) {
      let index = 0, at: Point2
      do { at = [min[0]! + 8 + (index % 5) * 13, min[1]! + 8 + Math.floor(index / 5) * 13]; index++ } while (d.placements.some((v) => Math.hypot(v.at[0] - at[0], v.at[1] - at[1]) < 8))
      d.placements.push({ component: c.id, at, rotation: 0, side: "top" })
    }
    return { placed: d.placements.length }
  } }),
  defineCommand({ type: "pcb.exclude", summary: "Mark components off-board (kept in shared circuit/assembly BOM); false includes them again", args: z.object({ doc: Doc, components: z.array(z.string()).min(1), excluded: z.boolean().default(true) }), run(p, { doc, components, excluded }) { const d = pcbDoc(p, doc), ids = components.map((key) => findComponent(p, key).id); d.excluded ??= []; d.excluded = excluded ? [...new Set([...d.excluded, ...ids])] : d.excluded.filter((id) => !ids.includes(id)); if (excluded) d.placements = d.placements.filter((v) => !ids.includes(v.component)); return { excluded: d.excluded } } }),
  defineCommand({ type: "pcb.place", summary: "Place, move, rotate or flip a footprint; tracks remain explicit copper paths", args: z.object({ doc: Doc, component: z.string(), at: Point2, rotation: z.number().finite().optional(), side: z.enum(["top", "bottom"]).optional() }), run(p, { doc, component, at, rotation, side }) {
    const c = findComponent(p, component), d = pcbDoc(p, doc)
    if (!p.parts[c.part]?.footprint) throw new CommandError(`${c.ref} has no footprint; import or vendor one first`)
    d.excluded = (d.excluded ?? []).filter((id) => id !== c.id)
    const old = d.placements.find((v) => v.component === c.id)
    if (old) Object.assign(old, { at, rotation: rotation ?? old.rotation, side: side ?? old.side })
    else d.placements.push({ component: c.id, at, rotation: rotation ?? 0, side: side ?? "top" })
  } }),
  defineCommand({ type: "pcb.outline.set", summary: "Set the closed board perimeter polygon and/or material thickness in mm", args: z.object({ doc: Doc, outline: z.array(Point2).min(3).optional(), thickness: z.number().positive().optional() }), run(p, { doc, outline, thickness }) { const d = pcbDoc(p, doc); if (outline) { validateOutline(outline); d.outline = outline } if (thickness !== undefined) d.thickness = thickness } }),
  defineCommand({ type: "pcb.track.add", summary: "Add a copper polyline on one layer and a shared net", args: Track.omit({ id: true }).extend({ doc: Doc, net: Net }), run(p, { doc, net, ...track }, ctx) { const d = pcbDoc(p, doc); const id = ctx.newId("tr"); d.tracks.push({ ...track, net: findNet(p, net).id, id }); return { id } } }),
  defineCommand({ type: "pcb.track.update", summary: "Change a track's points, width, layer or assigned net", args: z.object({ doc: Doc, id: z.string(), points: z.array(Point2).min(2).optional(), width: z.number().positive().optional(), layer: CopperLayer.optional(), net: Net.optional() }), run(p, { doc, id, net, ...changes }) { const v = pcbDoc(p, doc).tracks.find((v) => v.id === id); if (!v) throw new CommandError(`No track ${id}`); Object.assign(v, changes, net ? { net: findNet(p, net).id } : {}) } }),
  defineCommand({ type: "pcb.via.add", summary: "Add a plated through via connecting both copper layers", args: Via.omit({ id: true }).extend({ doc: Doc, net: Net }), run(p, { doc, net, ...via }, ctx) { if (via.drill >= via.diameter) throw new CommandError("Via drill must be smaller than diameter"); const id = ctx.newId("v"); pcbDoc(p, doc).vias.push({ ...via, net: findNet(p, net).id, id }); return { id } } }),
  defineCommand({ type: "pcb.hole.add", summary: "Add a non-plated circular mounting hole", args: BoardHole.omit({ id: true }).extend({ doc: Doc }), run(p, { doc, ...hole }, ctx) { const id = ctx.newId("h"); pcbDoc(p, doc).holes.push({ ...hole, id }); return { id } } }),
  defineCommand({ type: "pcb.zone.add", summary: "Pour a copper zone with clearance and optional four-spoke thermal reliefs", args: Zone.omit({ id: true }).extend({ doc: Doc, net: Net }), run(p, { doc, net, ...zone }, ctx) { validateOutline(zone.outline); const id = ctx.newId("z"); pcbDoc(p, doc).zones.push({ ...zone, net: findNet(p, net).id, id }); return { id } } }),
  defineCommand({ type: "pcb.remove", summary: "Remove a track, via, mounting hole, zone or footprint placement", args: z.object({ doc: Doc, id: z.string() }), run(p, { doc, id }) { const d = pcbDoc(p, doc); if (![...d.tracks, ...d.vias, ...d.holes, ...d.zones].some((v) => v.id === id) && !d.placements.some((v) => v.component === id)) throw new CommandError(`No board item ${id}`); d.tracks = d.tracks.filter((v) => v.id !== id); d.vias = d.vias.filter((v) => v.id !== id); d.holes = d.holes.filter((v) => v.id !== id); d.zones = d.zones.filter((v) => v.id !== id); d.placements = d.placements.filter((v) => v.component !== id) } }),
  defineCommand({ type: "pcb.rules.set", summary: "Change board manufacturing limits (all distances in mm)", args: z.object({ doc: Doc, rules: z.object({ clearance: z.number().nonnegative().optional(), minWidth: z.number().positive().optional(), minDrill: z.number().positive().optional(), annularRing: z.number().nonnegative().optional(), edgeClearance: z.number().nonnegative().optional() }) }), run(p, { doc, rules }) { Object.assign(pcbDoc(p, doc).rules, rules) } }),
  defineCommand({ type: "pcb.netclass.set", summary: "Create/update a named routing preset and optionally assign shared nets", args: NetClass.extend({ doc: Doc, nets: z.array(Net).default([]) }), run(p, { doc, nets, ...value }) { const d = pcbDoc(p, doc), old = d.netClasses.find((c) => c.name === value.name); if (old) Object.assign(old, value); else d.netClasses.push(value); for (const n of nets) d.assignments[findNet(p, n).id] = value.name } }),
]
