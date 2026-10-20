import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { exportPcbStep } from "@m4k3r/cad"
import { findDoc, registerDocKind } from "@m4k3r/core"
import { boardCopper, drc, pcbCommands, pcbDoc, pcbDrills, pcbGeometry, PcbData, placedPads, ratsnest } from "@m4k3r/ecad"
import { fabricationName, fabricationZip } from "@m4k3r/ecad/node"
import { z } from "zod"
import { tool, type Domain, type DomainContext } from "../domain"

async function boardStep(ctx: DomainContext, project: string, doc: string) { const p = ctx.store.get(project), data = pcbDoc(p, doc); return exportPcbStep(data.outline, data.thickness, pcbDrills(p, data)) }
async function fab(ctx: DomainContext, project: string, doc: string, allowErrors = false) { const p = ctx.store.get(project); return fabricationZip(p, doc, { allowErrors, step: await boardStep(ctx, project, doc) }) }

export const pcb: Domain = {
  name: "pcb", commands: pcbCommands,
  setup() { registerDocKind("pcb", PcbData) },
  routes(r, ctx) {
    r.get("/projects/:id/pcb/:doc/geometry", (req, res) => { const p = ctx.store.get(req.params.id), data = pcbDoc(p, req.params.doc); res.json({ version: p.version, pads: placedPads(p, data), copper: boardCopper(p, data), drills: pcbDrills(p, data), ratsnest: ratsnest(p, data) }) })
    r.get("/projects/:id/pcb/:doc/drc", (req, res) => res.json(drc(ctx.store.get(req.params.id), req.params.doc)))
    r.get("/projects/:id/pcb/:doc/mesh", (req, res) => { const p = ctx.store.get(req.params.id); res.json({ version: p.version, ...pcbGeometry(p, req.params.doc) }) })
    r.get("/projects/:id/pcb/:doc/export.step", async (req, res) => { const name = findDoc(ctx.store.get(req.params.id), req.params.doc, "pcb").name.replace(/[^\w.-]+/g, "-"); res.type("model/step").attachment(`${name}.step`).send(Buffer.from(await boardStep(ctx, req.params.id, req.params.doc))) })
    r.get("/projects/:id/pcb/:doc/fabrication.zip", async (req, res) => { const p = ctx.store.get(req.params.id); res.type("application/zip").attachment(fabricationName(p, req.params.doc)).send(Buffer.from(await fab(ctx, req.params.id, req.params.doc, req.query.allowErrors === "true"))) })
  },
  tools(server, ctx) {
    const args = { project: z.string(), doc: z.string().describe("PCB id or name") }
    server.registerTool("pcb_check", { description: "Check canonical two-layer copper for shorts, clearances, width, holes, edge clearance, courtyards and unrouted shared nets", inputSchema: args }, tool(({ project, doc }: { project: string; doc: string }) => drc(ctx.store.get(project), doc)))
    server.registerTool("pcb_geometry", { description: "Get true board geometry, placements, drills, copper and the remaining airwires", inputSchema: args }, tool(({ project, doc }: { project: string; doc: string }) => { const p = ctx.store.get(project), d = pcbDoc(p, doc); return { ...pcbGeometry(p, d), pads: placedPads(p, d), copper: boardCopper(p, d), ratsnest: ratsnest(p, d) } }))
    server.registerTool("pcb_export", { description: "Export actual Gerber X2, Excellon PTH/NPTH, SMT pick-and-place, BOM and exact board STEP as a fabrication ZIP; DRC errors block by default", inputSchema: { ...args, format: z.enum(["zip", "step"]).default("zip"), allowErrors: z.boolean().default(false), path: z.string().optional() } }, tool(async ({ project, doc, format, allowErrors, path }: { project: string; doc: string; format: "zip" | "step"; allowErrors: boolean; path?: string }) => { const bytes = format === "step" ? await boardStep(ctx, project, doc) : await fab(ctx, project, doc, allowErrors); path ??= join(ctx.home, "exports", project, format === "zip" ? fabricationName(ctx.store.get(project), doc) : `${doc.replace(/[^\w.-]+/g, "-")}.step`); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, bytes); return { path, bytes: bytes.length } }))
  },
}
