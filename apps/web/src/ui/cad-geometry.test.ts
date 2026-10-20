import { expect, it } from "vitest"
import { modelBounds, rotate, sketchSegments, triangleDepthAt, visibleEdgeSpans, type ProjectedTriangle } from "./cad-geometry"

it("projects sketch geometry on its actual offset plane", () => {
  const segments = sketchSegments({
    plane: { origin: [0, -5, 0], xDir: [1, 0, 0], yDir: [0, 0, 1], normal: [0, -1, 0] },
    status: "under", dof: 4, redundant: [],
    entities: [{ id: "r", type: "rectangle", corners: [[0, 0], [20, 0], [20, 10], [0, 10]] }],
  })
  expect(segments[1]).toEqual([[20, -5, 0], [20, -5, 10]])
  expect(modelBounds([], [segments])).toEqual({ center: [10, -5, 5], radius: Math.sqrt(500) / 2 })
})

it("preserves distances while orbiting and closes sampled circles", () => {
  const rotated = rotate([3, 4, 12], { yaw: 0.6, pitch: 0.8, zoom: 1 })
  expect(Math.hypot(...rotated)).toBeCloseTo(13)
  const segments = sketchSegments({
    plane: { origin: [0, 0, 0], xDir: [1, 0, 0], yDir: [0, 1, 0], normal: [0, 0, 1] },
    status: "under", dof: 3, redundant: [], entities: [{ id: "c", type: "circle", center: [2, 3], radius: 10 }],
  })
  expect(segments[0]![0]).toEqual([12, 3, 0])
  expect(segments.at(-1)![1][0]).toBeCloseTo(12)
  expect(segments.at(-1)![1][1]).toBeCloseTo(3)
})

it("interpolates orthographic depth for either triangle winding", () => {
  const triangle: ProjectedTriangle = [[0, 0, 0], [12, 0, 12], [0, 12, 24]]
  expect(triangleDepthAt(3, 3, triangle)).toBe(9)
  expect(triangleDepthAt(3, 3, [triangle[2], triangle[1], triangle[0]])).toBe(9)
  expect(triangleDepthAt(10, 10, triangle)).toBeUndefined()
  expect(triangleDepthAt(2, 0, [[0, 0, 1], [3, 0, 2], [6, 0, 3]])).toBeUndefined()
})

it("hides edges behind a surface while retaining coplanar and nearer edges", () => {
  const wall: ProjectedTriangle = [[0, -10, 5], [20, -10, 5], [0, 10, 5]]
  expect(visibleEdgeSpans([[1, 0, 0], [9, 0, 0]], [wall])).toEqual([])
  expect(visibleEdgeSpans([[1, 0, 5], [9, 0, 5]], [wall])).toEqual([[[1, 0, 5], [9, 0, 5]]])
  expect(visibleEdgeSpans([[1, 0, 6], [9, 0, 6]], [wall])).toHaveLength(1)
  const partial = visibleEdgeSpans([[-10, 0, 0], [20, 0, 0]], [wall], 1e-5, 1)
  expect(partial).toEqual([[[-10, 0, 0], [0, 0, 0]], [[10, 0, 0], [20, 0, 0]]])
})
