/** Additional device parts. Generic breakout geometry is labeled; Pico pinout/footprint is imported from KiCad. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { Part, type PartInput } from "@m4k3r/core"
import { KicadLibrary, partJson } from "../src/index"

const root = resolve(import.meta.dirname, "../../.."), cache = join(root, ".tools", "device-catalog")
const save = (input: PartInput) => { const part = Part.parse(input), target = join(root, "library", "parts", part.id); mkdirSync(target, { recursive: true }); writeFileSync(join(target, "part.json"), partJson(part)) }
const library = new KicadLibrary({
  async get(key) { const path = join(cache, key); return existsSync(path) ? readFileSync(path, "utf8") : undefined },
  async set(key, value) { const path = join(cache, key); mkdirSync(resolve(path, ".."), { recursive: true }); writeFileSync(path, value) },
})
const imported = await library.importPart({ symbol: "MCU_Module:RaspberryPi_Pico", id: "raspberry-pi-pico", overrides: { name: "Raspberry Pi Pico (RP2040)", description: "RP2040-based Raspberry Pi Pico with official KiCad header pinout/footprint. Physical height and mass are estimated; Pico 2 execution is not implied.", refPrefix: "U", kind: "module", category: "microcontrollers", manufacturer: "Raspberry Pi", mpn: "SC0915", datasheet: "https://datasheets.raspberrypi.com/pico/pico-datasheet.pdf", physical: { size: [21, 51, 3.9], mass: 3, geometry: { type: "box", color: "#399a74" }, source: "Raspberry Pi Pico datasheet board outline; KiCad pinout/footprint. Height and mass estimated.", massSource: "estimated" } } })
if (imported.warnings.length) throw new Error(imported.warnings.join("\n"))
const pico = imported.part
pico.pins = pico.pins.map((pin) => {
  // Pico datasheet: VSYS is the 1.8–5.5 V system supply input, physical pin39.
  if (pin.num === '39') return { ...pin, voltage: [1.8, 5.5] as [number, number] }
  const match = /^GP(?:IO)?(\d+)(?:_ADC\d+)?$/.exec(pin.name)
  if (!match) return pin
  const gpio = Number(match[1]), spi = (gpio >> 3) & 1, i2c = (gpio >> 1) & 1
  return { ...pin, functions: [`GPIO${gpio}`, `PWM${Math.floor(gpio / 2) % 8}${gpio % 2 ? "B" : "A"}`, `SPI${spi}_${["RX", "CSN", "SCK", "TX"][gpio % 4]}`, `I2C${i2c}_${gpio % 2 ? "SCL" : "SDA"}`, ...(gpio >= 26 ? [`ADC${gpio - 26}`] : [])] }
})
// Footprint NPTH pads belong to connector details and are not advertised as board mounting holes.
save(pico)

function breakout(id: string, name: string, names: string[], size: [number, number, number], mass: number, datasheet: string, props: Record<string, string>, twoRows = false) {
  const rows = twoRows ? names.length / 2 : names.length
  const pins = names.map((name, index) => ({ num: String(index + 1), name, type: name === "VCC" || name === "GND" ? "power_in" as const : name === "IRQ" || name === "INT" || name === "MISO" ? "output" as const : "bidir" as const }))
  const at = (index: number): [number, number] => twoRows ? [(index % 2) * 2.54 - 1.27, Math.floor(index / 2) * 2.54 - (rows - 1) * 1.27] : [0, index * 2.54 - (rows - 1) * 1.27]
  const source = "M4K3R generic breakout connector/envelope; pin numbering, dimensions and mass are planning assumptions, not a manufacturer module footprint. Verify the selected module before fabrication."
  save({ id, name, kind: "module", category: "modules", refPrefix: "U", description: source, datasheet, pins, props,
    symbol: { source: "M4K3R abstract breakout symbol", units: [{ graphics: [{ type: "rect", start: [-8, -rows * 1.27], end: [8, rows * 1.27], width: 0.2 }], pins: pins.map((pin, index) => ({ num: pin.num, at: [index < rows ? -11 : 11, ((index % rows) - (rows - 1) / 2) * 2.54] as [number, number], rot: index < rows ? 0 : 180, length: 3 })) }] },
    footprint: { source, pads: pins.map((pin, index) => ({ num: pin.num, type: "thru_hole", shape: index === 0 ? "rect" : "circle", at: at(index), size: [1.7, 1.7], drill: [1, 1], layers: ["*.Cu", "*.Mask"] })), graphics: [], courtyard: { min: [-size[0] / 2 - 1, -size[1] / 2 - 1], max: [size[0] / 2 + 1, size[1] / 2 + 1] } },
    physical: { size, mass, geometry: { type: "box", color: "#357b9b" }, source, massSource: "estimated" },
  })
}
breakout("nrf24l01-module", "Generic nRF24L01+ radio breakout", ["GND", "VCC", "CE", "CSN", "SCK", "MOSI", "MISO", "IRQ"], [15, 29, 3], 2, "https://docs-be.nordicsemi.com/bundle/nRF24L01P_PS_v1.0/raw/resource/enus/nRF24L01P_PS_v1.0.pdf", {}, true)
breakout("mpu6050-module", "Generic MPU6050 IMU breakout", ["VCC", "GND", "SCL", "SDA", "XDA", "XCL", "AD0", "INT"], [20, 16, 3], 2, "https://invensense.tdk.com/wp-content/uploads/2015/02/MPU-6000-Register-Map.pdf", { sensorModel: "mpu6050", i2cAddress: "0x68" })
console.log("Wrote Pico + generic nRF24 and MPU6050 breakout catalog entries")
