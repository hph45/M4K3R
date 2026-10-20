import { SimError, type ModelFactory } from "../model"

export const regulator: ModelFactory = (ctx) => {
  const input = ctx.pin("IN"), output = ctx.pin("OUT"), ground = ctx.pin("GND")
  const voltage = ctx.num("voltage", 3.3), dropout = ctx.num("dropout", 0.2), maximum = ctx.num("maxCurrent", 1)
  const efficiency = ctx.num("efficiency", 0.85), resistance = ctx.num("resistance", 0.05), idle = ctx.num("quiescentCurrent", 0.001)
  let current = 0, limited = false
  return { nonlinear: true,
    stamp(s) {
      const vin = Math.max(0, ctx.v(input) - ctx.v(ground)), out = ctx.v(output) - ctx.v(ground)
      const target = Math.max(0, Math.min(voltage, vin - dropout))
      const requested = (target - out) / resistance
      limited = requested > maximum
      current = Math.max(0, Math.min(maximum, requested))
      if (!limited) { s.conductance(output, ground, 1 / resistance); s.current(ground, output, target / resistance) }
      else if (limited) s.current(ground, output, maximum)
      s.current(input, ground, vin > 0.1 ? Math.max(0, out) * current / (vin * efficiency) + idle : 0)
    }, current: () => current, view: () => ({ voltage: ctx.v(output) - ctx.v(ground), current, limited }) }
}

export const hBridge: ModelFactory = (ctx) => {
  const supply = ctx.pin("VM"), ground = ctx.pin("GND"), a = ctx.pin("OUT1"), b = ctx.pin("OUT2"), in1 = ctx.pin("IN1"), in2 = ctx.pin("IN2")
  const g = 1 / ctx.num("ron", 0.2), threshold = ctx.num("threshold", 1.5), maximum = ctx.num("maxCurrent", 3)
  let mode = "coast", current = 0, fault = false
  return { nonlinear: true,
    stamp(s) {
      const high1 = ctx.v(in1) - ctx.v(ground) > threshold, high2 = ctx.v(in2) - ctx.v(ground) > threshold
      mode = fault || (!high1 && !high2) ? "coast" : high1 && high2 ? "brake" : high1 ? "forward" : "reverse"
      current = 0
      if (mode === "forward") { s.conductance(supply, a, g); s.conductance(b, ground, g); current = (ctx.v(supply) - ctx.v(a)) * g }
      if (mode === "reverse") { s.conductance(supply, b, g); s.conductance(a, ground, g); current = (ctx.v(supply) - ctx.v(b)) * g }
      if (mode === "brake") { s.conductance(a, ground, g); s.conductance(b, ground, g) }
    },
    step() { if (Math.abs(current) > maximum) fault = true }, current: () => current, view: () => ({ mode, current, fault }),
    input(event) { if (event.action !== "reset") throw new SimError(`${ctx.ref}: action is reset`); fault = false },
  }
}

/** Behavioral ESC + motor + propeller. Ct/Cp are explicit inputs, never derived from motor kV. */
export const escPropeller: ModelFactory = (ctx) => {
  const supply = ctx.pin("VBAT"), ground = ctx.pin("GND"), signal = ctx.pin("SIGNAL")
  const diameter = ctx.num("diameter") / 1000, ct = ctx.num("ct"), cp = ctx.num("cp"), fullRpm = ctx.num("fullRpm")
  const reference = ctx.num("voltage", 12), efficiency = ctx.num("efficiency", 0.8), density = ctx.num("airDensity", 1.225), tau = ctx.num("spinupTime", 0.05)
  const low = ctx.num("signalLow", 0), high = ctx.num("signalHigh", 3.3)
  const signalMode = ctx.str("signalMode", "average")!
  const minimumPulse = ctx.num("minPulse", 0.001), maximumPulse = ctx.num("maxPulse", 0.002)
  let rpm = 0, thrust = 0, torque = 0, current = 0, throttle = 0
  let reportedRpm = 0
  let signalHigh = false, rise = 0, pulseWidth = 0, lastPulse = -Infinity
  if (!["average", "servo"].includes(signalMode) || maximumPulse <= minimumPulse) throw new SimError(`${ctx.ref}: signalMode is average or servo; maxPulse must exceed minPulse`)
  if (!(diameter > 0 && ct > 0 && cp > 0 && fullRpm > 0 && reference > 0 && efficiency > 0 && efficiency <= 1 && tau > 0 && high > low)) throw new SimError(`${ctx.ref}: ESC needs positive diameter, explicit Ct/Cp, rpm/voltage, spin-up time and efficiency in (0,1]`)
  return { nonlinear: true,
    stamp(s) {
      const voltage = Math.max(0, ctx.v(supply) - ctx.v(ground))
      if (signalMode === "average") throttle = Math.max(0, Math.min(1, (ctx.v(signal) - ctx.v(ground) - low) / (high - low)))
      const target = fullRpm * throttle * voltage / reference
      const next = s.dt === Infinity ? target : (rpm + target * s.dt / tau) / (1 + s.dt / tau)
      reportedRpm = next
      const n = next / 60
      thrust = ct * density * n * n * diameter ** 4
      const power = cp * density * n ** 3 * diameter ** 5
      torque = n > 0 ? power / (2 * Math.PI * n) : 0
      current = voltage > 0.1 ? power / efficiency / voltage : 0
      s.current(supply, ground, current)
    },
    step(t, dt) {
      if (signalMode === "servo") {
        const nextHigh = ctx.v(signal) - ctx.v(ground) > (high + low) / 2
        if (nextHigh && !signalHigh) rise = t
        if (!nextHigh && signalHigh) {
          pulseWidth = t - rise; lastPulse = t
          throttle = pulseWidth >= minimumPulse * 0.8 && pulseWidth <= maximumPulse * 1.2 ? Math.max(0, Math.min(1, (pulseWidth - minimumPulse) / (maximumPulse - minimumPulse))) : 0
        }
        signalHigh = nextHigh
        if (t - lastPulse > 0.1) throttle = 0
      }
      const target = fullRpm * throttle * Math.max(0, ctx.v(supply) - ctx.v(ground)) / reference
      rpm = (rpm + target * dt / tau) / (1 + dt / tau)
    },
    current: () => current, view: () => ({ rpm: reportedRpm, thrust, torque, current, throttle, pulseWidth, signalMode, estimated: true }),
  }
}
