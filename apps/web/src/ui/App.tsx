import { useEffect } from "react"
import { commandsStep } from "../actions"
import { availableActions, matchesKeys } from "../registry"
import { clearSelection, closePalette, openPalette, useApp } from "../store"
import { Home } from "./Home"
import { Palette } from "./Palette"
import { ProjectView } from "./ProjectView"

function onKeyDown(e: KeyboardEvent) {
  if (matchesKeys("mod+k", e)) {
    e.preventDefault()
    return useApp.getState().palette ? closePalette() : openPalette(commandsStep())
  }
  if (e.key === "Escape") return useApp.getState().palette ? closePalette() : clearSelection()
  if ((e.target as HTMLElement).closest?.("input, textarea, select, [contenteditable]")) return
  const action = availableActions().find((a) => a.keys && matchesKeys(a.keys, e))
  if (action) {
    e.preventDefault()
    action.run()
  }
}

export function App() {
  const route = useApp((s) => s.route)
  const toast = useApp((s) => s.toast)

  useEffect(() => {
    addEventListener("keydown", onKeyDown)
    return () => removeEventListener("keydown", onKeyDown)
  }, [])

  return (
    <>
      {route.page === "project" ? <ProjectView tab={route.tab} /> : <Home />}
      <Palette />
      {toast && (
        <div key={toast.id} className="toast" role="status">
          {toast.text}
        </div>
      )}
    </>
  )
}
