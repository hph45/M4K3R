import { emptyProject, Part, type Project } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { erc } from "./checks"

const mcu = Part.parse({ id: "rated-mcu", name: "3.3 V MCU supply", refPrefix: "U", pins: [{ num: "1", name: "VDD", type: "power_in", voltage: [3, 3.6] }, { num: "2", name: "GND", type: "power_in", voltage: [0, 0] }] })
const battery = Part.parse({ id: "battery", name: "Battery", refPrefix: "BT", pins: [{ num: "1", name: "+", type: "power_out" }, { num: "2", name: "-", type: "passive" }], props: { voltage: "9V" }, sim: { model: "battery", params: {} } })
const regulator = Part.parse({ id: "regulator", name: "Configured regulator", refPrefix: "U", pins: [{ num: "1", name: "IN", type: "power_in" }, { num: "2", name: "OUT", type: "power_out" }, { num: "3", name: "GND", type: "power_in" }], props: { voltage: "3.3", dropout: "0.2" }, sim: { model: "regulator", params: {} } })

function fixture(regulated = false): Project {
  const project = emptyProject("rails", "Supply checks")
  project.parts = { [mcu.id]: mcu, [battery.id]: battery, [regulator.id]: regulator }
  project.components = [{ id: "mcu", ref: "U1", part: mcu.id, props: {} }, { id: "battery", ref: "BT1", part: battery.id, props: {} }]
  project.nets = [
    { id: "ground", name: "GND", pins: [{ component: "mcu", pin: "2" }, { component: "battery", pin: "2" }] },
    { id: "source", name: "VBAT", pins: [{ component: "battery", pin: "1" }] },
  ]
  if (regulated) {
    project.components.push({ id: "reg", ref: "U2", part: regulator.id, props: {} })
    project.nets[0]!.pins.push({ component: "reg", pin: "3" })
    project.nets[1]!.pins.push({ component: "reg", pin: "1" })
    project.nets.push({ id: "supply", name: "3V3", pins: [{ component: "reg", pin: "2" }, { component: "mcu", pin: "1" }] })
  } else project.nets[1]!.pins.push({ component: "mcu", pin: "1" })
  return project
}

describe("bounded DC supply ERC", () => {
  it("rejects a grounded 9 V battery directly feeding a rated MCU supply", () => {
    const issue = erc(fixture()).find((issue) => issue.code === "rail-voltage")
    expect(issue).toMatchObject({ severity: "error", net: "source", components: ["mcu"] })
    expect(issue?.message).toMatch(/9 V.*nominal battery.*U1.VDD.*3–3.6 V/)
  })

  it("accepts a properly powered 3.3 V regulator rather than propagating battery voltage through it", () => {
    const issues = erc(fixture(true))
    expect(issues.filter((issue) => ["rail-voltage", "unknown-rail-voltage", "rail-source-conflict"].includes(issue.code))).toEqual([])
  })

  it("does not infer a voltage from a 3V3 net name or an unreferenced battery", () => {
    const project = fixture()
    project.nets[0]!.name = "RETURN"
    project.nets[1]!.name = "3V3"
    const issues = erc(project)
    expect(issues.some((issue) => issue.code === "rail-voltage")).toBe(false)
    expect(issues.find((issue) => issue.code === "unknown-rail-voltage" && issue.net === "source")?.message).toContain("DC voltage is unknown")
  })

  it("leaves the regulator output unknown without sufficient configured headroom", () => {
    const project = fixture(true)
    project.components.find((c) => c.id === "battery")!.props.voltage = "3.3V"
    expect(erc(project).find((issue) => issue.code === "unknown-rail-voltage" && issue.net === "supply")).toBeDefined()
    expect(erc(project).some((issue) => issue.code === "rail-voltage")).toBe(false)
  })

  it("reports conflicting source setpoints without picking a voltage for downstream supplies", () => {
    const project = fixture(true)
    project.components.push({ id: "battery2", ref: "BT2", part: battery.id, props: { voltage: "12V" } })
    project.nets[0]!.pins.push({ component: "battery2", pin: "2" })
    project.nets[1]!.pins.push({ component: "battery2", pin: "1" })
    const issues = erc(project)
    expect(issues.find((issue) => issue.code === "rail-source-conflict")).toMatchObject({ severity: "error", net: "source" })
    expect(issues.some((issue) => issue.code === "rail-voltage")).toBe(false)
    expect(issues.find((issue) => issue.code === "unknown-rail-voltage" && issue.net === "supply")).toBeDefined()
  })

  it("detects a reversed battery whose positive terminal is the explicit ground reference", () => {
    const project = fixture()
    project.nets[0]!.pins.find((pin) => pin.component === "battery")!.pin = "1"
    project.nets[1]!.pins.find((pin) => pin.component === "battery")!.pin = "2"
    expect(erc(project).find((issue) => issue.code === "rail-voltage")?.message).toContain("-9 V")
  })
})
