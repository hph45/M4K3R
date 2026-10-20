export interface I2cDevice { start(read: boolean): void; write(value: number): boolean; read(): number; stop(): void }

export class RegisterI2cDevice implements I2cDevice {
  readonly registers = new Uint8Array(256)
  private pointer = 0
  private expectingAddress = true
  start(read: boolean) { if (!read) this.expectingAddress = true }
  write(value: number) { if (this.expectingAddress) { this.pointer = value & 255; this.expectingAddress = false } else { this.writeRegister(this.pointer, value & 255); this.pointer = (this.pointer + 1) & 255 }; return true }
  read() { const value = this.readRegister(this.pointer); this.pointer = (this.pointer + 1) & 255; return value }
  stop() {}
  protected writeRegister(register: number, value: number) { this.registers[register] = value }
  protected readRegister(register: number) { return this.registers[register]! }
}

/** MPU6050 register subset. Inputs are explicitly supplied physical values, not generated flight dynamics. */
export class Mpu6050 extends RegisterI2cDevice {
  private acceleration: [number, number, number] = [0, 0, 9.80665]
  private angularRate: [number, number, number] = [0, 0, 0]
  private temperature = 25
  constructor() { super(); this.registers[0x75] = 0x68; this.registers[0x6b] = 0x40 }
  setMotion(acceleration: [number, number, number], angularRate: [number, number, number], temperature = 25) {
    if (![...acceleration, ...angularRate, temperature].every(Number.isFinite)) throw new Error("IMU motion must be finite SI values")
    this.acceleration = acceleration; this.angularRate = angularRate; this.temperature = temperature
  }
  protected override writeRegister(register: number, value: number) {
    if (register === 0x75 || register >= 0x3b && register <= 0x48) return
    if (register === 0x6b && value & 0x80) { this.registers.fill(0); this.registers[0x75] = 0x68; this.registers[0x6b] = 0x40; return }
    super.writeRegister(register, value)
  }
  private sample() {
    const accelScale = 16384 / 2 ** ((this.registers[0x1c]! >> 3) & 3), gyroScale = 131 / 2 ** ((this.registers[0x1b]! >> 3) & 3)
    const asleep = !!(this.registers[0x6b]! & 0x40)
    const values = [...this.acceleration.map((value) => asleep ? 0 : value / 9.80665 * accelScale), asleep ? 0 : (this.temperature - 36.53) * 340, ...this.angularRate.map((value) => asleep ? 0 : value * 180 / Math.PI * gyroScale)]
    values.forEach((value, index) => { const signed = Math.max(-32768, Math.min(32767, Math.round(value))); this.registers[0x3b + index * 2] = signed >> 8 & 255; this.registers[0x3c + index * 2] = signed & 255 })
    this.registers[0x3a] = asleep ? 0 : 1
  }
  protected override readRegister(register: number) { if (register >= 0x3a && register <= 0x48) this.sample(); return super.readRegister(register) }
  view() { return { ax: this.acceleration[0], ay: this.acceleration[1], az: this.acceleration[2], gx: this.angularRate[0], gy: this.angularRate[1], gz: this.angularRate[2], temperature: this.temperature, asleep: !!(this.registers[0x6b]! & 0x40) } }
}
