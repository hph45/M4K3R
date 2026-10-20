import { SolveStatus, type GcsWrapper, type SketchPrimitive } from "@salusoft89/planegcs"
import { draw, drawCircle, type Drawing } from "replicad"
import type { Constraint, Expr, Sketch } from "./schema"
import { cubicPoint,splineCurves } from "./spline"

export type V2 = [number, number]
export type V3 = [number, number, number]

export interface Frame {
  origin: V3
  xDir: V3
  yDir: V3
  normal: V3
}

export type SolvedEntity = { id: string; construction?: boolean } & (
  | { type: "point"; at: V2 }
  | { type: "line"; start: V2; end: V2 }
  | { type: "circle"; center: V2; radius: number }
  | { type: "arc"; center: V2; radius: number; start: number; end: number }
  | { type: "rectangle"; corners: [V2, V2, V2, V2] }
  | { type:"spline";points:V2[];closed:boolean }
)

/** Solved sketch geometry, for drawing it. Coordinates are in the sketch plane (mm, angles in degrees). */
export interface SolvedSketch {
  plane: Frame
  entities: SolvedEntity[]
  /** Remaining degrees of freedom; 0 = fully defined */
  dof: number
  status: "under" | "full" | "over"
  /** Constraints that are implied by others */
  redundant: string[]
}

export interface SketchSolution {
  solved: SolvedSketch
  /** Solved position of a point reference */
  point(ref: string): V2
  /** Solved ends of a line reference */
  line(ref: string): [V2, V2]
  /** Every non-construction point entity */
  points(): V2[]
  /** Closed profiles as one 2D drawing (nested loops alternate between solid and hole) */
  profile(): Drawing
}

type Kind = "point" | "line" | "circle" | "arc" | "spline"

const FRAMES: Record<Sketch["plane"], [V3, V3, V3]> = {
  XY: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  XZ: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  YZ: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
}

export function sketchFrame(plane: Sketch["plane"], offset: number): Frame {
  const [xDir, yDir, normal] = FRAMES[plane]
  return { origin: normal.map((n) => n * offset) as V3, xDir, yDir, normal }
}

export const toWorld = (f: Frame, [u, v]: V2): V3 => [0, 1, 2].map((i) => f.origin[i]! + u * f.xDir[i]! + v * f.yDir[i]!) as V3

const RAD = Math.PI / 180
const TOL = 1e-6
const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1])
const fmt = (p: V2) => `(${+p[0].toFixed(3)}, ${+p[1].toFixed(3)})`

export function solveSketch(gcs: GcsWrapper, sketch: Sketch, num: (e: Expr) => number, frame?:Frame): SketchSolution {
  const name = `Sketch "${sketch.id}"`
  const geo: SketchPrimitive[] = [{ id: "origin", type: "point", x: 0, y: 0, fixed: true }]
  const cons: SketchPrimitive[] = []
  const kinds = new Map<string, Kind>([["origin", "point"]])
  const members = new Map<string, string[]>() // entity → its points
  const initial = new Map<string, V2>()
  const labels = new Map<string, string>()
  const rects = new Set<string>()
  const v2 = (p: [Expr, Expr]): V2 => [num(p[0]), num(p[1])]
  const positive = (e: Expr, what: string) => {
    const v = num(e)
    if (!(v > 0)) throw new Error(`${what} must be positive (got ${v})`)
    return v
  }

  const point = (id: string, [x, y]: V2) => {
    geo.push({ id, type: "point", x, y, fixed: false })
    kinds.set(id, "point")
    initial.set(id, [x, y])
    return id
  }
  const line = (id: string, p1: string, p2: string) => {
    geo.push({ id, type: "line", p1_id: p1, p2_id: p2 })
    kinds.set(id, "line")
    members.set(id, [p1, p2])
  }
  let n = 0
  const add = (label: string, c: object) => {
    const id = `k${n++}`
    labels.set(id, label)
    cons.push({ id, ...c } as SketchPrimitive)
  }

  for (const e of sketch.entities) {
    if (kinds.has(e.id) || rects.has(e.id)) throw new Error(`${name}: duplicate entity id "${e.id}"`)
    const id = e.id
    if(e.type==="spline") {
      kinds.set(id,"spline");members.set(id,e.points.map((p,i)=>point(`${id}.p${i}`,v2(p))))
    } else if (e.type === "point") {
      members.set(id, [point(id, v2(e.at))])
    } else if (e.type === "line") {
      line(id, point(`${id}.start`, v2(e.start)), point(`${id}.end`, v2(e.end)))
    } else if (e.type === "circle") {
      members.set(id, [point(`${id}.center`, v2(e.center))])
      geo.push({ id, type: "circle", c_id: `${id}.center`, radius: positive(e.radius, `${id} radius`) })
      kinds.set(id, "circle")
    } else if (e.type === "arc") {
      const [cx, cy] = v2(e.center)
      const r = positive(e.radius, `${id} radius`)
      const [s, t] = [num(e.start) * RAD, num(e.end) * RAD]
      const ids = [point(`${id}.center`, [cx, cy]), point(`${id}.start`, [cx + r * Math.cos(s), cy + r * Math.sin(s)])]
      ids.push(point(`${id}.end`, [cx + r * Math.cos(t), cy + r * Math.sin(t)]))
      members.set(id, ids)
      geo.push({ id, type: "arc", c_id: ids[0]!, start_id: ids[1]!, end_id: ids[2]!, radius: r, start_angle: s, end_angle: t })
      kinds.set(id, "arc")
      add("arc rules", { type: "arc_rules", a_id: id })
    } else {
      const [w, h] = [positive(e.width, `${id} width`), positive(e.height, `${id} height`)]
      const [cx, cy] = e.corner ? v2(e.corner).map((v, i) => v + (i ? h : w) / 2) : e.center ? v2(e.center) : [0, 0]
      const [x0, y0, x1, y1] = [cx! - w / 2, cy! - h / 2, cx! + w / 2, cy! + h / 2]
      const [bl, br, tr, tl] = [point(`${id}.bl`, [x0, y0]), point(`${id}.br`, [x1, y0]), point(`${id}.tr`, [x1, y1]), point(`${id}.tl`, [x0, y1])]
      line(`${id}.bottom`, bl, br)
      line(`${id}.right`, br, tr)
      line(`${id}.top`, tr, tl)
      line(`${id}.left`, tl, bl)
      for (const side of ["bottom", "top"]) add(`${id} rectangle`, { type: "horizontal_l", l_id: `${id}.${side}` })
      for (const side of ["left", "right"]) add(`${id} rectangle`, { type: "vertical_l", l_id: `${id}.${side}` })
      members.set(id, [bl, br, tr, tl])
      rects.add(id)
    }
  }

  // Points drawn at the same spot are joined, like a sketcher snapping them together.
  const groups = new Map<string, string[]>()
  for (const [id, [x, y]] of initial) {
    const key = `${Math.round(x / TOL)},${Math.round(y / TOL)}`
    groups.set(key, [...(groups.get(key) ?? []), id])
  }
  for (const ids of groups.values()) {
    for (let i = 1; i < ids.length; i++) {
      add(`coincident ${ids[0]} = ${ids[i]} (drawn together)`, { type: "p2p_coincident", p1_id: ids[0], p2_id: ids[i] })
    }
  }

  const kindOf = (ref: string): Kind => {
    const kind = kinds.get(ref)
    if (kind) return kind
    if (rects.has(ref)) throw new Error(`"${ref}" is a rectangle; use its lines (${ref}.top…) or corners (${ref}.bl…)`)
    throw new Error(`no sketch entity "${ref}"`)
  }
  const pointsOf = (ref: string) => (kindOf(ref) === "point" ? [ref] : members.get(ref)!)
  const ends = (ref: string) => members.get(ref)!

  sketch.constraints.forEach((c, i) => {
    const label = `constraints[${i}] ${c.type}`
    try {
      for (const prim of translate(c)) add(label, prim)
    } catch (e) {
      throw new Error(`${name}, ${label}: ${(e as Error).message}`)
    }
  })

  function translate(c: Constraint): object[] {
    const ka = kindOf(c.a)
    const kb = "b" in c && c.b ? kindOf(c.b) : undefined
    const both = `${ka}+${kb}`
    const bad = (): never => {
      throw new Error(`doesn't apply to ${kb ? `a ${ka} and a ${kb}` : `a ${ka}`}`)
    }
    const b = "b" in c ? c.b! : ""
    switch (c.type) {
      case "coincident": {
        if (both === "point+point") return [{ type: "p2p_coincident", p1_id: c.a, p2_id: b }]
        const [p, other, kind] = ka === "point" ? [c.a, b, kb] : [b, c.a, ka]
        if (kb === "point" || ka === "point") {
          if (kind === "line") return [{ type: "point_on_line_pl", p_id: p, l_id: other }]
          if (kind === "circle") return [{ type: "point_on_circle", p_id: p, c_id: other }]
          if (kind === "arc") return [{ type: "point_on_arc", p_id: p, a_id: other }]
        }
        if (/^(circle|arc)\+(circle|arc)$/.test(both)) {
          return [{ type: "p2p_coincident", p1_id: `${c.a}.center`, p2_id: `${b}.center` }]
        }
        return bad()
      }
      case "horizontal":
      case "vertical":
        if (both === "line+undefined") return [{ type: `${c.type}_l`, l_id: c.a }]
        if (both === "point+point") return [{ type: `${c.type}_pp`, p1_id: c.a, p2_id: b }]
        return bad()
      case "parallel":
        return both === "line+line" ? [{ type: "parallel", l1_id: c.a, l2_id: b }] : bad()
      case "perpendicular":
        return both === "line+line" ? [{ type: "perpendicular_ll", l1_id: c.a, l2_id: b }] : bad()
      case "tangent": {
        if (both === "line+circle") return [{ type: "tangent_lc", l_id: c.a, c_id: b }]
        if (both === "circle+line") return [{ type: "tangent_lc", l_id: b, c_id: c.a }]
        if (both === "line+arc") return [{ type: "tangent_la", l_id: c.a, a_id: b }]
        if (both === "arc+line") return [{ type: "tangent_la", l_id: b, a_id: c.a }]
        if (both === "circle+circle") return [{ type: "tangent_cc", c1_id: c.a, c2_id: b }]
        if (both === "arc+arc") return [{ type: "tangent_aa", a1_id: c.a, a2_id: b }]
        if (both === "circle+arc") return [{ type: "tangent_ca", c_id: c.a, a_id: b }]
        if (both === "arc+circle") return [{ type: "tangent_ca", c_id: b, a_id: c.a }]
        return bad()
      }
      case "equal": {
        if (both === "line+line") return [{ type: "equal_length", l1_id: c.a, l2_id: b }]
        if (both === "circle+circle") return [{ type: "equal_radius_cc", c1_id: c.a, c2_id: b }]
        if (both === "circle+arc") return [{ type: "equal_radius_ca", c1_id: c.a, a2_id: b }]
        if (both === "arc+circle") return [{ type: "equal_radius_ca", c1_id: b, a2_id: c.a }]
        if (both === "arc+arc") return [{ type: "equal_radius_aa", a1_id: c.a, a2_id: b }]
        return bad()
      }
      case "midpoint": {
        if (both !== "point+line") return bad()
        const [p1, p2] = ends(b)
        return [{ type: "p2p_symmetric_ppp", p1_id: p1, p2_id: p2, p_id: c.a }]
      }
      case "symmetric": {
        if (both !== "point+point") return bad()
        const about = kindOf(c.about)
        if (about === "line") return [{ type: "p2p_symmetric_ppl", p1_id: c.a, p2_id: b, l_id: c.about }]
        if (about === "point") return [{ type: "p2p_symmetric_ppp", p1_id: c.a, p2_id: b, p_id: c.about }]
        throw new Error(`can't be symmetric about a ${about}`)
      }
      case "fix": {
        const fixed: object[] = pointsOf(c.a).flatMap((p) => {
          const [x, y] = initial.get(p) ?? [0, 0]
          return [{ type: "coordinate_x", p_id: p, x }, { type: "coordinate_y", p_id: p, y }]
        })
        const radius = ka === "circle" || ka === "arc" ? (geo.find((g) => g.id === c.a) as { radius: number }).radius : 0
        if (ka === "circle" || ka === "arc") fixed.push({ type: `${ka}_radius`, [`${ka[0]}_id`]: c.a, radius })
        return fixed
      }
      case "distance": {
        const value = num(c.value)
        const pts = both === "line+undefined" ? ends(c.a) : both === "point+point" ? [c.a, b] : undefined
        if (c.axis) {
          if (!pts) return bad()
          const [p1, p2] = pts
          return [{ type: "difference", param1: { o_id: p1, prop: c.axis }, param2: { o_id: p2, prop: c.axis }, difference: value }]
        }
        if (!(value > 0)) throw new Error(`distance must be positive (got ${value}); use axis for signed offsets`)
        if (pts) return [{ type: "p2p_distance", p1_id: pts[0], p2_id: pts[1], distance: value }]
        if (both === "point+line") return [{ type: "p2l_distance", p_id: c.a, l_id: b, distance: value }]
        if (both === "line+point") return [{ type: "p2l_distance", p_id: b, l_id: c.a, distance: value }]
        if (ka === "circle" || ka === "arc") throw new Error(`use radius or diameter, or measure from ${c.a}.center`)
        return bad()
      }
      case "angle": {
        const angle = num(c.value) * RAD
        if (both === "line+line") return [{ type: "l2l_angle_ll", l1_id: c.a, l2_id: b, angle }]
        if (both === "line+undefined") {
          const [p1, p2] = ends(c.a)
          return [{ type: "p2p_angle", p1_id: p1, p2_id: p2, angle }]
        }
        return bad()
      }
      case "radius":
      case "diameter": {
        const value = positive(c.value, c.type)
        if (ka !== "circle" && ka !== "arc") return bad()
        return [{ type: `${ka}_${c.type}`, [`${ka[0]}_id`]: c.a, [c.type]: value }]
      }
    }
  }

  gcs.clear_data()
  gcs.push_primitives_and_params([...geo, ...cons])
  const status = gcs.solve()
  const named = (ids: string[]) => [...new Set(ids.map((id) => labels.get(id) ?? id))]
  const conflicting = named(gcs.get_gcs_conflicting_constraints())
  if (conflicting.length) throw new Error(`${name} is over-constrained. Conflicting: ${conflicting.join("; ")}`)
  if (status === SolveStatus.Failed || status === SolveStatus.SuccessfulSolutionInvalid) {
    throw new Error(`${name} can't be solved; check its constraints and dimensions`)
  }
  gcs.apply_solution()
  const dof = gcs.gcs.dof()
  const redundant = named(gcs.get_gcs_redundant_constraints())
  const index = gcs.sketch_index

  const pt = (id: string): V2 => {
    const p = index.get_sketch_point(id)
    return [p.x, p.y]
  }
  const entities: SolvedEntity[] = sketch.entities.map((e): SolvedEntity => {
    const { id, construction } = e
    const base = construction ? { id, construction } : { id }
    if (e.type === "point") return { ...base, type: "point", at: pt(id) }
    if(e.type==="spline")return {...base,type:"spline",points:e.points.map((_,i)=>pt(`${id}.p${i}`)),closed:e.closed}
    if (e.type === "line") return { ...base, type: "line", start: pt(`${id}.start`), end: pt(`${id}.end`) }
    if (e.type === "circle") return { ...base, type: "circle", center: pt(`${id}.center`), radius: index.get_sketch_circle(id).radius }
    if (e.type === "arc") {
      const a = index.get_sketch_arc(id)
      return { ...base, type: "arc", center: pt(`${id}.center`), radius: a.radius, start: a.start_angle / RAD, end: a.end_angle / RAD }
    }
    return { ...base, type: "rectangle", corners: members.get(id)!.map(pt) as [V2, V2, V2, V2] }
  })

  const solved: SolvedSketch = {
    plane: frame??sketchFrame(sketch.plane, num(sketch.offset)),
    entities,
    dof,
    status: redundant.length ? "over" : dof > 0 ? "under" : "full",
    redundant,
  }

  return {
    solved,
    point(ref) {
      if (kindOf(ref) !== "point") throw new Error(`"${ref}" is a ${kindOf(ref)}, not a point`)
      return pt(ref)
    },
    line(ref) {
      if (kindOf(ref) !== "line") throw new Error(`"${ref}" is a ${kindOf(ref)}, not a line`)
      const [a, b] = ends(ref)
      return [pt(a!), pt(b!)]
    },
    points: () => entities.flatMap((e) => (e.type === "point" && !e.construction ? [e.at] : [])),
    profile: () => profile(name, entities),
  }
}

interface Segment {
  from: V2
  to: V2
  arc?: { center: V2; radius: number; start: number; sweep: number } // radians, counter-clockwise from start
  bezier?:{control1:V2;control2:V2}
}

const sample = (s: Segment, reverse: boolean): V2[] => {
  if(s.bezier)return Array.from({length:16},(_,i)=>cubicPoint({start:s.from,end:s.to,...s.bezier!},(reverse?16-i:i)/16))
  if (!s.arc) return [s.from]
  const { center: [cx, cy], radius, start, sweep } = s.arc
  return Array.from({ length: 16 }, (_, i) => {
    const t = start + (sweep * (reverse ? 16 - i : i)) / 16
    return [cx + radius * Math.cos(t), cy + radius * Math.sin(t)] as V2
  })
}

function inside([x, y]: V2, poly: V2[]) {
  let hit = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!
    const [xj, yj] = poly[j]!
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** Chain the sketch's curves into closed loops and combine them with the even-odd rule. */
function profile(name: string, entities: SolvedEntity[]): Drawing {
  const segments: Segment[] = []
  const loops: { drawing: Drawing; poly: V2[] }[] = []
  for (const e of entities) {
    if (e.construction) continue
    if (e.type === "line") segments.push({ from: e.start, to: e.end })
    if(e.type==="spline")for(const c of splineCurves(e.points,e.closed))segments.push({from:c.start,to:c.end,bezier:{control1:c.control1,control2:c.control2}})
    if (e.type === "rectangle") e.corners.forEach((c, i) => segments.push({ from: c, to: e.corners[(i + 1) % 4]! }))
    if (e.type === "circle") {
      const arc = { center: e.center, radius: e.radius, start: 0, sweep: 2 * Math.PI }
      const drawing = drawCircle(e.radius).translate(e.center[0], e.center[1])
      loops.push({ drawing, poly: sample({ from: e.center, to: e.center, arc }, false) })
    }
    if (e.type === "arc") {
      const [start, end] = [e.start * RAD, e.end * RAD]
      const sweep = (((end - start) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI
      const at = (t: number): V2 => [e.center[0] + e.radius * Math.cos(t), e.center[1] + e.radius * Math.sin(t)]
      segments.push({ from: at(start), to: at(start + sweep), arc: { center: e.center, radius: e.radius, start, sweep } })
    }
  }

  const nodes: V2[] = []
  const users: { seg: number; end: 0 | 1 }[][] = []
  const nodeOf = (p: V2) => {
    let i = nodes.findIndex((q) => dist(p, q) < 1e-4)
    if (i < 0) {
      i = nodes.push(p) - 1
      users.push([])
    }
    return i
  }
  const segNodes = segments.map((s, seg) => {
    const ends = [nodeOf(s.from), nodeOf(s.to)] as const
    users[ends[0]]!.push({ seg, end: 0 })
    users[ends[1]]!.push({ seg, end: 1 })
    return ends
  })
  users.forEach((u, i) => {
    if (u.length === 2) return
    if (u.length === 1) {
      throw new Error(`${name} has an open profile at ${fmt(nodes[i]!)}. Close it, or mark open geometry as construction`)
    }
    throw new Error(`${name}: ${u.length} curves meet at ${fmt(nodes[i]!)}. Profiles must be simple closed loops`)
  })

  const used = new Set<number>()
  for (let first = 0; first < segments.length; first++) {
    if (used.has(first)) continue
    let seg = first
    let reverse = false
    const s0 = segments[first]!
    const pen = draw(s0.from)
    const poly: V2[] = []
    for (;;) {
      used.add(seg)
      const s = segments[seg]!
      const to = reverse ? s.from : s.to
      poly.push(...sample(s, reverse))
      if(s.bezier)pen.bezierCurveTo(to,reverse?[s.bezier.control2,s.bezier.control1]:[s.bezier.control1,s.bezier.control2])
      else if (s.arc) {
        const mid = s.arc.start + s.arc.sweep / 2
        pen.threePointsArcTo(to, [s.arc.center[0] + s.arc.radius * Math.cos(mid), s.arc.center[1] + s.arc.radius * Math.sin(mid)])
      } else pen.lineTo(to)
      const node: number = segNodes[seg]![reverse ? 0 : 1]
      const next: { seg: number; end: 0 | 1 } = users[node]!.find((u) => u.seg !== seg) ?? users[node]![0]!
      if (next.seg === first) break
      seg = next.seg
      reverse = next.end === 1
    }
    loops.push({ drawing: pen.close(), poly })
  }
  if (!loops.length) throw new Error(`${name} has no closed profile`)

  const depth = loops.map((l, i) => loops.filter((o, j) => j !== i && inside(l.poly[0]!, o.poly)).length)
  const order = loops.map((_, i) => i).sort((a, b) => depth[a]! - depth[b]!)
  let result: Drawing | undefined
  for (const i of order) {
    const d = loops[i]!.drawing
    result = !result ? d : depth[i]! % 2 ? result.cut(d) : result.fuse(d)
  }
  return result!
}
