// Engineering quantities: "2k2", "100n", "4.7uF", "3.3 V", "3/8 in", "25mm", "1meg".
// A bare "m" is milli (the EE/SPICE convention), so meters are written "mm" or "1000 mm".

export interface Quantity {
  value: number // SI
  unit: string // canonical unit, "" when none
}

const PREFIX: Record<string, number> = {
  f: 1e-15, p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, m: 1e-3, k: 1e3, K: 1e3, M: 1e6, meg: 1e6, G: 1e9,
}

const UNIT: Record<string, [unit: string, scale: number]> = {
  "": ["", 1],
  V: ["V", 1], A: ["A", 1], W: ["W", 1], F: ["F", 1], H: ["H", 1], Hz: ["Hz", 1], s: ["s", 1], g: ["kg", 1e-3],
  Ω: ["Ω", 1], ohm: ["Ω", 1], ohms: ["Ω", 1], R: ["Ω", 1],
  in: ["m", 0.0254], '"': ["m", 0.0254],
  deg: ["rad", Math.PI / 180], "°": ["rad", Math.PI / 180], rad: ["rad", 1],
  "%": ["", 0.01],
}

const NUMBER = /^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)(?:\/(\d+\.?\d*))?\s*(.*)$/i
const INFIX = /^(\d+)(meg|[pnuµmkKMGR])(\d+)\s*(.*)$/ // 2k2, 4R7, 1M5

function unitScale(suffix: string): [unit: string, scale: number] | undefined {
  if (suffix === "m") return ["", 1e-3]
  if (suffix === "mm") return ["m", 1e-3]
  if (UNIT[suffix]) return UNIT[suffix]
  for (const prefix of ["meg", suffix[0]!]) {
    const u = UNIT[suffix.slice(prefix.length)]
    if (suffix.startsWith(prefix) && PREFIX[prefix] && u) return [u[0], u[1] * PREFIX[prefix]]
  }
  return undefined
}

export function parseQuantity(text: string): Quantity | undefined {
  const s = text.trim()
  const infix = INFIX.exec(s)
  if (infix) {
    const [, whole, mark, frac, rest] = infix
    const u = unitScale(rest!)
    if (!u) return undefined
    const scale = mark === "R" ? 1 : PREFIX[mark!]!
    return { value: Number(`${whole}.${frac}`) * scale * u[1], unit: mark === "R" ? "Ω" : u[0] }
  }
  const m = NUMBER.exec(s)
  if (!m) return undefined
  const [, num, den, suffix] = m
  const u = unitScale(suffix!.trim())
  if (!u) return undefined
  const value = Number(num) / (den ? Number(den) : 1)
  return Number.isFinite(value) ? { value: value * u[1], unit: u[0] } : undefined
}

const ENG = [
  [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"],
] as const

/** 2200 → "2.2k", 1e-7 + "F" → "100nF" */
export function formatQuantity(value: number, unit = ""): string {
  if (value === 0) return `0${unit}`
  const [scale, prefix] = ENG.find(([scale]) => Math.abs(value) >= scale) ?? ENG[ENG.length - 1]!
  return `${Number((value / scale).toPrecision(3))}${prefix}${unit}`
}
