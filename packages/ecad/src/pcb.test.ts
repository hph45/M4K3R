import { applyCommands, emptyProject, Part, registerCommands, registerDocKind, replay, type Command, type Project } from "@m4k3r/core"
import { strFromU8, unzipSync } from "fflate"
import { describe, expect, it } from "vitest"
import { drc, erc, pointInPolygon, polygonDistance, ratsnest } from "./checks"
import { pcbGeometry } from "./board-mesh"
import { excellon, fabricationFiles, fabricationZip, gerber } from "./fabrication"
import { boardCopper, circle, footprintPoint, pcbDrills, placedPads, shape } from "./pcb-geometry"
import { pcbCommands, pcbDoc, PcbData } from "./pcb-schema"
import { routeBetween } from "./router"

registerDocKind("pcb", PcbData)
registerCommands(pcbCommands)
const connector = Part.parse({ id: "test-pad", name: "Test terminal", refPrefix: "J", pins: [{ num: "1", name: "1", type: "passive" }], footprint: { source: "Test:RoundPad", pads: [{ num: "1", type: "thru_hole", shape: "circle", at: [0, 0], size: [1.8, 1.8], drill: [0.8, 0.8], layers: ["*.Cu", "*.Mask"] }], graphics: [], courtyard: { min: [-2, -2], max: [2, 2] } } })
let ids = 0
const ctx = { newId: (prefix: string) => `${prefix}_${++ids}`, resolvePart: (id: string) => id === connector.id ? connector : undefined }
const run = (p: Project, ...commands: Command[]) => applyCommands(p, commands, ctx)
function fixture() {
  return run(emptyProject("board", "Board"), { type: "component.add", args: { part: connector.id } }, { type: "component.add", args: { part: connector.id } }, { type: "net.connect", args: { pins: ["J1.1", "J2.1"], name: "SIGNAL" } }, { type: "doc.create", args: { kind: "pcb", name: "Board", data: { outline: [[0, 0], [40, 0], [40, 30], [0, 30]] } } }, { type: "pcb.place", args: { doc: "Board", component: "J1", at: [10, 10] } }, { type: "pcb.place", args: { doc: "Board", component: "J2", at: [30, 10] } }).project
}

describe("PCB geometry and commands", () => {
  it("walks around foreign copper instead of pushing it or accepting a short", () => {
    const p = run(fixture(), { type: "component.add", args: { part: connector.id } }, { type: "pcb.place", args: { doc: "Board", component: "J3", at: [20, 10] } }, { type: "net.connect", args: { pins: ["J3.1"], name: "OTHER" } }).project
    const d = pcbDoc(p, "Board"), before = JSON.stringify(d), net = p.nets.find((n) => n.name === "SIGNAL")!.id
    const route = routeBetween(p, d, [10, 10], [30, 10], net, "F.Cu", .3)
    expect(route.some((p) => Math.abs(p[1] - 10) > 1)).toBe(true)
    expect(route[0]).toEqual([10, 10]); expect(route.at(-1)).toEqual([30, 10])
    expect(JSON.stringify(d)).toBe(before)
  })
  it("uses mirrored/rotated real pads and preserves undoable placement", () => {
    const base = fixture(), move = run(base, { type: "pcb.place", args: { doc: "Board", component: "J1", at: [12, 14], rotation: 90, side: "bottom" } })
    expect(placedPads(move.project, pcbDoc(move.project, "Board"))[0]!.at).toEqual([12, 14])
    expect(footprintPoint(pcbDoc(move.project, "Board").placements[0]!, [2, 0])[1]).toBeCloseTo(16)
    expect(pcbDoc(replay(move.project, move.inversePatches).project, "Board").placements).toEqual(pcbDoc(base, "Board").placements)
    expect(() => run(base, { type: "pcb.outline.set", args: { doc: "Board", outline: [[0, 0], [10, 10], [0, 10], [10, 0]] } })).toThrow()
  })
  it("removes airwires only after physical copper connects pads, including both-layer vias", () => {
    let p = fixture(), data = pcbDoc(p, "Board")
    expect(ratsnest(p, data)).toHaveLength(1)
    p = run(p, { type: "pcb.track.add", args: { doc: "Board", net: "SIGNAL", layer: "F.Cu", width: 0.3, points: [[10, 10], [20, 10]] } }, { type: "pcb.via.add", args: { doc: "Board", net: "SIGNAL", at: [20, 10], diameter: 0.8, drill: 0.3 } }, { type: "pcb.track.add", args: { doc: "Board", net: "SIGNAL", layer: "B.Cu", width: 0.3, points: [[20, 10], [30, 10]] } }).project
    data = pcbDoc(p, "Board")
    expect(ratsnest(p, data)).toEqual([])
    expect(drc(p, data).filter((v) => v.severity === "error")).toEqual([])
  })
  it("pours actual clipped copper and clears foreign pads while retaining thermal connections", () => {
    let p = fixture()
    p = run(p, { type: "component.add", args: { part: connector.id } }, { type: "pcb.place", args: { doc: "Board", component: "J3", at: [20, 10] } }, { type: "net.connect", args: { pins: ["J3.1"], name: "OTHER" } }, { type: "pcb.zone.add", args: { doc: "Board", net: "SIGNAL", layer: "F.Cu", outline: [[1, 1], [39, 1], [39, 29], [1, 29]], clearance: 0.3, thermal: true } }).project
    const d = pcbDoc(p, "Board"), zone = boardCopper(p, d).find((v) => v.kind === "zone")!
    expect(pointInPolygon([20, 10], zone.polygon)).toBe(false)
    expect(polygonDistance(zone.polygon, circle([20, 10], 0.9))).toBeGreaterThanOrEqual(0.299)
    expect(ratsnest(p, d).filter((r) => r.net === p.nets.find((n) => n.name === "SIGNAL")!.id)).toEqual([])
  })
  it("reports shorts, insufficient width, drill and annular ring limits with actionable positions", () => {
    const p = run(fixture(), { type: "net.disconnect", args: { pins: ["J2.1"] } }, { type: "net.connect", args: { pins: ["J2.1"], name: "OTHER" } }, { type: "pcb.track.add", args: { doc: "Board", net: "OTHER", layer: "F.Cu", width: 0.05, points: [[1, 10], [10, 10]] } }, { type: "pcb.via.add", args: { doc: "Board", net: "OTHER", at: [5, 5], diameter: 0.35, drill: 0.2 } }).project
    const checks = drc(p, "Board")
    expect(checks.some((c) => c.code === "track-width" && c.at)).toBe(true)
    expect(checks.some((c) => c.code === "drill-size")).toBe(true)
    expect(checks.some((c) => c.code === "annular-ring")).toBe(true)
    expect(checks.some((c) => c.code === "short")).toBe(true)
  })
  it("checks mounting-hole copper clearance as well as drill-to-drill web", () => {
    const p = run(fixture(), { type: "pcb.track.add", args: { doc: "Board", net: "SIGNAL", layer: "F.Cu", width: .3, points: [[10, 10], [30, 10]] } }, { type: "pcb.hole.add", args: { doc: "Board", at: [20, 10], diameter: 3 } }, { type: "pcb.hole.add", args: { doc: "Board", at: [21, 10], diameter: 3 } }).project
    const checks = drc(p, "Board")
    expect(checks.some((c) => c.code === "hole-copper")).toBe(true)
    expect(checks.some((c) => c.code === "drill-spacing")).toBe(true)
  })
  it("keeps explicitly off-board components out of sync and board DRC without removing the shared circuit", () => {
    const p = run(fixture(), { type: "pcb.exclude", args: { doc: "Board", components: ["J2"] } }, { type: "pcb.sync", args: { doc: "Board" } }).project
    expect(p.components).toHaveLength(2)
    expect(p.nets[0]!.pins).toHaveLength(2)
    expect(pcbDoc(p, "Board").placements).toHaveLength(1)
    expect(drc(p, "Board").filter((c) => c.severity === "error")).toEqual([])
    const included = run(p, { type: "pcb.exclude", args: { doc: "Board", components: ["J2"], excluded: false } }, { type: "pcb.sync", args: { doc: "Board" } }).project
    expect(pcbDoc(included, "Board").placements).toHaveLength(2)
  })
  it("triangulates board material around real holes and reports FR4 mass and mounting interfaces", () => {
    const p = run(fixture(), { type: "pcb.hole.add", args: { doc: "Board", at: [20, 20], diameter: 3 } }).project
    const geometry = pcbGeometry(p, "Board"), expectedVolume = (1200 - Math.PI * (1.5 ** 2 + 2 * 0.4 ** 2)) * 1.6
    let volume = 0
    for (let i = 0; i < geometry.mesh.indices.length; i += 3) { const points = geometry.mesh.indices.slice(i, i + 3).map((id) => geometry.mesh.positions.slice(id * 3, id * 3 + 3)); const [a, b, c] = points as [number[], number[], number[]]; volume += (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) / 6 }
    expect(Math.abs(volume)).toBeCloseTo(expectedVolume, 0)
    expect(geometry.mass).toBeCloseTo(expectedVolume * 0.00185, 2)
    expect(geometry.mountingHoles).toHaveLength(1)
    expect(geometry.bbox.size).toEqual([40, 30, 1.6])
  })
})

describe("manufacturing output", () => {
  it("writes real metric Gerber geometry with correct y-up origin and Excellon drill coordinates", () => {
    const p = fixture(), d = pcbDoc(p, "Board")
    const copper = gerber(d, shape([[10, 10], [12, 10], [12, 12], [10, 12]]), "Copper,L1,Top")
    expect(copper).toContain("%FSLAX46Y46*%")
    expect(copper).toContain("X10000000Y20000000D02*")
    expect(copper).toContain("X12000000Y18000000D01*")
    const drill = excellon(d, pcbDrills(p, d), true)
    expect(drill).toContain("T01C0.8")
    expect(drill).toContain("X10.000000Y20.000000")
    expect(excellon(d, [{ id: "slot", at: [5, 5], end: [8, 5], diameter: 1, plated: false }], false)).toContain("X5.000000Y25.000000G85X8.000000Y25.000000")
  })
  it("blocks unrouted boards and exports a valid ZIP from routed copper plus BOM/PnP", () => {
    const base = fixture()
    expect(() => fabricationFiles(base, "Board")).toThrow(/DRC/)
    const p = run(base, { type: "pcb.track.add", args: { doc: "Board", net: "SIGNAL", layer: "F.Cu", width: 0.3, points: [[10, 10], [30, 10]] } }).project
    const files = unzipSync(fabricationZip(p, "Board"))
    expect(Object.keys(files)).toContain("board-F_Cu.gbr")
    expect(strFromU8(files["board-F_Cu.gbr"]!)).toContain("G36*")
    expect(strFromU8(files["BOM.csv"]!)).toContain('"J1, J2","2"')
    expect(strFromU8(files["README.txt"]!)).toContain("DRC errors: 0")
  })
})
