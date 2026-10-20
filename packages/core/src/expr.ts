// Safe arithmetic over project variables: "pcb_w + 2*wall", "3 mm", "3/8 in", "max(a, b) / 2".
// Lengths evaluate to mm and angles to degrees (trig functions take degrees); other units to SI.
import { CommandError } from "./lookup"
import type { Variable } from "./schema"
import { parseQuantity } from "./units"

export type Expr = number | string

const FUNCS: Record<string, (...a: number[]) => number> = {
  abs: Math.abs, sqrt: Math.sqrt, min: Math.min, max: Math.max, round: Math.round, floor: Math.floor, ceil: Math.ceil,
  sin: (d) => Math.sin((d * Math.PI) / 180), cos: (d) => Math.cos((d * Math.PI) / 180), tan: (d) => Math.tan((d * Math.PI) / 180),
}
const CONSTS: Record<string, number> = { pi: Math.PI }

const TOKEN = /\s*(?:(\d+\.?\d*(?:e[-+]?\d+)?|\.\d+(?:e[-+]?\d+)?)([A-Za-zµΩ°"%][\wµΩ]*)?|([A-Za-z_µΩ°"%][\w]*)|(\S))/y

/** Literal with an optional unit, in CAD units (mm, degrees). */
function quantity(text: string): number | undefined {
  const q = parseQuantity(text)
  if (!q) return undefined
  return q.unit === "m" ? q.value * 1000 : q.unit === "rad" ? (q.value * 180) / Math.PI : q.value
}

/** Evaluate an expression. lookup resolves variable names (undefined = unknown). */
export function evaluate(expr: Expr, lookup: (name: string) => number | undefined = () => undefined): number {
  if (typeof expr === "number") return expr
  const tokens: string[] = []
  TOKEN.lastIndex = 0
  for (let m; TOKEN.lastIndex < expr.length && (m = TOKEN.exec(expr)); ) {
    if (m[1] !== undefined) tokens.push(m[2] ? `#${m[1]}${m[2]}` : `#${m[1]}`)
    else if (m[3] !== undefined || m[4] !== undefined) tokens.push(m[3] ?? m[4]!)
  }
  let i = 0
  const fail = (msg: string): never => {
    throw new CommandError(`${msg} in "${expr}"`)
  }
  const peek = () => tokens[i]
  const eat = (t: string) => (tokens[i] === t ? (i++, true) : false)
  const isName = (t?: string) => !!t && /^[A-Za-z_µΩ°"%]/.test(t)

  const sum = (): number => {
    let v = product()
    for (;;) {
      if (eat("+")) v += product()
      else if (eat("-")) v -= product()
      else return v
    }
  }
  // A unit after a factor scales it like a multiplication: "3/8 in" = (3/8) * 25.4.
  const product = (): number => {
    let v = unary()
    for (;;) {
      if (eat("*")) v *= unary()
      else if (eat("/")) v /= unary()
      else if (isName(peek()) && tokens[i + 1] !== "(") {
        const unit = quantity(`1 ${tokens[i]}`)
        if (unit === undefined) fail(`Unexpected "${tokens[i]}"`)
        i++
        v *= unit!
      } else return v
    }
  }
  const unary = (): number => (eat("-") ? -unary() : eat("+") ? unary() : power())
  const power = (): number => {
    const base = atom()
    return eat("^") ? base ** unary() : base
  }
  const atom = (): number => {
    const t = tokens[i++]
    if (t === undefined) return fail("Unexpected end")
    if (t === "(") {
      const v = sum()
      if (!eat(")")) fail(`Missing ")"`)
      return v
    }
    if (t.startsWith("#")) return quantity(t.slice(1)) ?? fail(`Bad number "${t.slice(1)}"`)
    if (!isName(t)) return fail(`Unexpected "${t}"`)
    if (eat("(")) {
      const fn = FUNCS[t] ?? fail(`Unknown function "${t}"`)
      const args: number[] = []
      if (!eat(")")) {
        do args.push(sum())
        while (eat(","))
        if (!eat(")")) fail(`Missing ")"`)
      }
      return fn(...args)
    }
    const v = lookup(t) ?? CONSTS[t]
    return v ?? fail(`Unknown variable "${t}"`)
  }

  const v = sum()
  if (i < tokens.length) fail(`Unexpected "${tokens[i]}"`)
  if (!Number.isFinite(v)) fail("Result is not a finite number")
  return v
}

/** Syntax check without variables: returns an error message, or undefined when the expression parses. */
export function checkExpr(expr: Expr): string | undefined {
  try {
    evaluate(expr, () => 1)
  } catch (e) {
    return (e as Error).message
  }
}

/** Lookup for evaluate() over project variables, which may reference each other. Evaluated lazily, once. */
export function variableLookup(variables: Variable[]): (name: string) => number | undefined {
  const byName = new Map(variables.map((v) => [v.name, v.value]))
  const values = new Map<string, number>()
  const active = new Set<string>()
  const get = (name: string): number | undefined => {
    if (values.has(name)) return values.get(name)
    const text = byName.get(name)
    if (text === undefined) return undefined
    if (active.has(name)) throw new CommandError(`Variable "${name}" depends on itself`)
    active.add(name)
    try {
      const value = evaluate(text, get)
      values.set(name, value)
      return value
    } catch (e) {
      if (e instanceof CommandError && !e.message.startsWith("Variable")) e.message = `Variable "${name}": ${e.message}`
      throw e
    } finally {
      active.delete(name)
    }
  }
  return get
}
