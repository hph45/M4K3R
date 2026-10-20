import { CommandError, type Project } from "@m4k3r/core"
import { strToU8, zipSync } from "fflate"
import { drc } from "./checks"
import { boardCopper, expand, footprintPoint, mapPolygon, placedPads, pcbDrills, shape, stroke, union, type Drill, type MultiPolygon } from "./pcb-geometry"
import { pcbDoc, type PcbData, type Point2 } from "./pcb-schema"

const decimal = (v: number) => Number(v.toFixed(6)).toString()
const csv = (rows: (string | number)[][]) => rows.map((r) => r.map((v) => `"${String(v).replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n"
const safeName = (name: string) => name.replace(/[^\w.-]+/g, "-")
const physical = (at: Point2, data: PcbData): Point2 => [at[0] - Math.min(...data.outline.map((p) => p[0])), Math.max(...data.outline.map((p) => p[1])) - at[1]]

/** Metric Gerber X2 regions, 4.6 absolute coordinates. Geometry is shared with the editor and DRC. */
export function gerber(data: PcbData, polygons: MultiPolygon, fileFunction: string): string {
  const out = ["G04 M4K3R Gerber X2*", "%FSLAX46Y46*%", "%MOMM*%", `%TF.FileFunction,${fileFunction}*%`, "%TF.Part,Single*%", "%TF.FilePolarity,Positive*%", "%ADD10C,0.010*%", "D10*", "G01*", "%LPD*%"]
  const xy = (p: Point2) => { const [x, y] = physical(p, data); return `X${Math.round(x * 1e6)}Y${Math.round(y * 1e6)}` }
  for (const polygon of polygons) for (const [i, ring] of polygon.entries()) if (ring.length >= 4) out.push(i ? "%LPC*%" : "%LPD*%", "G36*", `${xy(ring[0] as Point2)}D02*`, ...ring.slice(1).map((p) => `${xy(p as Point2)}D01*`), "G37*")
  return [...out, "%LPD*%", "M02*", ""].join("\n")
}

/** Separate PTH/NPTH, explicit metric decimal coordinates, G85 oblong drill slots. */
export function excellon(data: PcbData, drills: Drill[], plated: boolean): string {
  const selected = drills.filter((d) => d.plated === plated), sizes = [...new Set(selected.map((d) => Number(d.diameter.toFixed(6))))].sort((a, b) => a - b)
  const out = ["M48", `;TYPE=${plated ? "PLATED" : "NON_PLATED"}`, "METRIC,TZ", ...sizes.map((size, i) => `T${String(i + 1).padStart(2, "0")}C${decimal(size)}`), "%", "G90", "G05"]
  const xy = (p: Point2) => { const [x, y] = physical(p, data); return `X${x.toFixed(6)}Y${y.toFixed(6)}` }
  for (const [i, diameter] of sizes.entries()) { out.push(`T${String(i + 1).padStart(2, "0")}`); for (const drill of selected.filter((d) => Math.abs(d.diameter - diameter) < 1e-6)) out.push(drill.end ? `${xy(drill.at)}G85${xy(drill.end)}` : xy(drill.at)) }
  return [...out, "M30", ""].join("\n")
}

// Compact 5×7 reference-designator font; each row is five pixels, emitted as actual filled geometry.
const glyphs = "A:01110100011000111111100011000110001 B:11110100011000111110100011000111110 C:01111100001000010000100001000001111 D:11110100011000110001100011000111110 E:11111100001000011110100001000011111 F:11111100001000011110100001000010000 G:01111100001000010111100011000101111 H:10001100011000111111100011000110001 I:11111001000010000100001000010011111 J:00111000100001000010100101001001100 K:10001100101010011000101001001010001 L:10000100001000010000100001000011111 M:10001110111010110101100011000110001 N:10001110011010110011100011000110001 O:01110100011000110001100011000101110 P:11110100011000111110100001000010000 Q:01110100011000110001101011001001101 R:11110100011000111110101001001010001 S:01111100001000001110000010000111110 T:11111001000010000100001000010000100 U:10001100011000110001100011000101110 V:10001100011000110001100010101000100 W:10001100011000110101101011101110001 X:10001100010101000100010101000110001 Y:10001100010101000100001000010000100 Z:11111000010001000100010001000011111 0:01110100111010110101110011000101110 1:00100011000010000100001000010001110 2:01110100010000100010001000100011111 3:11110000010000101110000010000111110 4:00010001100101010010111110001000010 5:11111100001000011110000010000111110 6:01110100001000011110100011000101110 7:11111000010001000100010000100001000 8:01110100011000101110100011000101110 9:01110100011000101111000010000101110"
const FONT = Object.fromEntries(glyphs.split(" ").map((s) => s.split(":")))
function referenceText(text: string, at: Point2) {
  const pixels: MultiPolygon[] = []
  for (const [index, char] of [...text].entries()) for (const [i, bit] of [...(FONT[char] ?? "")].entries()) if (bit === "1") { const x = at[0] + (index * 6 + i % 5) * 0.15, y = at[1] + Math.floor(i / 5) * 0.15; pixels.push(shape([[x, y], [x + 0.15, y], [x + 0.15, y + 0.15], [x, y + 0.15]])) }
  return union(...pixels)
}

export function fabricationFiles(project: Project, doc: string, options: { allowErrors?: boolean; step?: Uint8Array } = {}): Record<string, Uint8Array> {
  const data = pcbDoc(project, doc), checks = drc(project, data), errors = checks.filter((c) => c.severity === "error")
  if (errors.some((e) => e.code === "unsupported-pad")) throw new CommandError("A pad has no supported canonical outline. Repair the footprint before exporting.")
  if (errors.length && !options.allowErrors) throw new CommandError(`Fabrication blocked by ${errors.length} DRC error(s): ${errors.slice(0, 3).map((e) => e.message).join(" ")}`)
  const pads = placedPads(project, data), copper = boardCopper(project, data), drills = pcbDrills(project, data), files: Record<string, Uint8Array> = {}
  const put = (name: string, content: string) => { files[name] = strToU8(content) }
  for (const [layer, suffix, number, side] of [["F.Cu", "F", 1, "Top"], ["B.Cu", "B", 2, "Bot"]] as const) {
    put(`board-${suffix}_Cu.gbr`, gerber(data, union(...copper.filter((c) => c.layer === layer).map((c) => c.polygon)), `Copper,L${number},${side}`))
    put(`board-${suffix}_Mask.gbr`, gerber(data, union(...pads.filter((p) => p.layers.includes(layer)).map((p) => expand(p.polygon, 0.05))), `Soldermask,${side}`))
    put(`board-${suffix}_Paste.gbr`, gerber(data, union(...pads.filter((p) => p.pad.type === "smd" && p.layers.includes(layer)).map((p) => p.polygon)), `Paste,${side}`))
    const silk: MultiPolygon[] = []
    for (const place of data.placements.filter((p) => p.side === (layer === "F.Cu" ? "top" : "bottom"))) {
      const c = project.components.find((c) => c.id === place.component), f = c && project.parts[c.part]?.footprint
      if (!c || !f) continue
      for (const g of f.graphics.filter((g) => g.layer === "F.SilkS" || g.layer === "B.SilkS")) {
        const width = "width" in g ? g.width || 0.12 : 0.12
        if (g.type === "poly") silk.push(mapPolygon(stroke(g.pts, width), (p) => footprintPoint(place, p)))
        else if (g.type === "rect") silk.push(mapPolygon(stroke([g.start, [g.end[0], g.start[1]], g.end, [g.start[0], g.end[1]], g.start], width), (p) => footprintPoint(place, p)))
        else if (g.type === "circle") silk.push(mapPolygon(stroke(Array.from({ length: 49 }, (_, i): Point2 => [g.center[0] + g.radius * Math.cos(i * Math.PI / 24), g.center[1] + g.radius * Math.sin(i * Math.PI / 24)]), width), (p) => footprintPoint(place, p)))
      }
      silk.push(mapPolygon(referenceText(c.ref, [f.courtyard.min[0], f.courtyard.min[1] - 1.5]), (p) => footprintPoint(place, p)))
    }
    put(`board-${suffix}_Silkscreen.gbr`, gerber(data, union(...silk), `Legend,${side}`))
  }
  put("board-Edge_Cuts.gbr", gerber(data, stroke([...data.outline, data.outline[0]!], 0.05), "Profile,NP"))
  put("board-PTH.drl", excellon(data, drills, true)); put("board-NPTH.drl", excellon(data, drills, false))
  const groups = new Map<string, { refs: string[]; value: string; part: string; mpn: string; footprint: string }>()
  for (const v of data.placements) { const c = project.components.find((c) => c.id === v.component); if (!c) continue; const p = project.parts[c.part]!, key = JSON.stringify([c.part, c.props.value ?? "", c.props.package ?? ""]), old = groups.get(key); if (old) old.refs.push(c.ref); else groups.set(key, { refs: [c.ref], value: c.props.value ?? p.name, part: p.name, mpn: p.mpn ?? "", footprint: p.footprint?.source ?? "" }) }
  put("BOM.csv", csv([["Designators", "Quantity", "Value", "Part", "MPN", "Footprint"], ...[...groups.values()].map((v) => [v.refs.join(", "), v.refs.length, v.value, v.part, v.mpn, v.footprint])]))
  put("PickAndPlace.csv", csv([["Designator", "Mid X (mm)", "Mid Y (mm)", "Layer", "Rotation (deg)", "Footprint"], ...data.placements.flatMap((v) => { const c = project.components.find((c) => c.id === v.component), f = c && project.parts[c.part]?.footprint; if (!c || !f || !f.pads.some((p) => p.type === "smd")) return []; const [x, y] = physical(footprintPoint(v, [(f.courtyard.min[0] + f.courtyard.max[0]) / 2, (f.courtyard.min[1] + f.courtyard.max[1]) / 2]), data); return [[c.ref, decimal(x), decimal(y), v.side === "top" ? "Top" : "Bottom", decimal(((v.rotation % 360) + 360) % 360), f.source ?? ""]] })]))
  put("DRC.json", JSON.stringify(checks, null, 2)); put("project-board.json", JSON.stringify({ version: project.version, board: data }, null, 2))
  put("README.txt", `M4K3R two-layer fabrication package\nMetric Gerber X2 (4.6 absolute), decimal metric Excellon, separate PTH/NPTH.\nAll layers viewed from top; origin lower-left board bounding corner. SMT pick-and-place shares origin, positive CCW rotations; through-hole parts are in BOM only.\nBoard thickness ${data.thickness} mm, two copper layers. G85 slots retain their real drill axis. Masks expand pads by 0.05 mm, paste uses SMD copper lands.\nSilkscreen contains line/circle/rectangle footprint artwork and reference designators; free text and imported arc artwork are excluded.\nBoard STEP: ${options.step ? "included, exact boundary solid" : "not included"}.\nReview in a CAM viewer and agree stackup with fabricator. ${errors.length ? `EXPERIMENTAL: ${errors.length} unresolved DRC errors were explicitly allowed.` : "DRC errors: 0."}\n`)
  if (options.step) files["Board.step"] = options.step
  return files
}

export const fabricationZip = (project: Project, doc: string, options: { allowErrors?: boolean; step?: Uint8Array } = {}) => zipSync(fabricationFiles(project, doc, options), { level: 6 })
export const fabricationName = (project: Project, doc: string) => `${safeName(project.name)}-${safeName(project.docs.find((d) => d.id === doc || d.name === doc)?.name ?? doc)}-fab.zip`
