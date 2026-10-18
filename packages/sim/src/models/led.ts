import type { ModelFactory } from "../model"
import { junction, saturation } from "./diode"

/** Typical forward voltage at 10 mA */
const VF: Record<string, number> = {
  red: 1.9, orange: 2, yellow: 2, green: 2.2, blue: 2.9, white: 2.9, pink: 2.9, purple: 2.9, uv: 3.2, ir: 1.3,
}
const FULL = 0.02 // A at brightness 1

export const led: ModelFactory = (ctx) => {
  const color = ctx.str("color", "red")!.toLowerCase()
  // An explicit vf prop wins, then the color, then the part's default.
  const vf = ctx.props.vf === undefined ? (VF[color] ?? ctx.num("vf", 2)) : ctx.num("vf")
  const n = ctx.num("n", 2)
  const rs = ctx.num("rs", 10)
  const d = junction(ctx, saturation(vf, n, rs), n, rs)
  return {
    ...d,
    view: () => {
      const current = d.current()
      return { brightness: Math.min(1, Math.max(0, current / FULL)), current }
    },
  }
}
