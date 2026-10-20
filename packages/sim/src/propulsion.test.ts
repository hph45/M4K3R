import { emptyProject, Part } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { simulate } from "./simulate"
import { createSession } from "./session"

function netlist(lines: { ref: string; model: string; nodes: Record<string, string>; props?: Record<string, string> }[]) {
  const project = emptyProject("models", "models")
  for (const line of lines) {
    project.parts[line.model] ??= Part.parse({ id: line.model, name: line.model, refPrefix: line.ref.replace(/\d+$/, ""), pins: Object.keys(line.nodes).map((name, index) => ({ num: String(index + 1), name })), sim: { model: line.model } })
    project.components.push({ id: line.ref, ref: line.ref, part: line.model, props: line.props ?? {} })
    Object.entries(line.nodes).forEach(([name, node]) => {
      const net = project.nets.find((net) => net.name === node) ?? { id: node, name: node, pins: [] }
      if (!project.nets.includes(net)) project.nets.push(net)
      net.pins.push({ component: line.ref, pin: project.parts[line.model]!.pins.find((pin) => pin.name === name)!.num })
    })
  }
  return project
}
describe("propulsion power models", () => {
  it("regulates an input rail with input power draw", () => {
    const project = netlist([
      { ref: "V1", model: "vsource", nodes: { "+": "BAT", "-": "GND" }, props: { voltage: "5" } },
      { ref: "U1", model: "regulator", nodes: { IN: "BAT", OUT: "VCC", GND: "GND" }, props: { voltage: "3.3", efficiency: "0.8" } },
      { ref: "R1", model: "resistor", nodes: { "1": "VCC", "2": "GND" }, props: { value: "100" } },
    ])
    const result = simulate(project, { analysis: "op" })
    expect(result.voltages.VCC).toBeCloseTo(3.3, 2)
    expect(result.currents.V1).toBeGreaterThan(3.3 * 0.032 / 5 / 0.8)
  })
  it("routes h-bridge forward drive through the actual motor load", () => {
    const project = netlist([
      { ref: "V1", model: "vsource", nodes: { "+": "BAT", "-": "GND" }, props: { voltage: "6" } },
      { ref: "V2", model: "vsource", nodes: { "+": "HIGH", "-": "GND" }, props: { voltage: "3.3" } },
      { ref: "U1", model: "h-bridge", nodes: { VM: "BAT", GND: "GND", IN1: "HIGH", IN2: "GND", OUT1: "A", OUT2: "B" } },
      { ref: "R1", model: "resistor", nodes: { "1": "A", "2": "B" }, props: { value: "10" } },
    ])
    const result = simulate(project, { analysis: "tran", duration: 0.001 })
    expect(result.views.U1!.mode).toBe("forward")
    expect(result.currents.R1).toBeCloseTo(6 / 10.4, 6)
  })
  it("uses explicit prop coefficients and accounts for ESC battery current", () => {
    const project = netlist([
      { ref: "V1", model: "vsource", nodes: { "+": "BAT", "-": "GND" }, props: { voltage: "12" } },
      { ref: "V2", model: "vsource", nodes: { "+": "SIGNAL", "-": "GND" }, props: { voltage: "3.3" } },
      { ref: "E1", model: "esc-propeller", nodes: { VBAT: "BAT", GND: "GND", SIGNAL: "SIGNAL" }, props: { diameter: "127", ct: "0.1", cp: "0.04", fullRpm: "18000", voltage: "12" } },
    ])
    const result = simulate(project, { analysis: "op" })
    expect(result.views.E1!.rpm).toBeCloseTo(18000)
    expect(result.views.E1!.thrust).toBeCloseTo(0.1 * 1.225 * 300 ** 2 * 0.127 ** 4, 8)
    expect(result.currents.V1).toBeCloseTo(Number(result.views.E1!.current), 6)
  })
  it("decodes real servo pulse width rather than interpreting 50 Hz average voltage as throttle", () => {
    const project = netlist([
      { ref: "V1", model: "vsource", nodes: { "+": "BAT", "-": "GND" }, props: { voltage: "12" } },
      { ref: "V2", model: "vsource", nodes: { "+": "SIGNAL", "-": "GND" } },
      { ref: "E1", model: "esc-propeller", nodes: { VBAT: "BAT", GND: "GND", SIGNAL: "SIGNAL" }, props: { diameter: "127", ct: "0.1", cp: "0.04", fullRpm: "18000", voltage: "12", signalMode: "servo" } },
    ])
    const session = createSession(project, { step: 0.00001, models: { V2: (ctx) => { const k = ctx.branch("pulse"); return { stamp: (s) => s.voltage(k, ctx.pin("+"), ctx.pin("-"), s.t % 0.02 < 0.0015 ? 3.3 : 0) } } } })
    session.advance(0.1)
    expect(session.snapshot().views.E1!.throttle).toBeCloseTo(0.5, 1)
    expect(session.snapshot().views.E1!.pulseWidth).toBeCloseTo(0.0015, 4)
    expect(session.snapshot().views.E1!.rpm).toBeGreaterThan(7000)
  })
})
