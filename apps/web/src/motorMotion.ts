/** Keep a motor's state legible when animation is paused or the OS requests reduced motion. */
export function motorMotion(rpm: number, running: boolean) {
  const speed = Number.isFinite(rpm) ? rpm : 0
  const moving = Math.abs(speed) >= 1
  return {
    rpm: speed,
    moving,
    animated: running && moving,
    direction: speed < 0 ? "reverse" as const : "normal" as const,
    duration: `${Math.max(0.12, 60 / Math.max(1, Math.abs(speed)))}s`,
    state: moving ? running ? "Spinning" : "Paused" : "Stopped",
  }
}
