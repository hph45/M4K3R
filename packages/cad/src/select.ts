// Edge and face selection by query. Queries are re-run on every evaluation, so they survive upstream edits
// as long as the geometry they describe still exists. A picked `near` point that no longer lands on exactly
// one edge or face is an error; the wrong entity is never chosen silently.
import { makeVertex, measureDistanceBetween, type Edge, type Face, type Shape3D } from "replicad"
import type { EdgeQuery, Expr, FaceQuery } from "./schema"
import type { V3 } from "./sketch"

const AXES: Record<string, V3> = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }
const TOL = 1e-3
const PICK_TOL = 0.1

export function axis(a: string | V3): V3 {
  if (Array.isArray(a)) {
    const len = Math.hypot(...a)
    if (!len) throw new Error("Direction can't be a zero vector")
    return a.map((v) => v / len) as V3
  }
  const sign = a.startsWith("-") ? -1 : 1
  return AXES[a.replace(/^[-+]/, "")]!.map((v) => v * sign) as V3
}

const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const describe = (q: object) => JSON.stringify(q)

/** Bounding box degenerate at a coordinate: the element lies in that plane. */
function liesAt(shape: Edge | Face, q: { x?: Expr; y?: Expr; z?: Expr }, num: (e: Expr) => number) {
  const [min, max] = shape.boundingBox.bounds
  return (["x", "y", "z"] as const).every((k, i) => {
    if (q[k] === undefined) return true
    const v = num(q[k])
    return Math.abs(min[i]! - v) < TOL && Math.abs(max[i]! - v) < TOL
  })
}

/** Narrow candidates to the single one closest to a picked point. */
function pick<T extends Edge | Face>(candidates: T[], at: V3, what: string): T[] {
  const vertex = makeVertex(at)
  const ranked = candidates
    .map((c) => ({ c, d: measureDistanceBetween(vertex, c) }))
    .filter((r) => r.d < PICK_TOL)
    .sort((a, b) => a.d - b.d)
  const where = `(${at.map((v) => +v.toFixed(3)).join(", ")})`
  if (!ranked.length) throw new Error(`No ${what} at ${where} any more; the model changed. Reselect it`)
  if (ranked.length > 1 && ranked[1]!.d - ranked[0]!.d < TOL) {
    throw new Error(`Several ${what}s meet at ${where}; pick a point inside one ${what}`)
  }
  return [ranked[0]!.c]
}

export function selectEdges(shape: Shape3D, query: "all" | EdgeQuery | EdgeQuery[], num: (e: Expr) => number): Edge[] {
  const all = shape.edges
  if (query === "all") return all
  const found = new Set<number>()
  for (const q of Array.isArray(query) ? query : [query]) {
    const dir = q.direction && axis(q.direction)
    let hits = all.filter((e) => {
      if (q.type && e.geomType !== q.type.toUpperCase()) return false
      if (dir) {
        if (e.geomType !== "LINE") return false
        const [a, b] = [e.startPoint, e.endPoint]
        const d: V3 = [b.x - a.x, b.y - a.y, b.z - a.z]
        if (Math.abs(Math.abs(dot(d, dir)) - Math.hypot(...d)) > TOL) return false
      }
      return liesAt(e, q, num)
    })
    if (q.near) hits = pick(hits, q.near.map(num) as V3, "edge")
    if (!hits.length) throw new Error(`No edge matches ${describe(q)}`)
    for (const e of hits) found.add(all.indexOf(e))
  }
  return [...found].map((i) => all[i]!)
}

export function selectFaces(shape: Shape3D, query: FaceQuery | FaceQuery[], num: (e: Expr) => number): Face[] {
  const all = shape.faces
  const found = new Set<number>()
  for (const q of Array.isArray(query) ? query : [query]) {
    const normal = q.normal && axis(q.normal)
    const type = q.type === "cylinder" ? "CYLINDRE" : q.type?.toUpperCase()
    let hits = all.filter((f) => {
      if (type && f.geomType !== type) return false
      if (normal) {
        if (f.geomType !== "PLANE") return false
        const n = f.normalAt()
        if (dot([n.x, n.y, n.z], normal) < 1 - TOL) return false
      }
      return liesAt(f, q, num)
    })
    if (q.near) hits = pick(hits, q.near.map(num) as V3, "face")
    if (!hits.length) throw new Error(`No face matches ${describe(q)}`)
    for (const f of hits) found.add(all.indexOf(f))
  }
  return [...found].map((i) => all[i]!)
}
