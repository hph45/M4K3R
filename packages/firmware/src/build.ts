import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { CLI_VERSION, coreFor, type Platform, type Toolchain } from "./toolchain"

export interface Diagnostic {
  file: string
  line: number
  col: number
  severity: "error" | "warning"
  message: string
}

export interface BuildInput {
  platform?: Platform
  board: string
  libs: string[]
  main: string
  files: Record<string, string>
}

export interface BuildResult {
  ok: boolean
  hash: string
  diagnostics: Diagnostic[]
  /** Bytes used: flash (program + initialised data) and static RAM. */
  size?: { flash: number; ram: number }
  /** Files in the build folder, e.g. firmware.uf2 and firmware.elf */
  artifacts: string[]
  cached?: boolean
}

const LINE = /^(.+?):(\d+):(?:(\d+):)? (fatal error|error|warning): (.*)$/
const LINK = /^(.+?):(?:(\d+):)?(?:\([^)]*\):)? ?((?:undefined reference to|multiple definition of) .*)$/

/** gcc/ld output → diagnostics. Paths inside the sketch become relative, e.g. main.ino. */
export function parseDiagnostics(output: string, sketchDir: string): Diagnostic[] {
  const relative = (file: string) => {
    for (const prefix of [`${sketchDir}/`, `${sketchDir}/build/sketch/`]) {
      if (file.startsWith(prefix)) return file.slice(prefix.length)
    }
    return file
  }
  const seen = new Set<string>()
  const out: Diagnostic[] = []
  for (const line of output.split(/\r?\n/)) {
    const m = LINE.exec(line)
    const l = LINK.exec(line)
    const o = /\bld: (.*overflowed.*)$/.exec(line)
    const d: Diagnostic | undefined = m
      ? {
          file: relative(m[1]!),
          line: Number(m[2]),
          col: Number(m[3] ?? 0),
          severity: m[4] === "warning" ? "warning" : "error",
          message: m[5]!,
        }
      : l
        ? { file: relative(l[1]!), line: Number(l[2] ?? 0), col: 0, severity: "error", message: l[3]! }
        : o
          ? { file: "", line: 0, col: 0, severity: "error", message: o[1]! }
          : undefined
    const key = d && `${d.file}:${d.line}:${d.col}:${d.message}`
    if (d && !seen.has(key!)) {
      seen.add(key!)
      out.push(d)
    }
  }
  return out
}

/** Content hash of everything that affects the binary. */
export function buildHash(input: BuildInput) {
  const files = Object.entries(input.files).sort(([a], [b]) => (a < b ? -1 : 1))
  const core = coreFor(input.platform)
  const key = { cli: CLI_VERSION, core: `${core.name}@${core.version}`, ...input, files }
  return createHash("sha256").update(JSON.stringify(key)).digest("hex").slice(0, 16)
}

const inflight = new Map<string, Promise<BuildResult>>()

/** Compile with arduino-cli. Results and binaries are cached in <cacheDir>/<hash>/. */
export function build(tc: Toolchain, cacheDir: string, input: BuildInput): Promise<BuildResult> {
  const hash = buildHash(input)
  const saved = join(cacheDir, hash, "result.json")
  if (existsSync(saved)) return Promise.resolve({ ...JSON.parse(readFileSync(saved, "utf8")), cached: true })
  const key = `${cacheDir}/${hash}`
  let job = inflight.get(key)
  if (!job) {
    job = compile(tc, join(cacheDir, hash), hash, input).finally(() => inflight.delete(key))
    inflight.set(key, job)
  }
  return job
}

async function compile(tc: Toolchain, out: string, hash: string, input: BuildInput): Promise<BuildResult> {
  await tc.ensure(input.libs, input.platform)
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "m4k3r-build-")))
  try {
    const name = input.main.replace(/\.ino$/, "")
    const sketch = join(tmp, name)
    for (const [path, content] of Object.entries(input.files)) {
      mkdirSync(dirname(join(sketch, path)), { recursive: true })
      writeFileSync(join(sketch, path), content)
    }
    const buildDir = join(sketch, "build")
    const r = await tc.run([
      "compile", sketch, "--json", "--warnings", "default",
      "--fqbn", `${coreFor(input.platform).name}:${input.board}`,
      "--build-path", buildDir,
      ...input.libs.flatMap((spec) => ["--libraries", tc.libDir(spec)]),
      ...(tc.compileArgs ?? []),
    ])
    let json: {
      success?: boolean
      error?: string
      compiler_err?: string
      builder_result?: { executable_sections_size?: { name: string; size: number }[] }
    }
    try {
      json = JSON.parse(r.stdout)
    } catch {
      throw new Error(`arduino-cli failed: ${r.stderr ?? r.stdout}`)
    }
    const ok = !!json.success
    const diagnostics = parseDiagnostics(json.compiler_err ?? "", sketch)
    if (!ok && !diagnostics.some((d) => d.severity === "error")) {
      diagnostics.push({ file: "", line: 0, col: 0, severity: "error", message: json.error ?? "Build failed" })
    }
    const result: BuildResult = { ok, hash, diagnostics, artifacts: [] }
    mkdirSync(out, { recursive: true })
    if (ok) {
      const sections = json.builder_result?.executable_sections_size ?? []
      const size = (n: string) => sections.find((s) => s.name === n)?.size ?? 0
      result.size = { flash: size("text"), ram: size("data") }
      for (const ext of input.platform === "esp32" ? ["elf", "bin", "bootloader.bin", "partitions.bin", "merged.bin"] : ["elf", "uf2"]) {
        if (!existsSync(join(buildDir, `${input.main}.${ext}`))) continue
        copyFileSync(join(buildDir, `${input.main}.${ext}`), join(out, `firmware.${ext}`))
        result.artifacts.push(`firmware.${ext}`)
      }
    }
    writeFileSync(join(out, "result.json"), JSON.stringify(result, null, 2))
    return result
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}
