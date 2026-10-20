import { existsSync,mkdtempSync,mkdirSync,writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect,it } from 'vitest'
import { build,type Toolchain } from './index'

it('isolates concurrent build caches and still coalesces requests to the same output folder',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'m4k3r-build-cache-'))
 let compilations=0
 const tc={ensure:async()=>{},compileArgs:[],libDir:()=>'',run:async(args:string[])=>{
  compilations++
  await new Promise(resolve=>setTimeout(resolve,5))
  const output=args[args.indexOf('--build-path')+1]!
  mkdirSync(output,{recursive:true})
  for(const ext of ['elf','uf2'])writeFileSync(join(output,`main.ino.${ext}`),'compiled bytes')
  return{ok:true,stdout:JSON.stringify({success:true})}
 }} as unknown as Toolchain
 const input={board:'rpipico',libs:[],main:'main.ino',files:{'main.ino':'void setup(){} void loop(){}'}}
 const [first,coalesced,other]=await Promise.all([build(tc,join(dir,'a'),input),build(tc,join(dir,'a'),input),build(tc,join(dir,'b'),input)])
 expect(compilations).toBe(2)
 expect(first).toEqual(coalesced)
 for(const cache of ['a','b'])expect(existsSync(join(dir,cache,other.hash,'firmware.uf2'))).toBe(true)
})
