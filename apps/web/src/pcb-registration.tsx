import { registerAction, registerDocView } from "./registry"
import { openPalette, openTab, run, useApp } from "./store"
import { Pcb } from "./ui/Pcb"
import "./ui/pcb.css"

export function newPcb() {
  openPalette({ placeholder: "PCB name", initial: "Main board", async submit(text) {
    const name = text.trim()
    if (!name) return
    const result = await run([{ type: "doc.create", args: { kind: "pcb", name } }, { type: "pcb.sync", args: { doc: name } }], "Create PCB and place footprints")
    const id = (result?.[0] as { id?: string } | undefined)?.id
    if (id) openTab(id)
  } })
}
registerDocView("pcb", Pcb)
registerAction({ id: "pcb.new", title: "New PCB…", when: () => !!useApp.getState().project, run: newPcb })
