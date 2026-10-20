import type { Doc, Project } from "@m4k3r/core"
import type { ComponentType } from "react"

// Doc views: each workstream renders its doc kind (part-studio, schematic…) in a project tab.

export interface DocViewProps {
  project: Project
  doc: Doc
}

const docViews = new Map<string, ComponentType<DocViewProps>>()

export function registerDocView(kind: string, view: ComponentType<DocViewProps>) {
  docViews.set(kind, view)
}

export const docView = (kind: string) => docViews.get(kind)

// Actions: everything the user can do, reachable from ⌘K and optionally a shortcut.

export interface Action {
  id: string
  title: string
  /** Shortcut such as "mod+shift+z". mod is ⌘ on a Mac and Ctrl elsewhere. */
  keys?: string
  aliases?: string[]
  /** Hide the action where it doesn't apply. */
  when?(): boolean
  run(): void
}

const actions = new Map<string, Action>()

export function registerAction(action: Action) {
  actions.set(action.id, action)
}

export const availableActions = () => [...actions.values()].filter((a) => a.when?.() ?? true)

const isMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent)

export function matchesKeys(keys: string, e: KeyboardEvent) {
  const mods = keys.split("+")
  const key = mods.pop()
  return (
    e.key.toLowerCase() === key &&
    e.metaKey === (mods.includes("meta") || (isMac() && mods.includes("mod"))) &&
    e.ctrlKey === (mods.includes("ctrl") || (!isMac() && mods.includes("mod"))) &&
    e.shiftKey === mods.includes("shift") &&
    e.altKey === mods.includes("alt")
  )
}

export function formatKeys(keys: string) {
  const mac = isMac()
  const names: Record<string, string> = { mod: mac ? "⌘" : "Ctrl", shift: mac ? "⇧" : "Shift", alt: mac ? "⌥" : "Alt" }
  return keys
    .split("+")
    .map((k) => names[k] ?? k.toUpperCase())
    .join(mac ? "" : "+")
}
