export type Point = [number, number]

/** Hit-test in sheet coordinates; callers convert a fixed pixel radius using the SVG screen scale. */
export function nearestCircuitPin(point: Point, pins: ReadonlyMap<string, Point>, radius: number, exclude?: string): string | null {
  if (!point.every(Number.isFinite) || !Number.isFinite(radius) || radius < 0) return null
  let nearest: string | null = null
  let distance = radius
  for (const [key, at] of pins) {
    if (key === exclude) continue
    const current = Math.hypot(point[0] - at[0], point[1] - at[1])
    if (current <= distance && (nearest === null || current < distance)) { nearest = key; distance = current }
  }
  return nearest
}

export const circuitWirePath = (from: Point, to: Point) =>
  `M${from[0]} ${from[1]} H${(from[0] + to[0]) / 2} V${to[1]} H${to[0]}`
