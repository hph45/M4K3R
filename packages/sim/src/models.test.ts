import { describe, expect, it } from "vitest"
import { saturation, VT } from "./models/diode"
import { simulate } from "./simulate"
import { circuit } from "./testing"

const near = (actual: number, expected: number, rel = 0.01) =>
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(Math.abs(expected) * rel)

describe("linear", () => {
  it("divider", () => {
    const r = simulate(circuit("V1 vsource IN GND voltage=10V", "R1 resistor IN OUT value=1k", "R2 resistor OUT GND value=3k"), {
      analysis: "op",
    })
    near(r.voltages.OUT!, 7.5, 1e-6)
    near(r.currents.R1!, 2.5e-3, 1e-6)
    near(r.currents.V1!, 2.5e-3, 1e-6)
  })

  it("RC charges with τ = RC", () => {
    const p = circuit("V1 vsource IN GND voltage=5V", "R1 resistor IN OUT value=1k", "C1 capacitor OUT GND value=1u")
    for (const n of [1, 3]) {
      const r = simulate(p, { analysis: "tran", duration: n * 1e-3, step: 1e-6 })
      near(r.voltages.OUT!, 5 * (1 - Math.exp(-n)))
    }
    expect(simulate(p, { analysis: "op" }).voltages.OUT).toBeCloseTo(5, 6)
  })

  it("RL current rises with τ = L/R", () => {
    const p = circuit("V1 vsource IN GND voltage=1V", "R1 resistor IN X value=10", "L1 inductor X GND value=10m")
    const r = simulate(p, { analysis: "tran", duration: 1e-3, step: 1e-6 })
    near(r.currents.L1!, 0.1 * (1 - Math.exp(-1)))
    expect(simulate(p, { analysis: "op" }).currents.L1).toBeCloseTo(0.1, 6)
  })
})

describe("diodes", () => {
  it("LED current with a series resistor matches the diode equation", () => {
    const r = simulate(circuit("V1 vsource IN GND voltage=5V", "R1 resistor IN A value=150", "D1 led A:A K:GND color=red"), {
      analysis: "op",
    })
    // Solve 5 = I·(150 + rs) + n·Vt·ln(1 + I/Is) by bisection
    const [n, rs] = [2, 10]
    const is = saturation(1.9, n, rs)
    let [lo, hi] = [0, 5 / 150]
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2
      if (mid * (150 + rs) + n * VT * Math.log1p(mid / is) > 5) hi = mid
      else lo = mid
    }
    near(r.currents.D1!, lo, 1e-4)
    near(r.views.D1!.brightness as number, lo / 0.02, 1e-4)
    expect(r.voltages.A).toBeGreaterThan(1.9)
    expect(r.voltages.A).toBeLessThan(2.2)
  })

  it("LED color sets the forward voltage, and an explicit vf wins", () => {
    const vf = (props: string) =>
      simulate(circuit("V1 vsource IN GND voltage=5V", "R1 resistor IN A value=330", `D1 led A:A K:GND ${props}`), {
        analysis: "op",
      }).voltages.A!
    expect(vf("color=blue") - vf("color=red")).toBeGreaterThan(0.8)
    near(vf("color=blue vf=1.9"), vf("color=red"), 1e-9)
  })

  it("silicon diode forward voltage is plausible and reverse current is tiny", () => {
    const fwd = simulate(circuit("V1 vsource IN GND voltage=5V", "R1 resistor IN A value=430", "D1 diode A:A K:GND"), {
      analysis: "op",
    })
    expect(fwd.voltages.A).toBeGreaterThan(0.6)
    expect(fwd.voltages.A).toBeLessThan(0.75)
    const rev = simulate(circuit("V1 vsource IN GND voltage=5V", "R1 resistor IN K value=430", "D1 diode A:GND K:K"), {
      analysis: "op",
    })
    expect(Math.abs(rev.currents.D1!)).toBeLessThan(1e-7)
  })

  it("converges on a stiff circuit: diode hard across a source, plus a 1 ns RC stepped at 10 µs", () => {
    const p = circuit(
      "V1 vsource IN GND voltage=10V",
      "R1 resistor IN A value=1",
      "D1 diode A:A K:GND",
      "R2 resistor IN B value=1",
      "C1 capacitor B GND value=1n",
      "D2 led A:B K:GND color=blue",
    )
    const op = simulate(p, { analysis: "op" })
    expect(op.currents.D1).toBeGreaterThan(5)
    expect(op.currents.D1).toBeLessThan(10)
    const tran = simulate(p, { analysis: "tran", duration: 1e-3, step: 10e-6 })
    near(tran.currents.D1!, op.currents.D1!, 1e-6)
    near(tran.voltages.B!, op.voltages.B!, 1e-6)
  })
})

describe("battery", () => {
  it("sags under load by I·R and counts coulombs", () => {
    const p = circuit("BT1 battery VBAT GND chemistry=li-ion capacity=1000mAh", "R1 resistor VBAT GND value=4")
    const op = simulate(p, { analysis: "op" })
    near(op.voltages.VBAT!, (4.2 * 4) / (4 + 0.08), 1e-9)

    const r = simulate(p, { analysis: "tran", duration: 36, step: 1e-3, probes: ["I(BT1)"] })
    const amps = r.waveforms!.series["I(BT1)"]!
    const charge = (amps.reduce((a, b) => a + b, 0) / amps.length) * 36
    near(1 - (r.views.BT1!.soc as number), charge / 3600, 0.01)
    expect(r.voltages.VBAT).toBeLessThan(op.voltages.VBAT!)
  })

  it("follows the OCV curve and stacks cells", () => {
    const ocv = (props: string) =>
      simulate(circuit(`BT1 battery VBAT GND ${props}`, "R1 resistor VBAT GND value=1meg"), { analysis: "op" }).voltages.VBAT!
    near(ocv("chemistry=li-ion soc=50%"), 3.79, 1e-3)
    near(ocv("chemistry=alkaline voltage=3V soc=100%"), 3.2, 1e-3)
  })
})

describe("dc motor", () => {
  // Derived the same way as the model, from the library part: 6 V, 300 rpm, 1.5 A stall, no-load current 5 % of stall
  const [v, rpm, stall] = [6, 300, 1.5]
  const i0 = 0.05 * stall
  const r = v / stall
  const w0 = (rpm * 2 * Math.PI) / 60
  const ke = (v - i0 * r) / w0
  const b = (ke * i0) / w0
  const steady = (volts: number, load = 0) => {
    const i = (volts + (ke * load) / b) / (r + (ke * ke) / b)
    return { i, rpm: (((ke * i - load) / b) * 60) / (2 * Math.PI) }
  }

  it("reaches the analytic steady-state speed and current", () => {
    for (const volts of [6, 3.7]) {
      const res = simulate(circuit(`V1 vsource IN GND voltage=${volts}`, "M1 dc-motor IN GND"), {
        analysis: "tran", duration: 0.3, probes: ["I(M1)"],
      })
      near(res.views.M1!.rpm as number, steady(volts).rpm)
      near(res.currents.M1!, steady(volts).i)
      expect(Math.max(...res.waveforms!.series["I(M1)"]!)).toBeGreaterThan(0.8 * (volts / r))
    }
    near(steady(3.7).rpm, 185, 0.01)
  })

  it("slows under load torque; op gives the steady state", () => {
    const res = simulate(circuit("V1 vsource IN GND voltage=6", "M1 dc-motor IN GND loadTorque=0.05"), { analysis: "op" })
    near(res.views.M1!.rpm as number, steady(6, 0.05).rpm, 1e-6)
    near(res.currents.M1!, steady(6, 0.05).i, 1e-6)
  })
})

describe("switches", () => {
  const pullup = (extra = "") =>
    circuit("V1 vsource VCC GND voltage=3.3", "R1 resistor VCC IN value=10k", `SW1 push-button IN GND ${extra}`)

  it("button bounces on press and release, then settles", () => {
    const r = simulate(pullup(), {
      analysis: "tran", duration: 0.05, step: 10e-6, probes: ["IN"], maxPoints: 1e6,
      inputs: [{ t: 0.01, ref: "SW1", action: "press" }, { t: 0.03, ref: "SW1", action: "release" }],
    })
    const { time, series } = r.waveforms!
    const v = series["V(IN)"]!
    const edges = (from: number, to: number) =>
      v.filter((x, i) => i > 0 && time[i]! > from && time[i]! <= to && x < 1.65 !== v[i - 1]! < 1.65).length
    expect(edges(0, 0.01)).toBe(0)
    expect(edges(0.01, 0.0151)).toBe(5)
    expect(edges(0.0151, 0.03)).toBe(0)
    expect(edges(0.03, 0.0351)).toBe(5)
    expect(edges(0.0351, 0.05)).toBe(0)
    expect(v.at(-1)).toBeCloseTo(3.3, 3)
    expect(v[time.findIndex((t) => t > 0.02)]).toBeLessThan(0.01)
  })

  it("bounceMs = 0 switches cleanly, and op applies inputs", () => {
    const r = simulate(pullup("bounceMs=0"), {
      analysis: "tran", duration: 0.02, step: 10e-6, probes: ["IN"], maxPoints: 1e6,
      inputs: [{ t: 0.01, ref: "SW1", action: "press" }],
    })
    const v = r.waveforms!.series["V(IN)"]!
    expect(v.filter((x, i) => i > 0 && x < 1.65 !== v[i - 1]! < 1.65)).toHaveLength(1)
    const op = simulate(pullup(), { analysis: "op", inputs: [{ t: 1, ref: "SW1", action: "press" }] })
    expect(op.voltages.IN).toBeLessThan(0.02)
    expect(op.views.SW1).toEqual({ pressed: true, closed: true })
  })

  it("SPDT routes COM to A or B", () => {
    const p = circuit(
      "V1 vsource VCC GND voltage=5",
      "SW1 switch-spdt A VCC B",
      "R1 resistor A GND value=1k",
      "R2 resistor B GND value=1k",
    )
    expect(simulate(p, { analysis: "op" }).voltages).toMatchObject({ A: expect.closeTo(5, 2), B: expect.closeTo(0, 6) })
    const r = simulate(p, { analysis: "op", inputs: [{ t: 0, ref: "SW1", action: "toggle" }] })
    expect(r.voltages).toMatchObject({ A: expect.closeTo(0, 6), B: expect.closeTo(5, 2) })
    expect(r.views.SW1).toEqual({ position: "B" })
  })
})

describe("nmos", () => {
  it("is off below Vth and has R_DS(on) when driven", () => {
    const run = (vg: number) =>
      simulate(
        circuit("V1 vsource VCC GND voltage=5", "V2 vsource G GND voltage=" + vg, "R1 resistor VCC D value=100", "Q1 nmos G GND D"),
        { analysis: "op" },
      )
    expect(run(0).currents.Q1).toBeLessThan(1e-9)
    const on = run(4.5)
    const rds = on.voltages.D! / on.currents.Q1!
    expect(rds).toBeGreaterThan(2)
    expect(rds).toBeLessThan(2.1)
    expect(run(2.5).currents.Q1).toBeLessThan(on.currents.Q1! / 2)
  })
})
