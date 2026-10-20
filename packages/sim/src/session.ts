import type { Project } from "@m4k3r/core"
import { build, isGround, type Built } from "./build"
import { SimError, type ModelFactory, type SimInput, type View } from "./model"

export interface SessionOptions {
  /** Fixed time step in seconds. Default 10 µs. */
  step?: number
  /** Runtime adapters keyed by component ref/id; not serializable to browser workers. */
  models?: Record<string, ModelFactory>
}

export interface Probe {
  /** Normalized: V(NET), I(REF) or REF.field */
  name: string
  read(): number
}

export interface Snapshot {
  t: number
  voltages: Record<string, number>
  currents: Record<string, number>
  views: Record<string, View>
}

export interface Session {
  readonly built: Built
  readonly step: number
  readonly warnings: string[]
  /** Simulated time in s */
  readonly t: number
  /** Advance by whole steps. Leftover time carries over to the next call. Returns the steps taken. */
  advance(seconds: number): number
  /** Applies now when t is omitted or due, else queues it for its time. */
  input(e: Omit<SimInput, "t"> & { t?: number }): void
  /** DC operating point */
  op(): void
  probe(name: string): Probe
  snapshot(): Snapshot
}

/** A circuit you can step, poke and read, e.g. from a UI loop or a test. Starts from rest at t = 0. */
export function createSession(project: Project, options: SessionOptions = {}): Session {
  const built = build(project, options.models)
  const { circuit, nets, parts } = built
  const dt = options.step ?? 10e-6
  if (!(dt > 0) || !Number.isFinite(dt)) throw new SimError("step must be finite and > 0")
  const queue: SimInput[] = []
  let debt = 0

  const apply = (until = circuit.t + dt * (1 + 1e-9)) => {
    while (queue.length && queue[0]!.t <= until) {
      const e = queue.shift()!
      parts.get(e.ref)!.input!(e)
    }
  }
  const entries = <T>(list: [string, T | undefined][]) =>
    Object.fromEntries(list.filter((e): e is [string, T] => e[1] !== undefined))

  return {
    built,
    step: dt,
    warnings: built.warnings,
    get t() {
      return circuit.t
    },
    advance(seconds) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new SimError("advance needs finite, nonnegative seconds")
      const total = debt + seconds
      const n = Math.floor(total / dt + 1e-9)
      if (!Number.isSafeInteger(n) || n > 10_000_000) throw new SimError("Too many steps in one advance; use smaller time chunks")
      debt = Math.max(0, total - n * dt)
      for (let i = 0; i < n; i++) {
        if (queue.length) apply()
        circuit.advance(dt)
      }
      return n
    },
    input(e) {
      const model = parts.get(e.ref)
      if (!model) throw new SimError(`Input for "${e.ref}", which isn't a simulated part`)
      if (!model.input) throw new SimError(`${e.ref} doesn't take inputs`)
      const event = { ...e, t: e.t ?? circuit.t }
      if (!Number.isFinite(event.t) || event.t < 0) throw new SimError("Input time must be finite and nonnegative")
      if (event.t <= circuit.t) return model.input(event)
      queue.splice(queue.findLastIndex((q) => q.t <= event.t) + 1, 0, event)
    },
    op() {
      apply(circuit.t)
      circuit.op()
    },
    probe: (name) => probe(built, name),
    snapshot: () => ({
      t: circuit.t,
      voltages: entries([...nets].filter(([n]) => !isGround(n)).map(([n, node]) => [n, circuit.v(node)])),
      currents: entries([...parts].map(([ref, m]) => [ref, m.current?.()])),
      views: entries([...parts].map(([ref, m]) => [ref, m.view?.()])),
    }),
  }
}

function probe({ circuit, nets, parts }: Built, name: string): Probe {
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
