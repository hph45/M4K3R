import { existsSync,writeFileSync } from "node:fs"
import { join } from "node:path"
import { repository,json,run,requireNode } from "./common.mjs"
requireNode()
const packageJson=json(join(repository,"package.json"))
const pinned=packageJson.packageManager.split("@").at(-1)
const reinstall=process.argv.includes("--reinstall")
const installed=existsSync(join(repository,"apps/server/node_modules/tsx/dist/cli.mjs"))
if(!installed||reinstall){
  const {spawnSync}=await import("node:child_process")
  const found=spawnSync("pnpm",["--version"],{encoding:"utf8"})
  if(found.status!==0)throw new Error(`Install pnpm ${pinned} first (npm install --global pnpm@${pinned}), then rerun setup.`)
  if(found.stdout.trim()!==pinned)throw new Error(`Expected pnpm ${pinned}; found ${found.stdout.trim()}. Install the pinned version before setup.`)
  run("pnpm",["install","--frozen-lockfile",...(reinstall?["--force"]:[])],{cwd:repository,env:{...process.env,CI:"true"}})
}
if(!existsSync(join(repository,"apps/web/dist/index.html")))run("pnpm",["build"],{cwd:repository})
if(reinstall&&existsSync(join(repository,"RELEASE_MANIFEST.json"))){
  const manifest=json(join(repository,"RELEASE_MANIFEST.json"))
  // A dependency reinstall changes archive hashes; preserve the original manifest for review.
  writeFileSync(join(repository,"RELEASE_MANIFEST.original.json"),JSON.stringify(manifest,null,2)+"\n")
  manifest.target={platform:process.platform,arch:process.arch,node:process.versions.node};manifest.reinstalledAt=new Date().toISOString()
  const {inventory}=await import("./common.mjs");manifest.files=inventory(repository).filter(file=>file.path!=="RELEASE_MANIFEST.json")
  writeFileSync(join(repository,"RELEASE_MANIFEST.json"),JSON.stringify(manifest,null,2)+"\n")
}
console.log("M4K3R setup ready. Run node scripts/release/start.mjs, then open http://localhost:4400")
