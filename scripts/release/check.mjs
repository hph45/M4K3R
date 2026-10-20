import { spawn,spawnSync } from "node:child_process"
import { existsSync,mkdtempSync,readdirSync,rmSync,mkdirSync,writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join,resolve,basename } from "node:path"
import { createServer } from "node:net"
import { repository,json,run,requireNode,verifyInventory,inventory } from "./common.mjs"
requireNode()
let requested=process.argv[2]
if(!requested){if(existsSync(join(repository,"RELEASE_MANIFEST.json")))requested=repository;else requested=json(join(repository,"dist/release/latest.json")).artifacts[0].path}
requested=resolve(requested)
const sandbox=mkdtempSync(join(tmpdir(),"m4k3r-release-check-"));let folder=requested;let child;let logs="";const started=Date.now();const checks=[]
try{
  if(requested.endsWith(".tar.gz")||requested.endsWith(".tgz")){
    const listed=spawnSync("tar",["-tzf",requested],{encoding:"utf8",maxBuffer:32*1024*1024});if(listed.status!==0)throw new Error("Cannot list release archive")
    if(listed.stdout.split("\n").filter(Boolean).some(path=>path.startsWith("/")||path.split("/").includes("..")))throw new Error("Unsafe archive paths")
    const unpack=join(sandbox,"unpacked");mkdirSync(unpack);run("tar",["-xzf",requested,"-C",unpack]);const roots=readdirSync(unpack);if(roots.length!==1)throw new Error("Expected one release folder");folder=join(unpack,roots[0])
  }
  const manifest=json(join(folder,"RELEASE_MANIFEST.json"));verifyInventory(folder,manifest);inventory(folder);checks.push("archive file hashes, relative symlinks and excluded-data inventory")
  if(manifest.target.platform!==process.platform||manifest.target.arch!==process.arch)throw new Error("Release target differs from this host; use setup --reinstall first")
  const probe=createServer();await new Promise((resolve,reject)=>{probe.once("error",reject);probe.listen(0,"127.0.0.1",resolve)});const port=probe.address().port;await new Promise(resolve=>probe.close(resolve))
  const home=join(sandbox,"home");const base=`http://127.0.0.1:${port}`
  child=spawn(process.execPath,[join(folder,"scripts/release/start.mjs")],{cwd:folder,env:{...process.env,PORT:String(port),M4K3R_HOME:home,NODE_PATH:""},stdio:["ignore","pipe","pipe"],detached:process.platform!=="win32"})
  child.stdout.on("data",bytes=>{logs=(logs+bytes).slice(-32768)});child.stderr.on("data",bytes=>{logs=(logs+bytes).slice(-32768)})
  child.on("error",error=>{logs+=error.message})
  let healthy=false
  while(Date.now()-started<45000){if(child.exitCode!==null)throw new Error(`Packaged server exited ${child.exitCode}\n${logs}`);try{const r=await fetch(`${base}/api/health`,{signal:AbortSignal.timeout(1000)});if(r.ok){healthy=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
  if(!healthy)throw new Error(`Packaged server did not become healthy\n${logs}`)
  const request=async(path,body)=>{const response=await fetch(base+path,body===undefined?{}:{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw new Error(`${path}: ${JSON.stringify(value)}`);return value}
  const health=await request("/api/health");if(health.status!=="ok"||health.version!==manifest.version)throw new Error("Packaged health/version mismatch");checks.push("fresh process /api/health and RC version")
  const projects=await request("/api/projects");if(projects.length)throw new Error("Fresh release home unexpectedly contains projects");checks.push("fresh isolated project home starts empty")
  const html=await(await fetch(base)).text();const asset=html.match(/src="([^"]+\/assets\/[^\"]+|\/assets\/[^\"]+)"/);if(!html.includes('id="root"')||!asset)throw new Error("Production UI entry is missing");if(!(await fetch(base+asset[1])).ok)throw new Error("Production UI asset is missing");checks.push("production HTML and compiled UI asset")
  const parts=await request("/api/parts");if(!parts.some(p=>p.id==="screw-m3x8"))throw new Error("Bundled mechanical catalog is missing");checks.push("bundled parts catalog")
  const project=await request("/api/projects",{name:"Disposable release check"})
  await request(`/api/projects/${project.id}/commands`,{commands:[{type:"doc.create",args:{kind:"part-studio",name:"Check plate",data:{features:[{id:"s",type:"sketch",entities:[{id:"r",type:"rectangle",width:20,height:10}]},{id:"body",type:"extrude",sketch:"s",depth:3}]}}},{type:"doc.create",args:{kind:"assembly",name:"Check assembly"}},{type:"assembly.instance.add",args:{doc:"Check assembly",source:{type:"cad",doc:"Check plate"}}},{type:"component.add",args:{part:"screw-m3x8",ref:"MP1"}},{type:"assembly.instance.add",args:{doc:"Check assembly",source:{type:"component",component:"MP1"},position:[30,0,0]}}]})
  const properties=await request(`/api/projects/${project.id}/cad/Check%20plate/properties`);if(Math.abs(properties.volume-600)>.001)throw new Error("Packaged CAD kernel did not evaluate the plate");checks.push("packaged OCCT/PlaneGCS evaluates exact CAD geometry")
  const assembled=await request(`/api/projects/${project.id}/assembly/Check%20assembly/properties`);if(assembled.instances.length!==2||!(assembled.mass>0))throw new Error("Packaged assembly evaluation failed");checks.push("packaged assembly mass and placement API")
  const exported=await fetch(`${base}/api/projects/${project.id}/cad/Check%20plate/export.3mf`);const bytes=new Uint8Array(await exported.arrayBuffer());if(!exported.ok||bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error("Packaged 3MF download failed");checks.push("3MF export archive")
  const drone=await request('/api/demo/drone',{})
  const dronePath=`/api/projects/${drone.id}`
  const airframe=await request(`${dronePath}/assembly/Drone%20assembly/properties`)
  if(airframe.instances.length!==36||airframe.interferences.length||!(airframe.mass>200))throw new Error('Packaged drone assembly has missing parts or fit conflicts')
  checks.push('editable reference drone, exact fit and assembly mass')
  const analysis=await request(`${dronePath}/device-analysis/Flight%20estimates`)
  if(!analysis.massComplete||analysis.missing.length||!(analysis.thrustToWeight>0)||analysis.maximum?.rotors.length!==4)throw new Error('Packaged drone feasibility analysis failed')
  checks.push('assembly-linked rotor and battery feasibility analysis')
  const flight=await request(`${dronePath}/device-analysis/Flight%20estimates/flight`,{duration:0.05,throttle:0,altitude:1})
  if(flight.status!=='duration'||flight.frames.length<2||!(flight.frames.at(-1).position[2]<flight.frames[0].position[2]))throw new Error('Packaged rigid-body flight preview failed')
  checks.push('bounded rigid-body drone preview and gravity')
  const boardChecks=await request(`${dronePath}/pcb/Power%20distribution/drc`)
  if(boardChecks.some(issue=>issue.severity==='error'))throw new Error('Packaged reference board fails DRC')
  checks.push('reference power board passes implemented DRC')
  const fabrication=await fetch(`${base}${dronePath}/pcb/Power%20distribution/fabrication.zip`),fabBytes=new Uint8Array(await fabrication.arrayBuffer())
  if(!fabrication.ok||fabBytes[0]!==0x50||fabBytes[1]!==0x4b)throw new Error('Packaged fabrication ZIP failed')
  checks.push('DRC-gated Gerber/drill/BOM/STEP fabrication archive')
  if(existsSync(join(home,".toolchains")))throw new Error("Basic release startup unexpectedly installed firmware toolchains");checks.push("no firmware toolchain/emulator download on startup")
  const output=join(repository,"dist/release");mkdirSync(output,{recursive:true});const report={ok:true,version:manifest.version,target:manifest.target,artifact:basename(requested),checkedAt:new Date().toISOString(),durationMs:Date.now()-started,checks,isolatedHomeRemoved:true,publicRedistribution:"not determined by this technical check"};writeFileSync(join(output,"check-report.json"),JSON.stringify(report,null,2)+"\n")
  console.log(`Release check passed: ${manifest.version}\n${checks.map(check=>`  ✓ ${check}`).join("\n")}\nFresh test data is removed; no user project home was opened.`)
}finally{
  if(child&&child.exitCode===null){try{process.kill(-child.pid,"SIGTERM")}catch{child.kill("SIGTERM")}await Promise.race([new Promise(resolve=>child.once("exit",resolve)),new Promise(resolve=>setTimeout(resolve,3000))]);if(child.exitCode===null){try{process.kill(-child.pid,"SIGKILL")}catch{child.kill("SIGKILL")}}}
  rmSync(sandbox,{recursive:true,force:true})
}
