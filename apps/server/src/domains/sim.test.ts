import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { simulate } from "@m4k3r/sim"
import { expect, it } from "vitest"
import { PartLibrary } from "../library"
import { ProjectStore } from "../store"
import { summary } from "./sim"

it("summarizes a simulation compactly for agents", () => {
  const home = mkdtempSync(join(tmpdir(), "m4k3r-"))
  const library = new PartLibrary(resolve(import.meta.dirname, "../../../../library/parts"), join(home, "parts"))
  const store = new ProjectStore(join(home, "projects"), library)
  const { id } = store.create("motor")
  store.apply(id, [
    { type: "component.add", args: { part: "battery" } },
    { type: "component.add", args: { part: "dc-motor" } },
    { type: "net.connect", args: { pins: ["BT1.+", "M1.1"], name: "VBAT" } },
    { type: "net.connect", args: { pins: ["BT1.-", "M1.2"], name: "GND" } },
  ])
  const text = summary(simulate(store.get(id), { analysis: "tran", duration: 0.2, probes: ["M1.rpm"], maxPoints: 5 }))
  expect(text).toMatch(/^Transient to 200ms: 20000 steps in \d+ ms\nVoltages: VBAT=4.2V\n/)
  expect(text).toContain("M1: rpm=210 current=52.5mA")
  expect(text).toMatch(/\nt: 40m 80m 120m 160m 200m\nM1.rpm: [\d.]+ [\d.]+ [\d.]+ 210 210$/)
})
