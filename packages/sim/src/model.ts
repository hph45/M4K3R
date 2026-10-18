export class SimError extends Error {}

/** Unknown index in the MNA system. Ground is -1. */
export type Node = number

export interface Stamper {
  /** Time at the end of the step being solved. */
  t: number
  /** Step size. Infinity for the DC operating point, so C/dt → open and L/dt → short. */
  dt: number
  add(row: Node, col: Node, value: number): void
  rhs(row: Node, value: number): void
  conductance(a: Node, b: Node, g: number): void
  /** A current i flowing from a to b through the element. */
  current(a: Node, b: Node, i: number): void
  /** Ideal source V(a) − V(b) = v. Unknown k is its current, flowing from a to b through the source. */
  voltage(k: Node, a: Node, b: Node, v: number): void
  /** A nonlinear model limited its step this iteration, so Newton must iterate again. */
  unconverged(): void
}

export interface SimInput {
  /** Seconds */
  t: number
  /** Component ref, e.g. SW1 */
  ref: string
  /** e.g. press, release, toggle */
  action: string
  value?: number | string
}

export type View = Record<string, number | boolean | string>

export interface Model {
  /** Set when the stamp depends on the solution, so each step needs Newton iterations. */
  nonlinear?: boolean
  stamp(s: Stamper): void
  /** Called once per accepted time step, to advance internal state. */
  step?(t: number, dt: number): void
  /** Main current through the part in A: into pin 1, the anode, the drain… */
  current?(): number
  view?(): View
  input?(e: SimInput): void
}

export interface ModelContext {
  ref: string
  /** Component props as written, e.g. { value: "10k" } */
  props: Record<string, string>
  /** Node of a pin, by pin name or number */
  pin(name: string): Node
  /** Numeric value from component props (parsed, "10k"), then part.sim.params, then the fallback */
  num(key: string, fallback?: number): number
  str(key: string, fallback?: string): string | undefined
  /** New internal node or branch-current unknown */
  node(name: string): Node
  branch(name: string): Node
  /** Present solution (the Newton guess while stamping) */
  v(n: Node): number
}

/** A model is a factory: it reads its params and pins once (init) and returns the instance. */
export type ModelFactory = (ctx: ModelContext) => Model
