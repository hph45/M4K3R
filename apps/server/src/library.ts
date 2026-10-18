import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { Part, type PartInput } from "@m4k3r/core"
import { partJson } from "@m4k3r/parts"

export type PartSource = "builtin" | "user"

/** Parts live as <dir>/<id>/part.json. User parts override built-in parts with the same id. */
export class PartLibrary {
  constructor(
    private builtinDir: string,
    private userDir: string,
  ) {}

  private load(dir: string, source: PartSource) {
    if (!existsSync(dir)) return []
    return readdirSync(dir).flatMap((id) => {
      const file = join(dir, id, "part.json")
      if (!existsSync(file)) return []
      const parsed = Part.safeParse(JSON.parse(readFileSync(file, "utf8")))
      if (!parsed.success) {
        console.warn(`Skipping invalid part ${file}: ${parsed.error.message}`)
        return []
      }
      return [{ part: parsed.data, source }]
    })
  }

  all(): { part: Part; source: PartSource }[] {
    const byId = new Map<string, { part: Part; source: PartSource }>()
    for (const entry of [...this.load(this.builtinDir, "builtin"), ...this.load(this.userDir, "user")]) {
      byId.set(entry.part.id, entry)
    }
    return [...byId.values()].sort((a, b) => a.part.id.localeCompare(b.part.id))
  }

  get(id: string): Part | undefined {
    for (const dir of [this.userDir, this.builtinDir]) {
      const file = join(dir, id, "part.json")
      if (existsSync(file)) return Part.parse(JSON.parse(readFileSync(file, "utf8")))
    }
    return undefined
  }

  search(query = "") {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return this.all()
      .filter(({ part }) => {
        const text = [part.id, part.name, part.description, part.category, part.mpn ?? "", part.manufacturer ?? ""]
          .join(" ")
          .toLowerCase()
        return words.every((w) => text.includes(w))
      })
      .map(({ part, source }) => ({
        id: part.id,
        name: part.name,
        category: part.category,
        description: part.description,
        refPrefix: part.refPrefix,
        pins: part.pins.length,
        source,
      }))
  }

  save(input: PartInput): Part {
    const part = Part.parse(input)
    const dir = join(this.userDir, part.id)
    mkdirSync(dir, { recursive: true })
    writeAtomic(join(dir, "part.json"), partJson(part))
    return part
  }
}

export function writeAtomic(file: string, text: string) {
  writeFileSync(`${file}.tmp`, text)
  renameSync(`${file}.tmp`, file)
}
