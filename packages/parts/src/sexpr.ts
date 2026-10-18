/** An s-expression: an atom (quoted or not) or a list. */
export type SExpr = string | SExpr[]
export type SList = SExpr[]

const ESCAPES: Record<string, string> = { n: "\n", t: "\t", r: "\r" }

/** Parse the first expression in `text`, e.g. a whole .kicad_sym or .kicad_mod file. */
export function parseSExpr(text: string): SExpr {
  const stack: SList[] = [[]]
  let i = 0
  while (i < text.length) {
    const c = text[i]!
    if (c === "(") {
      stack.push([])
      i++
    } else if (c === ")") {
      if (stack.length < 2) throw new Error(`Unexpected ")" at ${i}`)
      const list = stack.pop()!
      stack.at(-1)!.push(list)
      i++
      if (stack.length === 1) break
    } else if (c === '"') {
      let s = ""
      for (i++; text[i] !== '"'; i++) {
        if (i >= text.length) throw new Error("Unterminated string")
        if (text[i] === "\\") {
          const e = text[++i]!
          s += ESCAPES[e] ?? e
        } else s += text[i]
      }
      stack.at(-1)!.push(s)
      i++
    } else if (/\s/.test(c)) {
      i++
    } else {
      const start = i
      while (i < text.length && !/[\s()"]/.test(text[i]!)) i++
      stack.at(-1)!.push(text.slice(start, i))
    }
  }
  if (stack.length > 1) throw new Error("Unbalanced parentheses: missing )")
  const top = stack[0]![0]
  if (top === undefined) throw new Error("Empty s-expression")
  return top
}

export const isList = (x: SExpr | undefined): x is SList => Array.isArray(x)

/** Child lists of `list` whose head is `key`, e.g. all (pin …) in a symbol. */
export const children = (list: SList, key: string): SList[] =>
  list.filter((x): x is SList => isList(x) && x[0] === key)

export const child = (list: SList, key: string): SList | undefined => children(list, key)[0]

/** The atom at `index` in the child list `key`, e.g. value(pin, "length", 1). */
export const value = (list: SList, key: string, index = 1): string | undefined => {
  const v = child(list, key)?.[index]
  return typeof v === "string" ? v : undefined
}

export const num = (x: SExpr | undefined, fallback = 0): number => {
  const n = typeof x === "string" ? Number(x) : NaN
  return Number.isFinite(n) ? n : fallback
}

/** (at x y rot) style lists → numbers. */
export const nums = (list: SList | undefined): number[] => (list ?? []).slice(1).map((x) => num(x))

/** True for a bare `hide` flag (KiCad 6–7) or `(hide yes)` (KiCad 8+). */
export const hidden = (list: SList | undefined): boolean =>
  !!list && (list.includes("hide") || value(list, "hide") === "yes" || hidden(child(list, "effects")))
