import { CommandError, defineCommand, evaluate, findComponent, findDoc, variableLookup, type Project } from "@m4k3r/core"
import { z } from "zod"
import { Assembly, Instance, Mount, Source, Vector, type Source as SourceType } from "./schema"
import { validateCircularDimensions } from "./dimensions"
const docKey = z.string().describe("Assembly document id or name")
const studio = (p: Project, doc: string) => findDoc(p, doc, "assembly")
const dataOf = (p: Project, doc: string) => studio(p, doc).data as Assembly
const instanceOf = (data: Assembly, id: string) => {
  const item = data.instances.find((i) => i.id === id)
  if (!item) throw new CommandError(`No assembly instance "${id}"`)
  return item
}
function normalizeSource(p: Project, source: SourceType): SourceType {
  if (source.type === "component") return { ...source, component: findComponent(p, source.component).id }
  const doc = findDoc(p, source.doc, source.type === "cad" ? "part-studio" : "pcb")
  return { ...source, doc: doc.id }
}
function validate(p: Project, key: string) {
  const doc = studio(p, key)
  const parsed = Assembly.safeParse(doc.data)
  if (!parsed.success) throw new CommandError(z.prettifyError(parsed.error))
  doc.data = parsed.data
}
export const assemblyCommands = [
  defineCommand({
    type: "assembly.component.configure", summary: "Configure a physical part family on its existing project component: size XYZ mm, mass g, and mounting-hole diameter. Expressions may reference project variables. Overrides live in component properties, preserving catalog and BOM identity.",
    args: z.object({ component:z.string(),size:z.tuple([z.union([z.number(),z.string()]),z.union([z.number(),z.string()]),z.union([z.number(),z.string()])]).optional(),mass:z.union([z.number(),z.string()]).optional(),holeDiameter:z.union([z.number(),z.string()]).optional(),reset:z.boolean().optional() }),
    run(p,{component,size,mass,holeDiameter,reset}) {
      const item=findComponent(p,component); const lookup=variableLookup(p.variables)
      const set=(key:string,value:number|string,positive:boolean)=>{ const n=evaluate(value,lookup);if(!Number.isFinite(n)||(positive?n<=0:n<0))throw new CommandError(`${key} must be ${positive?"positive":"nonnegative"}`);item.props[`physical.${key}`]=String(value) }
      if(reset)for(const key of Object.keys(item.props))if(key.startsWith("physical."))delete item.props[key]
      size?.forEach((v,i)=>set(`size.${["x","y","z"][i]}`,v,true))
      if(mass!==undefined)set("mass",mass,false)
      if(holeDiameter!==undefined)set("holeDiameter",holeDiameter,true)
      const physical=p.parts[item.part]?.physical
      if(physical)validateCircularDimensions(physical.geometry.type,physical.size.map((fallback,i)=>item.props[`physical.size.${["x","y","z"][i]}`]===undefined?fallback:evaluate(item.props[`physical.size.${["x","y","z"][i]}`]!,lookup)),item.ref)
      return {id:item.id}
    },
  }),
  defineCommand({
    type: "assembly.instance.add", summary: "Place an existing project component, CAD body or PCB in an assembly. References the project's component/BOM; never duplicates it.",
    args: z.object({ doc: docKey, id: z.string().optional(), source: Source, name: z.string().optional(), position: Vector.optional(), rotation: Vector.optional(), fixed: z.boolean().optional() }),
    run(p, { doc, ...args }) {
      const data = dataOf(p, doc)
      let id = args.id
      for (let i = 1; !id; i++) if (!data.instances.some((n) => n.id === `instance${i}`)) id = `instance${i}`
      data.instances.push(Instance.parse({ ...args, id, source: normalizeSource(p, args.source) }))
      validate(p, doc)
      return { id }
    },
  }),
  defineCommand({
    type: "assembly.instance.update", summary: "Translate/rotate, rename, show/hide or fix an instance. position is mm, rotation is degrees X then Y then Z. A null mount detaches the instance.",
    args: z.object({ doc: docKey, instance: z.string(), position: Vector.optional(), rotation: Vector.optional(), name: z.string().optional(), visible: z.boolean().optional(), fixed: z.boolean().optional(), mount: Mount.nullable().optional() }),
    run(p, { doc, instance, mount, ...set }) {
      const item = instanceOf(dataOf(p, doc), instance)
      if (item.fixed && set.fixed !== false && (set.position || set.rotation || mount)) throw new CommandError(`"${instance}" is fixed; unfix it before moving`)
      Object.assign(item, set)
      if (mount === null) delete item.mount
      else if (mount) item.mount = mount
      validate(p, doc)
      return { id: instance }
    },
  }),
  defineCommand({
    type: "assembly.mount", summary: "Fasten an instance to another instance by mounting-hole IDs, origin/center/top/bottom anchors, or local points. The mount follows target movement and parametric CAD edits. distance mm, twist degrees.",
    args: Mount.extend({ doc: docKey, instance: z.string() }),
    run(p, { doc, instance, ...mount }) {
      const data = dataOf(p, doc); const item = instanceOf(data, instance)
      if (item.fixed) throw new CommandError(`"${instance}" is fixed; unfix it before mounting`)
      instanceOf(data, mount.target)
      item.mount = mount
      validate(p, doc)
      return { id: instance }
    },
  }),
  defineCommand({
    type: "assembly.instance.remove", summary: "Remove an assembly placement, keeping its project component and BOM entry. Detach mounted children first.",
    args: z.object({ doc: docKey, instance: z.string() }),
    run(p, { doc, instance }) {
      const data = dataOf(p, doc); instanceOf(data, instance)
      const children = data.instances.filter((i) => i.mount?.target === instance)
      if (children.length) throw new CommandError(`Detach mounted children first: ${children.map((i) => i.id).join(", ")}`)
      data.instances = data.instances.filter((i) => i.id !== instance)
    },
  }),
]
