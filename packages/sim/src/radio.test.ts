import { expect, it } from "vitest"
import { Nrf24, RadioMedium } from "./radio"
const transaction = (radio: Nrf24, bytes: number[]) => { radio.select(true); const result = bytes.map((byte) => radio.transfer(byte)); radio.select(false); return result }
const write = (radio: Nrf24, register: number, ...bytes: number[]) => transaction(radio, [0x20 | register, ...bytes])
it("delivers addressed same-channel SPI payloads, ACK/status/FIFO and IRQ", () => {
  const medium = new RadioMedium(), transmitter = new Nrf24(medium), receiver = new Nrf24(medium)
  write(receiver, 0, 3); write(receiver, 0x11, 3); receiver.setCe(true)
  write(transmitter, 0, 2)
  transaction(transmitter, [0xa0, 1, 2, 3]); transmitter.setCe(true)
  expect(receiver.irq).toBe(true)
  expect(transmitter.registers[7]! & 0x20).toBe(0x20)
  expect(transaction(receiver, [0x61, 0xff, 0xff, 0xff]).slice(1)).toEqual([1, 2, 3])
  write(receiver, 7, 0x40)
  expect(receiver.irq).toBe(false)
  expect(receiver.view().received).toBe(1)
})
it("does not invent a radio connection across mismatched channels", () => {
  const medium = new RadioMedium(), a = new Nrf24(medium), b = new Nrf24(medium)
  write(a, 0, 2); write(b, 0, 3); write(b, 5, 10); write(b, 0x11, 1); b.setCe(true)
  transaction(a, [0xa0, 99]); a.setCe(true)
  expect(a.registers[7]! & 0x10).toBe(0x10)
  expect(b.rx).toHaveLength(0)
})
