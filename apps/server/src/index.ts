import { existsSync } from "node:fs"
import { createServer, type IncomingMessage } from "node:http"
import { homedir } from "node:os"
import { join, resolve } from "node:path"
import { registerCommands } from "@m4k3r/core"
import express from "express"
import { WebSocketServer, type WebSocket } from "ws"
import { api } from "./api"
import type { DomainContext } from "./domain"
import { domains } from "./domains"
import { PartLibrary } from "./library"
import { mcp } from "./mcp"
import { ProjectStore } from "./store"

const PORT = Number(process.env.PORT ?? 4400)
const HOME = process.env.M4K3R_HOME ?? join(homedir(), "M4K3R")
const ROOT = resolve(import.meta.dirname, "../../..")
const WEB = join(ROOT, "apps/web")
const DEV = process.env.NODE_ENV !== "production"

const library = new PartLibrary(join(ROOT, "library/parts"), join(HOME, "parts"))
const store = new ProjectStore(join(HOME, "projects"), library)
const ctx: DomainContext = { store, library, home: HOME }
for (const domain of domains) {
  registerCommands(domain.commands ?? [])
  await domain.setup?.(ctx)
}

// No auth, so only answer to localhost. This also blocks DNS-rebinding attacks from web pages.
const LOCAL = new Set(["localhost", "127.0.0.1", "[::1]"])
const isLocal = (req: IncomingMessage) => LOCAL.has((req.headers.host ?? "").replace(/:\d+$/, ""))

const app = express()
const server = createServer(app)

app.use((req, res, next) => (isLocal(req) ? next() : res.status(403).send("M4K3R only accepts localhost requests")))
app.use(express.json({ limit: "10mb" }))
app.use("/api", api(ctx))
app.post("/mcp", mcp(ctx))
app.all("/mcp", (_req, res) => res.status(405).set("Allow", "POST").end())

// Live updates: clients send { subscribe: projectId } and receive every change to that project.
const wss = new WebSocketServer({ noServer: true })
const subscriptions = new Map<WebSocket, string>()
server.on("upgrade", (req, socket, head) => {
  if (new URL(req.url ?? "/", "http://localhost").pathname !== "/ws") return
  if (!isLocal(req)) return socket.destroy()
  wss.handleUpgrade(req, socket, head, (ws) => {
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as { subscribe?: string }
        if (msg.subscribe) subscriptions.set(ws, msg.subscribe)
      } catch {}
    })
    ws.on("close", () => subscriptions.delete(ws))
  })
})
store.on("change", (change) => {
  const msg = JSON.stringify({ type: "change", ...change })
  for (const [ws, id] of subscriptions) if (id === change.project) ws.send(msg)
})
store.on("projects", () => {
  for (const ws of wss.clients) ws.send(JSON.stringify({ type: "projects" }))
})

if (DEV) {
  const { createServer: createVite } = await import("vite")
  const vite = await createVite({
    root: WEB,
    configFile: join(WEB, "vite.config.ts"),
    server: { middlewareMode: true, hmr: { server } },
    appType: "spa",
  })
  app.use(vite.middlewares)
} else {
  const dist = join(WEB, "dist")
  if (!existsSync(dist)) throw new Error("No UI build found. Run `pnpm build` first, or use `pnpm dev`.")
  app.use(express.static(dist))
  app.get("/{*path}", (_req, res) => res.sendFile(join(dist, "index.html")))
}

server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n  M4K3R  http://localhost:${PORT}\n`)
  console.log(`  projects  ${join(HOME, "projects")}`)
  console.log(`  agents    claude mcp add --transport http m4k3r http://localhost:${PORT}/mcp\n`)
})
