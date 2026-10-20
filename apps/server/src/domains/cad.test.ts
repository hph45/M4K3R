import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { registerCommands } from "@m4k3r/core"
import express from "express"
import { expect, it } from "vitest"
import { errors } from "../api"
import { PartLibrary } from "../library"
import { ProjectStore } from "../store"
import { cad } from "./cad"

it("serves exact mesh/properties, sketch rollback and downloadable CAD files", async () => {
  const home = mkdtempSync(join(tmpdir(), "m4k3r-cad-"))
  const library = new PartLibrary(resolve(import.meta.dirname, "../../../../library/parts"), join(home, "parts"))
  const store = new ProjectStore(join(home, "projects"), library)
  const context = { home, library, store }
  cad.setup?.(context)
  registerCommands(cad.commands ?? [])
  const project = store.create("CAD routes")
  store.apply(project.id, [
    { type: "doc.create", args: { name: "Test part", kind: "part-studio" } },
    { type: "cad.sketch.add", args: { doc: "Test part", id: "base", entities: [{ type: "rectangle", id: "r", width: 40, height: 20 }] } },
    { type: "cad.feature.add", args: { doc: "Test part", feature: { type: "extrude", id: "block", sketch: "base", depth: 10 } } },
  ])
  const app = express()
  const router = express.Router()
  cad.routes?.(router, context)
  app.use(router, errors)
  const server = app.listen(0, "127.0.0.1")
  await new Promise<void>((resolve, reject) => { server.once("listening", resolve); server.once("error", reject) })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("No test server address")
  const url = `http://127.0.0.1:${address.port}/projects/${project.id}/cad/Test%20part`
  try {
    const mesh = await (await fetch(`${url}/mesh`)).json()
    expect(mesh.error).toBeUndefined()
    expect(mesh.bodies).toHaveLength(1)
    expect(mesh.bodies[0].indices).toHaveLength(36)
    const props = await (await fetch(`${url}/properties`)).json()
    expect(props.volume).toBe(8000)
    expect(props.mass).toBe(9.92)
    const rollback = await (await fetch(`${url}/mesh?until=base`)).json()
    expect(rollback.bodies).toEqual([])
    expect(rollback.features[0].sketch.entities).toHaveLength(1)
    expect(rollback.features[1].status).toBe("skipped")
    const stl = await fetch(`${url}/export.stl`)
    expect(stl.headers.get("content-disposition")).toContain("Test-part.stl")
    expect((await stl.arrayBuffer()).byteLength).toBe(684)
    const step = await fetch(`${url}/export.step`)
    expect(step.headers.get("content-type")).toContain("model/step")
    expect(await step.text()).toMatch(/^ISO-10303-21;/)
    store.apply(project.id, [{ type: "cad.feature.update", args: { doc: "Test part", feature: "block", set: { suppressed: true } } }])
    const empty = await fetch(`${url}/export.stl`)
    expect(empty.status).toBe(400)
    expect((await empty.json()).error).toMatch(/no bodies/)
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
}, 30_000)
