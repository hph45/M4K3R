import { findComponent, partOf, type Project } from "@m4k3r/core"
import { Nrf24, RadioMedium, type ModelFactory } from "@m4k3r/sim"
import { GPIOPinState } from "rp2040js"
import { gpioOf } from "./pins"
import { Pico } from "./runner"

export interface RadioPins { spi: number; csn: number; ce: number; sck: number; mosi: number; miso: number; irq?: number }
/** Connect the actual rp2040js SPI peripheral, chip select and CE/IRQ GPIO to the radio model. */
export function attachPicoNrf24(pico: Pico, radio: Nrf24, pins: RadioPins) {
  const spi = pico.mcu.spi[pins.spi]
  if (!spi) throw new Error(`No RP2040 SPI${pins.spi}`)
  const previous = spi.onTransmit
  const selected = () => pico.pin(pins.csn).state === "low"
  const detachCsn = pico.mcu.gpio[pins.csn]!.addListener((state) => radio.select(state === GPIOPinState.Low))
  const detachCe = pico.mcu.gpio[pins.ce]!.addListener((state) => radio.setCe(state === GPIOPinState.High))
  radio.onIrq = (asserted) => { if (pins.irq !== undefined) pico.setInput(pins.irq, !asserted) }
  spi.onTransmit = (value) => {
    const connected = selected() && [pins.sck, pins.mosi, pins.miso].every((gpio) => pico.pin(gpio).function === "spi")
    spi.completeTransmit(connected ? radio.transfer(value) : 0xff)
  }
  return () => { detachCsn(); detachCe(); spi.onTransmit = previous; radio.onIrq = undefined; radio.dispose() }
}

/** Discover SPI radios from shared project nets. One nRF24 per MCU SPI bus is supported. */
export function connectProjectRadios(project: Project, mcus: { component: string; runtime: Pico }[]) {
  const medium = new RadioMedium(), radios: { component: string; radio: Nrf24 }[] = [], disposers: (() => void)[] = [], models: Record<string, ModelFactory> = {}, used = new Set<string>()
  for (const component of project.components.filter((component) => /nrf24/i.test(component.part))) {
    const part = partOf(project, component)
    for (const mcu of mcus) {
      const owner = findComponent(project, mcu.component), ownerPart = partOf(project, owner)
      const gpio = (name: string) => {
        const pin = part.pins.find((pin) => pin.name.toUpperCase() === name)
        const net = pin && project.nets.find((net) => net.pins.some((ref) => ref.component === component.id && ref.pin === pin.num))
        const peer = net?.pins.find((ref) => ref.component === owner.id)
        const target = peer && ownerPart.pins.find((pin) => pin.num === peer.pin)
        return target && gpioOf(target)
      }
      const csn = gpio("CSN"), ce = gpio("CE"), sck = gpio("SCK"), mosi = gpio("MOSI"), miso = gpio("MISO"), irq = gpio("IRQ")
      if ([csn, ce, sck, mosi, miso].some((value) => value === undefined)) continue
      const bus = (sck! >> 3) & 1
      if (sck! % 4 !== 2 || mosi! % 4 !== 3 || miso! % 4 !== 0 || ((mosi! >> 3) & 1) !== bus || ((miso! >> 3) & 1) !== bus) throw new Error(`${component.ref}: SPI pins do not form a valid RP2040 hardware SPI bus`)
      const key = `${owner.id}/${bus}`
      if (used.has(key)) throw new Error(`Only one nRF24 per RP2040 SPI bus is supported (${owner.ref} SPI${bus})`)
      used.add(key)
      const radio = new Nrf24(medium)
      disposers.push(attachPicoNrf24(mcu.runtime, radio, { spi: bus, csn: csn!, ce: ce!, sck: sck!, mosi: mosi!, miso: miso!, irq }))
      radios.push({ component: component.ref, radio })
      models[component.id] = (ctx) => ({ stamp(stamper) { if (irq !== undefined && part.pins.some((pin) => pin.name.toUpperCase() === "IRQ")) { const node = ctx.pin("IRQ"); stamper.conductance(node, -1, 0.01); stamper.current(-1, node, radio.irq ? 0 : 0.033) } }, view: () => radio.view() })
      break
    }
  }
  return { radios, models, dispose() { for (const dispose of disposers) dispose() } }
}
