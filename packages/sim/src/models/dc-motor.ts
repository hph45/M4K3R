import { SimError, type ModelFactory } from "../model"

/**
 * V = iR + L di/dt + Kₑω and J dω/dt = Kₜi − bω − τ_load, solved together (implicitly) each step.
 * R, Kₑ = Kₜ and b come from the rated voltage, no-load speed, stall current and no-load current.
 */
export const dcMotor: ModelFactory = (ctx) => {
  const a = ctx.pin("1")
  const b = ctx.pin("2")
  const v = ctx.num("voltage", 6)
  const w0 = (ctx.num("noLoadRpm", 300) * 2 * Math.PI) / 60
  const stall = ctx.num("stallCurrent", 1)
  const i0 = Math.max(ctx.num("noLoadCurrent", 0.05 * stall), 1e-3 * stall)
  const r = v / stall
  const ke = (v - i0 * r) / w0
  const friction = (ke * i0) / w0
  const l = ctx.num("inductance", r * 1e-4) // electrical time constant ≈ 0.1 ms
  const j = ctx.num("inertia", (0.02 * ke * ke) / r) // mechanical time constant ≈ 20 ms
  const load = ctx.num("loadTorque", 0) // N·m, opposing forward rotation
  const k = ctx.branch(`I(${ctx.ref})`)
  let dt = Infinity
  let w = 0
  let i = 0
  let externalSpeed: number | undefined
  // ω at the end of this step for a given current; the steady state when dt = Infinity
  const speed = (current: number) => ((j / dt) * w + ke * current - load) / (j / dt + friction)
  return {
    stamp(s) {
      dt = s.dt
      if (externalSpeed !== undefined) {
        s.voltage(k, a, b, ke * externalSpeed - (l / dt) * i)
        s.add(k, k, -(r + l / dt))
        return
      }
      const den = j / dt + friction
      s.voltage(k, a, b, (ke * ((j / dt) * w - load)) / den - (l / dt) * i)
      s.add(k, k, -(r + l / dt + (ke * ke) / den))
    },
    step() {
      i = ctx.v(k)
      w = externalSpeed ?? speed(i)
    },
    current: () => ctx.v(k),
    view: () => ({ rpm: ((externalSpeed ?? (dt === Infinity ? speed(ctx.v(k)) : w)) * 60) / (2 * Math.PI), current: ctx.v(k), torque: ke * ctx.v(k) - friction * w - load }),
    input(event) {
      if (event.action === "free-shaft") { externalSpeed = undefined; return }
      if (event.action !== "shaft-speed" || typeof event.value !== "number" || !Number.isFinite(event.value)) throw new SimError(`${ctx.ref}: shaft-speed requires an angular velocity in rad/s`)
      externalSpeed = event.value
    },
  }
}
