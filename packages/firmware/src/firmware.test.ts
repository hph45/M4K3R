import { describe, expect, it } from "vitest"
import {
  applyCommands, emptyProject, Part, registerCommands, registerDocKind,
  type Command, type CommandContext, type Project,
} from "@m4k3r/core"
import { buildHash, buildInput, cName, firmwareCommands, FirmwareData, parseDiagnostics, pinHeader } from "./index"

registerDocKind("firmware", FirmwareData)
registerCommands(firmwareCommands)

const mcu = Part.parse({
  id: "test-mcu", name: "Test MCU", refPrefix: "U",
  pins: [
    { num: "1", name: "GP0", type: "bidir", functions: ["GPIO0", "UART0_TX", "PWM0A"] },
    { num: "2", name: "GPIO10", type: "bidir", functions: ["PWM5A", "SPI1_SCK"] },
    { num: "3", name: "IO7", type: "bidir", functions: ["GPIO7"] },
    { num: "4", name: "GND", type: "power_in" },
    { num: "5", name: "GP25", type: "bidir" },
  ],
})
const resistor = Part.parse({ id: "resistor", name: "R", refPrefix: "R", pins: [{ num: "1", name: "1" }, { num: "2", name: "2" }] })

let ids = 0
const ctx: CommandContext = {
  resolvePart: (id) => ({ "test-mcu": mcu, resistor })[id],
  newId: (prefix) => `${prefix}_${++ids}`,
}
const run = (p: Project, ...batch: Command[]) => applyCommands(p, batch, ctx)

const wired = run(
  emptyProject("p", "Test"),
  { type: "component.add", args: { part: "test-mcu" } },
  { type: "component.add", args: { part: "resistor" } },
  { type: "net.connect", args: { pins: ["U1.GPIO10", "R1.1"], name: "l-in1" } },
  { type: "net.connect", args: { pins: ["U1.GP0", "U1.IO7", "R1.2"], name: "~RESET" } },
  { type: "net.connect", args: { pins: ["U1.GND"], name: "GND" } },
  { type: "doc.create", args: { kind: "firmware", name: "main", data: { mcu: "c_1" } } },
).project

describe("pin header", () => {
  it("defines one pin per net on a GPIO, with the pin and its functions", () => {
    expect(pinHeader(wired, "U1")).toBe(
      [
        "// Generated from the schematic by M4K3R. Do not edit.",
        "#pragma once",
        "",
        "#define PIN_RESET   0   // net ~RESET → U1.GP0 (UART0_TX, PWM0A)",
        "#define PIN_RESET_2 7   // net ~RESET → U1.IO7",
        "#define PIN_L_IN1   10  // net l-in1 → U1.GPIO10 (PWM5A, SPI1_SCK)",
        "",
      ].join("\n"),
    )
  })

  it("sanitizes net names into C identifiers", () => {
    expect(cName("RF CE")).toBe("RF_CE")
    expect(cName("+3V3")).toBe("3V3")
    expect(cName("---")).toBe("NET")
  })

  it("explains an empty header", () => {
    expect(pinHeader(wired, undefined)).toMatch(/No target MCU/)
    expect(pinHeader(run(wired, { type: "component.add", args: { part: "test-mcu" } }).project, "U2")).toMatch(/No nets on U2/)
  })
})

describe("firmware doc commands", () => {
  const data = (p: Project) => p.docs[0]!.data as FirmwareData

  it("creates a doc with a starter sketch", () => {
    expect(data(wired)).toMatchObject({ mcu: "c_1", board: "rpipico", libs: [], main: "main.ino" })
    expect(data(wired).files["main.ino"]).toMatch(/#include "m4k3r_pins.h"/)
  })

  it("writes and removes files", () => {
    let p = run(wired, { type: "firmware.file.write", args: { doc: "main", path: "src/radio.cpp", content: "//" } }).project
    expect(Object.keys(data(p).files)).toEqual(["main.ino", "src/radio.cpp"])
    p = run(p, { type: "firmware.file.remove", args: { doc: "main", path: "src/radio.cpp" } }).project
    expect(Object.keys(data(p).files)).toEqual(["main.ino"])
    expect(() => run(p, { type: "firmware.file.remove", args: { doc: "main", path: "main.ino" } })).toThrow(/main sketch/)
    expect(() => run(p, { type: "firmware.file.write", args: { doc: "main", path: "../x.h", content: "" } })).toThrow()
    expect(() => run(p, { type: "firmware.file.write", args: { doc: "main", path: "m4k3r_pins.h", content: "" } })).toThrow(
      /generated/,
    )
  })

  it("sets the MCU by ref and requires pinned libraries", () => {
    const p = run(wired, { type: "firmware.set", args: { doc: "main", mcu: "U1", libs: ["RF24@1.4.11"] } }).project
    expect(data(p)).toMatchObject({ mcu: "c_1", libs: ["RF24@1.4.11"] })
    expect(() => run(p, { type: "firmware.set", args: { doc: "main", libs: ["RF24"] } })).toThrow(/pinned/)
    expect(() => run(p, { type: "firmware.set", args: { doc: "main", mcu: "U9" } })).toThrow(/No component "U9"/)
  })

  it("builds from the doc's files plus the generated header, hashed by content", () => {
    const input = buildInput(wired, "main")
    expect(Object.keys(input.files)).toEqual(["main.ino", "m4k3r_pins.h"])
    expect(input.files["m4k3r_pins.h"]).toMatch(/PIN_L_IN1/)
    const renamed = run(wired, { type: "net.rename", args: { net: "l-in1", name: "MOTOR" } }).project
    expect(buildHash(buildInput(renamed, "main"))).not.toBe(buildHash(input))
    expect(buildHash({ ...input, files: { ...input.files } })).toBe(buildHash(input))
  })
})

describe("diagnostics", () => {
  const dir = "/tmp/m4k3r-build-x/main"
  const stderr = `${dir}/main.ino: In function 'void setup()':
${dir}/main.ino:3:3: error: 'foo' was not declared in this scope
    3 |   foo();
      |   ^~~
${dir}/src/radio.cpp:12:7: warning: unused variable 'x' [-Wunused-variable]
In file included from ${dir}/main.ino:1:
/home/u/.toolchains/arduino/packages/rp2040/hardware/rp2040/6.2.0/cores/rp2040/Arduino.h:40:1: fatal error: nope.h: No such file or directory
${dir}/main.ino:3:3: error: 'foo' was not declared in this scope
/opt/gcc/bin/ld: ${dir}/build/sketch/main.ino.cpp.o: in function \`setup':
${dir}/main.ino:4:(.text.setup+0x2): undefined reference to \`bar()'
collect2: error: ld returned 1 exit status
`

  it("parses gcc and linker output with sketch-relative paths, without duplicates", () => {
    expect(parseDiagnostics(stderr, dir)).toEqual([
      { file: "main.ino", line: 3, col: 3, severity: "error", message: "'foo' was not declared in this scope" },
      { file: "src/radio.cpp", line: 12, col: 7, severity: "warning", message: "unused variable 'x' [-Wunused-variable]" },
      {
        file: "/home/u/.toolchains/arduino/packages/rp2040/hardware/rp2040/6.2.0/cores/rp2040/Arduino.h",
        line: 40, col: 1, severity: "error", message: "nope.h: No such file or directory",
      },
      { file: "main.ino", line: 4, col: 0, severity: "error", message: "undefined reference to `bar()'" },
    ])
  })
})
