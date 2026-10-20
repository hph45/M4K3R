import { mkdir, readFile, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import type { Cache } from "./kicad"

/** A Cache backed by files under `dir`, e.g. M4K3R_HOME/.cache/kicad. Node only. */
export const fileCache = (dir: string): Cache => ({
  get: (key) => readFile(join(dir, key), "utf8").catch(() => undefined),
  set: async (key, text) => {
    await mkdir(dirname(join(dir, key)), { recursive: true })
    await writeFile(join(dir, key), text)
  },
})
