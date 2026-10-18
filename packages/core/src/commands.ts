import { applyPatches, enablePatches, produceWithPatches, type Patch } from "immer"
import { z } from "zod"
import { CommandError, findComponent, findDoc, findNet, resolvePin, samePin } from "./lookup"
import { Part, PartId, type Project } from "./schema"

enablePatches()

export type { Patch }

export interface CommandContext {
  /** Look up a part in the libraries, used when a component's part isn't vendored yet. */
  resolvePart(id: string): Part | undefined
  newId(prefix: string): string
}

export interface CommandDef<S extends z.ZodType = z.ZodType> {
  type: string
  summary: string
  args: S
  run(draft: Project, args: z.infer<S>, ctx: CommandContext): unknown
}

export const defineCommand = <S extends z.ZodType>(def: CommandDef<S>) => def

const docKinds = new Map<string, z.ZodType>()

/** Domains register the kinds of documents they own, with a schema for the doc's data. */
export function registerDocKind(kind: string, data: z.ZodType) {
  docKinds.set(kind, data)
}

const nextRef = (p: Project, prefix: string) => {
  const used = new Set(p.components.map((c) => c.ref))
  let i = 1
  while (used.has(`${prefix}${i}`)) i++
  return `${prefix}${i}`
}

const nextNetName = (p: Project) => {
  const used = new Set(p.nets.map((n) => n.name))
  let i = 1
  while (used.has(`N${i}`)) i++
  return `N${i}`
}

const dropEmptyNets = (p: Project) => {
  p.nets = p.nets.filter((n) => n.pins.length > 0)
}

const dropUnusedParts = (p: Project) => {
  const used = new Set(p.components.map((c) => c.part))
  for (const id of Object.keys(p.parts)) if (!used.has(id)) delete p.parts[id]
}

const Ref = z.string().regex(/^[A-Z]+[0-9]+$/, "e.g. R1, U2")

export const commandList: CommandDef<any>[] = [
  defineCommand({
    type: "project.rename",
    summary: "Rename the project",
    args: z.object({ name: z.string().min(1) }),
    run(p, { name }) {
      p.name = name
    },
  }),

  defineCommand({
    type: "variable.set",
    summary: "Create or change a project variable (shared by CAD and PCB)",
    args: z.object({
      name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
      value: z.string().describe("Quantity or expression, e.g. '65 mm' or 'pcb_w + 4'"),
    }),
    run(p, { name, value }) {
      const v = p.variables.find((v) => v.name === name)
      if (v) v.value = value
      else p.variables.push({ name, value })
    },
  }),

  defineCommand({
    type: "variable.remove",
    summary: "Remove a project variable",
    args: z.object({ name: z.string() }),
    run(p, { name }) {
      if (!p.variables.some((v) => v.name === name)) throw new CommandError(`No variable "${name}"`)
      p.variables = p.variables.filter((v) => v.name !== name)
    },
  }),

  defineCommand({
    type: "part.vendor",
    summary: "Copy a part definition into the project, or update the project's copy",
    args: z.object({ part: Part }),
    run(p, { part }) {
      const nums = new Set(part.pins.map((pin) => pin.num))
      const users = new Set(p.components.filter((c) => c.part === part.id).map((c) => c.id))
      const orphaned = p.nets.flatMap((n) => n.pins).filter((r) => users.has(r.component) && !nums.has(r.pin))
      if (orphaned.length) throw new CommandError(`Wired pins would disappear: ${orphaned.map((r) => r.pin).join(", ")}`)
      p.parts[part.id] = part
    },
  }),

  defineCommand({
    type: "component.add",
    summary: "Add a component from the parts library. ref is auto-numbered when omitted.",
    args: z.object({
      part: PartId,
      ref: Ref.optional(),
      props: z.record(z.string(), z.string()).optional(),
    }),
    run(p, { part: partId, ref, props }, ctx) {
      if (!p.parts[partId]) {
        const part = ctx.resolvePart(partId)
        if (!part) throw new CommandError(`No part "${partId}" in the libraries`)
        p.parts[partId] = part
      }
      const part = p.parts[partId]!
      ref ??= nextRef(p, part.refPrefix)
      if (p.components.some((c) => c.ref === ref)) throw new CommandError(`${ref} already exists`)
      const id = ctx.newId("c")
      p.components.push({ id, ref, part: partId, props: { ...part.props, ...props } })
      return { id, ref }
    },
  }),

  defineCommand({
    type: "component.update",
    summary: "Change a component's ref or props. A null prop value removes it.",
    args: z.object({
      component: z.string().describe("id or ref"),
      ref: Ref.optional(),
      props: z.record(z.string(), z.string().nullable()).optional(),
    }),
    run(p, { component, ref, props }) {
      const c = findComponent(p, component)
      if (ref && ref !== c.ref) {
        if (p.components.some((o) => o.ref === ref)) throw new CommandError(`${ref} already exists`)
        c.ref = ref
      }
      for (const [k, v] of Object.entries(props ?? {})) {
        if (v === null) delete c.props[k]
        else c.props[k] = v
      }
      return { id: c.id, ref: c.ref }
    },
  }),

  defineCommand({
    type: "component.remove",
    summary: "Remove a component and disconnect its pins",
    args: z.object({ component: z.string().describe("id or ref") }),
    run(p, { component }) {
      const c = findComponent(p, component)
      p.components = p.components.filter((o) => o.id !== c.id)
      for (const n of p.nets) n.pins = n.pins.filter((r) => r.component !== c.id)
      dropEmptyNets(p)
      dropUnusedParts(p)
    },
  }),

  defineCommand({
    type: "net.connect",
    summary:
      "Connect pins (REF.PIN, e.g. U1.GP10). Nets that already contain any of the pins are merged. " +
      "With name, joins or creates that net.",
    args: z.object({
      pins: z.array(z.string()).min(1),
      name: z.string().min(1).optional(),
    }),
    run(p, { pins, name }, ctx) {
      const refs = pins.map((a) => resolvePin(p, a))
      if (refs.length < 2 && !name) throw new CommandError("Connect needs two or more pins, or a net name")
      const touched = p.nets.filter((n) => n.pins.some((r) => refs.some((ref) => samePin(r, ref))))
      let target = (name && p.nets.find((n) => n.name === name)) || touched[0]
      if (!target) {
        target = { id: ctx.newId("n"), name: name ?? nextNetName(p), pins: [] }
        p.nets.push(target)
      }
      if (name) target.name = name
      const merged = touched.filter((n) => n.id !== target.id)
      for (const ref of [...merged.flatMap((n) => n.pins), ...refs]) {
        if (!target.pins.some((r) => samePin(r, ref))) target.pins.push({ ...ref })
      }
      p.nets = p.nets.filter((n) => !merged.some((m) => m.id === n.id))
      return { net: target.name, merged: merged.map((n) => n.name) }
    },
  }),

  defineCommand({
    type: "net.disconnect",
    summary: "Disconnect pins from whatever nets they are on",
    args: z.object({ pins: z.array(z.string()).min(1) }),
    run(p, { pins }) {
      const refs = pins.map((a) => resolvePin(p, a))
      for (const n of p.nets) n.pins = n.pins.filter((r) => !refs.some((ref) => samePin(r, ref)))
      dropEmptyNets(p)
    },
  }),

  defineCommand({
    type: "doc.create",
    summary: "Create a document, e.g. a part-studio or schematic",
    args: z.object({ kind: z.string(), name: z.string().min(1), data: z.unknown().optional() }),
    run(p, { kind, name, data }, ctx) {
      const schema = docKinds.get(kind)
      if (!schema) throw new CommandError(`Unknown doc kind "${kind}" (known: ${[...docKinds.keys()].join(", ") || "none"})`)
      if (p.docs.some((d) => d.name === name)) throw new CommandError(`A doc named "${name}" exists`)
      const parsed = schema.safeParse(data ?? {})
      if (!parsed.success) throw new CommandError(z.prettifyError(parsed.error))
      const id = ctx.newId("d")
      p.docs.push({ id, kind, name, data: parsed.data })
      return { id }
    },
  }),

  defineCommand({
    type: "doc.rename",
    summary: "Rename a document",
    args: z.object({ doc: z.string().describe("id or name"), name: z.string().min(1) }),
    run(p, { doc, name }) {
      const d = findDoc(p, doc)
      if (p.docs.some((o) => o.name === name && o.id !== d.id)) throw new CommandError(`A doc named "${name}" exists`)
      d.name = name
    },
  }),

  defineCommand({
    type: "doc.remove",
    summary: "Delete a document",
    args: z.object({ doc: z.string().describe("id or name") }),
    run(p, { doc }) {
      const d = findDoc(p, doc)
      p.docs = p.docs.filter((o) => o.id !== d.id)
    },
  }),

  defineCommand({
    type: "net.rename",
    summary: "Rename a net",
    args: z.object({ net: z.string().describe("id or name"), name: z.string().min(1) }),
    run(p, { net, name }) {
      const n = findNet(p, net)
      if (p.nets.some((o) => o.name === name && o.id !== n.id)) {
        throw new CommandError(`Net "${name}" exists; use net.connect to merge`)
      }
      n.name = name
    },
  }),
]

export const commands = new Map(commandList.map((c) => [c.type, c as CommandDef]))

/** Domains (cad, schematic, sim…) add their own commands at startup. */
export function registerCommands(defs: CommandDef<any>[]) {
  for (const def of defs) {
    if (commands.has(def.type)) throw new Error(`Command "${def.type}" is already registered`)
    commandList.push(def)
    commands.set(def.type, def)
  }
}

export const Command = z.object({
  type: z.string(),
  args: z.record(z.string(), z.unknown()).default({}),
})
export type Command = z.input<typeof Command>

export interface Change {
  project: Project
  patches: Patch[]
  inversePatches: Patch[]
}

/** Apply a batch atomically. Throws CommandError and leaves the project untouched on any failure. */
export function applyCommands(project: Project, batch: Command[], ctx: CommandContext): Change & { results: unknown[] } {
  const results: unknown[] = []
  const [next, patches, inversePatches] = produceWithPatches(project, (draft) => {
    batch.forEach((cmd, i) => {
      const def = commands.get(cmd.type)
      if (!def) throw new CommandError(`Unknown command "${cmd.type}"`)
      const args = def.args.safeParse(cmd.args ?? {})
      if (!args.success) throw new CommandError(`commands[${i}] ${cmd.type}: ${z.prettifyError(args.error)}`)
      try {
        results.push(def.run(draft as Project, args.data, ctx) ?? null)
      } catch (e) {
        if (e instanceof CommandError) e.message = `commands[${i}] ${cmd.type}: ${e.message}`
        throw e
      }
    })
    draft.version += 1
  })
  return { project: next, patches, inversePatches, results }
}

/** Re-apply recorded patches as a new version (used for undo and redo). */
export function replay(project: Project, patches: Patch[]): Change {
  const content = patches.filter((p) => !(p.path.length === 1 && p.path[0] === "version"))
  const [next, forward, inverse] = produceWithPatches(project, (draft) => {
    applyPatches(draft, content)
    draft.version += 1
  })
  return { project: next, patches: forward, inversePatches: inverse }
}

export function describeCommands() {
  return commandList.map((c) => ({
    type: c.type,
    summary: c.summary,
    args: z.toJSONSchema(c.args, { unrepresentable: "any" }),
  }))
}
