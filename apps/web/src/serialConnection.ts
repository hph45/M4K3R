/** Minimal Web Serial contract, kept browser-only and testable without a physical device. */
export interface HardwarePort extends EventTarget {
  readable: ReadableStream<Uint8Array> | null
  writable: WritableStream<Uint8Array> | null
  open(options: { baudRate: number }): Promise<void>
  close(): Promise<void>
  getInfo(): { usbVendorId?: number; usbProductId?: number }
}
export interface HardwareSerial extends EventTarget { requestPort(): Promise<HardwarePort> }
export function browserSerial(): HardwareSerial | null {
  const serial = (navigator as Navigator & { serial?: HardwareSerial }).serial
  return isSecureContext && serial?.requestPort ? serial : null
}

/** Cancelling reads and releasing both stream locks must precede closing the device. */
export class SerialConnection {
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null
  private reading: Promise<void> = Promise.resolve()
  private writing: Promise<void> = Promise.resolve()
  private closing: Promise<void> | null = null

  constructor(readonly port: HardwarePort, onText: (text: string) => void, onEnd: (error?: unknown) => void) {
    this.reading = (async () => {
      await Promise.resolve()
      const decoder = new TextDecoder()
      let error: unknown
      try {
        if (!port.readable) throw new Error("The selected device has no readable serial stream.")
        const reader = port.readable.getReader()
        this.reader = reader
        while (!this.closing) {
          const { value, done } = await reader.read()
          if (done) break
          if (value) onText(decoder.decode(value, { stream: true }))
        }
        const tail = decoder.decode()
        if (tail) onText(tail)
      } catch (e) { error = e }
      finally { this.reader?.releaseLock(); this.reader = null }
      if (!this.closing) onEnd(error)
    })()
  }

  async send(text: string) {
    if (this.closing || !this.port.writable) throw new Error("The serial device is disconnected.")
    if (this.writer) throw new Error("A serial write is already in progress.")
    const writer = this.port.writable.getWriter()
    this.writer = writer
    this.writing = writer.write(new TextEncoder().encode(text)).finally(() => { writer.releaseLock(); if (this.writer === writer) this.writer = null })
    await this.writing
  }

  close() {
    if (this.closing) return this.closing
    // Defer cleanup to ensure closing is set before a cancelled read resolves.
    this.closing = Promise.resolve().then(async () => {
      await Promise.allSettled([this.reader?.cancel(), this.writer?.abort()])
      await Promise.allSettled([this.reading, this.writing])
      await this.port.close()
    })
    return this.closing
  }
}
