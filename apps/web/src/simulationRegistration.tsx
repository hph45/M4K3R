import { registerAction, registerDocView } from "./registry"
import { openPalette, openTab, run, useApp } from "./store"
import { Simulate, toggleSimulation } from "./ui/Simulate"

registerDocView("simulation", Simulate)

export async function newSimulation(name = "Simulation") {
  const project = useApp.getState().project
  if (!project) return
  let unique = name
  for (let index = 2; project.docs.some((doc) => doc.name === unique); index++) unique = `${name} ${index}`
  const probes = project.nets.filter((net) => net.name.toUpperCase() !== "GND" && net.name !== "0").slice(0, 3).map((net) => `V(${net.name})`)
  const result = await run([{ type: "doc.create", args: { kind: "simulation", name: unique, data: { probes } } }], `Create ${unique}`)
  const created = result?.[0] as { id?: string } | undefined
  if (created?.id) openTab(created.id)
}

registerAction({
  id: "simulation.new", title: "New simulation…", when: () => !!useApp.getState().project,
  run: () => openPalette({ placeholder: "Simulation name", initial: "Simulation", submit: (name) => { if (name.trim()) newSimulation(name.trim()) } }),
})
registerAction({
  id: "simulation.toggle", title: "Run / pause simulation", keys: "mod+enter",
  when: () => {
    const { project, route } = useApp.getState()
    return route.page === "project" && !!project?.docs.some((doc) => doc.id === route.tab && doc.kind === "simulation")
  },
  run: toggleSimulation,
})
