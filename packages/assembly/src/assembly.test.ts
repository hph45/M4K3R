import { applyCommands, emptyProject, Part, registerCommands, registerDocKind, type Command } from "@m4k3r/core"
import { beforeAll, expect, it } from "vitest"
import { cadCommands, PartStudio } from "@m4k3r/cad"
import { PcbData } from "@m4k3r/ecad"
import { Assembly, assemblyCommands, rotateVector, rotationMatrix, eulerAngles, alignAxes, multiplyVector } from "./index"
import { evaluateAssembly } from "./evaluate"

beforeAll(() => { registerDocKind("assembly",Assembly); registerDocKind("part-studio",PartStudio);registerDocKind("pcb",PcbData); registerCommands([...assemblyCommands,...cadCommands]) })
const part = Part.parse({ id:"test-plate",name:"Plate",kind:"mechanical",refPrefix:"P",physical:{ size:[20,10,4],mass:12,geometry:{type:"box"},massSource:"manufacturer",mountingHoles:[{id:"m1",at:[5,0,2],diameter:2}] } })
function fixture(...commands: Command[]) {
  let id=0
  return applyCommands(emptyProject("p","Assembly"),[
    {type:"part.vendor",args:{part}},{type:"component.add",args:{part:part.id,ref:"P1"}},{type:"component.add",args:{part:part.id,ref:"P2"}},
    {type:"doc.create",args:{kind:"assembly",name:"Build"}},...commands,
  ],{resolvePart:()=>undefined,newId:(prefix)=>`${prefix}_${++id}`}).project
}
it("preserves Euler rotations, aligns arbitrary mounting axes and handles opposite axes",()=>{
  for(const rotation of [[10,20,30],[0,90,40],[-90,-30,70]] as [number,number,number][]) {
    const m=rotationMatrix(rotation); const restored=rotationMatrix(eulerAngles(m))
    m.flat().forEach((n,i)=>expect(restored.flat()[i]).toBeCloseTo(n,8))
  }
  expect(multiplyVector(alignAxes([0,0,1],[1,0,0]),[0,0,1])[0]).toBeCloseTo(1)
  expect(multiplyVector(alignAxes([0,0,1],[0,0,-1]),[0,0,1])[2]).toBeCloseTo(-1)
  expect(rotateVector([1,0,0],[0,0,90])[1]).toBeCloseTo(1)
})
it("computes mass, CG, rotated tensor and real solid interference without duplicating BOM",async()=>{
  const project=fixture(
    {type:"assembly.instance.add",args:{doc:"Build",id:"a",source:{type:"component",component:"P1"},position:[-20,0,0]}},
    {type:"assembly.instance.add",args:{doc:"Build",id:"b",source:{type:"component",component:"P2"},position:[20,0,0],rotation:[0,0,90]}},
  )
  const result=await evaluateAssembly(project,"Build")
  expect(project.components).toHaveLength(2)
  expect(result.mass).toBe(24)
  expect(result.centerOfMass[0]).toBeCloseTo(0)
  expect(result.inertia[1][1]).toBeGreaterThan(2*12*20**2)
  expect(result.instances[1]!.bbox.size[0]).toBeCloseTo(10)
  expect(result.interferences).toEqual([])
  const update=applyCommands(project,[{type:"assembly.instance.update",args:{doc:"Build",instance:"b",position:[-20,0,0]}}],{resolvePart:()=>undefined,newId:()=>"unused"}).project
  expect((await evaluateAssembly(update,"Build")).interferences[0]!.volume).toBeGreaterThan(0)
})
it("mounts hole to hole, follows parent movement and rejects mount cycles/duplicate component placements",async()=>{
  let project=fixture(
    {type:"assembly.instance.add",args:{doc:"Build",id:"a",source:{type:"component",component:"P1"},position:[40,20,0],rotation:[0,0,90]}},
    {type:"assembly.instance.add",args:{doc:"Build",id:"b",source:{type:"component",component:"P2"}}},
    {type:"assembly.mount",args:{doc:"Build",instance:"b",target:"a",sourceAnchor:"m1",targetAnchor:"m1",distance:10}},
  )
  const result=await evaluateAssembly(project,"Build")
  expect(result.instances[1]!.mountingHoles[0]!.at.map(n=>Math.round(n))).toEqual([40,25,12])
  const context={resolvePart:()=>undefined,newId:()=>"unused"}
  expect(()=>applyCommands(project,[{type:"assembly.mount",args:{doc:"Build",instance:"a",target:"b"}}],context)).toThrow(/cycle/)
  expect(()=>applyCommands(project,[{type:"assembly.instance.add",args:{doc:"Build",source:{type:"component",component:"P1"}}}],context)).toThrow(/already placed/)
  project=applyCommands(project,[{type:"assembly.instance.update",args:{doc:"Build",instance:"a",position:[50,20,0]}}],context).project
  expect((await evaluateAssembly(project,"Build")).instances[1]!.position[0]).toBeCloseTo(50)
})
it("uses exact CAD volume, density and inertia for a placed printable part",async()=>{
  const project=fixture(
    {type:"doc.create",args:{kind:"part-studio",name:"Box",data:{features:[{type:"sketch",id:"s",entities:[{type:"rectangle",id:"r",width:20,height:10}]},{type:"extrude",id:"body",sketch:"s",depth:4}]}}},
    {type:"assembly.instance.add",args:{doc:"Build",source:{type:"cad",doc:"Box"},position:[0,0,5]}},
  )
  const result=await evaluateAssembly(project,"Build")
  expect(result.mass).toBeCloseTo(.992)
  expect(result.centerOfMass[2]).toBeCloseTo(7)
  expect(result.inertia[0][0]).toBeCloseTo(.992*(10**2+4**2)/12,6)
})
it("configures one component family without changing its shared catalog or BOM identity",async()=>{
  const project=fixture(
    {type:"assembly.component.configure",args:{component:"P1",size:[40,10,4],mass:18}},
    {type:"assembly.instance.add",args:{doc:"Build",source:{type:"component",component:"P1"}}},
  )
  const result=await evaluateAssembly(project,"Build")
  expect(result.mass).toBe(18);expect(result.instances[0]!.bbox.size[0]).toBeCloseTo(40)
  expect(result.instances[0]!.localMountingHoles[0]!.at[0]).toBe(10)
  expect(project.parts[part.id]!.physical!.size).toEqual([20,10,4])
  expect(project.components).toHaveLength(2)
})
it("places exact PCB outline/drills and keeps bare-board mass separate from components",async()=>{
  const project=fixture(
    {type:"doc.create",args:{kind:"pcb",name:"Controller",data:{outline:[[0,0],[40,0],[40,30],[0,30]],holes:[{id:"h1",at:[5,5],diameter:3}]}}},
    {type:"assembly.instance.add",args:{doc:"Build",source:{type:"pcb",doc:"Controller"},position:[10,20,5]}},
  )
  const result=await evaluateAssembly(project,"Build")
  expect(result.mass).toBeCloseTo((40*30-Math.PI*1.5**2)*1.6*.00185,6)
  expect(result.centerOfMass[2]).toBeCloseTo(5.8)
  expect(result.instances[0]!.mountingHoles[0]!.at).toEqual([15,25,5])
})
it("tests keepouts against actual solids rather than filling empty enclosure space",async()=>{
  const project=structuredClone(fixture(
    {type:"doc.create",args:{kind:"part-studio",name:"Cradle",data:{features:[{type:"sketch",id:"s",entities:[{type:"rectangle",id:"r",width:40,height:40}]},{type:"extrude",id:"body",sketch:"s",depth:20},{type:"shell",id:"hollow",thickness:2,faces:{normal:"+z"}}]}}},
    {type:"assembly.instance.add",args:{doc:"Build",id:"controller",source:{type:"component",component:"P1"},position:[80,0,0]}},
    {type:"assembly.instance.add",args:{doc:"Build",id:"cradle",source:{type:"cad",doc:"Cradle"}}},
  ))
  project.parts[part.id]!.physical!.keepouts=[{name:"Antenna",at:[-80,0,10],size:[2,2,2]}]
  expect((await evaluateAssembly(project,"Build")).interferences).toEqual([])
  const moved=applyCommands(project,[{type:"assembly.instance.update",args:{doc:"Build",instance:"controller",position:[98,0,0]}}],{resolvePart:()=>undefined,newId:()=>"unused"}).project
  const issues=(await evaluateAssembly(moved,"Build")).interferences
  expect(issues).toHaveLength(1)
  expect(issues[0]).toMatchObject({severity:"keepout",method:"solid",message:"Antenna"})
  expect(issues[0]!.volume).toBeCloseTo(4)
})
