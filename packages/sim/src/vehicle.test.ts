import { expect, it } from "vitest"
import { SkidSteer, SkidSteerData } from "./vehicle"
import { advanceVehicle } from "./vehicle"
import { createSession } from "./session"
import { circuit } from "./testing"
const data = () => SkidSteerData.parse({ left: ["M1"], right: ["M2"], mass: 1, yawInertia: 0.01, trackWidth: 0.2, wheelRadius: 0.05, friction: 1, rollingResistance: 0, yawDamping: 0, source: "Analytic fixture" })
it("translates wheel torque into vehicle acceleration, yaw and traction limits", () => {
  const straight = new SkidSteer(data())
  for (let i = 0; i < 100; i++) straight.step(0.001, 0.1, 0.1)
  expect(straight.state.speed).toBeCloseTo(0.4, 10)
  expect(straight.state.x).toBeCloseTo(0.02, 8)
  expect(straight.state.heading).toBe(0)
  const turn = new SkidSteer(data()); turn.step(0.1, -0.1, 0.1)
  expect(turn.state.yawRate).toBeCloseTo(4)
  expect(turn.state.speed).toBe(0)
  turn.step(0.01, 100, 100)
  expect(turn.state.tractionLimited).toBe(true)
  expect(turn.state.leftForce).toBeCloseTo(9.80665 / 2)
})
it("feeds chassis wheel speed into genuine motor back-EMF instead of accelerating without a speed bound", () => {
  const session = createSession(circuit("V1 vsource VCC GND voltage=6", "M1 dc-motor VCC GND", "M2 dc-motor VCC GND"), { step: 0.001 })
  const vehicle = new SkidSteer({ ...data(), rollingResistance: 0.02 })
  for (let i = 0; i < 2000; i++) advanceVehicle(session, vehicle, 0.001)
  expect(vehicle.state.speed).toBeGreaterThan(0.5)
  expect(vehicle.state.speed).toBeLessThan(300 * 2 * Math.PI / 60 * 0.05)
  expect(vehicle.state.heading).toBeCloseTo(0, 10)
  expect(session.snapshot().views.M1!.rpm).toBeCloseTo(vehicle.state.speed / 0.05 * 60 / (2 * Math.PI), 0)
})
