import { mkdtempSync } from 'node:fs'
import { homedir,tmpdir } from 'node:os'
import { join,resolve } from 'node:path'
import { registerCommands } from '@m4k3r/core'
import { expect,it } from 'vitest'
import { domains } from './domains'
import { PartLibrary } from './library'
import { ProjectStore } from './store'
import { createDrone } from './drone'
import { runCoupled } from './domains/coupled'

it.skipIf(process.env.M4K3R_ESP_E2E!=='1')('runs the saved ESP32 drone firmware and circuit together with actual digital ESC pulses',async()=>{
 const home=process.env.M4K3R_HOME??join(homedir(),'M4K3R')
 const folder=mkdtempSync(join(tmpdir(),'m4k3r-drone-firmware-'))
 const library=new PartLibrary(resolve(import.meta.dirname,'../../../library/parts'),join(folder,'parts'))
 const store=new ProjectStore(join(folder,'projects'),library),context={store,library,home}
 for(const domain of domains){registerCommands(domain.commands??[]);await domain.setup?.(context)}
 const project=createDrone(store)
 const result=await runCoupled(context,project.id,{firmware:['ESP32 bench pulses'],duration:.5,step:.00005,probes:['V(3V3)','ESC1.rpm'],inputs:[]})
 expect(result.ok).toBe(true)
 if(!result.ok)return
 expect(result.complete).toBe(true)
 expect(result.result.voltages['3V3']).toBeCloseTo(3.3,1)
 expect(result.serial.U1?.Serial).toContain('ESP32 bench ready')
 expect(result.gpio.U1).toMatchObject({GP2:{function:'gpio'}})
 expect(result.result.views.ESC1?.signalMode).toBe('servo')
 expect(result.result.views.ESC1?.rpm).toBeLessThan(1500)
 expect(result.result.warnings.join(' ')).toContain('sampled digital GPIO only')
},600000)
