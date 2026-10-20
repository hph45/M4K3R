import { expect,it } from 'vitest'
import { mkdtempSync,readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir,tmpdir } from 'node:os'
import { build,Toolchain,espChipForBoard,runEspFirmware,EspRuntime } from './index'

it('rejects ESP targets that the real runtime does not emulate',()=>{
 expect(espChipForBoard('esp32c3')).toBe('esp32c3')
 expect(espChipForBoard('esp32-s3-devkitc-1')).toBe('esp32s3')
 expect(espChipForBoard('esp32s31')).toBe('esp32s31')
 expect(()=>espChipForBoard('esp32')).toThrow(/emulation requires/)
})
it('retains executed time and UART when a batch requests reset',()=>{
 class ResetMachine {
  clock=0
  cycles(){return this.clock} cycles_per_us(){return 160}
  run_batch(n:number){this.clock+=n;return 'panic log'}
  gpio_state(){return new Uint32Array(4)} gpio_set_input(){}
  load_default_rom(){} set_boot_from_rom(){} load_firmware(){}
  needs_restart(){return true} restart(){} free(){} uart_input(){}
 }
 const runtime=new EspRuntime({default:async()=>{},WasmEmulator:ResetMachine},new Uint8Array())
 let serial='';runtime.onSerial=text=>{serial+=text}
 expect(()=>runtime.step(1e6)).toThrow(/requested reset/)
 expect(runtime.nanos).toBe(6400)
 expect(serial).toBe('panic log')
 runtime.dispose()
})
it.skipIf(process.env.M4K3R_ESP_E2E!=='1')('compiles and executes real ESP32-C3 firmware with UART and GPIO',async()=>{
 const home=process.env.M4K3R_HOME??join(homedir(),'M4K3R')
 const cache=mkdtempSync(join(tmpdir(),'m4k3r-esp-build-'))
 const input={platform:'esp32' as const,board:'esp32c3',libs:[],main:'main.ino',files:{'main.ino':`void setup(){ Serial.begin(115200); pinMode(4,OUTPUT); }
void loop(){ digitalWrite(4,HIGH); Serial.println("ESP32 machine code OK"); delay(20); digitalWrite(4,LOW); delay(20); }
`}}
 const built=await build(new Toolchain(home),cache,input)
 expect(built.diagnostics.filter(d=>d.severity==='error')).toEqual([])
 expect(built.ok).toBe(true)
 expect(built.artifacts).toContain('firmware.merged.bin')
 const result=await runEspFirmware(home,readFileSync(join(cache,built.hash,'firmware.merged.bin')),500,60000,'esp32c3')
 expect(result.simulatedMs).toBeGreaterThanOrEqual(500)
 expect(result.serial.Serial).toContain('ESP32 machine code OK')
 expect(result.gpio.GP4?.edges).toBeGreaterThan(2)
},600000)
