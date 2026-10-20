import type { ModelFactory } from "../model"

const LAMBDA = 0.01
const GMIN = 1e-12

/** Square-law (level 1) MOSFET. k is set so R_DS = rdsOn at V_GS = vgsOn. Symmetric, no body diode. */
export const nmos: ModelFactory = (ctx) => {
  const g = ctx.pin("G")
  const s0 = ctx.pin("S")
  const d0 = ctx.pin("D")
  const vth = ctx.num("vth", 2)
  const k = 1 / (ctx.num("rdsOn", 0.1) * Math.max(ctx.num("vgsOn", 4.5) - vth, 0.1))
  let id = 0
  return {
    nonlinear: true,
    stamp(st) {
      const reverse = ctx.v(d0) < ctx.v(s0)
      const [d, s] = reverse ? [s0, d0] : [d0, s0]
      const vds = ctx.v(d) - ctx.v(s)
      const vgs = ctx.v(g) - ctx.v(s)
      const vov = vgs - vth
      let ids = 0
      let gm = 0
      let gds = 0
      if (vov > 0 && vds < vov) {
        const f = vov * vds - (vds * vds) / 2
        ids = k * f * (1 + LAMBDA * vds)
        gm = k * vds * (1 + LAMBDA * vds)
        gds = k * (vov - vds) * (1 + LAMBDA * vds) + k * LAMBDA * f
      } else if (vov > 0) {
        ids = (k / 2) * vov * vov * (1 + LAMBDA * vds)
        gm = k * vov * (1 + LAMBDA * vds)
        gds = (k / 2) * vov * vov * LAMBDA
      }
      st.conductance(d, s, gds + GMIN)
      st.add(d, g, gm)
      st.add(d, s, -gm)
      st.add(s, g, -gm)
      st.add(s, s, gm)
      st.current(d, s, ids - gm * vgs - gds * vds)
      id = reverse ? -ids : ids
    },
    current: () => id,
  }
}
