import { CommandError, type Project } from "@m4k3r/core"
import { pointInPolygon, pointSegmentDistance, polygonDistance } from "./checks"
import { boardCopper, capsule, pcbDrills, shape, type MultiPolygon } from "./pcb-geometry"
import type { CopperLayer, PcbData, Point2 } from "./pcb-schema"

/** Clearance-aware 45°/90° walkaround. Existing copper is never pushed or silently changed. */
export function routeBetween(project: Project, data: PcbData, from: Point2, to: Point2, net: string, layer: CopperLayer, width: number): Point2[] {
  const clearance = Math.max(data.rules.clearance, data.netClasses.find((c) => c.name === data.assignments[net])?.clearance ?? 0)
  const obstacles: MultiPolygon[] = boardCopper(project, data).filter((c) => c.layer === layer && c.net !== net).map((c) => c.polygon)
  obstacles.push(...pcbDrills(project, data).filter((d) => !d.plated).map((d) => capsule(d.at, d.end ?? d.at, d.diameter)))
  const board = shape(data.outline), margin = width / 2 + data.rules.edgeClearance
  const inside = (p: Point2) => pointInPolygon(p, board) && data.outline.every((a, i) => pointSegmentDistance(p, a, data.outline[(i + 1) % data.outline.length]!) + 1e-6 >= margin)
  const clear = (a: Point2, b: Point2) => inside(a) && inside(b) && obstacles.every((o) => polygonDistance(capsule(a, b, width), o) + 1e-5 >= clearance)
  for (const path of [[from, to], [from, [to[0], from[1]] as Point2, to], [from, [from[0], to[1]] as Point2, to]]) if (path.slice(1).every((p, i) => clear(path[i]!, p))) return path.filter((p, i) => !i || Math.hypot(p[0] - path[i - 1]![0], p[1] - path[i - 1]![1]) > 1e-8)
  const grid = Math.max(0.5, width + clearance), key = (p: Point2) => `${Math.round(p[0] / grid)},${Math.round(p[1] / grid)}`
  const start: Point2 = [Math.round(from[0] / grid) * grid, Math.round(from[1] / grid) * grid], end: Point2 = [Math.round(to[0] / grid) * grid, Math.round(to[1] / grid) * grid]
  if (!clear(from, start) || !clear(end, to)) throw new CommandError("Route cannot leave this pad at the chosen width/clearance. Try another layer or width.")
  const open = [{ p: start, cost: 0, score: Math.hypot(start[0] - end[0], start[1] - end[1]) }], best = new Map([[key(start), 0]]), previous = new Map<string, Point2>()
  let found = false, visits = 0
  while (open.length && visits++ < 12000) {
    open.sort((a, b) => b.score - a.score)
    const current = open.pop()!, currentKey = key(current.p)
    if (current.cost > best.get(currentKey)! + 1e-9) continue
    if (currentKey === key(end)) { found = true; break }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const p: Point2 = [current.p[0] + dx! * grid, current.p[1] + dy! * grid], cost = current.cost + Math.hypot(dx!, dy!) * grid, k = key(p)
      if (cost >= (best.get(k) ?? Infinity) || !clear(current.p, p)) continue
      best.set(k, cost); previous.set(k, current.p); open.push({ p, cost, score: cost + Math.hypot(p[0] - end[0], p[1] - end[1]) })
    }
  }
  if (!found) throw new CommandError("No clearance-safe route found. Add a via/use the other layer, move parts, or reduce width within manufacturing limits.")
  const points: Point2[] = [end]
  while (key(points[0]!) !== key(start)) points.unshift(previous.get(key(points[0]!))!)
  const all = [from, ...points, to], simplified: Point2[] = []
  for (const p of all) { if (simplified.length && Math.hypot(p[0] - simplified.at(-1)![0], p[1] - simplified.at(-1)![1]) < 1e-8) continue; while (simplified.length >= 2) { const a = simplified.at(-2)!, b = simplified.at(-1)!; if (Math.abs((b[0] - a[0]) * (p[1] - b[1]) - (b[1] - a[1]) * (p[0] - b[0])) > 1e-8) break; simplified.pop() } simplified.push(p) }
  return simplified
}
