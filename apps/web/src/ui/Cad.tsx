import type { BodyMesh, Feature, FeatureStatus, Material, PartStudio, Sketch, SolvedSketch } from "@m4k3r/cad"
import type { Command } from "@m4k3r/core"
import { useEffect, useState, type FormEvent, type ReactNode } from "react"
import type { DocViewProps } from "../registry"
import { openTab,run, toast } from "../store"
import { CadViewport,type FacePick } from "./CadViewport"
import { MechanicalTemplateForm } from "./MechanicalTemplateForm"
import "./cad.css"

interface MeshResult {
  version: number
  bodies: BodyMesh[]
  features: FeatureStatus[]
  error?: { feature: string; message: string }
}
interface Properties { volume: number; mass: number; bbox: { size: number[] } | null }
type Editor = "sketch" | "extrude" | "shell" | "template" | null
const materials: Material[] = ["PLA", "PETG", "ABS", "ASA", "TPU", "aluminum", "steel"]
const endpoint = (project: string, doc: string) => `/api/projects/${encodeURIComponent(project)}/cad/${encodeURIComponent(doc)}`
const number = (n: number) => new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n)

async function get<T>(url: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(url, { signal })
  const data = await response.json()
  if (!response.ok) throw new Error(data.error ?? `Request failed (${response.status})`)
  return data
}

export function Cad({ project, doc }: DocViewProps) {
  return <CadWorkspace key={`${project.id}/${doc.id}`} project={project} doc={doc} />
}

function CadWorkspace({ project, doc }: DocViewProps) {
  const data = doc.data as PartStudio
  const [mesh, setMesh] = useState<MeshResult | null>(null)
  const [props, setProps] = useState<Properties | null>(null)
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [selected, setSelected] = useState("")
  const [editor, setEditor] = useState<Editor>(null)
  const [until, setUntil] = useState("")
  const [pickingFace,setPickingFace]=useState(false)
  const [pickedFace,setPickedFace]=useState<Sketch["face"]>()
  const path = endpoint(project.id, doc.id)
  const feature = data.features.find((f) => f.id === selected)
  const featureIndex = feature ? data.features.indexOf(feature) : data.features.length
  const sketches = data.features.filter((f): f is Sketch => f.type === "sketch" && !f.suppressed)
  const earlierSketches = sketches.filter((f) => data.features.indexOf(f) < featureIndex)
  const earlierBodies = (mesh?.bodies ?? []).filter((b) => data.features.findIndex((f) => f.id === b.id) < featureIndex)
  const statuses = new Map(mesh?.features.map((f) => [f.id, f]) ?? [])
  const outlines: SolvedSketch[] = (mesh?.features ?? []).flatMap((f) => f.sketch && (!mesh?.bodies.length || f.id === selected) ? [f.sketch] : [])

  useEffect(() => {
    const abort = new AbortController()
    const query = until ? `?until=${encodeURIComponent(until)}` : ""
    setLoading(true); setError("")
    Promise.all([get<MeshResult>(`${path}/mesh${query}`, abort.signal), get<Properties>(`${path}/properties${query}`, abort.signal)])
      .then(([m, p]) => { setMesh(m); setProps(p) })
      .catch((e: unknown) => { if (!abort.signal.aborted) setError(e instanceof Error ? e.message : String(e)) })
      .finally(() => { if (!abort.signal.aborted) setLoading(false) })
    return () => abort.abort()
  }, [path, project.version, until])

  const apply = async (commands: Command[], label: string) => {
    setBusy(true)
    try {
      const results = await run(commands, label)
      if (results) {
        const result = results.at(-1) as { id?: string } | undefined
        if (result?.id) setSelected(result.id)
        setEditor(null); setUntil("")
      }
      return !!results
    } finally { setBusy(false) }
  }
  const update = (f: Feature, set: object) => apply([{ type: "cad.feature.update", args: { doc: doc.id, feature: f.id, set } }], `Edit ${f.id}`)
  const add = (f: object) => apply([{ type: "cad.feature.add", args: { doc: doc.id, feature: f } }], `Add ${(f as { type: string }).type}`)
  const example = () => apply([
    { type: "cad.sketch.add", args: { doc: doc.id, id: "base", entities: [{ type: "rectangle", id: "outline", width: 70, height: 45 }] } },
    { type: "cad.feature.add", args: { doc: doc.id, feature: { type: "extrude", id: "case", sketch: "base", depth: 22 } } },
    { type: "cad.feature.add", args: { doc: doc.id, feature: { type: "fillet", id: "corners", edges: { direction: "z" }, radius: 4 } } },
    { type: "cad.feature.add", args: { doc: doc.id, feature: { type: "shell", id: "walls", faces: { normal: "+z" }, thickness: 2 } } },
  ], "Create enclosure example")
  const download = async (format: "stl" | "step" | "3mf") => {
    try {
      const response = await fetch(`${path}/export.${format}`)
      if (!response.ok) throw new Error((await response.json()).error ?? "Export failed")
      const url = URL.createObjectURL(await response.blob())
      const a = document.createElement("a")
      a.href = url; a.download = `${doc.name.replace(/[^\w.-]+/g, "-")}.${format}`; a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) { toast(e instanceof Error ? e.message : String(e)) }
  }

  return <div className="cad-workspace">
    <div className="cad-toolbar">
      <strong>Part studio</strong>
      <button disabled={busy} onClick={() => { setSelected("");setPickedFace(undefined); setEditor("sketch") }}>＋ Sketch</button>
      <button disabled={busy||!mesh?.bodies.length} onClick={()=>{setPickingFace(!pickingFace);setEditor(null)}}>{pickingFace?"Cancel face pick":"Sketch on face"}</button>
      <button disabled={busy || !sketches.length} onClick={() => { setSelected(""); setEditor("extrude") }}>Extrude</button>
      <button disabled={busy || !mesh?.bodies.length} onClick={() => { setSelected(""); setEditor("shell") }}>Shell</button>
      <button onClick={()=>{setSelected("");setEditor("template")}}>Parametric part…</button>
      <span className="spacer" />
      <span className="cad-loading">{loading ? "Regenerating…" : `${mesh?.bodies.length ?? 0} bodies`}</span>
      <button disabled={loading || !mesh?.bodies.length || !!mesh.error} onClick={() => download("stl")}>Export STL</button>
      <button disabled={loading || !mesh?.bodies.length || !!mesh.error} onClick={() => download("step")}>STEP</button>
      <button disabled={loading || !mesh?.bodies.length || !!mesh.error} onClick={() => download("3mf")}>3MF</button>
    </div>

    <aside className="cad-features">
      <div className="cad-section-title">Features <span>{data.features.length}</span></div>
      {!data.features.length && <p className="cad-hint">Start with a sketch, then extrude a closed profile into a solid.</p>}
      {data.features.map((f, i) => {
        const status = statuses.get(f.id)
        return <button key={f.id} className="cad-feature" data-selected={selected === f.id || undefined} data-state={status?.status}
          title={status?.error ?? `${f.type}${f.suppressed ? " (suppressed)" : ""}`} onClick={() => { setSelected(f.id); setEditor(null) }}>
          <span className="cad-feature-number">{i + 1}</span>
          <span className="cad-feature-label">{f.id}<small>{f.type}{f.suppressed ? " · suppressed" : ""}</small></span>
          <span className="cad-feature-status">{status?.status === "error" ? "!" : status?.status === "suppressed" ? "○" : status?.status === "skipped" ? "−" : "✓"}</span>
        </button>
      })}
      {until && <div className="cad-rollback"><p>Rolled back to {until}</p><button onClick={() => setUntil("")}>Show full model</button></div>}
      <div className="cad-material">
        <label>Material<select aria-label="Material" value={data.material} disabled={busy} onChange={(e) => apply([{ type: "cad.material.set", args: { doc: doc.id, material: e.target.value } }], "Change material")}>
          {materials.map((m) => <option key={m}>{m}</option>)}
        </select></label>
        {props && <dl><dt>Volume</dt><dd>{number(props.volume / 1000)} cm³</dd><dt>Mass</dt><dd>{number(props.mass)} g</dd>{props.bbox && <><dt>Size</dt><dd>{props.bbox.size.map(number).join(" × ")} mm</dd></>}</dl>}
      </div>
    </aside>

    <div className="cad-scene">
      <CadViewport bodies={mesh?.bodies ?? []} sketches={outlines} onFacePick={pickingFace?(hit:FacePick)=>{setPickedFace({body:hit.body,query:{near:hit.near}});setPickingFace(false);setSelected("");setEditor("sketch")}:undefined}/>
      {pickingFace&&<div className="cad-pick-hint">Click inside a planar face to start a sketch there.</div>}
      {error && <div className="cad-error" role="alert">{error}</div>}
      {mesh?.error && <div className="cad-error" role="alert"><strong>{mesh.error.feature}</strong>: {mesh.error.message}</div>}
      {!data.features.length && !editor && <div className="cad-welcome"><strong>Shape your next build</strong><p>Sketch on a plane and turn it into a part.<br />Dimensions accept mm and project variables.</p><button className="primary" onClick={() => setEditor("sketch")}>Create sketch</button><button onClick={example} disabled={busy}>Try an enclosure example</button></div>}
    </div>

    {(editor || feature) && <aside className="cad-inspector">
      <header><strong>{editor ? `New ${editor}` : feature!.id}</strong><button className="ghost icon" title="Close inspector" onClick={() => { setEditor(null); setSelected("") }}>×</button></header>
      {editor==="template"&&<MechanicalTemplateForm busy={busy} onCreate={async fields=>{const results=await run([{type:"cad.template.create",args:fields}],"Create parametric part");const created=results?.[0] as {id?:string}|undefined;if(created?.id)openTab(created.id)}}/>}
      {(editor === "sketch" || feature?.type === "sketch") && <SketchForm key={feature ? JSON.stringify(feature) : `new-sketch/${JSON.stringify(pickedFace)}`} feature={feature?.type === "sketch" ? feature : undefined} face={feature?undefined:pickedFace} busy={busy} onSave={(fields) => feature?.type === "sketch" ? update(feature, fields) : add({ type: "sketch", ...fields })} />}
      {(editor === "extrude" || feature?.type === "extrude") && <ExtrudeForm key={feature ? JSON.stringify(feature) : "new-extrude"} feature={feature?.type === "extrude" ? feature : undefined} sketches={earlierSketches} bodies={earlierBodies} busy={busy} onSave={(fields) => feature?.type === "extrude" ? update(feature, fields) : add({ type: "extrude", ...fields })} />}
      {(editor === "shell" || feature?.type === "shell") && <ShellForm key={feature ? JSON.stringify(feature) : "new-shell"} feature={feature?.type === "shell" ? feature : undefined} bodies={earlierBodies} busy={busy} onSave={(fields) => feature?.type === "shell" ? update(feature, fields) : add({ type: "shell", ...fields })} />}
      {feature && <div className="cad-feature-actions">
        {statuses.get(feature.id)?.sketch && <p className="cad-hint">{statuses.get(feature.id)!.sketch!.status === "full" ? "Fully defined" : `${statuses.get(feature.id)!.sketch!.dof} degrees of freedom`}</p>}
        {!["sketch", "extrude", "shell"].includes(feature.type) && <p className="cad-hint">This feature can be edited with CAD commands in the API or MCP.</p>}
        <button disabled={busy} onClick={() => update(feature, { suppressed: !feature.suppressed })}>{feature.suppressed ? "Unsuppress" : "Suppress"} feature</button>
        <button onClick={() => setUntil(feature.id)}>Roll back to here</button>
        <button className="cad-delete" disabled={busy} onClick={async () => { if (await apply([{ type: "cad.feature.remove", args: { doc: doc.id, feature: feature.id } }], `Remove ${feature.id}`)) setSelected("") }}>Delete feature</button>
      </div>}
    </aside>}
  </div>
}

function Field({ label, children }: { label: string; children: ReactNode }) { return <label className="cad-field"><span>{label}</span>{children}</label> }
function Dimension({ label, value, set }: { label: string; value: string; set(value: string): void }) {
  return <Field label={label}><input required value={value} onChange={(e) => set(e.target.value)} spellCheck={false} /></Field>
}
function SketchForm({ feature,face, busy, onSave }: { feature?: Sketch;face?:Sketch["face"]; busy: boolean; onSave(fields: object): unknown }) {
  const entity = feature?.entities[0]
  const canEdit = !feature || (feature.entities.length === 1 && (entity?.type === "rectangle" || entity?.type === "circle"||entity?.type==="spline") && !feature.constraints.length)
  const [shape, setShape] = useState(entity?.type === "circle" ? "circle" :entity?.type==="spline"?"spline": "rectangle")
  const [points,setPoints]=useState(entity?.type==="spline"?entity.points.map(p=>p.join(", ")).join("\n"):"-20, -10\n0, -20\n20, -10\n15, 15\n-15, 15")
  const [closed,setClosed]=useState(entity?.type==="spline"?entity.closed:true)
  const [plane, setPlane] = useState(feature?.plane ?? "XY")
  const [offset, setOffset] = useState(String(feature?.offset ?? 0))
  const [width, setWidth] = useState(String(entity?.type === "rectangle" ? entity.width : 40))
  const [height, setHeight] = useState(String(entity?.type === "rectangle" ? entity.height : 30))
  const [radius, setRadius] = useState(String(entity?.type === "circle" ? entity.radius : 10))
  const [x, setX] = useState(String(entity?.type === "circle" ? entity.center[0] : entity?.type === "rectangle" ? (entity.center?.[0] ?? entity.corner?.[0] ?? 0) : 0))
  const [y, setY] = useState(String(entity?.type === "circle" ? entity.center[1] : entity?.type === "rectangle" ? (entity.center?.[1] ?? entity.corner?.[1] ?? 0) : 0))
  const save = (e: FormEvent) => {
    e.preventDefault()
    const geometry = shape==="spline"?{type:"spline",id:entity?.id??"profile",points:points.split(/\n/).filter(s=>s.trim()).map(line=>line.split(",").map(s=>s.trim())),closed}:shape === "circle" ? { type: "circle", id: entity?.id ?? "profile", center: [x, y], radius } : { type: "rectangle", id: entity?.id ?? "profile", width, height, [entity?.type === "rectangle" && entity.corner ? "corner" : "center"]: [x, y] }
    onSave({ plane, offset,...(feature?.face||face?{face:feature?.face??face}:{}), ...(canEdit ? { entities: [geometry] } : {}) })
  }
  return <form className="cad-form" onSubmit={save}>
    {feature?.face||face?<p className="cad-hint">On picked face of {(feature?.face??face)?.body??"body"}. Dimensions use a local plane at the face center.</p>:<Field label="Plane"><select value={plane} onChange={(e) => setPlane(e.target.value as Sketch["plane"])}><option>XY</option><option>XZ</option><option>YZ</option></select></Field>}
    <Dimension label="Plane offset (mm)" value={offset} set={setOffset} />
    {canEdit ? <><Field label="Profile"><select value={shape} onChange={(e) => setShape(e.target.value)}><option value="rectangle">Rectangle</option><option value="circle">Circle</option><option value="spline">Interpolating spline</option></select></Field>
      {shape==="spline"?<><Field label="Points: one x, y pair per line (mm)"><textarea aria-label="Spline points" rows={7} value={points} onChange={e=>setPoints(e.target.value)}/></Field><label className="cad-check"><input type="checkbox" checked={closed} onChange={e=>setClosed(e.target.checked)}/>Closed spline</label></>:shape === "rectangle" ? <><Dimension label="Width (mm)" value={width} set={setWidth} /><Dimension label="Height (mm)" value={height} set={setHeight} /></> : <Dimension label="Radius (mm)" value={radius} set={setRadius} />}
      {shape!=="spline"&&<><Dimension label={entity?.type === "rectangle" && entity.corner ? "Corner X (mm)" : "Center X (mm)"} value={x} set={setX} /><Dimension label={entity?.type === "rectangle" && entity.corner ? "Corner Y (mm)" : "Center Y (mm)"} value={y} set={setY} /></>}
    </> : <p className="cad-hint">{feature!.entities.length} entities, {feature!.constraints.length} constraints. Edit geometry through the CAD API or MCP.</p>}
    <p className="cad-hint">Use numbers or expressions, e.g. 40 mm or board_width + 4.</p>
    <button className="primary" disabled={busy}>{feature ? "Apply changes" : "Create sketch"}</button>
  </form>
}

function ExtrudeForm({ feature, sketches, bodies, busy, onSave }: { feature?: Extract<Feature, { type: "extrude" }>; sketches: Sketch[]; bodies: BodyMesh[]; busy: boolean; onSave(fields: object): unknown }) {
  const [sketch, setSketch] = useState(feature?.sketch ?? sketches.at(-1)?.id ?? "")
  const [depth, setDepth] = useState(String(feature?.depth ?? 10))
  const [op, setOp] = useState(feature?.op ?? (feature && bodies.length ? "add" : "new"))
  const [reverse, setReverse] = useState(feature?.reverse ?? false)
  const [symmetric, setSymmetric] = useState(feature?.symmetric ?? false)
  const [through, setThrough] = useState(feature?.through ?? false)
  const [body, setBody] = useState(feature?.body ?? bodies[0]?.id ?? "")
  return <form className="cad-form" onSubmit={(e) => { e.preventDefault(); onSave({ sketch, depth, op, reverse, symmetric, through, ...(op === "new" ? (feature ? { body: null } : {}) : body ? { body } : {}) }) }}>
    <Field label="Sketch"><select required value={sketch} onChange={(e) => setSketch(e.target.value)}>{sketches.map((s) => <option key={s.id}>{s.id}</option>)}</select></Field>
    <Field label="Operation"><select value={op} onChange={(e) => setOp(e.target.value as typeof op)}><option value="new">New body</option><option value="add">Add material</option><option value="subtract">Remove material</option><option value="intersect">Intersect</option></select></Field>
    {op !== "new" && bodies.length > 1 && <Field label="Target body"><select value={body} onChange={(e) => setBody(e.target.value)}>{bodies.map((b) => <option key={b.id}>{b.id}</option>)}</select></Field>}
    {!through && <Dimension label="Depth (mm)" value={depth} set={setDepth} />}
    <label className="cad-check"><input type="checkbox" checked={reverse} onChange={(e) => setReverse(e.target.checked)} />Reverse direction</label>
    <label className="cad-check"><input type="checkbox" checked={symmetric} onChange={(e) => setSymmetric(e.target.checked)} />Symmetric</label>
    <label className="cad-check"><input type="checkbox" checked={through} onChange={(e) => setThrough(e.target.checked)} />Through all</label>
    <button className="primary" disabled={busy || !sketch}>{feature ? "Apply changes" : "Extrude"}</button>
  </form>
}

function ShellForm({ feature, bodies, busy, onSave }: { feature?: Extract<Feature, { type: "shell" }>; bodies: BodyMesh[]; busy: boolean; onSave(fields: object): unknown }) {
  const [thickness, setThickness] = useState(String(feature?.thickness ?? 2))
  const face = feature?.faces && !Array.isArray(feature.faces) ? feature.faces.normal : undefined
  const [normal, setNormal] = useState(face ?? "+z")
  const [body, setBody] = useState(feature?.body ?? bodies[0]?.id ?? "")
  return <form className="cad-form" onSubmit={(e) => { e.preventDefault(); onSave({ thickness, faces: { normal }, ...(body ? { body } : {}) }) }}>
    {bodies.length > 1 && <Field label="Target body"><select value={body} onChange={(e) => setBody(e.target.value)}>{bodies.map((b) => <option key={b.id}>{b.id}</option>)}</select></Field>}
    <Dimension label="Wall thickness (mm)" value={thickness} set={setThickness} />
    <Field label="Open face"><select value={normal} onChange={(e) => setNormal(e.target.value as typeof normal)}>{["+z", "-z", "+x", "-x", "+y", "-y"].map((n) => <option key={n}>{n}</option>)}</select></Field>
    <p className="cad-hint">Remove the chosen face and hollow the part inward.</p>
    <button className="primary" disabled={busy}>{feature ? "Apply changes" : "Create shell"}</button>
  </form>
}
