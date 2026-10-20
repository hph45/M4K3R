import { useEffect, useMemo, useState } from "react"
import { DeviceAnalysisData, deviceStatusLabel, grams, type DeviceAnalysisResult } from "@m4k3r/sim"
import type { DocViewProps } from "../registry"
import { run } from "../store"
import "./DeviceAnalysis.css"
import { DeviceInputs } from "./DeviceInputs"
import { FlightPreview } from "./FlightPreview"

const fixed = (value: number | null | undefined, digits = 2) => value === null || value === undefined ? "—" : value.toFixed(digits)
const gramsText = (newtons: number) => `${grams(newtons).toFixed(0)} g`

export function DeviceAnalysis({ project, doc }: DocViewProps) {
  const parsed = useMemo(() => DeviceAnalysisData.safeParse(doc.data), [doc.data])
  const data = useMemo(() => parsed.success ? parsed.data : DeviceAnalysisData.parse({}), [parsed])
  const [result, setResult] = useState<DeviceAnalysisResult | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { setResult(null); setError("") }, [project.id, doc.id])
  // Analyze on open and after every saved project change (inputs, parts, assembly), debounced.
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      setBusy(true)
      try {
        const response = await fetch(`/api/projects/${encodeURIComponent(project.id)}/device-analysis/${encodeURIComponent(doc.id)}`, { signal: controller.signal })
        const value = await response.json()
        if (!response.ok) throw new Error(value.error ?? "Device analysis failed")
        setResult(value); setError("")
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : String(error)) }
      finally { if (!controller.signal.aborted) setBusy(false) }
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [project.id, project.version, doc.id])
  const save = async (next: DeviceAnalysisData, label: string) => {
    if (!await run([{ type: "device.analysis.set", args: { doc: doc.id, data: next } }], label)) throw new Error("Not saved. Check the server connection and try again.")
  }
  const point = result?.hover ?? result?.maximum, maximum = result?.maximum
  return <div className="device-analysis">
    <header className="device-analysis-toolbar"><strong>Device feasibility</strong><span className="muted">Assembly + propulsion + battery</span><span className="spacer" />{busy && <span className="muted small" role="status">Analyzing…</span>}</header>
    <div className="device-analysis-body">
      <section className="device-analysis-inputs"><h2>Physical inputs</h2><p>Link an assembly to use its component and CAD mass, center of gravity and inertia. Rotor positions and axes come from placed motors or propellers.</p>
        <label>Assembly<select aria-label="Analysis assembly" value={project.docs.find((candidate) => candidate.kind === "assembly" && (candidate.id === data.assembly || candidate.name === data.assembly))?.id ?? ""} onChange={(event) => save({ ...data, assembly: event.target.value || undefined }, "Link analysis assembly")}><option value="">First assembly in project</option>{project.docs.filter((doc) => doc.kind === "assembly").map((doc) => <option key={doc.id} value={doc.id}>{doc.name}</option>)}</select></label>
        <DeviceInputs project={project} data={data} detected={result?.rotors} onChange={save} />
      </section>
      <section className="device-analysis-results">
        {error && <p className="device-analysis-error" role="alert">{error}</p>}
        {!result && <div className="device-analysis-empty"><h2>Can this assembly lift its own weight?</h2><p>{busy ? "Analyzing…" : "Results appear here. They are theoretical estimates, with missing data and assumptions shown explicitly."}</p></div>}
        {result && <>
          <div className="device-analysis-verdict" data-status={result.status}><strong>{deviceStatusLabel[result.status]}</strong><p>This is a feasibility estimate. Flight stability, structural strength and safety require separate validation.</p></div>
          <div className="device-analysis-stats">
            <Stat label={result.massComplete ? "Total mass" : "Known mass subtotal"} value={`${fixed(result.mass, 1)} g`} detail={result.addedMass ? `${fixed(result.assemblyMass, 0)} g assembly + ${fixed(result.addedMass, 0)} g payload` : undefined} />
            <Stat label="Maximum usable thrust" value={maximum ? gramsText(maximum.verticalThrust) : "—"} detail={maximum ? `${fixed(maximum.verticalThrust)} N at ${fixed(maximum.throttle * 100, 0)} %${maximum.throttle < 1 ? " (battery-limited)" : ""}` : undefined} />
            <Stat label="Thrust / weight" value={result.thrustToWeight === null ? "—" : `${fixed(result.thrustToWeight)}×`} />
            <Stat label="Hover throttle" value={result.hover ? `${fixed(result.hover.throttle * 100, 1)} %` : "—"} />
            <Stat label="Estimated hover runtime" value={result.hover ? `${fixed(result.hover.runtimeMinutes, 1)} min` : "—"} />
            <Stat label={result.hover ? "Hover current" : "Battery current"} value={point ? `${fixed(point.current)} A` : "—"} detail={point ? `${fixed(point.voltage)} V loaded` : undefined} />
          </div>
          <p>CG: [{result.centerOfMass.map((value) => fixed(value, 1)).join(", ")}] mm · Weight: {fixed(result.weight)} N</p>
          <details><summary>World inertia (g·mm²)</summary><pre>{result.inertia.map((row) => row.map((value) => fixed(value, 1)).join("  ")).join("\n")}</pre></details>
          {point && <><h2>{result.hover ? "At collective hover" : "At maximum usable throttle"}</h2><table><thead><tr><th>Rotor</th><th>Thrust g</th><th>Thrust N</th><th>Torque N·m</th><th>Current A</th><th>RPM</th></tr></thead><tbody>{point.rotors.map((rotor) => <tr key={rotor.component}><td>{rotor.component}{rotor.estimated ? " (est.)" : ""}</td><td>{grams(rotor.thrust).toFixed(0)}</td><td>{fixed(rotor.thrust)}</td><td>{fixed(rotor.torque, 4)}</td><td>{fixed(rotor.current)}</td><td>{fixed(rotor.rpm, 0)}</td></tr>)}</tbody></table><p>Residual moment about CG: [{point.moment.map((value) => fixed(value, 4)).join(", ")}] N·m</p></>}
          {result.missing.length > 0 && <><h2>Missing data</h2><ul>{result.missing.map((message) => <li key={message}>{message}</li>)}</ul></>}
          {result.warnings.length > 0 && <><h2>Checks</h2><ul className="device-analysis-checks">{result.warnings.map((message) => <li key={message} title={/estimated mass$/.test(message) ? result.estimatedMass.join(", ") : undefined}>{message}</li>)}</ul></>}
          <details><summary>Assumptions and data sources</summary><ul>{result.assumptions.map((message) => <li key={message}>{message}</li>)}</ul></details>
          {result.clearance.length > 0 && <details><summary>Propeller envelope checks</summary><table><thead><tr><th>Pair</th><th>Gap mm</th></tr></thead><tbody>{result.clearance.map((check, index) => <tr key={index}><td>{check.a} / {check.b}</td><td>{fixed(check.gap, 1)}</td></tr>)}</tbody></table></details>}
          <FlightPreview key={`${doc.id}/${project.version}`} project={project.id} doc={doc.id} data={{ ...data, rotors: result.rotors.map(({ component, direction }) => ({ component, direction })) }} analysis={result} />
        </>}
      </section>
    </div>
  </div>
}
function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) { return <div><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div> }
