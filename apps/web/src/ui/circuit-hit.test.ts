import { expect, it } from "vitest"
import { nearestCircuitPin } from "./circuit-hit"

it("snaps to the closest eligible endpoint and never to the wire's source", () => {
  const pins = new Map<string, [number, number]>([["source", [10, 10]], ["near", [12, 10]], ["far", [15, 10]]])
  expect(nearestCircuitPin([10, 10], pins, 3, "source")).toBe("near")
  expect(nearestCircuitPin([14.8, 10], pins, 3, "source")).toBe("far")
  expect(nearestCircuitPin([30, 30], pins, 3, "source")).toBeNull()
})

it("keeps endpoint hit areas consistent when zoom changes and rejects invalid coordinates", () => {
  const pins = new Map<string, [number, number]>([["pin", [20, 20]]])
  expect(nearestCircuitPin([22, 20], pins, 12 / 4)).toBe("pin")
  expect(nearestCircuitPin([22, 20], pins, 12 / 8)).toBeNull()
  expect(nearestCircuitPin([NaN, 20], pins, 3)).toBeNull()
  expect(nearestCircuitPin([20, 20], new Map(), 3)).toBeNull()
})
