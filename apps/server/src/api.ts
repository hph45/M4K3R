import { Router, type ErrorRequestHandler } from "express"
import { z } from "zod"
import { Command, CommandError, describeCommands, netlist, netlistText } from "@m4k3r/core"
import type { DomainContext } from "./domain"
import { domains } from "./domains"
import { NotFound } from "./store"

const Batch = z.object({ commands: z.array(Command).min(1), label: z.string().optional() })

export function api(ctx: DomainContext) {
  const { store, library } = ctx
  const r = Router()

  r.get("/commands", (_req, res) => {
    res.json(describeCommands())
  })

  r.get("/projects", (_req, res) => {
    res.json(store.list())
  })

  r.post("/projects", (req, res) => {
    const { name } = z.object({ name: z.string().min(1) }).parse(req.body)
    res.status(201).json(store.create(name))
  })

  r.get("/projects/:id", (req, res) => {
    res.json({ ...store.get(req.params.id), history: store.historyLabels(req.params.id) })
  })

  r.delete("/projects/:id", (req, res) => {
    store.delete(req.params.id)
    res.status(204).end()
  })

  r.post("/projects/:id/commands", (req, res) => {
    const { commands, label } = Batch.parse(req.body)
    res.json(store.apply(req.params.id, commands, label))
  })

  r.post("/projects/:id/undo", (req, res) => {
    res.json(store.undo(req.params.id))
  })

  r.post("/projects/:id/redo", (req, res) => {
    res.json(store.redo(req.params.id))
  })

  r.get("/projects/:id/netlist", (req, res) => {
    const project = store.get(req.params.id)
    if (req.query.format === "text") res.type("text/plain").send(netlistText(project))
    else res.json(netlist(project))
  })

  r.get("/parts", (req, res) => {
    res.json(library.search(String(req.query.q ?? "")))
  })

  r.get("/parts/:id", (req, res) => {
    const part = library.get(req.params.id)
    if (!part) throw new NotFound(`No part "${req.params.id}"`)
    res.json(part)
  })

  r.put("/parts/:id", (req, res) => {
    res.json(library.save({ ...req.body, id: req.params.id }))
  })

  for (const domain of domains) domain.routes?.(r, ctx)
  r.use(errors)
  return r
}

export const errors: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err)
  if (err instanceof NotFound) res.status(404).json({ error: err.message })
  else if (err instanceof CommandError) res.status(400).json({ error: err.message })
  else if (err instanceof z.ZodError) res.status(400).json({ error: z.prettifyError(err) })
  else if (err instanceof SyntaxError) res.status(400).json({ error: `Bad JSON: ${err.message}` })
  else {
    console.error(err)
    res.status(500).json({ error: String(err?.message ?? err) })
  }
}
