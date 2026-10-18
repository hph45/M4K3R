import { emptyProject, type Project } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { reconcile } from "./live"

const base: Project = { ...emptyProject("p", "Test"), version: 3 }
const rename = (version: number, name: string) => ({
  project: "p",
  version,
  patches: [
    { op: "replace" as const, path: ["name"], value: name },
    { op: "replace" as const, path: ["version"], value: version },
  ],
})

describe("reconcile", () => {
  it("applies the next version", () => {
    const next = reconcile(base, rename(4, "Robot"))
    expect(next).toMatchObject({ name: "Robot", version: 4 })
    expect(base.name).toBe("Test")
  })

  it("ignores versions we already have and other projects", () => {
    expect(reconcile(base, rename(3, "Old"))).toBe("stale")
    expect(reconcile(base, { ...rename(4, "X"), project: "other" })).toBe("stale")
  })

  it("asks for a refetch when a version was missed", () => {
    expect(reconcile(base, rename(6, "Later"))).toBe("gap")
  })

  it("applies nested patches, e.g. a new component", () => {
    const next = reconcile(base, {
      project: "p",
      version: 4,
      patches: [
        { op: "add", path: ["components", 0], value: { id: "c_1", ref: "R1", part: "resistor", props: {} } },
        { op: "replace", path: ["version"], value: 4 },
      ],
    })
    expect(next !== "gap" && next !== "stale" && next.components[0]?.ref).toBe("R1")
  })
})
