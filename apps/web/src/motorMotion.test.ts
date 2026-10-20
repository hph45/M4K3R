import { expect, it } from "vitest"
import { motorMotion } from "./motorMotion"

it("distinguishes stopped, spinning and paused motors without relying on motion", () => {
  expect(motorMotion(0, true)).toMatchObject({ moving: false, animated: false, state: "Stopped" })
  expect(motorMotion(210, true)).toMatchObject({ moving: true, animated: true, state: "Spinning" })
  expect(motorMotion(210, false)).toMatchObject({ moving: true, animated: false, state: "Paused" })
  expect(motorMotion(-100, true).direction).toBe("reverse")
  expect(motorMotion(NaN, true)).toMatchObject({ rpm: 0, moving: false, state: "Stopped" })
})
