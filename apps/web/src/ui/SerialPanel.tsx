import { useEffect, useRef, useState } from "react"
import { browserSerial, SerialConnection, type HardwarePort } from "../serialConnection"

interface Props { platform: "rp2040" | "esp32"; board: string; image?: string; uf2?: string; currentBuild: boolean }
type State = "disconnected" | "choosing" | "connecting" | "connected" | "disconnecting" | "flashing"
interface FlashTransport { disconnect(): Promise<void> }
const message = (e: unknown) => e instanceof Error ? e.message : String(e)
const cancelled = (e: unknown) => e instanceof DOMException && e.name === "NotFoundError"
const limit = 128_000

export function SerialPanel({ platform, board, image, uf2, currentBuild }: Props) {
  const [state, setState] = useState<State>("disconnected")
  const [baud, setBaud] = useState("115200")
  const [text, setText] = useState("")
  const [ending, setEnding] = useState("\n")
  const [output, setOutput] = useState("")
  const [error, setError] = useState("")
  const [info, setInfo] = useState("")
  const [progress, setProgress] = useState<number | null>(null)
  const [sending, setSending] = useState(false)
  const alive = useRef(true)
  const generation = useRef(0)
  const connection = useRef<SerialConnection | null>(null)
  const flashing = useRef<FlashTransport | null>(null)
  const closing = useRef<Promise<void> | null>(null)
  const terminal = useRef<HTMLPreElement>(null)
  const latestBuild = useRef({ platform, board, image, currentBuild })
  latestBuild.current = { platform, board, image, currentBuild }
  const serial = browserSerial()
  const busy = state !== "disconnected" && state !== "connected"
  // The actual Arduino C3 merged image layout is verified at address 0 in backend acceptance.
  const verifiedEsp = platform === "esp32" && /^esp32c3(?::|$)/.test(board)
  const append = (value: string) => { if (alive.current) setOutput((previous) => (previous + value).slice(-limit)) }

  async function disconnect(showError = true) {
    generation.current++
    if (closing.current) return closing.current
    const open = connection.current, flash = flashing.current
    connection.current = null
    flashing.current = null
    if (alive.current) setState("disconnecting")
    const task = Promise.allSettled([open?.close(), flash?.disconnect()]).then((results) => {
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected")
      if (alive.current) { setState("disconnected"); setProgress(null); if (failed && showError) setError(`Could not fully close the device: ${message(failed.reason)}`) }
    }).finally(() => { if (closing.current === task) closing.current = null })
    closing.current = task
    return task
  }

  useEffect(() => {
    alive.current = true
    const unplugged = (event: Event) => {
      const port = (event as Event & { port?: HardwarePort }).port ?? event.target
      if (connection.current?.port === port) {
        setError("The serial device was disconnected.")
        void disconnect(false)
      }
    }
    serial?.addEventListener("disconnect", unplugged)
    const pagehide = () => { void disconnect(false) }
    window.addEventListener("pagehide", pagehide)
    return () => { alive.current = false; serial?.removeEventListener("disconnect", unplugged); window.removeEventListener("pagehide", pagehide); void disconnect(false) }
  }, [serial])
  useEffect(() => { if (terminal.current) terminal.current.scrollTop = terminal.current.scrollHeight }, [output])

  async function connect() {
    if (!serial || state !== "disconnected") return
    const id = ++generation.current
    setError(""); setState("choosing"); setInfo("")
    let port: HardwarePort | null = null
    try {
      // Keep requestPort directly inside the click gesture, before imports or network awaits.
      port = await serial.requestPort()
      if (!alive.current || id !== generation.current) return
      setState("connecting")
      await port.open({ baudRate: Number(baud) })
      if (!alive.current || id !== generation.current) { await port.close(); return }
      const device = port.getInfo()
      setInfo(device.usbVendorId !== undefined ? `USB ${device.usbVendorId.toString(16).padStart(4, "0")}:${(device.usbProductId ?? 0).toString(16).padStart(4, "0")}` : "Serial device")
      const next = new SerialConnection(port, append, (failure) => {
        if (connection.current !== next) return
        if (alive.current && failure) setError(`Serial connection ended: ${message(failure)}`)
        void disconnect(false)
      })
      connection.current = next
      setState("connected")
      append(`\nConnected at ${baud} baud.\n`)
    } catch (e) {
      if (port?.readable || port?.writable) await port.close().catch(() => {})
      if (alive.current && id === generation.current) { setState("disconnected"); setError(cancelled(e) ? "No serial device selected." : message(e)) }
    }
  }

  async function send() {
    if (!connection.current || sending) return
    setSending(true); setError("")
    try { await connection.current.send(text + ending); if (alive.current) setText("") }
    catch (e) { if (alive.current) setError(`Serial write failed: ${message(e)}`) }
    finally { if (alive.current) setSending(false) }
  }

  async function flash() {
    if (!serial || !verifiedEsp || !image || !currentBuild || state !== "disconnected") return
    const id = ++generation.current
    setError(""); setState("choosing"); setProgress(null)
    let transport: FlashTransport | undefined
    const requireCurrentImage = () => {
      const latest = latestBuild.current
      if (!latest.currentBuild || latest.platform !== platform || latest.board !== board || latest.image !== image) throw new Error("Sources or target changed while preparing upload. Nothing was flashed. Build the current sources and choose the device again.")
    }
    try {
      const port = await serial.requestPort()
      if (!alive.current || id !== generation.current) return
      requireCurrentImage()
      setState("flashing")
      const [{ ESPLoader, Transport }, response] = await Promise.all([import("esptool-js"), fetch(image)])
      if (!response.ok) throw new Error(`Firmware download failed (${response.status}). Build again.`)
      const bytes = new Uint8Array(await response.arrayBuffer())
      if (!bytes.length || bytes.length > 32 * 1024 * 1024) throw new Error("The merged firmware image is empty or too large.")
      if (!alive.current || id !== generation.current) return
      requireCurrentImage()
      const device = new Transport(port as unknown as ConstructorParameters<typeof Transport>[0], false)
      transport = device
      flashing.current = device
      const loader = new ESPLoader({ transport: device, baudrate: 115200, terminal: { clean: () => {}, write: append, writeLine: (line) => append(`${line}\n`) } })
      append("\nConnecting to ESP32-C3 bootloader… Hold BOOT if your board requires it.\n")
      const chip = await loader.main()
      if (!alive.current || id !== generation.current) return
      if (!chip.toLowerCase().replace(/[^a-z0-9]/g, "").includes("esp32c3")) throw new Error(`Selected device is ${chip}; this image targets ESP32-C3. Nothing was flashed.`)
      requireCurrentImage()
      setInfo(chip)
      setProgress(0)
      await loader.writeFlash({ fileArray: [{ data: bytes, address: 0 }], flashMode: "keep", flashFreq: "keep", flashSize: "detect", eraseAll: false, compress: true, reportProgress: (_index, written, total) => { if (alive.current && id === generation.current) setProgress(Math.min(100, Math.round(written / total * 100))) } })
      if (!alive.current || id !== generation.current) return
      await loader.after("hard_reset")
      append("Firmware written successfully. Device reset.\n")
      setProgress(100)
    } catch (e) {
      if (alive.current && id === generation.current) setError(cancelled(e) ? "No ESP device selected." : `Flashing failed: ${message(e)}`)
    } finally {
      if (flashing.current === transport) flashing.current = null
      await transport?.disconnect().catch((e) => { if (alive.current && id === generation.current) setError(`Device cleanup failed: ${message(e)}`) })
      if (alive.current && id === generation.current) setState("disconnected")
    }
  }

  return <details className="firmware-hardware">
    <summary>Physical hardware <span className="muted">· {state === "connected" ? `${info} connected` : state === "flashing" ? "Flashing…" : "Web Serial & upload"}</span></summary>
    <p className="muted small">Choose a device to read and send serial text. Connections close when you leave this firmware document.</p>
    {!serial && <p className="muted firmware-serial-unavailable">Web Serial is unavailable here. Use a supporting desktop browser such as Chrome or Edge over HTTPS or localhost. Firmware downloads still work.</p>}
    <div className="firmware-hardware-controls">
      <label>Baud<select aria-label="Serial baud rate" disabled={state !== "disconnected"} value={baud} onChange={(e) => setBaud(e.target.value)}>{[9600, 19200, 38400, 57600, 115200, 230400, 460800, 921600].map((rate) => <option key={rate}>{rate}</option>)}</select></label>
      <button disabled={!serial || state !== "disconnected"} onClick={connect}>{state === "choosing" ? "Choose a device…" : "Connect serial"}</button>
      <button disabled={state === "disconnected" || state === "choosing" || state === "disconnecting"} onClick={() => { if (state === "flashing") { setError("Flashing interrupted. Flash the complete image again before using the device.") } void disconnect() }}>{state === "flashing" ? "Cancel flashing" : "Disconnect serial"}</button>
      <span className="muted small" role="status">{state === "connected" ? `${info} · ${baud} baud` : state === "disconnected" ? "Disconnected" : state}</span>
      <button className="ghost small" onClick={() => setOutput("")}>Clear hardware log</button>
    </div>
    <form className="firmware-serial-send" onSubmit={(e) => { e.preventDefault(); void send() }}><input aria-label="Serial message" value={text} onChange={(e) => setText(e.target.value)} placeholder="Text to send to device" disabled={state !== "connected" || sending} /><select aria-label="Serial line ending" value={ending} onChange={(e) => setEnding(e.target.value)}><option value="">No line ending</option><option value={"\n"}>LF</option><option value={"\r\n"}>CRLF</option><option value={"\r"}>CR</option></select><button type="submit" disabled={state !== "connected" || sending || !text}>Send serial</button></form>
    {platform === "rp2040" ? <p className="muted small">To upload to Pico, hold BOOTSEL while connecting USB, then copy {uf2 && currentBuild ? <a href={uf2} download>firmware.uf2</a> : "the built firmware.uf2"} to the RPI-RP2 drive. USB serial is available after the sketch starts.</p> : <div className="firmware-flash"><p className="muted small">{verifiedEsp ? "Write the current merged ESP32-C3 image at address 0 and reset the selected device. Disconnect the serial monitor first. This replaces firmware on that device." : "Browser flashing currently supports the verified esp32c3 board target and merged image layout. Download artifacts for other ESP boards and use their documented upload procedure."}</p><button disabled={!serial || !verifiedEsp || !image || !currentBuild || state !== "disconnected"} onClick={flash}>Choose ESP device & flash</button>{(!image || !currentBuild) && <span className="muted small">Build the current sources to enable upload.</span>}{progress !== null && <label className="firmware-flash-progress">Flash {progress}% <progress value={progress} max="100" /></label>}</div>}
    {error && <p className="electronics-error" role="alert">{error}</p>}
    <pre ref={terminal} className="firmware-hardware-log" aria-label="Hardware serial log" tabIndex={0}>{output || "Device output will appear here."}</pre>
    {busy && <span className="muted small">The selected hardware operation is in progress.</span>}
  </details>
}
