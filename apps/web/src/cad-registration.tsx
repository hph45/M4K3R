import { registerAction, registerDocView } from "./registry"
import { openPalette, openTab, run, useApp } from "./store"
import { Cad } from "./ui/Cad"

export function newPartStudio() {
  openPalette({
    placeholder: "Part studio name",
    initial: "Part Studio",
    async submit(name) {
      if (!name.trim()) return
      const result = await run([{ type: "doc.create", args: { kind: "part-studio", name: name.trim() } }], `Create ${name.trim()}`)
      const doc = result?.[0] as { id: string } | undefined
      if (doc?.id) openTab(doc.id)
    },
  })
}

registerDocView("part-studio", Cad)
registerAction({ id: "cad.new", title: "New part studio…", when: () => !!useApp.getState().project, run: newPartStudio })
