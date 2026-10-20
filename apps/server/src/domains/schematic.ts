import { registerDocKind } from "@m4k3r/core"
import { erc, SchematicData, schematicCommands } from "@m4k3r/ecad"
import { z } from "zod"
import { tool, type Domain } from "../domain"

export const schematic: Domain = {
  name: "schematic",
  commands: schematicCommands,
  setup() { registerDocKind("schematic", SchematicData) },
  routes(r, { store }) { r.get("/projects/:id/erc", (req, res) => res.json(erc(store.get(req.params.id)))) },
  tools(server, { store }) { server.registerTool("schematic_check", { description: "Run electrical rules on shared nets: unconnected required pins, driven-output conflicts, voltage ranges, no-connect flags, open-drain pullups and decoupling", inputSchema: { project: z.string() } }, tool(({ project }: { project: string }) => erc(store.get(project)))) },
}
