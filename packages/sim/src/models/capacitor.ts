import type { ModelFactory } from "../model"

/** Backward-Euler companion: conductance C/dt in parallel with a source holding the last voltage. */
export const capacitor: ModelFactory = (ctx) => {
  const a = ctx.pin("1")
  const b = ctx.pin("2")
  const c = ctx.num("value", 100e-9)
  let g = 0
  let v0 = 0
  let i = 0
  return {
    stamp(s) {
      g = c / s.dt
      s.conductance(a, b, g)
      s.current(a, b, -g * v0)
    },
    step() {
      const v = ctx.v(a) - ctx.v(b)
      i = g * (v - v0)
      v0 = v
    },
    current: () => i,
  }
}
