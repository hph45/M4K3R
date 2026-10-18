import type { RequestHandler } from "express"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import { z } from "zod"
import { Command, commandList, describeCommands, netlistText, Part } from "@m4k3r/core"
import { tool, type DomainContext } from "./domain"
import { domains } from "./domains"

const INSTRUCTIONS = `M4K3R is a hardware design tool (CAD, schematic, PCB, firmware, simulation).
Every edit is a command applied with apply_commands; the user's browser updates live.
Pins are addressed as REF.PIN (e.g. U1.GP10). Read wiring with get_netlist before and after edits.
If a part you need is missing, search_parts first, then import it from KiCad (search_kicad_symbols, import_kicad_part); define it by hand with save_part only as a last resort.`

function build(ctx: DomainContext) {
  const { store, library } = ctx
  const server = new McpServer({ name: "m4k3r", version: "0.1.0" }, { instructions: INSTRUCTIONS })
  const project = z.string().describe("Project id (from list_projects)")

  server.registerTool(
    "list_projects",
    { description: "List projects", inputSchema: {} },
    tool(() => store.list()),
  )

  server.registerTool(
    "create_project",
    { description: "Create a project", inputSchema: { name: z.string().min(1) } },
    tool(({ name }: { name: string }) => store.create(name)),
  )

  server.registerTool(
    "get_project",
    { description: "Project summary: name, version, variables, components, part ids", inputSchema: { project } },
    tool(({ project: id }: { project: string }) => {
      const p = store.get(id)
      return {
        id: p.id, name: p.name, version: p.version, variables: p.variables,
        components: p.components.map(({ ref, part, props }) => ({ ref, part, props })),
        parts: Object.keys(p.parts),
        docs: p.docs.map(({ id, kind, name }) => ({ id, kind, name })),
        history: store.historyLabels(id),
      }
    }),
  )

  server.registerTool(
    "get_netlist",
    { description: "The wiring as text: components, nets with their pins, and unconnected pins", inputSchema: { project } },
    tool(({ project: id }: { project: string }) => netlistText(store.get(id))),
  )

  server.registerTool(
    "apply_commands",
    {
      description:
        "Apply a batch of commands atomically (one undo step). Commands:\n" +
        commandList.map((c) => `- ${c.type}: ${c.summary}`).join("\n") +
        "\nUse list_commands for exact argument schemas.",
      inputSchema: {
        project,
        commands: z.array(Command).min(1),
        label: z.string().optional().describe("Shown in undo history"),
      },
    },
    tool(({ project: id, commands, label }: { project: string; commands: Command[]; label?: string }) =>
      store.apply(id, commands, label),
    ),
  )

  server.registerTool(
    "undo",
    { description: "Undo the last change", inputSchema: { project } },
    tool(({ project: id }: { project: string }) => store.undo(id)),
  )

  server.registerTool(
    "redo",
    { description: "Redo the last undone change", inputSchema: { project } },
    tool(({ project: id }: { project: string }) => store.redo(id)),
  )

  server.registerTool(
    "list_commands",
    { description: "Every command with its JSON Schema for args", inputSchema: {} },
    tool(() => describeCommands()),
  )

  server.registerTool(
    "search_parts",
    { description: "Search the parts library (built-in and user)", inputSchema: { query: z.string().optional() } },
    tool(({ query }: { query?: string }) => library.search(query)),
  )

  server.registerTool(
    "get_part",
    { description: "Full part definition, including pins", inputSchema: { id: z.string() } },
    tool(({ id }: { id: string }) => library.get(id) ?? `No part "${id}"`),
  )

  server.registerTool(
    "save_part",
    {
      description:
        "Create or replace a part in the user library. MCU pins should list functions (GPIO, PWM5A, SPI0_TX, I2C0_SDA, ADC0…). " +
        "Projects keep their own copy; to update a project's copy, apply part.vendor.",
      inputSchema: { part: Part },
    },
    tool(({ part }: { part: Part }) => library.save(part)),
  )

  for (const domain of domains) domain.tools?.(server, ctx)
  return server
}

/** Stateless Streamable HTTP: a fresh MCP server per request, all sharing one store. */
export function mcp(ctx: DomainContext): RequestHandler {
  return async (req, res) => {
    const server = build(ctx)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
    res.on("close", () => {
      void transport.close()
      void server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  }
}
