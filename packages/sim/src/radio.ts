/** Virtual nRF24L01+ SPI model. Register/packet behavior, not RF propagation or certification. */
export class RadioMedium {
  readonly radios = new Set<Nrf24>()
  transmit(sender: Nrf24, payload: Uint8Array) {
    let acknowledged = false
    for (const receiver of this.radios) if (receiver !== sender && receiver.receive(sender, payload)) acknowledged = true
    return acknowledged
  }
}

export class Nrf24 {
  readonly registers = new Uint8Array(32)
  readonly addresses = new Map<number, Uint8Array>()
  readonly rx: { pipe: number; payload: Uint8Array }[] = []
  readonly tx: Uint8Array[] = []
  onIrq?: (asserted: boolean) => void
  private command = -1
  private offset = 0
  private payload: number[] = []
  private ce = false
  transmitted = 0
  received = 0
  constructor(readonly medium: RadioMedium) {
    medium.radios.add(this)
    this.registers.set([0x08, 0x3f, 0x03, 0x03, 0x03, 0x02, 0x0e, 0x0e])
    this.addresses.set(0x0a, new Uint8Array(5).fill(0xe7)); this.addresses.set(0x0b, new Uint8Array(5).fill(0xc2)); this.addresses.set(0x10, new Uint8Array(5).fill(0xe7))
    for (let pipe = 2; pipe < 6; pipe++) this.registers[0x0a + pipe] = 0xc1 + pipe
    this.refresh()
  }
  dispose() { this.medium.radios.delete(this) }
  get irq() { return (this.registers[7]! & ~this.registers[0]! & 0x70) !== 0 }
  private refresh() {
    this.registers[7] = (this.registers[7]! & 0x70) | (this.rx.length ? this.rx[0]!.pipe << 1 : 0x0e) | (this.tx.length >= 3 ? 1 : 0)
    this.registers[0x17] = (this.tx.length === 0 ? 0x10 : 0) | (this.tx.length >= 3 ? 0x20 : 0) | (this.rx.length === 0 ? 1 : 0) | (this.rx.length >= 3 ? 2 : 0)
    this.onIrq?.(this.irq)
  }
  select(active: boolean) {
    if (!active) {
      if ((this.command === 0xa0 || this.command === 0xb0) && this.payload.length && this.tx.length < 3) this.tx.push(Uint8Array.from(this.payload.slice(0, 32)))
      if (this.command === 0x61 && this.offset > 0) this.rx.shift()
      if (this.ce) this.send(this.command === 0xb0)
    }
    this.command = -1; this.offset = 0; this.payload = []; this.refresh()
  }
  setCe(high: boolean) { this.ce = high; if (high) this.send(false) }
  transfer(value: number) {
    value &= 0xff
    if (this.command < 0) {
      this.command = value; this.offset = 0
      if (value === 0xe1) this.tx.length = 0
      if (value === 0xe2) this.rx.length = 0
      this.refresh(); return this.registers[7]!
    }
    const offset = this.offset++
    if (this.command <= 0x1f) return this.addresses.get(this.command)?.[offset] ?? this.registers[this.command] ?? 0
    if ((this.command & 0xe0) === 0x20) {
      const register = this.command & 0x1f, address = this.addresses.get(register)
      if (address) { if (offset < address.length) address[offset] = value }
      else if (register === 7) this.registers[7]! &= ~(value & 0x70)
      else if (register !== 0x17 && offset === 0) this.registers[register] = value
      this.refresh(); return this.registers[7]!
    }
    if (this.command === 0x61) return this.rx[0]?.payload[offset] ?? 0
    if (this.command === 0x60) return this.rx[0]?.payload.length ?? 0
    if (this.command === 0xa0 || this.command === 0xb0) this.payload.push(value)
    return this.registers[7]!
  }
  private send(noAck: boolean) {
    if (!(this.registers[0]! & 2) || this.registers[0]! & 1 || !this.tx.length || this.registers[7]! & 0x10) return
    const payload = this.tx[0]!, ack = this.medium.transmit(this, payload)
    this.transmitted++
    if (ack || noAck || !(this.registers[1]! & 1)) { this.tx.shift(); this.registers[7]! |= 0x20; this.registers[8] = 0 }
    else { this.registers[7]! |= 0x10; this.registers[8] = (this.registers[4]! & 15) | Math.min(0xf0, (this.registers[8]! & 0xf0) + 0x10) }
    this.refresh()
  }
  receive(sender: Nrf24, payload: Uint8Array) {
    if (!this.ce || (this.registers[0]! & 3) !== 3 || this.registers[5] !== sender.registers[5] || this.rx.length >= 3) return false
    if ((this.registers[6]! & 0x28) !== (sender.registers[6]! & 0x28) || (this.registers[3]! & 3) !== (sender.registers[3]! & 3) || (this.registers[0]! & 0x0c) !== (sender.registers[0]! & 0x0c)) return false
    const width = Math.max(3, Math.min(5, (this.registers[3]! & 3) + 2)), target = sender.addresses.get(0x10)!
    for (let pipe = 0; pipe < 6; pipe++) {
      if (!(this.registers[2]! & 1 << pipe)) continue
      const address = pipe < 2 ? this.addresses.get(0x0a + pipe)! : Uint8Array.from([this.registers[0x0a + pipe]!, ...this.addresses.get(0x0b)!.slice(1)])
      if (!address.slice(0, width).every((value, i) => value === target[i])) continue
      const dynamic = !!(this.registers[0x1d]! & 4 && this.registers[0x1c]! & 1 << pipe)
      const size = dynamic ? payload.length : this.registers[0x11 + pipe]!
      if (size !== payload.length || size < 1 || size > 32) continue
      this.rx.push({ pipe, payload: payload.slice() }); this.received++; this.registers[7]! |= 0x40; this.refresh()
      return !!(this.registers[1]! & 1 << pipe)
    }
    return false
  }
  view() { return { transmitted: this.transmitted, received: this.received, rxPackets: this.rx.length, txPackets: this.tx.length, irq: this.irq, channel: this.registers[5]! } }
}
