import { mkdtempSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { Mpu6050 } from "@m4k3r/sim"
import { build, Pico, Toolchain } from "./index"
import { attachPicoI2c } from "./i2c"

it.skipIf(process.env.M4K3R_FIRMWARE_E2E !== "1")("real Pico Wire code reads identity and injected gravity through the I²C peripheral", async () => {
  const cache = mkdtempSync(join(tmpdir(), "m4k3r-i2c-")), toolchain = new Toolchain(process.env.M4K3R_HOME ?? join(homedir(), "M4K3R"))
  const result = await build(toolchain, cache, { board: "rpipico", libs: [], main: "main.ino", files: { "main.ino": `#include <Wire.h>
byte readreg(byte reg) { Wire.beginTransmission(0x68);Wire.write(reg);Wire.endTransmission(false);Wire.requestFrom(0x68,1);return Wire.read(); }
void setup() { pinMode(15,OUTPUT); Wire.setSDA(0);Wire.setSCL(1);Wire.begin();Wire.beginTransmission(0x68);Wire.write(0x6b);Wire.write(0);Wire.endTransmission(); }
void loop() { byte who=readreg(0x75); byte zhigh=readreg(0x3f); digitalWrite(15,who==0x68 && zhigh==0x40 ? HIGH : LOW); }
` } })
  expect(result.ok).toBe(true)
  const pico = new Pico(readFileSync(join(cache, result.hash, "firmware.uf2"))), imu = new Mpu6050()
  const detach = attachPicoI2c(pico, 0, new Map([[0x68, imu]]), { sda: 0, scl: 1 })
  try {
    pico.step(50e6)
    expect(pico.pin(15).state).toBe("high")
    imu.setMotion([0, 0, 0], [0, 0, 0]); pico.step(1e6)
    expect(pico.pin(15).state).toBe("low")
  } finally { detach() }
}, 600000)
