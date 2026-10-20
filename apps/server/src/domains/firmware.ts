import { existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { registerDocKind, type Project } from "@m4k3r/core"
import {
  build, buildInput, firmwareCommands, FirmwareData, firmwareDoc, pinDefines, pinHeader, runFirmware, Toolchain,
  type BuildResult,
  runEspFirmware, espChipForBoard,
} from "@m4k3r/firmware"
import { z } from "zod"
import { tool, type Domain, type DomainContext } from "../domain"
import { NotFound } from "../store"

const MAX_MS = 60_000
const WALL_MS = 30_000

function service({ store, home }: DomainContext) {
  const tc = new Toolchain(home)
  const cache = join(home, ".cache", "builds")

  const buildDoc = (project: string, doc: string) => build(tc, cache, buildInput(store.get(project), doc))

  const withUrls = (r: BuildResult, project: string, doc: string) => ({
    ...r,
    artifacts: r.artifacts.map((f) => `/api/projects/${project}/firmware/${doc}/build/${r.hash}/${f}`),
  })

  async function run(project: string, doc: string, ms: number) {
    // Keep sources, target and GPIO labels from one immutable project version.
    const snapshot = store.get(project)
    const data = firmwareDoc(snapshot, doc)
    const built = await build(tc, cache, buildInput(snapshot, doc))
    if (!built.ok) return { ok: false as const, diagnostics: built.diagnostics }
    const result = data.platform === "esp32"
      ? await runEspFirmware(home, readFileSync(join(cache, built.hash, "firmware.merged.bin")), ms, WALL_MS, espChipForBoard(data.board))
      : await runFirmware(readFileSync(join(cache, built.hash, "firmware.uf2")), ms, WALL_MS)
    return { ok: true as const, ...result, gpio: withNets(snapshot, doc, result.gpio) }
  }

  const artifact = (hash: string, file: string) => {
    const path = join(cache, hash, file)
    if (!/^[0-9a-f]{16}$/.test(hash) || !/^firmware\.(uf2|elf|(?:bootloader\.|partitions\.|merged\.)?bin)$/.test(file) || !existsSync(path)) {
      throw new NotFound(`No build artifact ${hash}/${file}`)
    }
    return path
  }

  return { buildDoc, withUrls, run, artifact }
}

/** Label each GPIO with the net it drives, when the schematic says so. */
function withNets<T extends object>(p: Project, doc: string, gpio: Record<string, T>) {
  const mcu = firmwareDoc(p, doc).mcu
  const nets = new Map(mcu ? pinDefines(p, mcu).map((d) => [`GP${d.gpio}`, d.net]) : [])
  return Object.fromEntries(Object.entries(gpio).map(([pin, s]) => [pin, nets.has(pin) ? { net: nets.get(pin), ...s } : s]))
}

const diagnosticsText = (r: Pick<BuildResult, "diagnostics">) =>
  r.diagnostics.map((d) => `${d.file || "build"}:${d.line}:${d.col} ${d.severity}: ${d.message}`).join("\n")

let svc: ReturnType<typeof service>

export const firmware: Domain = {
  name: "firmware",
  commands: firmwareCommands,

  setup(ctx) {
    registerDocKind("firmware", FirmwareData)
    svc = service(ctx)
  },

  routes(r, { store }) {
    r.get("/projects/:id/firmware/:doc/pins.h", (req, res) => {
      const p = store.get(req.params.id)
      res.type("text/plain").send(pinHeader(p, firmwareDoc(p, req.params.doc).mcu))
    })

    r.post("/projects/:id/firmware/:doc/build", async (req, res) => {
      const { id, doc } = req.params
      res.json(svc.withUrls(await svc.buildDoc(id, doc), id, doc))
    })

    r.get("/projects/:id/firmware/:doc/build/:hash/:file", (req, res) => {
      res.download(svc.artifact(req.params.hash, req.params.file), req.params.file, { dotfiles: "allow" })
    })

    r.post("/projects/:id/firmware/:doc/run", async (req, res) => {
      const { ms } = z.object({ ms: z.number().positive().max(MAX_MS).default(1000) }).parse(req.body ?? {})
      res.json(await svc.run(req.params.id, req.params.doc, ms))
    })
  },

  tools(server) {
    const args = { project: z.string().describe("Project id"), doc: z.string().describe("Firmware doc id or name") }

    server.registerTool(
      "firmware_build",
      { description: "Compile Arduino firmware with a pinned RP2040 or ESP32 core. Returns size or compiler diagnostics.", inputSchema: args },
      tool(async ({ project, doc }: { project: string; doc: string }) => {
        const r = await svc.buildDoc(project, doc)
        const head = r.ok ? `Build OK (${r.hash}): flash ${r.size?.flash} B, RAM ${r.size?.ram} B` : "Build failed"
        return [head, diagnosticsText(r)].filter(Boolean).join("\n")
      }),
    )

    server.registerTool(
      "firmware_run",
      {
        description:
          "Build a firmware doc and run real RP2040 or supported ESP32 machine code for ms of simulated time. " +
          "Returns serial output and the final state of every GPIO the firmware configured.",
        inputSchema: { ...args, ms: z.number().positive().max(MAX_MS).default(1000) },
      },
      tool(async ({ project, doc, ms }: { project: string; doc: string; ms: number }) => {
        const r = await svc.run(project, doc, ms)
        if (!r.ok) return `Build failed\n${diagnosticsText(r)}`
        const serial = Object.entries(r.serial).map(([port, text]) => `--- ${port}\n${text}`)
        const gpio = Object.entries(r.gpio).map(
          ([pin, s]) => `${pin}${"net" in s ? ` (${s.net})` : ""}: ${s.state}, ${s.function}, ${s.edges} edges`,
        )
        return [
          `${r.complete === false ? "Partial execution: " : ""}Ran ${r.simulatedMs} ms simulated in ${r.wallMs} ms`,
          ...(serial.length ? serial : ["(no serial output)"]),
          "--- GPIO",
          ...(gpio.length ? gpio : ["(none configured)"]),
          ...(r.warnings ?? []).map((warning) => `Warning: ${warning}`),
        ].join("\n")
      }),
    )
  },
}
