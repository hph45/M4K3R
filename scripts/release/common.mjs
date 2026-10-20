import { createHash } from "node:crypto"
import { existsSync,readFileSync,readdirSync,lstatSync,realpathSync,readlinkSync } from "node:fs"
import { dirname,join,resolve,relative,sep } from "node:path"
import { fileURLToPath } from "node:url"
import { spawnSync } from "node:child_process"
export const repository=resolve(dirname(fileURLToPath(import.meta.url)),"../..")
export const json=(path)=>JSON.parse(readFileSync(path,"utf8"))
export const hash=(path)=>createHash("sha256").update(readFileSync(path)).digest("hex")
export function run(command,args,options={}){const result=spawnSync(command,args,{stdio:"inherit",...options});if(result.error)throw result.error;if(result.status!==0)throw new Error(`${command} failed (${result.status??result.signal})`)}
export function requireNode(){if(Number(process.versions.node.split(".")[0])<24)throw new Error("M4K3R requires Node.js 24 or later");if(!["darwin","linux"].includes(process.platform))throw new Error("The local release launcher currently targets macOS/Linux; Windows firmware toolchains are not supported")}
export const inside=(root,path)=>{const rel=relative(root,path);return rel!==".."&&!rel.startsWith(`..${sep}`)}
export const forbidden=(path)=>path.split(/[\\/]/).some(part=>[".git",".claude",".codex",".local-data",".toolchains",".tools","projects","test-results","playwright-report",".cache",".vite"].includes(part))||/(^|\/)\.env(?:\.|$)/.test(path)
export function inventory(root){
  const realRoot=realpathSync(root)
  const files=[]
  const walk=(directory)=>{for(const entry of readdirSync(directory,{withFileTypes:true})){const full=join(directory,entry.name);const path=relative(root,full).split(sep).join("/");if(forbidden(path))throw new Error(`Release contains excluded data: ${path}`);if(entry.isSymbolicLink()){const link=readlinkSync(full);let target;try{target=realpathSync(full)}catch{throw new Error(`Broken release symlink: ${path}`)}if(!inside(realRoot,target))throw new Error(`Release symlink escapes its folder: ${path}`);files.push({path,link})}else if(entry.isDirectory())walk(full);else if(entry.isFile())files.push({path,bytes:lstatSync(full).size,sha256:hash(full)})}}
  walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path))
}
export function verifyInventory(root,manifest){const realRoot=realpathSync(root);for(const file of manifest.files){const target=join(root,file.path);if(!inside(root,target)||forbidden(file.path))throw new Error(`Unsafe manifest path: ${file.path}`);if(!existsSync(target))throw new Error(`Missing release file: ${file.path}`);if(file.link!==undefined){if(!lstatSync(target).isSymbolicLink()||readlinkSync(target)!==file.link||!inside(realRoot,realpathSync(target)))throw new Error(`Changed release link: ${file.path}`)}else if(hash(target)!==file.sha256)throw new Error(`Checksum mismatch: ${file.path}`)}}
