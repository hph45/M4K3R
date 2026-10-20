import { readFileSync } from "node:fs"
import { join } from "node:path"
import { CommandError, findComponent } from "@m4k3r/core"
import { build, buildInput, EspRuntime, ensureEspEmulator, espChipForBoard, firmwareDoc, Pico, Toolchain } from "@m4k3r/firmware"
import { connectProjectRadios } from "../../../../packages/firmware/src/radio"
import { connectProjectI2c } from "../../../../packages/firmware/src/i2c"
import { createCoupledSession, SkidSteer, SkidSteerData, advanceVehicle, type McuRuntime, type SimResult } from "@m4k3r/sim"
import { z } from "zod"
import { tool, type Domain, type DomainContext } from "../domain"

const Arguments = z.object({
  firmware: z.array(z.string()).min(1).max(4).describe("Firmware documents with target MCU components"),
  duration: z.number().positive().max(5).default(0.05), step: z.number().min(1e-6).max(0.001).default(0.00001),
  probes: z.array(z.string()).max(32).default([]),
  inputs: z.array(z.object({ t: z.number().nonnegative(), ref: z.string(), action: z.string(), value: z.union([z.number(), z.string()]).optional() })).default([]),
  vehicle: SkidSteerData.nullable().optional(),
})
export type CoupledArguments = z.infer<typeof Arguments>

export async function runCoupled(context: DomainContext, id: string, args: CoupledArguments) {
  const project = context.store.get(id), toolchain = new Toolchain(context.home), cache = join(context.home, ".cache", "builds")
  if (!project.nets.some((net) => net.name.toUpperCase() === "GND" || net.name === "0")) throw new CommandError('No ground: name the 0 V net "GND" before running firmware + circuit')
  const images: { component: string; platform: string; board: string; bytes: Uint8Array }[] = []
  for (const doc of args.firmware) {
    const data = firmwareDoc(project, doc)
    if (!data.mcu) throw new CommandError(`${doc}: set the target MCU component first`)
    const component = findComponent(project, data.mcu).ref
    if (images.some((image) => image.component === component)) throw new CommandError("Multiple firmware documents target the same MCU")
    const result = await build(toolchain, cache, buildInput(project, doc))
    if (!result.ok) return { ok: false as const, diagnostics: result.diagnostics }
    const artifact = data.platform === "esp32" ? "firmware.merged.bin" : "firmware.uf2"
    if (!result.artifacts.includes(artifact)) throw new CommandError(`${doc}: compiler did not produce the required ${artifact}`)
    images.push({ component, platform: data.platform ?? "rp2040", board: data.board, bytes: readFileSync(join(cache, result.hash, artifact)) })
  }
  const serial: Record<string, Record<string, string>> = {}
  const mcus: { component: string; runtime: McuRuntime & { pins(): unknown; dispose?(): void } }[] = []
  let radioConnections: ReturnType<typeof connectProjectRadios> | undefined
  let i2cConnections: ReturnType<typeof connectProjectI2c> | undefined
  try {
    for (const image of images) {
      const ports: Record<string, string> = {}; serial[image.component] = ports
      if (image.platform === "esp32") {
        const runtime = new EspRuntime(await ensureEspEmulator(context.home), image.bytes, espChipForBoard(image.board))
        runtime.onSerial = (text) => { ports.Serial = `${ports.Serial ?? ""}${text}`.slice(-65536) }
        mcus.push({ component: image.component, runtime })
      } else {
        const runtime = new Pico(image.bytes)
        runtime.onSerial = (port, text) => { ports[port] = `${ports[port] ?? ""}${text}`.slice(-65536) }
        mcus.push({ component: image.component, runtime })
      }
    }
    const picos = mcus.flatMap((mcu) => mcu.runtime instanceof Pico ? [{ component: mcu.component, runtime: mcu.runtime }] : [])
    radioConnections = connectProjectRadios(project, picos)
    i2cConnections = connectProjectI2c(project, picos)
    const session = createCoupledSession(project, mcus, { step: args.step, models: { ...radioConnections.models, ...i2cConnections.models } })
    const vehicle = args.vehicle ? new SkidSteer(args.vehicle) : undefined
    if (radioConnections.radios.length) session.warnings.push("nRF24 virtual medium supports hardware SPI register access, static/dynamic RX payloads, address/channel matching, FIFO/IRQ and basic ACK/MAX_RT. RF timing/loss, ACK payloads, retries over time and bit-banged SPI are not modeled; one radio per MCU SPI bus.")
    if (i2cConnections.sensors.length) session.warnings.push("MPU6050 register model: stationary +Z gravity/zero rotation by default, or planar vehicle yaw. No six-axis flight dynamics, DMP, sensor FIFO, noise or interrupt timing; genuine Pico I²C callbacks execute firmware transactions.")
    if (images.some((image) => image.platform === "esp32")) session.warnings.push("ESP32 coupling executes genuine Espressif machine code with sampled digital GPIO only. ADC input, averaged PWM and external I²C/SPI peripherals are not exposed by this backend adapter; use RP2040 for PWM/ADC coupling.")
  for (const event of args.inputs) session.input(event)
  const probes = args.probes.map((name) => session.probe(name)), time: number[] = [], series = probes.map(() => [] as number[])
  const started = performance.now(), target = args.duration
  let steps = 0, lastYield = started, lastSample = -Infinity
  while (session.t + session.step <= target + session.step * 1e-6 && performance.now() - started < 30000) {
    if (vehicle) for (const entry of i2cConnections.sensors) entry.sensor.setMotion([0, 0, 9.80665], [0, 0, vehicle.state.yawRate])
    if (vehicle) advanceVehicle(session, vehicle, session.step)
    else session.advance(session.step)
    steps++
    if (session.t - lastSample >= Math.max(0.001, target / 500)) {
      time.push(session.t); probes.forEach((probe, index) => series[index]!.push(probe.read())); lastSample = session.t
    }
    if (performance.now() - lastYield > 20) { await new Promise((resolve) => setTimeout(resolve, 0)); lastYield = performance.now() }
  }
  const complete = session.t >= target - session.step
  if (!complete) session.warnings.push("Coupled run reached the 30-second wall-clock budget; returned state is a partial run")
  const result: SimResult = { analysis: "tran", ...session.snapshot(), warnings: session.warnings, waveforms: { time, series: Object.fromEntries(probes.map((probe, index) => [probe.name, series[index]!])) }, stats: { steps, ms: Math.round(performance.now() - started) } }
  return { ok: true as const, complete, result, serial, vehicle: vehicle?.snapshot(), gpio: Object.fromEntries(mcus.map((mcu) => [mcu.component, mcu.runtime.pins()])), sensors: i2cConnections.sensors.map((entry) => ({ component: entry.component, ...entry.sensor.view() })), radios: radioConnections.radios.map((entry) => ({ component: entry.component, ...entry.radio.view() })) }
  } finally { i2cConnections?.dispose(); radioConnections?.dispose(); for (const mcu of mcus) mcu.runtime.dispose?.() }
}

export const coupled: Domain = {
  name: "coupled",
  routes(router, context) {
    router.post("/projects/:id/simulation/coupled", async (request, response) => response.json(await runCoupled(context, request.params.id, Arguments.parse(request.body ?? {}))))
  },
  tools(server, context) {
    server.registerTool("firmware_simulate_circuit", { description: "Build real MCU firmware and execute it in lockstep with the analog circuit. RP2040 bridges GPIO, averaged PWM and ADC feedback. ESP32 uses the official emulator with digital GPIO only; ADC/PWM waveform/peripheral injection are unavailable. Returns serial, GPIO and circuit state.", inputSchema: { project: z.string(), ...Arguments.shape } }, tool(({ project, ...args }: CoupledArguments & { project: string }) => runCoupled(context, project, Arguments.parse(args))))
  },
}
