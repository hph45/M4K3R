import type { Project } from "@m4k3r/core"
import { SimulationData } from "@m4k3r/sim"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { SimulationFrame, SimulationRequest, SimulationResponse } from "./simulationRunner"

export const emptySimulationFrame = (): SimulationFrame => ({
  snapshot: { t: 0, voltages: {}, currents: {}, views: {} },
  running: false, realtime: 0, warnings: [], points: [],
})

export interface CircuitSimulationOptions {
  /** Distinguish saved simulation documents using the same circuit. */
  sessionKey?: string
  data?: SimulationData
}

/** A mounted circuit view owns one worker. Viewing, running and interacting never writes a document. */
export function useCircuitSimulation(project: Project, options: CircuitSimulationOptions = {}) {
  const saved = project.docs.find((doc) => doc.kind === "simulation")
  const fallback = useMemo(() => {
    const parsed = SimulationData.safeParse(saved?.data ?? {})
    return parsed.success ? parsed.data : SimulationData.parse({})
  }, [saved?.data])
  const data = options.data ?? fallback
  const [frame, setFrame] = useState<SimulationFrame>(emptySimulationFrame)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const [coupledFrame, setCoupledFrame] = useState<SimulationFrame | null>(null)
  const [coupledBusy, setCoupledBusy] = useState(false)
  const [coupledSerial, setCoupledSerial] = useState("")
  const worker = useRef<Worker | null>(null)
  const isRunning = useRef(false)
  const generation = useRef(0)
  const circuitKey = useMemo(() => JSON.stringify([project.id, project.parts, project.components, project.nets]), [project.id, project.parts, project.components, project.nets])
  const solverKey = JSON.stringify([data.step, data.inputs, data.vehicle])
  const probesKey = JSON.stringify(data.probes)
  const latest = useRef({ project, data })
  latest.current = { project, data }

  const send = useCallback((message: SimulationRequest) => worker.current?.postMessage(message), [])
  useEffect(() => {
    generation.current++
    setReady(false)
    setFrame(emptySimulationFrame())
    setError("")
    setCoupledFrame(null)
    setCoupledSerial("")
    isRunning.current = false
    const current = new Worker(new URL("./simulation.worker.ts", import.meta.url), { type: "module" })
    worker.current = current
    current.onmessage = ({ data: message }: MessageEvent<SimulationResponse>) => {
      if (message.type === "error") {
        setError(message.error)
        isRunning.current = false
        setFrame((previous) => ({ ...previous, running: false }))
        return
      }
      isRunning.current = message.frame.running
      setFrame(message.frame)
      setReady(true)
      setError("")
    }
    current.onerror = (event) => {
      setError(event.message || "The circuit simulation stopped. Reset to try again.")
      isRunning.current = false
      setFrame((previous) => ({ ...previous, running: false }))
    }
    const initial = latest.current
    current.postMessage({ type: "init", project: initial.project, data: initial.data, probes: initial.data.probes } satisfies SimulationRequest)
    return () => { generation.current++; current.terminate(); worker.current = null; isRunning.current = false }
  }, [options.sessionKey, circuitKey, solverKey])

  useEffect(() => { send({ type: "configure", speed: data.speed, probes: data.probes }) }, [send, data.speed, probesKey, circuitKey, solverKey])
  const play = useCallback(() => { setCoupledFrame(null); send({ type: "play" }) }, [send])
  const pause = useCallback(() => send({ type: "pause" }), [send])
  const toggle = useCallback(() => { setCoupledFrame(null); send({ type: isRunning.current ? "pause" : "play" }) }, [send])
  const step = useCallback(() => { setCoupledFrame(null); send({ type: "step" }) }, [send])
  const input = useCallback((ref: string, action: string) => send({ type: "input", event: { ref, action } }), [send])
  const reset = useCallback(() => {
    generation.current++
    setError("")
    setCoupledFrame(null)
    setCoupledSerial("")
    setReady(false)
    setFrame(emptySimulationFrame())
    isRunning.current = false
    const initial = latest.current
    send({ type: "init", project: initial.project, data: initial.data, probes: initial.data.probes })
  }, [send])

  const runCoupled = useCallback(async (firmware: string[], duration = 0.1) => {
    const requested = ++generation.current
    send({ type: "pause" }); setCoupledBusy(true); setError("")
    const initial = latest.current
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(initial.project.id)}/simulation/coupled`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ firmware, duration, step: Math.max(0.000001, Math.min(0.001, initial.data.step)), probes: initial.data.probes, inputs: initial.data.inputs, vehicle: initial.data.vehicle }) })
      const output = await response.json()
      if (!response.ok || !output.ok) throw new Error(output.error ?? output.diagnostics?.map((diagnostic: { message: string }) => diagnostic.message).join("\n") ?? "Coupled firmware run failed")
      if (requested !== generation.current) return
      const result = output.result
      setCoupledFrame({ snapshot: result, running: false, realtime: 0, warnings: result.warnings, vehicle: output.vehicle, points: result.waveforms.time.map((t: number, index: number) => ({ t, values: Object.fromEntries(Object.entries(result.waveforms.series as Record<string, number[]>).map(([name, values]) => [name, values[index]])) })) })
      setCoupledSerial(Object.entries(output.serial).flatMap(([mcu, ports]) => Object.entries(ports as Record<string, string>).map(([port, text]) => `${mcu} ${port}:\n${text}`)).join("\n") || `No serial output during this ${duration * 1000} ms run.`)
    } catch (error) { if (requested === generation.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { setCoupledBusy(false) }
  }, [send])

  return { frame: coupledFrame ?? frame, error, ready, play, pause, toggle, reset, step, input, runCoupled, coupled: !!coupledFrame, coupledBusy, coupledSerial }
}
