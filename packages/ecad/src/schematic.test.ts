import { applyCommands, emptyProject, Part, registerCommands, registerDocKind, replay, type Command, type Project } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { erc, SchematicData, schematicCommands, schematicDoc, symbolGeometry, symbolPoint } from "./index"

registerDocKind("schematic", SchematicData)
registerCommands(schematicCommands)
const resistor = Part.parse({ id: "r", name: "Resistor", refPrefix: "R", pins: [{ num: "1", name: "A" }, { num: "2", name: "B" }] })
let id = 0
const ctx = { resolvePart: () => resistor, newId: (prefix: string) => `${prefix}_${++id}` }
const run = (p: Project, ...commands: Command[]) => applyCommands(p, commands, ctx)
function fixture() {
  return run(emptyProject("p", "Test"),
    { type: "doc.create", args: { kind: "schematic", name: "Circuit" } },
    { type: "component.add", args: { part: "r" } },
    { type: "component.add", args: { part: "r" } },
    { type: "net.connect", args: { pins: ["R1.A", "R2.A"], name: "SIGNAL" } },
  ).project
}

describe("schematic layout", () => {
  it("stores editable wire bends and annotations while sharing electrical connectivity", () => {
    const base = fixture()
    let p = run(base, { type: "schematic.wire.add", args: { doc: "Circuit", pins: ["R1.B", "R2.B"], bends: [[40, 20], [40, 60]], name: "RETURN" } }).project
    const wire = schematicDoc(p, "Circuit").wires[0]!
    expect(p.nets.find((n) => n.name === "RETURN")?.pins).toHaveLength(2)
    const changed = run(p, { type: "schematic.wire.update", args: { doc: "Circuit", id: wire.id, bends: [[45, 20], [45, 60]] } })
    expect(schematicDoc(changed.project, "Circuit").wires[0]!.bends[0]).toEqual([45, 20])
    expect(schematicDoc(replay(changed.project, changed.inversePatches).project, "Circuit").wires[0]!.bends).toEqual(wire.bends)
    p = run(p, { type: "schematic.label.set", args: { doc: "Circuit", net: "RETURN", at: [20, 30] } }, { type: "schematic.junction.add", args: { doc: "Circuit", net: "RETURN", at: [40, 30] } }, { type: "schematic.no-connect", args: { doc: "Circuit", pins: ["R1.B"] } }).project
    expect(erc(p).some((c) => c.code === "no-connect-wired")).toBe(true)
    expect(schematicDoc(p, "Circuit").labels[0]!.net).toBe(p.nets.find((n) => n.name === "RETURN")!.id)
    p = run(p, { type: "schematic.annotation.remove", args: { doc: "Circuit", id: wire.id } }).project
    expect(schematicDoc(p, "Circuit").wires).toEqual([])
    expect(p.nets.find((n) => n.name === "RETURN")?.pins).toHaveLength(2)
  })
  it("places each imported gate independently while retaining one component and physical pin list", () => {
    const part = Part.parse({ id: "dual", name: "Dual gate", refPrefix: "U", pins: [{ num: "1", name: "A" }, { num: "2", name: "B" }], symbol: { units: [{ graphics: [], pins: [{ num: "1", at: [-5, 0], rot: 0, length: 2 }] }, { graphics: [], pins: [{ num: "2", at: [-5, 0], rot: 0, length: 2 }] }] } })
    let p = run(fixture(), { type: "part.vendor", args: { part } }, { type: "component.add", args: { part: "dual" } }, { type: "schematic.autoplace", args: { doc: "Circuit" } }).project
    const c = p.components.find((c) => c.ref === "U1")!, original = schematicDoc(p, "Circuit").symbols.filter((s) => s.component === c.id)
    expect(original).toHaveLength(2)
    p = run(p, { type: "schematic.place", args: { doc: "Circuit", component: "U1", unit: 1, x: 99, y: 33 } }).project
    expect(schematicDoc(p, "Circuit").symbols.find((s) => s.component === c.id && s.unit === 1)?.x).toBe(99)
    expect(schematicDoc(p, "Circuit").symbols.find((s) => s.component === c.id && !s.unit)?.x).toBe(original[0]!.x)
    expect(symbolGeometry(part, 1).pins[0]?.num).toBe("2")
  })
  it("adds a part at its drop position with core ref numbering, and undoes the component and placement together", () => {
    const p = fixture()
    const added = run(p, { type: "schematic.add", args: { doc: "Circuit", part: "r", x: 42, y: 67, props: { value: "330" } } })
    const c = added.project.components.find((c) => c.ref === "R3")!
    expect(c.props.value).toBe("330")
    expect(schematicDoc(added.project, "Circuit").symbols).toContainEqual({ component: c.id, x: 42, y: 67, rotation: 0 })
    expect(added.project.nets).toEqual(p.nets)
    const undone = replay(added.project, added.inversePatches)
    expect(undone.project.components).toEqual(p.components)
    expect(schematicDoc(undone.project, "Circuit").symbols).toEqual([])
    expect(() => run(p, { type: "schematic.add", args: { doc: "missing", part: "r", x: 0, y: 0 } })).toThrow(/No doc/)
    expect(p.components).toHaveLength(2)
  })

  it("creates a new circuit on its first part drop as one undo step", () => {
    const base = emptyProject("new", "New circuit")
    const dropped = run(base, { type: "doc.create", args: { kind: "schematic", name: "Circuit" } },
      { type: "schematic.add", args: { doc: "Circuit", part: "r", x: 80, y: 35 } })
    expect(dropped.project.components[0]?.ref).toBe("R1")
    expect(schematicDoc(dropped.project, "Circuit").symbols[0]).toMatchObject({ x: 80, y: 35 })
    const undone = replay(dropped.project, dropped.inversePatches)
    expect(undone.project.docs).toEqual([])
    expect(undone.project.components).toEqual([])
    expect(undone.project.parts).toEqual({})
  })
  it("autoplaces components without changing the shared connectivity and replays undo/redo", () => {
    const p = fixture()
    const change = run(p, { type: "schematic.autoplace", args: { doc: "Circuit" } })
    const symbols = schematicDoc(change.project, "Circuit").symbols
    expect(symbols).toHaveLength(2)
    expect(new Set(symbols.map((s) => `${s.x},${s.y}`)).size).toBe(2)
    expect(change.project.nets).toEqual(p.nets)
    const undone = replay(change.project, change.inversePatches)
    expect(schematicDoc(undone.project, "Circuit").symbols).toEqual([])
    const redone = replay(undone.project, undone.inversePatches)
    expect(schematicDoc(redone.project, "Circuit").symbols).toEqual(symbols)
  })

  it("moves by component ref, preserves rotation and keeps manual placements on additive autoplace", () => {
    let p = fixture()
    p = run(p, { type: "schematic.place", args: { doc: "Circuit", component: "R1", x: 60, y: 20, rotation: 90 } }).project
    p = run(p, { type: "schematic.place", args: { doc: "Circuit", component: "R1", x: 65, y: 25 } },
      { type: "schematic.autoplace", args: { doc: "Circuit" } }).project
    expect(schematicDoc(p, "Circuit").symbols[0]).toMatchObject({ x: 65, y: 25, rotation: 90 })
    expect(schematicDoc(p, "Circuit").symbols).toHaveLength(2)
    expect(symbolPoint({ component: "r", x: 10, y: 10, rotation: 90 }, [5, 0])[1]).toBeCloseTo(5)
  })

  it("rejects invalid coordinates, duplicate placements and unknown components atomically", () => {
    const p = fixture()
    expect(() => run(p, { type: "schematic.place", args: { doc: "Circuit", component: "R1", x: 0, y: 0 } },
      { type: "schematic.place", args: { doc: "Circuit", component: "R99", x: 0, y: 0 } })).toThrow(/No component/)
    expect(schematicDoc(p, "Circuit").symbols).toEqual([])
    expect(() => run(p, { type: "schematic.place", args: { doc: "Circuit", component: "R1", x: Infinity, y: 0 } })).toThrow()
    expect(SchematicData.safeParse({ symbols: [{ component: "c", x: 0, y: 0 }, { component: "c", x: 1, y: 1 }] }).success).toBe(false)
  })

  it("unplaces without removing the component or its net and removes stale placements on autoplace", () => {
    let p = fixture()
    p = run(p, { type: "schematic.autoplace", args: { doc: "Circuit" } },
      { type: "schematic.remove", args: { doc: "Circuit", component: "R1" } }).project
    expect(p.components).toHaveLength(2)
    expect(p.nets[0]?.pins).toHaveLength(2)
    expect(schematicDoc(p, "Circuit").symbols).toHaveLength(1)
    p = run(p, { type: "component.remove", args: { component: "R2" } },
      { type: "schematic.autoplace", args: { doc: "Circuit" } }).project
    expect(schematicDoc(p, "Circuit").symbols.map((s) => s.component)).toEqual([p.components[0]!.id])
    expect(symbolGeometry(resistor).pins).toHaveLength(2)
  })
})
