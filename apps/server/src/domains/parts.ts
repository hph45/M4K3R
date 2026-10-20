import { join } from "node:path"
import { CommandError, PartId, type Part, type PartInput } from "@m4k3r/core"
import { KicadLibrary, type LibKind } from "@m4k3r/parts"
import { fileCache } from "@m4k3r/parts/node"
import { z } from "zod"
import { tool, type Domain, type DomainContext } from "../domain"

const ImportArgs = {
  symbol: z.string().min(1).describe('KiCad symbol as "Library:Name", e.g. "Driver_Motor:DRV8833PWP", or .kicad_sym file contents'),
  name: z.string().optional().describe("Symbol name, when the file contents define several"),
  footprint: z
    .string()
    .nullable()
    .optional()
    .describe('"Library:Name" or .kicad_mod contents. Defaults to the symbol\'s own footprint; null for none'),
  id: PartId.optional().describe("Part id; defaults to the lowercased symbol name"),
  overrides: z.record(z.string(), z.unknown()).optional().describe("Part fields to set, e.g. { category, props, sim }"),
}
const SearchArgs = {
  symbols: {
    lib: z.string().optional().describe("Only this library, e.g. RF_Module. Omit to search all libraries, or to list libraries when query is omitted too."),
    query: z.string().optional().describe("Words to match, e.g. esp32-s3"),
  },
  footprints: {
    lib: z.string().optional().describe("Library, e.g. Package_SO. Omit to list libraries."),
    query: z.string().optional().describe("Words to match, e.g. soic-8"),
  },
}

let kicad: KicadLibrary

async function importPart({ library }: DomainContext, args: z.infer<z.ZodObject<typeof ImportArgs>>) {
  try {
    const { part, warnings } = await kicad.importPart({ ...args, overrides: args.overrides as Partial<PartInput> })
    return { part: library.save(part), warnings }
  } catch (e) {
    throw e instanceof Error && !(e instanceof z.ZodError) ? new CommandError(e.message) : e
  }
}

async function search(kind: LibKind, lib?: string, query?: string, refresh = false) {
  try {
    if (kind === "symbols" && refresh) await kicad.symbolIndex(true)
    if (kind === "symbols" && query?.trim()) return await kicad.searchSymbols(query, lib)
    const names = await kicad.list(kind, lib, query)
    return lib ? names.map((n) => `${lib}:${n}`) : names
  } catch (e) {
    throw new CommandError(e instanceof Error ? e.message : String(e))
  }
}

/** Readable summary of an imported part for agents. */
function summary(part: Part, warnings: string[]) {
  const pin = (p: Part["pins"][number]) => `  ${p.num} ${p.name} ${p.type}${p.functions ? `: ${p.functions.join(", ")}` : ""}`
  return [
    `Saved part "${part.id}" (${part.refPrefix}, ${part.name})${part.description ? `: ${part.description}` : ""}`,
    `Symbol: ${part.symbol?.source ?? "imported"}, ${part.symbol?.units.length} unit(s)`,
    `Footprint: ${part.footprint ? `${part.footprint.source ?? "imported"}, ${part.footprint.pads.length} pads` : "none"}`,
    `Pins:`,
    ...part.pins.map(pin),
    ...warnings.map((w) => `Warning: ${w}`),
    `Use it with component.add { "part": "${part.id}" }`,
  ].join("\n")
}

function list(names: string[], what: string) {
  if (!names.length) return `No ${what} found`
  return names.length > 200 ? `${names.slice(0, 200).join("\n")}\n… and ${names.length - 200} more` : names.join("\n")
}

export const parts: Domain = {
  name: "parts",

  setup(ctx) {
    kicad = new KicadLibrary(fileCache(join(ctx.home, ".cache/kicad")))
  },

  routes(r, ctx) {
    r.post("/parts/import", async (req, res) => {
      res.json(await importPart(ctx, z.object(ImportArgs).parse(req.body)))
    })
    r.get("/kicad/:kind", async (req, res, next) => {
      const kind = req.params.kind
      if (kind !== "symbols" && kind !== "footprints") return next()
      const q = (key: string) => (typeof req.query[key] === "string" ? (req.query[key] as string) : undefined)
      res.json(await search(kind, q("lib"), q("q"), q("refresh") === "1"))
    })
  },

  tools(server, ctx) {
    server.registerTool(
      "import_kicad_part",
      {
        description:
          "Import a part from the official KiCad libraries (symbol, footprint, 3D model) into the user parts library. " +
          "Find symbol names with search_kicad_symbols. Returns the pins with their MCU functions.",
        inputSchema: ImportArgs,
      },
      tool(async (args: z.infer<z.ZodObject<typeof ImportArgs>>) => {
        const { part, warnings } = await importPart(ctx, args)
        return summary(part, warnings)
      }),
    )
    for (const kind of ["symbols", "footprints"] as const) {
      server.registerTool(
        `search_kicad_${kind}`,
        {
          description:
            kind === "symbols"
              ? 'Search symbols across all official KiCad libraries by name, best matches first. Returns "Library:Name" refs, or library names when lib and query are both omitted.'
              : 'Search footprints in an official KiCad library by name. Returns "Library:Name" refs, or library names when lib is omitted.',
          inputSchema: SearchArgs[kind],
        },
        tool(async ({ lib, query }: { lib?: string; query?: string }) =>
          list(await search(kind, lib, query), lib || (kind === "symbols" && query?.trim()) ? kind : "libraries"),
        ),
      )
    }
  },
}
