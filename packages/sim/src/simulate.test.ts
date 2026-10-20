import { applyCommands, emptyProject, type Command, type Project } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { build, refList } from "./build"
import { simulate } from "./simulate"
import { circuit, libraryPart } from "./testing"

const project = (...commands: Command[]): Project => {
  let i = 0
  const ctx = { resolvePart: libraryPart, newId: (prefix: string) => `${prefix}_${++i}` }
  return applyCommands(emptyProject("p", "p"), commands, ctx).project
}

describe("simulate", () => {
  it("runs a project built with core commands from the real library parts", () => {
    const p = project(
      { type: "component.add", args: { part: "battery", props: { chemistry: "alkaline", voltage: "3V", capacity: "1200mAh" } } },
      { type: "component.add", args: { part: "push-button" } },
      { type: "component.add", args: { part: "resistor", props: { value: "68" } } },
      { type: "component.add", args: { part: "led", props: { color: "green" } } },
      { type: "component.add", args: { part: "header-1x2" } },
      { type: "net.connect", args: { pins: ["BT1.+", "SW1.1", "J1.1"], name: "VBAT" } },
      { type: "net.connect", args: { pins: ["SW1.2", "R1.1"], name: "SW" } },
      { type: "net.connect", args: { pins: ["R1.2", "D1.A"], name: "LED" } },
      { type: "net.connect", args: { pins: ["D1.K", "BT1.-", "J1.2"], name: "GND" } },
    )
    const r = simulate(p, {
      analysis: "tran", duration: 0.1, step: 1e-4, probes: ["LED", "I(D1)", "D1.brightness"], maxPoints: 10,
      inputs: [{ t: 0.05, ref: "SW1", action: "press" }],
    })
    expect(r.warnings).toEqual(["J1 has no simulation model and is ignored"])
    expect(r.waveforms!.time).toHaveLength(10)
    expect(Object.keys(r.waveforms!.series)).toEqual(["V(LED)", "I(D1)", "D1.brightness"])
    expect(r.waveforms!.series["I(D1)"]![3]).toBeLessThan(1e-9)
    expect(r.currents.D1).toBeGreaterThan(0.01)
    expect(r.views.D1!.brightness).toBeGreaterThan(0.5)
    expect(r.views.BT1!.soc).toBeLessThan(1)
    expect(r.voltages.VBAT).toBeLessThan(3.2)
    expect(r.voltages.VBAT).toBeGreaterThan(2.9)
  })

  it("explains what's wrong", () => {
    expect(() => simulate(circuit("R1 resistor A B"), { analysis: "op" })).toThrow(/No ground/)
    const p = circuit("V1 vsource IN GND", "R1 resistor IN GND")
    p.parts.resistor = { ...p.parts.resistor!, sim: { model: "warp-drive", params: {} } }
    expect(() => simulate(p, { analysis: "op" })).toThrow(/R1: unknown sim model "warp-drive"/)
    expect(() => simulate(circuit("R1 resistor A GND value=abc"), { analysis: "op" })).toThrow(/R1: can't read value = "abc"/)
    const ok = circuit("V1 vsource IN GND", "R1 resistor IN GND")
    expect(() => simulate(ok, { analysis: "tran" })).toThrow(/duration/)
    expect(() => simulate(ok, { analysis: "tran", duration: 1, probes: ["NOPE"] })).toThrow(/Unknown probe "NOPE"/)
    expect(() => simulate(ok, { analysis: "op", inputs: [{ t: 0, ref: "R1", action: "press" }] })).toThrow(/R1 doesn't take inputs/)
  })

  it("warns about nets with no path to ground", () => {
    const r = simulate(circuit("V1 vsource IN GND", "R1 resistor IN GND", "C1 capacitor X Y", "R2 resistor Y Z"), {
      analysis: "op",
    })
    expect(r.warnings).toEqual(["No connection to GND: X, Y, Z"])
    expect(r.voltages.IN).toBeCloseTo(5, 9)
  })

  it("steps a 20-node linear circuit at ≥ 1e5 steps/s", () => {
    const lines = ["V1 vsource N0 GND voltage=1"]
    for (let i = 1; i <= 20; i++) lines.push(`R${i} resistor N${i - 1} N${i} value=1k`, `C${i} capacitor N${i} GND value=10n`)
    const p = circuit(...lines)
    simulate(p, { analysis: "tran", duration: 0.01, step: 1e-6 }) // warm up
    const r = simulate(p, { analysis: "tran", duration: 0.1, step: 1e-6 })
    expect(r.stats.steps).toBe(100_000)
    expect(r.stats.steps / (r.stats.ms / 1000)).toBeGreaterThan(1e5)
    expect(r.voltages.N20).toBeGreaterThan(0.99)
  })

  it("groups warnings into one line per kind", () => {
    expect(refList(["U3", "J2", "J1", "J3", "U1", "J5", "ESC1", "ESC2"])).toBe("ESC1, ESC2, J1–J3, J5, U1, U3")
    const channel = (n: number): Command[] => [
      { type: "component.add", args: { part: "esc-20a", ref: `ESC${n}` } },
      { type: "component.add", args: { part: "brushless-motor", ref: `M${n}` } },
      { type: "component.add", args: { part: "header-1x2" } },
      ...["A", "B", "C"].map((phase): Command => ({ type: "net.connect", args: { pins: [`ESC${n}.${phase}`, `M${n}.${phase}`], name: `PHASE_${n}_${phase}` } })),
      { type: "net.connect", args: { pins: [`ESC${n}.VBAT`, "BT1.+"], name: "VBAT" } },
      { type: "net.connect", args: { pins: [`ESC${n}.GND`, `J${n}.2`, "BT1.-"], name: "GND" } },
    ]
    const p = project({ type: "component.add", args: { part: "battery" } }, ...[1, 2, 3].flatMap(channel))
    expect(build(p).warnings).toEqual([
      "3 parts have no simulation model and are ignored: J1–J3",
      "M1–M3 follow their ESCs' aggregate ESC/motor/propeller model; three-phase waveforms and kV-based thrust are not modeled",
    ])
  })
})
