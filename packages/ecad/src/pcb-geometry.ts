import type { Pad, Project } from "@m4k3r/core"
import polygonClipping from "polygon-clipping"
import { pcbDoc, type BoardPlacement, type CopperLayer, type PcbData, type Point2 } from "./pcb-schema"

export type MultiPolygon = polygonClipping.MultiPolygon
export type Polygon = polygonClipping.Polygon
export const ring = (p: Point2[]) => [...p, ...(p.length && (p[0]![0] !== p.at(-1)![0] || p[0]![1] !== p.at(-1)![1]) ? [p[0]!] : [])]
export const shape = (p: Point2[]): MultiPolygon => [[ring(p)]]
export const union = (...p: MultiPolygon[]): MultiPolygon => { const valid = p.filter((v) => v.length); return valid.length ? polygonClipping.union(valid[0]!, ...valid.slice(1)) : [] }
export const subtract = (a: MultiPolygon, ...b: MultiPolygon[]): MultiPolygon => a.length ? b.some((v) => v.length) ? polygonClipping.difference(a, ...b.filter((v) => v.length)) : a : []
export const intersect = (a: MultiPolygon, b: MultiPolygon): MultiPolygon => a.length && b.length ? polygonClipping.intersection(a, b) : []
export const circle = (at: Point2, radius: number, segments = 40): MultiPolygon => shape(Array.from({ length: segments }, (_, i): Point2 => [at[0] + radius * Math.cos(i * Math.PI * 2 / segments), at[1] + radius * Math.sin(i * Math.PI * 2 / segments)]))
export function rotatePoint(point: Point2, angle: number): Point2 { const a = -angle * Math.PI / 180; return [point[0] * Math.cos(a) - point[1] * Math.sin(a), point[0] * Math.sin(a) + point[1] * Math.cos(a)] }
export function footprintPoint(place: BoardPlacement, point: Point2): Point2 { const r = rotatePoint([place.side === "bottom" ? -point[0] : point[0], point[1]], place.rotation); return [place.at[0] + r[0], place.at[1] + r[1]] }
export function capsule(a: Point2, b: Point2, width: number): MultiPolygon { const length = Math.hypot(b[0] - a[0], b[1] - a[1]); if (length < 1e-9) return circle(a, width / 2); const dx = (b[1] - a[1]) / length * width / 2, dy = -(b[0] - a[0]) / length * width / 2; return union(shape([[a[0] + dx, a[1] + dy], [b[0] + dx, b[1] + dy], [b[0] - dx, b[1] - dy], [a[0] - dx, a[1] - dy]]), circle(a, width / 2), circle(b, width / 2)) }
export const stroke = (points: Point2[], width: number) => union(...points.slice(1).map((p, i) => capsule(points[i]!, p, width)))
export function expand(poly: MultiPolygon, distance: number): MultiPolygon { if (distance <= 0) return poly; return union(poly, ...poly.flatMap((p) => p.flatMap((r) => r.slice(1).map((v, i) => capsule(r[i] as Point2, v as Point2, distance * 2))))) }
export function inset(poly: MultiPolygon, distance: number): MultiPolygon { if (distance <= 0) return poly; return subtract(poly, ...poly.flatMap((p) => p.flatMap((r) => r.slice(1).map((v, i) => capsule(r[i] as Point2, v as Point2, distance * 2))))) }
export const mapPolygon = (poly: MultiPolygon, fn: (point: Point2) => Point2): MultiPolygon => poly.map((p) => p.map((r) => r.map((v) => fn(v as Point2))))

export interface PlacedPad { id: string; component: string; reference: string; number: string; net?: string; at: Point2; layers: CopperLayer[]; polygon: MultiPolygon; pad: Pad; placement: BoardPlacement }
export interface Drill { id: string; at: Point2; diameter: number; plated: boolean; end?: Point2 }
export interface CopperItem { id: string; net?: string; layer: CopperLayer; polygon: MultiPolygon; at: Point2; kind: "pad" | "track" | "via" | "zone"; component?: string }

export function padShape(pad: Pad): MultiPolygon {
  const [w, h] = pad.size
  if (pad.shape === "circle") return circle([0, 0], Math.min(w, h) / 2)
  if (pad.shape === "oval") return w >= h ? capsule([-(w - h) / 2, 0], [(w - h) / 2, 0], h) : capsule([0, -(h - w) / 2], [0, (h - w) / 2], w)
  if (pad.shape === "custom" && pad.poly?.length) return shape(pad.poly)
  if (pad.shape === "roundrect") {
    const r = Math.min(w, h) * (pad.roundness ?? 0.25)
    return union(shape([[-w / 2 + r, -h / 2], [w / 2 - r, -h / 2], [w / 2 - r, h / 2], [-w / 2 + r, h / 2]]), shape([[-w / 2, -h / 2 + r], [w / 2, -h / 2 + r], [w / 2, h / 2 - r], [-w / 2, h / 2 - r]]), ...[-1, 1].flatMap((x) => [-1, 1].map((y) => circle([x * (w / 2 - r), y * (h / 2 - r)], r))))
  }
  return shape([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]])
}

export function placedPads(project: Project, data: PcbData): PlacedPad[] {
  return data.placements.flatMap((placement) => {
    const component = project.components.find((c) => c.id === placement.component), footprint = component && project.parts[component.part]?.footprint
    if (!component || !footprint) return []
    return footprint.pads.map((pad, index): PlacedPad => {
      const both = pad.layers.includes("*.Cu"), flip = (layer: CopperLayer): CopperLayer => placement.side === "bottom" ? layer === "F.Cu" ? "B.Cu" : "F.Cu" : layer
      const layers: CopperLayer[] = pad.type === "np_thru_hole" ? [] : both ? ["F.Cu", "B.Cu"] : (["F.Cu", "B.Cu"] as CopperLayer[]).filter((l) => pad.layers.includes(l)).map(flip)
      const transform = (point: Point2) => { const r = rotatePoint(point, pad.rot ?? 0); return footprintPoint(placement, [r[0] + pad.at[0], r[1] + pad.at[1]]) }
      return { id: `${component.id}/${pad.num}/${index}`, component: component.id, reference: component.ref, number: pad.num, net: project.nets.find((n) => n.pins.some((p) => p.component === component.id && p.pin === pad.num))?.id, at: footprintPoint(placement, pad.at), layers, polygon: mapPolygon(padShape(pad), transform), pad, placement }
    })
  })
}
export function pcbDrills(project: Project, data: PcbData): Drill[] {
  const pads: Drill[] = placedPads(project, data).flatMap((p) => {
    if (!p.pad.drill) return []
    const [w, h] = p.pad.drill, diameter = Math.min(w, h)
    if (Math.abs(w - h) < 1e-8) return [{ id: p.id, at: p.at, diameter, plated: p.pad.type === "thru_hole" }]
    const delta: Point2 = w > h ? [(w - h) / 2, 0] : [0, (h - w) / 2]
    const rotated = rotatePoint(delta, p.pad.rot ?? 0)
    return [{ id: p.id, at: footprintPoint(p.placement, [p.pad.at[0] - rotated[0], p.pad.at[1] - rotated[1]]), end: footprintPoint(p.placement, [p.pad.at[0] + rotated[0], p.pad.at[1] + rotated[1]]), diameter, plated: p.pad.type === "thru_hole" }]
  })
  return [...pads, ...data.vias.map((v) => ({ id: v.id, at: v.at, diameter: v.drill, plated: true })), ...data.holes.map((h) => ({ id: h.id, at: h.at, diameter: h.diameter, plated: false }))]
}
export function boardCopper(project: Project, data: PcbData, fillZones = true): CopperItem[] {
  const pads = placedPads(project, data)
  const items: CopperItem[] = [
    ...pads.flatMap((p): CopperItem[] => p.layers.map((layer) => ({ id: p.id, net: p.net, layer, polygon: p.polygon, at: p.at, kind: "pad", component: p.component }))),
    ...data.tracks.map((t): CopperItem => ({ id: t.id, net: t.net, layer: t.layer, polygon: stroke(t.points, t.width), at: t.points[0]!, kind: "track" })),
    ...data.vias.flatMap((v): CopperItem[] => (["F.Cu", "B.Cu"] as CopperLayer[]).map((layer) => ({ id: v.id, net: v.net, layer, polygon: circle(v.at, v.diameter / 2), at: v.at, kind: "via" }))),
  ]
  if (!fillZones) return items
  const board = inset(shape(data.outline), data.rules.edgeClearance)
  for (const zone of data.zones) {
    let copper = intersect(shape(zone.outline), board)
    const clearance = Math.max(data.rules.clearance, zone.clearance)
    const obstacles = items.filter((v) => v.layer === zone.layer && v.net !== zone.net)
    copper = subtract(copper, ...obstacles.map((v) => expand(v.polygon, clearance)), ...pcbDrills(project, data).filter((v) => !v.plated).map((v) => capsule(v.at, v.end ?? v.at, v.diameter + clearance * 2)))
    if (zone.thermal) for (const pad of pads.filter((p) => p.net === zone.net && p.layers.includes(zone.layer))) {
      const gap = expand(pad.polygon, clearance)
      const reach = Math.max(...pad.pad.size) / 2 + clearance + zone.spokeWidth
      const spokes = union(capsule([pad.at[0] - reach, pad.at[1]], [pad.at[0] + reach, pad.at[1]], zone.spokeWidth), capsule([pad.at[0], pad.at[1] - reach], [pad.at[0], pad.at[1] + reach], zone.spokeWidth))
      copper = union(subtract(copper, gap), intersect(copper, spokes))
    }
    items.push({ id: zone.id, net: zone.net, layer: zone.layer, polygon: copper, at: (copper[0]?.[0]?.[0] as Point2 | undefined) ?? zone.outline[0]!, kind: "zone" })
  }
  return items
}
export const pcbData = (project: Project, doc: string) => pcbDoc(project, doc)
