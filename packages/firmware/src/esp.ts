import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import type { GpioSummary, RunResult } from './runner'
import type { McuRuntime } from '@m4k3r/sim'
import { espChip, type EspChip } from './chips'
export { ESP_CHIPS, espChip, type EspChip } from './chips'

const exec = promisify(execFile)
export const ESP_EMU_VERSION = '0.49.0'
const SHA256 = '95cac1b92b129c859055396c141022bdff318c94b56f90023a9eba22dc2c7555'
interface Machine {
 cycles():number; cycles_per_us():number; run_batch(count:number):string
 gpio_state():Uint32Array; gpio_set_input(pin:number,high:boolean):void
 load_default_rom():void; set_boot_from_rom(enabled:boolean):void; load_firmware(data:Uint8Array):void
 needs_restart():boolean; restart():void; free():void; uart_input(data:Uint8Array):void
}
interface Bindings { default(input:{module_or_path:Uint8Array}):Promise<unknown>; WasmEmulator:new(chip:string)=>Machine }
const installs = new Map<string,Promise<Bindings>>()

/** Official Espressif CPU emulator; pinned, checksum-verified and cached locally. No network bridge is configured. */
export function ensureEspEmulator(home:string):Promise<Bindings> {
 const dir = join(home,'.toolchains',`esp-emu-${ESP_EMU_VERSION}`)
 let job = installs.get(dir)
 if (!job) {
  job = (async()=>{
   const target=join(dir,`esp-emu-${ESP_EMU_VERSION}-wasm`,'www','pkg')
   if (!existsSync(join(target,'esp_emu_bg.wasm'))) {
    const url=`https://github.com/espressif/esp-emulator/releases/download/v${ESP_EMU_VERSION}/esp-emu-${ESP_EMU_VERSION}-wasm.tar.gz`
    const response=await fetch(url)
    if (!response.ok) throw new Error(`ESP emulator download failed: HTTP ${response.status}`)
    const bytes=Buffer.from(await response.arrayBuffer())
    if (createHash('sha256').update(bytes).digest('hex')!==SHA256) throw new Error('ESP emulator checksum mismatch')
    mkdirSync(dir,{recursive:true}); const archive=join(dir,'wasm.tar.gz');writeFileSync(archive,bytes)
    await exec('tar',['-xzf',archive,'-C',dir]);rmSync(archive)
   }
   const bindings = await import(pathToFileURL(join(target,'esp_emu.js')).href) as Bindings
   await bindings.default({module_or_path:readFileSync(join(target,'esp_emu_bg.wasm'))})
   return bindings
  })().catch(e=>{installs.delete(dir);throw e})
  installs.set(dir,job)
 }
 return job
}

/** GPIO-only circuit adapter. ADC/peripheral injection is deliberately absent until the backend exposes it. */
export class EspRuntime implements McuRuntime {
 private readonly machine:Machine
 private state: Uint32Array = new Uint32Array(4)
 private readonly edges = new Uint32Array(64)
 private elapsed = 0
 onSerial?: (text:string)=>void
 readonly capabilities = ['machine-code','uart','digital-gpio'] as const
 constructor(bindings:Bindings, firmware:Uint8Array, chip:EspChip='esp32c3') {
  this.machine=new bindings.WasmEmulator(chip)
  this.machine.load_default_rom();this.machine.set_boot_from_rom(true);this.machine.load_firmware(firmware)
 }
 get nanos() { return this.elapsed }
 step(nanos:number) {
  if (!Number.isFinite(nanos)||nanos<0) throw new Error('ESP step must be finite and nonnegative')
  const cpu=this.machine, start=cpu.cycles(), end=start+nanos/1000*cpu.cycles_per_us()
  let previous=start, count=0
  try { while(cpu.cycles()<end) {
   const output=cpu.run_batch(Math.max(1,Math.min(1024,Math.ceil(end-cpu.cycles()))))
   if(output) this.onSerial?.(output)
   const next=cpu.gpio_state()
   for(let pin=0;pin<64;pin++) {
    const word=pin<32?0:1,mask=1<<(pin%32)
    if((next[word]!&mask)!==(this.state[word]!&mask)) this.edges[pin]!++
   }
   this.state=next
   if(cpu.needs_restart()) throw new Error('ESP firmware requested reset; inspect the UART log for a panic or restart')
   if(cpu.cycles()===previous && ++count>100) throw new Error('ESP emulator stalled without advancing its clock')
   previous=cpu.cycles()
  }} finally {
   // A panic can occur after a completed batch; preserve that executed time.
   this.elapsed+=(cpu.cycles()-start)/cpu.cycles_per_us()*1000
  }
 }
 pin(gpio:number):GpioSummary {
  if(!Number.isInteger(gpio)||gpio<0||gpio>63) throw new Error('ESP GPIO must be 0–63')
  const word=gpio<32?0:1,mask=1<<(gpio%32),enabled=!!(this.state[word+2]!&mask)
  return {state:enabled?this.state[word]!&mask?'high':'low':'input',function:enabled?'gpio':'input',edges:this.edges[gpio]!}
 }
 pins() { return Object.fromEntries(Array.from({length:64},(_,i)=>[i,this.pin(i)] as const).filter(([,s])=>s.function==='gpio').map(([i,s])=>[`GP${i}`,s])) }
 setInput(gpio:number,high:boolean|null) { this.machine.gpio_set_input(gpio,high??true) }
 write(text:string) { this.machine.uart_input(new TextEncoder().encode(text)) }
 dispose() { this.machine.free() }
}

export function espChipForBoard(board:string):EspChip {
 const chip=espChip(board)
 if(!chip) throw new Error(`Build is supported for ${board}, but emulation requires a supported ESP32 C3/C5/C6/H2/P4/S3/S31 board target`)
 return chip
}
export async function runEspFirmware(home:string, firmware:Uint8Array, ms:number, wallMs=30_000, chip:EspChip='esp32c3'):Promise<RunResult & {warnings:string[];complete:boolean}> {
 if(!Number.isFinite(ms)||ms<=0) throw new Error('ESP run duration must be positive')
 const runtime=new EspRuntime(await ensureEspEmulator(home),firmware,chip)
 let text='';runtime.onSerial=chunk=>{text=(text+chunk).slice(-65536)}
 const started=performance.now()
 let fault:string|undefined
 try {
  try { while(runtime.nanos<ms*1e6&&performance.now()-started<wallMs) {
   runtime.step(Math.min(1e6,ms*1e6-runtime.nanos));await new Promise(resolve=>setTimeout(resolve,0))
  }} catch(error) { fault=error instanceof Error?error.message:String(error) }
  return {complete:!fault && runtime.nanos>=ms*1e6,serial:{Serial:text},gpio:runtime.pins(),simulatedMs:runtime.nanos/1e6,wallMs:Math.round(performance.now()-started),warnings:[
   'ESP32 runs real machine code in Espressif ESP-EMU. GPIO transitions are sampled; edge counts are lower bounds. External ADC, PWM waveform and I²C/SPI device coupling are unavailable in this adapter.',
   ...(fault?[`Firmware execution stopped: ${fault}`]:runtime.nanos<ms*1e6?['Wall-clock time limit reached before the requested simulated duration.']:[]),
  ]}
 } finally {runtime.dispose()}
}
