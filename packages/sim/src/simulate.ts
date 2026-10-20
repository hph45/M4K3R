import type { Project } from "@m4k3r/core"
import { isGround } from "./build"
import { SimError, type SimInput, type View } from "./model"
import { createSession } from "./session"

export interface SimOptions {
  /** op: DC operating point. tran: from rest (capacitors discharged, motors stopped) for `duration`. */
  analysis: "op" | "tran"
  /** Seconds */
  duration?: number
  /** Seconds. Default: min(10 µs, duration / 1000) */
  step?: number
  /** Net names, V(NET), I(REF) or REF.field (a view value, e.g. M1.rpm). Default: every net and part current. */
  probes?: string[]
  /** Timed user events. For op they all apply before solving. */
  inputs?: SimInput[]
  /** Cap on waveform points. Default 500. */
  maxPoints?: number
}

export interface SimResult {
  analysis: "op" | "tran"
  /** Final time in s */
  t: number
  /** Final values */
  voltages: Record<string, number>
  currents: Record<string, number>
  views: Record<string, View>
  waveforms?: { time: number[]; series: Record<string, number[]> }
  warnings: string[]
  stats: { steps: number; ms: number }
}

const MAX_STEPS = 10_000_000

export function simulate(project: Project, options: SimOptions): SimResult {
  const started = performance.now()
  if (options.analysis !== "op" && options.analysis !== "tran") {
    throw new SimError(`Unknown analysis "${options.analysis}": use op or tran`)
  }
  const duration = options.duration ?? 0
  if (options.analysis === "tran" && (!(duration > 0) || !Number.isFinite(duration))) throw new SimError("A transient needs a duration in seconds")
  if (options.maxPoints !== undefined && (!Number.isSafeInteger(options.maxPoints) || options.maxPoints < 1)) {
    throw new SimError("maxPoints must be a positive integer")
  }
  const dt = options.step ?? (options.analysis === "tran" ? Math.min(10e-6, duration / 1000) : undefined)
  const session = createSession(project, { step: dt })
  const inputs = options.inputs ?? []

  let steps = 0
  let waveforms: SimResult["waveforms"]
  if (options.analysis === "op") {
    for (const e of inputs) session.input({ ...e, t: 0 })
    session.op()
  } else {
    for (const e of inputs) session.input(e)
    steps = Math.ceil(duration / session.step - 1e-9)
    if (steps > MAX_STEPS) throw new SimError(`${steps} steps is too many: use a larger step or a shorter duration`)
    const { nets, parts } = session.built
    const names = options.probes ?? [
      ...[...nets.keys()].filter((n) => !isGround(n)),
      ...[...parts].filter(([, m]) => m.current).map(([ref]) => `I(${ref})`),
    ]
    const probes = names.map((name) => session.probe(name))
    const every = Math.ceil(steps / Math.max(1, options.maxPoints ?? 500))
    const time: number[] = []
    const series = probes.map(() => [] as number[])
    for (let i = 1; i <= steps; i++) {
      session.advance(session.step)
      if (i % every === 0 || i === steps) {
        time.push(session.t)
        for (let j = 0; j < probes.length; j++) series[j]!.push(probes[j]!.read())
      }
    }
    waveforms = { time, series: Object.fromEntries(probes.map((p, j) => [p.name, series[j]!])) }
  }

  return {
    analysis: options.analysis,
    ...session.snapshot(),
    waveforms,
    warnings: session.warnings,
    stats: { steps, ms: Math.round(performance.now() - started) },
  }
}
