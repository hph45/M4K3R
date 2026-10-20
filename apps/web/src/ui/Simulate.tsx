import { formatQuantity, parseQuantity, type Component } from "@m4k3r/core"
import { SimulationData, type View } from "@m4k3r/sim"
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import type { DocViewProps } from "../registry"
import { run, selectComponent, useApp } from "../store"
import type { ScopePoint } from "../simulationRunner"
import { useCircuitSimulation } from "../useCircuitSimulation"
import { motorMotion } from "../motorMotion"
import { ScenarioPanel } from "./ScenarioPanel"
import { VehiclePanel } from "./VehiclePanel"
import "./Simulate.css"

const fmt = (value: number | undefined, unit = "") => value === undefined || !Number.isFinite(value) ? "—" : formatQuantity(Math.abs(value) < 1e-12 ? 0 : value, unit)
const colors = ["#6593ff", "#e8a24d", "#48bca0", "#c58bea", "#ed788c", "#6dbed8"]

/** Palette actions target the mounted workspace without keeping a worker alive after leaving its tab. */
let activeToggle: (() => void) | undefined
export const toggleSimulation = () => activeToggle?.()

export function Simulate({ project, doc }: DocViewProps) {
  const parsed = useMemo(() => SimulationData.safeParse(doc.data), [doc.data])
  const data = parsed.success ? parsed.data : SimulationData.parse({})
  const live = useCircuitSimulation(project, { sessionKey: doc.id, data })
  const { frame, error, ready, coupledBusy, coupledSerial } = live
  const [firmware, setFirmware] = useState("")
  const selected = useApp((state) => state.selection.component)
  useEffect(() => {
    activeToggle = live.toggle
    return () => { activeToggle = undefined }
  }, [live.toggle])

  const update = (changes: Partial<SimulationData>) => run([{ type: "sim.update", args: { doc: doc.id, ...changes } }], "Update simulation")
  const addProbe = (name: string) => name && !data.probes.includes(name) && update({ probes: [...data.probes, name] })
  const available = [
    ...project.nets.map((net) => `V(${net.name})`),
    ...Object.keys(frame.snapshot.currents).map((ref) => `I(${ref})`),
    ...Object.entries(frame.snapshot.views).flatMap(([ref, view]) => Object.entries(view).filter(([, value]) => typeof value === "number").map(([field]) => `${ref}.${field}`)),
  ].filter((name) => !data.probes.includes(name))

  return <div className="sim-workspace">
    <div className="sim-toolbar">
      <div className="sim-title"><span className={`sim-status ${frame.running ? "is-running" : ""}`} />Live circuit</div>
      <button className={frame.running ? "" : "primary"} disabled={!ready || !!error || coupledBusy} onClick={live.toggle}>{frame.running ? "Pause" : "Run"}</button>
      <button disabled={!ready || !!error || coupledBusy} onClick={live.step} title="Advance 1 ms, or one solver step if larger">Step</button>
      <button onClick={live.reset}>Reset</button>
      <span className="sim-clock">{fmt(frame.snapshot.t, "s")}</span>
      <span className="sim-factor" title="Achieved simulated time per wall-clock second">{frame.running ? `${frame.realtime.toFixed(2)}× realtime` : "Paused"}</span>
      <span className="spacer" />
      <label>Speed <select aria-label="Simulation speed" value={data.speed} onChange={(event) => update({ speed: Number(event.target.value) })}>
        {[0.1, 0.25, 0.5, 1, 2, 5, 10].map((speed) => <option key={speed} value={speed}>{speed}×</option>)}
        {![0.1, 0.25, 0.5, 1, 2, 5, 10].includes(data.speed) && <option value={data.speed}>{data.speed}×</option>}
      </select></label>
      <TimeSetting key={data.step} label="Solver step" value={data.step} min={1e-9} max={1} onChange={(step) => update({ step })} />
    </div>

    {(!parsed.success || error) && <div className="sim-error" role="alert">{!parsed.success ? "The saved simulation settings are invalid. Update them with sim.update." : error}</div>}
    {frame.warnings.length > 0 && <div className="sim-warnings">{frame.warnings.map((warning) => <p key={warning}>{warning}</p>)}</div>}
    <div className="sim-content">
      <section className="sim-devices">
        <div className="sim-section-title"><h2>Components</h2><span>Hold buttons · toggle switches · probe a reading</span></div>
        {!project.components.length && <p className="sim-empty">Add parts and connect a net named GND in Wiring to begin.</p>}
        <div className="sim-device-grid">{project.components.map((component) => {
          const part = project.parts[component.part]
          return <Device key={component.id} component={component} name={part?.name ?? component.part} model={part?.sim?.model ?? (/brushless/i.test(component.part) && frame.snapshot.views[component.ref]?.rpm !== undefined ? "dc-motor" : undefined)} view={frame.snapshot.views[component.ref] ?? {}} current={frame.snapshot.currents[component.ref]}
            active={selected === component.id} animate={frame.running} enabled={ready && !error} onSelect={() => selectComponent(component.id)} onInput={(action) => live.input(component.ref, action)} onProbe={addProbe} />
        })}</div>
      </section>

      <section className="sim-scope">
        <div className="sim-section-title"><h2>Scope</h2><span>Last 600 samples · each trace has its own scale</span>
          <select aria-label="Add scope probe" value="" disabled={data.probes.length >= 32} onChange={(event) => addProbe(event.target.value)}><option value="">+ Add probe…</option>{available.map((name) => <option key={name} value={name}>{name}</option>)}</select>
        </div>
        {!data.probes.length && <div className="sim-empty">Choose a net or component reading to record a live trace.</div>}
        {data.probes.map((name, index) => <Trace key={name} name={name} points={frame.points} color={colors[index % colors.length]!} onRemove={() => update({ probes: data.probes.filter((probe) => probe !== name) })} />)}
      </section>
      <details className="sim-saved-settings"><summary>Saved headless run</summary><div>
        <label>Analysis <select aria-label="Saved analysis" value={data.analysis} onChange={(event) => update({ analysis: event.target.value as "op" | "tran" })}><option value="tran">Transient</option><option value="op">DC operating point</option></select></label>
        <TimeSetting key={data.duration} label="Duration" value={data.duration} onChange={(duration) => update({ duration })} />
        <span>{data.inputs.length} timed input{data.inputs.length === 1 ? "" : "s"} · Run via the simulation_run tool or saved-run API.</span>
      </div></details>
      <details className="sim-saved-settings"><summary>Firmware + circuit</summary><div>
        <select aria-label="Coupled firmware document" value={firmware} onChange={(event) => setFirmware(event.target.value)}><option value="">Choose firmware…</option>{project.docs.filter((doc) => doc.kind === "firmware").map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select>
        <button disabled={!firmware || coupledBusy} onClick={() => live.runCoupled([firmware])}>{coupledBusy ? "Executing real firmware…" : "Run firmware + circuit · 100 ms"}</button>
        <span>Runs genuine firmware and returns a paused circuit snapshot. RP2040: GPIO/PWM/ADC. ESP32: digital GPIO only; no ADC/PWM/peripheral injection.</span>
      </div>{coupledSerial && <pre className="sim-coupled-serial">{coupledSerial}</pre>}</details>
      <ScenarioPanel key={doc.id} project={project.id} doc={doc.id} data={data} />
      <VehiclePanel key={`${doc.id}/${JSON.stringify(data.vehicle)}`} project={project} doc={doc.id} data={data} state={frame.vehicle} />
      <p className="sim-footnote">Run controls interactive analog models. Firmware + circuit executes genuine code and returns a paused batch snapshot. Circuit edits restart from power-on.</p>
    </div>
  </div>
}

function TimeSetting({ label, value, min = 0, max = Infinity, onChange }: { label: string; value: number; min?: number; max?: number; onChange(value: number): unknown }) {
  const [text, setText] = useState(fmt(value, "s"))
  const [invalid, setInvalid] = useState(false)
  const commit = () => {
    const quantity = parseQuantity(text)
    const valid = !!quantity && Number.isFinite(quantity.value) && quantity.value > 0 && quantity.value >= min && quantity.value <= max && (quantity.unit === "s" || quantity.unit === "")
    setInvalid(!valid)
    if (valid && quantity.value !== value) onChange(quantity.value)
  }
  return <label>{label}<input aria-label={label} aria-invalid={invalid || undefined} value={text} onChange={(event) => { setText(event.target.value); setInvalid(false) }} onBlur={commit} onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()} title="Time in seconds, e.g. 10µs or 1ms" /></label>
}

function Device({ component, name, model, view, current, active, animate, enabled, onSelect, onInput, onProbe }: {
  component: Component; name: string; model?: string; view: View; current?: number; active: boolean; animate: boolean; enabled: boolean | string;
  onSelect(): void; onInput(action: string): void; onProbe(name: string): unknown;
}) {
  const held = useRef(false)
  const press = () => { if (!held.current) { held.current = true; onInput("press") } }
  const release = () => { if (held.current) { held.current = false; onInput("release") } }
  const motor = motorMotion(Number(view.rpm ?? 0), animate)
  const brightness = Math.min(1, Math.max(0, Number(view.brightness ?? 0)))
  const color = component.props.color === "white" ? "#dce8ff" : component.props.color ?? "#ed5c62"
  return <article className="sim-device" data-selected={active || undefined} onClick={onSelect}>
    <div className="sim-device-heading"><strong>{component.ref}</strong><span>{name}</span></div>
    {!model && <div className="sim-unmodeled">No simulation model</div>}
    {model === "button" && <button className="sim-push" data-pressed={!!view.pressed || undefined} disabled={!enabled}
      onPointerDown={(event) => { event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); press() }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} onBlur={release}
      onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); press() } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); release() } }}
      aria-label={`Hold ${component.ref}`} aria-pressed={!!view.pressed}>{view.pressed ? "Pressed" : "Hold to press"}</button>}
    {model === "switch" && <button className="sim-switch" disabled={!enabled} onClick={() => onInput("toggle")} aria-label={`Toggle ${component.ref}`}>A <span data-position={view.position ?? "A"} /> B <strong>{String(view.position ?? "A")}</strong></button>}
    {model === "led" && <div className="sim-led-state"><span className="sim-led" style={{ "--led-color": color, opacity: 0.25 + brightness * 0.75, boxShadow: brightness > 0.01 ? `0 0 ${8 + brightness * 24}px ${color}` : "none" } as CSSProperties} /><button className="ghost" onClick={() => onProbe(`${component.ref}.brightness`)}>{Math.round(brightness * 100)}%</button></div>}
    {model === "dc-motor" && <button className="sim-motor ghost" data-motor-state={motor.state.toLowerCase()} data-motor-moving={motor.moving} data-motor-rpm={motor.rpm.toFixed(1)} onClick={() => onProbe(`${component.ref}.rpm`)} aria-label={`${component.ref}: ${motor.state}, ${Math.round(motor.rpm)} rpm`}>
      <span className="sim-motor-housing"><svg className="sim-rotor" viewBox="-24 -24 48 48" aria-hidden="true" style={{ animationDuration: motor.duration, animationDirection: motor.direction, animationPlayState: motor.animated ? "running" : "paused" }}>
        <path className="sim-fan-blade" d="M0-4C-4-11-8-21-2-21C8-21 12-13 4-2Z" /><path className="sim-fan-blade" transform="rotate(120)" d="M0-4C-4-11-8-21-2-21C8-21 12-13 4-2Z" /><path className="sim-fan-blade" transform="rotate(240)" d="M0-4C-4-11-8-21-2-21C8-21 12-13 4-2Z" /><circle r="4" className="sim-fan-hub" /><circle cx="-2" cy="-18" r="2" className="sim-fan-marker" />
      </svg></span><span className="sim-motor-reading"><strong>{Math.round(motor.rpm)} rpm</strong><span>{motor.state}</span></span>
    </button>}
    {model === "battery" && <div className="sim-battery"><meter min="0" max="1" value={Number(view.soc ?? 1)} aria-label={`${component.ref} state of charge`} /><button className="ghost" onClick={() => onProbe(`${component.ref}.soc`)}>{(Number(view.soc ?? 1) * 100).toFixed(1)}%</button><span>{fmt(typeof view.voltage === "number" ? view.voltage : undefined, "V")}</span></div>}
    {model && !["button", "switch", "led", "dc-motor", "battery"].includes(model) && <div className="sim-value">{component.props.value ?? model}</div>}
    {current !== undefined && <button className="sim-current ghost" title={`Probe I(${component.ref})`} onClick={() => onProbe(`I(${component.ref})`)}>{fmt(current, "A")}</button>}
  </article>
}

function Trace({ name, points, color, onRemove }: { name: string; points: ScopePoint[]; color: string; onRemove(): void }) {
  const values = points.map((point) => ({ t: point.t, value: point.values[name] })).filter((point): point is { t: number; value: number } => typeof point.value === "number" && Number.isFinite(point.value))
  const min = values.length ? Math.min(0, ...values.map((point) => point.value)) : 0
  const max = values.length ? Math.max(...values.map((point) => point.value), min + 1e-9) : 1
  const first = points[0]?.t ?? 0
  const last = Math.max(first + 1e-9, points.at(-1)?.t ?? 0)
  const path = values.map((point) => `${((point.t - first) / (last - first) * 1000).toFixed(2)},${(72 - (point.value - min) / (max - min) * 64).toFixed(2)}`).join(" ")
  const unit = name.startsWith("V(") ? "V" : name.startsWith("I(") || name.endsWith(".current") ? "A" : ""
  return <div className="sim-trace"><div className="sim-trace-header"><span style={{ color }}>{name}</span><strong>{fmt(values.at(-1)?.value, unit)}</strong><button className="ghost" aria-label={`Remove probe ${name}`} onClick={onRemove}>×</button></div>
    <div className="sim-plot"><span className="sim-range">{fmt(max, unit)}<br />{fmt(min, unit)}</span><svg viewBox="0 0 1000 80" preserveAspectRatio="none" aria-label={`${name} waveform`}><path d="M0 8H1000M0 40H1000M0 72H1000" className="sim-grid" /><polyline points={path} stroke={color} vectorEffect="non-scaling-stroke" /></svg></div>
    <div className="sim-time-range"><span>{fmt(first, "s")}</span><span>{fmt(points.at(-1)?.t, "s")}</span></div>
  </div>
}
