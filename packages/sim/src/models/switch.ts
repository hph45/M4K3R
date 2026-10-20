import { SimError, type ModelFactory } from "../model"
import { Contact } from "./button"

/** SPDT: COM connects to A or B. Inputs: A, B, toggle. */
export const toggleSwitch: ModelFactory = (ctx) => {
  const a = ctx.pin("A")
  const com = ctx.pin("COM")
  const b = ctx.pin("B")
  const ron = ctx.num("ron", 0.05)
  const bounce = ctx.num("bounceMs", 5) / 1000
  let position = ctx.str("position", "A")!.toUpperCase() === "B" ? "B" : "A"
  const ca = new Contact(position === "A", bounce, `${ctx.ref}.A`)
  const cb = new Contact(position === "B", bounce, `${ctx.ref}.B`)
  let ga = 0
  let gb = 0
  return {
    stamp(s) {
      ga = ca.at(s.t) ? 1 / ron : 0
      gb = cb.at(s.t) ? 1 / ron : 0
      s.conductance(com, a, ga)
      s.conductance(com, b, gb)
    },
    current: () => (ctx.v(com) - ctx.v(a)) * ga + (ctx.v(com) - ctx.v(b)) * gb,
    view: () => ({ position }),
    input(e) {
      const next = e.action === "toggle" ? (position === "A" ? "B" : "A") : e.action.toUpperCase()
      if (next !== "A" && next !== "B") throw new SimError(`${ctx.ref}: actions are A, B, toggle`)
      position = next
      ca.set(next === "A", e.t)
      cb.set(next === "B", e.t)
    },
  }
}
