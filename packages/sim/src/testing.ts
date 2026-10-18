import { readFileSync } from "node:fs"
import { emptyProject, Part, type Project } from "@m4k3r/core"

export const libraryPart = (id: string) =>
  Part.parse(JSON.parse(readFileSync(new URL(`../../../library/parts/${id}/part.json`, import.meta.url), "utf8")))

const extra: Record<string, Part> = {
  vsource: Part.parse({
    id: "vsource", name: "Voltage source", refPrefix: "V",
    pins: [{ num: "1", name: "+" }, { num: "2", name: "-" }], sim: { model: "vsource" },
  }),
}

/**
 * A project from netlist lines, e.g. "R1 resistor IN OUT value=1k":
 * ref, part id (library or vsource), one net per pin in pin order, then props.
 */
export function circuit(...lines: string[]): Project {
  const p = emptyProject("test", "test")
  const nets = new Map<string, Project["nets"][number]>()
  for (const line of lines) {
    const [ref, partId, ...rest] = line.trim().split(/\s+/)
    const part = (p.parts[partId!] ??= extra[partId!] ?? libraryPart(partId!))
    const props = Object.fromEntries(rest.filter((w) => w.includes("=")).map((w) => w.split("=") as [string, string]))
    const pinNets = rest.filter((w) => !w.includes("="))
    p.components.push({ id: ref!, ref: ref!, part: part.id, props: { ...part.props, ...props } })
    part.pins.forEach((pin, i) => {
      const name = pinNets[i]
      if (!name || name === "-") return
      if (!nets.has(name)) nets.set(name, { id: name, name, pins: [] })
      nets.get(name)!.pins.push({ component: ref!, pin: pin.num })
    })
  }
  p.nets = [...nets.values()]
  return p
}
