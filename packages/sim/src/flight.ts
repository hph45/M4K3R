import { CommandError } from "@m4k3r/core"
import { z } from "zod"
import { analyzeDevice, limitedPropulsionPoint, type AircraftGeometry, type DeviceAnalysisData, type PropulsionPoint, type Vector3 } from "./device-analysis"

const Vector = z.tuple([z.number(), z.number(), z.number()])
const Throttle = z.number().min(0).max(1)
export const FlightOptions = z.object({
  duration: z.number().positive().max(10).default(3), step: z.number().min(0.0005).max(0.02).default(0.005),
  throttle: Throttle.default(0), rotorThrottle: z.record(z.string(), Throttle).default({}),
  altitude: z.number().nonnegative().max(100).default(1), attitude: Vector.default([0, 0, 0]).describe("Initial roll/pitch/yaw degrees"),
  velocity: Vector.default([0, 0, 0]).describe("Initial world velocity m/s"), angularVelocity: Vector.default([0, 0, 0]).describe("Initial body angular velocity rad/s"),
  linearDrag: z.number().nonnegative().max(10).default(0), angularDrag: z.number().nonnegative().max(10).default(0),
  controls: z.array(z.object({ t: z.number().nonnegative(), throttle: Throttle, rotorThrottle: z.record(z.string(), Throttle).default({}) })).max(100).default([]),
})
export type FlightOptions = z.infer<typeof FlightOptions>
export type Quaternion = [number, number, number, number]
export interface FlightFrame {
  t: number; position: Vector3; velocity: Vector3; quaternion: Quaternion; angularVelocity: Vector3; attitude: Vector3
  voltage: number; current: number; usedAh: number; throttleScale: number; groundClearance: number
  rotors: { component: string; throttle: number; thrust: number; torque: number | null; rpm: number | null }[]
}
export interface FlightResult {
  status: "duration" | "ground-contact" | "battery-depleted"; t: number; frames: FlightFrame[]
  mass: number; centerOfMass: Vector3; inertia: number[][]
  layout: { component: string; center: Vector3; axis: Vector3; radius: number }[]
  warnings: string[]; assumptions: string[]
}

const add = (a: Vector3, b: Vector3): Vector3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
const scale = (a: Vector3, k: number): Vector3 => [a[0] * k, a[1] * k, a[2] * k]
const cross = (a: Vector3, b: Vector3): Vector3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const multiply = (matrix: number[][], vector: Vector3): Vector3 => matrix.map((row) => row.reduce((sum, value, index) => sum + value * vector[index]!, 0)) as Vector3
export const quaternionMultiply = (a: Quaternion, b: Quaternion): Quaternion => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2], a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]]
export function rotateFlightVector(q: Quaternion, vector: Vector3): Vector3 {
  const result = quaternionMultiply(quaternionMultiply(q, [0, ...vector]), [q[0], -q[1], -q[2], -q[3]])
  return [result[1], result[2], result[3]]
}
export function flightAttitude(q: Quaternion): Vector3 {
  const [w, x, y, z] = q
  return [Math.atan2(2 * (w * x + y * z), 1 - 2 * (x * x + y * y)), Math.asin(Math.max(-1, Math.min(1, 2 * (w * y - z * x)))), Math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))].map((value) => value * 180 / Math.PI) as Vector3
}
function orientation(degrees: Vector3): Quaternion {
  const [r, p, y] = degrees.map((angle) => angle * Math.PI / 360) as Vector3
  return quaternionMultiply(quaternionMultiply([Math.cos(y), 0, 0, Math.sin(y)], [Math.cos(p), 0, Math.sin(p), 0]), [Math.cos(r), Math.sin(r), 0, 0])
}
function inverseInertia(matrix: number[][]) {
  if (matrix.length !== 3 || matrix.some((row) => row.length !== 3 || row.some((value) => !Number.isFinite(value)))) throw new CommandError("Flight preview needs a finite 3×3 CG inertia tensor")
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix as [[number, number, number], [number, number, number], [number, number, number]]
  const determinant = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g)
  const magnitude = Math.max(...matrix.flat().map(Math.abs))
  if (!(a > 0 && a * e - b * d > 0 && determinant > magnitude ** 3 * 1e-12) || Math.abs(b - d) + Math.abs(c - g) + Math.abs(f - h) > magnitude * 1e-8) throw new CommandError("Flight preview needs a positive definite, symmetric inertia tensor; check assembly mass/geometry")
  return [[e * i - f * h, c * h - b * i, b * f - c * e], [f * g - d * i, a * i - c * g, c * d - a * f], [d * h - e * g, b * g - a * h, a * e - b * d]].map((row) => row.map((value) => value / determinant))
}

/** Bounded rigid-body theory driven by sourced static rotor data. This does not execute a flight controller. */
export function simulateFlight(data: DeviceAnalysisData, geometry: AircraftGeometry, input: z.input<typeof FlightOptions> = {}): FlightResult {
  const options = FlightOptions.parse(input), analysis = analyzeDevice(data, geometry)
  if (!analysis.inputComplete) throw new CommandError(`Flight preview needs complete inputs: ${analysis.missing.join("; ")}`)
  if (geometry.mechanicalConflicts?.length || analysis.clearance.some((check) => check.gap < 0)) throw new CommandError("Resolve assembly/propeller clearance conflicts before flight preview")
  if (data.rotors.some((rotor) => rotor.performance?.kind === "measured" && rotor.performance.points.some((point) => point.torque === undefined))) throw new CommandError("6DOF preview requires measured rotor reaction torque, or explicit Ct/Cp coefficients; missing yaw torque cannot be assumed zero")
  const mass = analysis.mass / 1000, inertia = geometry.inertia.map((row) => row.map((value) => value * 1e-9)), inverse = inverseInertia(inertia)
  const layout = data.rotors.map((rotor) => {
    const pose = geometry.rotors[rotor.component]!, length = Math.hypot(...pose.axis)
    if (!(length > 0)) throw new CommandError(`${rotor.component}: rotor axis must have a direction`)
    return { component: rotor.component, center: pose.center.map((value, axis) => (value - geometry.centerOfMass[axis]!) / 1000) as Vector3, axis: scale(pose.axis, 1 / length), radius: rotor.diameter! / 2000 }
  })
  const corners = geometry.obstacles.flatMap((box) => [0, 1].flatMap((x) => [0, 1].flatMap((y) => [0, 1].map((z): Vector3 => [((x ? box.max[0] : box.min[0]) - geometry.centerOfMass[0]) / 1000, ((y ? box.max[1] : box.min[1]) - geometry.centerOfMass[1]) / 1000, ((z ? box.max[2] : box.min[2]) - geometry.centerOfMass[2]) / 1000]))))
  if (!corners.length) corners.push([0, 0, 0])
  let quaternion = orientation(options.attitude), velocity = [...options.velocity] as Vector3, omega = [...options.angularVelocity] as Vector3
  const floor = (q: Quaternion) => -Math.min(0, ...corners.map((point) => rotateFlightVector(q, point)[2]))
  let position: Vector3 = [0, 0, Math.max(options.altitude, floor(quaternion))], time = 0, usedAh = 0
  let status: FlightResult["status"] = "duration", depleted = false, limited = false
  let commands = data.rotors.map((rotor) => options.rotorThrottle[rotor.component] ?? options.throttle)
  const controls = [...options.controls].sort((a, b) => a.t - b.t)
  if (controls.some((control) => control.t > options.duration)) throw new CommandError("A flight control change occurs after the preview duration")
  for (const map of [options.rotorThrottle, ...controls.map((control) => control.rotorThrottle)]) if (Object.keys(map).some((ref) => !data.rotors.some((rotor) => rotor.component === ref))) throw new CommandError("Flight controls reference a rotor outside this analysis")
  let nextControl = 0, cachedCommands = "", operating: ReturnType<typeof limitedPropulsionPoint> | undefined
  const frames: FlightFrame[] = [], every = Math.max(1, Math.ceil(options.duration / options.step / 400))
  const warnings = [...analysis.warnings]
  function power() {
    const key = JSON.stringify(commands)
    if (key !== cachedCommands || !operating) {
      operating = limitedPropulsionPoint(data, commands); cachedCommands = key
      if (!operating.viable) throw new CommandError("Battery cannot support the specified electronics draw within its limits")
      for (const rotor of data.rotors) if (rotor.performance?.kind === "measured" && Math.abs(operating.point.voltage / rotor.performance.voltage - 1) > 0.05) throw new CommandError(`${rotor.component}: flight operating voltage is outside the measured curve's 5% validation range`)
    }
    limited ||= operating.scale < 1 - 1e-6
    return operating
  }
  function sample(point: PropulsionPoint, throttleScale: number) {
    frames.push({ t: time, position: [...position], velocity: [...velocity], quaternion: [...quaternion], angularVelocity: [...omega], attitude: flightAttitude(quaternion), voltage: depleted ? 0 : point.voltage, current: depleted ? 0 : point.current, usedAh, throttleScale, groundClearance: Math.max(0, position[2] - floor(quaternion)), rotors: point.rotors.map((rotor, index) => ({ component: rotor.component, throttle: depleted ? 0 : commands[index]! * throttleScale, thrust: depleted ? 0 : rotor.thrust, torque: depleted ? 0 : rotor.torque, rpm: depleted ? 0 : rotor.rpm })) })
  }
  sample(power().point, power().scale)
  for (let step = 1; time < options.duration - 1e-12; step++) {
    while (nextControl < controls.length && controls[nextControl]!.t <= time + 1e-12) {
      const control = controls[nextControl++]!
      commands = data.rotors.map((rotor) => control.rotorThrottle[rotor.component] ?? control.throttle)
    }
    const operating = power(), point = operating.point, dt = Math.min(options.step, options.duration - time)
    if (!depleted) { usedAh += point.current * dt / 3600; if (usedAh >= data.battery!.capacityAh * data.battery!.usableFraction) { depleted = true; status = "battery-depleted" } }
    let force: Vector3 = [0, 0, 0], torque: Vector3 = [0, 0, 0]
    if (!depleted) point.rotors.forEach((rotor, index) => {
      const pose = layout[index]!, thrust = scale(pose.axis, rotor.thrust)
      force = add(force, thrust)
      torque = add(torque, add(cross(pose.center, thrust), scale(pose.axis, (rotor.torque ?? 0) * (data.rotors[index]!.direction === "ccw" ? -1 : 1))))
    })
    const acceleration = add(add(scale(rotateFlightVector(quaternion, force), 1 / mass), [0, 0, -9.80665]), scale(velocity, -options.linearDrag / mass))
    const angularAcceleration = multiply(inverse, add(add(torque, scale(cross(omega, multiply(inertia, omega)), -1)), scale(omega, -options.angularDrag)))
    position = add(position, add(scale(velocity, dt), scale(acceleration, dt * dt / 2)))
    velocity = add(velocity, scale(acceleration, dt))
    const previousOmega = omega; omega = add(omega, scale(angularAcceleration, dt))
    const average = scale(add(previousOmega, omega), 0.5), speed = Math.hypot(...average), halfAngle = speed * dt / 2
    if (speed > 1e-15) quaternion = quaternionMultiply(quaternion, [Math.cos(halfAngle), ...scale(average, Math.sin(halfAngle) / speed)])
    const length = Math.hypot(...quaternion); quaternion = quaternion.map((value) => value / length) as Quaternion
    time += dt
    if (![...position, ...velocity, ...omega, ...quaternion].every(Number.isFinite) || Math.hypot(...omega) > 1000 || Math.hypot(...position) > 10000) throw new CommandError("Flight state exceeded the bounded preview range; shorten the duration or reduce control inputs")
    const ground = floor(quaternion)
    if (position[2] < ground - 1e-8) {
      position[2] = ground; velocity = [0, 0, 0]; omega = [0, 0, 0]; status = "ground-contact"; sample(point, operating.scale); break
    }
    if (step % every === 0 || time >= options.duration - 1e-12) sample(point, operating.scale)
  }
  if (limited) warnings.push("Requested rotor throttle was scaled down to respect the battery current/minimum-voltage limits")
  if (depleted) warnings.push("Usable battery charge was exhausted; rotor thrust was removed for the remaining simulated motion")
  return { status, t: time, frames, mass: analysis.mass, centerOfMass: geometry.centerOfMass, inertia: geometry.inertia, layout, warnings, assumptions: [
    "Deterministic six-degree-of-freedom rigid body with full assembly CG inertia and quaternion orientation; manual rotor controls, not executed firmware or an autopilot.",
    "Static rotor thrust/current/reaction-torque data are applied instantly. No propeller wake interaction, forward-flight thrust correction, motor lag, flexible structure, wind or flight stabilization is modeled.",
    "Constant battery open-circuit voltage/internal resistance with usable-charge accounting. Uniform throttle scaling respects specified current and loaded-voltage limits.",
    "Ground contact conservatively uses rotated assembly bounding-box corners and stops motion without bounce, terrain or contact torque dynamics. Added payload is a point at CG.",
  ] }
}
