import { parseQuantity, type Project } from "@m4k3r/core"

export interface DcRail { voltage: number; source: string }
export interface DcRailResult { rails: Map<string, DcRail>; conflicts: { net: string; sources: DcRail[] }[] }

/** Static setpoints only: no divider, switch, diode, MCU output or arbitrary circuit inference. */
export function inferDcRails(project: Project): DcRailResult {
  const rails = new Map<string, DcRail>(), candidates = new Map<string, Map<string, DcRail>>()
  const ground = new Set(project.nets.filter((net) => /^(GND|0)$/i.test(net.name)).map((net) => net.id))
  for (const id of ground) rails.set(id, { voltage: 0, source: "named ground reference" })
  function record(net: string, source: string, rail: DcRail) {
    if (!candidates.has(net)) candidates.set(net, new Map())
    candidates.get(net)!.set(source, rail)
    const sources = [...candidates.get(net)!.values()]
    if (sources.some((source) => Math.abs(source.voltage - sources[0]!.voltage) > 1e-6) || ground.has(net) && Math.abs(rail.voltage) > 1e-6) rails.delete(net)
    else rails.set(net, { voltage: sources[0]!.voltage, source: sources.map((s) => s.source).join("; ") })
  }
  const devices = project.components.map((component) => {
    const part = project.parts[component.part], props = { ...part?.props, ...component.props }
    const pinNet = (name: string) => {
      const pin = part?.pins.find((pin) => pin.name.toUpperCase() === name.toUpperCase())
      return pin && project.nets.find((net) => net.pins.some((p) => p.component === component.id && p.pin === pin.num))?.id
    }
    const value = (key: string) => {
      const raw = props[key] ?? part?.sim?.params[key]
      const parsed = typeof raw === "number" ? { value: raw, unit: "" } : typeof raw === "string" ? parseQuantity(raw) : undefined
      return parsed && ["", "V"].includes(parsed.unit) && Number.isFinite(parsed.value) ? parsed.value : undefined
    }
    return { component, model: part?.sim?.model, pinNet, value }
  })
  for (const device of devices.filter((d) => d.model === "battery")) {
    const positive = device.pinNet("+"), negative = device.pinNet("-"), voltage = device.value("voltage")
    if (voltage === undefined || voltage < 0 || !positive || !negative || positive === negative) continue
    if (ground.has(negative)) record(positive, device.component.id, { voltage, source: `${device.component.ref} nominal battery property (actual voltage varies with charge and load)` })
    else if (ground.has(positive)) record(negative, device.component.id, { voltage: -voltage, source: `${device.component.ref} reversed ground-referenced nominal battery property` })
  }
  // Recompute regulator dependencies rather than trusting the order of components.
  // Cycles/unpowered inputs remain unknown; only explicitly configured dropout is used.
  const regulators = devices.filter((d) => d.model === "regulator")
  for (let pass = 0; pass <= regulators.length; pass++) for (const device of regulators) {
    const input = device.pinNet("IN"), output = device.pinNet("OUT"), reference = device.pinNet("GND")
    const voltage = device.value("voltage"), dropout = device.value("dropout"), supply = input && rails.get(input)
    if (!input || !output || !reference || !ground.has(reference) || !supply || voltage === undefined || voltage <= 0 || dropout === undefined || dropout < 0 || supply.voltage + 1e-6 < voltage + dropout) continue
    record(output, device.component.id, { voltage, source: `${device.component.ref} regulator setpoint (${dropout} V dropout; ${supply.voltage} V known input)` })
  }
  const conflicts = [...candidates].flatMap(([net, values]) => {
    const sources = [...values.values()]
    if (ground.has(net)) sources.unshift({ voltage: 0, source: "named ground reference" })
    return sources.some((source) => Math.abs(source.voltage - sources[0]!.voltage) > 1e-6) ? [{ net, sources }] : []
  })
  // A downstream setpoint is not established if a later source conflicts with its input.
  const untrusted = new Set(conflicts.map((conflict) => conflict.net))
  for (let pass = 0; pass <= regulators.length; pass++) for (const device of regulators) {
    const input = device.pinNet("IN"), output = device.pinNet("OUT")
    if (input && output && untrusted.has(input)) { untrusted.add(output); rails.delete(output) }
  }
  return { rails, conflicts }
}
