import { evaluate, variableLookup, type Variable } from "@m4k3r/core"
import { makeCylinder, measureVolume, Plane, type Drawing, type Shape3D } from "replicad"
import { loadKernel } from "./kernel"
import { HOLE_SIZES, PartStudio, type Expr, type Feature } from "./schema"
import { axis, selectEdges, selectFaces } from "./select"
import { sketchFrame, solveSketch, toWorld, type Frame, type SketchSolution, type SolvedSketch, type V2, type V3 } from "./sketch"

export interface Body {
  /** Id of the feature that created it */
  id: string
  shape: Shape3D
}

export interface FeatureStatus {
  id: string
  type: Feature["type"]
  status: "ok" | "error" | "suppressed" | "skipped"
  error?: string
  sketch?: SolvedSketch
}

export interface Evaluation {
  features: FeatureStatus[]
  /** Bodies after the last evaluated feature (just before the failing one, if any) */
  bodies: Body[]
  /** The first failing feature. Evaluation stops there. */
  error?: { feature: string; message: string }
}

export interface EvaluateOptions {
  /** Roll back: stop after this feature */
  until?: string
}

type Op = "add" | "subtract" | "intersect"

const cache = new Map<string, Promise<Evaluation>>()
const CACHE_SIZE = 16

/** Evaluate a part studio's feature list into bodies. Results are cached by (data, variables, options). */
export function evaluateStudio(data: unknown, variables: Variable[] = [], options: EvaluateOptions = {}): Promise<Evaluation> {
  const key = JSON.stringify([data, variables, options])
  let result = cache.get(key)
  if (result) {
    cache.delete(key)
  } else {
    result = run(PartStudio.parse(data), variables, options)
    result.catch(() => cache.delete(key))
    if (cache.size >= CACHE_SIZE) cache.delete(cache.keys().next().value!)
  }
  cache.set(key, result)
  return result
}

const add3 = (a: V3, b: V3, s = 1): V3 => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]
const planeOf = (f: Frame, shift = 0) => new Plane(add3(f.origin, f.normal, shift), f.xDir, f.normal)
const message = (e: unknown) => (e instanceof Error ? e.message : `OpenCascade error ${String(e)}`)

/** Run a kernel operation, turning OpenCascade failures into a readable message. */
function occ<T>(fn: () => T, failure: string): T {
  try {
    return fn()
  } catch (e) {
    throw new Error(`${failure} (${message(e)})`)
  }
}

async function run(data: PartStudio, variables: Variable[], options: EvaluateOptions): Promise<Evaluation> {
  const gcs = await loadKernel()
  const lookup = variableLookup(variables)
  const num = (e: Expr) => evaluate(e, lookup)
  const positive = (e: Expr, what: string) => {
    const v = num(e)
    if (!(v > 0)) throw new Error(`${what} must be positive (got ${v})`)
    return v
  }
  const sketches = new Map<string, SketchSolution>()
  const tools = new Map<string, { tool: Shape3D; op: Op; body: string }>()
  let bodies: Body[] = []
  const features: FeatureStatus[] = []
  let error: Evaluation["error"]
  let stopped = false

  const sketchOf = (id: string) => {
    const s = sketches.get(id)
    if (!s) throw new Error(`No sketch "${id}" before this feature${data.features.some((f) => f.id === id) ? " (or it's suppressed)" : ""}`)
    return s
  }
  const bodyOf = (id?: string): Body => {
    if (id) {
      const b = bodies.find((b) => b.id === id)
      if (!b) throw new Error(`No body "${id}" (bodies: ${bodies.map((b) => b.id).join(", ") || "none"})`)
      return b
    }
    if (bodies.length === 1) return bodies[0]!
    if (!bodies.length) throw new Error("There is no body yet; the first solid feature must create one")
    throw new Error(`Several bodies (${bodies.map((b) => b.id).join(", ")}); set "body"`)
  }
  /** Length that reaches past every body from the given plane */
  const throughAll = (f: Frame) => {
    if (!bodies.length) throw new Error("Through all needs an existing body")
    let reach = 0
    for (const b of bodies) {
      const [min, max] = b.shape.boundingBox.bounds
      for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
        reach = Math.max(reach, Math.hypot(x - f.origin[0], y - f.origin[1], z - f.origin[2]))
      }
    }
    return reach + 1
  }
  const volume = (s: Shape3D) => measureVolume(s)
  const apply = (op: Op, tool: Shape3D, target: Body, what = "This feature") => {
    if (op === "add") target.shape = occ(() => target.shape.fuse(tool), "Union failed")
    else if (op === "subtract") {
      const before = volume(target.shape)
      target.shape = occ(() => target.shape.cut(tool), "Cut failed")
      if (before - volume(target.shape) < 1e-6 * Math.max(before, 1)) {
        throw new Error(`${what} removes no material from body "${target.id}"; check its position and direction`)
      }
    } else {
      target.shape = occ(() => target.shape.intersect(tool), "Intersect failed")
      if (volume(target.shape) < 1e-9) throw new Error(`${what} leaves nothing of body "${target.id}"`)
    }
  }
  /** Extrude/revolve/hole: create, add, subtract or intersect, and remember the tool for patterns. */
  const solid = (f: Feature, tool: Shape3D, op: "new" | Op | undefined, body?: string) => {
    op ??= bodies.length ? "add" : "new"
    if (op === "new") {
      bodies.push({ id: f.id, shape: tool })
      tools.set(f.id, { tool, op: "add", body: f.id })
    } else {
      const target = bodyOf(body)
      apply(op, tool, target)
      tools.set(f.id, { tool, op, body: target.id })
    }
  }
  const onPlane = (profile: Drawing, plane: Plane) => profile.sketchOnPlane(plane) as unknown as {
    extrude(d: number): Shape3D
    revolve(axis: V3, o: { origin: V3; angle: number }): Shape3D
  }

  /** Copies for patterns and mirrors: each transform applied to the listed features' tools, or to a whole body. */
  const copy = (
    f: Extract<Feature, { features?: string[] }>,
    transforms: ((s: Shape3D) => Shape3D)[],
  ) => {
    if (f.features) {
      for (const id of f.features) {
        const t = tools.get(id)
        if (!t) throw new Error(`"${id}" can't be repeated; only extrude, revolve and hole features can (or set body)`)
        transforms.forEach((move, i) => apply(t.op, move(t.tool.clone()), bodyOf(t.body), `Copy ${i + 1} of "${id}"`))
      }
    } else if (f.body) {
      const b = bodyOf(f.body)
      const source = b.shape
      for (const move of transforms) b.shape = occ(() => b.shape.fuse(move(source.clone())), "Union failed")
    } else throw new Error("Set features or body")
  }

  const step: { [K in Feature["type"]]: (f: Extract<Feature, { type: K }>) => void } = {
    sketch(f) {
      let frame:Frame|undefined
      if(f.face) {
        const body=bodyOf(f.face.body);const faces=selectFaces(body.shape,f.face.query,num)
        if(faces.length!==1||faces[0]!.geomType!=="PLANE")throw new Error("Select exactly one planar face for this sketch")
        const face=faces[0]!;const n=face.normalAt();const normal:V3=[n.x,n.y,n.z];const p=face.center
        const reference:V3=Math.abs(normal[0])<.9?[1,0,0]:[0,1,0]
        const dot=reference.reduce((sum,v,i)=>sum+v*normal[i]!,0);const tangent=reference.map((v,i)=>v-dot*normal[i]!) as V3
        const length=Math.hypot(...tangent);const xDir=tangent.map(v=>v/length) as V3
        const yDir:V3=[normal[1]*xDir[2]-normal[2]*xDir[1],normal[2]*xDir[0]-normal[0]*xDir[2],normal[0]*xDir[1]-normal[1]*xDir[0]]
        frame={origin:add3([p.x,p.y,p.z],normal,num(f.offset)),xDir,yDir,normal}
      }
      sketches.set(f.id, solveSketch(gcs, f, num,frame))
    },
    extrude(f) {
      const sk = sketchOf(f.sketch)
      const frame = sk.solved.plane
      if (f.through === undefined && f.depth === undefined) throw new Error("Set depth, or through: true")
      const depth = f.through ? throughAll(frame) : positive(f.depth!, "depth")
      const [start, length] = f.symmetric ? [f.through ? -depth : -depth / 2, f.through ? 2 * depth : depth] : [f.reverse ? -depth : 0, depth]
      const profile = sk.profile()
      const tool = occ(() => onPlane(profile, planeOf(frame, start)).extrude(length), "Extrude failed")
      solid(f, tool, f.op, f.body)
    },
    revolve(f) {
      const sk = sketchOf(f.sketch)
      const frame = sk.solved.plane
      const [p1, p2]: [V2, V2] = f.axis === "x" ? [[0, 0], [1, 0]] : f.axis === "y" ? [[0, 0], [0, 1]] : sk.line(f.axis)
      const [a, b] = [toWorld(frame, p1), toWorld(frame, p2)]
      const angle = num(f.angle)
      if (!(angle > 0 && angle <= 360)) throw new Error(`angle must be in (0, 360] (got ${angle})`)
      const profile = sk.profile()
      const tool = occ(
        () => onPlane(profile, planeOf(frame)).revolve(add3(b, a, -1), { origin: a, angle }),
        "Revolve failed; the profile must not cross the axis",
      )
      solid(f, tool, f.op, f.body)
    },
    fillet(f) {
      const b = bodyOf(f.body)
      const edges = selectEdges(b.shape, f.edges, num)
      const r = positive(f.radius, "radius")
      b.shape = occ(() => b.shape.fillet(r, (e) => e.inList(edges)), "Fillet failed; the radius may be too large for the selected edges")
    },
    chamfer(f) {
      const b = bodyOf(f.body)
      const edges = selectEdges(b.shape, f.edges, num)
      const d = positive(f.distance, "distance")
      b.shape = occ(() => b.shape.chamfer(d, (e) => e.inList(edges)), "Chamfer failed; the distance may be too large for the selected edges")
    },
    shell(f) {
      const b = bodyOf(f.body)
      const faces = f.faces ? selectFaces(b.shape, f.faces, num) : []
      const t = positive(f.thickness, "thickness")
      b.shape = occ(() => b.shape.shell(t, (q) => q.inList(faces)), "Shell failed; the thickness may be too large")
    },
    hole(f) {
      const sk = sketchOf(f.sketch)
      const frame = sk.solved.plane
      const centers = f.points ? f.points.map((p) => sk.point(p)) : sk.points()
      if (!centers.length) throw new Error(`Sketch "${f.sketch}" has no points; add point entities or list points`)
      if (!f.size && f.diameter === undefined) throw new Error("Set size (e.g. M3) or diameter")
      const diameter = f.size ? HOLE_SIZES[f.size][f.fit] : positive(f.diameter!, "diameter")
      if (!f.through && f.depth === undefined) throw new Error("Set depth, or through: true")
      const dir = f.reverse ? frame.normal : (frame.normal.map((v) => -v) as V3)
      const reach = f.through ? throughAll(frame) : positive(f.depth!, "depth")
      const cylinders = centers.flatMap((c) => {
        const at = toWorld(frame, c)
        const hole = f.through
          ? makeCylinder(diameter / 2, 2 * reach, add3(at, dir, -reach), dir)
          : makeCylinder(diameter / 2, reach, at, dir)
        const cb = f.counterbore
        return cb ? [hole, makeCylinder(positive(cb.diameter, "counterbore diameter") / 2, positive(cb.depth, "counterbore depth"), at, dir)] : [hole]
      })
      const tool = cylinders.reduce((a, c) => a.fuse(c) as never)
      solid(f, tool, "subtract", f.body)
    },
    linearPattern(f) {
      const d = axis(f.direction)
      const spacing = num(f.spacing)
      copy(f, Array.from({ length: f.count - 1 }, (_, i) => (s: Shape3D) => s.translate(d.map((v) => v * spacing * (i + 1)) as V3)))
    },
    circularPattern(f) {
      const total = num(f.angle)
      const step = Math.abs(total) >= 360 ? total / f.count : total / (f.count - 1)
      const center = f.center.map(num) as V3
      const dir = axis(f.axis)
      copy(f, Array.from({ length: f.count - 1 }, (_, i) => (s: Shape3D) => s.rotate(step * (i + 1), center, dir)))
    },
    mirror(f) {
      const frame = sketchFrame(f.plane, num(f.offset))
      copy(f, [(s) => s.mirror(planeOf(frame))])
    },
    boolean(f) {
      const target = bodyOf(f.target)
      if (f.tools.includes(f.target)) throw new Error("A body can't be a tool for itself")
      const others = f.tools.map(bodyOf)
      const op = ({ union: "add", subtract: "subtract", intersect: "intersect" } as const)[f.op]
      for (const t of others) apply(op, t.shape, target, `Body "${t.id}"`)
      if (!f.keepTools) bodies = bodies.filter((b) => !f.tools.includes(b.id))
    },
  }

  for (const f of data.features) {
    const status: FeatureStatus = { id: f.id, type: f.type, status: "ok" }
    features.push(status)
    if (stopped) status.status = "skipped"
    else if (f.suppressed) status.status = "suppressed"
    else {
      // Kernel operations return new shapes, so retaining these references is enough
      // to restore the model when a later operation in the same feature fails.
      const previousBodies = bodies.map((body) => ({ ...body }))
      try {
        ;(step[f.type] as (f: Feature) => void)(f)
        if (f.type === "sketch") status.sketch = sketches.get(f.id)!.solved
      } catch (e) {
        bodies = previousBodies
        status.status = "error"
        status.error = message(e)
        error = { feature: f.id, message: status.error }
        stopped = true
      }
    }
    if (f.id === options.until) stopped = true
  }
  return { features, bodies, error }
}
