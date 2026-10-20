import { pinAddress } from "./lookup"
import type { PinType, Project } from "./schema"

export interface NetlistPin {
  address: string
  name: string
  type: PinType
}

export interface Netlist {
  components: { ref: string; part: string; props: Record<string, string> }[]
  nets: { name: string; pins: NetlistPin[] }[]
  unconnected: NetlistPin[]
}

const toPin = (p: Project, component: string, pin: string): NetlistPin => {
  const a = pinAddress(p, { component, pin })
  return { address: a.address, name: a.pin.name, type: a.pin.type }
}

export function netlist(p: Project): Netlist {
  const wired = new Set(p.nets.flatMap((n) => n.pins.map((r) => `${r.component}/${r.pin}`)))
  const byRef = [...p.components].sort((a, b) => a.ref.localeCompare(b.ref, undefined, { numeric: true }))
  return {
    components: byRef.map((c) => ({ ref: c.ref, part: c.part, props: c.props })),
    nets: [...p.nets]
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map((n) => ({ name: n.name, pins: n.pins.map((r) => toPin(p, r.component, r.pin)) })),
    unconnected: byRef.flatMap((c) =>
      (p.parts[c.part]?.pins ?? [])
        .filter((pin) => pin.type !== "nc" && !wired.has(`${c.id}/${pin.num}`))
        .map((pin) => toPin(p, c.id, pin.num)),
    ),
  }
}

/** Compact plain-text netlist, easy for people and agents to read. */
export function netlistText(p: Project): string {
  const n = netlist(p)
  const props = (r: Record<string, string>) =>
    Object.entries(r)
      .map(([k, v]) => `${k}=${v}`)
      .join(" ")
  return [
    "# Components",
    ...n.components.map((c) => `${c.ref}  ${c.part}  ${props(c.props)}`.trimEnd()),
    "",
    "# Nets",
    ...n.nets.map((net) => `${net.name}: ${net.pins.map((pin) => pin.address).join(", ")}`),
    "",
    "# Unconnected",
    ...n.unconnected.map((pin) => `${pin.address} (${pin.type})`),
  ].join("\n")
}
