import type { ModelFactory } from "../model"

export const resistor: ModelFactory = (ctx) => {
  const a = ctx.pin("1")
  const b = ctx.pin("2")
  const g = 1 / ctx.num("value", 1e3)
  return {
    stamp: (s) => s.conductance(a, b, g),
    current: () => (ctx.v(a) - ctx.v(b)) * g,
  }
}
