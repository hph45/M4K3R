import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { CommandDef } from "@m4k3r/core"
import type { Router } from "express"
import type { PartLibrary } from "./library"
import type { ProjectStore } from "./store"

export interface DomainContext {
  store: ProjectStore
  library: PartLibrary
  /** M4K3R_HOME, e.g. for toolchains or caches */
  home: string
}

/**
 * A workstream (cad, schematic, sim, firmware…) plugs into the server here:
 * its commands join the shared command set, and it can add API routes and MCP tools.
 */
export interface Domain {
  name: string
  commands?: CommandDef<any>[]
  /** Called once at startup, e.g. to register doc kinds. */
  setup?(ctx: DomainContext): void | Promise<void>
  /** Mounted under /api. */
  routes?(router: Router, ctx: DomainContext): void
  tools?(server: McpServer, ctx: DomainContext): void
}

export const text = (value: unknown) => ({
  content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }],
})

/** Wrap an MCP tool body so thrown errors are reported to the agent instead of failing the request. */
export const tool =
  <A>(fn: (args: A) => unknown) =>
  async (args: A) => {
    try {
      return text(await fn(args))
    } catch (e) {
      return { ...text(e instanceof Error ? e.message : String(e)), isError: true }
    }
  }
