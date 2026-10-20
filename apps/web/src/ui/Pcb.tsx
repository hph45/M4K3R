import type { Command, Component, Project } from "@m4k3r/core"
import { boardCopper, drc, footprintPoint, placedPads, pcbDrills, pcbGeometry, ratsnest, routeBetween, type BoardPlacement, type CopperLayer, type ElectricalIssue, type MultiPolygon, type PcbData, type Point2 } from "@m4k3r/ecad"
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react"
import type { DocViewProps } from "../registry"
import { run, selectComponent, toast, useApp } from "../store"
import { CadViewport } from "./CadViewport"
import { Editable } from "./Editable"

type Tool = "select" | "route" | "outline" | "zone" | "hole"
const path = (poly: MultiPolygon) => poly.flatMap((p) => p.map((ring) => `M${ring.map((v) => v.join(" ")).join("L")}Z`)).join(" ")
const pointsText = (points: Point2[]) => points.map((p) => p.join(", ")).join("\n")
const parsePoints = (text: string): Point2[] => text.trim().split(/\n|;/).filter(Boolean).map((row) => { const n = row.trim().split(/[\s,]+/).map(Number); if (n.length !== 2 || !n.every(Number.isFinite)) throw new Error("Use one x, y pair per line"); return [n[0]!, n[1]!] })

export function Pcb(props: DocViewProps) { return <PcbWorkspace key={`${props.project.id}/${props.doc.id}`} {...props} /> }
function PcbWorkspace({ project, doc }: DocViewProps) {
  const data = doc.data as PcbData, selectedComponent = useApp((s) => s.selection.component)
  const [tool, setTool] = useState<Tool>("select"), [layer, setLayer] = useState<CopperLayer>("F.Cu"), [net, setNet] = useState(project.nets[0]?.id ?? ""), [width, setWidth] = useState(0.25)
  const [selected, setSelected] = useState(""), [drawing, setDrawing] = useState<Point2[]>([]), [cursor, setCursor] = useState<Point2>([0, 0]), [drag, setDrag] = useState<{ component: string; at: Point2 } | null>(null)
  const [view3d, setView3d] = useState(false), [holeDiameter, setHoleDiameter] = useState(3.2), [thermal, setThermal] = useState(true), [showRatsnest, setShowRatsnest] = useState(true)
  const [camera, setCamera] = useState<{ x: number; y: number; width: number; height: number } | null>(null), [error, setError] = useState("")
  const svg = useRef<SVGSVGElement>(null), gesture = useRef<{ pointer: number; placement?: BoardPlacement; start: Point2; camera: NonNullable<typeof camera> } | null>(null)
  const preview = useMemo(() => drag ? { ...data, placements: data.placements.map((p) => p.component === drag.component ? { ...p, at: drag.at } : p) } : data, [data, drag])
  const pads = useMemo(() => placedPads(project, preview), [project, preview]), copper = useMemo(() => boardCopper(project, data), [project, data])
  const airwires = useMemo(() => ratsnest(project, data, copper), [project, data, copper]), checks = useMemo(() => drc(project, data), [project, data]), drills = useMemo(() => pcbDrills(project, preview), [project, preview])
  const geometry = useMemo(() => view3d ? pcbGeometry(project, preview) : null, [project, preview, view3d])
  const bounds = { min: [Math.min(...data.outline.map((p) => p[0])), Math.min(...data.outline.map((p) => p[1]))], max: [Math.max(...data.outline.map((p) => p[0])), Math.max(...data.outline.map((p) => p[1]))] }
  const fit = { x: bounds.min[0]! - 8, y: bounds.min[1]! - 8, width: Math.max(20, bounds.max[0]! - bounds.min[0]! + 16), height: Math.max(20, bounds.max[1]! - bounds.min[1]! + 16) }, view = camera ?? fit
  const placement = data.placements.find((p) => p.component === selectedComponent), component = project.components.find((c) => c.id === selectedComponent), track = data.tracks.find((t) => t.id === selected)
  const url = `/api/projects/${encodeURIComponent(project.id)}/pcb/${encodeURIComponent(doc.id)}`
  const command = (type: string, args: object, label: string) => run([{ type, args: { doc: doc.id, ...args } }], label)
  const world = (event: { clientX: number; clientY: number }): Point2 => { const p = new DOMPoint(event.clientX, event.clientY).matrixTransform(svg.current?.getScreenCTM()?.inverse()); return [Math.round(p.x * 4) / 4, Math.round(p.y * 4) / 4] }

  function finish() {
    if ((tool === "outline" || tool === "zone") && drawing.length >= 3) {
      if (tool === "outline") command("pcb.outline.set", { outline: drawing }, "Draw board outline")
      else if (net) command("pcb.zone.add", { net, layer, outline: drawing, thermal, clearance: data.rules.clearance, spokeWidth: Math.max(0.25, width) }, "Add copper zone")
      else toast("Choose a net for the copper zone")
    } else if (tool === "route" && drawing.length >= 2 && net) command("pcb.track.add", { net, layer, width, points: drawing }, "Route copper track")
    setDrawing([])
  }
  function via() {
    if (tool !== "route" || !net || !drawing.length) return
    try {
      const end = cursor, routed = routeBetween(project, data, drawing.at(-1)!, end, net, layer, width)
      const points = [...drawing, ...routed.slice(1)], commands: Command[] = []
      if (points.length > 1) commands.push({ type: "pcb.track.add", args: { doc: doc.id, net, layer, width, points } })
      commands.push({ type: "pcb.via.add", args: { doc: doc.id, net, at: end, diameter: 0.7, drill: 0.3 } })
      run(commands, "Route to via and change layer"); setDrawing([end]); setLayer(layer === "F.Cu" ? "B.Cu" : "F.Cu")
    } catch (e) { toast(String(e instanceof Error ? e.message : e)) }
  }
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement).closest?.("input, textarea, select")) return
      if (event.key === "Escape") { setDrawing([]); gesture.current = null; setDrag(null) }
      if (event.key === "Enter") { event.preventDefault(); finish() }
      if (event.key.toLowerCase() === "v") via()
      if (event.key === "Backspace" && drawing.length) { event.preventDefault(); setDrawing((d) => d.slice(0, -1)) }
    }
    addEventListener("keydown", key); return () => removeEventListener("keydown", key)
  })
  function click(at: Point2, pad?: typeof pads[number]) {
    if (tool === "hole") { command("pcb.hole.add", { at, diameter: holeDiameter }, "Add mounting hole"); return }
    if (tool === "outline" || tool === "zone") { setDrawing((d) => [...d, at]); return }
    if (tool !== "route") return
    if (pad && !pad.layers.length) { toast("A non-plated hole is not an electrical copper pad."); return }
    if (pad && !pad.layers.includes(layer)) { if (drawing.length) { toast("This pad is on the other layer. Add a via first."); return } setLayer(pad.layers[0]!) }
    const chosen = pad?.net ?? net
    if (!chosen) { toast("Connect this pad in the schematic first, or choose an existing net."); return }
    if (!drawing.length) { setNet(chosen); setDrawing([pad?.at ?? at]); return }
    if (pad?.net && pad.net !== net) { toast("That pad belongs to another net. Choose a compatible endpoint."); return }
    try {
      const routed = routeBetween(project, data, drawing.at(-1)!, pad?.at ?? at, net, layer, width), next = [...drawing, ...routed.slice(1)]
      if (pad) { command("pcb.track.add", { net, layer, width, points: next }, "Route copper between pads"); setDrawing([]) }
      else setDrawing(next)
    } catch (e) { toast(String(e instanceof Error ? e.message : e)) }
  }
  function start(event: ReactPointerEvent, p?: BoardPlacement) {
    if (event.button !== 0) return
    event.stopPropagation()
    if (tool !== "select") { if (!p) click(world(event)); return }
    if (p) { selectComponent(p.component); setSelected(p.component) } else setSelected("")
    gesture.current = { pointer: event.pointerId, start: world(event), placement: p, camera: view }
    setCamera(view); svg.current?.setPointerCapture(event.pointerId)
  }
  function move(event: ReactPointerEvent) {
    const at = world(event); setCursor(at)
    const g = gesture.current
    if (!g || g.pointer !== event.pointerId) return
    if (g.placement) setDrag({ component: g.placement.component, at: [g.placement.at[0] + at[0] - g.start[0], g.placement.at[1] + at[1] - g.start[1]] })
    else setCamera({ ...g.camera, x: view.x - at[0] + g.start[0], y: view.y - at[1] + g.start[1] })
  }
  function end(event: ReactPointerEvent, cancel = false) {
    const g = gesture.current; gesture.current = null
    if (!g) return
    if (!cancel && g.placement && drag) command("pcb.place", { component: drag.component, at: drag.at }, "Move PCB footprint")
    setDrag(null)
  }
  async function downloadFab() {
    setError("")
    try { const response = await fetch(`${url}/fabrication.zip`); if (!response.ok) throw new Error((await response.json()).error ?? "Fabrication export failed"); const href = URL.createObjectURL(await response.blob()), a = document.createElement("a"); a.href = href; a.download = `${doc.name}-fabrication.zip`; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000) } catch (e) { setError(String(e instanceof Error ? e.message : e)) }
  }
  const chooseIssue = (issue: ElectricalIssue) => { setSelected(issue.item ?? ""); if (issue.components?.[0]) selectComponent(issue.components[0]); if (issue.at) setCamera({ ...view, x: issue.at[0] - view.width / 2, y: issue.at[1] - view.height / 2 }) }

  return <div className="pcb-workspace">
    <header className="pcb-toolbar"><Editable value={doc.name} onCommit={(name) => name && run([{ type: "doc.rename", args: { doc: doc.id, name } }], "Rename PCB")} /><button onClick={() => command("pcb.sync", {}, "Sync shared components to PCB")}>Sync footprints</button><span className="spacer" /><button onClick={() => setView3d(!view3d)}>{view3d ? "2D layout" : "3D board"}</button><button onClick={() => setCamera(null)}>Fit</button><a href={`${url}/export.step`} download>Board STEP</a><button className="primary" onClick={downloadFab}>Fabrication ZIP</button></header>
    <div className="pcb-tools">{(["select", "route", "outline", "zone", "hole"] as Tool[]).map((value) => <button key={value} aria-pressed={tool === value} onClick={() => { setTool(value); setDrawing([]); setView3d(false) }}>{({ select: "Place", route: "Route", outline: "Board outline", zone: "Copper zone", hole: "Mounting hole" })[value]}</button>)}<select aria-label="PCB copper layer" value={layer} onChange={(e) => setLayer(e.target.value as CopperLayer)}><option value="F.Cu">Front copper</option><option value="B.Cu">Back copper</option></select><select aria-label="PCB route net" value={net} onChange={(e) => setNet(e.target.value)}><option value="">Choose net…</option>{project.nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select><label>Width <input aria-label="Trace width" type="number" min="0.127" step="0.05" value={width} onChange={(e) => setWidth(Number(e.target.value))} /> mm</label><select aria-label="Trace width preset" value="" onChange={(e) => { const c = data.netClasses.find((c) => c.name === e.target.value); if (c) setWidth(c.width) }}><option value="">Width preset…</option>{data.netClasses.map((c) => <option key={c.name} value={c.name}>{c.name} · {c.width} mm</option>)}</select>{tool === "route" && <button disabled={!drawing.length} onClick={via}>Via ↔ layer (V)</button>}{tool === "hole" && <label>Drill <input aria-label="Mounting hole diameter" type="number" min="0.3" step="0.1" value={holeDiameter} onChange={(e) => setHoleDiameter(Number(e.target.value))} /></label>}{tool === "zone" && <label><input type="checkbox" checked={thermal} onChange={(e) => setThermal(e.target.checked)} /> Thermal spokes</label>}{drawing.length > 0 && <button onClick={finish}>Finish (Enter)</button>}</div>
    <div className="pcb-body"><section className="pcb-stage">
      {view3d && geometry ? <CadViewport bodies={[geometry.mesh]} sketches={[]} /> : <svg ref={svg} data-testid="pcb-canvas" aria-label="PCB layout. Drag footprints; route from pad to pad." className="pcb-canvas" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} onPointerDown={(e) => start(e)} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)} onDoubleClick={() => drawing.length && finish()} onWheel={(e) => setCamera({ x: view.x + view.width * (e.deltaY > 0 ? -.05 : .05), y: view.y + view.height * (e.deltaY > 0 ? -.05 : .05), width: view.width * (e.deltaY > 0 ? 1.1 : .9), height: view.height * (e.deltaY > 0 ? 1.1 : .9) })}>
        <defs><pattern id={`pcb-grid-${doc.id}`} width="1" height="1" patternUnits="userSpaceOnUse"><circle r="0.04" fill="var(--muted)" opacity="0.25" /></pattern></defs><rect x={view.x} y={view.y} width={view.width} height={view.height} fill={`url(#pcb-grid-${doc.id})`} />
        <polygon className="pcb-outline" points={data.outline.map((p) => p.join(",")).join(" ")} />
        {copper.filter((v) => v.kind === "zone").map((v) => <path key={`${v.id}-${v.layer}`} className="pcb-zone" data-layer={v.layer} d={path(v.polygon)} fillRule="evenodd" onPointerDown={(e) => { if (tool === "select") { e.stopPropagation(); setSelected(v.id) } }} />)}
        {showRatsnest && airwires.map((v, i) => <line className="pcb-ratsnest" key={i} x1={v.from[0]} y1={v.from[1]} x2={v.to[0]} y2={v.to[1]} />)}
        {data.tracks.map((v) => <polyline key={v.id} className="pcb-track" data-track-id={v.id} data-layer={v.layer} data-selected={selected === v.id || undefined} points={v.points.map((p) => p.join(",")).join(" ")} strokeWidth={v.width} onPointerDown={(e) => { if (tool === "select") { e.stopPropagation(); setSelected(v.id) } }} />)}
        {preview.placements.map((p) => { const c = project.components.find((c) => c.id === p.component), f = c && project.parts[c.part]?.footprint; if (!c || !f) return null; const points = [f.courtyard.min, [f.courtyard.max[0], f.courtyard.min[1]], f.courtyard.max, [f.courtyard.min[0], f.courtyard.max[1]]].map((v) => footprintPoint(p, v as Point2)); return <g key={p.component} className="pcb-footprint" data-component-ref={c.ref} data-selected={selectedComponent === p.component || undefined} onPointerDown={(e) => start(e, p)}><polygon points={points.map((v) => v.join(",")).join(" ")} /><text x={p.at[0]} y={p.at[1] - 2} textAnchor="middle">{c.ref}</text></g> })}
        {pads.map((pad) => <path key={pad.id} className="pcb-pad" data-pad-address={`${pad.reference}.${pad.number}`} data-layer={pad.layers.includes(layer) ? layer : pad.layers[0]} d={path(pad.polygon)} fillRule="evenodd" onPointerDown={(e) => { e.stopPropagation(); if (tool === "route") click(pad.at, pad); else { const p = data.placements.find((p) => p.component === pad.component); if (p) start(e, p) } }}><title>{pad.reference}.{pad.number} · {project.nets.find((n) => n.id === pad.net)?.name ?? "unconnected"}</title></path>)}
        {data.vias.map((v) => <g key={v.id} className="pcb-via" onPointerDown={(e) => { e.stopPropagation(); setSelected(v.id); if (tool === "route") click(v.at) }}><circle cx={v.at[0]} cy={v.at[1]} r={v.diameter / 2} /><circle className="pcb-drill" cx={v.at[0]} cy={v.at[1]} r={v.drill / 2} /></g>)}
        {drills.filter((d) => !data.vias.some((v) => v.id === d.id)).map((d) => d.end ? <line key={d.id} className="pcb-slot" x1={d.at[0]} y1={d.at[1]} x2={d.end[0]} y2={d.end[1]} strokeWidth={d.diameter} /> : <circle key={d.id} className={`pcb-drill${data.holes.some((h) => h.id === d.id) ? " pcb-mounting-hole" : ""}`} cx={d.at[0]} cy={d.at[1]} r={d.diameter / 2} onPointerDown={(e) => { if (data.holes.some((h) => h.id === d.id)) { e.stopPropagation(); setSelected(d.id) } }} />)}
        {drawing.length > 0 && <polyline className="pcb-drawing" data-layer={layer} points={[...drawing, cursor].map((p) => p.join(",")).join(" ")} strokeWidth={tool === "route" ? width : .15} />}
      </svg>}
      <div className="pcb-hint">{tool === "route" ? "Click a pad, add waypoints, then another pad · V adds via and changes layer · Enter finishes · Esc cancels. Routes walk around foreign copper." : tool === "outline" || tool === "zone" ? "Click polygon corners; Enter closes and saves · Esc cancels" : tool === "hole" ? "Click to add a non-plated mounting hole" : "Drag footprints to place · Drag empty space to pan · Scroll to zoom"}</div>
    </section><aside className="pcb-inspector">
      {error && <p className="pcb-error" role="alert">{error}</p>}
      <h2>{component && placement ? component.ref : track ? "Track" : "Board"}</h2>
      {component && placement && <><p>{project.parts[component.part]?.name}</p><NumberSetting label="Rotation" value={placement.rotation} onCommit={(rotation) => command("pcb.place", { component: component.id, at: placement.at, rotation }, "Rotate footprint")} /><label>Side<select value={placement.side} onChange={(e) => command("pcb.place", { component: component.id, at: placement.at, side: e.target.value }, "Flip footprint")}><option value="top">Top</option><option value="bottom">Bottom</option></select></label><p className="muted small">{placement.at.map((v) => v.toFixed(2)).join(", ")} mm</p></>}
      {track && <><NumberSetting label="Track width" value={track.width} onCommit={(width) => command("pcb.track.update", { id: track.id, width }, "Change track width")} /><label>Layer<select value={track.layer} onChange={(e) => command("pcb.track.update", { id: track.id, layer: e.target.value }, "Change track layer")}><option>F.Cu</option><option>B.Cu</option></select></label><label>Net<select value={track.net} onChange={(e) => command("pcb.track.update", { id: track.id, net: e.target.value }, "Reassign track net")}>{project.nets.map((n) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label><OutlineEditor key={`${track.id}-${JSON.stringify(track.points)}`} label="Track waypoint coordinates" action="Apply track points" points={track.points} save={(points) => command("pcb.track.update", { id: track.id, points }, "Edit track points")} /></>}
      {selected && <button onClick={() => { command("pcb.remove", { id: selected }, "Remove PCB item"); setSelected("") }}>Remove selected</button>}
      <label><input type="checkbox" checked={showRatsnest} onChange={(e) => setShowRatsnest(e.target.checked)} /> Show ratsnest ({airwires.length})</label>
      <details><summary>On-board / off-board components</summary><p className="muted small">Off-board parts stay in the shared circuit and assembly BOM. Include a part, then Sync footprints to place it.</p>{project.components.filter((c) => project.parts[c.part]?.pins.length).map((c) => <label key={c.id}><span>{c.ref} · {project.parts[c.part]?.name}</span><input type="checkbox" aria-label={`Place ${c.ref} on PCB`} checked={!(data.excluded ?? []).includes(c.id)} onChange={(e) => command("pcb.exclude", { components: [c.id], excluded: !e.target.checked }, e.target.checked ? `Include ${c.ref} on PCB` : `Mark ${c.ref} off-board`)} /></label>)}</details>
      <details><summary>Board dimensions and outline</summary><NumberSetting label="Thickness (mm)" value={data.thickness} onCommit={(thickness) => command("pcb.outline.set", { thickness }, "Set board thickness")} /><OutlineEditor key={JSON.stringify(data.outline)} points={data.outline} save={(outline) => command("pcb.outline.set", { outline }, "Edit board outline")} /></details>
      <details><summary>Manufacturing rules</summary>{Object.entries(data.rules).map(([name, value]) => <NumberSetting key={name} label={`${name} (mm)`} value={value} onCommit={(v) => command("pcb.rules.set", { rules: { [name]: v } }, "Change PCB rules")} />)}</details>
      <details><summary>Net classes</summary>{project.nets.map((n) => <label key={n.id}>{n.name}<select value={data.assignments[n.id] ?? "Default"} onChange={(e) => { const c = data.netClasses.find((c) => c.name === e.target.value)!; command("pcb.netclass.set", { ...c, nets: [n.id] }, "Assign net class") }}>{data.netClasses.map((c) => <option key={c.name}>{c.name}</option>)}</select></label>)}{data.netClasses.map((c) => <div key={c.name}><strong>{c.name}</strong><NumberSetting label="Width (mm)" value={c.width} onCommit={(width) => command("pcb.netclass.set", { ...c, width }, "Edit net class width")} /><NumberSetting label="Clearance (mm)" value={c.clearance} onCommit={(clearance) => command("pcb.netclass.set", { ...c, clearance }, "Edit net class clearance")} /></div>)}</details>
      <h2>Design checks · {checks.filter((c) => c.severity === "error").length} errors</h2>
      {checks.map((check) => <button key={check.id} className={`pcb-check ${check.severity}`} onClick={() => chooseIssue(check)}>{check.message}</button>)}
      {!checks.length && <p className="pcb-pass">All PCB checks pass.</p>}
      <p className="muted small">Copper, drills, zones, mesh and fabrication share the same geometry. Fabrication export blocks unresolved DRC errors. Component moves leave routes explicit; reconnect exposed endpoints after moving.</p>
    </aside></div>
  </div>
}

function NumberSetting({ label, value, onCommit }: { label: string; value: number; onCommit(value: number): unknown }) { return <label>{label}<input key={value} type="number" step="0.05" defaultValue={value} onBlur={(e) => { const n = Number(e.target.value); if (Number.isFinite(n) && n !== value) onCommit(n) }} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} /></label> }
function OutlineEditor({ points, save, label = "Board outline coordinates", action = "Apply outline" }: { points: Point2[]; save(points: Point2[]): unknown; label?: string; action?: string }) { const [text, setText] = useState(pointsText(points)); return <><textarea aria-label={label} rows={5} value={text} onChange={(e) => setText(e.target.value)} /><button onClick={() => { try { save(parsePoints(text)) } catch (e) { toast(String(e instanceof Error ? e.message : e)) } }}>{action}</button></> }
