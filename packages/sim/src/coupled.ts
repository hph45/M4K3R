import { findComponent, partOf, type Project } from "@m4k3r/core"
import type { ModelFactory } from "./model"
import { createSession, type SessionOptions } from "./session"

/** Implemented by the real RP2040 runtime. Other MCU backends must implement real execution. */
export interface McuRuntime {
  step(nanos: number): void
  pin(gpio: number): { state: string; function: string }
  setInput(gpio: number, high: boolean | null): void
  setAnalogInput?(gpio: number, voltage: number): void
  /** Mean high fraction during the most recently executed slice, for PWM averaging. */
  outputDuty?(gpio: number): number
}
export interface McuBinding { component: string; runtime: McuRuntime; voltage?: number; outputResistance?: number }

export function createCoupledSession(project: Project, bindings: McuBinding[], options: SessionOptions = {}) {
  const overrides: Record<string, ModelFactory> = { ...options.models }
  for (const binding of bindings) {
    const component = findComponent(project, binding.component)
    const pins = partOf(project, component).pins.flatMap((pin) => {
      const match = [pin.name, ...(pin.functions ?? [])].map((name) => /^GP(?:IO)?(\d+)$/i.exec(name)).find(Boolean)
      return match ? [{ name: pin.name, gpio: Number(match[1]) }] : []
    })
    const runtime = binding.runtime, voltage = binding.voltage ?? 3.3, resistance = binding.outputResistance ?? 30
    overrides[component.id] = (ctx) => {
      const pads = pins.map((pin) => ({ ...pin, node: ctx.pin(pin.name), high: false }))
      let outputs: { node: number; volts: number; conductance: number }[] = []
      return {
        beforeStep(_t, dt) {
          runtime.step(dt * 1e9)
          outputs = pads.flatMap((pad) => {
            const state = runtime.pin(pad.gpio)
            if (state.state === "high" || state.state === "low") {
              const duty = state.function === "pwm" ? runtime.outputDuty?.(pad.gpio) : undefined
              return [{ node: pad.node, volts: duty === undefined ? state.state === "high" ? voltage : 0 : duty * voltage, conductance: 1 / resistance }]
            }
            if (state.state === "pullup" || state.state === "pulldown") return [{ node: pad.node, volts: state.state === "pullup" ? voltage : 0, conductance: 1 / 50000 }]
            return []
          })
        },
        stamp(stamper) {
          for (const output of outputs) {
            stamper.conductance(output.node, -1, output.conductance)
            stamper.current(-1, output.node, output.volts * output.conductance)
          }
        },
        step() {
          for (const pad of pads) {
            const volts = ctx.v(pad.node)
            if (volts >= voltage * 0.7) pad.high = true
            else if (volts <= voltage * 0.3) pad.high = false
            runtime.setInput(pad.gpio, pad.high)
            runtime.setAnalogInput?.(pad.gpio, Math.max(0, Math.min(voltage, volts)))
          }
        },
        view: () => Object.fromEntries(pads.map((pad) => [`GP${pad.gpio}`, ctx.v(pad.node)])),
        current: () => outputs.reduce((sum, output) => sum + (output.volts - ctx.v(output.node)) * output.conductance, 0),
      }
    }
  }
  const session = createSession(project, { ...options, models: overrides })
  session.warnings.push("MCU bridge: fixed 3.3 V logic by default, 30 Ω output resistance, 50 kΩ pulls, 0.3/0.7 VDD input thresholds. PWM averaged per analog step; bus/peripheral device emulation requires a backend adapter.")
  return session
}
