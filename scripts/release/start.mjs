import { existsSync } from "node:fs"
import { join } from "node:path"
import { spawn } from "node:child_process"
import { repository,json,requireNode } from "./common.mjs"
requireNode()
const manifest=join(repository,"RELEASE_MANIFEST.json")
if(existsSync(manifest)){
  const target=json(manifest).target
  if(target.platform!==process.platform||target.arch!==process.arch)throw new Error(`This bundle targets ${target.platform}/${target.arch}; run node scripts/release/setup.mjs --reinstall on this host first`)
}
const cli=join(repository,"apps/server/node_modules/tsx/dist/cli.mjs")
if(!existsSync(cli))throw new Error("Dependencies are missing. Run node scripts/release/setup.mjs first.")
if(!existsSync(join(repository,"apps/web/dist/index.html")))throw new Error("The production UI is missing. Run pnpm build.")
const port=Number(process.env.PORT??4400)
if(!Number.isInteger(port)||port<1||port>65535)throw new Error("PORT must be an integer from 1 to 65535")
const child=spawn(process.execPath,[cli,join(repository,"apps/server/src/index.ts")],{cwd:repository,env:{...process.env,NODE_ENV:"production"},stdio:"inherit"})
for(const signal of ["SIGINT","SIGTERM"])process.on(signal,()=>child.kill(signal))
child.on("error",error=>{console.error(error.message);process.exitCode=1})
child.on("exit",(code,signal)=>{process.exitCode=code??(signal?1:0)})
