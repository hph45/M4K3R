import { describe, expect, it } from "vitest"
import { createSession } from "./session"
import { circuit } from "./testing"

const demo = () =>
  circuit(
    "BT1 battery VBAT GND voltage=3.7V",
    "SW1 push-button VBAT SW bounceMs=0",
    "R1 resistor SW LED value=100",
    "D1 led A:LED K:GND color=red",
    "M1 dc-motor SW GND voltage=3V",
  )

describe("session", () => {
  it("steps in fixed increments and carries leftover time", () => {
    const s = createSession(demo(), { step: 1e-4 })
    expect(s.advance(2.5e-4)).toBe(2)
    expect(s.advance(0.5e-4)).toBe(1)
    expect(s.t).toBeCloseTo(3e-4, 12)
  })

  it("applies inputs now or at their time, and exposes views, voltages and currents", () => {
    const s = createSession(demo(), { step: 1e-4 })
    s.advance(0.01)
    expect(s.snapshot().views.D1!.brightness).toBe(0)
    s.input({ ref: "SW1", action: "press" })
    expect(s.snapshot().views.SW1!.pressed).toBe(true)
    s.advance(0.2)
    const on = s.snapshot()
    expect(on.views.D1!.brightness).toBeGreaterThan(0.3)
    expect(on.views.M1!.rpm).toBeGreaterThan(100)
    expect(on.voltages.SW).toBeGreaterThan(3)
    expect(on.currents.BT1).toBeGreaterThan(0.01)
    expect(Object.keys(on.voltages)).not.toContain("GND")

    s.input({ t: 0.3, ref: "SW1", action: "release" })
    s.advance(0.05)
    expect(s.snapshot().views.SW1!.pressed).toBe(true)
    s.advance(0.1)
    expect(s.snapshot().views.SW1!.pressed).toBe(false)
    expect(s.snapshot().views.M1!.rpm).toBeLessThan(Number(on.views.M1!.rpm)) // coasting down
  })

  it("reads probes by net, current or view field", () => {
    const s = createSession(demo())
    expect(["VBAT", "V(LED)", "I(M1)", "M1.rpm"].map((n) => s.probe(n).name)).toEqual(["V(VBAT)", "V(LED)", "I(M1)", "M1.rpm"])
    expect(s.probe("VBAT").read()).toBe(0)
    s.advance(1e-3)
    expect(s.probe("VBAT").read()).toBeGreaterThan(4)
    expect(() => s.probe("M1.unknownField")).toThrow(/Unknown probe/)
    expect(() => s.input({ ref: "R1", action: "press" })).toThrow(/R1 doesn't take inputs/)
  })

  it("keeps future inputs queued until their solver step and rejects invalid time", () => {
    const s = createSession(demo(), { step: 1e-4 })
    s.input({ t: 0.0001, ref: "SW1", action: "press" })
    expect(s.snapshot().views.SW1!.pressed).toBe(false)
    s.advance(0.0001)
    expect(s.snapshot().views.SW1!.pressed).toBe(true)
    expect(() => s.advance(-1)).toThrow(/nonnegative/)
    expect(() => s.advance(Infinity)).toThrow(/finite/)
    expect(() => createSession(demo(), { step: Infinity })).toThrow(/finite/)
    expect(() => s.input({ t: NaN, ref: "SW1", action: "press" })).toThrow(/finite/)
  })
})
