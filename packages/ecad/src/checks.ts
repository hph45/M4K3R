import { pinAddress, type Project } from "@m4k3r/core"
import { boardCopper, capsule, footprintPoint, placedPads, pcbDrills, shape, type MultiPolygon } from "./pcb-geometry"
import { pcbDoc, segmentsCross, validateOutline, type PcbData, type Point2 } from "./pcb-schema"
import { inferDcRails } from "./dc-rails"

export interface ElectricalIssue { id: string; severity: "error" | "warning"; code: string; message: string; components?: string[]; net?: string; item?: string; at?: Point2 }
const round = (n: number) => Number(n.toFixed(4))
export function pointInRing(p: Point2, ring: number[][]) { let inside = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i]!, b = ring[j]!; if ((a[1]! > p[1]) !== (b[1]! > p[1]) && p[0] < (b[0]! - a[0]!) * (p[1] - a[1]!) / (b[1]! - a[1]!) + a[0]!) inside = !inside } return inside }
export function pointInPolygon(p: Point2, poly: MultiPolygon) { return poly.some((v) => pointInRing(p, v[0]!) && !v.slice(1).some((r) => pointInRing(p, r))) }
export function pointSegmentDistance(p: Point2, a: Point2, b: Point2) { const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy; const t = length ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length)) : 0; return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy) }
const edges = (poly: MultiPolygon) => poly.flatMap((p) => p.flatMap((r) => r.slice(1).map((v, i) => [r[i] as Point2, v as Point2] as const)))
export function polygonDistance(a: MultiPolygon, b: MultiPolygon) {
  if (!a.length || !b.length) return Infinity
  if (a.some((p) => pointInPolygon(p[0]![0] as Point2, b)) || b.some((p) => pointInPolygon(p[0]![0] as Point2, a))) return 0
  let min = Infinity
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) {
    if (segmentsCross(p, q, r, s)) return 0
    min = Math.min(min, pointSegmentDistance(p, r, s), pointSegmentDistance(q, r, s), pointSegmentDistance(r, p, q), pointSegmentDistance(s, p, q))
  }
  return min
}

export function erc(project: Project): ElectricalIssue[] {
  const issues: ElectricalIssue[] = [], flags = new Set(project.docs.filter((d) => d.kind === "schematic").flatMap((d) => ((d.data as { noConnects?: { component: string; pin: string }[] }).noConnects ?? []).map((p) => `${p.component}/${p.pin}`)))
  const dc = inferDcRails(project)
  for (const conflict of dc.conflicts) issues.push({ id: `rail-conflict-${conflict.net}`, severity: "error", code: "rail-source-conflict", net: conflict.net, message: `${project.nets.find((net) => net.id === conflict.net)?.name}: conflicting known DC setpoints (${conflict.sources.map((source) => `${round(source.voltage)} V from ${source.source}`).join("; ")}). Resolve the supply wiring.` })
  for (const component of project.components) for (const pin of project.parts[component.part]?.pins ?? []) {
    const key = `${component.id}/${pin.num}`, net = project.nets.find((n) => n.pins.some((p) => `${p.component}/${p.pin}` === key))
    if (flags.has(key) && net) issues.push({ id: `nc-${key}`, severity: "error", code: "no-connect-wired", message: `${component.ref}.${pin.name} is marked no-connect but wired to ${net.name}`, components: [component.id], net: net.id })
    if (!net && !flags.has(key) && ["input", "power_in"].includes(pin.type)) issues.push({ id: `floating-${key}`, severity: "warning", code: "unconnected-input", message: `${component.ref}.${pin.name} is unconnected. Connect it or mark no-connect.`, components: [component.id] })
  }
  for (const net of project.nets) {
    const refs = net.pins.flatMap((p) => { try { return [pinAddress(project, p)] } catch { return [] } })
    const outputs = refs.filter((r) => r.pin.type === "output" || r.pin.type === "power_out")
    if (outputs.length > 1) issues.push({ id: `outputs-${net.id}`, severity: "error", code: "output-conflict", message: `${net.name}: multiple driven outputs (${outputs.map((r) => r.address).join(", ")}).`, components: outputs.map((r) => r.component.id), net: net.id })
    const ranges = refs.flatMap((r) => r.pin.voltage ? [{ ...r, range: r.pin.voltage }] : [])
    const rail = dc.rails.get(net.id)
    if (ranges.length && !rail && !dc.conflicts.some((conflict) => conflict.net === net.id)) issues.push({ id: `rail-unknown-${net.id}`, severity: "warning", code: "unknown-rail-voltage", net: net.id, components: ranges.map((r) => r.component.id), message: `${net.name}: DC voltage is unknown; pin ratings cannot be checked against a source. Only a battery referenced to named GND/0 or a regulator with known input, GND, setpoint and dropout is inferred. Check the supply and use simulation or measurements.` })
    if (rail) for (const r of ranges) if (rail.voltage + 1e-6 < r.range[0] || rail.voltage - 1e-6 > r.range[1]) issues.push({ id: `rail-voltage-${net.id}-${r.component.id}-${r.pin.num}`, severity: "error", code: "rail-voltage", net: net.id, components: [r.component.id], message: `${net.name}: ${round(rail.voltage)} V from ${rail.source} is outside ${r.address}'s allowed ${r.range[0]}–${r.range[1]} V range. Use a compatible regulated supply or level shifter.` })
    if (ranges.length > 1 && Math.max(...ranges.map((r) => r.range[0])) > Math.min(...ranges.map((r) => r.range[1]))) issues.push({ id: `voltage-${net.id}`, severity: "error", code: "voltage-domain", message: `${net.name}: pin voltage ranges do not overlap. Use a level shifter or a compatible rail.`, net: net.id, components: ranges.map((r) => r.component.id) })
    if (refs.some((r) => r.pin.type === "open_drain") && !refs.some((r) => project.parts[r.component.part]?.sim?.model === "resistor")) issues.push({ id: `pullup-${net.id}`, severity: "warning", code: "missing-pullup", message: `${net.name}: open-drain net has no resistor. Check its pull-up.`, net: net.id })
    for (const r of refs) if (/^(PWM|SPI|I2C)/i.test(net.name) && r.pin.functions?.length && /^GP(?:IO)?\d+$/i.test(r.pin.name)) {
      const bus = /^PWM/i.test(net.name) ? "PWM" : /^SPI/i.test(net.name) ? "SPI" : "I2C"
      if (!r.pin.functions.some((f) => f.startsWith(bus))) issues.push({ id: `function-${net.id}-${r.component.id}`, severity: "warning", code: "pin-function", message: `${net.name}: ${r.address} does not advertise ${bus}.`, net: net.id, components: [r.component.id] })
    }
    if (!/^(GND|0)$/i.test(net.name) && refs.some((r) => r.pin.type === "power_in" && (project.parts[r.component.part]?.pins.length ?? 0) > 4) && !refs.some((r) => project.parts[r.component.part]?.sim?.model === "capacitor")) issues.push({ id: `decoupling-${net.id}`, severity: "warning", code: "missing-decoupling", message: `${net.name}: IC power net has no capacitor. Check local decoupling.`, net: net.id })
  }
  return issues
}

export interface Airwire { net: string; from: Point2; to: Point2; fromPad: string; toPad: string; length: number }
export function ratsnest(project: Project, data: PcbData, copper = boardCopper(project, data)): Airwire[] {
  const result: Airwire[] = [], pads = placedPads(project, data)
  for (const net of project.nets) {
    const targets = pads.filter((p) => p.net === net.id && p.layers.length)
    if (targets.length < 2) continue
    // Zones may have isolated islands: each island is a separate conductor in the graph.
    const items = copper.filter((c) => c.net === net.id).flatMap((c) => c.polygon.map((poly, index) => ({ ...c, group: `${c.kind}:${c.id}`, polygon: [poly] as MultiPolygon, index })))
    const parents = items.map((_, i) => i), root = (n: number): number => parents[n] === n ? n : (parents[n] = root(parents[n]!))
    const join = (a: number, b: number) => { parents[root(a)] = root(b) }
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const a = items[i]!, b = items[j]!
      const physicalBridge = a.group === b.group && a.kind !== "zone" && a.layer !== b.layer
      if (physicalBridge || a.layer === b.layer && polygonDistance(a.polygon, b.polygon) < 1e-5) join(i, j)
    }
    const groups = targets.map((p) => { const i = items.findIndex((c) => c.kind === "pad" && c.id === p.id); return { pad: p, group: i >= 0 ? root(i) : -targets.indexOf(p) - 1 } })
    const connected = new Set([groups[0]!.group])
    while (groups.some((g) => !connected.has(g.group))) {
      let nearest: { a: typeof groups[number]; b: typeof groups[number]; length: number } | undefined
      for (const a of groups.filter((g) => connected.has(g.group))) for (const b of groups.filter((g) => !connected.has(g.group))) { const length = Math.hypot(a.pad.at[0] - b.pad.at[0], a.pad.at[1] - b.pad.at[1]); if (!nearest || length < nearest.length) nearest = { a, b, length } }
      if (!nearest) break
      result.push({ net: net.id, from: nearest.a.pad.at, to: nearest.b.pad.at, fromPad: nearest.a.pad.id, toPad: nearest.b.pad.id, length: nearest.length })
      connected.add(nearest.b.group)
    }
  }
  return result
}

export function drc(project: Project, doc: string | PcbData): ElectricalIssue[] {
  const data = typeof doc === "string" ? pcbDoc(project, doc) : doc, issues: ElectricalIssue[] = []
  try { validateOutline(data.outline) } catch (error) { return [{ id: "outline", severity: "error", code: "outline", message: String(error instanceof Error ? error.message : error) }] }
  const copper = boardCopper(project, data), pads = placedPads(project, data), outline = shape(data.outline)
  for (const c of project.components.filter((c) => project.parts[c.part]?.pins.length && !(data.excluded ?? []).includes(c.id))) {
    if (!project.parts[c.part]?.footprint) issues.push({ id: `footprint-${c.id}`, severity: "error", code: "missing-footprint", components: [c.id], message: `${c.ref} has no footprint. Import a real footprint before fabrication.` })
    else if (!data.placements.some((p) => p.component === c.id)) issues.push({ id: `unplaced-${c.id}`, severity: "error", code: "unplaced", components: [c.id], message: `${c.ref} is not placed. Sync footprints or place it.` })
  }
  for (const track of data.tracks) if (track.width + 1e-8 < data.rules.minWidth) issues.push({ id: `width-${track.id}`, severity: "error", code: "track-width", item: track.id, at: track.points[0], message: `Track width ${track.width} mm is below ${data.rules.minWidth} mm.` })
  for (const item of copper) {
    if (item.net && !project.nets.some((n) => n.id === item.net)) issues.push({ id: `net-${item.id}`, severity: "error", code: "stale-net", item: item.id, at: item.at, message: `Copper ${item.id} refers to a removed/merged net. Reassign or remove it.` })
    const edgeDistance = Math.min(...edges(item.polygon).flatMap(([a, b]) => data.outline.map((p, i) => { const q = data.outline[(i + 1) % data.outline.length]!; return segmentsCross(a, b, p, q) ? 0 : Math.min(pointSegmentDistance(a, p, q), pointSegmentDistance(p, a, b)) })))
    if (!pointInPolygon(item.at, outline) || item.polygon.some((p) => p[0]!.some((v) => !pointInPolygon(v as Point2, outline))) || edgeDistance + 1e-5 < data.rules.edgeClearance) issues.push({ id: `edge-${item.id}-${item.layer}`, severity: "error", code: "board-edge", item: item.id, at: item.at, message: `${item.kind} ${item.id}: copper is outside the board or closer than ${data.rules.edgeClearance} mm to its edge.` })
  }
  for (let i = 0; i < copper.length; i++) for (let j = i + 1; j < copper.length; j++) {
    const a = copper[i]!, b = copper[j]!
    if (a.layer !== b.layer || a.id === b.id || a.net && a.net === b.net) continue
    const clearance = Math.max(data.rules.clearance, ...[a.net, b.net].map((n) => data.netClasses.find((c) => c.name === data.assignments[n ?? ""])?.clearance ?? 0))
    const distance = polygonDistance(a.polygon, b.polygon)
    if (distance + 1e-5 < clearance) issues.push({ id: `clearance-${a.id}-${b.id}-${a.layer}`, severity: "error", code: distance < 1e-6 ? "short" : "clearance", item: a.id, at: a.at, components: [a.component, b.component].filter((v): v is string => !!v), message: `${a.layer}: ${a.id} and ${b.id} have ${round(distance)} mm clearance; need ${clearance} mm.` })
  }
  const drills = pcbDrills(project, data)
  for (const drill of drills) {
    if (drill.diameter < data.rules.minDrill) issues.push({ id: `drill-${drill.id}`, severity: "error", code: "drill-size", item: drill.id, at: drill.at, message: `Drill ${drill.diameter} mm is below ${data.rules.minDrill} mm.` })
    if (!pointInPolygon(drill.at, outline) || Math.min(...data.outline.map((p, i) => pointSegmentDistance(drill.at, p, data.outline[(i + 1) % data.outline.length]!))) < drill.diameter / 2 + data.rules.edgeClearance) issues.push({ id: `hole-edge-${drill.id}`, severity: "error", code: "hole-edge", item: drill.id, at: drill.at, message: "Drill or mounting hole is too close to the board edge." })
    if (!drill.plated) {
      const hole = capsule(drill.at, drill.end ?? drill.at, drill.diameter)
      for (const item of copper) if (polygonDistance(hole, item.polygon) + 1e-5 < data.rules.clearance) issues.push({ id: `hole-copper-${drill.id}-${item.id}-${item.layer}`, severity: "error", code: "hole-copper", item: item.id, at: drill.at, message: `Non-plated hole ${drill.id} needs ${data.rules.clearance} mm clearance to ${item.id} copper.` })
    }
  }
  for (let i = 0; i < drills.length; i++) for (let j = i + 1; j < drills.length; j++) {
    const a = drills[i]!, b = drills[j]!
    if (Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) < 1e-8 && a.diameter === b.diameter && !a.end && !b.end) continue
    if (polygonDistance(capsule(a.at, a.end ?? a.at, a.diameter), capsule(b.at, b.end ?? b.at, b.diameter)) + 1e-5 < data.rules.clearance) issues.push({ id: `drill-spacing-${a.id}-${b.id}`, severity: "error", code: "drill-spacing", item: a.id, at: a.at, message: `Drills ${a.id} and ${b.id} overlap or leave less than ${data.rules.clearance} mm material web.` })
  }
  for (const via of data.vias) if ((via.diameter - via.drill) / 2 + 1e-8 < data.rules.annularRing) issues.push({ id: `ring-${via.id}`, severity: "error", code: "annular-ring", item: via.id, at: via.at, message: `Via annular ring is below ${data.rules.annularRing} mm.` })
  for (const pad of pads) {
    if (pad.pad.type === "thru_hole" && pad.pad.drill && (Math.min(...pad.pad.size) - Math.min(...pad.pad.drill)) / 2 + 1e-8 < data.rules.annularRing) issues.push({ id: `ring-${pad.id}`, severity: "error", code: "annular-ring", item: pad.id, at: pad.at, message: `${pad.reference}.${pad.number}: annular ring is below ${data.rules.annularRing} mm.` })
    if (pad.pad.shape === "trapezoid" || pad.pad.shape === "custom" && !pad.pad.poly?.length) issues.push({ id: `unsupported-pad-${pad.id}`, severity: "error", code: "unsupported-pad", item: pad.id, at: pad.at, message: `${pad.reference}.${pad.number}: ${pad.pad.shape} needs a polygon outline before fabrication.` })
  }
  const courts = data.placements.flatMap((place) => { const c = project.components.find((c) => c.id === place.component), f = c && project.parts[c.part]?.footprint; if (!c || !f) return []; return [{ c, place, polygon: shape([f.courtyard.min, [f.courtyard.max[0], f.courtyard.min[1]], f.courtyard.max, [f.courtyard.min[0], f.courtyard.max[1]]].map((p) => footprintPoint(place, p as Point2))) }] })
  for (let i = 0; i < courts.length; i++) for (let j = i + 1; j < courts.length; j++) { const a = courts[i]!, b = courts[j]!; if (a.place.side === b.place.side && polygonDistance(a.polygon, b.polygon) < 1e-6) issues.push({ id: `courtyard-${a.c.id}-${b.c.id}`, severity: "warning", code: "courtyard-overlap", components: [a.c.id, b.c.id], at: a.place.at, message: `${a.c.ref} and ${b.c.ref}: footprint courtyards overlap.` }) }
  for (const [i, wire] of ratsnest(project, data, copper).entries()) issues.push({ id: `unrouted-${wire.net}-${i}`, severity: "error", code: "unrouted", net: wire.net, at: wire.from, message: `${project.nets.find((n) => n.id === wire.net)?.name ?? wire.net}: an unrouted connection remains (${round(wire.length)} mm).` })
  return issues
}
