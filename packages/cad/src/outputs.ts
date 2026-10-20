import { CommandError } from "@m4k3r/core"
import { exportSTEP, makeCompound, measureArea, measureShapeVolumeProperties, type Shape3D } from "replicad"
import type { Evaluation } from "./evaluate"
import { MATERIALS, type Material } from "./schema"
import type { V3 } from "./sketch"
import { export3mfMeshes } from "./manufacturing"

/** Triangles and outline edges for three.js, one entry per body. */
export interface BodyMesh {
  id: string
  /** xyz triplets */
  positions: number[]
  normals: number[]
  /** Triangle vertex indices */
  indices: number[]
  /** Outline line segments as xyz pairs (LineSegments) */
  edges: number[]
  /** Index ranges of each B-rep face in `indices`, e.g. for hover highlighting */
  faces: { start: number; count: number }[]
}

const MESH = { tolerance: 0.05, angularTolerance: 0.2 }
const meshes = new WeakMap<Evaluation, BodyMesh[]>()

export function meshBodies(ev: Evaluation): BodyMesh[] {
  const cached = meshes.get(ev)
  if (cached) return cached
  const result = ev.bodies.map(({ id, shape }) => {
    const m = shape.mesh(MESH)
    return {
      id,
      positions: m.vertices,
      normals: m.normals,
      indices: m.triangles,
      edges: shape.meshEdges(MESH).lines,
      faces: m.faceGroups.map(({ start, count }) => ({ start, count })),
    }
  })
  meshes.set(ev, result)
  return result
}

export interface Box {
  min: V3
  max: V3
  size: V3
}

export interface MassProperties {
  /** mm³ */
  volume: number
  /** mm² */
  area: number
  /** g */
  mass: number
  centerOfMass: V3
  bbox: Box | null
}

const round = (v: number) => +v.toPrecision(10)

function box(shapes: Shape3D[]): Box | null {
  if (!shapes.length) return null
  const [min, max] = [[Infinity, Infinity, Infinity], [-Infinity, -Infinity, -Infinity]] as [V3, V3]
  for (const s of shapes) {
    const [lo, hi] = s.boundingBox.bounds
    for (let i = 0; i < 3; i++) {
      min[i] = Math.min(min[i]!, lo[i]!)
      max[i] = Math.max(max[i]!, hi[i]!)
    }
  }
  return { min: min.map(round) as V3, max: max.map(round) as V3, size: max.map((v, i) => round(v - min[i]!)) as V3 }
}

export function massProperties(shapes: Shape3D[], density: number): MassProperties {
  let volume = 0
  let area = 0
  const moment: V3 = [0, 0, 0]
  for (const s of shapes) {
    const p = measureShapeVolumeProperties(s)
    volume += p.volume
    p.centerOfMass.forEach((c, i) => (moment[i] = moment[i]! + c * p.volume))
    area += measureArea(s)
  }
  return {
    volume: round(volume),
    area: round(area),
    mass: round((volume * density) / 1000),
    centerOfMass: moment.map((m) => round(volume ? m / volume : 0)) as V3,
    bbox: box(shapes),
  }
}

/** Mass properties per body and in total. density in g/cm³ comes from the material (default PLA). */
export function properties(ev: Evaluation, material: Material = "PLA") {
  const density = MATERIALS[material]
  return {
    material,
    density,
    ...massProperties(ev.bodies.map((b) => b.shape), density),
    bodies: ev.bodies.map((b) => ({ id: b.id, ...massProperties([b.shape], density) })),
    features: ev.features.map(({ sketch, ...f }) =>
      sketch ? { ...f, sketch: { status: sketch.status, dof: sketch.dof, redundant: sketch.redundant } } : f,
    ),
    error: ev.error,
  }
}

function exportable(ev: Evaluation) {
  if (ev.error) throw new CommandError(`Can't export: feature "${ev.error.feature}" failed: ${ev.error.message}`)
  if (!ev.bodies.length) throw new CommandError("Can't export: there are no bodies")
  return ev.bodies
}

const bytes = async (blob: Blob) => new Uint8Array(await blob.arrayBuffer())

/** Binary STL of all bodies */
export function exportStl(ev: Evaluation): Promise<Uint8Array> {
  const shapes = exportable(ev).map((b) => b.shape)
  const all = shapes.length === 1 ? shapes[0]! : (makeCompound(shapes) as Shape3D)
  return bytes(all.blobSTL({ tolerance: 0.01, angularTolerance: 0.1, binary: true }))
}

/** STEP (AP214) with one named solid per body */
export function exportStep(ev: Evaluation): Promise<Uint8Array> {
  return bytes(exportSTEP(exportable(ev).map((b) => ({ shape: b.shape, name: b.id }))))
}

export function export3mf(ev: Evaluation): Uint8Array {
  exportable(ev)
  return export3mfMeshes(meshBodies(ev))
}
