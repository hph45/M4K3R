import { z } from "zod"

const Coordinate=z.number().finite().transform(n=>n===0?0:n)
export const Vector = z.tuple([Coordinate,Coordinate,Coordinate])
export const Source = z.discriminatedUnion("type", [
  z.object({ type: z.literal("component"), component: z.string() }),
  z.object({ type: z.literal("cad"), doc: z.string(), body: z.string().optional() }),
  z.object({ type: z.literal("pcb"), doc: z.string() }),
])
export const Anchor = z.union([z.string(), Vector]).describe("Mounting-hole id, origin/center/top/bottom, or a local point in mm")
export const Mount = z.object({
  target: z.string(), sourceAnchor: Anchor.default("origin"), targetAnchor: Anchor.default("origin"),
  distance: z.number().default(0).describe("Spacing along the target anchor axis, in mm"),
  twist: z.number().default(0).describe("Rotation about the mounting axis, in degrees"),
  flip: z.boolean().default(false).describe("Reverse the source anchor axis"),
})
export const Instance = z.object({
  id: z.string().regex(/^[A-Za-z_][\w-]*$/), source: Source, name: z.string().optional(),
  position: Vector.default([0, 0, 0]), rotation: Vector.default([0, 0, 0]).describe("Euler degrees, local X then Y then Z"),
  fixed: z.boolean().default(false), visible: z.boolean().default(true), mount: Mount.optional(),
})
export const Assembly = z.object({ instances: z.array(Instance).default([]) }).superRefine((data, ctx) => {
  const ids = new Set<string>(); const components = new Set<string>()
  data.instances.forEach((item, i) => {
    if (ids.has(item.id)) ctx.addIssue({ code: "custom", message: `Duplicate instance ${item.id}`, path: ["instances", i] })
    ids.add(item.id)
    if (item.source.type === "component") {
      if (components.has(item.source.component)) ctx.addIssue({ code: "custom", message: `Component ${item.source.component} is already placed`, path: ["instances", i] })
      components.add(item.source.component)
    }
  })
  for (const item of data.instances) {
    const seen = new Set([item.id]); let next = item.mount?.target
    while (next) {
      if (seen.has(next)) { ctx.addIssue({ code: "custom", message: `Mount cycle at ${item.id}` }); break }
      seen.add(next)
      const parent = data.instances.find((i) => i.id === next)
      if (!parent) { ctx.addIssue({ code: "custom", message: `Missing mount target ${next}` }); break }
      next = parent.mount?.target
    }
  }
})
export type V3 = z.infer<typeof Vector>
export type Source = z.infer<typeof Source>
export type Instance = z.infer<typeof Instance>
export type Assembly = z.infer<typeof Assembly>
export type Mount = z.infer<typeof Mount>
