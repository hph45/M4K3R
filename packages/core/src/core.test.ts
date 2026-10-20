import { describe, expect, it } from "vitest"
import { z } from "zod"
import {
  applyCommands, registerDocKind, describeCommands, emptyProject, formatQuantity, netlist, netlistText, parseQuantity, Part, replay,
  type Command, type CommandContext, type Project,
} from "./index"

const parts: Record<string, Part> = {
  resistor: Part.parse({
    id: "resistor", name: "Resistor", refPrefix: "R", props: { value: "10k" },
    pins: [{ num: "1", name: "1" }, { num: "2", name: "2" }],
  }),
  mcu: Part.parse({
    id: "mcu", name: "Tiny MCU", refPrefix: "U",
    pins: [
      { num: "1", name: "GP0", type: "bidir", functions: ["GPIO", "PWM0A"] },
      { num: "2", name: "GND", type: "power_in" },
      { num: "3", name: "GND", type: "power_in" },
      { num: "4", name: "NC", type: "nc" },
    ],
  }),
}

const ctx = (): CommandContext => {
  let i = 0
  return { resolvePart: (id) => parts[id], newId: (prefix) => `${prefix}_${++i}` }
}

const run = (p: Project, ...batch: Command[]) => applyCommands(p, batch, ctx())

describe("commands", () => {
  const base = emptyProject("p1", "Test")

  it("adds components with auto refs and vendors the part", () => {
    const { project, results } = run(
      base,
      { type: "component.add", args: { part: "resistor" } },
      { type: "component.add", args: { part: "resistor", props: { value: "220" } } },
    )
    expect(results).toEqual([{ id: "c_1", ref: "R1" }, { id: "c_2", ref: "R2" }])
    expect(project.components[1]!.props.value).toBe("220")
    expect(project.parts.resistor).toBeDefined()
    expect(project.version).toBe(1)
  })

  it("is atomic: a failing batch changes nothing", () => {
    expect(() =>
      run(base, { type: "component.add", args: { part: "resistor" } }, { type: "component.add", args: { part: "nope" } }),
    ).toThrow(/commands\[1\] component.add: No part "nope"/)
    expect(base.components).toHaveLength(0)
  })

  it("connects, merges and disconnects nets", () => {
    let p = run(
      base,
      { type: "component.add", args: { part: "mcu" } },
      { type: "component.add", args: { part: "resistor" } },
      { type: "component.add", args: { part: "resistor" } },
      { type: "net.connect", args: { pins: ["U1.GP0", "R1.1"], name: "LED" } },
      { type: "net.connect", args: { pins: ["R2.1", "U1.2"] } },
    ).project
    expect(p.nets.map((n) => n.name)).toEqual(["LED", "N1"])

    const merged = run(p, { type: "net.connect", args: { pins: ["R1.1", "R2.1"] } })
    expect(merged.results[0]).toEqual({ net: "LED", merged: ["N1"] })
    p = merged.project
    expect(p.nets).toHaveLength(1)
    expect(p.nets[0]!.pins).toHaveLength(4)

    p = run(p, { type: "net.disconnect", args: { pins: ["U1.GP0", "R1.1", "R2.1", "U1.2"] } }).project
    expect(p.nets).toHaveLength(0)
  })

  it("resolves pins by unique name, then number, and rejects ambiguous names", () => {
    const p = run(base, { type: "component.add", args: { part: "mcu" } }).project
    expect(() => run(p, { type: "net.connect", args: { pins: ["U1.GND"], name: "GND" } })).toThrow(/ambiguous.*2, 3/)
    expect(run(p, { type: "net.connect", args: { pins: ["U1.2", "U1.3"], name: "GND" } }).project.nets[0]!.pins).toHaveLength(2)
    expect(() => run(p, { type: "net.connect", args: { pins: ["U1.GP9"], name: "X" } })).toThrow(/no pin "GP9"/)
  })

  it("removes a component, its wiring and its unused part", () => {
    let p = run(
      base,
      { type: "component.add", args: { part: "resistor" } },
      { type: "component.add", args: { part: "mcu" } },
      { type: "net.connect", args: { pins: ["R1.1", "U1.GP0"] } },
    ).project
    p = run(p, { type: "component.remove", args: { component: "R1" } }).project
    expect(p.components.map((c) => c.ref)).toEqual(["U1"])
    expect(p.nets[0]!.pins).toHaveLength(1)
    expect(p.parts.resistor).toBeUndefined()
  })

  it("undoes and redoes through replay with increasing versions", () => {
    const added = run(base, { type: "component.add", args: { part: "resistor" } })
    const undone = replay(added.project, added.inversePatches)
    expect(undone.project.components).toHaveLength(0)
    expect(undone.project.version).toBe(2)
    const redone = replay(undone.project, added.patches)
    expect(redone.project.components).toHaveLength(1)
    expect(redone.project.version).toBe(3)
  })

  it("creates, renames and removes docs of registered kinds", () => {
    registerDocKind("note", z.object({ text: z.string().default("") }))
    expect(() => run(base, { type: "doc.create", args: { kind: "nope", name: "X" } })).toThrow(/Unknown doc kind/)
    let p = run(base, { type: "doc.create", args: { kind: "note", name: "Ideas" } }).project
    expect(p.docs[0]).toMatchObject({ kind: "note", name: "Ideas", data: { text: "" } })
    p = run(p, { type: "doc.rename", args: { doc: "Ideas", name: "Plans" } }).project
    p = run(p, { type: "doc.remove", args: { doc: "Plans" } }).project
    expect(p.docs).toHaveLength(0)
  })

  it("describes every command with a JSON schema", () => {
    const list = describeCommands()
    expect(list.map((c) => c.type)).toContain("net.connect")
    expect(list.every((c) => typeof c.args === "object")).toBe(true)
  })
})

describe("netlist", () => {
  it("lists nets and unconnected pins, skipping nc pins", () => {
    const p = applyCommands(
      emptyProject("p", "N"),
      [
        { type: "component.add", args: { part: "mcu" } },
        { type: "component.add", args: { part: "resistor" } },
        { type: "net.connect", args: { pins: ["U1.GP0", "R1.1"], name: "SIG" } },
      ],
      ctx(),
    ).project
    const n = netlist(p)
    expect(n.nets[0]!.pins.map((x) => x.address)).toEqual(["U1.GP0", "R1.1"])
    expect(n.unconnected.map((x) => x.address)).toEqual(["R1.2", "U1.2", "U1.3"])
    expect(netlistText(p)).toContain("SIG: U1.GP0, R1.1")
  })
})

describe("units", () => {
  it.each([
    ["10k", 1e4, ""], ["2k2", 2200, ""], ["4R7", 4.7, "Ω"], ["100n", 1e-7, ""], ["4.7uF", 4.7e-6, "F"],
    ["3.3 V", 3.3, "V"], ["25mm", 0.025, "m"], ["3/8 in", 0.009525, "m"], ["1meg", 1e6, ""], ["20 MHz", 2e7, "Hz"],
    ["10mA", 0.01, "A"], ["5%", 0.05, ""], ["10kΩ", 1e4, "Ω"],
  ])("%s", (text, value, unit) => {
    const q = parseQuantity(text)!
    expect(q.value).toBeCloseTo(value, 12)
    expect(q.unit).toBe(unit)
  })

  it("rejects junk", () => {
    expect(parseQuantity("abc")).toBeUndefined()
    expect(parseQuantity("10 bananas")).toBeUndefined()
  })

  it("formats", () => {
    expect(formatQuantity(2200)).toBe("2.2k")
    expect(formatQuantity(1e-7, "F")).toBe("100nF")
  })
})
