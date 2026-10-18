import { ConsoleLogger, GPIOPinState, LogLevel, Simulator, USBCDC, type RP2040 } from "rp2040js"
import { bootromB1 } from "./vendor/bootrom"

export const GPIO_COUNT = 30
const FLASH = 0x10000000

export type PinState = "low" | "high" | "input" | "pullup" | "pulldown" | "keeper"
const STATES: Record<GPIOPinState, PinState> = {
  [GPIOPinState.Low]: "low",
  [GPIOPinState.High]: "high",
  [GPIOPinState.Input]: "input",
  [GPIOPinState.InputPullUp]: "pullup",
  [GPIOPinState.InputPullDown]: "pulldown",
  [GPIOPinState.InputBusKeeper]: "keeper",
}
const FUNCTIONS = ["jtag", "spi", "uart", "i2c", "pwm", "sio", "pio0", "pio1", "clock", "usb"]

/** Arduino names: Serial is USB CDC, Serial1 is UART0, Serial2 is UART1. */
export type SerialPort = "Serial" | "Serial1" | "Serial2"

export interface GpioSummary {
  state: PinState
  function: string
  edges: number
}

/** Copy a UF2 image into flash. */
export function loadUf2(mcu: RP2040, uf2: Uint8Array) {
  const view = new DataView(uf2.buffer, uf2.byteOffset, uf2.byteLength)
  for (let at = 0; at + 512 <= uf2.length; at += 512) {
    if (view.getUint32(at, true) !== 0x0a324655 || view.getUint32(at + 4, true) !== 0x9e5d5157) continue
    if (view.getUint32(at + 8, true) & 1) continue // "not main flash"
    const addr = view.getUint32(at + 12, true)
    const size = view.getUint32(at + 16, true)
    mcu.flash.set(uf2.subarray(at + 32, at + 32 + size), addr - FLASH)
  }
}

/**
 * A headless RP2040 running a firmware image in simulated time.
 * The live simulator drives it with step() and bridges pins with onPin / setInput.
 */
export class Pico {
  readonly sim = new Simulator()
  readonly mcu = this.sim.rp2040
  readonly usb = new USBCDC(this.mcu.usbCtrl)
  /** Rising + falling output edges per GPIO since boot. */
  readonly edges = new Array<number>(GPIO_COUNT).fill(0)
  onSerial?: (port: SerialPort, text: string) => void
  onPin?: (gpio: number, state: PinState, nanos: number) => void
  private stopped = false
  private driven = new Set<number>()

  constructor(uf2: Uint8Array) {
    this.mcu.logger = new ConsoleLogger(LogLevel.Error)
    this.mcu.loadBootrom(bootromB1)
    loadUf2(this.mcu, uf2)
    const decoders = [new TextDecoder(), new TextDecoder(), new TextDecoder()]
    const emit = (i: number, port: SerialPort, bytes: Uint8Array) =>
      this.onSerial?.(port, decoders[i]!.decode(bytes, { stream: true }))
    this.usb.onSerialData = (bytes) => emit(0, "Serial", bytes)
    this.mcu.uart[0]!.onByte = (b) => emit(1, "Serial1", new Uint8Array([b]))
    this.mcu.uart[1]!.onByte = (b) => emit(2, "Serial2", new Uint8Array([b]))
    this.mcu.gpio.slice(0, GPIO_COUNT).forEach((pin, i) =>
      pin.addListener((state, old) => {
        if ((state === GPIOPinState.High) !== (old === GPIOPinState.High)) this.edges[i]!++
        // An undriven pad reads back its own output or pull, as on real hardware
        if (!this.driven.has(i)) pin.setInputValue(state === GPIOPinState.High || state === GPIOPinState.InputPullUp)
        this.onPin?.(i, STATES[state], this.nanos)
      }),
    )
    this.mcu.core.PC = FLASH // run boot2 straight from flash, as the rp2040js demos do
  }

  /** Simulated time since boot, in ns. */
  get nanos() {
    return this.sim.clock.nanos
  }

  /** Run for a span of simulated time. */
  step(nanos: number) {
    const { mcu } = this
    const clock = this.sim.clock
    const end = clock.nanos + nanos
    while (clock.nanos < end) {
      if (mcu.core.waiting) {
        const next = clock.nanosToNextAlarm
        clock.tick(next > 0 ? Math.min(next, end - clock.nanos) : end - clock.nanos)
      } else {
        clock.tick((mcu.core.executeInstruction() * 1e9) / mcu.clkSys)
      }
    }
  }

  /** Run for ms of simulated time, yielding to the event loop, until done, stop() or the wall-clock cap. */
  async run(ms: number, wallMs = 10_000) {
    this.stopped = false
    const end = this.nanos + ms * 1e6
    const start = performance.now()
    let yielded = start
    while (!this.stopped && this.nanos < end && performance.now() - start < wallMs) {
      this.step(Math.min(1e6, end - this.nanos))
      if (performance.now() - yielded > 20) {
        await new Promise((r) => setTimeout(r, 0))
        yielded = performance.now()
      }
    }
  }

  stop() {
    this.stopped = true
  }

  /** Drive a pin from outside, e.g. a button or another chip. null releases it. */
  setInput(gpio: number, high: boolean | null) {
    const pin = this.mcu.gpio[gpio]!
    if (high === null) this.driven.delete(gpio)
    else this.driven.add(gpio)
    pin.setInputValue(high ?? (pin.value === GPIOPinState.High || pin.value === GPIOPinState.InputPullUp))
  }

  /** Send bytes to the firmware's USB Serial. */
  write(text: string) {
    for (const b of new TextEncoder().encode(text)) this.usb.sendSerialByte(b)
  }

  pin(gpio: number): GpioSummary {
    const pin = this.mcu.gpio[gpio]!
    return { state: STATES[pin.value], function: FUNCTIONS[pin.functionSelect] ?? "none", edges: this.edges[gpio]! }
  }

  /** Every GPIO the firmware has assigned a function to. */
  pins(): Record<string, GpioSummary> {
    const out: Record<string, GpioSummary> = {}
    for (let i = 0; i < GPIO_COUNT; i++) {
      const pin = this.pin(i)
      if (pin.function !== "none") out[`GP${i}`] = pin
    }
    return out
  }
}

export interface RunResult {
  serial: Partial<Record<SerialPort, string>>
  gpio: Record<string, GpioSummary>
  simulatedMs: number
  wallMs: number
}

/** Boot a firmware image, run it headless for ms of simulated time and report what it did. */
export async function runFirmware(uf2: Uint8Array, ms: number, wallMs = 10_000): Promise<RunResult> {
  const pico = new Pico(uf2)
  const serial: Partial<Record<SerialPort, string>> = {}
  pico.onSerial = (port, text) => (serial[port] = (serial[port] ?? "") + text)
  const start = performance.now()
  await pico.run(ms, wallMs)
  return {
    serial,
    gpio: pico.pins(),
    simulatedMs: Math.round(pico.nanos / 1e3) / 1e3,
    wallMs: Math.round(performance.now() - start),
  }
}
