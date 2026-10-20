import { mkdirSync,writeFileSync } from "node:fs"
import { dirname,join } from "node:path"
import { Assembly,assemblyCommands } from "@m4k3r/assembly"
import { assemblySummary,evaluateAssembly,exportAssembly } from "@m4k3r/assembly/node"
import { findDoc,registerDocKind } from "@m4k3r/core"
import { z } from "zod"
import { tool,type Domain,type DomainContext } from "../domain"
const formats={stl:"model/stl",step:"model/step","3mf":"model/3mf"} as const
const name=(value:string)=>value.replace(/[^\w.-]+/g,"-")
async function evaluate(ctx:DomainContext,project:string,key:string,interference=true) {
  const p=ctx.store.get(project);const doc=findDoc(p,key,"assembly")
  return {p,doc,result:await evaluateAssembly(p,doc,{interference})}
}
export const assembly:Domain={
  name:"assembly",commands:assemblyCommands,setup(){registerDocKind("assembly",Assembly)},
  routes(router,ctx) {
    router.get("/projects/:id/assembly/:doc/mesh",async(req,res)=>{
      const {p,result}=await evaluate(ctx,req.params.id,req.params.doc,req.query.interference==="1")
      const {solids,...data}=result;res.json({version:p.version,...data})
    })
    router.get("/projects/:id/assembly/:doc/properties",async(req,res)=>res.json(assemblySummary((await evaluate(ctx,req.params.id,req.params.doc)).result)))
    router.get("/projects/:id/assembly/:doc/interference",async(req,res)=>{
      const {result}=await evaluate(ctx,req.params.id,req.params.doc)
      res.json({interferences:result.interferences,warnings:result.warnings})
    })
    for(const [format,type] of Object.entries(formats))router.get(`/projects/:id/assembly/:doc/export.${format}`,async(req,res)=>{
      const {doc,result}=await evaluate(ctx,req.params.id,req.params.doc,false)
      if(req.query.printable==="1")result.instances=result.instances.filter(i=>i.source.type==="cad")
      if(typeof req.query.instance==="string")result.instances=result.instances.filter(i=>i.id===req.query.instance)
      const bytes=await exportAssembly(result,format as keyof typeof formats)
      res.type(type).attachment(`${name(doc.name)}.${format}`).send(Buffer.from(bytes))
    })
  },
  tools(server,ctx) {
    const project=z.string();const doc=z.string()
    server.registerTool("assembly_properties",{description:"Evaluate assembly placements, sourced mass, world center of gravity and full inertia tensor, mount anchors, bounds, solid interference and keepout checks. Units g/mm/g·mm². Physical proxy geometry and estimated masses are explicitly identified.",inputSchema:{project,doc}},tool(async(a:{project:string;doc:string})=>assemblySummary((await evaluate(ctx,a.project,a.doc)).result)))
    server.registerTool("assembly_interference",{description:"Check real positive-volume solid overlaps and oriented-box keepout violations against actual solids (bounds fallback is reported) between assembly instances. Contact surfaces without positive volume are allowed.",inputSchema:{project,doc}},tool(async(a:{project:string;doc:string})=>{const {result}=await evaluate(ctx,a.project,a.doc);return{interferences:result.interferences,warnings:result.warnings}}))
    server.registerTool("assembly_export",{description:"Export assembly placements to STEP, STL or standards-based 3MF. printableOnly selects CAD studio instances for printing. Catalog geometry is a dimensional proxy, not a manufacturer STEP model.",inputSchema:{project,doc,format:z.enum(["step","stl","3mf"]),printableOnly:z.boolean().optional(),path:z.string().optional()}},tool(async(a:{project:string;doc:string;format:keyof typeof formats;printableOnly?:boolean;path?:string})=>{
      const {doc:d,result}=await evaluate(ctx,a.project,a.doc,false)
      if(a.printableOnly)result.instances=result.instances.filter(i=>i.source.type==="cad")
      const bytes=await exportAssembly(result,a.format);const path=a.path??join(ctx.home,"exports",a.project,`${name(d.name)}.${a.format}`)
      mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);return{path,bytes:bytes.length}
    }))
  },
}
