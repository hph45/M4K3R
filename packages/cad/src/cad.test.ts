import { applyCommands, emptyProject, registerCommands, registerDocKind, type Command, type Variable } from "@m4k3r/core"
import { beforeAll, describe, expect, it } from "vitest"
import {
  cadCommands, evaluateStudio, exportStep, exportStl, loadKernel, meshBodies, PartStudio, properties, type FeatureInput,
} from "./index"

const studio = (...features: FeatureInput[]) =>
  PartStudio.parse({ features: features.map((f, i) => ({ id: `f${i}`, ...f })) })

const run = async (features: FeatureInput[], variables: Variable[] = []) => {
  const ev = await evaluateStudio(studio(...features), variables)
  return { ev, props: properties(ev) }
}

const box: FeatureInput[] = [
  { type: "sketch", id: "base", entities: [{ type: "rectangle", id: "r", width: 40, height: 20 }] },
  { type: "extrude", id: "body", sketch: "base", depth: 10 },
]

beforeAll(() => loadKernel(), 30_000)

describe("part studio", () => {
  it("extrudes a rectangle to an exact volume", async () => {
    const { ev, props } = await run(box)
    expect(ev.error).toBeUndefined()
    expect(props.volume).toBeCloseTo(8000, 6)
    expect(props.area).toBeCloseTo(2 * 800 + 2 * 400 + 2 * 200, 6)
    expect(props.bbox).toEqual({ min: [-20, -10, 0], max: [20, 10, 10], size: [40, 20, 10] })
    expect(props.centerOfMass.map((v) => +v.toFixed(6))).toEqual([0, 0, 5])
    expect(props.mass).toBeCloseTo(8 * 1.24, 6) // 8 cm³ of PLA
  })

  it("extrudes symmetric, reversed and on offset planes", async () => {
    const { props } = await run([
      { type: "sketch", id: "s", plane: "XZ", offset: 5, entities: [{ type: "circle", id: "c", center: [0, 0], radius: 5 }] },
      { type: "extrude", sketch: "s", depth: 10, symmetric: true },
    ])
    expect(props.bbox).toEqual({ min: [-5, -10, -5], max: [5, 0, 5], size: [10, 10, 10] })
    expect(props.volume).toBeCloseTo(Math.PI * 25 * 10, 3)
  })

  it("subtracts a profile and drills holes", async () => {
    const { props } = await run([
      ...box,
      { type: "sketch", id: "cut", plane: "XY", offset: 10, entities: [{ type: "circle", id: "c", center: [-10, 0], radius: 4 }] },
      { type: "extrude", sketch: "cut", depth: 5, reverse: true, op: "subtract" },
      { type: "sketch", id: "holes", plane: "XY", offset: 10, entities: [{ type: "point", id: "p", at: [10, 0] }] },
      { type: "hole", sketch: "holes", size: "M3", through: true },
    ])
    expect(props.volume).toBeCloseTo(8000 - Math.PI * 16 * 5 - Math.PI * 1.7 ** 2 * 10, 2)
  })

  it("fills holes inside a profile with the even-odd rule", async () => {
    const { props } = await run([
      {
        type: "sketch", id: "s",
        entities: [{ type: "rectangle", id: "r", width: 40, height: 20 }, { type: "circle", id: "c", center: [0, 0], radius: 5 }],
      },
      { type: "extrude", sketch: "s", depth: 10 },
    ])
    expect(props.volume).toBeCloseTo(8000 - Math.PI * 25 * 10, 2)
  })

  it("fillets and chamfers selected edges", async () => {
    const fillet = await run([...box, { type: "fillet", edges: { direction: "z" }, radius: 2 }])
    expect(fillet.props.volume).toBeCloseTo(8000 - 4 * (4 - Math.PI) * 10, 1)
    const chamfer = await run([...box, { type: "chamfer", edges: { z: 10 }, distance: 1 }])
    expect(chamfer.props.volume).toBeCloseTo(8000 - (2 * 40 + 2 * 20) * 0.5 + 4 / 3, 3) // corners overlap
  })

  it("shells a body, opening the top", async () => {
    const { props } = await run([...box, { type: "shell", faces: { normal: "+z" }, thickness: 2 }])
    expect(props.volume).toBeCloseTo(8000 - 36 * 16 * 8, 3)
  })

  it("revolves a profile around a sketch axis", async () => {
    const { props } = await run([
      { type: "sketch", id: "s", plane: "XZ", entities: [{ type: "rectangle", id: "r", corner: [5, 0], width: 5, height: 20 }] },
      { type: "revolve", sketch: "s", axis: "y" },
    ])
    expect(props.volume).toBeCloseTo(Math.PI * (100 - 25) * 20, 2)
  })

  it("patterns, mirrors and combines bodies", async () => {
    const holes = await run([
      ...box,
      { type: "sketch", id: "h", offset: 10, entities: [{ type: "point", id: "p", at: [-15, 0] }] },
      { type: "hole", id: "hole", sketch: "h", diameter: 2, through: true },
      { type: "linearPattern", features: ["hole"], direction: "x", count: 4, spacing: 10 },
    ])
    expect(holes.props.volume).toBeCloseTo(8000 - 4 * Math.PI * 10, 2)

    const ring = await run([
      ...box,
      { type: "sketch", id: "h", offset: 10, entities: [{ type: "point", id: "p", at: [5, 0] }] },
      { type: "hole", id: "hole", sketch: "h", diameter: 2, through: true },
      { type: "circularPattern", features: ["hole"], axis: "z", count: 6 },
    ])
    expect(ring.props.volume).toBeCloseTo(8000 - 6 * Math.PI * 10, 2)

    const mirrored = await run([
      { type: "sketch", id: "s", entities: [{ type: "rectangle", id: "r", corner: [5, 0], width: 10, height: 10 }] },
      { type: "extrude", sketch: "s", depth: 10 },
      { type: "mirror", body: "f1", plane: "YZ" },
    ])
    expect(mirrored.props.volume).toBeCloseTo(2000, 3)
    expect(mirrored.props.bbox?.size).toEqual([30, 10, 10])

    const combined = await run([
      ...box,
      { type: "sketch", id: "s2", entities: [{ type: "circle", id: "c", center: [20, 0], radius: 5 }] },
      { type: "extrude", id: "peg", sketch: "s2", depth: 10, op: "new" },
      { type: "boolean", op: "subtract", target: "body", tools: ["peg"] },
    ])
    expect(combined.ev.bodies.map((b) => b.id)).toEqual(["body"])
    expect(combined.props.volume).toBeCloseTo(8000 - (Math.PI * 25 * 10) / 2, 2)
  })

  it("drives dimensions from variables and re-evaluates when they change", async () => {
    const features: FeatureInput[] = [
      { type: "sketch", id: "s", entities: [{ type: "rectangle", id: "r", width: "pcb_w + 2*wall", height: "20 mm" }] },
      { type: "extrude", sketch: "s", depth: "wall * 5" },
    ]
    const a = await run(features, [{ name: "pcb_w", value: "36 mm" }, { name: "wall", value: "2" }])
    expect(a.props.volume).toBeCloseTo(40 * 20 * 10, 6)
    const b = await run(features, [{ name: "pcb_w", value: "46 mm" }, { name: "wall", value: "2" }])
    expect(b.props.volume).toBeCloseTo(50 * 20 * 10, 6)
  })

  it("solves constraints to the dimensioned size", async () => {
    const { ev, props } = await run([
      {
        type: "sketch", id: "s",
        entities: [{ type: "rectangle", id: "r", corner: [3, 4], width: 10, height: 10 }],
        constraints: [
          { type: "coincident", a: "r.bl", b: "origin" },
          { type: "distance", a: "r.bottom", value: 30 },
          { type: "distance", a: "r.left", value: "15 mm" },
        ],
      },
      { type: "extrude", sketch: "s", depth: 2 },
    ])
    const sketch = ev.features[0]!.sketch!
    expect(sketch.status).toBe("full")
    expect(sketch.dof).toBe(0)
    expect(props.bbox).toEqual({ min: [0, 0, 0], max: [30, 15, 2], size: [30, 15, 2] })
  })

  it("closes polygons drawn from lines and solves line constraints", async () => {
    const { ev, props } = await run([
      {
        type: "sketch", id: "s",
        entities: [
          { type: "line", id: "a", start: [0, 0], end: [10, 0] },
          { type: "line", id: "b", start: [10, 0], end: [0, 8] },
          { type: "line", id: "c", start: [0, 8], end: [0, 0] },
        ],
        constraints: [
          { type: "fix", a: "a.start" },
          { type: "horizontal", a: "a" },
          { type: "vertical", a: "c" },
          { type: "distance", a: "a", value: 20 },
          { type: "equal", a: "a", b: "c" },
        ],
      },
      { type: "extrude", sketch: "s", depth: 1 },
    ])
    expect(ev.features[0]!.sketch!.status).toBe("full")
    expect(props.volume).toBeCloseTo(200, 6)
  })

  it("stops at a failing feature with a clear error", async () => {
    const { ev } = await run([
      ...box,
      { type: "fillet", edges: { direction: "z" }, radius: 50 },
      { type: "chamfer", edges: "all", distance: 1 },
    ])
    expect(ev.error?.feature).toBe("f2")
    expect(ev.error?.message).toMatch(/Fillet failed/)
    expect(ev.features.map((f) => f.status)).toEqual(["ok", "ok", "error", "skipped"])
    expect(properties(ev).volume).toBeCloseTo(8000, 6) // the model just before the failure

    const errors = await Promise.all([
      run([{ type: "sketch", entities: [{ type: "rectangle", id: "r", width: "nope", height: 1 }] }]),
      run([{ type: "sketch", entities: [{ type: "line", id: "l", start: [0, 0], end: [1, 0] }] }, { type: "extrude", sketch: "f0", depth: 1 }]),
      run([...box, { type: "fillet", edges: { near: [100, 100, 100] }, radius: 1 }]),
      run([...box, { type: "sketch", id: "s", offset: 30, entities: [{ type: "point", id: "p", at: [0, 0] }] }, { type: "hole", sketch: "s", diameter: 3, depth: 5 }]),
      run([
        {
          type: "sketch", entities: [{ type: "line", id: "l", start: [0, 0], end: [1, 0] }],
          constraints: [{ type: "distance", a: "l", value: 5 }, { type: "distance", a: "l", value: 6 }],
        },
      ]),
    ])
    expect(errors.map(({ ev }) => ev.error?.message)).toEqual([
      expect.stringMatching(/Unknown variable "nope"/),
      expect.stringMatching(/open profile at \(0, 0\)/),
      expect.stringMatching(/No edge at \(100, 100, 100\)/),
      expect.stringMatching(/removes no material/),
      expect.stringMatching(/over-constrained.*constraints\[0\] distance; constraints\[1\] distance/),
    ])
  })

  it("meshes and exports", async () => {
    const { ev } = await run(box)
    const [mesh] = meshBodies(ev)
    expect(mesh!.positions.length).toBeGreaterThan(0)
    expect(mesh!.indices.length % 3).toBe(0)
    expect(mesh!.edges.length).toBe(12 * 2 * 3)
    expect(mesh!.faces).toHaveLength(6)
    const stl = await exportStl(ev)
    expect(stl.length).toBe(84 + 50 * 12)
    const step = new TextDecoder().decode(await exportStep(ev))
    expect(step).toMatch(/^ISO-10303-21;/)
    expect(step).toContain("body")
  })

  it("keeps the previous solid when an intersect feature removes everything", async () => {
    const { ev, props } = await run([
      ...box,
      { type: "sketch", id: "outside", entities: [{ type: "rectangle", id: "r", center: [100, 100], width: 10, height: 10 }] },
      { type: "extrude", sketch: "outside", depth: 5, op: "intersect" },
    ])
    expect(ev.error?.message).toMatch(/leaves nothing/)
    expect(props.volume).toBe(8000)
    expect(meshBodies(ev)[0]!.indices).toHaveLength(36)
    expect(() => exportStl(ev)).toThrow(/Can't export/)
  })

  it("builds a rounded enclosure with an open, constant thickness wall", async () => {
    const { ev, props } = await run([
      { type: "sketch", id: "base", entities: [{ type: "rectangle", id: "outline", width: 70, height: 45 }] },
      { type: "extrude", id: "case", sketch: "base", depth: 22 },
      { type: "fillet", id: "corners", edges: { direction: "z" }, radius: 4 },
      { type: "shell", id: "walls", faces: { normal: "+z" }, thickness: 2 },
    ])
    expect(ev.error).toBeUndefined()
    const outer = 70 * 45 - (4 - Math.PI) * 4 ** 2
    const inner = 66 * 41 - (4 - Math.PI) * 2 ** 2
    expect(props.volume).toBeCloseTo(outer * 22 - inner * 20, 3)
    expect(props.bbox?.size).toEqual([70, 45, 22])
  })

  it("caches evaluations by content", async () => {
    const data = studio(...box)
    const a = evaluateStudio(data, [])
    expect(evaluateStudio(structuredClone(data), [])).toBe(a)
    expect(evaluateStudio(data, [{ name: "x", value: "1" }])).not.toBe(a)
  })
})

describe("cad commands", () => {
  registerDocKind("part-studio", PartStudio)
  registerCommands(cadCommands)
  let n = 0
  const apply = (...batch: Command[]) =>
    applyCommands(emptyProject("p", "P"), batch, { resolvePart: () => undefined, newId: (p) => `${p}_${++n}` })

  it("builds a part in one batch", async () => {
    const { project, results } = apply(
      { type: "variable.set", args: { name: "wall", value: "2 mm" } },
      { type: "doc.create", args: { kind: "part-studio", name: "Case" } },
      { type: "cad.sketch.add", args: { doc: "Case", entities: [{ type: "rectangle", id: "r", width: 30, height: 20 }] } },
      { type: "cad.feature.add", args: { doc: "Case", feature: { type: "extrude", sketch: "sketch1", depth: 10 } } },
      { type: "cad.feature.add", args: { doc: "Case", feature: { type: "shell", faces: { normal: "+z" }, thickness: "wall" } } },
      { type: "cad.material.set", args: { doc: "Case", material: "PETG" } },
    )
    expect(results.slice(2, 5)).toEqual([{ id: "sketch1" }, { id: "extrude1" }, { id: "shell1" }])
    const data = project.docs[0]!.data as PartStudio
    expect(data.material).toBe("PETG")
    const ev = await evaluateStudio(data, project.variables)
    expect(properties(ev, data.material).volume).toBeCloseTo(6000 - 26 * 16 * 8, 3)
  })

  it("updates, moves and removes features, keeping references valid", () => {
    const base = apply(
      { type: "doc.create", args: { kind: "part-studio", name: "A" } },
      { type: "cad.sketch.add", args: { doc: "A", id: "s", entities: [] } },
      { type: "cad.feature.add", args: { doc: "A", feature: { type: "extrude", id: "e", sketch: "s", depth: 1 } } },
    ).project
    const next = (...batch: Command[]) =>
      applyCommands(base, batch, { resolvePart: () => undefined, newId: (p) => `${p}_${++n}` }).project
    const updated = next({ type: "cad.feature.update", args: { doc: "A", feature: "e", set: { depth: null, through: true } } })
    expect((updated.docs[0]!.data as PartStudio).features[1]).toEqual({ type: "extrude", id: "e", sketch: "s", through: true })
    expect(() => next({ type: "cad.feature.remove", args: { doc: "A", feature: "s" } })).toThrow(/"e" uses "s"/)
    expect(() => next({ type: "cad.feature.move", args: { doc: "A", feature: "e", before: "s" } })).toThrow(/earlier feature/)
    expect(() => next({ type: "cad.feature.add", args: { doc: "A", feature: { type: "extrude", sketch: "nope", depth: "1 +" } } })).toThrow(
      /Unexpected end/,
    )
  })
})
