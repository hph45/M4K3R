import { useEffect, useState } from 'react'
import type { Project } from '@m4k3r/core'
import { DeviceAnalysisData, parseRotorCsv, type DeviceAnalysisResult, type RotorPerformance } from '@m4k3r/sim'

type Data = DeviceAnalysisData
type Rotor = Data['rotors'][number]
interface Props { project: Project; data: Data; detected?: DeviceAnalysisResult['rotors']; onChange(data: Data, label: string): Promise<unknown> }

/** Commits on blur or Enter, so each finished edit is one undo step. */
function Field({label,value,onCommit,number=false,min=0,placeholder,list}:{label:string;value:string|number|undefined;onCommit(value:string|undefined):void;number?:boolean;min?:number;placeholder?:string;list?:string}) {
 const [text,setText]=useState(String(value??''))
 useEffect(()=>setText(String(value??'')),[value])
 const commit=()=>{const next=text.trim();if(next!==String(value??''))onCommit(next||undefined)}
 return <label>{label}<input aria-label={label} type={number?'number':'text'} min={number?min:undefined} step={number?'any':undefined} list={list} placeholder={placeholder} value={text} onChange={e=>setText(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur()}}/></label>
}
const num=(value:string|undefined)=>value===undefined?undefined:Number(value)

/** Physical inputs. Every finished edit saves as a command; rotor data defaults to the motor and propeller parts. */
export function DeviceInputs({project,data,detected,onChange}:Props) {
 const [draft,setDraft]=useState(data),[error,setError]=useState('')
 useEffect(()=>{setDraft(data);setError('')},[data])
 function commit(next:Data,label:string) {
  setDraft(next)
  const parsed=DeviceAnalysisData.safeParse(next)
  if(!parsed.success){const issue=parsed.error.issues[0]!;setError(`Not saved yet: ${issue.path.join('.')} ${issue.message}`.replace(/\s+/g,' '));return}
  setError('');onChange(parsed.data,label).catch(e=>setError(e instanceof Error?e.message:String(e)))
 }
 const set=(values:Partial<Data>,label:string)=>commit({...draft,...values},label)
 const battery=(key:string,label:string)=>(value:string|undefined)=>set({battery:{...draft.battery!,[key]:num(value)}},`Set ${label.toLowerCase()}`)
 // An empty list means "every placed motor"; editing one rotor turns the detected list into explicit entries.
 const rotors:Rotor[]=draft.rotors.length?draft.rotors:(detected??[]).map(({component})=>({component}))
 const rotor=(index:number,values:Partial<Rotor>,label:string)=>set({rotors:rotors.map((item,i)=>i===index?{...item,...values}:item)},label)
 const performance=(index:number,values:Record<string,unknown>,label:string)=>rotor(index,{performance:{...rotors[index]!.performance,...values} as RotorPerformance},label)
 return <div className="device-input-form">
  <h2>Battery</h2>
  <label className="device-input-check"><input type="checkbox" checked={!!draft.battery} onChange={event=>set({battery:event.target.checked?{voltage:11.1,capacityAh:.85,resistance:.08,usableFraction:.8}:undefined},event.target.checked?'Add battery model':'Remove battery model')}/>Include a battery model</label>
  {draft.battery&&<div className="device-input-grid">
   <Field number label="Battery voltage (V)" value={draft.battery.voltage} min={.001} onCommit={battery('voltage','Battery voltage')}/>
   <Field number label="Battery capacity (Ah)" value={draft.battery.capacityAh} min={.001} onCommit={battery('capacityAh','Battery capacity')}/>
   <Field number label="Battery internal resistance (Ω)" value={draft.battery.resistance} onCommit={battery('resistance','Battery resistance')}/>
   <Field number label="Usable charge fraction (0–1)" value={draft.battery.usableFraction} min={.001} onCommit={battery('usableFraction','Usable charge')}/>
   <Field number label="Minimum loaded voltage (V)" value={draft.battery.voltageMin} onCommit={battery('voltageMin','Minimum battery voltage')}/>
   <Field number label="Battery current limit (A)" value={draft.battery.maxCurrent} onCommit={battery('maxCurrent','Battery current limit')}/>
  </div>}
  <h2>Payload and environment</h2>
  <p>Assembly mass already includes placed parts and printed solids. Add wiring, payload or unmodeled hardware here.</p>
  <div className="device-input-grid">
   <Field number label="Additional payload and wiring (g)" value={draft.addedMass} onCommit={value=>set({addedMass:num(value)??0},'Set payload mass')}/>
   <Field number label="Electronics current (A)" value={draft.electronicsCurrent} onCommit={value=>set({electronicsCurrent:num(value)??0},'Set electronics current')}/>
   <Field number label="Air density (kg/m³)" value={draft.airDensity} min={.001} onCommit={value=>set({airDensity:num(value)??1.225},'Set air density')}/>
  </div>
  <h2>Rotors</h2>
  <p>{draft.rotors.length?'Listed rotors.':'Every placed motor is a rotor.'} Thrust data comes from the motor (maxRpm, referenceVoltage, efficiency) and propeller (diameter, ct, cp) properties, so swapping or editing a part updates the estimate. Override a rotor with measured data when you have it. A kV rating alone cannot predict thrust.</p>
  <datalist id="device-component-refs">{project.components.map(c=><option key={c.id} value={c.ref}>{project.parts[c.part]?.name}</option>)}</datalist>
  {rotors.map((item,index)=>{const resolved=detected?.find(r=>r.component===item.component);const name=`Rotor ${index+1}`;return <details className="device-rotor-form" key={index}>
   <summary>{[item.component||name,resolved?.propeller,resolved?.diameter&&`${resolved.diameter} mm`,resolved?.direction?.toUpperCase()].filter(Boolean).join(' · ')} · <span className="muted">{item.performance?.kind==='measured'?'Measured curve':item.performance?'Coefficients override':resolved?.source?'From parts':'Data needed'}</span></summary>
   <div className="device-input-grid">
    <Field label="Motor component" value={item.component} list="device-component-refs" onCommit={value=>rotor(index,{component:value??''},`Set ${name} motor`)}/>
    <Field label="Propeller component" value={item.propeller} list="device-component-refs" placeholder={resolved?.propeller??'Placed on motor'} onCommit={value=>rotor(index,{propeller:value},`Set ${name} propeller`)}/>
    <Field number label={`${name} diameter (mm)`} value={item.diameter} min={.001} placeholder={resolved?.diameter?`${resolved.diameter} from part`:'From propeller'} onCommit={value=>rotor(index,{diameter:num(value)},`Set ${name} diameter`)}/>
    <label>Direction<select aria-label={`${name} direction`} value={item.direction??''} onChange={e=>rotor(index,{direction:(e.target.value||undefined) as Rotor['direction']},`Set ${name} direction`)}><option value="">From motor</option><option value="cw">Clockwise</option><option value="ccw">Counterclockwise</option></select></label>
   </div>
   <label>Performance data<select aria-label={`${name} performance type`} value={item.performance?.kind??''} onChange={e=>rotor(index,{performance:e.target.value==='coefficients'?{kind:'coefficients',referenceVoltage:draft.battery?.voltage??12,efficiency:.8,source:''} as unknown as RotorPerformance:e.target.value==='measured'?{kind:'measured',voltage:draft.battery?.voltage??12,source:'',points:[{throttle:0,thrust:0,current:0},{throttle:1,thrust:0,current:0}]}:undefined},`Set ${name} performance data`)}><option value="">From motor and propeller parts</option><option value="measured">Measured thrust / current curve</option><option value="coefficients">Explicit Ct / Cp coefficients</option></select></label>
   {item.performance&&<>
    <Field label="Data source / test record" value={item.performance.source} placeholder="Dataset URL or your bench measurement record" onCommit={value=>performance(index,{source:value??''},`Set ${name} data source`)}/>
    {item.performance.kind==='coefficients'?<div className="device-input-grid">
     <Field number label={`${name} thrust coefficient Ct`} value={item.performance.ct} min={.000001} onCommit={value=>performance(index,{ct:num(value)},`Set ${name} Ct`)}/>
     <Field number label={`${name} power coefficient Cp`} value={item.performance.cp} min={.000001} onCommit={value=>performance(index,{cp:num(value)},`Set ${name} Cp`)}/>
     <Field number label={`${name} maximum RPM`} value={item.performance.maxRpm} min={1} onCommit={value=>performance(index,{maxRpm:num(value)},`Set ${name} maximum RPM`)}/>
     <Field number label={`${name} reference voltage (V)`} value={item.performance.referenceVoltage} min={.001} onCommit={value=>performance(index,{referenceVoltage:num(value)},`Set ${name} reference voltage`)}/>
     <Field number label={`${name} efficiency (0–1)`} value={item.performance.efficiency} min={.001} onCommit={value=>performance(index,{efficiency:num(value)},`Set ${name} efficiency`)}/>
    </div>:<>
     <Field number label={`${name} curve voltage (V)`} value={item.performance.voltage} min={.001} onCommit={value=>performance(index,{voltage:num(value)},`Set ${name} curve voltage`)}/>
     <label>Import measured CSV<input aria-label={`${name} measured CSV`} type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(!file)return;try{performance(index,{points:parseRotorCsv(await file.text()),source:`User supplied: ${file.name}; not independently verified`},`Import ${name} measured curve`)}catch(error){setError(error instanceof Error?error.message:String(error))}}}/></label>
     <p>CSV columns: throttle (0–1), thrust_N, current_A; optional rpm and torque_Nm. The curve must cover 0 and 1 throttle with nondecreasing thrust and current. Imported measurements are user supplied.</p>
     <table className="device-curve-table"><thead><tr><th>Throttle</th><th>Thrust N</th><th>Current A</th></tr></thead><tbody>{item.performance.points.map((point,i)=><tr key={i}><td>{point.throttle}</td><td>{point.thrust}</td><td>{point.current}</td></tr>)}</tbody></table>
    </>}
   </>}
   <button type="button" className="ghost small" onClick={()=>set({rotors:rotors.filter((_,i)=>i!==index)},`Remove ${item.component||name}`)}>Remove rotor</button>
  </details>})}
  <button type="button" onClick={()=>set({rotors:[...rotors,{component:''}]},'Add rotor')}>＋ Rotor</button>
  {error&&<p className="device-analysis-error" role="alert">{error}</p>}
 </div>
}
