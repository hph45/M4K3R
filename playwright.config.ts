import { existsSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { defineConfig } from "@playwright/test"

const chrome = process.platform === "darwin" && existsSync("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
const external = process.env.M4K3R_E2E_URL

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: external ?? "http://127.0.0.1:4498",
    ...(chrome ? { channel: "chrome" } : {}),
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: external ? undefined : {
    command: process.env.M4K3R_E2E_PRODUCTION === "1" ? "pnpm start" : "pnpm dev",
    url: "http://127.0.0.1:4498/api/projects",
    env: { PORT: "4498", M4K3R_HOME: process.env.M4K3R_E2E_HOME ?? join(tmpdir(), `m4k3r-e2e-${process.pid}`) },
    timeout: 30_000,
  },
})
