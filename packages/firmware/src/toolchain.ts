import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { promisify } from "node:util"

const exec = promisify(execFile)

/** Every version is pinned, so the same sources always build the same binary. */
export const CLI_VERSION = "1.5.1"
export const CORE = "rp2040:rp2040"
export const CORE_VERSION = "6.2.0"
const CORE_INDEX = "https://github.com/earlephilhower/arduino-pico/releases/download/global/package_rp2040_index.json"

const CLI_BUILDS: Record<string, { file: string; sha256: string }> = {
  "darwin-arm64": {
    file: "macOS_ARM64.tar.gz",
    sha256: "cb952e8c1621c95ef5f1d17831c945e3d0ec5973f89c557a7ec8feb9c4f7d4c9",
  },
  "darwin-x64": { file: "macOS_64bit.tar.gz", sha256: "c982e940027996bea9901050e95fae99c59c1dcfee54beedecaf28141e7bf2e7" },
  "linux-x64": { file: "Linux_64bit.tar.gz", sha256: "28a8e119c498a25607821c36cb2dc49e8463941b261a0d99091baa7bc692dd2b" },
  "linux-arm64": { file: "Linux_ARM64.tar.gz", sha256: "1e69e077479f300614d4551334e0a33f08ee40b04315d83b8e7e0e94f0d0ee62" },
}

export type Log = (line: string) => void

/**
 * arduino-cli, the arduino-pico core and libraries, installed on demand under <home>/.toolchains.
 * Each library version gets its own folder, so projects pinning different versions don't collide.
 */
export class Toolchain {
  readonly dir: string
  readonly cli: string
  readonly config: string
  /** Extra arguments for arduino-cli compile on this host. */
  compileArgs: string[] | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    home: string,
    private log: Log = (line) => console.log(`[firmware] ${line}`),
  ) {
    this.dir = join(home, ".toolchains")
    this.cli = join(this.dir, `arduino-cli-${CLI_VERSION}`, "arduino-cli")
    this.config = join(this.dir, "arduino-cli.yaml")
  }

  /** Folder holding the libraries for one pinned spec, e.g. "RF24@1.4.11". */
  libDir(spec: string) {
    return join(this.dir, "libraries", spec.replace(/[^\w.@-]+/g, "_"), "libraries")
  }

  /** Install whatever is missing. Concurrent callers wait for one install at a time. */
  ensure(libs: string[] = []): Promise<void> {
    const next = this.queue.then(() => this.install(libs))
    this.queue = next.catch(() => {})
    return next
  }

  /** Run arduino-cli with our config. Resolves with stdout even when the command fails. */
  async run(args: string[], env: Record<string, string> = {}) {
    try {
      const { stdout } = await exec(this.cli, [...args, "--config-file", this.config], {
        env: { ...process.env, ...env },
        maxBuffer: 64 * 1024 * 1024,
      })
      return { ok: true, stdout }
    } catch (e) {
      const err = e as { stdout?: string; stderr?: string; message: string }
      return { ok: false, stdout: err.stdout ?? "", stderr: err.stderr || err.message }
    }
  }

  private async cliOrThrow(what: string, args: string[], env?: Record<string, string>) {
    const t = Date.now()
    this.log(`${what}…`)
    const r = await this.run(args, env)
    if (!r.ok) throw new Error(`${what} failed: ${r.stderr}`)
    this.log(`${what} done in ${((Date.now() - t) / 1000).toFixed(1)} s`)
  }

  private async install(libs: string[]) {
    mkdirSync(this.dir, { recursive: true })
    if (!existsSync(this.cli)) await this.downloadCli()
    if (!existsSync(this.config)) {
      writeFileSync(
        this.config,
        [
          "board_manager:",
          `  additional_urls: [${CORE_INDEX}]`,
          "directories:",
          `  data: ${join(this.dir, "arduino")}`,
          `  downloads: ${join(this.dir, "downloads")}`,
          `  user: ${join(this.dir, "sketchbook")}`,
          "build_cache:",
          `  path: ${join(this.dir, "build-cache")}`,
          "updater:",
          "  enable_notification: false",
          "",
        ].join("\n"),
      )
    }
    const stamp = join(this.dir, "arduino", `${CORE}@${CORE_VERSION}.installed`.replace(":", "_"))
    if (!existsSync(stamp)) {
      await this.cliOrThrow("Updating package index", ["core", "update-index"])
      await this.cliOrThrow(`Installing ${CORE}@${CORE_VERSION}`, ["core", "install", `${CORE}@${CORE_VERSION}`])
      writeFileSync(stamp, "")
      rmSync(join(this.dir, "downloads"), { recursive: true, force: true })
    }
    this.compileArgs ??= await this.checkCtags()
    for (const spec of libs) {
      const dir = this.libDir(spec)
      if (existsSync(join(dir, ".installed"))) continue
      rmSync(dir, { recursive: true, force: true })
      await this.cliOrThrow(`Installing library ${spec}`, ["lib", "install", spec], {
        ARDUINO_DIRECTORIES_USER: join(dir, ".."),
      })
      writeFileSync(join(dir, ".installed"), "")
    }
  }

  /**
   * Arduino's ctags (used to add function prototypes to .ino files) is x86-only on macOS.
   * Without Rosetta it can't run, so we skip prototype generation: functions must be declared before use.
   */
  private async checkCtags() {
    const dir = join(this.dir, "arduino", "packages", "builtin", "tools", "ctags")
    const versions = existsSync(dir) ? readdirSync(dir) : []
    try {
      await exec(join(dir, versions[0] ?? "-", "ctags"), ["--version"])
      return []
    } catch {
      this.log("ctags can't run here (on Apple Silicon: softwareupdate --install-rosetta); sketches need prototypes")
      return ["--build-property", "tools.ctags.pattern=/usr/bin/true"]
    }
  }

  private async downloadCli() {
    const build = CLI_BUILDS[`${process.platform}-${process.arch}`]
    if (!build) throw new Error(`No arduino-cli build for ${process.platform}/${process.arch}`)
    const url = `https://github.com/arduino/arduino-cli/releases/download/v${CLI_VERSION}/arduino-cli_${CLI_VERSION}_${build.file}`
    this.log(`Downloading arduino-cli ${CLI_VERSION}…`)
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${url}`)
    const data = Buffer.from(await res.arrayBuffer())
    const sha = createHash("sha256").update(data).digest("hex")
    if (sha !== build.sha256) throw new Error(`Checksum mismatch for ${url}`)
    const target = join(this.cli, "..")
    mkdirSync(target, { recursive: true })
    const archive = join(target, "arduino-cli.tar.gz")
    writeFileSync(archive, data)
    await exec("tar", ["-xzf", archive, "-C", target, "arduino-cli"])
    rmSync(archive)
    this.log(`arduino-cli ${CLI_VERSION} ready`)
  }
}
