import { describe, expect, it } from "vitest"
import { checkExpr, evaluate, variableLookup } from "./index"

describe("expressions", () => {
  it("evaluates arithmetic with units in mm and degrees", () => {
    expect(evaluate("2 + 3 * 4")).toBe(14)
    expect(evaluate("(2 + 3) * -4")).toBe(-20)
    expect(evaluate("2 ^ 3")).toBe(8)
    expect(evaluate("3 mm")).toBe(3)
    expect(evaluate("25mm")).toBe(25)
    expect(evaluate("3/8 in")).toBeCloseTo(9.525)
    expect(evaluate("10 mm / 2")).toBe(5)
    expect(evaluate("1 rad")).toBeCloseTo(57.2958, 3)
    expect(evaluate("max(2, 5, 3) + sqrt(16) + cos(60)")).toBeCloseTo(9.5)
    expect(evaluate(7)).toBe(7)
  })

  it("resolves variables that reference each other", () => {
    const lookup = variableLookup([
      { name: "pcb_w", value: "65 mm" },
      { name: "wall", value: "2" },
      { name: "outer", value: "pcb_w + 2*wall" },
    ])
    expect(evaluate("outer + 1", lookup)).toBe(70)
  })

  it("reports clear errors", () => {
    expect(() => evaluate("a + 1")).toThrow('Unknown variable "a" in "a + 1"')
    expect(() => evaluate("2 wall")).toThrow('Unexpected "wall"')
    expect(() => evaluate("(1 + 2")).toThrow('Missing ")"')
    expect(() => evaluate("1 / 0")).toThrow("not a finite number")
    expect(() => evaluate("x", variableLookup([{ name: "x", value: "y" }, { name: "y", value: "x" }]))).toThrow("depends on itself")
    expect(checkExpr("pcb_w + 2*wall")).toBeUndefined()
    expect(checkExpr("2 +")).toMatch(/Unexpected end/)
  })
})
