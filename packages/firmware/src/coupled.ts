import type { Project } from "@m4k3r/core"
import { createCoupledSession, type SessionOptions } from "@m4k3r/sim"
import { Pico, type SerialPort } from "./runner"

/** Runs genuine RP2040 machine code and analog models in lockstep. UF2 images must already be built. */
export function coupledFirmwareSession(project: Project, firmware: { component: string; uf2: Uint8Array }[], options: SessionOptions = {}) {
  const serial: Record<string, Partial<Record<SerialPort, string>>> = {}
  const mcus = firmware.map((image) => {
    const runtime = new Pico(image.uf2)
    serial[image.component] = {}
    runtime.onSerial = (port, text) => {
      const ports = serial[image.component]!
      ports[port] = `${ports[port] ?? ""}${text}`.slice(-65536)
    }
    return { component: image.component, runtime }
  })
  const session = createCoupledSession(project, mcus, options)
  return { session, mcus, serial }
}
