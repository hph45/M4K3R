import { registerAction, registerDocView } from "./registry"
import { openTab, run, useApp } from "./store"
import { DeviceAnalysis } from "./ui/DeviceAnalysis"

registerDocView("device-analysis", DeviceAnalysis)
registerAction({ id: "device.analysis.new", title: "New device feasibility analysis", when: () => !!useApp.getState().project, run: async () => {
  const project = useApp.getState().project!
  let name = "Device feasibility"
  for (let number = 2; project.docs.some((doc) => doc.name === name); number++) name = `Device feasibility ${number}`
  const results = await run([{ type: "doc.create", args: { kind: "device-analysis", name, data: { assembly: project.docs.find((doc) => doc.kind === "assembly")?.id } } }], "Create device feasibility analysis")
  const created = results?.[0] as { id?: string } | undefined
  if (created?.id) openTab(created.id)
} })
