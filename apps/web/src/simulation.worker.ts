import { SimulationRunner, type SimulationRequest, type SimulationResponse } from "./simulationRunner"

const worker = self as unknown as { postMessage(message: SimulationResponse): void; onmessage: ((e: MessageEvent<SimulationRequest>) => void) | null }
let runner: SimulationRunner | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let lastWall = 0
let horizon = 0
let realtime = 0
let lastPost = 0

const send = () => runner && worker.postMessage({ type: "frame", frame: runner.frame(realtime) })
const stop = () => { if (timer !== undefined) clearTimeout(timer); timer = undefined }
const fail = (error: unknown) => {
  stop()
  if (runner) runner.running = false
  worker.postMessage({ type: "error", error: error instanceof Error ? error.message : String(error) })
}

function tick() {
  timer = undefined
  if (!runner?.running) return
  try {
    const now = performance.now()
    const elapsed = Math.min(0.1, (now - lastWall) / 1000)
    lastWall = now
    // Bound accumulated catch-up when a circuit cannot reach the requested realtime speed.
    horizon = Math.min(horizon + elapsed * runner.speed, runner.session.t + Math.min(0.25 * runner.speed, 1))
    const previous = runner.session.t
    runner.advanceTo(horizon)
    const factor = elapsed > 0 ? (runner.session.t - previous) / elapsed : 0
    realtime = realtime * 0.8 + factor * 0.2
    if (now - lastPost >= 32) { send(); lastPost = now }
    timer = setTimeout(tick, 4)
  } catch (error) { fail(error) }
}

worker.onmessage = ({ data: message }) => {
  try {
    if (message.type === "init") {
      stop()
      runner = undefined
      runner = new SimulationRunner(message.project, message.data, message.probes)
      horizon = 0
      realtime = 0
    } else if (runner) {
      if (message.type === "play" && !runner.running) {
        runner.running = true
        lastWall = performance.now()
        horizon = runner.session.t
        timer = setTimeout(tick, 0)
      } else if (message.type === "pause") {
        runner.running = false
        stop()
      } else if (message.type === "reset") {
        stop()
        runner.reset()
        realtime = 0
        horizon = 0
      } else if (message.type === "step") {
        runner.running = false
        stop()
        runner.advanceTo(runner.session.t + Math.max(runner.session.step, 0.001))
      } else if (message.type === "input") runner.input(message.event)
      else if (message.type === "configure") runner.configure(message.speed, message.probes)
    }
    send()
  } catch (error) { fail(error) }
}
