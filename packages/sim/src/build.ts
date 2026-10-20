import { parseQuantity, type Project } from "@m4k3r/core"
import { Circuit } from "./circuit"
import { SimError, type Model, type ModelFactory, type Node } from "./model"
import { models } from "./models"

export const isGround = (net: string) => net.toUpperCase() === "GND" || net === "0"

export interface Built {
  circuit: Circuit
  /** Net name → node; ground nets are -1 */
  nets: Map<string, Node>
  /** Component ref → model instance */
  parts: Map<string, Model>
  warnings: string[]
}

/** Build the analog circuit for a project. Components whose part has no sim model are skipped with a warning. */
export function build(project: Project, overrides: Record<string, ModelFactory> = {}): Built {
  const circuit = new Circuit()
  const warnings: string[] = []
  const netOf = new Map<string, string>()
  for (const net of project.nets) for (const pin of net.pins) netOf.set(`${pin.component}/${pin.pin}`, net.name)
  const grounds = project.nets.filter((n) => isGround(n.name))
  if (!grounds.length) throw new SimError(`No ground: name the 0 V net "GND"`)
  const nets = new Map<string, Node>(grounds.map((n) => [n.name, -1]))
  const nodeOf = (net: string) => {
    let n = nets.get(net)
    if (n === undefined) nets.set(net, (n = circuit.node(net)))
    return n
  }

  const parts = new Map<string, Model>()
  const groups: Node[][] = []
  const unmodeled: string[] = [], aggregate: string[] = []
  for (const c of project.components) {
    const part = project.parts[c.part]
    if (!part) throw new SimError(`${c.ref}: part "${c.part}" is missing from the project`)
    let override = overrides[c.ref] ?? overrides[c.id]
    if (!override && !part.sim && /brushless/i.test(part.id)) {
      const esc = project.components.find((other) => {
        const definition = project.parts[other.part]
        return definition?.sim?.model === "esc-propeller" && ["A", "B", "C"].every((phase) => {
          const motorPin = part.pins.find((pin) => pin.name === phase), escPin = definition.pins.find((pin) => pin.name === phase)
          const motorNet = motorPin && netOf.get(`${c.id}/${motorPin.num}`)
          return !!motorNet && !!escPin && motorNet === netOf.get(`${other.id}/${escPin.num}`)
        })
      })
      if (esc) {
        override = () => ({ stamp() {}, view: () => ({ ...parts.get(esc.ref)?.view?.(), behavioralSource: esc.ref }) })
        aggregate.push(c.ref)
      }
    }
    if (!part.sim && !override) {
      if (part.kind !== "mechanical") unmodeled.push(c.ref)
      continue
    }
    const modelName = part.sim?.model ?? "coupled MCU"
    const factory = override ?? models[modelName]
    if (!factory) {
      throw new SimError(`${c.ref}: unknown sim model "${modelName}" (known: ${Object.keys(models).join(", ")})`)
    }
    const byName = new Map<string, Node>()
    const byNum = new Map<string, Node>()
    for (const pin of part.pins) {
      const net = netOf.get(`${c.id}/${pin.num}`)
      const node = net ? nodeOf(net) : circuit.node(`${c.ref}.${pin.name}`)
      byNum.set(pin.num, node)
      if (!byName.has(pin.name)) byName.set(pin.name, node)
    }
    groups.push([...byNum.values()])

    const props = { ...part.props, ...c.props }
    const params = part.sim?.params ?? {}
    const raw = (key: string) => props[key] ?? params[key]
    const model = factory({
      ref: c.ref,
      props,
      pin(name) {
        const node = byName.get(name) ?? byNum.get(name)
        if (node === undefined) throw new SimError(`${c.ref}: model "${modelName}" needs a pin named "${name}"`)
        return node
      },
      num(key, fallback) {
        const value = raw(key)
        if (value === undefined) {
          if (fallback === undefined) throw new SimError(`${c.ref}: missing ${key}`)
          return fallback
        }
        if (typeof value === "number") return value
        const q = parseQuantity(String(value))
        if (!q) throw new SimError(`${c.ref}: can't read ${key} = "${value}"`)
        return q.value
      },
      str: (key, fallback) => (raw(key) === undefined ? fallback : String(raw(key))),
      node: (name) => circuit.node(name),
      branch: (name) => circuit.branch(name),
      v: (n) => circuit.v(n),
    })
    circuit.models.push(model)
    parts.set(c.ref, model)
  }

  // One line per kind, however many parts it applies to.
  if (unmodeled.length) warnings.push(unmodeled.length === 1 ? `${unmodeled[0]} has no simulation model and is ignored` : `${unmodeled.length} parts have no simulation model and are ignored: ${refList(unmodeled)}`)
  if (aggregate.length) warnings.push(`${refList(aggregate)} ${aggregate.length === 1 ? "follows its ESC's" : "follow their ESCs'"} aggregate ESC/motor/propeller model; three-phase waveforms and kV-based thrust are not modeled`)
  const floating = floatingNets(nets, groups)
  if (floating.length) warnings.push(`No connection to GND: ${floating.join(", ")}`)
  return { circuit, nets, parts, warnings }
}

/** "J1, J2, J3, U1, U3" → "J1–J3, U1, U3" */
export function refList(refs: string[]) {
  const parsed = refs.map((ref) => /^(.*?)(\d+)$/.exec(ref)).map((m, i) => m ? { prefix: m[1]!, n: Number(m[2]) } : { prefix: refs[i]!, n: NaN })
  parsed.sort((a, b) => a.prefix.localeCompare(b.prefix) || a.n - b.n)
  const out: string[] = []
  for (let i = 0; i < parsed.length; ) {
    let j = i
    while (j + 1 < parsed.length && parsed[j + 1]!.prefix === parsed[i]!.prefix && parsed[j + 1]!.n === parsed[j]!.n + 1) j++
    const name = (k: number) => Number.isNaN(parsed[k]!.n) ? parsed[k]!.prefix : `${parsed[k]!.prefix}${parsed[k]!.n}`
    out.push(j - i >= 2 ? `${name(i)}–${name(j)}` : [i, ...(j > i ? [j] : [])].map(name).join(", "))
    i = j + 1
  }
  return out.join(", ")
}

/** Nets with no path to ground through any part (treating every part as connecting all its pins). */
function floatingNets(nets: Map<string, Node>, groups: Node[][]) {
  const parent = new Map<Node, Node>()
  const root = (n: Node): Node => {
    const p = parent.get(n) ?? n
    if (p === n) return n
    const r = root(p)
    parent.set(n, r)
    return r
  }
  for (const group of groups) for (const n of group.slice(1)) parent.set(root(n), root(group[0]!))
  return [...nets].filter(([, n]) => root(n) !== root(-1)).map(([name]) => name)
}
