import { useEffect, useState } from "react"
import { rotateFlightVector, type DeviceAnalysisData, type DeviceAnalysisResult, type FlightFrame, type FlightResult, type Vector3 } from "@m4k3r/sim"

export function FlightPreview({ project, doc, data, analysis }: { project: string; doc: string; data: DeviceAnalysisData; analysis: DeviceAnalysisResult }) {
  const [throttle, setThrottle] = useState(analysis.hover?.throttle ?? 0)
  const [overrides, setOverrides] = useState<Record<string, number>>({})
  const [duration, setDuration] = useState(3), [altitude, setAltitude] = useState(1)
  const [roll, setRoll] = useState(0), [pitch, setPitch] = useState(0)
  const [result, setResult] = useState<FlightResult | null>(null), [index, setIndex] = useState(0)
  const [playing, setPlaying] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("")
  useEffect(() => { setThrottle(analysis.hover?.throttle ?? 0); setOverrides({}); setResult(null); setPlaying(false) }, [doc, analysis.mass, analysis.hover?.throttle])
  useEffect(() => {
    if (!playing || !result) return
    const interval = setInterval(() => setIndex((current) => { const next = Math.min(result.frames.length - 1, current + Math.max(1, Math.round(result.frames.length / Math.max(0.1, result.t) / 30))); if (next === result.frames.length - 1) setPlaying(false); return next }), 33)
    return () => clearInterval(interval)
  }, [playing, result])
  async function execute() {
    setBusy(true); setError(""); setPlaying(false)
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project)}/device-analysis/${encodeURIComponent(doc)}/flight`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ duration, throttle, rotorThrottle: overrides, altitude, attitude: [roll, pitch, 0] }) })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error ?? "Flight preview failed")
      setResult(value); setIndex(value.frames.length - 1)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  const frame = result?.frames[index]
  return <section className="flight-preview">
    <div className="flight-preview-heading"><h2>Rigid-body flight preview</h2><span>Manual theory · firmware is not executed</span></div>
    <p>Explore gravity, rotor forces and attitude using this assembly's mass, center of gravity and full inertia. Balanced collective thrust provides lift; an aircraft still needs a tested flight controller to stabilize and trim it.</p>
    <div className="flight-controls"><label>Collective throttle <strong>{(throttle * 100).toFixed(1)}%</strong><input aria-label="Preview collective throttle" type="range" min="0" max="100" step="0.5" value={throttle * 100} onChange={(event) => setThrottle(Number(event.target.value) / 100)} /></label><button disabled={!analysis.hover} onClick={() => { setThrottle(analysis.hover!.throttle); setOverrides({}) }}>Use estimated hover throttle</button>
      <label>Duration (s)<input aria-label="Preview duration (s)" type="number" min="0.05" max="10" step="0.1" value={duration} onChange={(event) => setDuration(Number(event.target.value))} /></label>
      <label>Starting CG altitude (m)<input aria-label="Preview altitude (m)" type="number" min="0" max="100" step="0.1" value={altitude} onChange={(event) => setAltitude(Number(event.target.value))} /></label>
      <label>Initial roll (°)<input aria-label="Preview initial roll" type="number" min="-90" max="90" step="1" value={roll} onChange={(event) => setRoll(Number(event.target.value))} /></label>
      <label>Initial pitch (°)<input aria-label="Preview initial pitch" type="number" min="-90" max="90" step="1" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} /></label>
    </div>
    <details className="flight-rotor-controls"><summary>Individual rotor throttle</summary><p>Changing one rotor can rotate the body. These are explicit manual commands, with no attitude-hold or autopilot.</p>{data.rotors.map((rotor) => <label key={rotor.component}>{rotor.component}<input aria-label={`Preview ${rotor.component} throttle`} type="range" min="0" max="100" step="0.5" value={(overrides[rotor.component] ?? throttle) * 100} onChange={(event) => setOverrides((previous) => ({ ...previous, [rotor.component]: Number(event.target.value) / 100 }))} /><span>{((overrides[rotor.component] ?? throttle) * 100).toFixed(1)}%</span></label>)}<button onClick={() => setOverrides({})}>Reset rotor overrides</button></details>
    <button className="primary" disabled={busy || !analysis.massComplete || !analysis.inputComplete || analysis.mechanicalConflict} onClick={execute}>{busy ? "Computing trajectory…" : "Run rigid-body preview"}</button>
    {error && <p className="device-analysis-error" role="alert">{error}</p>}
    {result && frame && <>
      <div className="flight-playback"><button onClick={() => { if (!playing && index === result.frames.length - 1) setIndex(0); setPlaying(!playing) }}>{playing ? "Pause replay" : "Play replay"}</button><input aria-label="Flight preview time" type="range" min="0" max={result.frames.length - 1} step="1" value={index} onChange={(event) => { setPlaying(false); setIndex(Number(event.target.value)) }} /><strong>{frame.t.toFixed(2)} / {result.t.toFixed(2)} s</strong><span data-flight-status={result.status}>{result.status === "ground-contact" ? "Ground contact · motion stopped" : result.status === "battery-depleted" ? "Battery charge depleted" : "Preview complete"}</span></div>
      <FlightScene result={result} frame={frame} />
      <div className="flight-readings"><span>CG altitude <strong data-flight-altitude>{frame.position[2].toFixed(3)} m</strong></span><span>Roll / pitch / yaw <strong>{frame.attitude.map((angle) => angle.toFixed(1)).join(" / ")}°</strong></span><span>Battery <strong>{frame.voltage.toFixed(2)} V · {frame.current.toFixed(2)} A</strong></span><span>Applied throttle scale <strong>{(frame.throttleScale * 100).toFixed(1)}%</strong></span><span>Usable charge spent <strong>{(frame.usedAh * 1000).toFixed(2)} mAh</strong></span></div>
      <FlightTrace result={result} attitude={false} /><FlightTrace result={result} attitude />
      <details><summary>Flight assumptions and checks</summary>{[...result.assumptions, ...result.warnings].map((note, index) => <p key={index}>{note}</p>)}</details>
    </>}
  </section>
}

const plus = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const product = (a: Vector3, value: number): Vector3 => [a[0] * value, a[1] * value, a[2] * value]
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const project = (point: Vector3) => [90 * (point[0] - 0.6 * point[1]), -90 * (point[2] + 0.25 * point[0] + 0.25 * point[1])]
const point = (value: number[]) => value.map((value) => value.toFixed(2)).join(",")
function FlightScene({ result, frame }: { result: FlightResult; frame: FlightFrame }) {
  const [follow, setFollow] = useState(true)
  const all = [...result.frames.map((frame) => project(frame.position)), project([-1, -1, 0]), project([1, 1, 0])]
  const minX = Math.min(...all.map((p) => p[0]!)) - 40, maxX = Math.max(...all.map((p) => p[0]!)) + 40
  const minY = Math.min(...all.map((p) => p[1]!)) - 40, maxY = Math.max(...all.map((p) => p[1]!)) + 40
  const world = (local: Vector3) => plus(frame.position, rotateFlightVector(frame.quaternion, local))
  const center = project(frame.position)
  const radius = Math.max(0.15, ...result.layout.map((rotor) => Math.hypot(...rotor.center) + rotor.radius)) * 100 + 10
  const viewBox = follow ? `${center[0]! - radius} ${center[1]! - radius} ${radius * 2} ${radius * 2}` : `${minX} ${minY} ${maxX - minX} ${maxY - minY}`
  return <div className="flight-viewport"><div className="flight-camera"><button aria-pressed={follow} onClick={() => setFollow(true)}>Follow aircraft</button><button aria-pressed={!follow} onClick={() => setFollow(false)}>Full path</button></div><svg className="flight-scene" viewBox={viewBox} role="img" aria-label="Three dimensional rigid-body rotor layout and flight path">
    <path className="flight-ground" d={`M${point(project([-1, -1, 0]))}L${point(project([1, -1, 0]))}L${point(project([1, 1, 0]))}L${point(project([-1, 1, 0]))}Z`} />
    <polyline className="flight-path" points={result.frames.map((frame) => point(project(frame.position))).join(" ")} />
    <line className="flight-altitude-line" x1={project([frame.position[0], frame.position[1], 0])[0]} y1={project([frame.position[0], frame.position[1], 0])[1]} x2={center[0]} y2={center[1]} />
    {result.layout.map((rotor, index) => {
      const at = project(world(rotor.center)), tangent = cross(rotor.axis, Math.abs(rotor.axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1])
      const u = product(tangent, 1 / Math.hypot(...tangent)), v = cross(rotor.axis, u)
      const disc = Array.from({ length: 25 }, (_, i) => { const angle = i / 24 * 2 * Math.PI; return point(project(world(plus(rotor.center, plus(product(u, Math.cos(angle) * rotor.radius), product(v, Math.sin(angle) * rotor.radius)))))) }).join(" ")
      return <g key={rotor.component} data-flight-rotor={rotor.component}><line className="flight-arm" x1={center[0]} y1={center[1]} x2={at[0]} y2={at[1]} /><polyline className="flight-disc" data-powered={(frame.rotors[index]?.thrust ?? 0) > 0} points={disc} /><circle cx={at[0]} cy={at[1]} r="1.5" /><text x={at[0]! + 4} y={at[1]! - 4} style={{ fontSize: follow ? radius / 12 : 6 }}>{rotor.component}</text><title>{rotor.component}: {frame.rotors[index]?.thrust.toFixed(2)} N</title></g>
    })}
    <line className="flight-heading" x1={center[0]} y1={center[1]} x2={project(world([0.15, 0, 0]))[0]} y2={project(world([0.15, 0, 0]))[1]} />
  </svg></div>
}

function FlightTrace({ result, attitude }: { result: FlightResult; attitude: boolean }) {
  const series = attitude ? [0, 1, 2].map((axis) => result.frames.map((frame) => frame.attitude[axis]!)) : [result.frames.map((frame) => frame.position[2])]
  const min = Math.min(0, ...series.flat()), max = Math.max(min + 1e-6, ...series.flat()), colors = ["#6593ff", "#e8a24d", "#48bca0"]
  return <div className="flight-trace"><div><strong>{attitude ? "Attitude · roll / pitch / yaw (°)" : "CG altitude (m)"}</strong><span>{min.toFixed(1)} … {max.toFixed(1)}</span></div><svg viewBox="0 0 600 90" preserveAspectRatio="none" aria-label={attitude ? "Attitude over time" : "Altitude over time"}><path d="M0 10H600M0 45H600M0 80H600" />{series.map((values, index) => <polyline key={index} stroke={colors[index]} points={values.map((value, i) => `${result.frames[i]!.t / Math.max(0.001, result.t) * 600},${80 - (value - min) / (max - min) * 70}`).join(" ")} />)}</svg><span>0 … {result.t.toFixed(2)} s</span></div>
}
