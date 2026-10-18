import { EventEmitter } from "node:events"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { join } from "node:path"
import {
  applyCommands, CommandError, emptyProject, newId, Part, Project, replay,
  type Change, type Command, type Patch,
} from "@m4k3r/core"
import { writeAtomic, type PartLibrary } from "./library"

export class NotFound extends Error {}

export interface ProjectChange {
  project: string
  version: number
  patches: Patch[]
}

interface Entry {
  label: string
  patches: Patch[]
  inversePatches: Patch[]
}

const PROJECT_ID = /^[a-z0-9][a-z0-9-]*$/
const HISTORY_LIMIT = 200

const slugify = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "project"

/**
 * Projects on disk: <dir>/<id>/project.json, parts/<part>/part.json and docs/<doc>.json.
 * The store is the single writer: every change goes through apply/undo/redo, is saved, then broadcast.
 */
export class ProjectStore extends EventEmitter<{ change: [ProjectChange]; projects: [] }> {
  private cache = new Map<string, Project>()
  private history = new Map<string, { undo: Entry[]; redo: Entry[] }>()

  constructor(
    private dir: string,
    private library: PartLibrary,
  ) {
    super()
    mkdirSync(dir, { recursive: true })
  }

  list() {
    return readdirSync(this.dir)
      .filter((id) => PROJECT_ID.test(id) && existsSync(join(this.dir, id, "project.json")))
      .map((id) => {
        const p = this.get(id)
        return { id: p.id, name: p.name, version: p.version, components: p.components.length, nets: p.nets.length }
      })
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  get(id: string): Project {
    const cached = this.cache.get(id)
    if (cached) return cached
    const folder = this.folder(id)
    const file = join(folder, "project.json")
    if (!existsSync(file)) throw new NotFound(`No project "${id}"`)
    const parts: Record<string, Part> = {}
    const partsDir = join(folder, "parts")
    if (existsSync(partsDir)) {
      for (const partId of readdirSync(partsDir)) {
        const partFile = join(partsDir, partId, "part.json")
        if (existsSync(partFile)) parts[partId] = Part.parse(JSON.parse(readFileSync(partFile, "utf8")))
      }
    }
    const saved = JSON.parse(readFileSync(file, "utf8"))
    const docs = ((saved.docs ?? []) as string[]).map((docId) =>
      JSON.parse(readFileSync(join(folder, "docs", `${docId}.json`), "utf8")),
    )
    const project = Project.parse({ ...saved, id, parts, docs })
    this.cache.set(id, project)
    return project
  }

  create(name: string): Project {
    let id = slugify(name)
    for (let i = 2; existsSync(join(this.dir, id)); i++) id = `${slugify(name)}-${i}`
    const project = emptyProject(id, name)
    this.save(project)
    this.emit("projects")
    return project
  }

  delete(id: string) {
    const folder = this.folder(id)
    if (!existsSync(folder)) throw new NotFound(`No project "${id}"`)
    rmSync(folder, { recursive: true })
    this.cache.delete(id)
    this.history.delete(id)
    this.emit("projects")
  }

  apply(id: string, batch: Command[], label?: string) {
    const change = applyCommands(this.get(id), batch, {
      resolvePart: (partId) => this.library.get(partId),
      newId,
    })
    const h = this.historyOf(id)
    h.undo.push({ label: label ?? batch.map((c) => c.type).join(", "), patches: change.patches, inversePatches: change.inversePatches })
    if (h.undo.length > HISTORY_LIMIT) h.undo.shift()
    h.redo = []
    this.commit(id, change)
    return { version: change.project.version, results: change.results }
  }

  undo(id: string) {
    const h = this.historyOf(id)
    const entry = h.undo.pop()
    if (!entry) throw new CommandError("Nothing to undo")
    this.commit(id, replay(this.get(id), entry.inversePatches))
    h.redo.push(entry)
    return { version: this.get(id).version, undone: entry.label }
  }

  redo(id: string) {
    const h = this.historyOf(id)
    const entry = h.redo.pop()
    if (!entry) throw new CommandError("Nothing to redo")
    this.commit(id, replay(this.get(id), entry.patches))
    h.undo.push(entry)
    return { version: this.get(id).version, redone: entry.label }
  }

  historyLabels(id: string) {
    const h = this.historyOf(id)
    return { undo: h.undo.at(-1)?.label ?? null, redo: h.redo.at(-1)?.label ?? null }
  }

  private historyOf(id: string) {
    let h = this.history.get(id)
    if (!h) this.history.set(id, (h = { undo: [], redo: [] }))
    return h
  }

  private commit(id: string, change: Change) {
    this.save(change.project)
    this.cache.set(id, change.project)
    this.emit("change", { project: id, version: change.project.version, patches: change.patches })
  }

  private folder(id: string) {
    if (!PROJECT_ID.test(id)) throw new NotFound(`No project "${id}"`)
    return join(this.dir, id)
  }

  private save(project: Project) {
    const folder = this.folder(project.id)
    const partsDir = join(folder, "parts")
    const docsDir = join(folder, "docs")
    mkdirSync(partsDir, { recursive: true })
    mkdirSync(docsDir, { recursive: true })
    const { parts, docs, ...rest } = project
    const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n"
    writeAtomic(join(folder, "project.json"), json({ ...rest, docs: docs.map((d) => d.id) }))
    for (const part of Object.values(parts)) {
      mkdirSync(join(partsDir, part.id), { recursive: true })
      writeAtomic(join(partsDir, part.id, "part.json"), json(part))
    }
    for (const doc of docs) writeAtomic(join(docsDir, `${doc.id}.json`), json(doc))
    for (const stale of readdirSync(partsDir)) {
      if (!parts[stale]) rmSync(join(partsDir, stale), { recursive: true })
    }
    for (const stale of readdirSync(docsDir)) {
      if (!docs.some((d) => `${d.id}.json` === stale)) rmSync(join(docsDir, stale))
    }
  }
}
