import type { Project } from "@m4k3r/core"
import { build, isGround, type Built } from "./build"
import { SimError, type SimInput, type View } from "./model"

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
  const built = build(project)
  const { circuit, nets, parts, warnings } = built
  const inputs = [...(options.inputs ?? [])].sort((a, b) => a.t - b.t)
  for (const e of inputs) {
    const model = parts.get(e.ref)
    if (!model) throw new SimError(`Input for "${e.ref}", which isn't a simulated part`)
    if (!model.input) throw new SimError(`${e.ref} doesn't take inputs`)
  }

  let steps = 0
  let waveforms: SimResult["waveforms"]
  if (options.analysis === "op") {
    for (const e of inputs) parts.get(e.ref)!.input!({ ...e, t: 0 })
    circuit.op()
  } else if (options.analysis === "tran") {
    const duration = options.duration ?? 0
    if (!(duration > 0)) throw new SimError("A transient needs a duration in seconds")
    const dt = options.step ?? Math.min(10e-6, duration / 1000)
    if (!(dt > 0)) throw new SimError("step must be > 0")
    steps = Math.ceil(duration / dt - 1e-9)
    if (steps > MAX_STEPS) throw new SimError(`${steps} steps is too many: use a larger step or a shorter duration`)

    const names = options.probes ?? [
      ...[...nets.keys()].filter((n) => !isGround(n)),
      ...[...parts].filter(([, m]) => m.current).map(([ref]) => `I(${ref})`),
    ]
    const probes = names.map((name) => probe(built, name))
    const every = Math.ceil(steps / Math.max(1, options.maxPoints ?? 500))
    const time: number[] = []
    const series = probes.map(() => [] as number[])
    let next = 0
    for (let i = 1; i <= steps; i++) {
      while (next < inputs.length && inputs[next]!.t <= circuit.t + dt * (1 + 1e-9)) {
        const e = inputs[next++]!
        parts.get(e.ref)!.input!(e)
      }
      circuit.advance(dt)
      if (i % every === 0 || i === steps) {
        time.push(circuit.t)
        for (let j = 0; j < probes.length; j++) series[j]!.push(probes[j]!.read())
      }
    }
    waveforms = { time, series: Object.fromEntries(probes.map((p, j) => [p.name, series[j]!])) }
  } else {
    throw new SimError(`Unknown analysis "${options.analysis}": use op or tran`)
  }

  const entries = <T>(list: [string, T | undefined][]) =>
    Object.fromEntries(list.filter((e): e is [string, T] => e[1] !== undefined))
  return {
    analysis: options.analysis,
    t: circuit.t,
    voltages: entries([...nets].filter(([n]) => !isGround(n)).map(([n, node]) => [n, circuit.v(node)])),
    currents: entries([...parts].map(([ref, m]) => [ref, m.current?.()])),
    views: entries([...parts].map(([ref, m]) => [ref, m.view?.()])),
    waveforms,
    warnings,
    stats: { steps, ms: Math.round(performance.now() - started) },
  }
}

function probe({ circuit, nets, parts }: Built, name: string): { name: string; read(): number } {
  const [, kind, inner] = /^([VI])\((.+)\)$/i.exec(name) ?? []
  const net = kind ? (kind.toUpperCase() === "V" ? inner! : undefined) : name
  const ref = kind ? (kind.toUpperCase() === "I" ? inner! : undefined) : name
  const node = net === undefined ? undefined : nets.get(net)
  if (node !== undefined) return { name: `V(${net})`, read: () => circuit.v(node) }
  const model = ref === undefined ? undefined : parts.get(ref)
  if (model?.current) return { name: `I(${ref})`, read: () => model.current!() }
  const dot = name.lastIndexOf(".")
  const view = dot > 0 ? parts.get(name.slice(0, dot))?.view : undefined
  const field = name.slice(dot + 1)
  if (view && field in view()) return { name, read: () => Number(view()[field]) }
  throw new SimError(`Unknown probe "${name}": use a net name, V(NET), I(REF) or REF.field (e.g. M1.rpm)`)
}
