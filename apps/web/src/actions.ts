import { pinAddress, type Net, type Project } from "@m4k3r/core"
import { api } from "./api"
import { availableActions, formatKeys, registerAction } from "./registry"
import {
  clearPins, createProject, navigate, openPalette, openTab, redo, run, selectComponent, undo, useApp,
  type PaletteItem, type PaletteStep,
} from "./store"
import { toggleTheme } from "./theme"

/** True when every word of the query appears in the text. */
export const fuzzy = (query: string, text: string) =>
  query
    .toLowerCase()
    .split(/\s+/)
    .every((w) => text.toLowerCase().includes(w))

const project = () => useApp.getState().project
const inProject = () => !!project()

/** "componentId/pinNum" → "R1.A", or null if the pin is gone. */
export function pinLabel(p: Project, key: string) {
  const [component = "", pin = ""] = key.split("/")
  try {
    return pinAddress(p, { component, pin }).address
  } catch {
    return null
  }
}

export const selectedPins = () => {
  const p = project()
  return p ? useApp.getState().selection.pins.flatMap((k) => pinLabel(p, k) ?? []) : []
}

export const commandsStep = (): PaletteStep => ({
  placeholder: "Type a command…",
  items: (q) =>
    availableActions()
      .filter((a) => fuzzy(q, a.title))
      .map((a) => ({ id: a.id, title: a.title, hint: a.keys && formatKeys(a.keys), run: a.run })),
})

const pick = (placeholder: string, all: PaletteItem[]): PaletteStep => ({
  placeholder,
  items: (q) => all.filter((i) => fuzzy(q, `${i.title} ${i.hint ?? ""}`)),
})

export function addComponent() {
  openPalette({
    placeholder: "Search parts…",
    items: async (q) =>
      (await api.parts(q).catch(() => [])).map((part) => ({
        id: part.id,
        title: part.name,
        hint: part.category,
        async run() {
          const results = await run([{ type: "component.add", args: { part: part.id } }], `Add ${part.name}`)
          const added = results?.[0] as { id?: string } | undefined
          if (added?.id) selectComponent(added.id)
        },
      })),
  })
}

export async function connect(pins: string[], name?: string) {
  if (await run([{ type: "net.connect", args: { pins, name: name || undefined } }], `Connect ${pins.join(", ")}`)) {
    clearPins()
  }
}

export async function disconnect(pins: string[]) {
  if (await run([{ type: "net.disconnect", args: { pins } }], `Disconnect ${pins.join(", ")}`)) clearPins()
}

export const renameNet = (net: Net, name: string) =>
  name && name !== net.name && run([{ type: "net.rename", args: { net: net.id, name } }], `Rename ${net.name} to ${name}`)

registerAction({ id: "component.add", title: "Add component…", when: inProject, run: addComponent })

registerAction({
  id: "net.connect",
  title: "Connect pins…",
  when: inProject,
  run: () =>
    openPalette({
      placeholder: "Pins to connect, e.g. R1.2 D1.A",
      initial: selectedPins().join(" "),
      submit(text) {
        const pins = text.split(/[\s,]+/).filter(Boolean)
        if (!pins.length) return
        openPalette({ placeholder: "Net name (optional), then Enter", submit: (name) => connect(pins, name.trim()) })
      },
    }),
})

registerAction({
  id: "net.disconnect",
  title: "Disconnect selected pins",
  when: () => selectedPins().length > 0,
  run: () => disconnect(selectedPins()),
})

registerAction({
  id: "net.rename",
  title: "Rename net…",
  when: () => !!project()?.nets.length,
  run: () =>
    openPalette(
      pick(
        "Which net?",
        project()!.nets.map((n) => ({
          id: n.id,
          title: n.name,
          hint: `${n.pins.length} pins`,
          run: () => openPalette({ placeholder: "New name", initial: n.name, submit: (name) => renameNet(n, name.trim()) }),
        })),
      ),
    ),
})

registerAction({
  id: "component.remove",
  title: "Remove component…",
  when: () => !!project()?.components.length,
  run: () =>
    openPalette(
      pick(
        "Which component?",
        project()!.components.map((c) => ({
          id: c.id,
          title: c.ref,
          hint: project()!.parts[c.part]?.name ?? c.part,
          run: () => run([{ type: "component.remove", args: { component: c.id } }], `Remove ${c.ref}`),
        })),
      ),
    ),
})

registerAction({ id: "undo", title: "Undo", keys: "mod+z", when: inProject, run: undo })
registerAction({ id: "redo", title: "Redo", keys: "mod+shift+z", when: inProject, run: redo })

registerAction({
  id: "tab.switch",
  title: "Switch tab…",
  when: inProject,
  run: () =>
    openPalette(
      pick("Which tab?", [
        { id: "wiring", title: "Wiring", run: () => openTab("wiring") },
        ...project()!.docs.map((d) => ({ id: d.id, title: d.name, hint: d.kind, run: () => openTab(d.id) })),
      ]),
    ),
})

registerAction({
  id: "project.new",
  title: "New project…",
  run: () =>
    openPalette({ placeholder: "Project name", submit: (name) => name.trim() && createProject(name.trim()) }),
})

registerAction({
  id: "project.open",
  title: "Open project…",
  run: async () => {
    const projects = await api.projects().catch(() => [])
    openPalette(
      pick(
        "Which project?",
        projects.map((p) => ({
          id: p.id,
          title: p.name,
          hint: `${p.components} components`,
          run: () => navigate({ page: "project", id: p.id, tab: "wiring" }),
        })),
      ),
    )
  },
})

registerAction({ id: "home", title: "All projects", when: inProject, run: () => navigate({ page: "home" }) })
registerAction({ id: "theme.toggle", title: "Toggle light/dark theme", run: toggleTheme })
