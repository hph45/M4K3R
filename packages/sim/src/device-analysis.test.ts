import { describe, expect, it } from "vitest"
import type { Project } from "@m4k3r/core"
import { analyzeDevice, DeviceAnalysisData, deviceAnalysisSummary, grams, resolveRotors, RotorPerformance, rotorPerformance, type AircraftGeometry, type Vector3 } from "./device-analysis"

const performance = { kind: "coefficients" as const, ct: 0.1, cp: 0.04, maxRpm: 18000, referenceVoltage: 12, efficiency: 0.8, source: "Illustrative, not measured" }
const geometry: AircraftGeometry = { mass: 500, centerOfMass: [0, 0, 0], inertia: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], warnings: [], obstacles: [], rotors: {
  M1: { center: [-100, -100, 20], axis: [0, 0, 1] }, M2: { center: [100, -100, 20], axis: [0, 0, 1] }, M3: { center: [100, 100, 20], axis: [0, 0, 1] }, M4: { center: [-100, 100, 20], axis: [0, 0, 1] },
} }
const setup = () => DeviceAnalysisData.parse({ battery: { voltage: 12, capacityAh: 1, resistance: 0.05 }, rotors: [1, 2, 3, 4].map((number) => ({ component: `M${number}`, diameter: 127, direction: number % 2 ? "cw" : "ccw", performance })) })

describe("device feasibility", () => {
  it("uses explicit prop coefficients and power balance, never motor kV alone", () => {
    const point = rotorPerformance(performance, 127, 1, 12)
    expect(point.thrust).toBeCloseTo(0.1 * 1.225 * 300 ** 2 * 0.127 ** 4, 12)
    expect(point.current * 12 * 0.8).toBeCloseTo(point.torque! * 2 * Math.PI * 300, 10)
    const missing = setup(); delete missing.rotors[0]!.performance
    expect(analyzeDevice(missing, geometry).status).toBe("missing-data")
    expect(analyzeDevice(missing, geometry).missing.join(" ")).toContain("kV alone is insufficient")
  })
  it("solves loaded voltage and collective hover, charge runtime and balanced moments", () => {
    const data = setup(), result = analyzeDevice(data, geometry)
    expect(result.status).toBe("theoretical-hover")
    expect(result.maximum!.voltage).toBeLessThan(12)
    expect(result.maximum!.voltage).toBeCloseTo(12 - result.maximum!.current * 0.05, 10)
    expect(result.hover!.verticalThrust).toBeCloseTo(0.5 * 9.80665, 8)
    expect(result.hover!.moment).toEqual([0, 0, 0])
    expect(result.hover!.runtimeMinutes).toBeCloseTo(0.8 / result.hover!.current * 60, 10)
  })
  it("reports inadequate thrust and actual prop envelope overlaps", () => {
    const data = setup()
    const heavy = analyzeDevice(data, { ...geometry, mass: 10000 })
    expect(heavy.status).toBe("insufficient-thrust")
    expect(heavy.hover).toBeNull()
    data.rotors[0]!.diameter = 500
    expect(analyzeDevice(data, geometry).clearance.some((check) => check.gap < 0)).toBe(true)
  })
  it("reports usable thrust within battery limits and keeps raw full-throttle predictions explicit", () => {
    const data = setup(); data.battery!.voltageMin = 11.5; data.battery!.maxCurrent = 3
    const result = analyzeDevice(data, geometry)
    expect(result.maximum!.throttle).toBeLessThan(1)
    expect(result.maximum!.current).toBeLessThanOrEqual(3 + 1e-6)
    expect(result.maximum!.voltage).toBeGreaterThanOrEqual(11.5 - 1e-6)
    expect(result.rawMaximum!.thrust).toBeGreaterThan(result.maximum!.thrust)
    expect(result.warnings.join(" ")).toContain("Full throttle is outside battery limits")
  })
  it("interpolates measured data and distinguishes missing torque and voltage mismatch", () => {
    const measured = { kind: "measured" as const, voltage: 12, source: "Bench CSV fixture", points: [{ throttle: 0, thrust: 0, current: 0 }, { throttle: 1, thrust: 3, current: 4 }] }
    expect(rotorPerformance(measured, 127, 0.5, 12)).toEqual({ thrust: 1.5, current: 2, rpm: null, torque: null })
    const data = setup(); data.rotors.forEach((rotor) => rotor.performance = measured)
    data.battery!.resistance = 1
    expect(analyzeDevice(data, geometry).warnings.join(" ")).toMatch(/reaction torque.*not validated/s)
  })
  it("withholds an unvalidated maximum while retaining hover validated at the loaded voltage", () => {
    const data = setup(); data.battery!.resistance = 0.1
    data.rotors.forEach((rotor) => rotor.performance = { kind: "measured", voltage: 12, source: "Bench fixture", points: [{ throttle: 0, thrust: 0, current: 0, torque: 0 }, { throttle: 1, thrust: 5, current: 4, torque: 0.1 }] })
    const result = analyzeDevice(data, geometry)
    expect(result.status).toBe("theoretical-hover")
    expect(result.hover!.voltage).toBeGreaterThan(11.4)
    expect(result.rawMaximum!.voltage).toBeCloseTo(10.4)
    expect(result.maximum).toBeNull(); expect(result.thrustToWeight).toBeNull()
    expect(result.warnings.join(" ")).toMatch(/maximum loaded voltage.*not validated/)
  })
  it("requires nondecreasing measured current for battery-limit searches and complete placed mass", () => {
    expect(RotorPerformance.safeParse({ kind: "measured", voltage: 12, source: "Nonmonotonic bench region", points: [{ throttle: 0, thrust: 0, current: 0 }, { throttle: 0.5, thrust: 2, current: 10 }, { throttle: 0.8, thrust: 3, current: 2 }, { throttle: 1, thrust: 4, current: 10 }] }).success).toBe(false)
    const result = analyzeDevice(setup(), { ...geometry, missingMass: ["U1: manufacturer mass unavailable"] })
    expect(result.status).toBe("missing-data"); expect(result.massComplete).toBe(false)
    expect(result.inputComplete).toBe(false); expect(result.thrustToWeight).toBeNull()
  })
  it("applies CW airframe reaction torque along positive rotor axis", () => {
    const data = setup(); data.rotors = [{ ...data.rotors[0]!, direction: "cw" }]
    const result = analyzeDevice(data, geometry)
    expect(result.maximum!.moment[2]).toBeGreaterThan(0)
    data.rotors[0]!.direction = "ccw"
    expect(analyzeDevice(data, geometry).maximum!.moment[2]).toBeLessThan(0)
  })
})

describe("rotor data from parts", () => {
  const part = (id: string, name: string, props: Record<string, string>) => ({ id, name, props, pins: [], kind: "module", category: "", refPrefix: "U", description: "" })
  const project = (motor: Record<string, string>, prop: Record<string, string>) => ({
    parts: { motor: part("motor", "Brushless motor", { kv: "2300", ...motor }), prop: part("prop", "Propeller", prop) },
    components: [1, 2].flatMap((n) => [{ id: `m${n}`, ref: `M${n}`, part: "motor", props: n === 2 ? { direction: "ccw" } : {} }, { id: `p${n}`, ref: `P${n}`, part: "prop", props: {} }]),
  }) as unknown as Project
  const placed: Record<string, Vector3> = { M1: [-100, 0, 0], P1: [-100, 0, 10], M2: [100, 0, 0], P2: [101, 0, 10] }
  const motor = { maxRpm: "20000", referenceVoltage: "11.1", efficiency: "0.8", dataSource: "Motor bench" }, prop = { diameter: "127", ct: "0.1", cp: "0.05", dataSource: "Prop table" }

  it("detects placed motors, pairs their propellers and combines part data", () => {
    const { rotors } = resolveRotors(project(motor, prop), DeviceAnalysisData.parse({}), placed)
    expect(rotors.map((rotor) => [rotor.component, rotor.propeller, rotor.diameter, rotor.direction])).toEqual([["M1", "P1", 127, undefined], ["M2", "P2", 127, "ccw"]])
    expect(rotors[0]!.performance).toEqual({ kind: "coefficients", ct: 0.1, cp: 0.05, maxRpm: 20000, referenceVoltage: 11.1, efficiency: 0.8, source: "Propeller: Prop table; Brushless motor: Motor bench" })
  })
  it("keeps explicit document fields as overrides and missing part data explicit", () => {
    const data = DeviceAnalysisData.parse({ rotors: [{ component: "M1", diameter: 150, performance }, { component: "M2" }] })
    const { rotors } = resolveRotors(project({}, prop), data, placed)
    expect(rotors[0]).toMatchObject({ propeller: "P1", diameter: 150, performance })
    expect(rotors[1]!.performance).toBeUndefined()
    const result = analyzeDevice({ ...data, battery: { voltage: 12, capacityAh: 1, resistance: 0.05, usableFraction: 0.8 }, rotors }, geometry)
    expect(result.missing.join(" ")).toMatch(/M2: performance data.*maxRpm.*kV alone is insufficient/)
    expect(result.warnings).toContain("M1: spin direction is not set; clockwise assumed")
  })
  it("groups estimated-mass warnings and leads the summary with headline numbers", () => {
    const data = { ...setup(), addedMass: 15 }
    const result = analyzeDevice(data, { ...geometry, warnings: ["M1: mass is an estimate", "M2: mass is an estimate", "Frame: printed infill assumed"] })
    expect(result.warnings).toEqual(["Frame: printed infill assumed", "2 parts use estimated mass"])
    expect(result.estimatedMass).toEqual(["M1", "M2"])
    const lines = deviceAnalysisSummary(result).split("\n")
    expect(lines[0]).toBe("Theoretical static hover possible (static estimate, not flight validation)")
    expect(lines[1]).toBe("Mass: 515.0 g (500.0 g assembly + 15.0 g payload)")
    expect(lines.find((line) => line.startsWith("Max usable thrust:"))).toMatch(/^Max usable thrust: \d+ g \(\d+\.\d\d N\) at 100\.0% collective$/)
    expect(grams(9.80665)).toBeCloseTo(1000)
  })
})
