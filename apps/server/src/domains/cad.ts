import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import {
  cadCommands, evaluateStudio, export3mf, exportStep, exportStl, Material, meshBodies, PartStudio, properties,
} from "@m4k3r/cad"
import { findDoc, registerDocKind } from "@m4k3r/core"
import { z } from "zod"
import { tool, type Domain, type DomainContext } from "../domain"

async function evaluate(ctx: DomainContext, project: string, key: string, until?: string) {
  const p = ctx.store.get(project)
  const doc = findDoc(p, key, "part-studio")
  const data = doc.data as PartStudio
  return { p, doc, data, ev: await evaluateStudio(data, p.variables, until ? { until } : {}) }
}

const query = (v: unknown) => (typeof v === "string" && v ? v : undefined)
const fileName = (name: string) => name.replace(/[^\w.-]+/g, "-")
const FORMATS = {
  stl: { run: exportStl, type: "model/stl" },
  step: { run: exportStep, type: "model/step" },
  "3mf": { run: export3mf, type: "model/3mf" },
}

export const cad: Domain = {
  name: "cad",
  commands: cadCommands,

  setup() {
    registerDocKind("part-studio", PartStudio)
  },

  routes(r, ctx) {
    r.get("/projects/:id/cad/:doc/mesh", async (req, res) => {
      const { p, ev } = await evaluate(ctx, req.params.id, req.params.doc, query(req.query.until))
      res.json({ version: p.version, bodies: meshBodies(ev), features: ev.features, error: ev.error })
    })

    r.get("/projects/:id/cad/:doc/properties", async (req, res) => {
      const { data, ev } = await evaluate(ctx, req.params.id, req.params.doc, query(req.query.until))
      res.json(properties(ev, Material.optional().parse(query(req.query.material)) ?? data.material))
    })

    for (const [ext, format] of Object.entries(FORMATS)) {
      r.get(`/projects/:id/cad/:doc/export.${ext}`, async (req, res) => {
        const { doc, ev } = await evaluate(ctx, req.params.id, req.params.doc)
        const bytes = await format.run(ev)
        res.type(format.type).attachment(`${fileName(doc.name)}.${ext}`).send(Buffer.from(bytes))
      })
    }
  },

  tools(server, ctx) {
    const project = z.string().describe("Project id")
    const doc = z.string().describe("Part studio id or name")

    server.registerTool(
      "cad_properties",
      {
        description:
          "Evaluate a part studio: bounding box, volume (mm³), area, mass (g), center of mass, per body, " +
          "plus each feature's status (sketches report degrees of freedom) and the first error, if any",
        inputSchema: { project, doc, material: Material.optional().describe("Override the studio's material") },
      },
      tool(async (a: { project: string; doc: string; material?: Material }) => {
        const { data, ev } = await evaluate(ctx, a.project, a.doc)
        return properties(ev, a.material ?? data.material)
      }),
    )

    server.registerTool(
      "cad_export",
      {
        description: "Export a part studio as STL, standards-based 3MF (3D printing), or analytic STEP, and return the file path",
        inputSchema: {
          project, doc,
          format: z.enum(["stl", "step", "3mf"]),
          path: z.string().optional().describe("Absolute output path. Default: <M4K3R_HOME>/exports/<project>/<doc>.<format>"),
        },
      },
      tool(async (a: { project: string; doc: string; format: "stl" | "step" | "3mf"; path?: string }) => {
        const { doc: d, ev } = await evaluate(ctx, a.project, a.doc)
        const bytes = await FORMATS[a.format].run(ev)
        const path = a.path ?? join(ctx.home, "exports", a.project, `${fileName(d.name)}.${a.format}`)
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, bytes)
        return { path, bytes: bytes.length }
      }),
    )
  },
}
