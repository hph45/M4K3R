import type { Command, Project } from "@m4k3r/core"
import { create } from "zustand"
import { api, ApiError, type ProjectChange, type ProjectSummary } from "./api"
import { connect, reconcile } from "./live"

export type Route = { page: "home" } | { page: "project"; id: string; tab: string }

export interface PaletteItem {
  id: string
  title: string
  hint?: string
  run(): void
}

/** One step of the ⌘K palette: a list to pick from, or (without items) a text prompt. */
export interface PaletteStep {
  placeholder: string
  initial?: string
  items?(query: string): PaletteItem[] | Promise<PaletteItem[]>
  submit?(text: string): void
}

/** Shared by every view, so selecting U1 in one view highlights it in the others. */
export interface Selection {
  component: string | null
  /** Pins picked for connecting, as "componentId/pinNum". */
  pins: string[]
}

interface State {
  route: Route
  projects: ProjectSummary[] | null
  project: Project | null
  live: boolean
  toast: { id: number; text: string } | null
  palette: PaletteStep | null
  selection: Selection
}

export const useApp = create<State>(() => ({
  route: parseHash(),
  projects: null,
  project: null,
  live: false,
  toast: null,
  palette: null,
  selection: { component: null, pins: [] },
}))

const set = useApp.setState
const get = useApp.getState

// Routing: #/ is home, #/p/<project>/<tab>.

export function parseHash(hash = location.hash): Route {
  const [, page, id, tab] = hash.replace(/^#/, "").split("/").map(decodeURIComponent)
  return page === "p" && id ? { page: "project", id, tab: tab || "wiring" } : { page: "home" }
}

export function navigate(route: Route) {
  location.hash = route.page === "home" ? "/" : `/p/${encodeURIComponent(route.id)}/${encodeURIComponent(route.tab)}`
}

export const openTab = (tab: string) => {
  const { route } = get()
  if (route.page === "project") navigate({ ...route, tab })
}

function onRoute() {
  const route = parseHash()
  const prev = get().route
  set({ route })
  if (route.page === "home") {
    set({ project: null })
    loadProjects()
  } else if (prev.page !== "project" || prev.id !== route.id || !get().project) {
    set({ project: null, selection: { component: null, pins: [] } })
    loadProject(route.id)
  }
}

// Toasts

let toastId = 0
export function toast(text: string) {
  const id = ++toastId
  set({ toast: { id, text } })
  setTimeout(() => get().toast?.id === id && set({ toast: null }), 4000)
}

async function safe<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise
  } catch (e) {
    // "commands[0] component.update: D1 already exists" reads better as "D1 already exists".
    toast(e instanceof ApiError ? e.message.replace(/^commands\[\d+\] [\w.]+: /, "") : String(e))
  }
}

// Projects

export async function loadProjects() {
  const projects = await safe(api.projects())
  if (projects) set({ projects })
}

export async function createProject(name: string) {
  const project = await safe(api.createProject(name))
  if (project) navigate({ page: "project", id: project.id, tab: "wiring" })
}

export async function deleteProject(id: string) {
  await safe(api.deleteProject(id))
  loadProjects()
}

// The open project, kept in sync with the server over /ws.

let loading: { id: string; pending: ProjectChange[] } | null = null

async function loadProject(id: string) {
  loading = { id, pending: [] }
  socket.resubscribe()
  const fetched = await safe(api.project(id))
  if (loading?.id !== id) return
  if (!fetched) {
    loading = null
    return navigate({ page: "home" })
  }
  const { history: _, ...rest } = fetched as Project & { history?: unknown }
  let project: Project = rest
  for (const change of loading.pending) {
    const next = reconcile(project, change)
    if (next === "gap") return loadProject(id)
    if (next !== "stale") project = next
  }
  loading = null
  set({ project })
}

export function receive(change: ProjectChange) {
  if (loading?.id === change.project) return void loading.pending.push(change)
  const project = get().project
  if (!project) return
  const next = reconcile(project, change)
  if (next === "gap") loadProject(project.id)
  else if (next !== "stale") set({ project: next })
}

let connectedBefore = false
const socket = connect({
  subscription: () => {
    const { route } = get()
    return route.page === "project" ? route.id : null
  },
  onStatus(live) {
    set({ live })
    // After a reconnect, resync: we may have missed changes.
    if (!live) return
    if (!connectedBefore) return void (connectedBefore = true)
    const { route } = get()
    if (route.page === "project") loadProject(route.id)
    else loadProjects()
  },
  onMessage(msg) {
    if (msg.type === "change") receive(msg)
    else if (msg.type === "projects" && get().route.page === "home") loadProjects()
  },
})

/** Apply commands to the open project. The result arrives over /ws like anyone else's edit. */
export async function run(commands: Command[], label?: string) {
  const project = get().project
  if (!project) return
  const res = await safe(api.apply(project.id, commands, label))
  if (res && !get().live) loadProject(project.id)
  return res?.results
}

export async function undo() {
  const project = get().project
  const res = project && (await safe(api.undo(project.id)))
  if (res) toast(`Undid ${res.undone}`)
}

export async function redo() {
  const project = get().project
  const res = project && (await safe(api.redo(project.id)))
  if (res) toast(`Redid ${res.redone}`)
}

// Selection

export const selectComponent = (component: string | null) =>
  set((s) => ({ selection: { ...s.selection, component } }))

export const togglePin = (key: string) =>
  set((s) => {
    const pins = s.selection.pins
    return { selection: { ...s.selection, pins: pins.includes(key) ? pins.filter((p) => p !== key) : [...pins, key] } }
  })

export const clearSelection = () => set({ selection: { component: null, pins: [] } })
export const clearPins = () => set((s) => ({ selection: { ...s.selection, pins: [] } }))

// Palette

export const openPalette = (step: PaletteStep) => set({ palette: step })
export const closePalette = () => set({ palette: null })

addEventListener("hashchange", onRoute)
onRoute()
