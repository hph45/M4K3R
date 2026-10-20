import { CommandError, defineCommand, findComponent, findDoc, type Project } from "@m4k3r/core"
import { z } from "zod"
import type { BuildInput } from "./build"
import { pinHeader } from "./pins"

const FilePath = z
  .string()
  .regex(/^(?!\/)(?!.*(^|\/)\.\.?(\/|$))[\w./ -]+$/, "a relative path like main.ino or src/radio.cpp")
const MainPath = FilePath.refine((path) => !path.includes("/") && path.endsWith(".ino"), "Main sketch must be a root-level .ino file, e.g. main.ino")

export const LibSpec = z.string().regex(/^[^@]+@\d[\w.+-]*$/, "a pinned library like RF24@1.4.11")

const TEMPLATE = `#include "m4k3r_pins.h"

void setup() {
  Serial.begin(115200);
}

void loop() {
}
`

export const FirmwareData = z.object({
  platform: z.enum(["rp2040", "esp32"]).default("rp2040"),
  mcu: z.string().optional().describe("MCU component id or ref, e.g. U1"),
  board: z.string().min(1).optional().describe("Board id in the selected Arduino core; defaults to rpipico or esp32c3 for its platform"),
  libs: z.array(LibSpec).default([]),
  main: MainPath.default("main.ino"),
  files: z.record(FilePath, z.string()).default({ "main.ino": TEMPLATE }),
}).transform((data) => ({ ...data, board: data.board ?? (data.platform === "esp32" ? "esp32c3" : "rpipico") }))
export type FirmwareData = z.infer<typeof FirmwareData>

export const firmwareDoc = (p: Project, doc: string) => findDoc(p, doc, "firmware").data as FirmwareData

/** Everything a build needs: the doc's sources plus the generated pin header. */
export function buildInput(p: Project, doc: string): BuildInput {
  const { platform, board, libs, main, files, mcu } = firmwareDoc(p, doc)
  if (!Object.hasOwn(files, main)) throw new CommandError(`Main sketch "${main}" is missing`)
  return { platform, board, libs, main, files: { ...files, "m4k3r_pins.h": pinHeader(p, mcu) } }
}

const Doc = z.string().describe("firmware doc id or name")

export const firmwareCommands = [
  defineCommand({
    type: "firmware.file.write",
    summary: "Create or replace a source file in a firmware doc",
    args: z.object({ doc: Doc, path: FilePath, content: z.string() }),
    run(p, { doc, path, content }) {
      if (path === "m4k3r_pins.h") throw new CommandError("m4k3r_pins.h is generated from the schematic")
      firmwareDoc(p, doc).files[path] = content
    },
  }),

  defineCommand({
    type: "firmware.file.remove",
    summary: "Delete a source file from a firmware doc",
    args: z.object({ doc: Doc, path: FilePath }),
    run(p, { doc, path }) {
      const data = firmwareDoc(p, doc)
      if (!(path in data.files)) throw new CommandError(`No file "${path}"`)
      if (path === data.main) throw new CommandError(`"${path}" is the main sketch`)
      delete data.files[path]
    },
  }),

  defineCommand({
    type: "firmware.set",
    summary: "Set a firmware doc's target MCU component, board, pinned libraries or main sketch",
    args: z.object({
      doc: Doc,
      mcu: z.string().nullable().optional().describe("Component id or ref; null clears it"),
      platform: z.enum(["rp2040", "esp32"]).optional(),
      board: z.string().min(1).optional(),
      libs: z.array(LibSpec).optional(),
      main: MainPath.optional(),
    }),
    run(p, { doc, mcu, platform, board, libs, main }) {
      const data = firmwareDoc(p, doc)
      if (platform !== undefined) {
        data.platform = platform
        if (board === undefined) data.board = platform === "esp32" ? "esp32c3" : "rpipico"
      }
      if (mcu === null) delete data.mcu
      else if (mcu !== undefined) data.mcu = findComponent(p, mcu).id
      if (board !== undefined) data.board = board
      if (libs !== undefined) data.libs = libs
      if (main !== undefined) {
        if (!main.endsWith(".ino")) throw new CommandError("The main sketch must be an .ino file")
        data.main = main
        data.files[main] ??= TEMPLATE
      }
    },
  }),
]
