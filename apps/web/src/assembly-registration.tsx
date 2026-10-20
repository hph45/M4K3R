import { registerAction,registerDocView } from "./registry"
import { openPalette,openTab,run,useApp } from "./store"
import { AssemblyView } from "./ui/Assembly"
export function newAssembly(){openPalette({placeholder:"Assembly name",initial:"Assembly",async submit(name){if(!name.trim())return;const results=await run([{type:"doc.create",args:{kind:"assembly",name:name.trim()}}],`Create ${name.trim()}`);const result=results?.[0] as {id?:string}|undefined;if(result?.id)openTab(result.id)}})}
registerDocView("assembly",AssemblyView)
registerAction({id:"assembly.new",title:"New mechanical assembly…",when:()=>!!useApp.getState().project,run:newAssembly})
