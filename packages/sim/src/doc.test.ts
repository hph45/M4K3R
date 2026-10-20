import { applyCommands, commands, registerCommands, registerDocKind } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { SimulationData, simulationCommands, simulationDoc, simulationOptions } from "./doc"
import { simulate } from "./simulate"
import { circuit } from "./testing"

registerDocKind("simulation", SimulationData)
if (!commands.has("sim.update")) registerCommands(simulationCommands)
const context = { resolvePart: () => undefined, newId: () => "d_sim" }

describe("saved simulation", () => {
  it("creates defaults and runs an updated setup with the normal solver", () => {
    const initial = circuit("BT1 battery IN GND", "R1 resistor IN GND value=1k")
    const created = applyCommands(initial, [{ type: "doc.create", args: { kind: "simulation", name: "Power" } }], context).project
    expect(simulationDoc(created, "Power")).toMatchObject({ step: 0.00001, duration: 1, speed: 1, probes: [] })
    const edited = applyCommands(created, [{ type: "sim.update", args: { doc: "Power", duration: 0.01, probes: ["IN"] } }], context).project
    const result = simulate(edited, simulationOptions(edited, "d_sim"))
    expect(result.stats.steps).toBe(1000)
    expect(result.waveforms!.series["V(IN)"]!.at(-1)).toBeGreaterThan(4)
    expect(simulationDoc(created, "Power").duration).toBe(1)
  })

  it("rejects invalid updates atomically and rejects documents of a different kind", () => {
    const p = circuit("R1 resistor A GND")
    p.docs.push({ id: "sim", name: "Sim", kind: "simulation", data: SimulationData.parse({}) })
    p.docs.push({ id: "other", name: "Other", kind: "firmware", data: {} })
    expect(() => applyCommands(p, [{ type: "sim.update", args: { doc: "sim", step: 0 } }], context)).toThrow()
    expect(simulationDoc(p, "sim").step).toBe(0.00001)
    expect(() => applyCommands(p, [{ type: "sim.update", args: { doc: "other", duration: 2 } }], context)).toThrow(/simulation/)
  })
})
