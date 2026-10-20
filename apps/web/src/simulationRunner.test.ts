import { expect, it } from "vitest"
import { SimulationData } from "@m4k3r/sim"
import { circuit } from "../../../packages/sim/src/testing"
import { SimulationRunner } from "./simulationRunner"

it("runs saved timed inputs, accepts live inputs and resets all state", () => {
  const p = circuit("BT1 battery IN GND", "SW1 push-button IN OUT bounceMs=0", "R1 resistor OUT GND value=100")
  const runner = new SimulationRunner(p, SimulationData.parse({ step: 0.0001, inputs: [{ t: 0.01, ref: "SW1", action: "press" }] }), ["OUT"])
  runner.advanceTo(0.02, Infinity)
  expect(runner.frame().snapshot.voltages.OUT).toBeGreaterThan(4)
  runner.input({ ref: "SW1", action: "release" })
  runner.advanceTo(0.03, Infinity)
  expect(runner.frame().snapshot.voltages.OUT).toBeCloseTo(0, 6)
  expect(runner.frame().points.at(-1)!.values.OUT).toBeCloseTo(0, 6)
  runner.running = true
  runner.reset()
  expect(runner.frame().running).toBe(false)
  expect(runner.frame().snapshot.t).toBe(0)
  expect(runner.frame().snapshot.views.SW1!.pressed).toBe(false)
})

it("bounds scope history and reports stale probes without losing the circuit", () => {
  const p = circuit("BT1 battery IN GND", "R1 resistor IN GND value=1k")
  const runner = new SimulationRunner(p, SimulationData.parse({ step: 0.001 }), ["IN", "removed"])
  runner.advanceTo(2, Infinity)
  expect(runner.points).toHaveLength(600)
  expect(runner.frame().warnings).toContainEqual(expect.stringContaining('Unknown probe "removed"'))
  expect(runner.frame().snapshot.voltages.IN).toBeGreaterThan(4)
  runner.configure(2, ["I(R1)"])
  expect(runner.points).toHaveLength(1)
  expect(runner.points[0]!.values["I(R1)"]).toBeGreaterThan(0.004)
})
