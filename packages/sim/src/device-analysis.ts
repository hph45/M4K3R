import { defineCommand, findDoc, type Project } from "@m4k3r/core"
import { z } from "zod"

const Positive = z.number().positive()
const Point = z.object({ throttle: z.number().min(0).max(1), thrust: z.number().nonnegative(), current: z.number().nonnegative(), rpm: z.number().nonnegative().optional(), torque: z.number().nonnegative().optional() })
export const RotorPerformance = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("coefficients"), ct: Positive, cp: Positive, maxRpm: Positive, referenceVoltage: Positive, efficiency: Positive.max(1).default(0.8), source: z.string().min(1) }),
  z.object({ kind: z.literal("measured"), voltage: Positive, source: z.string().min(1), points: z.array(Point).min(2).max(10000).refine((points) => new Set(points.map((point) => point.throttle)).size === points.length, "Throttle values must be unique").refine((points) => { const sorted = [...points].sort((a, b) => a.throttle - b.throttle); return sorted.every((point, index) => index === 0 || point.thrust >= sorted[index - 1]!.thrust) }, "Use a monotonic increasing thrust curve over the operating region").refine((points) => { const sorted = [...points].sort((a, b) => a.throttle - b.throttle); return sorted.every((point, index) => index === 0 || point.current >= sorted[index - 1]!.current) }, "Use a monotonic increasing current curve over the operating region") }),
])
export const DeviceAnalysisData = z.object({
  assembly: z.string().optional(),
  battery: z.object({ voltage: Positive, capacityAh: Positive, resistance: z.number().nonnegative(), usableFraction: Positive.max(1).default(0.8), voltageMin: Positive.optional(), maxCurrent: Positive.optional() }).optional(),
  addedMass: z.number().nonnegative().default(0).describe("Additional payload/wiring mass in grams, placed at assembly CG"),
  electronicsCurrent: z.number().nonnegative().default(0),
  airDensity: Positive.default(1.225),
  rotors: z.array(z.object({
    component: z.string().min(1).describe("Motor component ref"),
    propeller: z.string().optional().describe("Propeller component ref; defaults to the propeller placed on the motor"),
    diameter: Positive.optional().describe("Override: propeller diameter in mm; defaults to the propeller's diameter prop"),
    direction: z.enum(["cw", "ccw"]).optional().describe("Rotor spin viewed from +local axis toward rotor; airframe reaction torque opposes spin. Defaults to the motor's direction prop, else cw"),
    performance: RotorPerformance.optional().describe("Override: measured curve or explicit coefficients; defaults to propeller ct/cp and motor maxRpm/referenceVoltage/efficiency props"),
  })).refine((rotors) => new Set(rotors.map((rotor) => rotor.component)).size === rotors.length, "Rotor components must be unique").default([]).describe("Empty: every placed motor (a component with a kv or maxRpm prop, or a part named motor) is a rotor"),
})
export type DeviceAnalysisData = z.infer<typeof DeviceAnalysisData>
export type RotorPerformance = z.infer<typeof RotorPerformance>
export type Vector3 = [number, number, number]
export interface AircraftGeometry {
  mass: number
  centerOfMass: Vector3
  inertia: number[][]
  rotors: Record<string, { center: Vector3; axis: Vector3 }>
  obstacles: { ref: string; min: Vector3; max: Vector3 }[]
  warnings: string[]
  mechanicalConflicts?: string[]
  missingMass?: string[]
}
export interface RotorOperatingPoint { component: string; thrust: number; verticalThrust: number; current: number; rpm: number | null; torque: number | null; source: string; estimated: boolean }
export interface AircraftOperatingPoint { throttle: number; voltage: number; current: number; power: number; thrust: number; verticalThrust: number; runtimeMinutes: number; rotors: RotorOperatingPoint[]; moment: Vector3 }
export interface DeviceAnalysisResult {
  status: "missing-data" | "insufficient-thrust" | "power-limited" | "mechanical-conflict" | "theoretical-hover"
  mass: number; assemblyMass: number; addedMass: number; massComplete: boolean; missingMass: string[]; inputComplete: boolean; mechanicalConflict: boolean; centerOfMass: Vector3; inertia: number[][]; weight: number
  thrustToWeight: number | null; maximum: AircraftOperatingPoint | null; rawMaximum: AircraftOperatingPoint | null; hover: AircraftOperatingPoint | null
  clearance: { kind: "rotor-rotor" | "rotor-body"; a: string; b: string; gap: number }[]
  rotors: { component: string; propeller?: string; diameter?: number; direction?: "cw" | "ccw"; source: string | null }[]
  missing: string[]; warnings: string[]; assumptions: string[]
  /** Refs whose mass is an estimate; reported as one grouped warning. */
  estimatedMass: string[]
}

export const deviceStatusLabel: Record<DeviceAnalysisResult["status"], string> = { "missing-data": "More data required", "insufficient-thrust": "Insufficient static thrust", "power-limited": "Battery operating limit exceeded", "mechanical-conflict": "Assembly or propeller clearance conflict", "theoretical-hover": "Theoretical static hover possible" }

export const grams = (newtons: number) => newtons / 9.80665 * 1000

const positive = (value: string | undefined) => { const number = value === undefined ? NaN : parseFloat(value); return number > 0 ? number : undefined }

/**
 * Fill each rotor from its placed motor and propeller parts; explicit document fields win.
 * An empty rotor list means every placed motor. Missing part data stays missing; nothing is inferred from kV.
 */
export function resolveRotors(project: Project, data: DeviceAnalysisData, placed: Record<string, Vector3> = {}): DeviceAnalysisData {
  const props = (component: Project["components"][number]) => ({ ...project.parts[component.part]?.props, ...component.props })
  const find = (ref: string) => project.components.find((component) => component.ref === ref || component.id === ref)
  const isMotor = (component: Project["components"][number]) => { const values = props(component); return values.kv !== undefined || values.maxRpm !== undefined || /\bmotor\b/i.test(project.parts[component.part]?.name ?? "") }
  const isPropeller = (component: Project["components"][number]) => props(component).ct !== undefined || project.parts[component.part]?.physical?.geometry.type === "propeller"
  const listed: DeviceAnalysisData["rotors"] = data.rotors.length ? data.rotors : project.components.filter((component) => isMotor(component) && placed[component.ref]).map((component) => ({ component: component.ref }))
  const claimed = new Set(listed.flatMap((rotor) => rotor.propeller ? [find(rotor.propeller)?.ref ?? rotor.propeller] : []))
  const rotors = listed.map((rotor) => {
    const motor = find(rotor.component), center = motor && placed[motor.ref]
    let propeller = rotor.propeller ? find(rotor.propeller) : undefined
    if (!rotor.propeller && center) {
      // A propeller sits on its motor's axis: take the nearest unclaimed one within 20 mm horizontally.
      const distance = (ref: string) => Math.hypot(placed[ref]![0] - center[0], placed[ref]![1] - center[1])
      propeller = project.components.filter((component) => isPropeller(component) && placed[component.ref] && !claimed.has(component.ref) && distance(component.ref) < 20).sort((a, b) => distance(a.ref) - distance(b.ref))[0]
      if (propeller) claimed.add(propeller.ref)
    }
    const motorProps = motor ? props(motor) : {}, propProps = propeller ? props(propeller) : {}
    const ct = positive(propProps.ct), cp = positive(propProps.cp), maxRpm = positive(motorProps.maxRpm), referenceVoltage = positive(motorProps.referenceVoltage), efficiency = positive(motorProps.efficiency)
    const label = (component: Project["components"][number], values: Record<string, string>) => `${project.parts[component.part]?.name ?? component.part}: ${values.dataSource?.replace(/\.$/, "") ?? "no data source given"}`
    const performance = rotor.performance ?? (motor && propeller && ct && cp && maxRpm && referenceVoltage ? {
      kind: "coefficients" as const, ct, cp, maxRpm, referenceVoltage, efficiency: efficiency && efficiency <= 1 ? efficiency : 0.8,
      source: `${label(propeller, propProps)}; ${label(motor, motorProps)}${efficiency && efficiency <= 1 ? "" : "; 80% drive efficiency assumed"}`,
    } : undefined)
    const direction = rotor.direction ?? (["cw", "ccw"].includes(motorProps.direction!) ? motorProps.direction as "cw" | "ccw" : undefined)
    return { component: motor?.ref ?? rotor.component, propeller: propeller?.ref ?? rotor.propeller, diameter: rotor.diameter ?? positive(propProps.diameter), direction, performance }
  })
  return { ...data, rotors }
}

export interface PropulsionPoint { voltage: number; current: number; power: number; rotors: Omit<RotorOperatingPoint, "verticalThrust">[] }

/** Shared electrical operating point for static feasibility and rigid-body preview. */
export function propulsionPoint(data: DeviceAnalysisData, throttles: number[]): PropulsionPoint {
  const battery = data.battery
  if (!battery || data.rotors.some((rotor) => !rotor.performance || !rotor.diameter)) throw new Error("Battery, rotor diameter and rotor performance data are required")
  const load = (voltage: number) => data.rotors.map((rotor, index) => ({ component: rotor.component, ...rotorPerformance(rotor.performance!, rotor.diameter!, throttles[index] ?? 0, voltage, data.airDensity), source: rotor.performance!.source, estimated: rotor.performance!.kind === "coefficients" }))
  let lo = 0, hi = battery.voltage
  for (let iteration = 0; iteration < 50; iteration++) {
    const voltage = (lo + hi) / 2, current = data.electronicsCurrent + load(voltage).reduce((sum, rotor) => sum + rotor.current, 0)
    if (voltage + current * battery.resistance > battery.voltage) hi = voltage
    else lo = voltage
  }
  const voltage = (lo + hi) / 2, rotors = load(voltage), current = data.electronicsCurrent + rotors.reduce((sum, rotor) => sum + rotor.current, 0)
  return { voltage, current, power: voltage * current, rotors }
}

export const withinBatteryLimits = (data: DeviceAnalysisData, point: PropulsionPoint) => !!data.battery && point.voltage >= Math.max(data.battery.voltageMin ?? 0, data.battery.voltage * 0.5) - 1e-9 && (data.battery.maxCurrent === undefined || point.current <= data.battery.maxCurrent + 1e-9)

export function limitedPropulsionPoint(data: DeviceAnalysisData, throttles: number[]) {
  const requested = propulsionPoint(data, throttles)
  if (withinBatteryLimits(data, requested)) return { point: requested, scale: 1, viable: true }
  const idle = propulsionPoint(data, throttles.map(() => 0))
  if (!withinBatteryLimits(data, idle)) return { point: idle, scale: 0, viable: false }
  let lo = 0, hi = 1
  for (let iteration = 0; iteration < 40; iteration++) {
    const scale = (lo + hi) / 2
    if (withinBatteryLimits(data, propulsionPoint(data, throttles.map((value) => value * scale)))) lo = scale
    else hi = scale
  }
  return { point: propulsionPoint(data, throttles.map((value) => value * lo)), scale: lo, viable: true }
}

export function rotorPerformance(performance: RotorPerformance, diameter: number, throttle: number, voltage: number, density = 1.225) {
  throttle = Math.max(0, Math.min(1, throttle))
  if (performance.kind === "coefficients") {
    const rpm = performance.maxRpm * throttle * voltage / performance.referenceVoltage
    const n = rpm / 60, d = diameter / 1000
    const thrust = performance.ct * density * n * n * d ** 4
    const shaftPower = performance.cp * density * n ** 3 * d ** 5
    return { thrust, current: voltage > 1e-9 ? shaftPower / performance.efficiency / voltage : 0, rpm, torque: n > 0 ? shaftPower / (2 * Math.PI * n) : 0 }
  }
  const points = [...performance.points].sort((a, b) => a.throttle - b.throttle)
  const upper = points.find((point) => point.throttle >= throttle) ?? points.at(-1)!
  const lower = [...points].reverse().find((point) => point.throttle <= throttle) ?? points[0]!
  const mix = upper.throttle === lower.throttle ? 0 : (throttle - lower.throttle) / (upper.throttle - lower.throttle)
  const value = (key: "thrust" | "current" | "rpm" | "torque") => lower[key] === undefined || upper[key] === undefined ? null : lower[key]! + mix * (upper[key]! - lower[key]!)
  return { thrust: value("thrust")!, current: value("current")!, rpm: value("rpm"), torque: value("torque") }
}

export function analyzeDevice(data: DeviceAnalysisData, geometry: AircraftGeometry): DeviceAnalysisResult {
  const mass = geometry.mass + data.addedMass, weight = mass / 1000 * 9.80665
  const estimate = /^(.+): mass is an estimate$/, estimatedMass = geometry.warnings.flatMap((warning) => estimate.exec(warning)?.[1] ?? [])
  const missing: string[] = [], warnings = geometry.warnings.filter((warning) => !estimate.test(warning))
  warnings.push(...(geometry.mechanicalConflicts ?? []))
  const missingMass = geometry.missingMass ?? geometry.warnings.filter((warning) => /mass.*unknown|unknown.*mass|excluded from mass/i.test(warning))
  if (missingMass.length) missing.push("Assembly contains unknown/excluded masses; total flying mass is incomplete", ...missingMass)
  const assumptions = ["Static, level, sea-level-density thrust model; no aerodynamic interaction, ground effect, vibration, controller stability or structural certification.", "Hover uses the same throttle on all rotors. A flight controller must trim moments; this analysis does not prove a controllable or safe aircraft.", "Battery uses a constant open-circuit voltage and internal resistance; runtime is usable charge/current, without a full discharge/thermal model."]
  assumptions.push("Clearance is a horizontal rotor-disc/AABB envelope check with 2 mm body-plane tolerance; tilted props and detailed mesh clearance require mechanical validation. Additional payload mass is treated as a point at assembly CG.")
  if (!(mass > 0)) missing.push("Assembly/payload mass")
  if (!data.battery) missing.push("Battery voltage, capacity and internal resistance")
  if (!data.rotors.length) missing.push("Rotors: place motors in the linked assembly, or list rotor components")
  const sources = new Map<string, string[]>()
  const note = (component: string, text: string) => sources.set(text, [...sources.get(text) ?? [], component])
  for (const rotor of data.rotors) {
    if (!geometry.rotors[rotor.component]) missing.push(`${rotor.component}: assembly placement and rotor axis`)
    if (!rotor.diameter) missing.push(`${rotor.component}: propeller diameter (diameter prop on the propeller, or a rotor override)`)
    if (!rotor.performance) missing.push(`${rotor.component}: performance data. Set ct and cp on the propeller and maxRpm and referenceVoltage on the motor, or add a measured thrust/current curve (kV alone is insufficient)`)
    if (!rotor.direction) warnings.push(`${rotor.component}: spin direction is not set; clockwise assumed`)
    if (rotor.performance?.kind === "coefficients") note(rotor.component, `estimated from explicit Ct=${rotor.performance.ct}, Cp=${rotor.performance.cp}, ${rotor.performance.maxRpm} RPM at ${rotor.performance.referenceVoltage} V; ${rotor.performance.source}. RPM scales linearly with voltage and throttle.`)
    if (rotor.performance?.kind === "measured") {
      note(rotor.component, `measured curve at ${rotor.performance.voltage} V; ${rotor.performance.source}. No voltage correction or extrapolation is assumed.`)
      const points = rotor.performance.points
      if (!points.some((point) => point.throttle === 0) || !points.some((point) => point.throttle === 1)) missing.push(`${rotor.component}: measured curve must cover throttle 0 to 1`)
      if (points.some((point) => point.torque === undefined)) warnings.push(`${rotor.component}: reaction torque is unavailable in measured data; yaw moment is incomplete`)
    }
  }
  for (const [text, components] of sources) assumptions.push(`${components.join(", ")}: ${text}`)
  const clearance: DeviceAnalysisResult["clearance"] = []
  for (let i = 0; i < data.rotors.length; i++) {
    const rotor = data.rotors[i]!, pose = geometry.rotors[rotor.component]
    if (!pose || !rotor.diameter) continue
    if (pose.axis[2] < 0.95) warnings.push(`${rotor.component}: rotor axis is tilted or reversed; only its upward thrust contributes to hover`)
    for (const other of data.rotors.slice(i + 1)) {
      const second = geometry.rotors[other.component]
      if (!second || !other.diameter) continue
      const dz = Math.abs(pose.center[2] - second.center[2])
      const gap = Math.hypot(pose.center[0] - second.center[0], pose.center[1] - second.center[1]) - (rotor.diameter + other.diameter) / 2
      if (dz < 10) clearance.push({ kind: "rotor-rotor", a: rotor.component, b: other.component, gap })
    }
    for (const obstacle of geometry.obstacles) {
      if ([rotor.component, rotor.propeller].includes(obstacle.ref)) continue
      if (pose.center[2] < obstacle.min[2] - 2 || pose.center[2] > obstacle.max[2] + 2) continue
      const dx = Math.max(obstacle.min[0] - pose.center[0], 0, pose.center[0] - obstacle.max[0])
      const dy = Math.max(obstacle.min[1] - pose.center[1], 0, pose.center[1] - obstacle.max[1])
      clearance.push({ kind: "rotor-body", a: rotor.component, b: obstacle.ref, gap: Math.hypot(dx, dy) - rotor.diameter / 2 })
    }
  }
  for (const check of clearance.filter((check) => check.gap < 0)) warnings.push(`${check.a} / ${check.b}: propeller envelope overlaps by ${(-check.gap).toFixed(1)} mm`)
  const mechanicalConflict = !!geometry.mechanicalConflicts?.length || clearance.some((check) => check.gap < 0)
  const rotors = data.rotors.map(({ component, propeller, diameter, direction, performance }) => ({ component, propeller, diameter, direction, source: performance?.source ?? null }))
  const base = { mass, assemblyMass: geometry.mass, addedMass: data.addedMass, rotors, estimatedMass, massComplete: !missingMass.length && geometry.mass > 0, missingMass, inputComplete: !missing.length, mechanicalConflict, centerOfMass: geometry.centerOfMass, inertia: geometry.inertia, weight, clearance, missing, warnings, assumptions }
  // Grouped last, so specific checks come first.
  const estimated = () => { if (estimatedMass.length) warnings.push(`${estimatedMass.length} part${estimatedMass.length === 1 ? " uses" : "s use"} estimated mass`) }
  if (missing.length) { estimated(); return { ...base, status: "missing-data", thrustToWeight: null, maximum: null, rawMaximum: null, hover: null } }
  const battery = data.battery!
  function operating(throttle: number): AircraftOperatingPoint {
    const powerPoint = propulsionPoint(data, data.rotors.map(() => throttle))
    const { voltage, current } = powerPoint
    const rotors: RotorOperatingPoint[] = powerPoint.rotors.map((rotor) => ({ ...rotor, verticalThrust: rotor.thrust * geometry.rotors[rotor.component]!.axis[2] }))
    const moment: Vector3 = [0, 0, 0]
    for (const rotor of rotors) {
      const pose = geometry.rotors[rotor.component]!, spec = data.rotors.find((value) => value.component === rotor.component)!
      const r = pose.center.map((value, axis) => (value - geometry.centerOfMass[axis]!) / 1000)
      const f = pose.axis.map((value) => value * rotor.thrust)
      moment[0] += r[1]! * f[2]! - r[2]! * f[1]!
      moment[1] += r[2]! * f[0]! - r[0]! * f[2]!
      moment[2] += r[0]! * f[1]! - r[1]! * f[0]!
      // Viewed from +axis toward rotor: CW spin is -axis, so airframe reaction is +axis.
      const spin = spec.direction === "ccw" ? -1 : 1
      for (let axis = 0; axis < 3; axis++) moment[axis]! += pose.axis[axis]! * (rotor.torque ?? 0) * spin
    }
    return { throttle, voltage, current, power: voltage * current, thrust: rotors.reduce((sum, rotor) => sum + rotor.thrust, 0), verticalThrust: rotors.reduce((sum, rotor) => sum + rotor.verticalThrust, 0), runtimeMinutes: current > 0 ? battery.capacityAh * battery.usableFraction / current * 60 : 0, rotors, moment }
  }
  const rawMaximum = operating(1)
  const usable = (point: AircraftOperatingPoint) => point.voltage >= Math.max(battery.voltageMin ?? 0, battery.voltage * 0.5) && (battery.maxCurrent === undefined || point.current <= battery.maxCurrent)
  let maximumThrottle = 1
  if (!usable(rawMaximum)) {
    let lo = 0, hi = 1
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (usable(operating(mid))) lo = mid; else hi = mid }
    maximumThrottle = lo
    warnings.push(`Full throttle is outside battery limits: ${rawMaximum.voltage.toFixed(2)} V, ${rawMaximum.current.toFixed(2)} A. Maximum usable collective throttle is ${(maximumThrottle * 100).toFixed(1)}%.`)
  }
  const maximum = operating(maximumThrottle), thrustToWeight = maximum.verticalThrust / weight
  let hover: AircraftOperatingPoint | null = null
  if (thrustToWeight >= 1) {
    let lo = 0, hi = maximumThrottle
    for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (operating(mid).verticalThrust > weight) hi = mid; else lo = mid }
    hover = operating((lo + hi) / 2)
    if (Math.hypot(...hover.moment) > weight * 0.01) warnings.push("Collective hover leaves a significant moment about the assembly CG; rotor mixing/placement must be checked")
  }
  const operatingPoint = hover ?? maximum
  let powerLimited = !usable(operatingPoint) || thrustToWeight < 1 && rawMaximum.verticalThrust >= weight && maximumThrottle < 1
  if (operatingPoint.voltage < battery.voltage * 0.5) { powerLimited = true; warnings.push("Battery voltage collapses below half open-circuit voltage; the specified operating point is outside a useful battery power envelope") }
  if (battery.maxCurrent !== undefined && operatingPoint.current > battery.maxCurrent) { powerLimited = true; warnings.push("Required current exceeds the specified battery continuous-current limit") }
  if (battery.voltageMin !== undefined && operatingPoint.voltage < battery.voltageMin) { powerLimited = true; warnings.push("Loaded battery voltage is below the specified minimum") }
  const validated = (point: AircraftOperatingPoint, label: string) => {
    const invalid = data.rotors.filter((rotor) => rotor.performance?.kind === "measured" && Math.abs(point.voltage / rotor.performance.voltage - 1) > 0.05)
    for (const rotor of invalid) warnings.push(`${rotor.component}: ${label} loaded voltage differs by more than 5% from measured curve voltage; thrust/current estimates are not validated at this voltage`)
    return !invalid.length
  }
  const maximumValidated = validated(maximum, "maximum"), hoverValidated = hover ? validated(hover, "hover") : true
  if (!hoverValidated || !hover && !maximumValidated) missing.push("Measured performance curve validated near the required loaded battery voltage")
  estimated()
  return { ...base, status: missing.length ? "missing-data" : mechanicalConflict ? "mechanical-conflict" : powerLimited ? "power-limited" : thrustToWeight < 1 ? "insufficient-thrust" : "theoretical-hover", thrustToWeight: maximumValidated ? thrustToWeight : null, maximum: maximumValidated ? maximum : null, rawMaximum, hover: hoverValidated ? hover : null }
}

/** Short plain-text report: headline numbers first, then missing data and grouped checks. */
export function deviceAnalysisSummary(result: DeviceAnalysisResult) {
  const n = (value: number, digits = 1) => value.toFixed(digits), force = (newtons: number) => `${n(grams(newtons), 0)} g (${n(newtons, 2)} N)`
  const lines = [`${deviceStatusLabel[result.status]} (static estimate, not flight validation)`]
  lines.push(`Mass: ${n(result.mass)} g${result.addedMass ? ` (${n(result.assemblyMass)} g assembly + ${n(result.addedMass)} g payload)` : ""}${result.massComplete ? "" : ", incomplete"}`)
  if (result.thrustToWeight !== null) lines.push(`Thrust/weight: ${n(result.thrustToWeight, 2)}×`)
  if (result.maximum) lines.push(`Max usable thrust: ${force(result.maximum.verticalThrust)} at ${n(result.maximum.throttle * 100)}% collective${result.maximum.throttle < 1 ? ", battery-limited" : ""}`)
  else if (result.rawMaximum) lines.push(`Max usable thrust: not validated (full throttle would give ${force(result.rawMaximum.verticalThrust)})`)
  if (result.hover) lines.push(`Hover: ${n(result.hover.throttle * 100)}% throttle, ${n(result.hover.current, 2)} A at ${n(result.hover.voltage, 2)} V, ${n(result.hover.runtimeMinutes)} min runtime`)
  const point = result.hover ?? result.maximum
  const estimated = point?.rotors.every((rotor) => rotor.estimated)
  if (point) lines.push(`Rotors at ${result.hover ? "hover" : "max"}${estimated ? " (estimated)" : ""}: ${point.rotors.map((rotor) => `${rotor.component} ${force(rotor.thrust)}, ${n(rotor.current, 2)} A${rotor.rpm === null ? "" : `, ${n(rotor.rpm, 0)} rpm`}${rotor.estimated && !estimated ? " est." : ""}`).join("; ")}`)
  const sources = [...new Set(result.rotors.flatMap((rotor) => rotor.source ?? []))]
  if (sources.length) lines.push(`Rotor data: ${sources.join(" | ")}`)
  if (result.missing.length) lines.push(`Missing data (${result.missing.length}):`, ...result.missing.map((message) => `- ${message}`))
  if (result.warnings.length) lines.push(`Checks (${result.warnings.length}):`, ...result.warnings.map((message) => `- ${message}`))
  return lines.join("\n")
}

export const deviceAnalysisCommands = [defineCommand({
  type: "device.analysis.set", summary: "Set drone/device feasibility inputs, including assembly link and sourced rotor thrust/current data", args: z.object({ doc: z.string(), data: DeviceAnalysisData }),
  run(project, { doc, data }) { findDoc(project, doc, "device-analysis").data = data },
})]
export const deviceAnalysisDoc = (project: Project, doc: string) => DeviceAnalysisData.parse(findDoc(project, doc, "device-analysis").data)
