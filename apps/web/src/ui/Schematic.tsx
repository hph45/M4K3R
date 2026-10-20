import { formatQuantity, type Command, type Component, type Graphic, type Part, type Project, type SymbolPin } from "@m4k3r/core"
import { erc, netDrawing, netStyle, pointSegmentDistance, symbolGeometry, symbolPoint, type NetEnd, type NetStyle, type SchematicData, type SymbolPlacement, type XY } from "@m4k3r/ecad"
import type { View as DeviceView } from "@m4k3r/sim"
import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from "react"
import { connect, disconnect, fuzzy, pinLabel, renameNet } from "../actions"
import { api, type PartSummary } from "../api"
import type { DocViewProps } from "../registry"
import { motorMotion } from "../motorMotion"
import { clearPins, clearSelection, openPalette, run, selectComponent, togglePin, useApp } from "../store"
import { useCircuitSimulation } from "../useCircuitSimulation"
import { Editable } from "./Editable"
import { circuitWirePath, nearestCircuitPin } from "./circuit-hit"

type View = { x: number; y: number; width: number; height: number }
type Placed = SymbolPlacement & { c: Component; part: Part; geometry: ReturnType<typeof symbolGeometry> }
type WireDraft = { source: string; target: string | null; point: XY }
type CanvasGesture = { pointer: number; start: XY; screenStart: XY; view: View; moved: boolean; symbol?: SymbolPlacement; wire?: WireDraft; bend?: { id: string; index: number; original: XY[] }; label?: { id: string; net: string; at: XY } }
type SchematicProps = DocViewProps & { toolbarEnd?: ReactNode; createOnAdd?: boolean; wiring?: boolean }
const PART_DRAG_TYPE = "application/x-m4k3r-part"
/** Screen pixels per sheet millimetre below which a sheet opens zoomed in rather than fitted, and above which Fit stops zooming in. */
const READABLE = 4, CLOSE = 8
const liveModels = new Set(["dc-motor", "led", "button", "switch"])
const feedbackModel = (part: Part) => part.id === "brushless-motor" ? "dc-motor" : part.sim?.model
const liveValue = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0
const liveFormat = (value: number | undefined, unit = "") => value === undefined || !Number.isFinite(value) ? "—" : formatQuantity(Math.abs(value) < 1e-12 ? 0 : value, unit)
const ledColor = (component: Component) => ({ red: "#f15e60", green: "#50ce88", blue: "#6298ff", white: "#e6efff", yellow: "#f4d54c", amber: "#f4ad48", orange: "#f69c49", purple: "#ce7cf1" }[component.props.color?.toLowerCase() ?? "red"] ?? "#f15e60")

function worldBounds(symbol: Placed) {
  const { min, max } = symbol.geometry.bounds
  const corners = [min, max, [min[0], max[1]], [max[0], min[1]]].map((point) => symbolPoint(symbol, point as XY))
  return { min: [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1]))] as XY, max: [Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))] as XY }
}

function feedbackPosition(symbol: Placed): XY {
  const { min, max } = worldBounds(symbol)
  return [min[0], max[1] + 4]
}

function referencePosition(symbol: Placed, connected: Set<string>) {
  const { min, max } = symbol.geometry.bounds
  const local = (point: XY) => symbolPoint({ ...symbol, x: 0, y: 0 }, point)
  const corners = [min, max, [min[0], max[1]], [max[0], min[1]]].map((point) => local(point as XY))
  const outward = symbol.geometry.pins.map((pin) => { const a = -pin.rot * Math.PI / 180, at = local(pin.at), beyond = local([pin.at[0] - Math.cos(a), pin.at[1] - Math.sin(a)]); return [beyond[0] - at[0], beyond[1] - at[1]] })
  const [x0, y0, x1, y1] = [Math.min(...corners.map((p) => p[0])), Math.min(...corners.map((p) => p[1])), Math.max(...corners.map((p) => p[0])), Math.max(...corners.map((p) => p[1]))]
  // Like KiCad passives, a vertical symbol carries its reference on the right; others above, clear of any top pin's port.
  if (outward.every(([dx]) => Math.abs(dx!) < .5)) return { x: x1 + 1, y: (y0 + y1) / 2 - .6, transform: `rotate(${symbol.rotation})` }
  const lifted = symbol.geometry.pins.some((pin, i) => outward[i]![1]! < -.5 && connected.has(`${symbol.component}/${pin.num}`))
  return { x: x0, y: y0 - (lifted ? 9.5 : 4), transform: `rotate(${symbol.rotation})` }
}

export function addSchematicPart(doc: string, create = false, after?: () => void) {
  openPalette({
    placeholder: "Add a part to this schematic…",
    items: async (q) => (await api.parts(q)).filter((p) => p.pins > 0 && fuzzy(q, `${p.name} ${p.category}`)).map((part) => ({
      id: part.id, title: part.name, hint: part.category,
      run: async () => {
        const result = await run([
          ...(create ? [{ type: "doc.create", args: { kind: "schematic", name: doc } }] : []),
          { type: "component.add", args: { part: part.id } },
          { type: "schematic.autoplace", args: { doc } },
        ], `Add ${part.name} to schematic`)
        if (result) after?.()
      },
    })),
  })
}

// The wiring canvas keeps its view when its first drop creates the schematic document.
export function Schematic(props: SchematicProps) { return <SchematicEditor key={`${props.project.id}/${props.wiring ? "wiring" : props.doc.id}`} {...props} /> }

function SchematicEditor({ project, doc, toolbarEnd, createOnAdd = false, wiring = false }: SchematicProps) {
  const data = doc.data as SchematicData
  const live = useCircuitSimulation(project)
  const selected = useApp((s) => s.selection)
  const [view, setView] = useState<View | null>(null)
  const [activeNet, setActiveNet] = useState<string | null>(null)
  const [activeSymbol, setActiveSymbol] = useState("")
  const [draft, setDraft] = useState<{ component: string; x: number; y: number; unit?: number } | null>(null)
  const [activeWire, setActiveWire] = useState("")
  const [bendDraft, setBendDraft] = useState<{ id: string; bends: XY[] } | null>(null)
  const [labelDraft, setLabelDraft] = useState<{ id: string; at: XY } | null>(null)
  const [annotationTool, setAnnotationTool] = useState<"label" | "junction" | null>(null)
  const [firmware, setFirmware] = useState("")
  const [wire, setWire] = useState<WireDraft | null>(null)
  const [draggingPart, setDraggingPart] = useState<string | null>(null)
  const [dropAt, setDropAt] = useState<XY | null>(null)
  const [size, setSize] = useState<XY | null>(null)
  const svg = useRef<SVGSVGElement>(null)
  const gesture = useRef<CanvasGesture | null>(null)
  const docKey = createOnAdd ? doc.name : doc.id
  const createCommands = (): Command[] => createOnAdd ? [{ type: "doc.create", args: { kind: "schematic", name: doc.name } }] : []
  const placeExisting = (all = false) => run([...createCommands(), { type: "schematic.autoplace", args: { doc: docKey, all } }], createOnAdd ? "Create circuit and place components" : all ? "Arrange circuit" : "Place unplaced symbols")

  useEffect(() => {
    function escape(e: KeyboardEvent) {
      if (e.key !== "Escape") return
      const pointer = gesture.current?.pointer
      gesture.current = null
      setDraft(null)
      setWire(null)
      setBendDraft(null)
      setLabelDraft(null)
      setAnnotationTool(null)
      if (pointer !== undefined && svg.current?.hasPointerCapture(pointer)) svg.current.releasePointerCapture(pointer)
    }
    addEventListener("keydown", escape)
    return () => removeEventListener("keydown", escape)
  }, [])
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => entry && setSize([entry.contentRect.width, entry.contentRect.height]))
    if (svg.current) observer.observe(svg.current)
    return () => observer.disconnect()
  }, [])
  const placed = useMemo(() => (data.symbols ?? []).flatMap((s): Placed[] => {
    const c = project.components.find((c) => c.id === s.component)
    const part = c && project.parts[c.part]
    return c && part?.pins.length ? [{ ...s, c, part, geometry: symbolGeometry(part, s.unit ?? 0) }] : []
  }), [data, project.components, project.parts])
  const visible = placed.map((s) => s.component === draft?.component && (s.unit ?? 0) === (draft.unit ?? 0) ? { ...s, x: draft.x, y: draft.y } : s)
  const fit = useMemo((): View => {
    if (!placed.length) return { x: 0, y: 0, width: 240, height: 150 }
    const points = placed.flatMap((s) => {
      const { min, max } = worldBounds(s)
      const at = feedbackPosition(s)
      return liveModels.has(feedbackModel(s.part) ?? "") ? [min, max, at, [at[0] + 27, at[1] + 22] as XY] : [min, max]
    })
    // The margin leaves room for titles, power symbols and net labels on outer pins.
    const [x0, x1] = [Math.min(...points.map((p) => p[0])) - 14, Math.max(...points.map((p) => p[0])) + 14]
    const [y0, y1] = [Math.min(...points.map((p) => p[1])) - 14, Math.max(...points.map((p) => p[1])) + 10]
    const width = Math.max(80, x1 - x0), height = Math.max(60, y1 - y0)
    return { x: (x0 + x1 - width) / 2, y: (y0 + y1 - height) / 2, width, height }
  }, [placed])
  // Fit shows everything without blowing up a small circuit; large sheets open at a readable zoom from their top-left corner.
  const scale = size ? Math.min(size[0] / fit.width, size[1] / fit.height) : 0
  const fitted = size && scale > CLOSE ? { x: fit.x + (fit.width - size[0] / CLOSE) / 2, y: fit.y + (fit.height - size[1] / CLOSE) / 2, width: size[0] / CLOSE, height: size[1] / CLOSE } : fit
  const opening = size && scale < READABLE ? { x: fit.x, y: fit.y, width: size[0] / READABLE, height: size[1] / READABLE } : fitted
  const camera = view ?? opening
  const pinPositions = new Map<string, XY>(), pinOutward = new Map<string, XY>()
  for (const s of visible) for (const pin of s.geometry.pins) {
    // A pin runs from its connection point toward the body, so outward is the opposite direction.
    const at = symbolPoint(s, pin.at), a = -pin.rot * Math.PI / 180, beyond = symbolPoint(s, [pin.at[0] - Math.cos(a), pin.at[1] - Math.sin(a)])
    pinPositions.set(`${s.component}/${pin.num}`, at)
    pinOutward.set(`${s.component}/${pin.num}`, [Math.round(beyond[0] - at[0]), Math.round(beyond[1] - at[1])])
  }
  const connected = new Set(project.nets.flatMap((net) => net.pins.map((p) => `${p.component}/${p.pin}`)))
  const component = project.components.find((c) => c.id === selected.component)
  const componentPart = component && project.parts[component.part]
  const ground = project.nets.find((net) => net.name.toUpperCase() === "GND" || net.name === "0")
  const selectedNet = project.nets.find((net) => net.id === activeNet)
  const deviceEnabled = live.ready && !live.error
  const unplaced = project.components.filter((c) => project.parts[c.part]?.pins.length).reduce((sum, c) => sum + (project.parts[c.part]?.symbol?.units.length ?? 1), 0) - placed.length
  const electricalChecks = useMemo(() => erc(project), [project])
  const firmwares = project.docs.filter((d) => d.kind === "firmware")
  const savedWires = (data.wires ?? []).flatMap((w) => {
    const from = pinPositions.get(`${w.from.component}/${w.from.pin}`), to = pinPositions.get(`${w.to.component}/${w.to.pin}`)
    const net = project.nets.find((n) => n.pins.some((p) => p.component === w.from.component && p.pin === w.from.pin) && n.pins.some((p) => p.component === w.to.component && p.pin === w.to.pin))
    return from && to && net ? [{ ...w, net: net.id, fromAt: from, toAt: to, bends: bendDraft?.id === w.id ? bendDraft.bends : w.bends }] : []
  })
  const point = (e: { clientX: number; clientY: number }): XY => {
    const matrix = svg.current?.getScreenCTM()?.inverse()
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix)
    return [p.x, p.y]
  }
  const zoom = (factor: number) => !gesture.current && setView({
    x: camera.x + camera.width * (1 - factor) / 2,
    y: camera.y + camera.height * (1 - factor) / 2,
    width: Math.min(2000, Math.max(15, camera.width * factor)),
    height: Math.min(1500, Math.max(10, camera.height * factor)),
  })
  function start(e: ReactPointerEvent, symbol?: SymbolPlacement) {
    if (e.button !== 0 || !svg.current) return
    e.stopPropagation()
    if (!symbol && annotationTool && activeNet) { run([{ type: annotationTool === "label" ? "schematic.label.set" : "schematic.junction.add", args: { doc: doc.id, net: activeNet, at: point(e).map(Math.round) } }], `Place net ${annotationTool}`); setAnnotationTool(null); return }
    if (symbol) { selectComponent(symbol.component); setActiveSymbol(`${symbol.component}/${symbol.unit ?? 0}`); setActiveWire("") }
    else clearSelection()
    setView(camera)
    gesture.current = { pointer: e.pointerId, start: point(e), screenStart: [e.clientX, e.clientY], view: camera, symbol, moved: false }
    svg.current.setPointerCapture(e.pointerId)
  }
  function snap(at: XY, exclude: string) {
    const matrix = svg.current?.getScreenCTM()
    const scale = matrix ? Math.hypot(matrix.a, matrix.b) : 1
    return nearestCircuitPin(at, pinPositions, 13 / Math.max(scale, 0.001), exclude)
  }
  function startWire(e: ReactPointerEvent, source: string) {
    if (e.button !== 0 || !svg.current) return
    e.stopPropagation()
    e.preventDefault()
    const initial = { source, target: null, point: pinPositions.get(source) ?? point(e) }
    setView(camera)
    selectComponent(source.split("/")[0]!)
    gesture.current = { pointer: e.pointerId, start: point(e), screenStart: [e.clientX, e.clientY], view: camera, wire: initial, moved: false }
    setWire(initial)
    svg.current.setPointerCapture(e.pointerId)
  }
  function move(e: ReactPointerEvent) {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    const p = point(e)
    g.moved ||= Math.hypot(e.clientX - g.screenStart[0], e.clientY - g.screenStart[1]) > 4
    if (g.bend) {
      const bends = [...g.bend.original]; bends[g.bend.index] = p.map(Math.round) as XY; setBendDraft({ id: g.bend.id, bends })
    } else if (g.label) {
      setLabelDraft({ id: g.label.id, at: [Math.round(g.label.at[0] + p[0] - g.start[0]), Math.round(g.label.at[1] + p[1] - g.start[1])] })
    } else if (g.wire) {
      g.wire = { ...g.wire, point: p, target: snap(p, g.wire.source) }
      setWire(g.wire)
    } else if (g.symbol) {
      setDraft({ component: g.symbol.component, unit: g.symbol.unit, x: Math.round(g.symbol.x + p[0] - g.start[0]), y: Math.round(g.symbol.y + p[1] - g.start[1]) })
    } else {
      setView({ ...g.view, x: camera.x - (p[0] - g.start[0]), y: camera.y - (p[1] - g.start[1]) })
    }
  }
  function end(e: ReactPointerEvent, cancel = false) {
    const g = gesture.current
    if (!g || g.pointer !== e.pointerId) return
    gesture.current = null
    if (!cancel && g.bend && bendDraft) {
      run([{ type: "schematic.wire.update", args: { doc: doc.id, id: g.bend.id, bends: bendDraft.bends } }], "Move wire bend")
    } else if (!cancel && g.label && labelDraft) {
      run([{ type: "schematic.label.set", args: { doc: doc.id, id: g.label.id, net: g.label.net, at: labelDraft.at } }], "Move net label")
    } else if (!cancel && g.wire) {
      const moved = g.moved || Math.hypot(e.clientX - g.screenStart[0], e.clientY - g.screenStart[1]) > 4
      const target = snap(point(e), g.wire.source)
      if (moved && target) {
        const pins = [pinLabel(project, g.wire.source), pinLabel(project, target)].filter((pin): pin is string => !!pin)
        if (pins.length === 2) {
          const from = pinPositions.get(g.wire.source)!, to = pinPositions.get(target)!, middle = (from[0] + to[0]) / 2
          run([{ type: "schematic.wire.add", args: { doc: doc.id, pins, bends: [[middle, from[1]], [middle, to[1]]] } }], `Connect ${pins.join(" to ")}`).then((result) => { if (result) clearPins() })
        }
      } else if (!moved) togglePin(g.wire.source)
    } else if (!cancel && g.symbol) {
      const p = point(e)
      const x = Math.round(g.symbol.x + p[0] - g.start[0]), y = Math.round(g.symbol.y + p[1] - g.start[1])
      if (x !== g.symbol.x || y !== g.symbol.y) run([{ type: "schematic.place", args: { doc: doc.id, component: g.symbol.component, unit: g.symbol.unit, x, y } }], `Move ${project.components.find((c) => c.id === g.symbol?.component)?.ref ?? "part"}`)
    }
    setDraft(null)
    setWire(null)
    setBendDraft(null)
    setLabelDraft(null)
    if (svg.current?.hasPointerCapture(e.pointerId)) svg.current.releasePointerCapture(e.pointerId)
  }
  async function addAt(part: string, at?: XY) {
    // A dropped part stays where it was dropped; the view doesn't jump to refit.
    if (at) setView(camera)
    let position: XY = at ?? [camera.x + camera.width / 2, camera.y + camera.height / 2]
    if (!at) {
      let index = 0
      while (visible.some((s) => Math.abs(s.x - position[0]) < 18 && Math.abs(s.y - position[1]) < 18)) {
        index++
        position = [camera.x + camera.width / 2 + (index % 4) * 22, camera.y + camera.height / 2 + Math.floor(index / 4) * 22]
      }
    }
    const result = await run([...createCommands(), { type: "schematic.add", args: { doc: docKey, part, x: Math.round(position[0]), y: Math.round(position[1]) } }], `Add ${part} to circuit`)
    if (result && !at) setView(null)
  }
  const placement = visible.find((s) => `${s.component}/${s.unit ?? 0}` === activeSymbol && s.component === component?.id) ?? visible.find((s) => s.component === component?.id)

  return (
    <div className="electronics-workspace schematic-workspace" data-wiring={wiring || undefined}>
      <header className="electronics-toolbar">
        {createOnAdd ? <strong className="electronics-doc-title">Circuit</strong> : <Editable className="electronics-doc-title" value={doc.name} onCommit={(name) => name && run([{ type: "doc.rename", args: { doc: doc.id, name } }], "Rename schematic")} />}
        <span className="muted small">{placed.length} parts · {project.nets.length} nets</span>
        <span className="spacer" />
        <button className="primary" onClick={() => addSchematicPart(docKey, createOnAdd, () => setView(null))}>Add part</button>
        <button disabled={!unplaced} onClick={() => placeExisting()}>{createOnAdd ? "Create circuit" : "Place unplaced"}{unplaced ? ` (${unplaced})` : ""}</button>
        <button disabled={!placed.length} onClick={() => placeExisting(true)}>Arrange</button>
        <button onClick={() => setView(fitted)}>Fit</button>
        <button title="Zoom in" onClick={() => zoom(0.8)}>+</button>
        <button title="Zoom out" onClick={() => zoom(1.25)}>−</button>
        {toolbarEnd}
      </header>
      <div className="circuit-simulation-toolbar">
        <span className="circuit-live-status" data-running={live.frame.running || undefined}>Live circuit</span>
        <button className={live.frame.running ? "" : "primary"} aria-label={live.frame.running ? "Pause circuit" : "Run circuit"} disabled={!deviceEnabled} onClick={live.toggle}>{live.frame.running ? "Pause" : "Run"}</button>
        <button aria-label="Reset circuit" onClick={live.reset}>Reset</button>
        <span className="mono small">{liveFormat(live.frame.snapshot.t, "s")}</span>
        <span className="muted small">{live.frame.running ? `${live.frame.realtime.toFixed(2)}× realtime` : "Paused"}</span>
        <span className="spacer" />
        {visible.some((s) => ["button", "switch"].includes(feedbackModel(s.part) ?? "")) && <span className="muted small">Run, then hold a button or toggle a switch</span>}
      </div>
      <div className="electronics-body">
        <PartsTray onAdd={addAt} onDragPart={(part) => { setDraggingPart(part); if (!part) setDropAt(null) }} />
        <div className="schematic-stage">
          <svg ref={svg} data-testid="circuit-canvas" className="schematic-canvas" data-dragging={gesture.current?.symbol ? "part" : wire ? "wire" : undefined} data-dropping={dropAt ? true : undefined} role="group" aria-label="Schematic canvas. Drag parts to move them. Drag between pin dots to attach a wire." viewBox={`${camera.x} ${camera.y} ${camera.width} ${camera.height}`}
            onPointerDownCapture={(e) => { if (annotationTool) start(e) }} onPointerDown={(e) => start(e)} onPointerMove={move} onPointerUp={(e) => end(e)} onPointerCancel={(e) => end(e, true)} onLostPointerCapture={(e) => end(e, true)}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(PART_DRAG_TYPE)) { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; setDropAt(point(e)) } }}
            onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropAt(null) }}
            onDrop={(e) => { const part = e.dataTransfer.getData(PART_DRAG_TYPE); if (!part) return; e.preventDefault(); addAt(part, point(e)); setDropAt(null); setDraggingPart(null) }}
            onWheel={(e) => zoom(e.deltaY > 0 ? 1.1 : 0.9)}>
            <defs><pattern id={`grid-${doc.id}`} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="0.14" fill="var(--line)" opacity="0.45" /></pattern></defs>
            <rect x={camera.x - camera.width} y={camera.y - camera.height} width={camera.width * 3} height={camera.height * 3} fill={`url(#grid-${doc.id})`} stroke="none" />
            {project.nets.map((net) => {
              const ends = net.pins.flatMap((p): NetEnd[] => { const key = `${p.component}/${p.pin}`, at = pinPositions.get(key); return at ? [{ key, at, out: pinOutward.get(key)! }] : [] })
              const first = ends[0]?.at
              if (!first) return null
              const { wires, ports, junctions } = netDrawing(net, ends, savedWires.filter((w) => w.net === net.id).map((w) => [`${w.from.component}/${w.from.pin}`, `${w.to.component}/${w.to.pin}`]))
              const hl = activeNet === net.id || net.pins.some((p) => p.component === selected.component || selected.pins.includes(`${p.component}/${p.pin}`))
              const voltage = live.frame.snapshot.t > 0 ? live.frame.snapshot.voltages[net.name] : undefined
              return <g key={net.id} className="schematic-net" data-net-id={net.id} data-net-name={net.name} data-active={hl || undefined} onPointerDown={(e) => { e.stopPropagation(); setActiveNet(net.id) }}>
                {wires.map(([a, b], i) => <path key={i} d={circuitWirePath(a, b)} />)}
                {junctions.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="0.65" fill="currentColor" stroke="none" />)}
                {ports.map((p) => <NetPort key={p.key} end={p} name={net.name} kind={netStyle(net.name)} />)}
                {(hl || voltage !== undefined) && !ports.length && <text x={first[0] + 1} y={first[1] - 1.1} stroke="none">{net.name}{voltage !== undefined ? ` · ${liveFormat(voltage, "V")}` : ""}</text>}
              </g>
            })}
            {savedWires.map((w) => <g key={w.id} className="schematic-net schematic-routed-wire" data-wire-id={w.id} data-active={activeWire === w.id || undefined}>
              <path d={`M${[w.fromAt, ...w.bends, w.toAt].map((p) => p.join(" ")).join("L")}`} onPointerDown={(e) => { e.stopPropagation(); setActiveWire(w.id); setActiveNet(w.net) }} onDoubleClick={(e) => { e.stopPropagation(); const at = point(e).map(Math.round) as XY, points = [w.fromAt, ...w.bends, w.toAt]; let segment = 0, distance = Infinity; points.slice(1).forEach((p, i) => { const d = pointSegmentDistance(at, points[i]!, p); if (d < distance) { distance = d; segment = i } }); run([{ type: "schematic.wire.update", args: { doc: doc.id, id: w.id, bends: [...w.bends.slice(0, segment), at, ...w.bends.slice(segment)] } }], "Add wire bend") }} />
              {activeWire === w.id && w.bends.map((bend, index) => <circle key={index} className="schematic-wire-bend" cx={bend[0]} cy={bend[1]} r="1.1" onPointerDown={(e) => { e.stopPropagation(); setView(camera); gesture.current = { pointer: e.pointerId, start: point(e), screenStart: [e.clientX, e.clientY], view: camera, moved: false, bend: { id: w.id, index, original: w.bends } }; svg.current?.setPointerCapture(e.pointerId) }} />)}
            </g>)}
            {(data.labels ?? []).map((label) => { const net = project.nets.find((n) => n.id === label.net); if (!net) return null; const at = labelDraft?.id === label.id ? labelDraft.at : label.at; return <g className="schematic-net-label" key={label.id} data-label-id={label.id} transform={`translate(${at[0]} ${at[1]})`} onPointerDown={(e) => { e.stopPropagation(); setActiveNet(net.id); setView(camera); gesture.current = { pointer: e.pointerId, start: point(e), screenStart: [e.clientX, e.clientY], view: camera, moved: false, label }; svg.current?.setPointerCapture(e.pointerId) }}><path d="M0 0 l1 -1 h1" /><text x="2.4" y="-.4">{net.name}</text></g> })}
            {(data.junctions ?? []).map((j) => <circle key={j.id} className="schematic-junction" cx={j.at[0]} cy={j.at[1]} r=".65" onDoubleClick={() => run([{ type: "schematic.annotation.remove", args: { doc: doc.id, id: j.id } }], "Remove junction marker")} />)}
            {visible.filter((s) => s.part.sim?.model === "led").map((s) => {
              const brightness = Math.min(1, Math.max(0, liveValue(live.frame.snapshot.views[s.c.ref]?.brightness)))
              return <g key={`glow-${s.component}`} className="circuit-led-glow" data-led-ref={s.c.ref} data-brightness={brightness} transform={`translate(${s.x} ${s.y})`} style={{ color: ledColor(s.c), opacity: brightness }}><circle r="5" /><circle r="2.7" /></g>
            })}
            {visible.map((s) => <g key={`${s.component}/${s.unit ?? 0}`} transform={`translate(${s.x} ${s.y}) rotate(${-s.rotation})`} className="schematic-symbol" data-component-id={s.component} data-component-ref={s.c.ref} data-symbol-unit={s.unit ?? 0} data-selected={selected.component === s.component || undefined} data-moving={draft?.component === s.component && (draft.unit ?? 0) === (s.unit ?? 0) || undefined} onPointerDown={(e) => start(e, s)}>
              <title>{s.c.ref} · {s.part.name}. Drag the body to move; drag a pin dot to attach a wire.</title>
              <rect className="schematic-symbol-hit" x={s.geometry.bounds.min[0] - 2} y={s.geometry.bounds.min[1] - 4} width={s.geometry.bounds.max[0] - s.geometry.bounds.min[0] + 4} height={s.geometry.bounds.max[1] - s.geometry.bounds.min[1] + 7} />
              {s.geometry.graphics.filter((g) => g.type !== "text" || (!g.text.includes("${REFERENCE}") && !g.text.includes("${VALUE}"))).map((g, i) => <SymbolGraphic key={i} graphic={g} c={s.c} />)}
              <SymbolTitle at={referencePosition(s, connected)} reference={`${s.c.ref}${(s.part.symbol?.units.length ?? 1) > 1 ? `.${String.fromCharCode(65 + (s.unit ?? 0))}` : ""}`} value={s.c.props.value || s.part.name} />
              {s.geometry.pins.map((pin, i) => <SymbolPinView key={`${pin.num}-${i}`} pin={pin} part={s.part} component={s.component} reference={s.c.ref} onStart={startWire} wireTarget={wire?.target === `${s.component}/${pin.num}`} wireSource={wire?.source === `${s.component}/${pin.num}`} picked={selected.pins.includes(`${s.component}/${pin.num}`)} wired={connected.has(`${s.component}/${pin.num}`)} />)}
            </g>)}
            {(data.noConnects ?? []).map((p) => { const at = pinPositions.get(`${p.component}/${p.pin}`); return at ? <path key={`${p.component}/${p.pin}`} className="schematic-no-connect" d={`M${at[0] - .8} ${at[1] - .8} l1.6 1.6 M${at[0] - .8} ${at[1] + .8} l1.6 -1.6`} /> : null })}
            {visible.filter((s) => liveModels.has(feedbackModel(s.part) ?? "") && (s.part.id !== "brushless-motor" || typeof live.frame.snapshot.views[s.c.ref]?.rpm === "number")).map((s) => {
              return <CircuitDeviceFeedback key={`live-${s.component}`} component={s.c} model={feedbackModel(s.part)!} at={feedbackPosition(s)} view={live.frame.snapshot.views[s.c.ref] ?? {}} current={live.frame.snapshot.t > 0 ? live.frame.snapshot.currents[s.c.ref] : undefined} running={live.frame.running} enabled={deviceEnabled} input={live.input} />
            })}
            {wire && <g className="schematic-wire-draft" data-snapped={!!wire.target || undefined}><path d={circuitWirePath(pinPositions.get(wire.source) ?? wire.point, wire.target ? pinPositions.get(wire.target)! : wire.point)} /><circle cx={(wire.target ? pinPositions.get(wire.target)! : wire.point)[0]} cy={(wire.target ? pinPositions.get(wire.target)! : wire.point)[1]} r="0.9" /></g>}
            {dropAt && <g className="schematic-drop-preview" transform={`translate(${dropAt[0]} ${dropAt[1]})`}><rect x="-8" y="-5" width="16" height="10" rx="2" /><path d="M-2 0 H2 M0 -2 V2" /><text x="0" y="-7" textAnchor="middle">{draggingPart || "Drop part here"}</text></g>}
          </svg>
          {!placed.length && <div className="schematic-empty"><p className="empty-title">Build your circuit</p><p className="muted">Drag a part from the tray onto the canvas.<br />Drag between pin dots to attach wires.</p><button className="primary" onClick={() => unplaced ? placeExisting() : addSchematicPart(docKey, createOnAdd, () => setView(null))}>{unplaced ? "Create circuit from project parts" : "Add first part"}</button></div>}
          {(annotationTool || wire) && <div className="schematic-interaction-status" role="status">{annotationTool ? `Click to place ${annotationTool} on ${selectedNet?.name ?? "selected net"} · Esc cancels` : wire?.target ? `Release to connect ${pinLabel(project, wire.source)} → ${pinLabel(project, wire.target)}` : "Drag to another pin · Release on empty space or press Esc to cancel"}</div>}
          {placed.length > 0 && <div className="schematic-hint">Drag empty space to pan · Scroll to zoom · Drag pin to pin to wire</div>}
          <SchematicConnections project={project} />
        </div>
        <aside className="electronics-inspector">
          {project.nets.length > 0 && live.error && <div className="circuit-simulation-error" role="alert">{live.error}{!ground && <span> Choose the battery's negative return net in the Nets inspector and click Set ground. Keep the positive supply on a separate net.</span>}</div>}
          {live.frame.warnings.length > 0 && <details className="circuit-simulation-warnings"><summary>{live.frame.warnings.length} simulation note{live.frame.warnings.length === 1 ? "" : "s"}</summary>{live.frame.warnings.map((warning) => <p key={warning}>{warning}</p>)}</details>}
          <h2>{component?.ref ?? "Circuit"}</h2>
          {component && componentPart ? <>
            <p className="muted">{componentPart.name}</p>
            {live.ready && componentPart.sim && <div className="circuit-inspector-readings"><strong>Live state</strong>{componentPart.sim.model === "dc-motor" && <span>{liveFormat(liveValue(live.frame.snapshot.views[component.ref]?.rpm))} rpm · {motorMotion(liveValue(live.frame.snapshot.views[component.ref]?.rpm), live.frame.running).state}</span>}{componentPart.sim.model === "led" && <span>{Math.round(liveValue(live.frame.snapshot.views[component.ref]?.brightness) * 100)}% brightness</span>}{live.frame.snapshot.t > 0 && <span>Current {liveFormat(live.frame.snapshot.currents[component.ref], "A")}</span>}</div>}
            <label>Reference <Editable value={component.ref} onCommit={(ref) => ref && run([{ type: "component.update", args: { component: component.id, ref } }], "Change component reference")} /></label>
            {Object.entries(component.props).map(([key, value]) => <label key={key}>{key}<Editable value={value} onCommit={(value) => run([{ type: "component.update", args: { component: component.id, props: { [key]: value || null } } }], `Set ${component.ref} ${key}`)} /></label>)}
            <Editable value="" placeholder="+ property (name=value)" onCommit={(text) => { const at = text.indexOf("="); if (at > 0) run([{ type: "component.update", args: { component: component.id, props: { [text.slice(0, at).trim()]: text.slice(at + 1).trim() } } }], "Set component property") }} />
            {placement && <><p className="muted small">{placement.x} mm, {placement.y} mm · {placement.rotation}°{(componentPart.symbol?.units.length ?? 1) > 1 ? ` · Unit ${(placement.unit ?? 0) + 1}` : ""}</p><button onClick={() => run([{ type: "schematic.place", args: { doc: doc.id, component: component.id, unit: placement.unit, x: placement.x, y: placement.y, rotation: (placement.rotation + 90) % 360 } }], `Rotate ${component.ref}`)}>Rotate 90°</button><button onClick={() => run([{ type: "schematic.remove", args: { doc: doc.id, component: component.id, unit: placement.unit ?? 0 } }], `Unplace ${component.ref}`)}>Unplace symbol</button></>}
            <button className="ghost" onClick={() => run([{ type: "component.remove", args: { component: component.id } }], `Remove ${component.ref}`)}>Remove component</button>
            <h2>Pins</h2><div className="electronics-pin-list">{componentPart.pins.map((p) => <button key={p.num} data-picked={selected.pins.includes(`${component.id}/${p.num}`) || undefined} onClick={() => togglePin(`${component.id}/${p.num}`)}>{p.num} · {p.name}</button>)}</div>
            {componentPart.symbol && componentPart.symbol.units.length > 1 && <p className="muted small">Each gate is a separate placeable unit. Place unplaced adds remaining units; pins and properties belong to the same shared component.</p>}
          </> : placed.length > 0 && <p className="muted">Select a part to edit its properties.</p>}
          <h2>Nets</h2>
          {project.nets.map((n) => <div key={n.id} className="electronics-net-row" data-active={activeNet === n.id || undefined} onClick={() => setActiveNet(activeNet === n.id ? null : n.id)}><Editable value={n.name} onCommit={(name) => renameNet(n, name)} /><span className="muted small">{live.frame.snapshot.t > 0 && live.frame.snapshot.voltages[n.name] !== undefined ? liveFormat(live.frame.snapshot.voltages[n.name], "V") : `${n.pins.length} pins`}</span></div>)}
          {!project.nets.length && <p className="muted small">No connections yet.</p>}
          {selected.pins.length > 0 && <><button onClick={() => run([{ type: "schematic.no-connect", args: { doc: doc.id, pins: selected.pins.flatMap((p) => pinLabel(project, p) ?? []), marked: true } }], "Mark selected pins no-connect")}>Mark pins no-connect</button><button onClick={() => run([{ type: "schematic.no-connect", args: { doc: doc.id, pins: selected.pins.flatMap((p) => pinLabel(project, p) ?? []), marked: false } }], "Clear no-connect flags")}>Clear no-connect flags</button></>}
          {selectedNet && <><button onClick={() => setAnnotationTool("label")}>Place {selectedNet.name} label</button><button onClick={() => setAnnotationTool("junction")}>Place junction dot</button></>}
          {activeWire && <><p className="muted small">Drag the wire's bend handles; double-click its path to add a bend.</p><button onClick={() => run([{ type: "schematic.annotation.remove", args: { doc: doc.id, id: activeWire } }], "Remove drawn wire path")}>Remove path (keep net)</button></>}
          {savedWires.length > 0 && <details><summary>Editable wire paths ({savedWires.length})</summary>{savedWires.map((w) => <button key={w.id} onClick={() => { setActiveWire(w.id); setActiveNet(w.net) }}>Edit {pinLabel(project, `${w.from.component}/${w.from.pin}`)} → {pinLabel(project, `${w.to.component}/${w.to.pin}`)}</button>)}</details>}
          {!ground && project.nets.length > 0 && <div className="circuit-ground-setup"><p className="muted small">Simulation needs an explicit 0 V reference. Select the battery's negative return net.</p><label>Ground net<select aria-label="Ground net" value={selectedNet?.id ?? ""} onChange={(e) => setActiveNet(e.target.value || null)}><option value="">Choose a net…</option>{project.nets.map((net) => <option key={net.id} value={net.id}>{net.name}</option>)}</select></label><button disabled={!selectedNet} onClick={() => selectedNet && renameNet(selectedNet, "GND")}>Set ground</button></div>}
          <details className="schematic-erc"><summary>Electrical checks · {electricalChecks.filter((c) => c.severity === "error").length} errors · {electricalChecks.filter((c) => c.severity === "warning").length} warnings</summary>{electricalChecks.map((check) => <button key={check.id} className={check.severity === "error" ? "electronics-error" : ""} onClick={() => { if (check.components?.[0]) selectComponent(check.components[0]); if (check.net) setActiveNet(check.net) }}>{check.message}</button>)}{!electricalChecks.length && <p className="muted small">Electrical checks pass.</p>}</details>
          {firmwares.length > 0 && <details className="schematic-coupled"><summary>Firmware + circuit</summary><p className="muted small">Execute compiled firmware for a 100 ms coupled snapshot. RP2040 supports PWM/ADC feedback; ESP uses digital GPIO.</p><select aria-label="Circuit firmware target" value={firmware} onChange={(e) => setFirmware(e.target.value)}><option value="">Choose target…</option>{firmwares.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}</select><button disabled={!firmware || live.coupledBusy} onClick={() => live.runCoupled([firmware])}>{live.coupledBusy ? "Executing firmware…" : "Run firmware + circuit"}</button>{live.coupled && <p className="muted small">Coupled 100 ms snapshot. Run/Reset returns to live analog.</p>}{live.coupledSerial && <pre>{live.coupledSerial}</pre>}</details>}
          {placed.length > 0 && <p className="muted small">Wires stay attached when parts move. Connections are shared with simulation, firmware and PCB. Select a wire to edit its bends; electrical checks appear above.</p>}
        </aside>
      </div>
    </div>
  )
}

function CircuitDeviceFeedback({ component, model, at, view, current, running, enabled, input }: {
  component: Component; model: string; at: XY; view: DeviceView; current?: number; running: boolean; enabled: boolean;
  input(reference: string, action: string): void
}) {
  const held = useRef(false)
  const [pressed, setPressed] = useState(false)
  const send = useRef(input)
  send.current = input
  useEffect(() => () => { if (held.current) send.current(component.ref, "release") }, [component.ref])
  const press = () => {
    if (!enabled || held.current) return
    held.current = true
    setPressed(true)
    input(component.ref, "press")
  }
  const release = () => {
    if (!held.current) return
    held.current = false
    setPressed(false)
    input(component.ref, "release")
  }
  const motion = motorMotion(liveValue(view.rpm), running)
  const brightness = Math.min(1, Math.max(0, liveValue(view.brightness)))
  const down = pressed || !!view.pressed
  return <g className="circuit-device-feedback" data-feedback-ref={component.ref} transform={`translate(${at[0]} ${at[1]})`}>
    {model === "dc-motor" && <g className="circuit-motor-state" data-motor-ref={component.ref} data-spinning={String(motion.animated)} data-rpm={motion.rpm} role="img" aria-label={`${component.ref}: ${Math.round(motion.rpm)} rpm, ${motion.state}`}>
      <title>{component.ref}: {Math.round(motion.rpm)} rpm · {motion.state}</title>
      <rect className="circuit-feedback-card" width="27" height="21" rx="1.5" />
      <g transform="translate(7 7)">
        <circle className="circuit-motor-housing" r="5.5" />
        <g className="circuit-motor-rotor" style={{ animationDuration: motion.duration, animationPlayState: motion.animated ? "running" : "paused", animationDirection: motion.direction }}>
          <circle r="5" fill="transparent" stroke="none" />
          {[0, 120, 240].map((rotation) => <path key={rotation} transform={`rotate(${rotation})`} d="M0 -.6 C-1 -4 4 -4 3.5 -1.5 L.7 .6 Z" />)}
        </g>
        <circle className="circuit-motor-hub" r="1" />
      </g>
      <text className="circuit-live-rpm" x="14" y="5">{Math.round(motion.rpm).toLocaleString()}</text>
      <text className="circuit-live-unit" x="14" y="8">rpm</text>
      {current !== undefined && <text className="circuit-live-current" x="14" y="12">{liveFormat(current, "A")}</text>}
      <text className="circuit-live-state" x="2" y="18">{motion.state}</text>
    </g>}
    {model === "led" && <g className="circuit-led-state" data-led-state-ref={component.ref} data-brightness={brightness}>
      <rect className="circuit-feedback-card" width="27" height={current === undefined ? 7 : 10} rx="1.5" />
      <circle cx="3" cy="3.6" r="1.15" fill={ledColor(component)} fillOpacity={0.18 + brightness * 0.82} stroke="none" />
      <text x="5.5" y="4.2">{brightness > 0.01 ? "ON" : "OFF"} · {Math.round(brightness * 100)}%</text>
      {current !== undefined && <text className="circuit-live-current" x="5.5" y="8">{liveFormat(current, "A")}</text>}
    </g>}
    {model === "button" && <g className="circuit-inline-control" data-pressed={down || undefined} data-disabled={!enabled || undefined} role="button" tabIndex={enabled ? 0 : -1} aria-label={`Hold ${component.ref}`} aria-pressed={down} aria-disabled={!enabled}
      onPointerDown={(event) => { event.stopPropagation(); event.preventDefault(); if (event.button === 0 && enabled) { event.currentTarget.setPointerCapture(event.pointerId); press() } }}
      onPointerUp={(event) => { event.stopPropagation(); release() }} onPointerCancel={(event) => { event.stopPropagation(); release() }} onLostPointerCapture={(event) => { event.stopPropagation(); release() }} onBlur={release}
      onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); press() } }}
      onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); release() } }}>
      <rect width="27" height="10" rx="1.5" />
      <circle cx="4" cy="5" r="1.9" />
      <text x="8" y="5.7">{down ? "Pressed" : `Hold ${component.ref}`}</text>
      <text className="circuit-control-help" x="1" y="14">Hold to power circuit</text>
    </g>}
    {model === "switch" && <g className="circuit-inline-control" data-disabled={!enabled || undefined} data-position={String(view.position ?? "A")} role="button" tabIndex={enabled ? 0 : -1} aria-label={`Toggle ${component.ref}`} aria-disabled={!enabled}
      onPointerDown={(event) => { event.stopPropagation(); event.preventDefault() }} onClick={(event) => { event.stopPropagation(); if (enabled) input(component.ref, "toggle") }}
      onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); event.stopPropagation(); if (enabled) input(component.ref, "toggle") } }}>
      <rect width="27" height="10" rx="1.5" />
      <path d={view.position === "B" ? "M2 6 L6 3" : "M2 3 L6 6"} />
      <text x="8" y="5.7">{component.ref} · {String(view.position ?? "A")} ⇄</text>
    </g>}
  </g>
}

function PartsTray({ onAdd, onDragPart }: { onAdd(part: string): void; onDragPart(part: string | null): void }) {
  const [parts, setParts] = useState<PartSummary[] | null>(null)
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [attempt, setAttempt] = useState(0)
  const [kicad, setKicad] = useState(false)
  useEffect(() => {
    let mounted = true
    setError("")
    api.parts().then((parts) => { if (mounted) setParts(parts.filter((p) => p.pins > 0)) }).catch(() => { if (mounted) setError("Could not load parts") })
    return () => { mounted = false }
  }, [attempt])
  const basics = ["resistor", "capacitor", "led", "battery", "push-button", "dc-motor"]
  const shown = query.trim()
    ? (parts ?? []).filter((part) => fuzzy(query, `${part.name} ${part.category} ${part.description}`))
    : basics.flatMap((id) => (parts ?? []).find((part) => part.id === id) ?? [])
  return <aside className="circuit-parts-tray" data-testid="parts-tray" aria-label="Parts tray">
    <h2>Parts</h2>
    <p className="muted small">{kicad ? "Pick a symbol to import it" : <>Drag onto the canvas<br />or click to add</>}</p>
    <input aria-label="Search circuit parts" placeholder={kicad ? "Search symbols…" : "Search parts…"} value={query} onChange={(e) => setQuery(e.target.value)} />
    {kicad ? <KicadSearch query={query} builtins={new Set((parts ?? []).filter((p) => p.source === "builtin").map((p) => p.id))} onClose={() => setKicad(false)} onImported={(id) => { setAttempt((n) => n + 1); onAdd(id) }} /> : <>
      {!parts && !error && <p className="muted small">Loading parts…</p>}
      {error && <><p className="electronics-error small">{error}</p><button onClick={() => setAttempt((n) => n + 1)}>Retry</button></>}
      <div className="circuit-part-cards">{shown.map((part) => <button key={part.id} className="circuit-part-card" data-part-id={part.id} draggable title={`Drag ${part.name} onto the canvas, or click to add`} onClick={() => onAdd(part.id)} onDragStart={(e) => { e.dataTransfer.effectAllowed = "copy"; e.dataTransfer.setData(PART_DRAG_TYPE, part.id); onDragPart(part.id) }} onDragEnd={() => onDragPart(null)}><PartIcon part={part.id} /><span>{part.name}</span><span className="circuit-part-grip" aria-hidden="true">⠿</span></button>)}</div>
      {parts && !shown.length && <p className="muted small">No matching parts</p>}
      {parts && <button className={query.trim() && !shown.length ? "" : "ghost small"} onClick={() => setKicad(true)}>Search KiCad libraries</button>}
    </>}
  </aside>
}

/** Find a symbol across the official KiCad libraries, then import it with its default footprint and add it. */
function KicadSearch({ query, builtins, onClose, onImported }: { query: string; builtins: Set<string>; onClose(): void; onImported(part: string): void }) {
  const [symbols, setSymbols] = useState<string[] | null>(null)
  const [pending, setPending] = useState(false)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const q = query.trim()
  useEffect(() => {
    if (!q) return
    let current = true
    setPending(true)
    const timer = setTimeout(() => {
      api.kicadSymbols(q)
        .then((refs) => { if (current) { setSymbols(refs); setError("") } })
        .catch((e) => { if (current) setError(e instanceof Error ? e.message : String(e)) })
        .finally(() => { if (current) setPending(false) })
    }, 200)
    return () => { current = false; clearTimeout(timer) }
  }, [q])
  async function pick(ref: string) {
    setBusy(ref)
    setError("")
    try {
      const name = ref.slice(ref.indexOf(":") + 1).toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[^a-z0-9]+|-+$/g, "") || "part"
      // Never shadow a built-in part, which may carry a simulation model.
      const { part } = await api.importKicad(ref, builtins.has(name) ? `${name}-kicad` : undefined)
      onImported(part.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy("")
    }
  }
  const shown = q ? symbols ?? [] : []
  return <div className="kicad-search" aria-label="KiCad libraries">
    <div className="kicad-search-head"><span>KiCad libraries</span><button className="ghost small" aria-label="Back to parts" title="Back to parts" onClick={onClose}>×</button></div>
    {!q && <p className="muted small">Type a part name, e.g. ESP32-S3</p>}
    {q && pending && !symbols && !error && <p className="muted small kicad-indexing">Indexing KiCad libraries… (first time only)</p>}
    <div className="kicad-symbols">{shown.map((ref) => <button key={ref} className="ghost" data-kicad-symbol={ref} aria-label={ref} title={ref} disabled={!!busy} onClick={() => pick(ref)}>{busy === ref ? "Importing…" : <>{ref.slice(ref.indexOf(":") + 1)}<small>{ref.slice(0, ref.indexOf(":"))}</small></>}</button>)}</div>
    {q && symbols && !pending && !shown.length && <p className="muted small">No KiCad symbols match</p>}
    {error && <p className="electronics-error small">{error}</p>}
  </div>
}

function PartIcon({ part }: { part: string }) {
  return <svg className="circuit-part-icon" viewBox="0 0 32 24" aria-hidden="true">
    {part === "resistor" ? <path d="M1 12 H7 L9 7 L12 17 L15 7 L18 17 L21 7 L24 12 H31" />
      : part === "capacitor" ? <path d="M2 12 H13 M13 4 V20 M19 4 V20 M19 12 H30" />
      : part === "led" ? <><path d="M2 14 H10 M10 7 L21 14 L10 21 Z M21 7 V21 M21 14 H30 M18 5 L23 0 M24 7 L29 2 M20 0 H23 V3 M26 2 H29 V5" /></>
      : part === "battery" ? <path d="M2 12 H12 M12 4 V20 M20 8 V16 M20 12 H30 M5 5 H9 M7 3 V7" />
      : part === "push-button" ? <><path d="M2 15 H9 M23 15 H30 M9 10 H23 M16 5 V10" /><circle cx="9" cy="15" r="1.8" /><circle cx="23" cy="15" r="1.8" /></>
      : part === "dc-motor" ? <><circle cx="16" cy="12" r="9" /><path d="M0 12 H7 M25 12 H32 M11 16 V8 L16 13 L21 8 V16" /></>
      : <><rect x="8" y="4" width="16" height="16" rx="2" /><path d="M2 8 H8 M2 16 H8 M24 8 H30 M24 16 H30" /></>}
  </svg>
}

/** Reference over value, as KiCad shows them. */
function SymbolTitle({ at, reference, value }: { at: { x: number; y: number; transform: string }; reference: string; value: string }) {
  return <text className="schematic-ref" {...at} stroke="none">{reference}<tspan className="schematic-value" x={at.x} dy="2.2">{value}</tspan></text>
}

function SymbolPinView({ pin, part, component, reference, picked, wired, wireTarget, wireSource, onStart }: { pin: SymbolPin; part: Part; component: string; reference: string; picked: boolean; wired: boolean; wireTarget: boolean; wireSource: boolean; onStart(e: ReactPointerEvent, source: string): void }) {
  const a = -pin.rot * Math.PI / 180
  const end: XY = [pin.at[0] + Math.cos(a) * pin.length, pin.at[1] + Math.sin(a) * pin.length]
  const logical = part.pins.find((p) => p.num === pin.num)
  const key = `${component}/${pin.num}`
  return <g className="schematic-pin" data-picked={picked || undefined} data-wired={wired || undefined} data-wire-target={wireTarget || undefined} data-wire-source={wireSource || undefined}>
    {!pin.hidden && <><line x1={pin.at[0]} y1={pin.at[1]} x2={end[0]} y2={end[1]} /><text x={end[0] + Math.cos(a) * 1} y={end[1] + Math.sin(a) * 1 + 0.5} textAnchor={Math.cos(a) < -0.1 ? "end" : Math.cos(a) > 0.1 ? "start" : "middle"} stroke="none">{!part.symbol?.hidePinNames ? logical?.name : ""}</text>{!part.symbol?.hidePinNumbers && <text className="schematic-pin-num" x={(pin.at[0] + end[0]) / 2 + 0.5} y={(pin.at[1] + end[1]) / 2 - 0.5} stroke="none">{pin.num}</text>}</>}
    <circle className="schematic-pin-dot" cx={pin.at[0]} cy={pin.at[1]} r="0.55" />
    <circle className="schematic-pin-target" data-pin-key={key} data-pin-address={`${reference}.${pin.num}`} role="button" tabIndex={0} aria-label={`Pin ${reference}.${pin.num} (${logical?.name ?? pin.num}). Drag to attach wire, click to select`} cx={pin.at[0]} cy={pin.at[1]} r="1.8" onPointerDown={(e) => onStart(e, key)} onDoubleClick={(e) => { e.stopPropagation(); if (!useApp.getState().selection.pins.includes(key)) togglePin(key) }} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePin(key) } }}><title>{reference}.{logical?.name} (pin {pin.num}) · Drag to another pin to attach a wire{pin.hidden ? " · hidden power pin" : ""}</title></circle>
  </g>
}

/** A power symbol or net-name label on a pin, standing in for a long wire. */
function NetPort({ end: { at, out }, name, kind }: { end: NetEnd; name: string; kind: NetStyle }) {
  const tip: XY = [at[0] + out[0] * 2.54, at[1] + out[1] * 2.54]
  const bar = (half: number, ahead: number) => `M${tip[0] + out[0] * ahead + out[1] * half} ${tip[1] + out[1] * ahead - out[0] * half} l${-out[1] * half * 2} ${out[0] * half * 2}`
  const flat = out[1] === 0, gap = kind === "power" ? 1 : .6
  return <g className="schematic-port" data-port={kind}>
    <path d={`M${at[0]} ${at[1]} L${tip[0]} ${tip[1]}${kind === "ground" ? bar(1.3, 0) + bar(.8, .6) + bar(.3, 1.2) : kind === "power" ? bar(1.1, 0) : ""}`} />
    {(kind !== "ground" || name.toUpperCase() !== "GND") && <text x={tip[0] + out[0] * (kind === "ground" ? 2.2 : gap)} y={tip[1] + (flat ? .55 : out[1] > 0 ? 1.8 + (kind === "ground" ? 1 : 0) : -gap)} textAnchor={flat ? out[0] > 0 ? "start" : "end" : "middle"} stroke="none">{name}</text>}
  </g>
}

function SymbolGraphic({ graphic: g, c }: { graphic: Graphic; c: Component }) {
  const fill = "fill" in g && g.fill ? g.fill === "background" ? "var(--surface)" : "currentColor" : "none"
  const common = { strokeWidth: "width" in g ? g.width || 0.2 : 0.2, fill }
  if (g.type === "rect") return <rect x={Math.min(g.start[0], g.end[0])} y={Math.min(g.start[1], g.end[1])} width={Math.abs(g.end[0] - g.start[0])} height={Math.abs(g.end[1] - g.start[1])} {...common} />
  if (g.type === "circle") return <circle cx={g.center[0]} cy={g.center[1]} r={g.radius} {...common} />
  if (g.type === "poly") return <polyline points={g.pts.map((p) => p.join(",")).join(" ")} {...common} />
  if (g.type === "arc") return <path d={arc(g.start, g.mid, g.end)} {...common} />
  return <text x={g.at[0]} y={g.at[1]} fontSize={g.size} textAnchor="middle" dominantBaseline="middle" stroke="none" fill="currentColor" transform={`rotate(${-(g.rot ?? 0)} ${g.at[0]} ${g.at[1]})`}>{g.text.replaceAll("${REFERENCE}", c.ref).replaceAll("${VALUE}", c.props.value ?? "")}</text>
}

function arc(s: XY, m: XY, e: XY) {
  const [ax, ay] = s, [bx, by] = m, [cx, cy] = e
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-9) return `M${s.join(" ")} L${m.join(" ")} L${e.join(" ")}`
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  const radius = Math.hypot(ax - ux, ay - uy)
  const turn = (n: number) => (n % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2)
  const start = Math.atan2(ay - uy, ax - ux)
  let sweep = turn(Math.atan2(cy - uy, cx - ux) - start)
  if (turn(Math.atan2(by - uy, bx - ux) - start) > sweep) sweep -= Math.PI * 2
  return `M${s.join(" ")} A${radius} ${radius} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep >= 0 ? 1 : 0} ${e.join(" ")}`
}

function SchematicConnections({ project }: { project: Project }) {
  const keys = useApp((s) => s.selection.pins)
  const [name, setName] = useState("")
  const pins = keys.flatMap((key) => pinLabel(project, key) ?? [])
  if (!pins.length) return null
  const canConnect = pins.length > 1 || !!name.trim()
  const wired = project.nets.some((n) => n.pins.some((p) => keys.includes(`${p.component}/${p.pin}`)))
  return <div className="electronics-connect-bar"><span className="mono">{pins.join(" · ")}</span><input aria-label="Net name" value={name} placeholder="Net name (optional)" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && canConnect && connect(pins, name.trim()).then(() => setName(""))} /><button className="primary" disabled={!canConnect} onClick={() => connect(pins, name.trim()).then(() => setName(""))}>Connect</button>{wired && <button onClick={() => disconnect(pins)}>Disconnect</button>}<button title="Clear selected pins" onClick={clearPins}>×</button></div>
}
