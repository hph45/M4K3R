import type { Model, ModelContext, ModelFactory } from "../model"

export const VT = 0.025852 // thermal voltage at 300 K
const GMIN = 1e-12

/** Saturation current that gives forward voltage vf at current i. */
export const saturation = (vf: number, n: number, rs: number, i = 0.01) => i / Math.expm1((vf - i * rs) / (n * VT))

/** SPICE's pnjlim: limit the junction voltage step so exp() can't run away between Newton iterations. */
function limit(vnew: number, vold: number, nvt: number, vcrit: number) {
  if (vnew <= vcrit || Math.abs(vnew - vold) <= 2 * nvt) return vnew
  if (vold > 0) {
    const arg = 1 + (vnew - vold) / nvt
    return arg > 0 ? vold + nvt * Math.log(arg) : vcrit
  }
  return nvt * Math.log(vnew / nvt)
}

/** Shockley junction from A to K, with series resistance rs. */
export function junction(ctx: ModelContext, is: number, n: number, rs: number): Model & { current(): number } {
  const a = ctx.pin("A")
  const k = ctx.pin("K")
  const j = rs > 0 ? ctx.node(`${ctx.ref}.junction`) : a
  const nvt = n * VT
  const vcrit = nvt * Math.log(nvt / (Math.SQRT2 * is))
  let vd = 0
  return {
    nonlinear: true,
    stamp(s) {
      if (rs > 0) s.conductance(a, j, 1 / rs)
      const raw = ctx.v(j) - ctx.v(k)
      vd = limit(raw, vd, nvt, vcrit)
      if (vd !== raw) s.unconverged()
      const e = Math.exp(vd / nvt)
      const g = (is / nvt) * e + GMIN
      s.conductance(j, k, g)
      s.current(j, k, is * (e - 1) - g * vd)
    },
    current: () => (rs > 0 ? (ctx.v(a) - ctx.v(j)) / rs : is * Math.expm1((ctx.v(a) - ctx.v(k)) / nvt)),
  }
}

/** Defaults are a 1N4148. Set vf (at 10 mA) instead of is for a quick custom diode, e.g. a Schottky. */
export const diode: ModelFactory = (ctx) => {
  const n = ctx.num("n", 1.75)
  const rs = ctx.num("rs", 0.57)
  const vf = ctx.num("vf", 0)
  return junction(ctx, vf > 0 ? saturation(vf, n, rs) : ctx.num("is", 2.52e-9), n, rs)
}
