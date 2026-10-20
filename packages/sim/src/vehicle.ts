import { z } from "zod"
import type { Session } from "./session"

export const SkidSteerData = z.object({
  left: z.array(z.string()).min(1), right: z.array(z.string()).min(1),
  mass: z.number().positive().describe("Mass kg"), yawInertia: z.number().positive().describe("CG yaw inertia kg·m²"),
  trackWidth: z.number().positive().describe("Track center separation m"), wheelRadius: z.number().positive().describe("Effective sprocket/wheel radius m"),
  friction: z.number().positive().default(0.8), rollingResistance: z.number().nonnegative().default(0.02), yawDamping: z.number().nonnegative().default(0.01),
  source: z.string().min(1).describe("Source for mass/inertia and geometry assumptions"),
})
export type SkidSteerData = z.infer<typeof SkidSteerData>
export interface VehicleState { x: number; y: number; heading: number; speed: number; yawRate: number; leftForce: number; rightForce: number; tractionLimited: boolean }

/** Planar torque-driven differential/skid-steer approximation. No terrain, suspension or collision dynamics. */
export class SkidSteer {
  state: VehicleState = { x: 0, y: 0, heading: 0, speed: 0, yawRate: 0, leftForce: 0, rightForce: 0, tractionLimited: false }
  constructor(readonly data: SkidSteerData) {}
  step(dt: number, leftTorque: number, rightTorque: number) {
    if (!(dt > 0) || ![dt, leftTorque, rightTorque].every(Number.isFinite)) throw new Error("Vehicle step and torque must be finite; dt positive")
    const d = this.data, s = this.state, limit = d.friction * d.mass * 9.80665 / 2
    const left = leftTorque / d.wheelRadius, right = rightTorque / d.wheelRadius
    s.leftForce = Math.max(-limit, Math.min(limit, left)); s.rightForce = Math.max(-limit, Math.min(limit, right)); s.tractionLimited = Math.abs(left) > limit || Math.abs(right) > limit
    const rolling = d.rollingResistance * d.mass * 9.80665 * Math.tanh(s.speed / 0.05)
    const acceleration = (s.leftForce + s.rightForce - rolling) / d.mass
    const yawAcceleration = ((s.rightForce - s.leftForce) * d.trackWidth / 2 - d.yawDamping * s.yawRate) / d.yawInertia
    const nextSpeed = s.speed + acceleration * dt, nextYaw = s.yawRate + yawAcceleration * dt
    const angle = s.heading + (s.yawRate + nextYaw) * dt / 4
    const distance = (s.speed + nextSpeed) * dt / 2
    s.x += Math.cos(angle) * distance; s.y += Math.sin(angle) * distance
    s.heading += (s.yawRate + nextYaw) * dt / 2; s.speed = nextSpeed; s.yawRate = nextYaw
  }
  snapshot() { return { ...this.state } }
}

/** The vehicle sets motor shaft speed; solved motor current supplies torque back to the vehicle. */
export function advanceVehicle(session: Session, vehicle: SkidSteer, seconds: number) {
  const data = vehicle.data, state = vehicle.state
  const leftSpeed = (state.speed - state.yawRate * data.trackWidth / 2) / data.wheelRadius
  const rightSpeed = (state.speed + state.yawRate * data.trackWidth / 2) / data.wheelRadius
  for (const ref of data.left) session.input({ ref, action: "shaft-speed", value: leftSpeed })
  for (const ref of data.right) session.input({ ref, action: "shaft-speed", value: rightSpeed })
  const steps = session.advance(seconds), views = session.snapshot().views
  const torque = (refs: string[]) => refs.reduce((sum, ref) => sum + Number(views[ref]?.torque ?? 0), 0)
  if (steps) vehicle.step(steps * session.step, torque(data.left), torque(data.right))
  return steps
}
