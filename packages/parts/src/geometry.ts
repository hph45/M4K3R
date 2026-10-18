export type XY = [number, number]

/** Points along the circular arc through start, mid and end. */
export function arcPoints(s: XY, m: XY, e: XY, n = 16): XY[] {
  const [ax, ay] = s, [bx, by] = m, [cx, cy] = e
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
  if (Math.abs(d) < 1e-12) return [s, m, e]
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d
  const r = Math.hypot(ax - ux, ay - uy)
  const turn = (a: number) => ((a % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  const a0 = Math.atan2(ay - uy, ax - ux)
  let sweep = turn(Math.atan2(cy - uy, cx - ux) - a0)
  if (turn(Math.atan2(by - uy, bx - ux) - a0) > sweep) sweep -= 2 * Math.PI
  return Array.from({ length: n + 1 }, (_, i): XY => {
    const a = a0 + (sweep * i) / n
    return [ux + r * Math.cos(a), uy + r * Math.sin(a)]
  })
}

/** Points along a cubic Bézier curve. */
export function bezierPoints([p0, p1, p2, p3]: XY[], n = 12): XY[] {
  if (!p0 || !p1 || !p2 || !p3) return [p0, p1, p2, p3].filter((p) => !!p)
  return Array.from({ length: n + 1 }, (_, i): XY => {
    const t = i / n, u = 1 - t
    const [a, b, c, d] = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t]
    return [a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]]
  })
}

export function bounds(points: XY[]): { min: XY; max: XY } {
  const r = (n: number) => Math.round(n * 1e4) / 1e4
  const xs = points.map((p) => p[0]), ys = points.map((p) => p[1])
  if (!points.length) return { min: [0, 0], max: [0, 0] }
  return { min: [r(Math.min(...xs)), r(Math.min(...ys))], max: [r(Math.max(...xs)), r(Math.max(...ys))] }
}

/** Corners of a w×h rectangle centered at `at`, rotated `rot` degrees counter-clockwise (y down). */
export function rectCorners(at: XY, [w, h]: XY, rot = 0): XY[] {
  const a = (-rot * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a)
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(
    ([x, y]): XY => [at[0] + x! * cos - y! * sin, at[1] + x! * sin + y! * cos],
  )
}
