import type { Project } from "@m4k3r/core"
import { SkidSteerData, type SimulationData, type VehicleState } from "@m4k3r/sim"
import { useState } from "react"
import { run } from "../store"

export function VehiclePanel({ project, doc, data, state }: { project: Project; doc: string; data: SimulationData; state?: VehicleState }) {
  const [assembly, setAssembly] = useState(project.docs.find((doc) => doc.kind === "assembly")?.id ?? "")
  const [radius, setRadius] = useState("0.025")
  const [text, setText] = useState(JSON.stringify(data.vehicle ?? {}, null, 2))
  const [error, setError] = useState("")
  const motors = project.components.filter((component) => project.parts[component.part]?.sim?.model === "dc-motor")
  async function fromAssembly() {
    try {
      if (motors.length < 2) throw new Error("A skid-steer setup needs at least two DC motors")
      const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/assembly/${encodeURIComponent(assembly)}/properties`)
      const value = await response.json()
      if (!response.ok) throw new Error(value.error ?? "Assembly evaluation failed")
      const poses = motors.slice(0, 2).map((motor) => value.instances.find((instance: { source: { type: string; component?: string } }) => instance.source.type === "component" && instance.source.component === motor.id)?.centerOfMass as number[] | undefined)
      if (!poses[0] || !poses[1]) throw new Error("Place both drive motors in the linked assembly first")
      const trackWidth = Math.hypot(poses[0][0]! - poses[1][0]!, poses[0][1]! - poses[1][1]!) / 1000
      const vehicle = SkidSteerData.parse({ left: [motors[0]!.ref], right: [motors[1]!.ref], mass: value.mass / 1000, yawInertia: value.inertia[2][2] * 1e-9, trackWidth, wheelRadius: Number(radius), source: `Assembly ${assembly}, project version ${project.version}; wheel radius supplied by user; first two DC motors selected as left/right` })
      setText(JSON.stringify(vehicle, null, 2)); setError("")
      await run([{ type: "sim.update", args: { doc, vehicle } }], "Link vehicle assembly physics")
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  return <details className="sim-saved-settings sim-vehicle" open={!!data.vehicle}><summary>Planar vehicle · assembly mass and motor torque</summary>
    <p>DC motor shaft speeds feed back through back-EMF; solved torque drives a planar chassis with traction limits. No terrain, suspension or collision physics. Geometry uses m, mass kg, inertia kg·m².</p>
    <div><select aria-label="Vehicle assembly" value={assembly} onChange={(event) => setAssembly(event.target.value)}><option value="">Choose assembly…</option>{project.docs.filter((doc) => doc.kind === "assembly").map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select><label>Wheel radius m<input aria-label="Vehicle wheel radius" value={radius} onChange={(event) => setRadius(event.target.value)} /></label><button disabled={!assembly || motors.length < 2} onClick={fromAssembly}>Use assembly mass & inertia</button></div>
    <textarea aria-label="Vehicle physics JSON" value={text} onChange={(event) => setText(event.target.value)} />
    <div><button onClick={async () => { try { const vehicle = SkidSteerData.parse(JSON.parse(text)); await run([{ type: "sim.update", args: { doc, vehicle } }], "Configure vehicle physics"); setError("") } catch (error) { setError(error instanceof Error ? error.message : String(error)) } }}>Save vehicle parameters</button>{data.vehicle && <button onClick={() => run([{ type: "sim.update", args: { doc, vehicle: null } }], "Disable vehicle physics")}>Disable vehicle</button>}</div>
    {error && <p role="alert">{error}</p>}
    {state && <><svg className="sim-vehicle-map" viewBox="-2 -2 4 4" aria-label="Planar vehicle position"><defs><pattern id="vehicle-grid" width="0.25" height="0.25" patternUnits="userSpaceOnUse"><path d="M.25 0H0V.25" /></pattern></defs><rect x="-2" y="-2" width="4" height="4" fill="url(#vehicle-grid)" /><g transform={`translate(${Math.max(-1.8, Math.min(1.8, state.x))} ${-Math.max(-1.8, Math.min(1.8, state.y))}) rotate(${-state.heading * 180 / Math.PI})`}><rect x="-.12" y="-.1" width=".24" height=".2" rx=".02" /><path d="M-.04-.04 .07 0-.04.04" /></g></svg><p>x {state.x.toFixed(3)} m · y {state.y.toFixed(3)} m · heading {(state.heading * 180 / Math.PI).toFixed(1)}° · speed {state.speed.toFixed(3)} m/s{state.tractionLimited ? " · Traction limited" : ""}</p></>}
  </details>
}
