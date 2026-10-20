import { useEffect, useState } from "react"
import { ScenarioCheck, type ScenarioResult, type SimulationData } from "@m4k3r/sim"
import { run } from "../store"

export function ScenarioPanel({ project, doc, data }: { project: string; doc: string; data: SimulationData }) {
  const [text, setText] = useState(JSON.stringify(data.checks, null, 2))
  const [result, setResult] = useState<ScenarioResult | null>(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  useEffect(() => { setText(JSON.stringify(data.checks, null, 2)); setResult(null) }, [doc, JSON.stringify(data.checks)])
  async function execute() {
    setBusy(true); setError("")
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(project)}/simulation/${encodeURIComponent(doc)}/scenario`, { method: "POST" })
      const value = await response.json()
      if (!response.ok) throw new Error(value.error ?? "Scenario failed")
      setResult(value)
    } catch (error) { setError(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(false) }
  }
  return <details className="sim-saved-settings sim-scenario"><summary>Scenario assertions · {data.checks.length} checks</summary><p>Assertions sample numeric probes after saved timed inputs. Times are seconds; each check accepts min, max or equals with tolerance. Example: {"{\"t\":0.1,\"probe\":\"M1.rpm\",\"min\":100}"}</p>
    <textarea aria-label="Scenario assertions JSON" value={text} onChange={(event) => setText(event.target.value)} />
    <div><button onClick={async () => { try { const checks = ScenarioCheck.array().max(128).parse(JSON.parse(text)); await run([{ type: "sim.update", args: { doc, checks } }], "Save scenario assertions"); setError("") } catch (error) { setError(error instanceof Error ? error.message : String(error)) } }}>Save assertions</button><button disabled={busy} onClick={execute}>{busy ? "Checking…" : "Run saved scenario"}</button></div>
    {error && <p role="alert">{error}</p>}
    {result && <><strong data-scenario-passed={result.passed}>{result.passed ? "Scenario passed" : "Scenario failed"}</strong>{result.checks.map((check, index) => <p key={index}>{check.passed ? "✓" : "✗"} {check.probe} at {check.actualTime.toPrecision(3)}s: {check.value.toPrecision(4)}; expected {check.expected}</p>)}{result.warnings.map((warning) => <p key={warning}>{warning}</p>)}</>}
  </details>
}
