import { readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Part } from "@m4k3r/core"
import { describe, expect, it } from "vitest"

describe("built-in parts", () => {
  const dir = resolve(import.meta.dirname, "../../../library/parts")
  const parts = readdirSync(dir).map((id) => Part.parse(JSON.parse(readFileSync(join(dir, id, "part.json"), "utf8"))))

  it("all have a symbol and a footprint whose pads match the pins", () => {
    for (const part of parts) {
      expect(part.symbol, part.id).toBeDefined()
      const pads = new Set(part.footprint!.pads.map((p) => p.num))
      for (const pin of part.pins) expect(pads.has(pin.num), `${part.id} pin ${pin.num}`).toBe(true)
    }
  })

  it("number LEDs and diodes like KiCad: 1 = K, 2 = A", () => {
    for (const id of ["led", "diode"]) {
      const part = parts.find((p) => p.id === id)!
      expect(part.pins.map((p) => `${p.num} ${p.name}`)).toEqual(["1 K", "2 A"])
    }
    const nmos = parts.find((p) => p.id === "nmos")!
    expect(nmos.pins.map((p) => `${p.num} ${p.name}`)).toEqual(["1 G", "2 S", "3 D"])
  })
})
