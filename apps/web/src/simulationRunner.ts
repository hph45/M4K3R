import type { Project } from "@m4k3r/core"
import { createSession, SkidSteer, advanceVehicle, type Probe, type Session, type SimInput, type SimulationData, type Snapshot, type VehicleState } from "@m4k3r/sim"

export interface ScopePoint { t: number; values: Record<string, number> }
export interface SimulationFrame {
  snapshot: Snapshot
  running: boolean
  realtime: number
  warnings: string[]
  points: ScopePoint[]
  vehicle?: VehicleState
}
export type SimulationRequest =
  | { type: "init"; project: Project; data: SimulationData; probes: string[] }
  | { type: "play" | "pause" | "reset" | "step" }
  | { type: "input"; event: Omit<SimInput, "t"> }
  | { type: "configure"; speed: number; probes: string[] }
export type SimulationResponse = { type: "frame"; frame: SimulationFrame } | { type: "error"; error: string }

/** Worker-owned state. The rendering thread only receives bounded snapshots and scope samples. */
export class SimulationRunner {
  session!: Session
  running = false
  speed: number
  points: ScopePoint[] = []
  private probes: Probe[] = []
  private probeWarnings: string[] = []
  private probeNames: string[]
  private nextSample = 0
  private vehicle?: SkidSteer

  constructor(private project: Project, private data: SimulationData, probes: string[]) {
    this.speed = data.speed
    this.probeNames = probes
    this.reset()
  }

  reset() {
    this.running = false
    this.session = createSession(this.project, { step: this.data.step })
    this.vehicle = this.data.vehicle ? new SkidSteer(this.data.vehicle) : undefined
    for (const event of this.data.inputs) this.session.input(event)
    this.points = []
    this.nextSample = 0
    this.configure(this.speed, this.probeNames)
  }

  configure(speed: number, names: string[]) {
    const changed = JSON.stringify(names) !== JSON.stringify(this.probeNames)
    this.speed = speed
    this.probeNames = names
    this.probeWarnings = []
    this.probes = names.flatMap((name) => {
      try { const probe = this.session.probe(name); return [{ name, read: probe.read }] }
      catch (error) { this.probeWarnings.push(String(error instanceof Error ? error.message : error)); return [] }
    })
    // Different probe sets cannot share historical samples.
    if (changed || !this.points.length) {
      this.points = []
      this.sample()
    }
  }

  input(event: Omit<SimInput, "t">) {
    this.session.input(event)
  }

  /** Advance toward a horizon, yielding within a small wall budget so controls stay responsive. */
  advanceTo(target: number, budgetMs = 12): number {
    const started = performance.now()
    let steps = 0
    while (this.session.t + this.session.step <= target + this.session.step * 1e-8) {
      const untilSample = Math.max(1, Math.ceil((this.nextSample - this.session.t) / this.session.step - 1e-9))
      const remaining = Math.floor((target - this.session.t) / this.session.step + 1e-8)
      const chunk = Math.max(1, Math.min(untilSample, remaining, 100))
      steps += this.vehicle ? advanceVehicle(this.session, this.vehicle, chunk * this.session.step) : this.session.advance(chunk * this.session.step)
      if (this.session.t >= this.nextSample - this.session.step * 1e-8) this.sample()
      if (performance.now() - started >= budgetMs) break
    }
    return steps
  }

  private sample() {
    const t = this.session.t
    this.points.push({ t, values: Object.fromEntries(this.probes.map((probe) => [probe.name, probe.read()])) })
    if (this.points.length > 600) this.points.splice(0, this.points.length - 600)
    this.nextSample = t + Math.max(this.session.step, 0.001)
  }

  frame(realtime = 0): SimulationFrame {
    return { snapshot: this.session.snapshot(), running: this.running, realtime,
      warnings: [...this.session.warnings, ...this.probeWarnings, ...(this.vehicle ? ["Planar vehicle model: motor shaft speed feeds back through back-EMF; net motor torque, traction, rolling resistance and yaw damping drive the body. No gear losses, terrain, collision or lateral slip model; small motor rotor inertia is omitted from chassis inertia."] : [])], points: this.points, vehicle: this.vehicle?.snapshot() }
  }
}
