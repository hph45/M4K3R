import { checkExpr } from "@m4k3r/core"
import { z } from "zod"

export const Expr = z
  .union([
    z.number(),
    z.string().superRefine((s, ctx) => {
      const error = checkExpr(s)
      if (error) ctx.addIssue({ code: "custom", message: error })
    }),
  ])
  .describe('Number or expression in mm / degrees, e.g. 20, "3 mm", "pcb_w + 2*wall"')

export const Id = z.string().regex(/^[A-Za-z_][\w-]*$/, "letters, digits, _ and -")
const P2 = z.tuple([Expr, Expr])
const P3 = z.tuple([Expr, Expr, Expr])
const Ref = z.string().describe('Sketch reference: an entity id, a sub-reference ("l1.start", "r1.top", "c1.center") or "origin"')

export const PlaneName = z.enum(["XY", "XZ", "YZ"]).describe("XY = top (normal +Z), XZ = front (normal -Y), YZ = right (normal +X)")
export const Axis = z
  .union([z.enum(["x", "y", "z", "-x", "-y", "-z"]), z.tuple([z.number(), z.number(), z.number()])])
  .describe('"x", "-z", or a vector [x, y, z]')

const construction = z.boolean().optional().describe("Reference geometry, excluded from profiles")

export const Entity = z.discriminatedUnion("type", [
  z.object({type:z.literal("spline"),id:Id,points:z.array(P2).min(2).max(100),closed:z.boolean().default(false),construction}).describe("Interpolating cubic spline; control references id.p0, id.p1… may be constrained"),
  z.object({ type: z.literal("point"), id: Id, at: P2, construction }),
  z.object({ type: z.literal("line"), id: Id, start: P2, end: P2, construction }),
  z.object({ type: z.literal("circle"), id: Id, center: P2, radius: Expr, construction }),
  z
    .object({
      type: z.literal("arc"), id: Id, center: P2, radius: Expr,
      start: Expr.describe("Start angle (deg)"), end: Expr.describe("End angle (deg), counter-clockwise from start"),
      construction,
    })
    .describe("Refs: id.center, id.start, id.end"),
  z
    .object({
      type: z.literal("rectangle"), id: Id, width: Expr, height: Expr,
      center: P2.optional(), corner: P2.optional().describe("Lower-left corner; default is centered on the origin"),
      construction,
    })
    .describe("Refs: lines id.bottom/right/top/left, corners id.bl/br/tr/tl"),
])

const pair = { a: Ref, b: Ref }
export const Constraint = z.discriminatedUnion("type", [
  z.object({ type: z.literal("coincident"), ...pair }).describe("Point on point, or point on line/circle/arc"),
  z.object({ type: z.literal("horizontal"), a: Ref, b: Ref.optional() }).describe("A line, or two points"),
  z.object({ type: z.literal("vertical"), a: Ref, b: Ref.optional() }),
  z.object({ type: z.literal("parallel"), ...pair }),
  z.object({ type: z.literal("perpendicular"), ...pair }),
  z.object({ type: z.literal("tangent"), ...pair }),
  z.object({ type: z.literal("equal"), ...pair }).describe("Equal length (lines) or radius (circles, arcs)"),
  z.object({ type: z.literal("midpoint"), a: Ref.describe("point"), b: Ref.describe("line") }),
  z.object({ type: z.literal("symmetric"), ...pair, about: Ref.describe("line or point") }),
  z.object({ type: z.literal("fix"), a: Ref }),
  z
    .object({ type: z.literal("distance"), a: Ref, b: Ref.optional(), value: Expr, axis: z.enum(["x", "y"]).optional() })
    .describe("Line length, point-point or point-line distance. axis: signed b - a along x or y"),
  z.object({ type: z.literal("angle"), a: Ref, b: Ref.optional(), value: Expr }).describe("Line to x axis, or line to line (deg)"),
  z.object({ type: z.literal("radius"), a: Ref, value: Expr }),
  z.object({ type: z.literal("diameter"), a: Ref, value: Expr }),
])

const at = { x: Expr.optional(), y: Expr.optional(), z: Expr.optional() }
export const EdgeQuery = z
  .object({
    direction: Axis.optional().describe("Straight edges parallel to this axis"),
    ...at,
    type: z.enum(["line", "circle"]).optional(),
    near: P3.optional().describe("A picked edge: the one passing through this point"),
  })
  .describe("All given conditions must hold. x/y/z: edges lying entirely at that coordinate")
export const FaceQuery = z
  .object({
    normal: z.enum(["+x", "-x", "+y", "-y", "+z", "-z"]).optional().describe("Planar faces with this outward normal"),
    ...at,
    type: z.enum(["plane", "cylinder"]).optional(),
    near: P3.optional().describe("A picked face: the one containing this point"),
  })
  .describe("All given conditions must hold. x/y/z: planar faces lying at that coordinate")
export const Edges = z.union([z.literal("all"), EdgeQuery, z.array(EdgeQuery).min(1)]).describe("A query, or a list (union)")
export const Faces = z.union([FaceQuery, z.array(FaceQuery).min(1)])

const Op = z.enum(["new", "add", "subtract", "intersect"]).describe("Default: new for the first body, then add")
const common = {
  id: Id,
  suppressed: z.boolean().optional(),
}
const body = Id.optional().describe("Target body (the id of the feature that created it). Needed only when there are several")
const source = {
  features: z.array(Id).min(1).optional().describe("Repeat these features (extrude, revolve, hole)"),
  body: Id.optional().describe("Or copy this whole body"),
}

export const HOLE_SIZES = {
  M2: { clearance: 2.4, tap: 1.6 },
  "M2.5": { clearance: 2.9, tap: 2.05 },
  M3: { clearance: 3.4, tap: 2.5 },
  M4: { clearance: 4.5, tap: 3.3 },
  M5: { clearance: 5.5, tap: 4.2 },
  M6: { clearance: 6.6, tap: 5 },
} as const

const featureTypes = [
  z.object({
    ...common, type: z.literal("sketch"),
    plane: PlaneName.default("XY"), offset: Expr.default(0).describe("Along the plane normal"),
    face:z.object({body:Id.optional(),query:FaceQuery}).optional().describe("Sketch on one planar face of an earlier body; selected by stable geometric query or picked near point"),
    entities: z.array(Entity).default([]),
    constraints: z.array(Constraint).default([]),
  }),
  z.object({
    ...common, type: z.literal("extrude"), sketch: Id, op: Op.optional(), body,
    depth: Expr.optional(), through: z.boolean().optional().describe("Through all, instead of depth"),
    symmetric: z.boolean().optional(), reverse: z.boolean().optional().describe("Extrude against the sketch normal"),
  }),
  z.object({
    ...common, type: z.literal("revolve"), sketch: Id, op: Op.optional(), body,
    axis: z.string().describe('"x" or "y" sketch axis, or a line entity id in the sketch'),
    angle: Expr.default(360),
  }),
  z.object({ ...common, type: z.literal("fillet"), body, edges: Edges, radius: Expr }),
  z.object({ ...common, type: z.literal("chamfer"), body, edges: Edges, distance: Expr }),
  z.object({
    ...common, type: z.literal("shell"), body, thickness: Expr.describe("Wall thickness, inward"),
    faces: Faces.optional().describe("Faces to remove (open). None = hollow closed body"),
  }),
  z.object({
    ...common, type: z.literal("hole"), sketch: Id, body,
    points: z.array(Ref).min(1).optional().describe("Hole centers. Default: every non-construction point in the sketch"),
    size: z.enum(Object.keys(HOLE_SIZES) as [keyof typeof HOLE_SIZES]).optional(),
    fit: z.enum(["clearance", "tap"]).default("clearance"),
    diameter: Expr.optional().describe("Instead of size"),
    depth: Expr.optional(), through: z.boolean().optional(),
    reverse: z.boolean().optional().describe("Holes drill against the sketch normal; reverse drills along it"),
    counterbore: z.object({ diameter: Expr, depth: Expr }).optional(),
  }),
  z.object({
    ...common, type: z.literal("linearPattern"), ...source,
    direction: Axis, count: z.number().int().min(2), spacing: Expr,
  }),
  z.object({
    ...common, type: z.literal("circularPattern"), ...source,
    axis: Axis, center: P3.default([0, 0, 0]), count: z.number().int().min(2),
    angle: Expr.default(360).describe("Total angle; 360 spreads copies evenly"),
  }),
  z.object({ ...common, type: z.literal("mirror"), ...source, plane: PlaneName, offset: Expr.default(0) }),
  z.object({
    ...common, type: z.literal("boolean"), op: z.enum(["union", "subtract", "intersect"]),
    target: Id, tools: z.array(Id).min(1), keepTools: z.boolean().optional(),
  }),
] as const

export const SketchFeature = featureTypes[0]
export const Feature = z.discriminatedUnion("type", featureTypes)
const optionalId = { id: Id.optional().describe("Defaults to type + number, e.g. extrude2") }
/** A feature as commands accept it: the id is optional. */
export const FeatureInput = z.discriminatedUnion(
  "type",
  featureTypes.map((t) => t.extend(optionalId)) as unknown as typeof featureTypes,
)

export const MATERIALS = { PLA: 1.24, PETG: 1.27, ABS: 1.04, ASA: 1.07, TPU: 1.21, aluminum: 2.7, steel: 7.85 } as const
export const Material = z.enum(Object.keys(MATERIALS) as [keyof typeof MATERIALS])

export const PartStudio = z.object({
  features: z.array(Feature).default([]),
  material: Material.default("PLA").describe("Sets density (g/cm³) for mass"),
})

export type Expr = z.infer<typeof Expr>
export type Entity = z.infer<typeof Entity>
export type Constraint = z.infer<typeof Constraint>
export type EdgeQuery = z.infer<typeof EdgeQuery>
export type FaceQuery = z.infer<typeof FaceQuery>
export type Feature = z.infer<typeof Feature>
type In = z.input<typeof Feature>
/** A feature as written by hand: defaults and the id are optional. */
export type FeatureInput = In extends infer F ? (F extends In ? Omit<F, "id"> & { id?: string } : never) : never
export type Sketch = Extract<Feature, { type: "sketch" }>
export type Material = z.infer<typeof Material>
export type PartStudio = z.infer<typeof PartStudio>
