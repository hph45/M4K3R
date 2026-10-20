import type { V3 } from "./schema"
export type Matrix = [V3, V3, V3]
export const identity = (): Matrix => [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
export const add = (a: V3, b: V3): V3 => a.map((n, i) => n + b[i]!) as V3
export const sub = (a: V3, b: V3): V3 => a.map((n, i) => n - b[i]!) as V3
export const scale = (a: V3, s: number): V3 => a.map((n) => n * s) as V3
export const dot = (a: V3, b: V3) => a.reduce((sum, n, i) => sum + n * b[i]!, 0)
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
export const unit = (v: V3): V3 => { const length = Math.hypot(...v); if (!length) throw new Error("A mounting axis cannot be zero"); return scale(v, 1 / length) }
export const multiplyVector = (m: Matrix, p: V3): V3 => m.map((row) => dot(row, p)) as V3
export const transpose = (m: Matrix): Matrix => [0, 1, 2].map((i) => m.map((row) => row[i]!) as V3) as Matrix
export const multiply = (a: Matrix, b: Matrix): Matrix => { const columns = transpose(b); return a.map((row) => columns.map((col) => dot(row, col)) as V3) as Matrix }
export function rotationMatrix([x, y, z]: V3): Matrix {
  const [a, b, c] = [x, y, z].map((d) => d * Math.PI / 180)
  const [sx, cx, sy, cy, sz, cz] = [Math.sin(a!), Math.cos(a!), Math.sin(b!), Math.cos(b!), Math.sin(c!), Math.cos(c!)]
  return [[cz! * cy!, cz! * sy! * sx! - sz! * cx!, cz! * sy! * cx! + sz! * sx!], [sz! * cy!, sz! * sy! * sx! + cz! * cx!, sz! * sy! * cx! - cz! * sx!], [-sy!, cy! * sx!, cy! * cx!]]
}
export function eulerAngles(m: Matrix): V3 {
  const y = Math.asin(Math.max(-1, Math.min(1, -m[2][0])))
  const regular = Math.abs(Math.cos(y)) > 1e-8
  return [regular ? Math.atan2(m[2][1], m[2][2]) : 0, y, regular ? Math.atan2(m[1][0], m[0][0]) : Math.atan2(-m[0][1], m[1][1])].map((r) => r * 180 / Math.PI) as V3
}
export const rotateVector = (v: V3, rotation: V3): V3 => multiplyVector(rotationMatrix(rotation), v)
export const transformPoint = (v: V3, position: V3, rotation: V3): V3 => add(position, rotateVector(v, rotation))
function axisAngle(axis: V3, angle: number): Matrix {
  const [x, y, z] = unit(axis); const c = Math.cos(angle); const s = Math.sin(angle); const t = 1 - c
  return [[t*x*x+c, t*x*y-s*z, t*x*z+s*y], [t*x*y+s*z, t*y*y+c, t*y*z-s*x], [t*x*z-s*y, t*y*z+s*x, t*z*z+c]]
}
export function alignAxes(source: V3, target: V3, twistDegrees = 0): Matrix {
  const a = unit(source); const b = unit(target); const c = dot(a, b)
  const rotation = c > 1 - 1e-9 ? identity() : c < -1 + 1e-9 ? axisAngle(cross(a, Math.abs(a[0]) < .9 ? [1, 0, 0] : [0, 1, 0]), Math.PI) : axisAngle(cross(a, b), Math.acos(Math.max(-1, Math.min(1, c))))
  return multiply(axisAngle(b, twistDegrees * Math.PI / 180), rotation)
}
export interface WeightedBody { mass: number; centerOfMass: V3; inertia: Matrix }
/** Parallel axis theorem about the combined center of mass. Units: grams, mm, g·mm². */
export function aggregateMass(bodies: WeightedBody[]) {
  const mass = bodies.reduce((sum, b) => sum + b.mass, 0)
  const centerOfMass = mass ? scale(bodies.reduce((sum, b) => add(sum, scale(b.centerOfMass, b.mass)), [0, 0, 0] as V3), 1 / mass) : [0, 0, 0] as V3
  const inertia: Matrix = [[0,0,0], [0,0,0], [0,0,0]]
  for (const body of bodies) {
    const d = sub(body.centerOfMass, centerOfMass); const r2 = dot(d, d)
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) inertia[i]![j] = inertia[i]![j]! + body.inertia[i]![j]! + body.mass * ((i === j ? r2 : 0) - d[i]! * d[j]!)
  }
  return { mass, centerOfMass, inertia }
}
