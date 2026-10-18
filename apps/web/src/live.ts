import type { Project } from "@m4k3r/core"
import { applyPatches, enablePatches } from "immer"
import type { ProjectChange } from "./api"

enablePatches()

/**
 * Apply a live change to the local copy. "stale" means we already have it (or it's for another project);
 * "gap" means we missed a version and should refetch.
 */
export function reconcile(project: Project, change: ProjectChange): Project | "stale" | "gap" {
  if (change.project !== project.id || change.version <= project.version) return "stale"
  if (change.version !== project.version + 1) return "gap"
  return applyPatches(project, change.patches)
}

type Message = ({ type: "change" } & ProjectChange) | { type: "projects" }

/** One socket for the app. Reconnects with backoff and resubscribes; onOpen lets callers resync. */
export function connect(handlers: {
  onMessage(msg: Message): void
  onStatus(live: boolean): void
  subscription(): string | null
}) {
  let ws: WebSocket
  let delay = 500
  const open = () => {
    ws = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws`)
    ws.onopen = () => {
      delay = 500
      resubscribe()
      handlers.onStatus(true)
    }
    ws.onmessage = (e) => {
      try {
        handlers.onMessage(JSON.parse(e.data))
      } catch {}
    }
    ws.onclose = () => {
      handlers.onStatus(false)
      setTimeout(open, delay)
      delay = Math.min(delay * 2, 5000)
    }
  }
  const resubscribe = () => {
    const id = handlers.subscription()
    if (id && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ subscribe: id }))
  }
  open()
  return { resubscribe }
}
