import { SimError, type Model, type Node, type Stamper } from "./model"

const GMIN = 1e-12
const MAX_ITER = 100
const ABSTOL = 1e-6
const RELTOL = 1e-6

/**
 * Modified nodal analysis: unknowns are node voltages and branch currents.
 * Dense LU with partial pivoting; the factorization is reused while the matrix doesn't change,
 * which is every step of a linear circuit with a fixed dt.
 */
export class Circuit implements Stamper {
  names: string[] = []
  models: Model[] = []
  x = new Float64Array(0)
  t = 0
  dt = Infinity
  private isNode: boolean[] = []
  private gmin = GMIN
  private n = 0
  private A = new Float64Array(0)
  private b = new Float64Array(0)
  private lu = new Float64Array(0)
  private perm = new Int32Array(0)
  private next = new Float64Array(0)
  private last = new Float64Array(0)
  private factored = false
  private limited = false

  node(name: string): Node {
    return this.unknown(name, true)
  }

  branch(name: string): Node {
    return this.unknown(name, false)
  }

  private unknown(name: string, isNode: boolean): Node {
    this.names.push(name)
    this.isNode.push(isNode)
    return this.names.length - 1
  }

  v(i: Node): number {
    return i < 0 ? 0 : this.x[i]!
  }

  add(row: Node, col: Node, value: number) {
    if (row >= 0 && col >= 0) this.A[row * this.n + col]! += value
  }

  rhs(row: Node, value: number) {
    if (row >= 0) this.b[row]! += value
  }

  conductance(a: Node, b: Node, g: number) {
    this.add(a, a, g)
    this.add(b, b, g)
    this.add(a, b, -g)
    this.add(b, a, -g)
  }

  current(a: Node, b: Node, i: number) {
    this.rhs(a, -i)
    this.rhs(b, i)
  }

  voltage(k: Node, a: Node, b: Node, v: number) {
    this.add(a, k, 1)
    this.add(b, k, -1)
    this.add(k, a, 1)
    this.add(k, b, -1)
    this.rhs(k, v)
  }

  unconverged() {
    this.limited = true
  }

  /** DC operating point at t = 0. Falls back to gmin stepping if plain Newton fails. */
  op() {
    this.t = 0
    this.dt = Infinity
    try {
      this.solve()
    } catch (e) {
      if (!(e instanceof SimError)) throw e
      this.x.fill(0)
      for (let e = 2; e <= 12; e++) {
        this.gmin = 10 ** -e
        this.solve()
      }
    } finally {
      this.gmin = GMIN
    }
  }

  /** Advance one backward-Euler step. */
  advance(dt: number) {
    this.t += dt
    this.dt = dt
    this.solve()
    for (const m of this.models) m.step?.(this.t, dt)
  }

  private solve() {
    const n = this.names.length
    if (n !== this.n) this.allocate(n)
    const nonlinear = this.models.some((m) => m.nonlinear)
    for (let iter = 0; iter < MAX_ITER; iter++) {
      this.limited = false
      this.load()
      this.factor()
      this.substitute()
      let converged = !this.limited
      for (let i = 0; i < n; i++) {
        const a = this.x[i]!
        const b = this.next[i]!
        if (!Number.isFinite(b)) throw new SimError(`Solution blew up at ${this.names[i]} (t = ${this.t} s)`)
        if (Math.abs(b - a) > ABSTOL + RELTOL * Math.max(Math.abs(a), Math.abs(b))) converged = false
      }
      this.x.set(this.next)
      if (!nonlinear || converged) return
    }
    throw new SimError(`Did not converge at t = ${this.t} s`)
  }

  private allocate(n: number) {
    const x = new Float64Array(n)
    x.set(this.x.subarray(0, Math.min(n, this.x.length)))
    this.n = n
    this.x = x
    this.A = new Float64Array(n * n)
    this.b = new Float64Array(n)
    this.lu = new Float64Array(n * n)
    this.perm = new Int32Array(n)
    this.next = new Float64Array(n)
    this.last = new Float64Array(n * n)
    this.factored = false
  }

  private load() {
    const { A, n } = this
    A.fill(0)
    this.b.fill(0)
    for (let i = 0; i < n; i++) if (this.isNode[i]) A[i * n + i]! += this.gmin
    for (const m of this.models) m.stamp(this)
  }

  /** Factor only when the matrix differs from the last factored one. */
  private factor() {
    const { A, last, lu, perm, n } = this
    if (this.factored) {
      let same = true
      for (let i = 0; i < A.length; i++) {
        if (A[i] !== last[i]) {
          same = false
          break
        }
      }
      if (same) return
    }
    last.set(A)
    lu.set(A)
    for (let i = 0; i < n; i++) perm[i] = i
    for (let k = 0; k < n; k++) {
      let p = k
      let max = Math.abs(lu[k * n + k]!)
      for (let i = k + 1; i < n; i++) {
        const v = Math.abs(lu[i * n + k]!)
        if (v > max) {
          max = v
          p = i
        }
      }
      if (max < 1e-300) {
        this.factored = false
        throw new SimError(`Singular circuit at ${this.names[k]}: check for loops of sources or inductors`)
      }
      if (p !== k) {
        for (let j = 0; j < n; j++) {
          const tmp = lu[k * n + j]!
          lu[k * n + j] = lu[p * n + j]!
          lu[p * n + j] = tmp
        }
        const tmp = perm[k]!
        perm[k] = perm[p]!
        perm[p] = tmp
      }
      const pivot = lu[k * n + k]!
      for (let i = k + 1; i < n; i++) {
        const f = (lu[i * n + k]! /= pivot)
        if (f !== 0) for (let j = k + 1; j < n; j++) lu[i * n + j]! -= f * lu[k * n + j]!
      }
    }
    this.factored = true
  }

  private substitute() {
    const { lu, perm, b, next: x, n } = this
    for (let i = 0; i < n; i++) {
      let sum = b[perm[i]!]!
      for (let j = 0; j < i; j++) sum -= lu[i * n + j]! * x[j]!
      x[i] = sum
    }
    for (let i = n - 1; i >= 0; i--) {
      let sum = x[i]!
      for (let j = i + 1; j < n; j++) sum -= lu[i * n + j]! * x[j]!
      x[i] = sum / lu[i * n + i]!
    }
  }
}
