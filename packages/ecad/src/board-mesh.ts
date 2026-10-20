import type { Doc, Project } from "@m4k3r/core"
import earcut from "earcut"
import { capsule, pcbDrills, shape, subtract } from "./pcb-geometry"
import { pcbDoc, polygonArea, type PcbData, type Point2 } from "./pcb-schema"

export interface BoardMesh { id: string; positions: number[]; normals: number[]; indices: number[]; edges: number[]; faces: { start: number; count: number }[] }
type V3 = [number, number, number]
/** Local x right, y down, z up; bottom z=0 and top z=thickness. Drill/slot voids are real holes. */
export function pcbGeometry(project: Project, doc: string | PcbData | Doc) {
  const data = typeof doc === "string" ? pcbDoc(project, doc) : "kind" in doc ? doc.data as PcbData : doc, drills = pcbDrills(project, data)
  const material = subtract(shape(data.outline), ...drills.map((d) => capsule(d.at, d.end ?? d.at, d.diameter)))
  const mesh: BoardMesh = { id: typeof doc === "string" ? `pcb-${doc}` : "pcb-board", positions: [], normals: [], indices: [], edges: [], faces: [] }
  function triangle(a: V3, b: V3, c: V3, normal: V3) {
    const ab = b.map((v, i) => v - a[i]!) as V3, ac = c.map((v, i) => v - a[i]!) as V3
    const cross: V3 = [ab[1] * ac[2] - ab[2] * ac[1], ab[2] * ac[0] - ab[0] * ac[2], ab[0] * ac[1] - ab[1] * ac[0]]
    if (cross.reduce((sum, v, i) => sum + v * normal[i]!, 0) < 0) [b, c] = [c, b]
    const offset = mesh.positions.length / 3
    mesh.positions.push(...a, ...b, ...c); mesh.normals.push(...normal, ...normal, ...normal); mesh.indices.push(offset, offset + 1, offset + 2)
  }
  let totalArea = 0, cx = 0, cy = 0
  for (const polygon of material) {
    const points: Point2[] = [], holes: number[] = []
    for (const [i, ring] of polygon.entries()) { if (i) holes.push(points.length); points.push(...ring.slice(0, -1) as Point2[]) }
    const triangles = earcut(points.flat(), holes, 2), start = mesh.indices.length
    for (let i = 0; i < triangles.length; i += 3) { const a = points[triangles[i]!]!, b = points[triangles[i + 1]!]!, c = points[triangles[i + 2]!]!; triangle([...a, data.thickness], [...b, data.thickness], [...c, data.thickness], [0, 0, 1]); triangle([...a, 0], [...b, 0], [...c, 0], [0, 0, -1]) }
    mesh.faces.push({ start, count: mesh.indices.length - start })
    for (const [index, ring] of polygon.entries()) {
      let sum = 0, x = 0, y = 0
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1] as Point2, b = ring[i] as Point2, length = Math.hypot(b[0] - a[0], b[1] - a[1]), product = a[0] * b[1] - b[0] * a[1]
        sum += product; x += (a[0] + b[0]) * product; y += (a[1] + b[1]) * product
        if (length < 1e-8) continue
        const sign = (polygonArea(ring as Point2[]) > 0 ? 1 : -1) * (index ? -1 : 1), normal: V3 = [(b[1] - a[1]) / length * sign, -(b[0] - a[0]) / length * sign, 0], face = mesh.indices.length
        triangle([...a, 0], [...b, 0], [...b, data.thickness], normal); triangle([...a, 0], [...b, data.thickness], [...a, data.thickness], normal)
        mesh.faces.push({ start: face, count: 6 }); mesh.edges.push(...a, 0, ...b, 0, ...a, data.thickness, ...b, data.thickness)
      }
      const weight = Math.abs(sum / 2) * (index ? -1 : 1)
      if (Math.abs(sum) > 1e-12) { cx += x / (3 * sum) * weight; cy += y / (3 * sum) * weight; totalArea += weight }
    }
  }
  const min: V3 = [Math.min(...data.outline.map((p) => p[0])), Math.min(...data.outline.map((p) => p[1])), 0], max: V3 = [Math.max(...data.outline.map((p) => p[0])), Math.max(...data.outline.map((p) => p[1])), data.thickness]
  const centerOfMass: V3 = [totalArea ? cx / totalArea : (min[0] + max[0]) / 2, totalArea ? cy / totalArea : (min[1] + max[1]) / 2, data.thickness / 2]
  return { mesh, mass: totalArea * data.thickness * 0.00185, centerOfMass, bbox: { min, max, size: max.map((v, i) => v - min[i]!) as V3 }, mountingHoles: drills.filter((h) => !h.plated && !h.end).map((h) => ({ id: h.id, at: [...h.at, 0] as V3, diameter: h.diameter, axis: [0, 0, 1] as V3 })), material: "FR-4", massSource: "estimated" as const }
}
export const boardMesh = (project: Project, doc: string | PcbData | Doc) => pcbGeometry(project, doc).mesh
