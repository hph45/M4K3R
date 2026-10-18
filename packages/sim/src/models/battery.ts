import { parseQuantity } from "@m4k3r/core"
import { SimError, type ModelFactory } from "../model"

interface Chemistry {
  /** Nominal cell voltage */
  cell: number
  /** Internal resistance per cell, in Ω·Ah (scaled by 1/capacity) */
  r: number
  /** Open-circuit cell voltage at 0 %, 10 %, … 100 % state of charge */
  ocv: number[]
}

const CHEMISTRY: Record<string, Chemistry> = {
  "li-ion": { cell: 3.7, r: 0.08, ocv: [3.0, 3.45, 3.6, 3.68, 3.74, 3.79, 3.85, 3.92, 4.0, 4.08, 4.2] },
  lifepo4: { cell: 3.2, r: 0.05, ocv: [2.5, 3.1, 3.2, 3.24, 3.26, 3.28, 3.29, 3.3, 3.31, 3.33, 3.45] },
  alkaline: { cell: 1.5, r: 0.15, ocv: [0.9, 1.1, 1.18, 1.23, 1.27, 1.3, 1.34, 1.38, 1.43, 1.5, 1.6] },
  nimh: { cell: 1.2, r: 0.03, ocv: [1.0, 1.15, 1.19, 1.21, 1.22, 1.23, 1.24, 1.26, 1.28, 1.31, 1.4] },
  "lead-acid": { cell: 2, r: 0.02, ocv: [1.9, 1.92, 1.94, 1.96, 1.98, 2.0, 2.02, 2.04, 2.07, 2.1, 2.13] },
}
const ALIAS: Record<string, string> = { lipo: "li-ion", "li-po": "li-ion", liion: "li-ion", lifepo: "lifepo4" }

export function ocv(table: number[], soc: number) {
  const x = Math.min(1, Math.max(0, soc)) * (table.length - 1)
  const i = Math.min(Math.floor(x), table.length - 2)
  return table[i]! + (table[i + 1]! - table[i]!) * (x - i)
}

/** OCV(SoC) curve per chemistry, internal resistance and coulomb counting. Cells = voltage / nominal cell voltage. */
export const battery: ModelFactory = (ctx) => {
  const p = ctx.pin("+")
  const m = ctx.pin("-")
  const name = ctx.str("chemistry", "li-ion")!.toLowerCase()
  const chem = CHEMISTRY[ALIAS[name] ?? name]
  if (!chem) throw new SimError(`${ctx.ref}: unknown chemistry "${name}" (${Object.keys(CHEMISTRY).join(", ")})`)
  const cells = Math.max(1, Math.round(ctx.num("voltage", chem.cell) / chem.cell))
  const capacityText = ctx.str("capacity", "1Ah")!
  const amps = parseQuantity(capacityText.replace(/h$/i, ""))
  if (!amps || amps.unit !== "A" || amps.value <= 0) throw new SimError(`${ctx.ref}: capacity "${capacityText}" should look like 1000mAh`)
  const coulombs = amps.value * 3600
  const g = 1 / ctx.num("resistance", (cells * chem.r) / amps.value)
  let soc = ctx.num("soc", 1)
  const emf = () => cells * ocv(chem.ocv, soc)
  const vout = () => ctx.v(p) - ctx.v(m)
  const discharge = () => (emf() - vout()) * g
  return {
    stamp(s) {
      s.conductance(p, m, g)
      s.current(m, p, emf() * g)
    },
    step(_t, dt) {
      soc = Math.min(1, Math.max(0, soc - (discharge() * dt) / coulombs))
    },
    current: discharge,
    view: () => ({ soc, voltage: vout(), current: discharge() }),
  }
}
