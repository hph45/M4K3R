import { mkdtempSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { registerDocKind } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { z } from "zod"
import { PartLibrary } from "./library"
import { ProjectStore } from "./store"

const setup = () => {
  const home = mkdtempSync(join(tmpdir(), "m4k3r-"))
  const library = new PartLibrary(resolve(import.meta.dirname, "../../../library/parts"), join(home, "parts"))
  return { home, library, store: new ProjectStore(join(home, "projects"), library) }
}

describe("ProjectStore", () => {
  it("persists commands, vendors parts and reloads from disk", () => {
    const { home, library, store } = setup()
    const { id } = store.create("My Board")
    expect(id).toBe("my-board")
    store.apply(id, [
      { type: "component.add", args: { part: "led" } },
      { type: "component.add", args: { part: "resistor" } },
      { type: "net.connect", args: { pins: ["R1.2", "D1.A"], name: "LED_A" } },
    ])
    const saved = JSON.parse(readFileSync(join(home, "projects/my-board/project.json"), "utf8"))
    expect(saved.parts).toBeUndefined()
    expect(saved.nets[0].name).toBe("LED_A")

    const fresh = new ProjectStore(join(home, "projects"), library).get(id)
    expect(fresh.components.map((c) => c.ref)).toEqual(["D1", "R1"])
    expect(Object.keys(fresh.parts).sort()).toEqual(["led", "resistor"])
  })

  it("stores docs as separate files, keeping their order", () => {
    registerDocKind("sketchpad", z.object({ lines: z.array(z.string()).default([]) }))
    const { home, library, store } = setup()
    const { id } = store.create("docs")
    store.apply(id, [
      { type: "doc.create", args: { kind: "sketchpad", name: "B" } },
      { type: "doc.create", args: { kind: "sketchpad", name: "A" } },
    ])
    const fresh = new ProjectStore(join(home, "projects"), library).get(id)
    expect(fresh.docs.map((d) => d.name)).toEqual(["B", "A"])
    store.apply(id, [{ type: "doc.remove", args: { doc: "B" } }])
    expect(new ProjectStore(join(home, "projects"), library).get(id).docs.map((d) => d.name)).toEqual(["A"])
  })

  it("undoes and redoes, broadcasting each change", () => {
    const { store } = setup()
    const { id } = store.create("x")
    const versions: number[] = []
    const labels: unknown[] = []
    store.on("change", (c) => (versions.push(c.version), labels.push(c.history)))
    store.apply(id, [{ type: "component.add", args: { part: "capacitor" } }], "add C")
    expect(store.undo(id)).toEqual({ version: 2, undone: "add C" })
    expect(labels).toEqual([{ undo: "add C", redo: null }, { undo: null, redo: "add C" }])
    expect(store.get(id).components).toHaveLength(0)
    store.redo(id)
    expect(store.get(id).components).toHaveLength(1)
    expect(versions).toEqual([1, 2, 3])
    expect(() => store.redo(id)).toThrow("Nothing to redo")
  })

  it("saves user parts that override built-ins", () => {
    const { library } = setup()
    library.save({ id: "resistor", name: "My resistor", refPrefix: "R", pins: [{ num: "1", name: "1" }, { num: "2", name: "2" }] })
    expect(library.get("resistor")?.name).toBe("My resistor")
    expect(library.search("resistor")[0]?.source).toBe("user")
  })
})
