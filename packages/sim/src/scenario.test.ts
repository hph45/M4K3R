import { expect, it } from "vitest"
import { runScenario, ScenarioCheck } from "./scenario"
import { circuit } from "./testing"

it("checks timed button/LED effects and records failed bounds", () => {
  const project = circuit("BT1 battery IN GND", "SW1 push-button IN SW bounceMs=0", "R1 resistor SW LED value=150", "D1 led A:LED K:GND")
  const result = runScenario(project, { duration: 0.05, step: 0.0001, inputs: [{ t: 0.01, ref: "SW1", action: "press" }], checks: [
    ScenarioCheck.parse({ t: 0.005, probe: "D1.brightness", max: 0.001 }),
    ScenarioCheck.parse({ t: 0.02, probe: "D1.brightness", min: 0.4 }),
    ScenarioCheck.parse({ t: 0.03, probe: "IN", max: 1 }),
  ] })
  expect(result.checks.map((check) => check.passed)).toEqual([true, true, false])
  expect(result.passed).toBe(false)
  expect(result.t).toBeCloseTo(0.05, 10)
})
