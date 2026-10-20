import { defineCommand, findDoc, type Project } from "@m4k3r/core"
import { z } from "zod"
import type { SimOptions } from "./simulate"
import { ScenarioCheck } from "./scenario"
import { SkidSteerData } from "./vehicle"

const Positive = z.number().positive()
export const SimulationData = z.object({
  analysis: z.enum(["op", "tran"]).default("tran"),
  duration: Positive.default(1).describe("Saved headless transient duration, in seconds"),
  step: Positive.min(1e-9).max(1).default(0.00001).describe("Fixed solver time step, in seconds"),
  speed: Positive.min(0.01).max(100).default(1).describe("Requested simulated seconds per wall second"),
  probes: z.array(z.string().min(1)).max(32).default([]),
  inputs: z.array(z.object({
    t: z.number().nonnegative(), ref: z.string().min(1), action: z.string().min(1),
    value: z.union([z.number(), z.string()]).optional(),
  })).default([]),
  checks: z.array(ScenarioCheck).max(128).default([]),
  vehicle: SkidSteerData.nullable().default(null),
})
export type SimulationData = z.infer<typeof SimulationData>

export const simulationDoc = (project: Project, doc: string): SimulationData =>
  SimulationData.parse(findDoc(project, doc, "simulation").data)

/** The browser and headless API use the same saved solver settings and timed inputs. */
export const simulationOptions = (project: Project, doc: string): SimOptions => {
  const { analysis, duration, step, probes, inputs } = simulationDoc(project, doc)
  return { analysis, duration, step, probes: probes.length ? probes : undefined, inputs }
}

export const simulationCommands = [defineCommand({
  type: "sim.update",
  summary: "Update a saved simulation's analysis, duration/step (seconds), live speed, scope probes or timed inputs",
  args: z.object({
    doc: z.string().describe("Simulation document id or name"),
    analysis: SimulationData.shape.analysis.removeDefault().optional(),
    duration: SimulationData.shape.duration.removeDefault().optional(),
    step: SimulationData.shape.step.removeDefault().optional(),
    speed: SimulationData.shape.speed.removeDefault().optional(),
    probes: SimulationData.shape.probes.removeDefault().optional(),
    inputs: SimulationData.shape.inputs.removeDefault().optional(),
    checks: SimulationData.shape.checks.removeDefault().optional(),
    vehicle: SimulationData.shape.vehicle.removeDefault().optional(),
  }),
  run(project, { doc, ...changes }) {
    const target = findDoc(project, doc, "simulation")
    target.data = SimulationData.parse({ ...simulationDoc(project, doc), ...changes })
  },
})]
