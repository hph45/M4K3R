import { describe, expect, it } from "vitest"
import { acknowledgeFirmwareSave, firmwareDraftKey, parseFirmwareDrafts, reconcileFirmwareDrafts, serializeFirmwareDrafts, unsavedFirmwareDrafts, type FirmwareDrafts } from "./firmwareDrafts"

describe("firmware draft recovery", () => {
  it("round-trips blank and removed source files, scoped by project and document", () => {
    const drafts = { "main.ino": { text: "", base: "old" }, "src/removed.cpp": { text: "recovered", base: "deleted" } }
    const recovered = parseFirmwareDrafts(serializeFirmwareDrafts(drafts))
    expect(recovered).toEqual(drafts)
    expect(reconcileFirmwareDrafts(recovered, { "main.ino": "old" }, 1)).toEqual(drafts)
    expect(firmwareDraftKey("project/a", "doc")).not.toBe(firmwareDraftKey("project", "a/doc"))
    expect(firmwareDraftKey("p", "first")).not.toBe(firmwareDraftKey("p", "second"))
  })

  it("retains local edits when the server changes and removes them after the server contains the exact source", () => {
    const drafts = { "main.ino": { text: "my edit", base: "original" } }
    expect(reconcileFirmwareDrafts(drafts, { "main.ino": "other editor" }, 3)).toEqual(drafts)
    expect(reconcileFirmwareDrafts(drafts, { "main.ino": "my edit" }, 4)).toEqual({})
    expect(() => parseFirmwareDrafts('{"version":1,"files":{"main.ino":{"text":4,"base":null}}}')).toThrow()
  })

  it("keeps a saved draft visible until the matching server version arrives", () => {
    const acknowledged = acknowledgeFirmwareSave({ "main.ino": { text: "submitted", base: "old" } }, { "main.ino": "submitted" }, 5)
    const waiting = reconcileFirmwareDrafts(acknowledged, { "main.ino": "old" }, 4)
    expect(waiting["main.ino"]?.text).toBe("submitted")
    expect(unsavedFirmwareDrafts(waiting, { "main.ino": "old" }, 4)).toEqual([])
    expect(reconcileFirmwareDrafts(waiting, { "main.ino": "submitted" }, 5)).toEqual({})
  })

  it("does not lose newer typing or an intentional revert during an in-flight save", () => {
    const files = { "main.ino": "original" }
    const latest: FirmwareDrafts = { "main.ino": { text: "original", base: "original" }, "extra.cpp": { text: "newer", base: "old" } }
    const protectedDrafts = reconcileFirmwareDrafts(latest, files, 2, new Set(["main.ino", "extra.cpp"]))
    expect(protectedDrafts["main.ino"]).toBeDefined()
    const acknowledged = acknowledgeFirmwareSave(protectedDrafts, { "main.ino": "submitted", "extra.cpp": "submitted extra" }, 3)
    const synced = reconcileFirmwareDrafts(acknowledged, { "main.ino": "submitted", "extra.cpp": "submitted extra" }, 3)
    expect(synced).toEqual({ "main.ino": { text: "original", base: "submitted" }, "extra.cpp": { text: "newer", base: "submitted extra" } })
    expect(unsavedFirmwareDrafts(synced, { "main.ino": "submitted", "extra.cpp": "submitted extra" }, 3)).toHaveLength(2)
  })
})
