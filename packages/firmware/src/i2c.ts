import { findComponent, partOf, type Project } from "@m4k3r/core"
import { Mpu6050, type I2cDevice, type ModelFactory } from "@m4k3r/sim"
import { gpioOf } from "./pins"
import { Pico } from "./runner"

/** Attach devices to the genuine rp2040js I²C peripheral callbacks. */
export function attachPicoI2c(pico: Pico, port: number, devices: Map<number, I2cDevice>, pins?: { sda: number; scl: number }) {
  const bus = pico.mcu.i2c[port]
  if (!bus) throw new Error(`No RP2040 I2C${port}`)
  const previous = { onStart: bus.onStart, onConnect: bus.onConnect, onWriteByte: bus.onWriteByte, onReadByte: bus.onReadByte, onStop: bus.onStop }
  let active: I2cDevice | undefined
  bus.onStart = () => bus.completeStart()
  bus.onConnect = (address, mode) => { active = !pins || [pins.sda, pins.scl].every((gpio) => pico.pin(gpio).function === "i2c") ? devices.get(address) : undefined; active?.start(mode === 1); bus.completeConnect(!!active) }
  bus.onWriteByte = (value) => bus.completeWrite(active?.write(value) ?? false)
  bus.onReadByte = () => bus.completeRead(active?.read() ?? 0xff)
  bus.onStop = () => { active?.stop(); active = undefined; bus.completeStop() }
  return () => Object.assign(bus, previous)
}

export function connectProjectI2c(project: Project, mcus: { component: string; runtime: Pico }[]) {
  const sensors: { component: string; sensor: Mpu6050 }[] = [], models: Record<string, ModelFactory> = {}, disposers: (() => void)[] = []
  const buses = new Map<string, { pico: Pico; port: number; sda: number; scl: number; devices: Map<number, I2cDevice> }>()
  for (const component of project.components.filter((component) => /mpu6050/i.test(component.part) || component.props.sensorModel === "mpu6050")) {
    const part = partOf(project, component)
    for (const binding of mcus) {
      const owner = findComponent(project, binding.component), definition = partOf(project, owner)
      const gpio = (name: string) => {
        const pin = part.pins.find((pin) => pin.name.toUpperCase() === name)
        const net = pin && project.nets.find((net) => net.pins.some((ref) => ref.component === component.id && ref.pin === pin.num))
        const peer = net?.pins.find((ref) => ref.component === owner.id), target = peer && definition.pins.find((pin) => pin.num === peer.pin)
        return target && gpioOf(target)
      }
      const sda = gpio("SDA"), scl = gpio("SCL")
      if (sda === undefined || scl === undefined) continue
      const port = (sda >> 1) & 1
      if (sda % 2 || scl !== sda + 1) throw new Error(`${component.ref}: I²C pins must be a valid adjacent SDA/SCL pair`)
      const key = `${owner.id}/${port}`, address = component.props.i2cAddress ? Number(component.props.i2cAddress) : 0x68
      if (!Number.isInteger(address) || address < 8 || address > 119) throw new Error(`${component.ref}: invalid I²C address`)
      const bus = buses.get(key) ?? { pico: binding.runtime, port, sda, scl, devices: new Map<number, I2cDevice>() }
      if (bus.devices.has(address)) throw new Error(`I²C address collision on ${owner.ref} I2C${port}`)
      const sensor = new Mpu6050(); bus.devices.set(address, sensor); buses.set(key, bus)
      sensors.push({ component: component.ref, sensor }); models[component.id] = () => ({ stamp() {}, view: () => sensor.view() })
      break
    }
  }
  for (const bus of buses.values()) disposers.push(attachPicoI2c(bus.pico, bus.port, bus.devices, bus))
  return { sensors, models, dispose() { for (const dispose of disposers) dispose() } }
}
