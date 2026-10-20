import { mkdtempSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { emptyProject, Part } from "@m4k3r/core"
import { expect, it } from "vitest"
import { libraryPart } from "../../sim/src/testing"
import { build, Toolchain } from "./index"
import { coupledFirmwareSession } from "./coupled"

it.skipIf(process.env.M4K3R_FIRMWARE_E2E !== "1")("executes real Pico PWM firmware and feeds circuit voltage to the real ADC", async () => {
  const cache = mkdtempSync(join(tmpdir(), "m4k3r-coupled-"))
  const tc = new Toolchain(process.env.M4K3R_HOME ?? join(homedir(), "M4K3R"))
  const result = await build(tc, cache, { board: "rpipico", libs: [], main: "main.ino", files: { "main.ino": `void setup() { analogWriteFreq(20000); analogWriteRange(255); analogWrite(15,128); analogReadResolution(12); }
void loop() { volatile int value = analogRead(26); delayMicroseconds(10); }` } })
  expect(result.ok).toBe(true)
  const project = emptyProject("real-coupled", "Real PWM + ADC")
  project.parts.mcu = Part.parse({ id: "mcu", name: "Pico", refPrefix: "U", pins: [{ num: "1", name: "GP15" }, { num: "2", name: "GP26" }] })
  project.parts.resistor = libraryPart("resistor")
  project.components = [{ id: "u", ref: "U1", part: "mcu", props: {} }, { id: "r", ref: "R1", part: "resistor", props: { value: "1k" } }]
  project.nets = [{ id: "pwm", name: "PWM", pins: [{ component: "u", pin: "1" }, { component: "u", pin: "2" }, { component: "r", pin: "1" }] }, { id: "gnd", name: "GND", pins: [{ component: "r", pin: "2" }] }]
  const { session, mcus } = coupledFirmwareSession(project, [{ component: "U1", uf2: readFileSync(join(cache, result.hash, "firmware.uf2")) }], { step: 0.0001 })
  session.advance(0.1)
  const pico = mcus[0]!.runtime
  expect(pico.pin(15).function).toBe("pwm")
  expect(pico.edges[15]).toBeGreaterThan(100)
  expect(session.snapshot().voltages.PWM).toBeGreaterThan(1.4)
  expect(session.snapshot().voltages.PWM).toBeLessThan(1.9)
  const adc = pico.mcu.adc.result
  expect(adc).toBeGreaterThan(1700)
  expect(adc).toBeLessThan(2400)
  expect(pico.mcu.adc.channelValues[0]).toBeCloseTo(session.snapshot().voltages.PWM! / 3.3 * 4095, 0)
}, 600000)
