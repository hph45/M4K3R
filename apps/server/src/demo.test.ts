import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { evaluateStudio, properties, type PartStudio } from "@m4k3r/cad"
import { registerCommands } from "@m4k3r/core"
import { simulate } from "@m4k3r/sim"
import { expect, it } from "vitest"
import { createDemo } from "./demo"
import { domains } from "./domains"
import { PartLibrary } from "./library"
import { ProjectStore } from "./store"

it("creates a persisted starter with runnable circuit and printable enclosure", async () => {
  const home = mkdtempSync(join(tmpdir(), "m4k3r-demo-"))
  const library = new PartLibrary(resolve(import.meta.dirname, "../../../library/parts"), join(home, "parts"))
  const store = new ProjectStore(join(home, "projects"), library)
  for (const domain of domains) {
    registerCommands(domain.commands ?? [])
    await domain.setup?.({ store, library, home })
  }
  const project = createDemo(store)
  const reloaded = new ProjectStore(join(home, "projects"), library).get(project.id)
  expect(reloaded).toEqual(project)
  expect(reloaded.docs.map((doc) => doc.kind)).toEqual(["schematic", "simulation", "part-studio", "firmware"])
  const result = simulate(reloaded, {
    analysis: "tran", duration: 0.2, step: 0.00005,
    inputs: [{ t: 0, ref: "SW1", action: "press" }],
  })
  expect(result.views.D1!.brightness).toBeGreaterThan(0.4)
  expect(result.views.M1!.rpm).toBeGreaterThan(100)
  const studio = reloaded.docs.find((doc) => doc.kind === "part-studio")!.data as PartStudio
  const evaluated = await evaluateStudio(studio, reloaded.variables)
  expect(evaluated.error).toBeUndefined()
  const output = properties(evaluated, studio.material)
  expect(output.bodies).toHaveLength(1)
  expect(JSON.stringify(output)).toContain("volume")
  const duplicate = createDemo(store)
  expect(duplicate.id).not.toBe(project.id)
})
