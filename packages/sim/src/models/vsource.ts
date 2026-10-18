import type { ModelFactory } from "../model"

/** DC voltage source between + and −, with optional output resistance. Also the basis for MCU output pins. */
export const vsource: ModelFactory = (ctx) => {
  const p = ctx.pin("+")
  const m = ctx.pin("-")
  const v = ctx.num("voltage", 5)
  const r = ctx.num("resistance", 0)
  const k = ctx.branch(`I(${ctx.ref})`)
  return {
    stamp(s) {
      s.voltage(k, p, m, v)
      s.add(k, k, -r)
    },
    current: () => -ctx.v(k),
  }
}
