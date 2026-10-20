import type { Component, Doc, Net, Part, Pin, PinRef, Project } from "./schema"

export class CommandError extends Error {}

export function findComponent(p: Project, key: string): Component {
  const c = p.components.find((c) => c.id === key || c.ref === key)
  if (!c) throw new CommandError(`No component "${key}"`)
  return c
}

export function findNet(p: Project, key: string): Net {
  const n = p.nets.find((n) => n.id === key || n.name === key)
  if (!n) throw new CommandError(`No net "${key}"`)
  return n
}

export function findDoc(p: Project, key: string, kind?: string): Doc {
  const d = p.docs.find((d) => d.id === key || d.name === key)
  if (!d) throw new CommandError(`No doc "${key}"`)
  if (kind && d.kind !== kind) throw new CommandError(`"${d.name}" is a ${d.kind}, not a ${kind}`)
  return d
}

export function partOf(p: Project, c: Component): Part {
  const part = p.parts[c.part]
  if (!part) throw new CommandError(`Part "${c.part}" missing from project`)
  return part
}

/** Resolve "U1.GP10" → { component, pin }. Matches a unique pin name first, then a pin number. */
export function resolvePin(p: Project, address: string): PinRef {
  const dot = address.lastIndexOf(".")
  if (dot < 1) throw new CommandError(`Pin "${address}" should look like REF.PIN, e.g. U1.GP10`)
  const c = findComponent(p, address.slice(0, dot))
  const key = address.slice(dot + 1)
  const pins = partOf(p, c).pins
  const byName = pins.filter((pin) => pin.name === key)
  if (byName.length === 1) return { component: c.id, pin: byName[0]!.num }
  const byNum = pins.find((pin) => pin.num === key)
  if (byNum) return { component: c.id, pin: byNum.num }
  if (byName.length > 1) {
    throw new CommandError(`${c.ref}.${key} is ambiguous; use a pin number: ${byName.map((pin) => pin.num).join(", ")}`)
  }
  throw new CommandError(`${c.ref} has no pin "${key}" (pins: ${pins.map((pin) => pin.name).join(", ")})`)
}

/** Readable address for a pin: REF.NAME when the name is unique on the part, else REF.NUM. */
export function pinAddress(p: Project, ref: PinRef): { address: string; pin: Pin; component: Component } {
  const c = p.components.find((c) => c.id === ref.component)
  if (!c) throw new CommandError(`Dangling pin reference to component ${ref.component}`)
  const pins = partOf(p, c).pins
  const pin = pins.find((pin) => pin.num === ref.pin)
  if (!pin) throw new CommandError(`${c.ref} has no pin number ${ref.pin}`)
  const unique = pins.filter((other) => other.name === pin.name).length === 1
  return { address: `${c.ref}.${unique ? pin.name : pin.num}`, pin, component: c }
}

export const samePin = (a: PinRef, b: PinRef) => a.component === b.component && a.pin === b.pin
