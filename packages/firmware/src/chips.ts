/** ESP32 chip families the Espressif emulator can run. Browser-safe: no Node imports. */
export const ESP_CHIPS = ["esp32c3", "esp32c5", "esp32c6", "esp32h2", "esp32p4", "esp32s3", "esp32s31"] as const
export type EspChip = (typeof ESP_CHIPS)[number]

/** The emulated chip for a board id like "esp32-s3-devkitc-1", or undefined when the board builds but can't be emulated. */
export function espChip(board: string): EspChip | undefined {
  const target = board.toLowerCase().replaceAll("-", "")
  return [...ESP_CHIPS].sort((a, b) => b.length - a.length).find((chip) => target.startsWith(chip))
}
