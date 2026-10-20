import { formatQuantity, parseQuantity, registerDocKind } from "@m4k3r/core"
import { SimError, simulate, SimulationData, simulationCommands, simulationDoc, simulationOptions, runScenario, type SimOptions, type SimResult } from "@m4k3r/sim"
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
  commands: simulationCommands,

  setup() {
    registerDocKind("simulation", SimulationData)
  },

  routes(router, { store }) {
    router.post("/projects/:id/simulation/:doc/scenario", (req, res) => {
      const project = store.get(req.params.id), data = simulationDoc(project, req.params.doc)
      res.json(runScenario(project, data))
    })
    router.post("/projects/:id/simulation/:doc/run", (req, res) => {
      const { maxPoints } = z.object({ maxPoints: z.number().int().positive().max(10000).default(500) }).parse(req.body ?? {})
      try {
        const project = store.get(req.params.id)
        res.json(simulate(project, { ...simulationOptions(project, req.params.doc), maxPoints }))
      } catch (e) {
        if (!(e instanceof SimError)) throw e
        res.status(400).json({ error: e.message })
      }
    })

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
    server.registerTool("simulation_scenario", { description: "Run a saved simulation's timed inputs and numeric probe assertions. Configure checks with sim.update; returns explicit pass/fail values and sample times.", inputSchema: { project: z.string(), doc: z.string() } }, tool(({ project: id, doc }: { project: string; doc: string }) => { const project = store.get(id); return runScenario(project, simulationDoc(project, doc)) }))
    server.registerTool(
      "simulation_run",
      {
        description: "Run a saved simulation document with its analysis settings, scope probes and timed inputs. Create with doc.create kind=simulation; edit with sim.update.",
        inputSchema: { project: z.string(), doc: z.string().describe("Simulation document id or name") },
      },
      tool(({ project: id, doc }: { project: string; doc: string }) => {
        const project = store.get(id)
        return summary(simulate(project, { ...simulationOptions(project, doc), maxPoints: 20 }))
      }),
    )

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
