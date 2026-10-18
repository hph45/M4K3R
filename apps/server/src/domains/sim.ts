import { formatQuantity, parseQuantity } from "@m4k3r/core"
import { SimError, simulate, type SimOptions, type SimResult } from "@m4k3r/sim"
import { z } from "zod"
import { tool, type Domain } from "../domain"

const Time = z.union([z.number(), z.string()]).describe('Seconds, e.g. 0.5 or "500ms"')

const Options = {
  analysis: z.enum(["op", "tran"]).describe("op: DC operating point. tran: run from power-on (everything at rest)"),
  duration: Time.optional().describe('tran length, e.g. "1s"'),
  step: Time.optional().describe("Time step. Default min(10µs, duration/1000)"),
  probes: z
    .array(z.string())
    .optional()
    .describe("Waveforms to record: net names, V(NET), I(REF) or REF.field like M1.rpm. Default: all nets and currents"),
  inputs: z
    .array(
      z.object({
        t: Time,
        ref: z.string().describe("e.g. SW1"),
        action: z.string().describe("Buttons: press, release. Switches: A, B, toggle"),
        value: z.union([z.number(), z.string()]).optional(),
      }),
    )
    .optional()
    .describe("Timed user events"),
}

const seconds = (v: number | string | undefined) => {
  if (v === undefined || typeof v === "number") return v
  const q = parseQuantity(v)
  if (!q || (q.unit !== "s" && q.unit !== "")) throw new SimError(`"${v}" isn't a time, e.g. 0.5 or "500ms"`)
  return q.value
}

type Args = z.infer<z.ZodObject<typeof Options>>

const options = (a: Args, maxPoints?: number): SimOptions => ({
  ...a,
  duration: seconds(a.duration),
  step: seconds(a.step),
  inputs: a.inputs?.map((e) => ({ ...e, t: seconds(e.t)! })),
  maxPoints,
})

const fmt = (v: number, unit = "") => formatQuantity(Math.abs(v) < 1e-12 ? 0 : v, unit)
const UNITS: Record<string, string> = { voltage: "V", current: "A" }

/** Compact text for agents: final values, then a few points per waveform. */
export function summary(r: SimResult): string {
  const list = (o: Record<string, number>, unit: string) =>
    Object.entries(o)
      .map(([k, v]) => `${k}=${fmt(v, unit)}`)
      .join("  ")
  const view = (o: Record<string, unknown>) =>
    Object.entries(o)
      .map(([k, v]) => `${k}=${typeof v === "number" ? (UNITS[k] ? fmt(v, UNITS[k]) : Number(v.toPrecision(3))) : v}`)
      .join(" ")
  const lines = [
    r.analysis === "op"
      ? `DC operating point (${r.stats.ms} ms)`
      : `Transient to ${fmt(r.t, "s")}: ${r.stats.steps} steps in ${r.stats.ms} ms`,
    ...r.warnings.map((w) => `Warning: ${w}`),
    `Voltages: ${list(r.voltages, "V")}`,
    `Currents: ${list(r.currents, "A")}`,
    ...Object.entries(r.views).map(([ref, v]) => `${ref}: ${view(v)}`),
  ]
  if (r.waveforms) {
    lines.push("", "Waveforms (V in volts, I in amps):", `t: ${r.waveforms.time.map((t) => fmt(t)).join(" ")}`)
    for (const [name, values] of Object.entries(r.waveforms.series)) lines.push(`${name}: ${values.map((v) => fmt(v)).join(" ")}`)
  }
  return lines.join("\n")
}

export const sim: Domain = {
  name: "sim",

  routes(router, { store }) {
    router.post("/projects/:id/simulate", (req, res) => {
      const body = z.object({ ...Options, maxPoints: z.number().int().positive().optional() }).parse(req.body ?? {})
      try {
        res.json(simulate(store.get(req.params.id), options(body, body.maxPoints)))
      } catch (e) {
        if (!(e instanceof SimError)) throw e
        res.status(400).json({ error: e.message })
      }
    })
  },

  tools(server, { store }) {
    server.registerTool(
      "simulate",
      {
        description:
          "Simulate the project's circuit (analog MNA with behavioral models). Ground is the net named GND. " +
          "Returns final net voltages, part currents, model state (LED brightness, motor rpm, battery soc) " +
          "and, for tran, about 20 points per waveform.",
        inputSchema: { project: z.string().describe("Project id"), ...Options },
      },
      tool(({ project, ...args }: Args & { project: string }) => summary(simulate(store.get(project), options(args, 20)))),
    )
  },
}
