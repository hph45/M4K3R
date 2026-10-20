import { strFromU8,unzipSync } from "fflate"
import { measureVolume } from "replicad"
import { expect,it } from "vitest"
import { evaluateStudio,export3mf,exportPcbStep,meshBodies,pcbSolid,properties,templateStudio } from "./index"
import { cubicPoint,splineCurves } from "./spline"
it("packages millimeter meshes as conforming multi-object 3MF resources and build items",async()=>{
  const ev=await evaluateStudio({features:[{type:"sketch",id:"s",entities:[{type:"rectangle",id:"r",width:20,height:10}]},{type:"extrude",id:"body",sketch:"s",depth:3}]})
  const files=unzipSync(export3mf(ev));expect(Object.keys(files).sort()).toEqual(["3D/3dmodel.model","[Content_Types].xml","_rels/.rels"].sort())
  const xml=strFromU8(files["3D/3dmodel.model"]!)
  expect(xml).toContain('unit="millimeter"');expect(xml).toContain('<item objectid="1"/>')
  expect((xml.match(/<triangle /g)??[]).length).toBe(meshBodies(ev)[0]!.indices.length/3)
  expect((xml.match(/<vertex /g)??[]).length).toBe(8)
  const edges=new Map<string,number>()
  for(const triangle of xml.matchAll(/<triangle v1="(\d+)" v2="(\d+)" v3="(\d+)"/g)){
    const ids=triangle.slice(1).map(Number)
    ids.forEach((a,i)=>{const b=ids[(i+1)%3]!;const key=[a!,b].sort((x,y)=>x-y).join(",");edges.set(key,(edges.get(key)??0)+1)})
  }
  expect([...edges.values()].every(n=>n===2)).toBe(true)
  expect(strFromU8(files["_rels/.rels"]!)).toContain('Target="/3D/3dmodel.model"')
})
it("creates analytic PCB STEP solids with exact round and capsule drills",async()=>{
  const outline:[number,number][]=[[0,0],[40,0],[40,30],[0,30]]
  const holes=[{at:[10,10] as [number,number],diameter:4},{at:[20,10] as [number,number],end:[26,10] as [number,number],diameter:2}]
  const shape=await pcbSolid(outline,1.6,holes)
  expect(measureVolume(shape)).toBeCloseTo((1200-Math.PI*4-Math.PI-12)*1.6,5)
  expect(new TextDecoder().decode(await exportPcbStep(outline,1.6,holes))).toContain("MANIFOLD_SOLID_BREP")
})
it("sketches on a moving planar face and follows its updated height",async()=>{
  const data={features:[{type:"sketch",id:"base",entities:[{type:"rectangle",id:"r",width:40,height:30}]},{type:"extrude",id:"body",sketch:"base",depth:"height"},{type:"sketch",id:"on_top",face:{body:"body",query:{normal:"+z"}},entities:[{type:"circle",id:"c",center:[0,0],radius:5}]},{type:"extrude",id:"boss",sketch:"on_top",depth:4,op:"add"}]}
  const first=await evaluateStudio(data,[{name:"height",value:"10"}]);expect(first.error).toBeUndefined();expect(properties(first).bbox?.max[2]).toBeCloseTo(14)
  const next=await evaluateStudio(data,[{name:"height",value:"20"}]);expect(properties(next).bbox?.max[2]).toBeCloseTo(24)
  expect(next.features[2]!.sketch!.plane.origin[2]).toBeCloseTo(20)
})
it("interpolates closed cubic splines and extrudes their exact curved profile",async()=>{
  const points:[number,number][]=[[-10,-10],[10,-10],[10,10],[-10,10]]
  const curves=splineCurves(points,true)
  expect(curves).toHaveLength(4);expect(cubicPoint(curves[0]!,0)).toEqual(points[0]);expect(cubicPoint(curves[0]!,1)).toEqual(points[1])
  const ev=await evaluateStudio({features:[{type:"sketch",id:"s",entities:[{type:"spline",id:"outline",points,closed:true}]},{type:"extrude",id:"body",sketch:"s",depth:5}]})
  expect(ev.error).toBeUndefined();expect(properties(ev).volume).toBeGreaterThan(400*5)
  expect(ev.features[0]!.sketch!.entities[0]!.type).toBe("spline")
})
it.each(["plate","bracket","mount","frame"] as const)("builds parametric %s family solids with real holes",async family=>{
  const studio=templateStudio({family,width:family==="frame"?200:80})
  const ev=await evaluateStudio(studio)
  expect(ev.error).toBeUndefined();expect(ev.bodies).toHaveLength(1);expect(properties(ev).volume).toBeGreaterThan(0)
  expect(ev.features.at(-1)!.id).toBe("mounting_holes")
},30000)
