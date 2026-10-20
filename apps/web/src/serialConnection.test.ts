import { describe, expect, it } from "vitest"
import { SerialConnection, type HardwarePort } from "./serialConnection"

function device() {
  let feed!: ReadableStreamDefaultController<Uint8Array>
  let closed = 0
  const sent: string[] = []
  const port = Object.assign(new EventTarget(), {
    readable: new ReadableStream<Uint8Array>({ start(controller) { feed = controller } }),
    writable: new WritableStream<Uint8Array>({ write(bytes) { sent.push(new TextDecoder().decode(bytes)) } }),
    open: async () => {},
    close: async () => { expect(port.readable.locked).toBe(false); expect(port.writable.locked).toBe(false); closed++ },
    getInfo: () => ({}),
  }) satisfies HardwarePort
  return { port, feed: () => feed, sent, closed: () => closed }
}

describe("hardware serial lifecycle", () => {
  it("decodes split UTF-8, writes bytes and releases stream locks before disconnect", async () => {
    const mock = device(), output: string[] = [], ended: unknown[] = []
    const session = new SerialConnection(mock.port, (text) => output.push(text), (error) => ended.push(error))
    const bytes = new TextEncoder().encode("ready ✓")
    mock.feed().enqueue(bytes.slice(0, bytes.length - 1))
    mock.feed().enqueue(bytes.slice(bytes.length - 1))
    await session.send("hello\r\n")
    await session.close()
    await session.close()
    expect(output.join("")).toBe("ready ✓")
    expect(mock.sent).toEqual(["hello\r\n"])
    expect(ended).toEqual([])
    expect(mock.closed()).toBe(1)
    await expect(session.send("later")).rejects.toThrow(/disconnected/)
  })

  it("reports unplugged readers and still closes the released port", async () => {
    const mock = device()
    let finish!: (error: unknown) => void
    const ended = new Promise<unknown>((resolve) => { finish = resolve })
    const session = new SerialConnection(mock.port, () => {}, finish)
    mock.feed().error(new Error("USB removed"))
    expect(await ended).toEqual(new Error("USB removed"))
    await session.close()
    expect(mock.closed()).toBe(1)
  })
})
