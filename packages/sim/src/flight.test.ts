import { describe, expect, it } from "vitest"
import { DeviceAnalysisData, type AircraftGeometry } from "./device-analysis"
import { simulateFlight } from "./flight"

const geometry: AircraftGeometry = { mass: 1000, centerOfMass: [0, 0, 0], inertia: [[2e6, 0, 0], [0, 2e6, 0], [0, 0, 3e6]], obstacles: [], warnings: [], rotors: {
  M1: { center: [-100, -100, 0], axis: [0, 0, 1] }, M2: { center: [100, -100, 0], axis: [0, 0, 1] }, M3: { center: [100, 100, 0], axis: [0, 0, 1] }, M4: { center: [-100, 100, 0], axis: [0, 0, 1] },
} }
const data = () => DeviceAnalysisData.parse({ battery: { voltage: 12, capacityAh: 1, resistance: 0 }, rotors: [1, 2, 3, 4].map((number) => ({ component: `M${number}`, diameter: 100, direction: number % 2 ? "cw" : "ccw", performance: { kind: "measured", voltage: 12, source: "Deterministic bench fixture", points: [{ throttle: 0, thrust: 0, current: 0, torque: 0, rpm: 0 }, { throttle: 1, thrust: 3, current: 4, torque: 0, rpm: 10000 }] } })) })

describe("quaternion rigid-body flight", () => {
  it("preserves a balanced hover and quaternion norm deterministically", () => {
    const options = { duration: 1, throttle: 9.80665 / 12, altitude: 1 }
    const result = simulateFlight(data(), geometry, options)
    expect(result).toEqual(simulateFlight(data(), geometry, options))
    expect(result.frames.at(-1)!.position[2]).toBeCloseTo(1, 9)
    expect(result.frames.at(-1)!.attitude).toEqual([0, 0, 0])
    for (const frame of result.frames) expect(Math.hypot(...frame.quaternion)).toBeCloseTo(1, 12)
  })
  it("matches free-fall kinematics and stops at a conservative ground plane", () => {
    const falling = simulateFlight(data(), geometry, { duration: 0.2, throttle: 0, altitude: 1 })
    expect(falling.frames.at(-1)!.position[2]).toBeCloseTo(1 - 0.5 * 9.80665 * 0.2 ** 2, 9)
    expect(falling.frames.at(-1)!.velocity[2]).toBeCloseTo(-9.80665 * 0.2, 9)
    const contact = simulateFlight(data(), { ...geometry, obstacles: [{ ref: "body", min: [-50, -50, -50], max: [50, 50, 50] }] }, { duration: 2 })
    expect(contact.status).toBe("ground-contact")
    expect(contact.frames.at(-1)!.position[2]).toBeCloseTo(0.05)
    expect(contact.frames.at(-1)!.velocity).toEqual([0, 0, 0])
  })
  it("uses rotor lever-arm torque, full inertia and body-to-world thrust rotation", () => {
    const turning = simulateFlight(data(), geometry, { duration: 0.05, throttle: 0.7, rotorThrottle: { M1: 0.8 }, altitude: 10 })
    expect(turning.frames.at(-1)!.angularVelocity[0]).toBeLessThan(0)
    expect(turning.frames.at(-1)!.angularVelocity[1]).toBeGreaterThan(0)
    const tilted = simulateFlight(data(), geometry, { duration: 0.05, throttle: 1, attitude: [0, 20, 0] })
    expect(tilted.frames.at(-1)!.position[0]).toBeGreaterThan(0)
    expect(tilted.frames.at(-1)!.attitude[1]).toBeCloseTo(20, 9)
  })
  it("caps rotor commands by battery limits and refuses incomplete physical data", () => {
    const input = data(); input.battery!.resistance = 0.05; input.battery!.voltageMin = 11.9; input.battery!.maxCurrent = 5
    const result = simulateFlight(input, geometry, { duration: 0.1, throttle: 1 })
    expect(result.frames.at(-1)!.voltage).toBeGreaterThanOrEqual(11.9 - 1e-8)
    expect(result.frames.at(-1)!.current).toBeLessThanOrEqual(5 + 1e-8)
    expect(result.frames.at(-1)!.throttleScale).toBeLessThan(1)
    expect(result.warnings.join(" ")).toContain("scaled down")
    expect(() => simulateFlight(data(), { ...geometry, missingMass: ["U1 unknown mass"] })).toThrow(/complete inputs/)
    expect(() => simulateFlight(data(), { ...geometry, inertia: [[0, 0, 0], [0, 0, 0], [0, 0, 0]] })).toThrow(/positive definite/)
  })
  it("opposes rotor spin with airframe reaction torque and validates each requested voltage", () => {
    const input = data(); input.rotors = [input.rotors[0]!]
    input.rotors[0]!.performance = { kind: "measured", voltage: 12, source: "Torque fixture", points: [{ throttle: 0, thrust: 0, current: 0, torque: 0 }, { throttle: 1, thrust: 3, current: 4, torque: 0.01 }] }
    const pose = { ...geometry, rotors: { M1: { center: [0, 0, 0] as [number, number, number], axis: [0, 0, 1] as [number, number, number] } } }
    expect(simulateFlight(input, pose, { duration: 0.05, throttle: 1 }).frames.at(-1)!.angularVelocity[2]).toBeGreaterThan(0)
    input.rotors[0]!.direction = "ccw"
    expect(simulateFlight(input, pose, { duration: 0.05, throttle: 1 }).frames.at(-1)!.angularVelocity[2]).toBeLessThan(0)
    input.battery!.resistance = 1
    // Static hover/high-throttle data are invalid here; a low requested point remains valid.
    expect(simulateFlight(input, pose, { duration: 0.05, throttle: 0.1 }).frames).toHaveLength(11)
    expect(() => simulateFlight(input, pose, { duration: 0.05, throttle: 1 })).toThrow(/validation range/)
    expect(() => simulateFlight(input, { ...pose, mechanicalConflicts: ["Frame intersects rotor"] }, { duration: 0.05, throttle: 0.1 })).toThrow(/clearance conflicts/)
  })
})
