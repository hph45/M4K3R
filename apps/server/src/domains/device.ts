import { findComponent, registerDocKind } from "@m4k3r/core"
import { evaluateAssembly } from "@m4k3r/assembly/node"
import { analyzeDevice, DeviceAnalysisData, deviceAnalysisCommands, deviceAnalysisDoc, deviceAnalysisSummary, FlightOptions, resolveRotors, simulateFlight, type AircraftGeometry, type Vector3 } from "@m4k3r/sim"
import { tool, type Domain } from "../domain"
import { z } from "zod"

export const device: Domain = {
  name: "device", commands: deviceAnalysisCommands,
  setup() { registerDocKind("device-analysis", DeviceAnalysisData) },
  routes(router, { store }) {
    router.get("/projects/:id/device-analysis/:doc", async (request, response) => {
      response.json(await evaluateDevice(store.get(request.params.id), request.params.doc))
    })
    router.post("/projects/:id/device-analysis/:doc/flight", async (request, response) => {
      const setup = await deviceSetup(store.get(request.params.id), request.params.doc)
      response.json(simulateFlight(setup.data, setup.geometry, FlightOptions.parse(request.body ?? {})))
    })
  },
  tools(server, { store }) {
    server.registerTool("device_analyze", {
      description: "Evaluate a device-analysis document using its assembly mass/CG/inertia and rotor data from the placed motor/propeller parts (or per-rotor measured curves / Ct/Cp overrides). Returns a short text summary: status, mass, thrust/weight, max thrust, hover throttle/current/runtime, per-rotor values, missing data and checks. Pass full: true for the complete JSON (clearances, moments, assumptions). Missing data stays explicit; kV alone cannot predict thrust.",
      inputSchema: { project: z.string(), doc: z.string(), full: z.boolean().optional().describe("Return the complete JSON result instead of the summary") },
    }, tool(async ({ project, doc, full }: { project: string; doc: string; full?: boolean }) => { const result = await evaluateDevice(store.get(project), doc); return full ? result : deviceAnalysisSummary(result) }))
    server.registerTool("device_flight_preview", {
      description: "Run a deterministic bounded 6DOF quaternion rigid-body theory preview using assembly mass/CG/inertia, rotor thrust/reaction torque and battery limits. Manual collective/per-rotor controls; this does not execute firmware or provide an autopilot. Returns altitude/attitude/time trajectory with assumptions and conservative ground contact.",
      inputSchema: { project: z.string(), doc: z.string(), ...FlightOptions.shape },
    }, tool(async ({ project, doc, ...input }: FlightOptions & { project: string; doc: string }) => { const setup = await deviceSetup(store.get(project), doc); return simulateFlight(setup.data, setup.geometry, FlightOptions.parse(input)) }))
  },
}

export async function deviceSetup(project: Parameters<typeof deviceAnalysisDoc>[0], doc: string) {
  let data = deviceAnalysisDoc(project, doc)
  const linked = data.assembly ?? project.docs.find((candidate) => candidate.kind === "assembly")?.id
  const blank: AircraftGeometry = { mass: 0, centerOfMass: [0, 0, 0], inertia: [[0, 0, 0], [0, 0, 0], [0, 0, 0]], rotors: {}, obstacles: [], warnings: [] }
  if (!linked) return { data: resolveRotors(project, data), geometry: { ...blank, warnings: ["Link an assembly document to include component, frame, CAD and payload mass"] } }
  const assembly = await evaluateAssembly(project, linked, { interference: true })
  const geometry: AircraftGeometry = { ...blank, mass: assembly.mass, centerOfMass: assembly.centerOfMass, inertia: assembly.inertia, warnings: assembly.warnings, mechanicalConflicts: assembly.interferences.map((issue) => `Assembly ${issue.severity}: ${issue.a} / ${issue.b}${issue.message ? ` — ${issue.message}` : ""} (${issue.method} check)`), missingMass: [] }
  const reference = (component: string) => { try { return findComponent(project, component).ref } catch { return component } }
  const poses: Record<string, { center: Vector3; axis: Vector3 }> = {}
  for (const instance of assembly.instances) {
    const ref = instance.source.type === "component" ? reference(instance.source.component) : instance.name
    if (instance.source.type === "component") {
      const component = findComponent(project, instance.source.component), physical = project.parts[component.part]?.physical
      if (component.props["physical.mass"] === undefined && physical?.mass === undefined) geometry.missingMass!.push(`${ref}: placed component has no known mass; excluded from assembly mass/CG/inertia totals`)
    }
    geometry.obstacles.push({ ref, min: instance.bbox.min, max: instance.bbox.max })
    if (instance.source.type === "component") poses[ref] = { center: instance.centerOfMass, axis: instance.axis }
  }
  data = resolveRotors(project, data, Object.fromEntries(Object.entries(poses).map(([ref, pose]) => [ref, pose.center])))
  for (const rotor of data.rotors) {
    const pose = poses[rotor.propeller ?? rotor.component]
    if (pose) geometry.rotors[rotor.component] = pose
  }
  return { data, geometry }
}

export async function evaluateDevice(project: Parameters<typeof deviceAnalysisDoc>[0], doc: string) {
  const setup = await deviceSetup(project, doc)
  return analyzeDevice(setup.data, setup.geometry)
}
