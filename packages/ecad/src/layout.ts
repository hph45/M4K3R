type XY = [number, number]
export type NetStyle = "ground" | "power" | "signal"

const GROUND = /^(0|[ADP]?GND\w*|VSS\w*)$/i
const POWER = /^(\+.+|\d+V\d*|V\+|VBAT\w*|V(CC|DD|IN|BUS|SYS|USB|MOT)\w*)$/i
/** Draw distance (mm) up to which the canvas joins two pins of a net with a wire. */
export const WIRE_REACH = 45
const GRID = 2.54, GAP_X = 5, GROUP_X = 12, GROUP_Y = 18

/** Ground and supply rails are recognised by name, the way KiCad power symbols are. */
export const netStyle = (name: string): NetStyle => GROUND.test(name) ? "ground" : POWER.test(name) ? "power" : "signal"

/** Rails with several pins and very large nets get a port on every pin instead of wires across the sheet. */
export const isGlobalNet = (net: { name: string; pins: readonly unknown[] }) => net.pins.length > 5 || netStyle(net.name) !== "signal" && net.pins.length > 2

export interface NetEnd { key: string; at: XY; out: XY }
export interface NetDrawing { wires: [XY, XY][]; ports: NetEnd[]; junctions: XY[] }

/**
 * How the canvas draws a net that has no hand-drawn path: short wires between nearby pins, and a port
 * (power symbol or name label) where a wire would cross the sheet. `joined` are pin pairs already drawn.
 */
export function netDrawing(net: { name: string; pins: readonly unknown[] }, ends: NetEnd[], joined: [string, string][] = [], reach = WIRE_REACH): NetDrawing {
  const parent = ends.map((_, i) => i)
  const root = (i: number): number => parent[i] === i ? i : (parent[i] = root(parent[i]!))
  const index = new Map(ends.map((e, i) => [e.key, i]))
  const stacked = new Map<string, number>()
  ends.forEach((e, i) => {
    const at = e.at.map((v) => v.toFixed(2)).join(",")
    if (stacked.has(at)) parent[root(i)] = root(stacked.get(at)!)
    else stacked.set(at, i)
  })
  for (const [a, b] of joined) {
    const i = index.get(a), j = index.get(b)
    if (i !== undefined && j !== undefined) parent[root(i)] = root(j)
  }
  const wires: [XY, XY][] = []
  const degree = new Map<number, number>()
  if (!isGlobalNet(net)) {
    // A wire must leave both pins outward; one that would double back through a body becomes a label pair.
    const facing = (a: NetEnd, b: NetEnd) => a.out[0] * (b.at[0] - a.at[0]) + a.out[1] * (b.at[1] - a.at[1]) >= 0
    const pairs = ends.flatMap((a, i) => ends.slice(i + 1).map((b, k) => ({ i, j: i + 1 + k, d: Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]), ok: facing(a, b) && facing(b, a) })))
    for (const { i, j } of pairs.filter((p) => p.ok && p.d <= reach).sort((a, b) => a.d - b.d)) {
      if (root(i) === root(j)) continue
      parent[root(i)] = root(j)
      wires.push([ends[i]!.at, ends[j]!.at])
      for (const k of [i, j]) degree.set(k, (degree.get(k) ?? 0) + 1)
    }
  }
  const style = netStyle(net.name)
  // Ground symbols hang below their cluster and supply symbols sit above it.
  const rank = (e: NetEnd) => style === "ground" ? -e.at[1] : style === "power" ? e.at[1] : 0
  const clusters = new Map<number, NetEnd>()
  ends.forEach((e, i) => { const r = root(i), best = clusters.get(r); if (!best || rank(e) < rank(best)) clusters.set(r, e) })
  const ports = clusters.size > 1 || style !== "signal" ? [...clusters.values()] : []
  return { wires, ports, junctions: [...degree].filter(([, n]) => n > 1).map(([i]) => ends[i]!.at) }
}

/**
 * `title` is how far the reference text reaches right of the symbol's left edge; `below` reserves space under it, e.g. for a live readout.
 * `sides` gives each pin's outward horizontal direction (-1 left, 1 right, 0 up or down), so connected parts sit on the side their pins face.
 */
export interface ArrangeItem { component: string; unit: number; bounds: { min: XY; max: XY }; title?: number; below?: number; sides?: Record<string, number> }

const bodyWidth = (c: ArrangeItem) => c.bounds.max[0] - c.bounds.min[0]

const snap = (v: number) => Math.round(v / GRID) * 254 / 100

/**
 * Group parts that share signal nets (a driver beside the motor it drives) and pack the groups in rows.
 * Rails and very large nets don't group parts; parts joined only by rails form a power group.
 * Items keep the caller's order (by reference) for ties. Returns sheet origins keyed `component/unit`.
 */
export function arrange(items: ArrangeItem[], nets: readonly { name: string; pins: readonly { component: string; pin?: string }[] }[], origin: XY = [30, 30]): Map<string, XY> {
  const ids = [...new Set(items.map((i) => i.component))]
  if (!ids.length) return new Map()
  const order = new Map(ids.map((id, i) => [id, i]))
  const weight = new Map(ids.map((id) => [id, new Map<string, number>()]))
  const link = (a: string, b: string) => weight.get(a)!.set(b, (weight.get(a)!.get(b) ?? 0) + 1)
  for (const net of nets) {
    if (isGlobalNet(net)) continue
    const on = [...new Set(net.pins.map((p) => p.component))].filter((id) => order.has(id))
    for (const a of on) for (const b of on) if (a !== b) link(a, b)
  }
  const hubs = new Set(ids.filter((id) => weight.get(id)!.size >= 4))
  const parent = new Map(ids.map((id) => [id, id]))
  const root = (id: string): string => parent.get(id) === id ? id : root(parent.get(id)!)
  const join = (a: string, b: string) => { const [x, y] = [root(a), root(b)].sort((p, q) => order.get(p)! - order.get(q)!); parent.set(y!, x!) }
  for (const a of ids) for (const b of weight.get(a)!.keys()) if (!hubs.has(a) && !hubs.has(b)) join(a, b)
  const clusters = new Map<string, string[]>()
  for (const id of ids) clusters.set(root(id), [...clusters.get(root(id)) ?? [], id])
  // A lone part wired only to a hub sits beside that hub; parts with no signal links gather by shared rails.
  const loose: string[] = []
  for (const [key, members] of clusters) {
    if (members.length > 1 || hubs.has(key)) continue
    const best = [...weight.get(key)!].filter(([id]) => hubs.has(id)).sort((a, b) => b[1] - a[1])[0]?.[0]
    if (best) { clusters.get(best)!.push(key); clusters.delete(key) }
    else if (!weight.get(key)!.size) { loose.push(key); clusters.delete(key) }
  }
  for (const net of nets) {
    if (netStyle(net.name) === "ground") continue
    const on = loose.filter((id) => net.pins.some((p) => p.component === id))
    for (const id of on.slice(1)) join(on[0]!, id)
  }
  for (const id of loose) clusters.set(root(id), [...clusters.get(root(id)) ?? [], id])

  // Positive when `other` belongs right of `id`: its shared pins face left and id's face right.
  const side = (id: string, pin?: string) => items.find((item) => item.component === id && pin !== undefined && item.sides?.[pin] !== undefined)?.sides?.[pin!] ?? 0
  const facing = (id: string, other: string) => nets.filter((net) => !isGlobalNet(net)).reduce((sum, net) => {
    const mine = net.pins.filter((p) => p.component === id), theirs = net.pins.filter((p) => p.component === other)
    if (!mine.length || !theirs.length) return sum
    return sum + mine.reduce((s, p) => s + side(id, p.pin), 0) - theirs.reduce((s, p) => s + side(other, p.pin), 0)
  }, 0)

  // Room a symbol needs beyond its body on one side for ports and labels; a pin wired straight to `next` needs none.
  const netOf = new Map(nets.flatMap((net) => net.pins.map((p) => [`${p.component}/${p.pin}`, net] as const)))
  const reach = (c: ArrangeItem, dir: number, next?: ArrangeItem) => Math.max(1, ...Object.entries(c.sides ?? {}).filter(([, s]) => s === dir).map(([pin]) => {
    const net = netOf.get(`${c.component}/${pin}`)
    if (!net) return 1
    if (next && !isGlobalNet(net) && net.pins.length === 2 && net.pins.some((p) => p.component === next.component && next.sides?.[p.pin ?? ""] === -dir)) return 1
    return 4 + (netStyle(net.name) === "ground" ? 2 : net.name.length * 1.05)
  }))
  /** Left edge of each symbol in a row, relative to the row start, and the row's width including outer ports and titles. */
  const lay = (cells: ArrangeItem[]) => {
    const at: number[] = []
    cells.forEach((c, i) => {
      const prev = cells[i - 1]
      at.push(prev ? Math.max(at[i - 1]! + bodyWidth(prev) + reach(prev, 1, c) + reach(c, -1, prev) + GAP_X, at[i - 1]! + (prev.title ?? 0) + GAP_X) : reach(c, -1))
    })
    const last = cells.at(-1)!, end = at.at(-1)!
    return { at, width: Math.max(end + bodyWidth(last) + reach(last, 1), end + (last.title ?? 0)) }
  }

  const groups = [...clusters.values()].map((members) => {
    const inside = (id: string) => [...weight.get(id)!].filter(([other]) => members.includes(other))
    const score = (id: string) => inside(id).reduce((sum, [, w]) => sum + w, 0)
    const start = [...members].sort((a, b) => score(b) - score(a) || order.get(a)! - order.get(b)!)[0]!
    const seen = [start]
    for (let i = 0; i < seen.length; i++) {
      for (const [id] of inside(seen[i]!).sort((a, b) => b[1] - a[1] || order.get(a[0])! - order.get(b[0])!)) if (!seen.includes(id)) seen.push(id)
    }
    for (const id of members) if (!seen.includes(id)) seen.push(id)
    // The most connected part sits in the middle. Each other part goes beside its strongest placed neighbour,
    // on the side their shared pins face; with no preference, neighbours alternate right and left.
    const row = [start]
    seen.slice(1).forEach((id, i) => {
      const anchor = [...inside(id)].filter(([other]) => row.includes(other)).sort((a, b) => b[1] - a[1])[0]?.[0]
      const lean = anchor ? facing(anchor, id) : 0
      if (lean > 0) row.splice(row.indexOf(anchor!) + 1, 0, id)
      else if (lean < 0) row.splice(row.indexOf(anchor!), 0, id)
      else if (i % 2) row.unshift(id)
      else row.push(id)
    })
    const cells = row.flatMap((id) => items.filter((item) => item.component === id))
    const top = Math.min(...cells.map((c) => c.bounds.min[1])), bottom = Math.max(...cells.map((c) => c.bounds.max[1] + (c.below ?? 0)))
    // Parts joined only by rails don't need to stay in one row.
    const runs = members.every((id) => loose.includes(id)) ? cells.map((c) => [c]) : [cells]
    return { runs, top, width: lay(cells).width, height: bottom - top, hub: members.some((id) => hubs.has(id)), first: Math.min(...members.map((id) => order.get(id)!)) }
  }).sort((a, b) => Number(b.hub) - Number(a.hub) || a.first - b.first)

  // Pack groups in rows; of a few row widths, keep the layout closest to a landscape sheet.
  const pack = (shelf: number) => {
    const placed = new Map<string, XY>()
    let x = 0, y = 0, rowHeight = 0, width = 0
    for (const g of groups) {
      g.runs.forEach((cells, i) => {
        if (i > 0 && x > 0) x -= GROUP_X - GAP_X
        const run = lay(cells)
        if (x > 0 && x + run.width > shelf) { x = 0; y += rowHeight + GROUP_Y; rowHeight = 0 }
        cells.forEach((c, k) => placed.set(`${c.component}/${c.unit}`, [snap(origin[0] + x + run.at[k]! - c.bounds.min[0]), snap(origin[1] + y - g.top)]))
        x += run.width + GROUP_X
        width = Math.max(width, x - GROUP_X)
        rowHeight = Math.max(rowHeight, g.height)
      })
    }
    return { placed, fit: Math.abs(Math.log(width / (y + rowHeight) / 1.3)) }
  }
  const widest = Math.max(...groups.flatMap((g) => g.runs.map((cells) => lay(cells).width))), total = groups.reduce((sum, g) => sum + g.width + GROUP_X, 0)
  const layouts = Array.from({ length: 13 }, (_, i) => pack(widest + (total - widest) * i / 12))
  return layouts.reduce((best, layout) => layout.fit < best.fit - 1e-9 ? layout : best).placed
}
