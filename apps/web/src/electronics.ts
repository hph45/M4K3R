import { registerAction, registerDocView } from "./registry"
import { openPalette, openTab, run, useApp } from "./store"
import { Firmware } from "./ui/Firmware"
import { Schematic } from "./ui/Schematic"
import "./electronics.css"

registerDocView("schematic", Schematic)
registerDocView("firmware", Firmware)

export function newSchematic() {
  openPalette({ placeholder: "Schematic name", submit: async (name) => {
    if (!name.trim()) return
    const result = await run([
      { type: "doc.create", args: { kind: "schematic", name: name.trim() } },
      { type: "schematic.autoplace", args: { doc: name.trim() } },
    ], "Create schematic")
    const id = (result?.[0] as { id?: string } | undefined)?.id
    if (id) openTab(id)
  } })
}

export function newFirmware() {
  openPalette({ placeholder: "Firmware target name", submit: async (name) => {
    if (!name.trim()) return
    const p = useApp.getState().project
    const mcu = p?.components.find((c) => p.parts[c.part]?.pins.some((pin) => [pin.name, ...(pin.functions ?? [])].some((name) => /^GP(?:IO)?\d+$/i.test(name))))
    const result = await run([{ type: "doc.create", args: { kind: "firmware", name: name.trim(), data: mcu ? { mcu: mcu.id, ...(mcu.part === "esp32-c3" ? { platform: "esp32", board: "esp32c3" } : {}) } : {} } }], "Create firmware target")
    const id = (result?.[0] as { id?: string } | undefined)?.id
    if (id) openTab(id)
  } })
}

registerAction({ id: "schematic.new", title: "New schematic…", when: () => !!useApp.getState().project, run: newSchematic })
registerAction({ id: "firmware.new", title: "New firmware target…", when: () => !!useApp.getState().project, run: newFirmware })
