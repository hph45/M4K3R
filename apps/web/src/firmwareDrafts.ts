/** Local edits are separate from the project until Save succeeds. */
export interface FirmwareDraft {
  text: string
  base: string | null
  /** An acknowledged save may arrive before the matching WebSocket project version. */
  saved?: { text: string; version: number }
}
export type FirmwareDrafts = Record<string, FirmwareDraft>

export const firmwareDraftKey = (project: string, doc: string) =>
  `m4k3r.firmware.drafts:${encodeURIComponent(project)}:${encodeURIComponent(doc)}`

export function parseFirmwareDrafts(raw: string | null): FirmwareDrafts {
  if (!raw) return {}
  const value: unknown = JSON.parse(raw)
  if (!value || typeof value !== "object" || !("version" in value) || value.version !== 1 || !("files" in value) || !value.files || typeof value.files !== "object" || Array.isArray(value.files)) throw new Error("Invalid firmware draft storage")
  const drafts: FirmwareDrafts = {}
  for (const [path, draft] of Object.entries(value.files)) {
    if (path === "m4k3r_pins.h" || !draft || typeof draft !== "object" || typeof draft.text !== "string" || (draft.base !== null && typeof draft.base !== "string")) throw new Error("Invalid firmware file draft")
    if (draft.saved && (typeof draft.saved.text !== "string" || !Number.isInteger(draft.saved.version) || draft.saved.version < 0)) throw new Error("Invalid firmware save acknowledgment")
    drafts[path] = { text: draft.text, base: draft.base, ...(draft.saved ? { saved: { ...draft.saved } } : {}) }
  }
  return drafts
}

export const serializeFirmwareDrafts = (files: FirmwareDrafts) => JSON.stringify({ version: 1, files })

/** Keep edited/deleted/conflicting files; discard a draft only once the server contains it. */
export function reconcileFirmwareDrafts(drafts: FirmwareDrafts, files: Record<string, string>, version: number, saving = new Set<string>()): FirmwareDrafts {
  let changed = false
  const next: FirmwareDrafts = {}
  for (const [path, draft] of Object.entries(drafts)) {
    if (draft.saved && version < draft.saved.version) { next[path] = draft; continue }
    if (!saving.has(path) && Object.hasOwn(files, path) && files[path] === draft.text) { changed = true; continue }
    if (draft.saved) { next[path] = { text: draft.text, base: draft.saved.text }; changed = true }
    else next[path] = draft
  }
  return changed ? next : drafts
}

export function unsavedFirmwareDrafts(drafts: FirmwareDrafts, files: Record<string, string>, version: number) {
  return Object.entries(drafts).filter(([path, draft]) => draft.text !== (draft.saved && version < draft.saved.version ? draft.saved.text : files[path]))
}

/** Mark exactly the submitted texts saved; edits made while the request ran stay dirty. */
export function acknowledgeFirmwareSave(drafts: FirmwareDrafts, submitted: Record<string, string>, version: number): FirmwareDrafts {
  const next = { ...drafts }
  for (const [path, text] of Object.entries(submitted)) {
    const current = drafts[path]
    if (current) next[path] = { ...current, saved: { text, version } }
  }
  return next
}
