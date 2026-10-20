import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { commands, registerCommands } from "@m4k3r/core"
import { simulate, simulationCommands, simulationDoc, simulationOptions } from "@m4k3r/sim"
import { expect, it } from "vitest"
import { PartLibrary } from "../library"
import { ProjectStore } from "../store"
import { sim, summary } from "./sim"

it("summarizes a simulation compactly for agents", () => {
  const home = mkdtempSync(join(tmpdir(), "m4k3r-"))
  const library = new PartLibrary(resolve(import.meta.dirname, "../../../../library/parts"), join(home, "parts"))
  const store = new ProjectStore(join(home, "projects"), library)
  const { id } = store.create("motor")
  store.apply(id, [
    { type: "component.add", args: { part: "battery" } },
    { type: "component.add", args: { part: "dc-motor" } },
    { type: "net.connect", args: { pins: ["BT1.+", "M1.1"], name: "VBAT" } },
    { type: "net.connect", args: { pins: ["BT1.-", "M1.2"], name: "GND" } },
  ])
  const text = summary(simulate(store.get(id), { analysis: "tran", duration: 0.2, probes: ["M1.rpm"], maxPoints: 5 }))
  expect(text).toMatch(/^Transient to 200ms: 20000 steps in \d+ ms\nVoltages: VBAT=4.2V\n/)
  expect(text).toContain("M1: rpm=210 current=52.5mA")
  expect(text).toMatch(/\nt: 40m 80m 120m 160m 200m\nM1.rpm: [\d.]+ [\d.]+ [\d.]+ 210 210$/)
})

it("persists saved simulation setups and exposes them through the MCP run tool", async () => {
  const home = mkdtempSync(join(tmpdir(), "m4k3r-"))
  const library = new PartLibrary(resolve(import.meta.dirname, "../../../../library/parts"), join(home, "parts"))
  const store = new ProjectStore(join(home, "projects"), library)
  const context = { store, library, home }
  await sim.setup?.(context)
  if (!commands.has("sim.update")) registerCommands(simulationCommands)
  const { id } = store.create("saved simulation")
  store.apply(id, [
    { type: "component.add", args: { part: "battery" } },
    { type: "component.add", args: { part: "resistor" } },
    { type: "net.connect", args: { pins: ["BT1.+", "R1.1"], name: "VBAT" } },
    { type: "net.connect", args: { pins: ["BT1.-", "R1.2"], name: "GND" } },
    { type: "doc.create", args: { kind: "simulation", name: "Power", data: { duration: 0.01, probes: ["VBAT"] } } },
  ])
  store.apply(id, [{ type: "sim.update", args: { doc: "Power", duration: 0.02 } }])
  expect(simulationDoc(store.get(id), "Power").duration).toBe(0.02)
  store.undo(id)
  expect(simulationDoc(store.get(id), "Power").duration).toBe(0.01)
  store.redo(id)
  const reloaded = new ProjectStore(join(home, "projects"), library).get(id)
  expect(simulationOptions(reloaded, "Power")).toMatchObject({ duration: 0.02, probes: ["VBAT"] })

  const registered = new Map<string, (args: any) => Promise<any>>()
  sim.tools?.({ registerTool(name: string, _config: unknown, handler: any) { registered.set(name, handler) } } as any, context)
  const result = await registered.get("simulation_run")!({ project: id, doc: "Power" })
  expect(result.isError).toBeUndefined()
  expect(result.content[0].text).toMatch(/^Transient to 20ms:/)
  expect(result.content[0].text).toContain("V(VBAT):")
})
