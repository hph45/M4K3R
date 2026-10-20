import { cpSync,existsSync,lstatSync,mkdirSync,readFileSync,readdirSync,writeFileSync } from "node:fs"
import { join,relative,resolve,basename } from "node:path"
import { repository,json,hash,run,requireNode,inventory,forbidden } from "./common.mjs"
requireNode()
const options=new Set(process.argv.slice(2));const pkg=json(join(repository,"package.json"))
if(!options.has("--skip-build"))run("pnpm",["build"],{cwd:repository})
if(!existsSync(join(repository,"apps/web/dist/index.html")))throw new Error("Build the web app before packaging")
if(!existsSync(join(repository,"node_modules/.pnpm")))throw new Error("Run pnpm install before packaging the host dependency bundle")
const sources=json(join(repository,"scripts/release/sources.json"));const cache=join(repository,".local-data/release-sources")
mkdirSync(cache,{recursive:true})
for(const source of sources){
  const file=join(cache,source.file)
  if(!existsSync(file)||hash(file)!==source.sha256){
    console.log(`Fetching retained source: ${source.file}`)
    const response=await fetch(source.url,{signal:AbortSignal.timeout(180000)})
    if(!response.ok)throw new Error(`Source download failed (${response.status}): ${source.url}`)
    writeFileSync(file,new Uint8Array(await response.arrayBuffer()))
  }
  if(hash(file)!==source.sha256)throw new Error(`Source archive checksum mismatch: ${source.file}`)
}
const output=join(repository,"dist/release");mkdirSync(output,{recursive:true})
const stamp=new Date().toISOString().replace(/[:.]/g,"-")
const name=`m4k3r-${pkg.version??"local-rc"}-${process.platform}-${process.arch}-${stamp}`
const folder=join(output,name);mkdirSync(folder)
const excluded=new Set([".modules.yaml",".pnpm-workspace-state-v1.json",".package-lock.json"])
function copy(path){
  const source=join(repository,path);if(!existsSync(source))return
  const destination=join(folder,path);mkdirSync(resolve(destination,".."),{recursive:true})
  console.log(`Including ${path}`)
  cpSync(source,destination,{recursive:true,verbatimSymlinks:true,filter:from=>!forbidden(relative(repository,from))&&!excluded.has(basename(from))})
}
for(const file of ["package.json","pnpm-lock.yaml","pnpm-workspace.yaml","tsconfig.base.json","vitest.config.ts","playwright.config.ts","README.md","THIRD_PARTY_NOTICES.md"])copy(file)
for(const path of ["apps/server/src","apps/server/package.json","apps/server/tsconfig.json","apps/server/node_modules","apps/web/src","apps/web/package.json","apps/web/tsconfig.json","apps/web/index.html","apps/web/vite.config.ts","apps/web/dist","apps/web/node_modules","packages","library/parts","docs","tests","scripts/release","third_party","node_modules"])copy(path)
const sourceFolder=join(folder,"third_party/sources");mkdirSync(sourceFolder,{recursive:true})
for(const source of sources)cpSync(join(cache,source.file),join(sourceFolder,source.file))
writeFileSync(join(sourceFolder,"manifest.json"),JSON.stringify(sources,null,2)+"\n")

// Every original package stays intact. Copy its license/notice evidence into one browsable index too.
const dependencyFolder=join(folder,"third_party/dependencies");mkdirSync(dependencyFolder,{recursive:true})
const packages=[];const found=new Set()
function record(directory){
  const metadata=join(directory,"package.json");if(!existsSync(metadata))return
  const p=json(metadata);if(!p.name||!p.version)return
  const key=`${p.name}@${p.version}`;if(found.has(key))return;found.add(key)
  const notices=readdirSync(directory).filter(file=>/^(licen[cs]e|copying|notice|third.?party|authors)/i.test(file)&&lstatSync(join(directory,file)).isFile())
  const target=join(dependencyFolder,key.replace(/[^A-Za-z0-9_.@-]+/g,"_"));mkdirSync(target,{recursive:true})
  for(const notice of notices)cpSync(join(directory,notice),join(target,notice))
  packages.push({name:p.name,version:p.version,license:p.license??p.licenses??"not declared",repository:typeof p.repository==="string"?p.repository:p.repository?.url,licenseFiles:notices.map(file=>relative(join(folder,"third_party"),join(target,file)).split("\\").join("/"))})
}
for(const entry of readdirSync(join(folder,"node_modules/.pnpm"),{withFileTypes:true})){
  if(!entry.isDirectory()||entry.name==="node_modules")continue
  const modules=join(folder,"node_modules/.pnpm",entry.name,"node_modules");if(!existsSync(modules))continue
  for(const item of readdirSync(modules,{withFileTypes:true})){
    if(!item.isDirectory()||item.isSymbolicLink())continue
    const directory=join(modules,item.name)
    if(item.name.startsWith("@")){for(const scoped of readdirSync(directory,{withFileTypes:true}))if(scoped.isDirectory()&&!scoped.isSymbolicLink())record(join(directory,scoped.name))}
    else record(directory)
  }
}
packages.sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version))
writeFileSync(join(folder,"third_party/dependency-inventory.json"),JSON.stringify(packages,null,2)+"\n")
writeFileSync(join(dependencyFolder,"README.md"),"# Installed dependency notices\n\nGenerated from the actual package files in this local host bundle. Original packages and any nested notices remain in node_modules. Packages without top-level license files are explicitly listed in the inventory for review.\n\n| Package | Version | Declared license | Copied notice files |\n|---|---|---|---|\n"+packages.map(p=>`| ${p.name} | ${p.version} | ${typeof p.license==="string"?p.license:JSON.stringify(p.license)} | ${p.licenseFiles.map(file=>`[${basename(file)}](../${file})`).join(", ")||"No top-level file supplied"} |`).join("\n")+"\n")
const attributions=readdirSync(join(folder,"library/parts")).map(id=>{const p=json(join(folder,"library/parts",id,"part.json"));return{id:p.id,name:p.name,symbolSource:p.symbol?.source,footprintSource:p.footprint?.source,physicalSource:p.physical?.source,modifications:"Converted to M4K3R JSON geometry/pin representation; generic physical planning metadata added where present"}})
writeFileSync(join(folder,"third_party/library-attribution.json"),JSON.stringify(attributions,null,2)+"\n")
writeFileSync(join(folder,"start.sh"),'#!/bin/sh\nset -eu\nbundle_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)\nexec node "$bundle_root/scripts/release/start.mjs" "$@"\n',{mode:0o755})
writeFileSync(join(folder,"LOCAL_RELEASE.md"),`# M4K3R ${pkg.version} — unpublished local release candidate\n\nTarget: ${process.platform}/${process.arch}; Node.js 24+ must be installed. Dependencies and the production UI are included; no pnpm or network is required to start this matching-host bundle.\n\nRun \`./start.sh\` (or \`node scripts/release/start.mjs\`) and open http://127.0.0.1:4400. Set PORT and M4K3R_HOME if needed. A fresh installation saves projects under ~/M4K3R; this archive contains no saved project home or firmware toolchains.\n\nRun \`node scripts/release/check.mjs .\` for isolated health/API/CAD/assembly verification. Compiler cores, Arduino libraries and the ESP emulator download only on first requested build/emulation; see docs/setup.md.\n\nThis is a local RC, not a public licensing approval. Read THIRD_PARTY_NOTICES.md and third_party/README.md. First-party licensing has not been selected. Retained source archives and license evidence are included.\n`)
const manifest={name:"M4K3R",version:pkg.version,status:"unpublished-local-release-candidate",createdAt:new Date().toISOString(),target:{platform:process.platform,arch:process.arch,node:process.versions.node},minimumNodeMajor:24,sourceSnapshot:"working tree; no VCS metadata included",publicRedistribution:"not determined; first-party license not selected",omitted:["private project homes","user imported parts/caches","Arduino SDK/compiler toolchains","ESP emulator downloads","browser binaries","VCS/worktrees","environment credentials"],retainedSourceArchives:sources,dependencyCount:packages.length,files:inventory(folder)}
writeFileSync(join(folder,"RELEASE_MANIFEST.json"),JSON.stringify(manifest,null,2)+"\n")
const archive=join(output,`${name}.tar.gz`)
run("tar",["-czf",archive,"-C",output,name])
const artifacts=[{path:archive,sha256:hash(archive)}]
if(options.has("--zip")){const zip=join(output,`${name}.zip`);run("zip",["-q","-r","-y",zip,name],{cwd:output});artifacts.push({path:zip,sha256:hash(zip)})}
writeFileSync(join(output,"latest.json"),JSON.stringify({directory:folder,artifacts,version:pkg.version,target:manifest.target},null,2)+"\n")
for(const artifact of artifacts)writeFileSync(`${artifact.path}.sha256`,`${artifact.sha256}  ${basename(artifact.path)}\n`)
console.log(`\nLocal RC ready: ${folder}\n${artifacts.map(a=>a.path).join("\n")}\n${manifest.files.length} files/links checked; ${packages.length} installed dependency notices indexed.\nRun pnpm release:check to verify the archive in an isolated fresh home.`)
