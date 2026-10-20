import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    include: ["{apps,packages}/*/src/**/*.test.ts"],
    // CAD/MCU WASM workers are expensive; leave CPU time for timing-sensitive solver checks.
    maxWorkers: 4,
  },
})
