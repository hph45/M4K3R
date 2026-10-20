import { CommandError, defineCommand, findDoc, type Project } from "@m4k3r/core"
import { z } from "zod"
import { Feature, FeatureInput, Id, Material, SketchFeature, type PartStudio } from "./schema"
import { Template,templateStudio } from "./templates"

const doc = z.string().describe("Part studio id or name")
const before = Id.optional().describe("Insert before this feature (default: at the end)")

const studio = (p: Project, key: string) => findDoc(p, key, "part-studio").data as PartStudio

const indexOf = (s: PartStudio, id: string) => {
  const i = s.features.findIndex((f) => f.id === id)
  if (i < 0) throw new CommandError(`No feature "${id}" (features: ${s.features.map((f) => f.id).join(", ") || "none"})`)
  return i
}

/** Every reference must point at an earlier feature. */
function checkRefs(s: PartStudio) {
  const seen = new Set<string>()
  for (const f of s.features) {
    const refs = [
      "sketch" in f ? f.sketch : undefined,
      "body" in f ? f.body : undefined,
      f.type==="sketch"?f.face?.body:undefined,
      ...("features" in f ? (f.features ?? []) : []),
      ...(f.type === "boolean" ? [f.target, ...f.tools] : []),
    ]
    for (const ref of refs) {
      if (ref !== undefined && !seen.has(ref)) throw new CommandError(`"${f.id}" uses "${ref}", which must be an earlier feature`)
    }
    seen.add(f.id)
  }
}

function insert(s: PartStudio, input: FeatureInput, at?: string) {
  let id = input.id
  for (let n = 1; !id; n++) if (!s.features.some((f) => f.id === `${input.type}${n}`)) id = `${input.type}${n}`
  if (s.features.some((f) => f.id === id)) throw new CommandError(`Feature "${id}" exists`)
  const feature = Feature.parse({ ...input, id })
  s.features.splice(at ? indexOf(s, at) : s.features.length, 0, feature)
  checkRefs(s)
  return { id }
}

export const cadCommands = [
  defineCommand({
    type:"cad.template.create",summary:"Create an editable parametric plate, L bracket, mount or quadcopter frame with real mounting holes. All dimensions accept project-variable expressions; generated features remain individually editable and exportable.",
    args:Template.extend({name:z.string().min(1)}),
    run(p,{name,...template},ctx) {
      if(p.docs.some((d)=>d.name===name))throw new CommandError(`A doc named "${name}" exists`)
      const id=ctx.newId("d");p.docs.push({id,kind:"part-studio",name,data:templateStudio(template)});return {id}
    },
  }),
  defineCommand({
    type: "cad.feature.add",
    summary:
      "Add a feature to a part studio: sketch, extrude, revolve, fillet, chamfer, shell, hole, linearPattern, " +
      "circularPattern, mirror or boolean. Lengths in mm, angles in degrees; any number can be an expression over variables.",
    args: z.object({ doc, feature: FeatureInput, before }),
    run(p, { doc, feature, before }) {
      return insert(studio(p, doc), feature, before)
    },
  }),

  defineCommand({
    type: "cad.sketch.add",
    summary:
      "Add a sketch: entities (point, line, circle, arc, rectangle) on a plane, with optional constraints. " +
      "Closed loops become profiles; points drawn at the same spot are joined.",
    args: SketchFeature.omit({ type: true, id: true }).extend({ doc, id: Id.optional(), before }),
    run(p, { doc, before, ...sketch }) {
      return insert(studio(p, doc), { ...sketch, type: "sketch" }, before)
    },
  }),

  defineCommand({
    type: "cad.feature.update",
    summary: "Change fields of a feature. A null value removes an optional field.",
    args: z.object({ doc, feature: Id, set: z.record(z.string(), z.unknown()) }),
    run(p, { doc, feature, set }) {
      const s = studio(p, doc)
      const i = indexOf(s, feature)
      if ("id" in set || "type" in set) throw new CommandError("id and type can't change; add a new feature instead")
      const merged: Record<string, unknown> = { ...s.features[i] }
      for (const [k, v] of Object.entries(set)) {
        if (v === null) delete merged[k]
        else merged[k] = v
      }
      const parsed = Feature.safeParse(merged)
      if (!parsed.success) throw new CommandError(z.prettifyError(parsed.error))
      s.features[i] = parsed.data
      checkRefs(s)
      return { id: feature }
    },
  }),

  defineCommand({
    type: "cad.feature.remove",
    summary: "Remove a feature. Features that use it must be removed or changed first.",
    args: z.object({ doc, feature: Id }),
    run(p, { doc, feature }) {
      const s = studio(p, doc)
      s.features.splice(indexOf(s, feature), 1)
      checkRefs(s)
    },
  }),

  defineCommand({
    type: "cad.feature.move",
    summary: "Reorder a feature: move it before another one, or to the end",
    args: z.object({ doc, feature: Id, before }),
    run(p, { doc, feature, before }) {
      const s = studio(p, doc)
      const [f] = s.features.splice(indexOf(s, feature), 1)
      s.features.splice(before ? indexOf(s, before) : s.features.length, 0, f!)
      checkRefs(s)
    },
  }),

  defineCommand({
    type: "cad.material.set",
    summary: "Set the part studio's material, which sets the density used for mass",
    args: z.object({ doc, material: Material }),
    run(p, { doc, material }) {
      studio(p, doc).material = material
    },
  }),
]
