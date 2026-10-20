import { CommandError, evaluate, findDoc, variableLookup, type PhysicalPart, type Project } from "@m4k3r/core"
import { evaluateStudio, export3mfMeshes, exportPcbStep, exportStep, exportStl, HOLE_SIZES, loadKernel, MATERIALS, meshBodies, PartStudio, pcbSolid, type BodyMesh, type Evaluation } from "@m4k3r/cad"
import * as ecad from "@m4k3r/ecad"
import { draw,drawPolysides,makeAx1, makeBox, makeCompound, makeCylinder, makeSphere, measureShapeVolumeProperties, measureVolume, type Shape3D } from "replicad"
import { Assembly, type Instance, type V3 } from "./schema"
import { add, aggregateMass, alignAxes, eulerAngles, identity, multiply, multiplyVector, rotationMatrix, scale, sub, transpose, type Matrix } from "./math"
import type { AssemblyResult, Bounds, EvaluatedInstance, MountingHole } from "./types"
import { validateCircularDimensions } from "./dimensions"
export type { AssemblyResult, EvaluatedInstance } from "./types"

interface LocalBody { shape: Shape3D; mass: number; centerOfMass: V3; inertia: Matrix; mountingHoles: MountingHole[]; bounds: Bounds; name: string; massSource: string; geometrySource: string; color?: string; nominalSize?:V3;anchors?:{id:string;at:V3;axis:V3}[];keepouts: { name: string; at: V3; size: V3 }[] }
const localCache=new Map<string,Promise<{body:LocalBody;warnings:string[]}>>()
const localMeshes=new WeakMap<Shape3D,BodyMesh>()
const diagonal = (v: V3): Matrix => [[v[0],0,0], [0,v[1],0], [0,0,v[2]]]
const boxInertia = (mass: number, size: V3): Matrix => diagonal(size.map((_, i) => mass / 12 * size.reduce((sum, d, j) => sum + (i === j ? 0 : d*d), 0)) as V3)
const boundsOf = (shape: Shape3D): Bounds => { const [min, max] = shape.boundingBox.bounds as [V3, V3]; return { min, max, size: sub(max, min) } }
const asEvaluation = (shape: Shape3D, id: string): Evaluation => ({ bodies: [{ id, shape }], features: [] })
const compound = (shapes: Shape3D[]) => shapes.length === 1 ? shapes[0]! : makeCompound(shapes) as Shape3D

/** Exact uniform-density properties from OCCT, including the tensor about the local CG. */
function shapeMass(shape: Shape3D, density: number) {
  const props = measureShapeVolumeProperties(shape)
  const mass = props.volume * density / 1000
  const centerOfMass = props.centerOfMass as V3
  // The compact OCCT build does not bind gp_Mat. Recover the tensor from exact
  // moments about six axes through CG, using I((x+y)/√2)=(Ixx+Iyy)/2+Ixy.
  const moment = (direction: V3) => { const axis = makeAx1(centerOfMass,direction); const value = props.wrapped.MomentOfInertia(axis) * density / 1000; axis.delete(); return value }
  const principal = [moment([1,0,0]),moment([0,1,0]),moment([0,0,1])] as V3
  const inertia = diagonal(principal)
  for (const [i,j] of [[0,1],[0,2],[1,2]] as [number,number][]) {
    const axis: V3 = [0,0,0]; axis[i] = 1; axis[j] = 1
    const value = moment(axis) - (principal[i]!+principal[j]!)/2
    inertia[i]![j] = value; inertia[j]![i] = value
  }
  const result = { mass, centerOfMass, inertia }
  props.delete()
  return result
}
function catalogShape(physical: PhysicalPart): Shape3D {
  const [x,y,z] = physical.size
  const kind = physical.geometry.type
  let shape: Shape3D
  if(kind==="fastener") {
    if(z<Math.min(x,y)*.8) {
      shape=z<Math.min(x,y)*.2?makeCylinder(Math.min(x,y)/2,z,[0,0,-z/2]):drawPolysides(Math.min(x,y)/2,6).sketchOnPlane("XY",-z/2).extrude(z) as Shape3D
      shape=shape.cut(makeCylinder((physical.geometry.innerDiameter??Math.min(x,y)*.56)/2,z+2,[0,0,-z/2-1]))
    } else {
      const head=Math.min(z*.3,Math.min(x,y)*.55)
      shape=makeCylinder(Math.min(x,y)*.28,z,[0,0,-z/2]).fuse(makeCylinder(Math.min(x,y)/2,head,[0,0,z/2-head]))
    }
  } else if(kind==="propeller") {
    const blade=draw([0,y*.15]).lineTo([x*.27,y*.5]).lineTo([x*.49,y*.25]).lineTo([x*.5,-y*.08]).lineTo([x*.25,-y*.2]).lineTo([0,-y*.15]).close().sketchOnPlane("XY",-z*.12).extrude(z*.24) as Shape3D
    shape=blade.fuse(blade.clone().rotate(180,[0,0,0],[0,0,1])).fuse(makeCylinder(Math.min(x,y)*.3,z,[0,0,-z/2]))
  } else if (["cylinder", "gear", "bearing"].includes(kind)) {
    shape = makeCylinder(Math.min(x,y)/2, z, [0,0,-z/2])
    const bore=physical.geometry.innerDiameter??(kind === "bearing" || kind === "gear" ? Math.min(x,y)*.4 : 0)
    if(bore>0)shape = shape.cut(makeCylinder(bore/2, z+2, [0,0,-z/2-1]))
  } else if (kind === "sphere") shape = makeSphere(Math.min(x,y,z)/2)
  else {
    shape = makeBox([-x/2,-y/2,-z/2], [x/2,y/2,z/2])
    if (kind === "extrusion" && Math.min(x,y) > 3) shape = shape.cut(makeBox([-x/2+1.5,-y/2+1.5,-z/2-1], [x/2-1.5,y/2-1.5,z/2+1]))
  }
  const reach = Math.hypot(x,y,z)+2
  for (const hole of physical.mountingHoles) {
    const axis = scale(hole.axis, 1 / Math.hypot(...hole.axis))
    if (!axis.every(Number.isFinite)) continue
    shape = shape.cut(makeCylinder(hole.diameter/2, reach*2, sub(hole.at, scale(axis, reach)), axis))
  }
  return shape
}
function anchor(body: LocalBody, value: string | V3): { at: V3; axis: V3 } {
  if (Array.isArray(value)) return { at: value, axis: [0,0,1] }
  const hole = body.mountingHoles.find((h) => h.id === value)
  if (hole) return hole
  const named=body.anchors?.find(a=>a.id===value);if(named)return named
  if (value === "origin") return { at: [0,0,0], axis: [0,0,1] }
  const center = scale(add(body.bounds.min, body.bounds.max), .5)
  if (value === "center") return { at: center, axis: [0,0,1] }
  if (value === "top") return { at: [center[0], center[1], body.bounds.max[2]], axis: [0,0,1] }
  if (value === "bottom") return { at: [center[0], center[1], body.bounds.min[2]], axis: [0,0,1] }
  throw new CommandError(`No mounting anchor "${value}" on ${body.name}`)
}
interface BoardGeometry { mesh: BodyMesh; mass: number; centerOfMass: V3; bbox: Bounds; mountingHoles: MountingHole[] }
interface PcbModule { pcbGeometry(project: Project, doc: unknown): BoardGeometry; pcbDrills(project: Project, data: unknown): { at: [number,number]; diameter: number; end?: [number,number] }[] }

async function buildLocalBody(project: Project, instance: Instance, warnings: string[]): Promise<LocalBody> {
  const source = instance.source
  if (source.type === "component") {
    const component = project.components.find((c) => c.id === source.component)
    if (!component) throw new CommandError(`Instance ${instance.id} references missing component ${source.component}`)
    const part = project.parts[component.part]
    if (!part) throw new CommandError(`Missing part ${component.part}`)
    let physical = part.physical && structuredClone(part.physical)
    if (!physical) {
      warnings.push(`${component.ref}: physical dimensions and mass are unknown; shown as a 10 mm placeholder with zero mass`)
      physical = { size: [10,10,10], centerOfMass: [0,0,0], geometry: { type: "box" }, mountingHoles: [], keepouts: [], massSource: "estimated" }
    }
    const lookup=variableLookup(project.variables)
    const original=physical.size
    const sizes=original.map((value,i)=>component.props[`physical.size.${["x","y","z"][i]}`]===undefined?value:evaluate(component.props[`physical.size.${["x","y","z"][i]}`]!,lookup)) as V3
    const factor=sizes.map((n,i)=>n/original[i]!) as V3
    if(sizes.some((n)=>!(n>0)))throw new CommandError(`${component.ref}: physical dimensions must be positive`)
    validateCircularDimensions(physical.geometry.type,sizes,component.ref)
    if(factor.some((n)=>n!==1)) {
      physical.size=sizes;physical.centerOfMass=physical.centerOfMass.map((n,i)=>n*factor[i]!) as V3
      physical.mountingHoles=physical.mountingHoles.map((h)=>({...h,at:h.at.map((n,i)=>n*factor[i]!) as V3}))
      physical.keepouts=physical.keepouts.map((k)=>({...k,at:k.at.map((n,i)=>n*factor[i]!) as V3,size:k.size.map((n,i)=>n*factor[i]!) as V3}))
      if(physical.mass!==undefined)physical.mass*=factor.reduce((v,n)=>v*n,1)
      physical.inertia=undefined;physical.massSource="estimated"
    }
    if(component.props["physical.mass"]!==undefined) { const oldMass=physical.mass;physical.mass=evaluate(component.props["physical.mass"]!,lookup);if(physical.inertia&&oldMass)physical.inertia=physical.inertia.map(n=>n*physical!.mass!/oldMass) as V3;physical.massSource="estimated" }
    if(component.props["physical.holeDiameter"]!==undefined)physical.mountingHoles=physical.mountingHoles.map((h)=>({...h,diameter:evaluate(component.props["physical.holeDiameter"]!,lookup)}))
    if(component.props["physical.holeDiameter"]!==undefined&&physical.geometry.innerDiameter!==undefined)physical.geometry.innerDiameter=evaluate(component.props["physical.holeDiameter"]!,lookup)
    if(physical.geometry.innerDiameter!==undefined&&physical.geometry.innerDiameter>=Math.min(...physical.size.slice(0,2)))throw new CommandError(`${component.ref}: bore must be smaller than the outside diameter`)
    if((physical.mass??0)<0)throw new CommandError(`${component.ref}: mass must be nonnegative`)
    if (physical.mass === undefined) warnings.push(`${component.ref}: mass is unknown and excluded from mass/CG/inertia totals`)
    if (physical.massSource === "estimated" && physical.mass !== undefined) warnings.push(`${component.ref}: mass is an estimate`)
    const shape = catalogShape(physical)
    const mass = physical.mass ?? 0
    let inertia = physical.inertia ? diagonal(physical.inertia) : boxInertia(mass, physical.size)
    if (!physical.inertia && mass) {
      const geometric = shapeMass(shape, 1)
      if (geometric.mass > 1e-12) inertia = geometric.inertia.map((row) => row.map((n) => n * mass / geometric.mass) as V3) as Matrix
    }
    const [x,y,z]=physical.size
    const anchors=physical.geometry.type==="fastener"&&z>=Math.min(x,y)*.8?[{id:"shoulder",at:[0,0,z/2-Math.min(z*.3,Math.min(x,y)*.55)] as V3,axis:[0,0,1] as V3}]:[]
    return { shape, mass, centerOfMass: physical.centerOfMass, inertia, mountingHoles: physical.mountingHoles,anchors,nominalSize:physical.size, bounds: boundsOf(shape), name: `${component.ref} · ${part.name}`, massSource: physical.massSource, geometrySource: `catalog ${physical.geometry.type} proxy`, color: physical.geometry.color, keepouts: physical.keepouts }
  }
  if (source.type === "pcb") {
    const doc = findDoc(project, source.doc, "pcb"); const module = ecad as unknown as PcbModule
    const geometry = module.pcbGeometry(project, doc)
    const data = doc.data as { outline: [number,number][]; thickness: number }
    const shape = await pcbSolid(data.outline, data.thickness, module.pcbDrills(project, data))
    const physical=shapeMass(shape,1.85)
    return { shape,...physical,mountingHoles: geometry.mountingHoles, bounds: boundsOf(shape), name: doc.name, massSource: "FR4 density estimate", geometrySource: "PCB outline and drills", keepouts: [] }
  }
  const doc = findDoc(project, source.doc, "part-studio"); const data = PartStudio.parse(doc.data)
  const evaluated = await evaluateStudio(data, project.variables)
  if (evaluated.error) throw new CommandError(`${doc.name}: ${evaluated.error.feature}: ${evaluated.error.message}`)
  const bodies = source.body ? evaluated.bodies.filter((b) => b.id === source.body) : evaluated.bodies
  if (!bodies.length) throw new CommandError(`${doc.name}: no body ${source.body ?? "to place"}`)
  const shape = compound(bodies.map((b) => b.shape))
  const num = (expr: string | number) => evaluate(expr, variableLookup(project.variables))
  const mountingHoles: MountingHole[] = []
  const anchors: NonNullable<LocalBody["anchors"]> = []
  // Construction points are explicit assembly anchors and do not drill material.
  for (const feature of evaluated.features) if (feature.status === "ok" && feature.sketch) {
    const sketch = feature.sketch
    for (const point of sketch.entities) if (point.type === "point" && point.construction) {
      anchors.push({ id:`${feature.id}.${point.id}`,at:sketch.plane.origin.map((n,i)=>n+point.at[0]*sketch.plane.xDir[i]!+point.at[1]*sketch.plane.yDir[i]!) as V3,axis:sketch.plane.normal })
    }
  }
  for (const f of data.features) if (f.type === "hole" && !f.suppressed) {
    const sketch = evaluated.features.find((s) => s.id === f.sketch)?.sketch
    if (!sketch) continue
    for (const point of sketch.entities) if (point.type === "point" && !point.construction && (!f.points || f.points.includes(point.id))) {
      mountingHoles.push({ id: `${f.id}.${point.id}`, at: sketch.plane.origin.map((n,i) => n+point.at[0]*sketch.plane.xDir[i]!+point.at[1]*sketch.plane.yDir[i]!) as V3, axis: sketch.plane.normal, diameter: f.size ? HOLE_SIZES[f.size][f.fit] : num(f.diameter!) })
    }
  }
  return { shape, ...shapeMass(shape, MATERIALS[data.material]), mountingHoles, anchors, bounds: boundsOf(shape), name: `${doc.name}${source.body ? ` · ${source.body}` : ""}`, massSource: `${data.material} density`, geometrySource: "parametric CAD solid", keepouts: [] }
}
async function localBody(project:Project,instance:Instance,warnings:string[]):Promise<LocalBody>{
  const source=instance.source
  const component=source.type==="component"?project.components.find(c=>c.id===source.component):undefined
  const doc=source.type!=="component"?project.docs.find(d=>d.id===source.doc):undefined
  const key=JSON.stringify([source,project.variables,component,component?project.parts[component.part]:doc?.data,source.type==="pcb"?[project.components,project.parts]:undefined])
  let cached=localCache.get(key)
  if(!cached){const notes:string[]=[];cached=buildLocalBody(project,instance,notes).then(body=>({body,warnings:notes}));cached.catch(()=>localCache.delete(key));if(localCache.size>=96)localCache.delete(localCache.keys().next().value!);localCache.set(key,cached)}
  const value=await cached;warnings.push(...value.warnings);return value.body
}
function worldBounds(bounds: Bounds, position: V3, matrix: Matrix): Bounds {
  const points: V3[] = []
  for (const x of [bounds.min[0],bounds.max[0]]) for (const y of [bounds.min[1],bounds.max[1]]) for (const z of [bounds.min[2],bounds.max[2]]) points.push(add(position, multiplyVector(matrix, [x,y,z])))
  const min = [0,1,2].map((i) => Math.min(...points.map((p) => p[i]!))) as V3
  const max = [0,1,2].map((i) => Math.max(...points.map((p) => p[i]!))) as V3
  return { min, max, size: sub(max,min) }
}
const overlapVolume = (a: Bounds, b: Bounds) => [0,1,2].reduce((volume,i) => volume * Math.max(0, Math.min(a.max[i]!,b.max[i]!)-Math.max(a.min[i]!,b.min[i]!)),1)
const worldShape = (shape: Shape3D, position: V3, rotation: V3) => shape.clone().rotate(rotation[0],[0,0,0],[1,0,0]).rotate(rotation[1],[0,0,0],[0,1,0]).rotate(rotation[2],[0,0,0],[0,0,1]).translate(position)
export interface AssemblyEvaluation extends AssemblyResult { solids: Map<string, Shape3D> }

export async function evaluateAssembly(project: Project, input: unknown, options: { interference?: boolean } = {}): Promise<AssemblyEvaluation> {
  await loadKernel()
  const raw = typeof input === "string" ? findDoc(project,input,"assembly").data : input && typeof input === "object" && "data" in input ? input.data : input
  const data = Assembly.parse(raw); const warnings: string[] = []
  const locals = new Map<string, LocalBody>()
  for (const instance of data.instances) locals.set(instance.id, await localBody(project, instance, warnings))
  const poses = new Map<string,{ position: V3; matrix: Matrix }>()
  const pose = (instance: Instance): { position: V3; matrix: Matrix } => {
    const cached = poses.get(instance.id); if (cached) return cached
    let value = { position: instance.position, matrix: rotationMatrix(instance.rotation) }
    if (instance.mount) {
      const mount = instance.mount; const parent = data.instances.find((n) => n.id === mount.target)!
      const targetPose = pose(parent); const from = anchor(locals.get(instance.id)!, mount.sourceAnchor); const to = anchor(locals.get(parent.id)!,mount.targetAnchor)
      const relative = alignAxes(from.axis, scale(to.axis,mount.flip ? -1 : 1),mount.twist)
      const relativePosition = sub(add(to.at,scale(to.axis,mount.distance)),multiplyVector(relative,from.at))
      value = { matrix: multiply(targetPose.matrix,relative), position: add(targetPose.position,multiplyVector(targetPose.matrix,relativePosition)) }
    }
    poses.set(instance.id,value); return value
  }
  const solids = new Map<string,Shape3D>()
  const instances: EvaluatedInstance[] = data.instances.map((instance) => {
    const local = locals.get(instance.id)!; const { position,matrix } = pose(instance); const rotation = eulerAngles(matrix)
    const shape = worldShape(local.shape,position,rotation); solids.set(instance.id,shape)
    let localMesh=localMeshes.get(local.shape)
    if(!localMesh){localMesh=meshBodies(asEvaluation(local.shape,"local"))[0]!;localMeshes.set(local.shape,localMesh)}
    const transform=(values:number[],translate:boolean)=>{const result:number[]=[];for(let i=0;i<values.length;i+=3){const p=multiplyVector(matrix,values.slice(i,i+3) as V3);result.push(...(translate?add(position,p):p))}return result}
    const mesh:BodyMesh={...localMesh,id:instance.id,positions:transform(localMesh.positions,true),normals:transform(localMesh.normals,false),edges:transform(localMesh.edges,true)}
    const inertia = multiply(multiply(matrix,local.inertia),transpose(matrix))
    return { id:instance.id,name:instance.name ?? local.name,source:instance.source,position,rotation,axis:multiplyVector(matrix,[0,0,1]),mass:local.mass,centerOfMass:add(position,multiplyVector(matrix,local.centerOfMass)),inertia,bbox:worldBounds(local.bounds,position,matrix),mesh,localBounds:local.bounds,nominalSize:local.nominalSize??local.bounds.size,localAnchors:local.anchors??[],localMountingHoles:local.mountingHoles,mountingHoles:local.mountingHoles.map((h) => ({ ...h,at:add(position,multiplyVector(matrix,h.at)),axis:multiplyVector(matrix,h.axis) })),massSource:local.massSource,geometrySource:local.geometrySource,color:local.color,mount:instance.mount }
  })
  const interferences: AssemblyResult["interferences"] = []
  if (options.interference !== false) for (let a = 0; a < instances.length; a++) for (let b = a+1; b < instances.length; b++) {
    const first = instances[a]!; const second = instances[b]!
    if (overlapVolume(first.bbox,second.bbox) < 1e-6) continue
    try {
      const volume = measureVolume(solids.get(first.id)!.intersect(solids.get(second.id)!))
      if (volume > 1e-5) interferences.push({ a:first.id,b:second.id,volume,method:"solid",severity:"collision" })
    } catch { warnings.push(`Interference check failed for ${first.name} / ${second.name}`) }
  }
  if (options.interference !== false) for (const instance of instances) {
    const local = locals.get(instance.id)!; const matrix = poses.get(instance.id)!.matrix
    for (const keepout of local.keepouts) {
      const half = scale(keepout.size,.5)
      const box = worldBounds({ min:sub(keepout.at,half),max:add(keepout.at,half),size:keepout.size },instance.position,matrix)
      const region = worldShape(makeBox(sub(keepout.at,half),add(keepout.at,half)),instance.position,instance.rotation)
      for (const other of instances) if (other.id !== instance.id && overlapVolume(box,other.bbox)>1e-6) {
        try {
          const volume = measureVolume(region.intersect(solids.get(other.id)!))
          if (volume>1e-5) interferences.push({ a:instance.id,b:other.id,volume,method:"solid",severity:"keepout",message:keepout.name })
        } catch {
          warnings.push(`Exact keepout check failed for ${instance.name} / ${other.name}; using conservative bounding boxes`)
          interferences.push({ a:instance.id,b:other.id,volume:overlapVolume(box,other.bbox),method:"bounds",severity:"keepout",message:keepout.name })
        }
      }
    }
  }
  const mass = aggregateMass(instances)
  const bbox = instances.length ? { min:[0,1,2].map((i) => Math.min(...instances.map((n) => n.bbox.min[i]!))) as V3,max:[0,1,2].map((i) => Math.max(...instances.map((n) => n.bbox.max[i]!))) as V3,size:[0,0,0] as V3 } : null
  if (bbox) bbox.size = sub(bbox.max,bbox.min)
  return { instances,...mass,bbox,warnings,interferences,solids }
}
export function assemblySummary(evaluation: AssemblyResult) { return { ...evaluation, instances:evaluation.instances.map(({ mesh,...instance }) => instance), solids:undefined } }
export async function exportAssembly(evaluation: AssemblyEvaluation, format: "stl" | "step" | "3mf") {
  if (format === "3mf") return export3mfMeshes(evaluation.instances.map((i) => i.mesh))
  const ev: Evaluation = { features:[],bodies:evaluation.instances.map((i) => ({ id:i.name,shape:evaluation.solids.get(i.id)! })) }
  return format === "step" ? exportStep(ev) : exportStl(ev)
}
