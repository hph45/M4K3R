import { describe, expect, it } from "vitest"
import { arrange, isGlobalNet, netDrawing, netStyle, type ArrangeItem, type NetEnd } from "./layout"

const box = { min: [-10, -5], max: [10, 5] } as { min: [number, number]; max: [number, number] }
const item = (component: string, sides: Record<string, number> = {}): ArrangeItem => ({ component, unit: 0, bounds: box, sides })
const net = (name: string, ...pins: string[]) => ({ name, pins: pins.map((p) => ({ component: p.split(".")[0]!, pin: p.split(".")[1]! })) })
const end = (key: string, at: [number, number], out: [number, number]): NetEnd => ({ key, at, out })

describe("schematic net drawing", () => {
  it("recognises ground and supply rails by name", () => {
    expect(["GND", "AGND", "0", "VSS"].map(netStyle)).toEqual(["ground", "ground", "ground", "ground"])
    expect(["VBAT", "3V3", "+5V", "VCC", "VMOT"].map(netStyle)).toEqual(["power", "power", "power", "power", "power"])
    expect(["SDA", "MOTOR_1", "N4"].map(netStyle)).toEqual(["signal", "signal", "signal"])
    expect(isGlobalNet(net("VBAT", "A.1", "B.1", "C.1"))).toBe(true)
    expect(isGlobalNet(net("SDA", "A.1", "B.1", "C.1"))).toBe(false)
    expect(isGlobalNet({ name: "BUS", pins: Array(6).fill({}) })).toBe(true)
  })

  it("draws a ground symbol on every pin instead of wires across the sheet", () => {
    const ends = [end("A/1", [0, 0], [-1, 0]), end("B/1", [8, 0], [1, 0]), end("C/1", [200, 40], [0, 1]), end("D/1", [5, 90], [0, 1])]
    const drawing = netDrawing(net("GND", "A.1", "B.1", "C.1", "D.1"), ends)
    expect(drawing.wires).toEqual([])
    expect(drawing.ports.map((p) => p.key).sort()).toEqual(["A/1", "B/1", "C/1", "D/1"])
  })

  it("wires nearby facing pins and labels both ends of a long or backward connection", () => {
    const near = netDrawing(net("SDA", "A.1", "B.1"), [end("A/1", [0, 0], [1, 0]), end("B/1", [20, 5], [-1, 0])])
    expect(near).toEqual({ wires: [[[0, 0], [20, 5]]], ports: [], junctions: [] })
    const far = netDrawing(net("SDA", "A.1", "B.1"), [end("A/1", [0, 0], [1, 0]), end("B/1", [120, 0], [-1, 0])])
    expect(far.wires).toEqual([])
    expect(far.ports).toHaveLength(2)
    const backward = netDrawing(net("SDA", "A.1", "B.1"), [end("A/1", [0, 0], [-1, 0]), end("B/1", [20, 0], [1, 0])])
    expect(backward.wires).toEqual([])
    expect(backward.ports).toHaveLength(2)
  })

  it("keeps hand-drawn wires and only labels what they leave unconnected", () => {
    const ends = [end("A/1", [0, 0], [1, 0]), end("B/1", [150, 0], [-1, 0])]
    expect(netDrawing(net("SDA", "A.1", "B.1"), ends, [["A/1", "B/1"]])).toEqual({ wires: [], ports: [], junctions: [] })
  })
})

describe("schematic arrange", () => {
  it("places a driver beside the motor it drives, on the side its outputs face", () => {
    // U1's inputs face left and outputs right; the motor's pins face left.
    const items = [item("M1", { 1: -1, 2: -1 }), item("U1", { 1: -1, 2: -1, 3: 1, 4: 1, 5: -1 }), item("C1", { 1: -1, 2: 1 })]
    const nets = [net("OUT_A", "U1.3", "M1.1"), net("OUT_B", "U1.4", "M1.2"), net("GND", "U1.5", "C1.2"), net("VBAT", "U1.1", "C1.1", "M1.9")]
    const at = arrange(items, nets)
    const [motor, driver, cap] = ["M1/0", "U1/0", "C1/0"].map((key) => at.get(key)!)
    expect(motor![1]).toBe(driver![1])
    expect(motor![0]).toBeGreaterThan(driver![0])
    // Rails don't pull parts together: the capacitor isn't placed between them.
    expect(cap![0] < driver![0] || cap![0] > motor![0] || cap![1] !== driver![1]).toBe(true)
  })

  it("keeps a lone part beside the hub it connects to and leaves room for labels", () => {
    const items = ["U1", "R1", "R2", "R3", "R4", "D1"].map((id) => item(id, { 1: -1, 2: 1 }))
    const nets = [1, 2, 3, 4].map((i) => net(`SIG_${i}`, `U1.${i % 2 ? 2 : 1}`, `R${i}.1`)).concat(net("LED", "U1.2", "D1.1"))
    const at = arrange(items, nets)
    expect(new Set([...at.values()].map((p) => p.join())).size).toBe(6)
    for (const [key, [x]] of at) if (key !== "U1/0") expect(Math.abs(x - at.get("U1/0")![0])).toBeGreaterThan(20)
  })

  it("wraps parts joined only by rails rather than stretching one long row", () => {
    const items = Array.from({ length: 12 }, (_, i) => item(`C${i + 1}`, { 1: -1, 2: 1 }))
    const at = arrange(items, [net("VBAT", ...items.map((c) => `${c.component}.1`)), net("GND", ...items.map((c) => `${c.component}.2`))])
    expect(new Set([...at.values()].map(([, y]) => y)).size).toBeGreaterThan(1)
  })
})
