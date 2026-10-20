import { afterEach, expect, it, vi } from "vitest"
import { matchesKeys } from "./registry"

afterEach(() => vi.unstubAllGlobals())
const key = (key: string, modifiers: Partial<KeyboardEvent> = {}) =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...modifiers }) as KeyboardEvent

it("matches Windows/Linux undo and both redo shortcuts", () => {
  vi.stubGlobal("navigator", { userAgent: "Linux" })
  expect(matchesKeys("mod+z", key("z", { ctrlKey: true }))).toBe(true)
  expect(matchesKeys("mod+shift+z", key("Z", { ctrlKey: true, shiftKey: true }))).toBe(true)
  expect(matchesKeys("ctrl+y", key("y", { ctrlKey: true }))).toBe(true)
  expect(matchesKeys("ctrl+y", key("y"))).toBe(false)
  expect(matchesKeys("ctrl+y", key("y", { ctrlKey: true, shiftKey: true }))).toBe(false)
})

it("uses Command for Mac mod shortcuts and rejects stray modifiers", () => {
  vi.stubGlobal("navigator", { userAgent: "Macintosh" })
  expect(matchesKeys("mod+z", key("z", { metaKey: true }))).toBe(true)
  expect(matchesKeys("mod+z", key("z", { ctrlKey: true }))).toBe(false)
  expect(matchesKeys("mod+z", key("z", { metaKey: true, ctrlKey: true }))).toBe(false)
})
