import { findComponent, partOf, type Pin, type Project } from "@m4k3r/core"

/** GPIO number of an MCU pin: from its name (GP10, GPIO10, ESP32-style IO10) or such a function. */
export function gpioOf(pin: Pin): number | undefined {
  const match = [pin.name, ...(pin.functions ?? [])].map((s) => /^(?:GP(?:IO)?|IO)(\d+)$/i.exec(s)).find(Boolean)
  return match ? Number(match[1]) : undefined
}

/** Turn a net name into a valid C identifier suffix: "L-IN1" → "L_IN1", "~RESET" → "RESET". */
export function cName(name: string) {
  const id = name.toUpperCase().replace(/[^A-Z0-9_]+/g, "_").replace(/^_+|_+$/g, "")
  return id || "NET"
}

export interface PinDefine {
  name: string
  gpio: number
  net: string
  pin: string
  functions: string[]
}

/** One #define per net on an MCU GPIO pin, sorted by GPIO number. */
export function pinDefines(p: Project, mcu: string): PinDefine[] {
  const c = findComponent(p, mcu)
  const pins = partOf(p, c).pins
  const found: Omit<PinDefine, "name">[] = []
  for (const net of p.nets) {
    for (const ref of net.pins) {
      const pin = ref.component === c.id ? pins.find((pin) => pin.num === ref.pin) : undefined
      const gpio = pin && gpioOf(pin)
      if (pin && gpio !== undefined) {
        const functions = (pin.functions ?? []).filter((f) => !/^GPIO\d*$/i.test(f))
        found.push({ gpio, net: net.name, pin: `${c.ref}.${pin.name}`, functions })
      }
    }
  }
  found.sort((a, b) => a.gpio - b.gpio)
  const used = new Set<string>()
  return found.map((d) => {
    const base = `PIN_${cName(d.net)}`
    let name = base
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`
    used.add(name)
    return { name, ...d }
  })
}

/** Contents of m4k3r_pins.h for the firmware's target MCU. */
export function pinHeader(p: Project, mcu: string | undefined): string {
  const lines = ["// Generated from the schematic by M4K3R. Do not edit.", "#pragma once", ""]
  if (!mcu) return [...lines, "// No target MCU set (firmware.set mcu)", ""].join("\n")
  const defines = pinDefines(p, mcu)
  const width = Math.max(0, ...defines.map((d) => d.name.length))
  for (const d of defines) {
    const fns = d.functions.length ? ` (${d.functions.join(", ")})` : ""
    lines.push(`#define ${d.name.padEnd(width)} ${String(d.gpio).padEnd(2)}  // net ${d.net} → ${d.pin}${fns}`)
  }
  if (!defines.length) lines.push(`// No nets on ${findComponent(p, mcu).ref}'s GPIO pins yet`)
  return [...lines, ""].join("\n")
}
