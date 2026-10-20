import type { BodyMesh, SolvedSketch, V3 } from "@m4k3r/cad"
import { cubicPoint,splineCurves } from "@m4k3r/cad/geometry"

export type Segment = [V3, V3]
export type ProjectedTriangle = [V3, V3, V3]
export interface Camera { yaw: number; pitch: number; zoom: number }
export const isoCamera: Camera = { yaw: -Math.PI / 4, pitch: Math.PI / 3, zoom: 1 }

export function rotate([x, y, z]: V3, camera: Camera): V3 {
  const a = x * Math.cos(camera.yaw) - y * Math.sin(camera.yaw)
  const b = x * Math.sin(camera.yaw) + y * Math.cos(camera.yaw)
  return [a, b * Math.cos(camera.pitch) - z * Math.sin(camera.pitch), b * Math.sin(camera.pitch) + z * Math.cos(camera.pitch)]
}

/** Orthographic depth at a screen point; larger Z is nearer to the camera. */
export function triangleDepthAt(x: number, y: number, [a, b, c]: ProjectedTriangle): number | undefined {
  const determinant = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
  if (Math.abs(determinant) < 1e-9) return undefined
  const u = ((b[1] - c[1]) * (x - c[0]) + (c[0] - b[0]) * (y - c[1])) / determinant
  const v = ((c[1] - a[1]) * (x - c[0]) + (a[0] - c[0]) * (y - c[1])) / determinant
  const w = 1 - u - v
  if (Math.min(u, v, w) < -1e-8) return undefined
  return u * a[2] + v * b[2] + w * c[2]
}

/** Clip outline edges against the solid, sampling in screen pixels rather than model units. */
export function visibleEdgeSpans([a, b]: Segment, triangles: ProjectedTriangle[], tolerance = 1e-5, stepPixels = 3): Segment[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / stepPixels))
  const point = (t: number): V3 => a.map((n, i) => n + (b[i]! - n) * t) as V3
  const result: Segment[] = []
  let start: number | undefined
  for (let i = 0; i < steps; i++) {
    const p = point((i + 0.5) / steps)
    const hidden = triangles.some((triangle) => {
      const depth = triangleDepthAt(p[0], p[1], triangle)
      return depth !== undefined && depth > p[2] + tolerance
    })
    if (!hidden && start === undefined) start = i / steps
    if (hidden && start !== undefined) { result.push([point(start), point(i / steps)]); start = undefined }
  }
  if (start !== undefined) result.push([point(start), b])
  return result
}

export function sketchSegments(sketch: SolvedSketch): Segment[] {
  const world = ([u, v]: [number, number]): V3 => sketch.plane.origin.map((n, i) => n + u * sketch.plane.xDir[i]! + v * sketch.plane.yDir[i]!) as V3
  return sketch.entities.flatMap((e): Segment[] => {
    if (e.type === "line") return [[world(e.start), world(e.end)]]
    if (e.type === "rectangle") return e.corners.map((p, i) => [world(p), world(e.corners[(i + 1) % 4]!)])
    if (e.type === "point") return []
    if(e.type==="spline")return splineCurves(e.points,e.closed).flatMap(c=>Array.from({length:20},(_,i)=>[world(cubicPoint(c,i/20)),world(cubicPoint(c,(i+1)/20))] as Segment))
    const start = e.type === "arc" ? e.start : 0
    let end = e.type === "arc" ? e.end : 360
    while (end <= start) end += 360
    const steps = Math.max(8, Math.ceil((end - start) / 6))
    const point = (i: number) => {
      const a = (start + (end - start) * i / steps) * Math.PI / 180
      return world([e.center[0] + e.radius * Math.cos(a), e.center[1] + e.radius * Math.sin(a)])
    }
    return Array.from({ length: steps }, (_, i) => [point(i), point(i + 1)])
  })
}

/** Keep the fit independent of camera angle so orbiting never makes the model jump. */
export function modelBounds(bodies: BodyMesh[], sketches: Segment[][]) {
  const min: V3 = [Infinity, Infinity, Infinity]
  const max: V3 = [-Infinity, -Infinity, -Infinity]
  const add = (p: V3) => p.forEach((n, i) => { min[i] = Math.min(min[i]!, n); max[i] = Math.max(max[i]!, n) })
  for (const b of bodies) for (let i = 0; i < b.positions.length; i += 3) add(b.positions.slice(i, i + 3) as V3)
  for (const s of sketches) for (const [a, b] of s) { add(a); add(b) }
  if (!Number.isFinite(min[0])) return { center: [0, 0, 0] as V3, radius: 40 }
  return { center: min.map((n, i) => (n + max[i]!) / 2) as V3, radius: Math.max(1, Math.hypot(...max.map((n, i) => n - min[i]!)) / 2) }
}
