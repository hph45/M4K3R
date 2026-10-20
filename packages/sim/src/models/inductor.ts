import type { ModelFactory } from "../model"

/** Backward Euler: V = L/dt · (i − i₀), with the current as an unknown. A short at DC. */
export const inductor: ModelFactory = (ctx) => {
  const a = ctx.pin("1")
  const b = ctx.pin("2")
  const l = ctx.num("value", 10e-6)
  const k = ctx.branch(`I(${ctx.ref})`)
  let i0 = 0
  return {
    stamp(s) {
      const r = l / s.dt
      s.voltage(k, a, b, -r * i0)
      s.add(k, k, -r)
    },
    step() {
      i0 = ctx.v(k)
    },
    current: () => ctx.v(k),
  }
}
