import { mkdtempSync, readFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import { expect, it } from "vitest"
import { Nrf24, RadioMedium } from "@m4k3r/sim"
import { build, Pico, Toolchain } from "./index"
import { attachPicoNrf24 } from "./radio"

it.skipIf(process.env.M4K3R_FIRMWARE_E2E !== "1")("two genuine Pico programs exchange a packet through hardware SPI radio models", async () => {
  const cache = mkdtempSync(join(tmpdir(), "m4k3r-radio-")), toolchain = new Toolchain(process.env.M4K3R_HOME ?? join(homedir(), "M4K3R"))
  const common = `#include <SPI.h>
void regwrite(byte reg, byte value) { digitalWrite(17,LOW); SPI.transfer(0x20|reg); SPI.transfer(value); digitalWrite(17,HIGH); }
byte status() { digitalWrite(17,LOW); byte s=SPI.transfer(0xff); digitalWrite(17,HIGH); return s; }
void radioBegin() { pinMode(17,OUTPUT);pinMode(20,OUTPUT);pinMode(15,OUTPUT);digitalWrite(17,HIGH);digitalWrite(20,LOW);SPI.setRX(16);SPI.setTX(19);SPI.setSCK(18);SPI.begin(); SPI.beginTransaction(SPISettings(1000000,MSBFIRST,SPI_MODE0)); }
`
  const sender = `${common}
void setup() { radioBegin(); regwrite(0,2); delay(20); digitalWrite(17,LOW);SPI.transfer(0xa0);SPI.transfer(42);SPI.transfer(7);SPI.transfer(9);digitalWrite(17,HIGH);digitalWrite(20,HIGH); }
void loop() { digitalWrite(15, (status() & 0x20) ? HIGH : LOW); }
`
  const receiver = `${common}
void setup() { radioBegin();regwrite(0x11,3);regwrite(0,3);digitalWrite(20,HIGH); }
void loop() { if(status() & 0x40) { digitalWrite(17,LOW);SPI.transfer(0x61);byte value=SPI.transfer(0xff);SPI.transfer(0xff);SPI.transfer(0xff);digitalWrite(17,HIGH);if(value==42)digitalWrite(15,HIGH);regwrite(7,0x40); } }
`
  const image = async (source: string) => {
    const result = await build(toolchain, cache, { board: "rpipico", libs: [], main: "main.ino", files: { "main.ino": source } })
    expect(result.ok).toBe(true)
    return new Pico(readFileSync(join(cache, result.hash, "firmware.uf2")))
  }
  const tx = await image(sender), rx = await image(receiver), medium = new RadioMedium(), a = new Nrf24(medium), b = new Nrf24(medium)
  const pins = { spi: 0, csn: 17, ce: 20, sck: 18, mosi: 19, miso: 16 }
  const detachA = attachPicoNrf24(tx, a, pins), detachB = attachPicoNrf24(rx, b, pins)
  try {
    for (let i = 0; i < 1000; i++) { tx.step(100000); rx.step(100000) }
    expect(a.transmitted).toBe(1)
    expect(b.received).toBe(1)
    expect(tx.pin(15).state).toBe("high")
    expect(rx.pin(15).state).toBe("high")
  } finally { detachA(); detachB() }
}, 600000)
