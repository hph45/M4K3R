import { emptyProject, Part } from "@m4k3r/core"
import { expect, it } from "vitest"
import { createCoupledSession, type McuRuntime } from "./coupled"
import { libraryPart } from "./testing"

it("bridges averaged PWM drive, pulls, digital input hysteresis and ADC feedback", () => {
  const project = emptyProject("coupled", "coupled")
  project.parts.mcu = Part.parse({ id: "mcu", name: "MCU", refPrefix: "U", pins: [{ num: "1", name: "GP15" }, { num: "2", name: "GP26" }] })
  project.parts.resistor = libraryPart("resistor")
  project.components = [{ id: "u", ref: "U1", part: "mcu", props: {} }, { id: "r", ref: "R1", part: "resistor", props: { value: "1k" } }]
  project.nets = [{ id: "out", name: "OUT", pins: [{ component: "u", pin: "1" }, { component: "u", pin: "2" }, { component: "r", pin: "1" }] }, { id: "gnd", name: "GND", pins: [{ component: "r", pin: "2" }] }]
  let elapsed = 0, analog = 0
  const runtime: McuRuntime = { step: (nanos) => { elapsed += nanos }, pin: (gpio) => ({ state: gpio === 15 ? "high" : "input", function: gpio === 15 ? "pwm" : "sio" }), setInput() {}, setAnalogInput: (_gpio, voltage) => { analog = voltage }, outputDuty: () => 0.5 }
  const session = createCoupledSession(project, [{ component: "U1", runtime }], { step: 0.0001 })
  session.advance(0.001)
  expect(elapsed).toBeCloseTo(1e6)
  expect(session.snapshot().voltages.OUT).toBeCloseTo(1.65 * 1000 / 1030, 8)
  expect(analog).toBeCloseTo(session.snapshot().voltages.OUT!, 8)
})
