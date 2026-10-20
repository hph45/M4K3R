import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { registerCommands } from '@m4k3r/core'
import { drc,erc } from '@m4k3r/ecad'
import { deviceAnalysisSummary } from '@m4k3r/sim'
import { evaluateAssembly } from '@m4k3r/assembly/node'
import { expect,it } from 'vitest'
import { domains } from './domains'
import { PartLibrary } from './library'
import { ProjectStore } from './store'
import { createDrone } from './drone'
import { evaluateDevice } from './domains/device'

it('links an editable ESP32 drone, real printable solids, a DRC-clean PCB and explicit rotor estimates',async()=>{
 const home=mkdtempSync(join(tmpdir(),'m4k3r-drone-'))
 const library=new PartLibrary(resolve(import.meta.dirname,'../../../library/parts'),join(home,'parts'))
 const store=new ProjectStore(join(home,'projects'),library)
 for(const domain of domains) {registerCommands(domain.commands??[]);await domain.setup?.({store,library,home})}
 const project=createDrone(store)
 expect(project.docs.map(d=>d.kind)).toEqual(expect.arrayContaining(['schematic','part-studio','assembly','pcb','firmware','device-analysis','simulation']))
 const assembly=await evaluateAssembly(project,'Drone assembly',{interference:true})
 expect(assembly.mass).toBeGreaterThan(200)
 expect(assembly.interferences).toEqual([])
 expect(assembly.instances.filter(i=>i.source.type==='component')).toHaveLength(project.components.length)
 expect(drc(project,'Power distribution').filter(issue=>issue.severity==='error')).toEqual([])
 expect(erc(project).filter(issue=>issue.components?.includes(project.components.find(c=>c.ref==='U1')!.id))).toEqual([])
 const flight=await evaluateDevice(project,'Flight estimates')
 // Rotors are the placed motors with their propellers; thrust data comes from those parts.
 expect(flight.rotors.map(r=>[r.component,r.propeller,r.diameter,r.direction])).toEqual([['M1','P1',127,'cw'],['M2','P2',127,'ccw'],['M3','P3',127,'cw'],['M4','P4',127,'ccw']])
 expect(flight.maximum?.rotors).toHaveLength(4)
 expect(flight.thrustToWeight).toBeGreaterThan(1)
 expect(flight.assumptions.join(' ')).toMatch(/Illustrative generic/)
 expect(flight.assemblyMass+flight.addedMass).toBeCloseTo(flight.mass)
 expect(flight.warnings.filter(w=>/mass is an estimate/.test(w))).toEqual([])
 expect(flight.warnings).toContain(`${flight.estimatedMass.length} parts use estimated mass`)
 const summary=deviceAnalysisSummary(flight)
 expect(summary.split('\n').slice(0,6).join('\n')).toMatch(/Mass: .*assembly \+ 15\.0 g payload[^]*Max usable thrust: \d+ g/)
 expect(new ProjectStore(join(home,'projects'),library).get(project.id)).toEqual(project)
 // Higher-thrust propeller data, set as a component prop, changes the estimate.
 store.apply(project.id,[1,2,3,4].map(i=>({type:'component.update',args:{component:`P${i}`,props:{ct:'0.12'}}})))
 expect((await evaluateDevice(store.get(project.id),'Flight estimates')).hover!.throttle).toBeLessThan(flight.hover!.throttle)
 store.undo(project.id)
 // Changing shared frame dimensions must move the hardware with its CAD anchors.
 const initial = new Map(assembly.instances.map(instance=>[instance.id,instance]))
 expect(initial.get('motor1')!.position[2]).toBeCloseTo(16.5)
 expect(initial.get('prop1')!.position[2]).toBeCloseTo(33)
 expect(initial.get('holder')!.position[2]).toBeCloseTo(18)
 store.apply(project.id,[{type:'variable.set',args:{name:'wheelbase',value:'250 mm'}},{type:'variable.set',args:{name:'frame_thickness',value:'6 mm'}}])
 const resized=await evaluateAssembly(store.get(project.id),'Drone assembly',{interference:true})
 const frame=resized.instances.find(instance=>instance.id==='frame')!
 const anchorIndex=[0,2,3,1]
 for(let i=0;i<4;i++) {
  const motor=resized.instances.find(instance=>instance.id===`motor${i+1}`)!
  const prop=resized.instances.find(instance=>instance.id===`prop${i+1}`)!
  const anchor=frame.localAnchors.find(point=>point.id===`motor_holes.center${anchorIndex[i]}`)!
  const drill=frame.mountingHoles.find(hole=>hole.id===`motor_drills.m${anchorIndex[i]}p0`)!
  expect(Math.abs(motor.position[0])).toBeCloseTo(250/(2*Math.sqrt(2)))
  expect(Math.abs(motor.position[1])).toBeCloseTo(250/(2*Math.sqrt(2)))
  expect(motor.position[0]).toBeCloseTo(anchor.at[0]);expect(motor.position[1]).toBeCloseTo(anchor.at[1])
  expect(drill.at[0]+8).toBeCloseTo(motor.position[0]);expect(drill.at[1]+9.5).toBeCloseTo(motor.position[1])
  expect(motor.bbox.min[2]).toBeCloseTo(6)
  expect(prop.position[0]).toBeCloseTo(motor.position[0]);expect(prop.position[1]).toBeCloseTo(motor.position[1])
  expect(prop.bbox.min[2]-motor.bbox.max[2]).toBeCloseTo(1)
 }
 for(const id of ['holder','controller','board','regulator','imu','bulkCap','decoupler',...Array.from({length:4},(_,i)=>`spacer${i+1}`),...Array.from({length:4},(_,i)=>`esc${i+1}`),...Array.from({length:4},(_,i)=>`screw${i+1}`),...Array.from({length:5},(_,i)=>`connector${i+1}`)]) {
  expect(resized.instances.find(instance=>instance.id===id)!.position[2]).toBeCloseTo(initial.get(id)!.position[2]+2)
 }
 for(const id of ['batteryTray','battery','strap'])expect(resized.instances.find(instance=>instance.id===id)!.position).toEqual(initial.get(id)!.position)
 expect(resized.interferences).toEqual([])
},30000)
