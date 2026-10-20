import { Part,emptyProject,applyCommands,registerCommands } from '@m4k3r/core'
import { measureVolume } from 'replicad'
import { evaluateAssembly } from './evaluate'
import { beforeAll,expect,it } from 'vitest'
import { assemblyCommands } from './commands'

beforeAll(()=>registerCommands(assemblyCommands))

it('preserves explicit bearing/tube bores in the actual solid and rejects impossible family sizes',async()=>{
 const part=Part.parse({id:'bearing',kind:'mechanical',name:'608',refPrefix:'MP',physical:{size:[22,22,7],mass:12,geometry:{type:'bearing',innerDiameter:8}}})
 const project=emptyProject('bore','Bore')
 project.parts[part.id]=part
 project.components=[{id:'bearing1',ref:'MP1',part:part.id,props:{}}]
 const evaluated=await evaluateAssembly(project,{instances:[{id:'b',source:{type:'component',component:'bearing1'}}]})
 expect(measureVolume(evaluated.solids.get('b')!)).toBeCloseTo(Math.PI*(11**2-4**2)*7,4)
 project.components[0]!.props={'physical.size.x':'6','physical.size.y':'6'}
 await expect(evaluateAssembly(project,{instances:[{id:'b',source:{type:'component',component:'bearing1'}}]})).rejects.toThrow(/bore must be smaller/)
})

it.each(['cylinder','bearing','gear','fastener'])('rejects unequal circular %s dimensions in commands and direct properties',async kind=>{
 const part=Part.parse({id:'round',kind:'mechanical',name:'Round part',refPrefix:'MP',physical:{size:[22,22,7],mass:12,geometry:{type:kind,innerDiameter:8}}})
 const project=emptyProject('round','Round')
 project.parts[part.id]=part
 project.components=[{id:'round1',ref:'MP1',part:part.id,props:{}}]
 const context={resolvePart:()=>undefined,newId:()=>"unused"}
 expect(()=>applyCommands(project,[{type:'assembly.component.configure',args:{component:'MP1',size:[30,22,7]}}],context)).toThrow(/equal X and Y outside diameters/)
 expect(project.components[0]!.props).toEqual({})
 project.components[0]!.props={'physical.size.x':'30'}
 await expect(evaluateAssembly(project,{instances:[{id:'r',source:{type:'component',component:'round1'}}]})).rejects.toThrow(/equal X and Y outside diameters/)
})

it('resizes both bearing diameters together with matching geometry and mass',async()=>{
 const part=Part.parse({id:'round',kind:'mechanical',name:'Bearing',refPrefix:'MP',physical:{size:[22,22,7],mass:12,geometry:{type:'bearing',innerDiameter:8}}})
 const project=emptyProject('round','Round')
 project.parts[part.id]=part
 project.components=[{id:'round1',ref:'MP1',part:part.id,props:{}}]
 const configured=applyCommands(project,[{type:'assembly.component.configure',args:{component:'MP1',size:[30,30,7]}}],{resolvePart:()=>undefined,newId:()=>"unused"}).project
 const result=await evaluateAssembly(configured,{instances:[{id:'r',source:{type:'component',component:'round1'}}]})
 expect(result.instances[0]!.bbox.size[0]).toBeCloseTo(30)
 expect(result.instances[0]!.bbox.size[1]).toBeCloseTo(30)
 expect(result.mass).toBeCloseTo(12*(30/22)**2)
 expect(measureVolume(result.solids.get('r')!)).toBeCloseTo(Math.PI*(15**2-4**2)*7,4)
})
