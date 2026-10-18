import { Part } from "@m4k3r/core"
import { describe, expect, it } from "vitest"
import { cleanName, importFootprint, importSymbol, KicadLibrary, kicadPart, parseSExpr, splitRef } from "./index"

// KiCad 6/7 style: bare `hide` flags, two units sharing unit 0, a De Morgan style, and a derived symbol.
const LIB = `(kicad_symbol_lib (version 20211014) (generator kicad_symbol_editor)
  (symbol "DUAL_GATE" (pin_names (offset 1.016) hide) (in_bom yes) (on_board yes)
    (property "Reference" "U" (id 0) (at 0 5.08 0) (effects (font (size 1.27 1.27))))
    (property "Value" "DUAL_GATE" (id 1) (at 0 -5.08 0) (effects (font (size 1.27 1.27))))
    (property "Footprint" "Package_SO:SOIC-8" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "Datasheet" "~" (id 3) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (property "ki_description" "Two gates" (id 4) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))
    (symbol "DUAL_GATE_0_1"
      (pin power_in line (at 0 7.62 270) (length 2.54) (name "VCC" (effects (font (size 1.27 1.27)))) (number "8" (effects (font (size 1.27 1.27)))))
      (pin power_in line (at 0 -7.62 90) (length 2.54) hide (name "GND" (effects (font (size 1.27 1.27)))) (number "4" (effects (font (size 1.27 1.27))))))
    (symbol "DUAL_GATE_1_1"
      (arc (start 2.54 0) (mid 0 2.54) (end -2.54 0) (stroke (width 0.254)) (fill (type background)))
      (pin input line (at -5.08 0 0) (length 2.54) (name "~{A}" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin output line (at 5.08 0 180) (length 2.54) (name "Y" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27))))))
    (symbol "DUAL_GATE_1_2"
      (circle (center 0 0) (radius 9) (stroke (width 0)) (fill (type none)))
      (pin input line (at -5.08 0 0) (length 2.54) (name "DEMORGAN" (effects (font (size 1.27 1.27)))) (number "9" (effects (font (size 1.27 1.27))))))
    (symbol "DUAL_GATE_2_1"
      (polyline (pts (xy -2.54 2.54) (xy 2.54 0) (xy -2.54 -2.54)) (stroke (width 0.254)) (fill (type outline)))
      (pin tri_state line (at -5.08 0 0) (length 2.54) (name "B" (effects (font (size 1.27 1.27)))) (number "3" (effects (font (size 1.27 1.27)))))
      (pin open_collector line (at 5.08 0 180) (length 2.54) (name "Z" (effects (font (size 1.27 1.27)))) (number "5" (effects (font (size 1.27 1.27)))))))
  (symbol "DUAL_GATE_LP" (extends "DUAL_GATE")
    (property "Reference" "IC" (id 0) (at 1 1 0) (effects (font (size 1.27 1.27))))
    (property "Value" "DUAL_GATE_LP" (id 1) (at 0 -5.08 0) (effects (font (size 1.27 1.27)) hide))
    (property "Description" "Low-power gates" (id 2) (at 0 0 0) (effects (font (size 1.27 1.27)) hide))))`

// KiCad 8+ style: (hide yes), pin alternates.
const MCU = `(kicad_symbol_lib (version 20251024) (generator "kicad_symbol_editor")
  (symbol "TINY_MCU" (pin_numbers (hide yes))
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "TINY_MCU" (at 0 0 0) (hide yes) (effects (font (size 1.27 1.27))))
    (property "Datasheet" "https://example.com/tiny.pdf" (at 0 0 0) (hide yes) (effects (font (size 1.27 1.27))))
    (symbol "TINY_MCU_1_1"
      (pin bidirectional line (at -7.62 2.54 0) (length 2.54) (name "GPIO0" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27))))
        (alternate "I2C0_SDA" bidirectional line) (alternate "PWM0_A" output line) (alternate "~{SPI0_CS}" output line))
      (pin power_in line (at 0 -7.62 90) (length 2.54) (hide yes) (name "GND" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27)))))
      (pin no_connect line (at 7.62 0 180) (length 2.54) (name "~" (effects (font (size 1.27 1.27))))
        (number "3" (effects (font (size 1.27 1.27))))))))`

const FOOTPRINT = `(footprint "Test_FP" (version 20240108) (generator "pcbnew") (layer "F.Cu")
  (descr "A test footprint")
  (property "Reference" "REF**" (at 0 -3 0) (layer "F.SilkS") (effects (font (size 1 1) (thickness 0.15))))
  (property "Value" "Test_FP" (at 0 3 0) (layer "F.Fab") (hide yes) (effects (font (size 1 1))))
  (fp_line (start -2 -1.5) (end 2 -1.5) (stroke (width 0.12) (type solid)) (layer "F.SilkS"))
  (fp_line (start 0 0) (end 1 1) (stroke (width 0.1) (type solid)) (layer "F.Cu"))
  (fp_rect (start -3 -2) (end 3 2) (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))
  (fp_circle (center 0 0) (end 0.5 0) (stroke (width 0.1) (type solid)) (fill solid) (layer "F.Fab"))
  (fp_arc (start -1 0) (mid 0 -1) (end 1 0) (stroke (width 0.1) (type solid)) (layer "B.Fab"))
  (fp_poly (pts (xy 0 0) (xy 1 0) (xy 1 1)) (stroke (width 0.1) (type solid)) (fill yes) (layer "F.SilkS"))
  (fp_text user "\${REFERENCE}" (at 0 0 90) (layer "F.Fab") (effects (font (size 0.8 0.8))))
  (pad "1" smd roundrect (at -1.5 0 90) (size 1 1.2) (layers "F.Cu" "F.Mask" "F.Paste") (roundrect_rratio 0.25))
  (pad "2" thru_hole oval (at 1.5 0) (size 1.2 2) (drill oval 0.6 1.2) (layers "*.Cu" "*.Mask"))
  (pad "" np_thru_hole circle (at 0 1) (size 1 1) (drill 1) (layers "*.Cu" "*.Mask"))
  (model "\${KICAD8_3DMODEL_DIR}/Test.3dshapes/Test_FP.step" (offset (xyz 0 0 0)) (scale (xyz 1 1 1)) (rotate (xyz 0 0 0))))`

describe("s-expressions", () => {
  it("parses nested lists, atoms and quoted strings with escapes", () => {
    expect(parseSExpr(`(a 1 -2.5 "two words" "q\\"uote" "back\\\\slash" "line\\nbreak" "" (b (c)))`)).toEqual([
      "a", "1", "-2.5", "two words", 'q"uote', "back\\slash", "line\nbreak", "", ["b", ["c"]],
    ])
  })

  it("keeps parentheses inside strings and ignores what follows the first expression", () => {
    expect(parseSExpr(`\n (name "a(b)c") trailing`)).toEqual(["name", "a(b)c"])
  })

  it("reports malformed input", () => {
    expect(() => parseSExpr("(a (b)")).toThrow(/Unbalanced/)
    expect(() => parseSExpr(`(a "open`)).toThrow(/Unterminated/)
    expect(() => parseSExpr(")")).toThrow(/Unexpected/)
  })
})

describe("symbols", () => {
  it("imports multi-unit symbols: shared unit 0 in every unit, style 1 only", () => {
    const s = importSymbol(LIB, "DUAL_GATE")
    expect(s.pins.map((p) => `${p.num} ${p.name} ${p.type}`)).toEqual([
      "8 VCC power_in", "4 GND power_in", "1 nA input", "2 Y output", "3 B bidir", "5 Z open_drain",
    ])
    expect(s.symbol.units).toHaveLength(2)
    const [u1, u2] = s.symbol.units
    expect(u1!.pins.map((p) => p.num)).toEqual(["8", "4", "1", "2"])
    expect(u2!.pins.map((p) => p.num)).toEqual(["8", "4", "3", "5"])
    expect(u1!.pins[1]).toEqual({ num: "4", at: [0, 7.62], rot: 90, length: 2.54, hidden: true })
    expect(u1!.graphics[0]).toEqual({ type: "arc", start: [2.54, 0], mid: [0, -2.54], end: [-2.54, 0], width: 0.254, fill: "background" })
    expect(u2!.graphics[0]).toMatchObject({ type: "poly", fill: "outline" })
    expect(u1!.graphics.some((g) => g.type === "circle")).toBe(false)
    expect(s.symbol).toMatchObject({ pinNameOffset: 1.016, hidePinNames: true })
    expect(s.properties).toMatchObject({ Reference: "U", Footprint: "Package_SO:SOIC-8", ki_description: "Two gates" })
  })

  it("resolves inheritance: parent body, child properties", () => {
    const s = importSymbol(LIB, "DUAL_GATE_LP")
    expect(s.pins).toHaveLength(6)
    expect(s.properties).toMatchObject({ Reference: "IC", Value: "DUAL_GATE_LP", Footprint: "Package_SO:SOIC-8" })
    const texts = s.symbol.units[0]!.graphics.filter((g) => g.type === "text")
    expect(texts).toEqual([{ type: "text", text: "${REFERENCE}", at: [1, -1], size: 1.27 }])
    expect(() => importSymbol(LIB.replace('(extends "DUAL_GATE")', '(extends "NOPE")'), "DUAL_GATE_LP")).toThrow(/NOPE/)
  })

  it("finds the parent in another file, and needs a name when a file has several symbols", () => {
    const [parent, child] = [LIB.replace(/\(symbol "DUAL_GATE_LP"[\s\S]*$/, ")"), LIB.replace(/\(symbol "DUAL_GATE" [\s\S]*?(?=\(symbol "DUAL_GATE_LP")/, "")]
    expect(importSymbol([child, parent]).properties.Value).toBe("DUAL_GATE_LP")
    expect(() => importSymbol(LIB)).toThrow(/2 symbols; pass a name: DUAL_GATE, DUAL_GATE_LP/)
  })

  it("maps pin alternates to functions and KiCad 8 hide flags", () => {
    const s = importSymbol(MCU)
    expect(s.pins).toEqual([
      { num: "1", name: "GPIO0", type: "bidir", functions: ["I2C0_SDA", "PWM0_A", "nSPI0_CS"] },
      { num: "2", name: "GND", type: "power_in" },
      { num: "3", name: "3", type: "nc" },
    ])
    expect(s.symbol.units[0]!.pins[1]!.hidden).toBe(true)
    expect(s.symbol).toMatchObject({ pinNameOffset: 0.508, hidePinNumbers: true })
    expect(s.symbol.units[0]!.graphics.filter((g) => g.type === "text")).toHaveLength(1)
  })

  it("cleans KiCad name markup", () => {
    expect(["~{RESET}", "~{CSn}", "~{nRST}", "A{slash}B", "~", "{weird}"].map(cleanName)).toEqual([
      "nRESET", "CSn", "nRST", "A/B", "", "{weird}",
    ])
  })
})

describe("footprints", () => {
  const { name, description, footprint, model } = importFootprint(FOOTPRINT)

  it("imports pads with shape, size, rotation, drill and layers", () => {
    expect(name).toBe("Test_FP")
    expect(description).toBe("A test footprint")
    expect(footprint.pads).toEqual([
      { num: "1", type: "smd", shape: "roundrect", at: [-1.5, 0], rot: 90, size: [1, 1.2], layers: ["F.Cu", "F.Mask", "F.Paste"], roundness: 0.25 },
      { num: "2", type: "thru_hole", shape: "oval", at: [1.5, 0], size: [1.2, 2], drill: [0.6, 1.2], layers: ["*.Cu", "*.Mask"] },
      { num: "", type: "np_thru_hole", shape: "circle", at: [0, 1], size: [1, 1], drill: [1, 1], layers: ["*.Cu", "*.Mask"] },
    ])
    expect(model).toBe("${KICAD8_3DMODEL_DIR}/Test.3dshapes/Test_FP.step")
  })

  it("keeps silkscreen, fab and courtyard graphics, and the courtyard bounds", () => {
    expect(footprint.graphics.map((g) => `${g.type} ${g.layer}`)).toEqual([
      "text F.SilkS", "poly F.SilkS", "rect F.CrtYd", "circle F.Fab", "arc B.Fab", "poly F.SilkS", "text F.Fab",
    ])
    expect(footprint.graphics[0]).toEqual({ type: "text", text: "${REFERENCE}", at: [0, -3], size: 1, layer: "F.SilkS" })
    expect(footprint.graphics[3]).toEqual({ type: "circle", center: [0, 0], radius: 0.5, width: 0.1, fill: "outline", layer: "F.Fab" })
    expect(footprint.courtyard).toEqual({ min: [-3, -2], max: [3, 2] })
  })

  it("falls back to pads and graphics when there is no courtyard", () => {
    const { footprint } = importFootprint(FOOTPRINT.replace('"F.CrtYd"', '"Dwgs.User"'))
    expect(footprint.courtyard).toEqual({ min: [-2.1, -1.5], max: [2.1, 1.5] })
  })
})

describe("parts", () => {
  it("builds a valid part and reports pins without pads", () => {
    const { part, warnings } = kicadPart(importSymbol(MCU), importFootprint(FOOTPRINT), { symbolSource: "KiCad Test:TINY_MCU" })
    expect(Part.parse(part)).toEqual(part)
    expect(part).toMatchObject({ id: "tiny_mcu", name: "TINY_MCU", refPrefix: "U", datasheet: "https://example.com/tiny.pdf" })
    expect(part.symbol!.source).toBe("KiCad Test:TINY_MCU")
    expect(warnings).toEqual([])
    const lp = kicadPart(importSymbol(LIB, "DUAL_GATE_LP"), importFootprint(FOOTPRINT), { id: "gates", overrides: { category: "logic" } })
    expect(lp.part).toMatchObject({ id: "gates", refPrefix: "IC", category: "logic", description: "Low-power gates" })
    expect(lp.part.datasheet).toBeUndefined()
    expect(lp.warnings).toEqual(["Pins without a pad: 8 VCC, 4 GND, 3 B, 5 Z"])
  })
})

describe("KiCad library", () => {
  const files: Record<string, string> = {
    "kicad-symbols/-/raw/master/Logic.kicad_symdir/DUAL_GATE_LP.kicad_sym": LIB.replace(/\(symbol "DUAL_GATE" [\s\S]*?(?=\(symbol "DUAL_GATE_LP")/, ""),
    "kicad-symbols/-/raw/master/Logic.kicad_symdir/DUAL_GATE.kicad_sym": LIB.replace(/\(symbol "DUAL_GATE_LP"[\s\S]*$/, ")"),
    "kicad-footprints/-/raw/master/Package_SO.pretty/SOIC-8.kicad_mod": FOOTPRINT,
  }
  const fetched: string[] = []
  const fakeFetch = async (url: string) => {
    fetched.push(url)
    const text = files[url.replace("https://gitlab.com/kicad/libraries/", "")]
    return new Response(text ?? "not found", { status: text ? 200 : 404 })
  }

  it("fetches a derived symbol with its parent and default footprint, then serves them from the cache", async () => {
    const store = new Map<string, string>()
    const cache = { get: async (k: string) => store.get(k), set: async (k: string, v: string) => void store.set(k, v) }
    const lib = new KicadLibrary(cache, fakeFetch)
    const { part } = await lib.importPart({ symbol: "Logic:DUAL_GATE_LP" })
    expect(part.footprint!.source).toBe("KiCad Package_SO:SOIC-8")
    expect(part.model3d).toBe("https://gitlab.com/kicad/libraries/kicad-packages3D/-/raw/master/Test.3dshapes/Test_FP.step")
    expect([...store.keys()].sort()).toEqual([
      "footprints/Package_SO/SOIC-8.kicad_mod", "symbols/Logic/DUAL_GATE.kicad_sym", "symbols/Logic/DUAL_GATE_LP.kicad_sym",
    ])
    const count = fetched.length
    await lib.importPart({ symbol: "Logic:DUAL_GATE_LP", footprint: null })
    expect(fetched.length).toBe(count)
  })

  it("imports raw file contents and reports missing names", async () => {
    const lib = new KicadLibrary(undefined, fakeFetch)
    const { part } = await lib.importPart({ symbol: MCU, footprint: FOOTPRINT })
    expect(part.footprint!.pads).toHaveLength(3)
    await expect(lib.importPart({ symbol: "Logic:NOPE" })).rejects.toThrow("Symbol Logic:NOPE not found in the KiCad libraries")
    expect(() => splitRef("../etc:passwd")).toThrow(/Library:Name/)
    expect(() => splitRef("Device")).toThrow(/Library:Name/)
  })
})
