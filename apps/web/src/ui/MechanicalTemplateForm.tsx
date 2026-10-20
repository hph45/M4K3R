import { useState,type FormEvent } from "react"
import "./cad.css"
export function MechanicalTemplateForm({busy,onCreate}:{busy:boolean;onCreate(fields:Record<string,unknown>):unknown}){
  const [family,setFamily]=useState("plate");const [name,setName]=useState("Printed mount")
  const [values,setValues]=useState<Record<string,string>>({width:"80",length:"60",height:"25",thickness:"3",holeSpacingX:"30.5",holeSpacingY:"30.5",holeDiameter:"3.4",armWidth:"16"})
  return <form className="cad-form" onSubmit={(e:FormEvent)=>{e.preventDefault();onCreate({name,family,...values})}}>
    <label className="cad-field">Name<input required value={name} onChange={e=>setName(e.target.value)}/></label>
    <label className="cad-field">Family<select value={family} onChange={e=>{setFamily(e.target.value);if(e.target.value==="frame")setValues(v=>({...v,width:"200"}))}}><option value="plate">Mounting plate</option><option value="bracket">L bracket</option><option value="mount">Raised mount</option><option value="frame">Quadcopter frame</option></select></label>
    {Object.entries(values).filter(([key])=>(key!=="armWidth"||family==="frame")&&(key!=="height"||family==="bracket"||family==="mount")).map(([key,value])=><label className="cad-field" key={key}>{({width:family==="frame"?"Motor diagonal (mm)":"Width (mm)",length:family==="frame"?"Center plate size (mm)":"Length (mm)",height:"Height (mm)",thickness:"Thickness (mm)",holeSpacingX:"Hole spacing X (mm)",holeSpacingY:"Hole spacing Y (mm)",holeDiameter:"Hole diameter (mm)",armWidth:"Arm width (mm)"} as Record<string,string>)[key]}<input required value={value} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))}/></label>)}
    <p className="cad-hint">Values accept project variable expressions. The new studio retains an editable feature tree and exact print geometry.</p>
    <button className="primary" disabled={busy}>Create parametric part</button>
  </form>
}
