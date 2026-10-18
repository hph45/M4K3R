import type { Command, Patch, Project } from "@m4k3r/core"

export interface ProjectSummary {
  id: string
  name: string
  version: number
  components: number
  nets: number
}

export interface PartSummary {
  id: string
  name: string
  category: string
  description: string
  refPrefix: string
  pins: number
  source: "builtin" | "user"
}

/** Sent over /ws for every change to a subscribed project. */
export interface ProjectChange {
  project: string
  version: number
  patches: Patch[]
}

export class ApiError extends Error {}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/api${path}`, {
      method,
      headers: body === undefined ? {} : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError("Can't reach the M4K3R server")
  }
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.error ?? `${res.status} ${res.statusText}`)
  return data as T
}

const pid = (id: string) => `/projects/${encodeURIComponent(id)}`

export const api = {
  projects: () => request<ProjectSummary[]>("GET", "/projects"),
  createProject: (name: string) => request<Project>("POST", "/projects", { name }),
  project: (id: string) => request<Project>("GET", pid(id)),
  deleteProject: (id: string) => request<void>("DELETE", pid(id)),
  apply: (id: string, commands: Command[], label?: string) =>
    request<{ version: number; results: unknown[] }>("POST", `${pid(id)}/commands`, { commands, label }),
  undo: (id: string) => request<{ version: number; undone: string }>("POST", `${pid(id)}/undo`),
  redo: (id: string) => request<{ version: number; redone: string }>("POST", `${pid(id)}/redo`),
  parts: (q = "") => request<PartSummary[]>("GET", `/parts?q=${encodeURIComponent(q)}`),
}
