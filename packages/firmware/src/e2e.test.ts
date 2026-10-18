import { mkdtempSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { build, Pico, runFirmware, Toolchain } from "./index"

// Downloads arduino-cli and the arduino-pico core on first run (a few minutes, ~2 GB).
const E2E = process.env.M4K3R_FIRMWARE_E2E === "1"
const home = process.env.M4K3R_HOME ?? join(homedir(), "M4K3R")

const BLINK = `#include "m4k3r_pins.h"

void setup() {
  Serial.begin(115200);
  pinMode(PIN_LED, OUTPUT);
}

void loop() {
  static int n = 0;
  digitalWrite(PIN_LED, n % 2);
  Serial.printf("hello %d\\n", n++);
  delay(50);
}
`

describe.skipIf(!E2E)("firmware end to end", () => {
  const tc = new Toolchain(home)
  const cache = mkdtempSync(join(tmpdir(), "m4k3r-cache-"))
  const input = (main: string) => ({
    board: "rpipico", libs: [], main: "main.ino",
    files: { "main.ino": main, "m4k3r_pins.h": "#pragma once\n#define PIN_LED 15\n" },
  })

  it("builds, caches and runs blink with serial output", async () => {
    let t = performance.now()
    const first = await build(tc, cache, input(BLINK))
    const buildMs = performance.now() - t
    expect(first.diagnostics.filter((d) => d.severity === "error")).toEqual([])
    expect(first.ok).toBe(true)
    expect(first.size!.flash).toBeGreaterThan(10_000)

    t = performance.now()
    const again = await build(tc, cache, input(BLINK))
    const cachedMs = performance.now() - t
    expect(again).toMatchObject({ ok: true, cached: true, hash: first.hash })

    const uf2 = readFileSync(join(cache, first.hash, "firmware.uf2"))
    const run = await runFirmware(uf2, 1000, 60_000)
    console.log({ buildMs: Math.round(buildMs), cachedMs: Math.round(cachedMs), ...run, serial: run.serial.Serial?.slice(0, 60) })
    expect(run.simulatedMs).toBeCloseTo(1000, 0)
    expect(run.serial.Serial).toMatch(/hello 1\r?\n/)
    expect(run.gpio.GP15).toMatchObject({ function: "sio" })
    expect(run.gpio.GP15!.edges).toBeGreaterThanOrEqual(10)
  }, 600_000)

  it("bridges pins: an LED follows a button", async () => {
    const sketch = `void setup() { pinMode(14, INPUT_PULLUP); pinMode(15, OUTPUT); }
void loop() { digitalWrite(15, !digitalRead(14)); }
`
    const r = await build(tc, cache, { board: "rpipico", libs: [], main: "main.ino", files: { "main.ino": sketch } })
    const pico = new Pico(readFileSync(join(cache, r.hash, "firmware.uf2")))
    const changes: string[] = []
    pico.onPin = (gpio, state) => gpio === 15 && changes.push(state)
    await pico.run(50)
    expect(pico.pin(15).state).toBe("low") // pulled up, not pressed
    pico.setInput(14, false)
    pico.step(1e6)
    expect(pico.pin(15).state).toBe("high")
    pico.setInput(14, null)
    pico.step(1e6)
    expect(changes.slice(-3)).toEqual(["low", "high", "low"])
  }, 600_000)

  it("reports compile errors with sketch-relative locations", async () => {
    const r = await build(tc, cache, input("void setup() {\n  foo();\n}\nvoid loop() {}\n"))
    expect(r.ok).toBe(false)
    expect(r.diagnostics).toContainEqual(expect.objectContaining({ file: "main.ino", line: 2, severity: "error" }))
  }, 600_000)
})
