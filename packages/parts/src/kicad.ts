import type { PartInput } from "@m4k3r/core"
import { importFootprint, type KicadFootprint } from "./footprint"
import { kicadPart } from "./part"
import { importSymbol, type KicadSymbol } from "./symbol"

/** Where downloads are kept between runs, keyed by a relative path like symbols/Device/R.kicad_sym. */
export interface Cache {
  get(key: string): Promise<string | undefined>
  set(key: string, text: string): Promise<void>
}

const GITLAB = "https://gitlab.com/kicad/libraries"
const BRANCH = "master"
const REPOS = { symbols: "kicad-symbols", footprints: "kicad-footprints" } as const
const EXT = { symbols: [".kicad_symdir", ".kicad_sym"], footprints: [".pretty", ".kicad_mod"] } as const
export type LibKind = keyof typeof REPOS
const API = (kind: LibKind) => `https://gitlab.com/api/v4/projects/${encodeURIComponent(`kicad/libraries/${REPOS[kind]}`)}/repository/tree?ref=${BRANCH}`
const INDEX_KEY = "index/symbols.json"
const INDEX_MAX_AGE = 7 * 24 * 3600_000

/** Every symbol in the official libraries, by library. Cached as JSON. */
export interface SymbolIndex {
  updated: number
  libs: Record<string, string[]>
}

const raw = (kind: LibKind, lib: string, name: string) =>
  `${GITLAB}/${REPOS[kind]}/-/raw/${BRANCH}/${lib}${EXT[kind][0]}/${encodeURIComponent(name)}${EXT[kind][1]}`

/** "${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603.step" → a download URL. Other paths are kept as they are. */
export const modelUrl = (path: string) =>
  path.replace(/^\$\{KICAD\d*_3DMODEL_DIR\}\//, `${GITLAB}/kicad-packages3D/-/raw/${BRANCH}/`)

/** "Device:R" → ["Device", "R"] */
export function splitRef(ref: string): [string, string] {
  const [lib, name, extra] = ref.split(":")
  const ok = (s?: string) => !!s && !/[/\\]/.test(s) && !s.startsWith(".")
  if (!ok(lib) || !ok(name) || extra !== undefined) throw new Error(`Expected "Library:Name", e.g. "Device:R", got "${ref}"`)
  return [lib!, name!]
}

export interface ImportRequest {
  /** "Lib:Name" from the KiCad libraries, or the contents of a .kicad_sym file */
  symbol: string
  /** Symbol name, when `symbol` is file contents with several symbols */
  name?: string
  /** "Lib:Name" or .kicad_mod contents. Defaults to the symbol's Footprint property; null for none. */
  footprint?: string | null
  id?: string
  overrides?: Partial<PartInput>
}

/** The official KiCad symbol, footprint and 3D libraries, fetched by name on demand. */
export class KicadLibrary {
  private index?: SymbolIndex
  private refs?: string[]
  private building?: Promise<SymbolIndex>

  constructor(
    private cache?: Cache,
    private fetchText: (url: string) => Promise<Response> = fetch,
  ) {}

  private async get(key: string, url: string, what: string): Promise<string> {
    const cached = await this.cache?.get(key)
    if (cached !== undefined) return cached
    const res = await this.fetchText(url)
    if (res.status === 404) throw new Error(`${what} not found in the KiCad libraries`)
    if (!res.ok) throw new Error(`Fetching ${what} failed: HTTP ${res.status}`)
    const text = await res.text()
    await this.cache?.set(key, text)
    return text
  }

  /** "Device:R" → the imported symbol. Fetches parent symbols for derived ones. */
  async symbol(ref: string): Promise<KicadSymbol> {
    const [lib, name] = splitRef(ref)
    const files: string[] = []
    for (let n: string | undefined = name; n && files.length < 5; ) {
      const file = await this.get(`symbols/${lib}/${n}.kicad_sym`, raw("symbols", lib, n), `Symbol ${lib}:${n}`)
      files.push(file)
      n = /\(extends\s+"([^"]+)"/.exec(file)?.[1]
    }
    return importSymbol(files, name)
  }

  async footprint(ref: string): Promise<KicadFootprint> {
    const [lib, name] = splitRef(ref)
    return importFootprint(await this.get(`footprints/${lib}/${name}.kicad_mod`, raw("footprints", lib, name), `Footprint ${ref}`))
  }

  /** Names in a library, or the library names when `lib` is omitted, filtered by the words in `query`. */
  async list(kind: LibKind, lib?: string, query = ""): Promise<string[]> {
    if (lib) splitRef(`${lib}:x`)
    const ext = lib ? EXT[kind][1] : EXT[kind][0]
    const key = `lists/${kind}/${lib ?? "_libraries"}.txt`
    let text = await this.cache?.get(key)
    if (text === undefined) {
      const path = encodeURIComponent(lib ? `${lib}${EXT[kind][0]}` : "")
      const names: string[] = []
      for (let page = 1; page; ) {
        const url = `${API(kind)}&path=${path}&per_page=100&page=${page}`
        const res = await this.fetchText(url)
        if (res.status === 404) throw new Error(`No KiCad ${kind} library "${lib}"`)
        if (!res.ok) throw new Error(`Listing KiCad ${kind} failed: HTTP ${res.status}`)
        const entries = (await res.json()) as { name: string }[]
        names.push(...entries.filter((e) => e.name.endsWith(ext)).map((e) => e.name.slice(0, -ext.length)))
        page = Number(res.headers.get("x-next-page")) || 0
      }
      text = names.join("\n")
      await this.cache?.set(key, text)
    }
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return text.split("\n").filter((n) => n && words.every((w) => n.toLowerCase().includes(w)))
  }

  /**
   * The symbol index, built once from the repository tree and cached. A stale index (older than a week)
   * is served while it refreshes in the background; `refresh` waits for a new one, keeping the old one if that fails.
   */
  async symbolIndex(refresh = false): Promise<SymbolIndex> {
    if (!this.index) {
      const text = await this.cache?.get(INDEX_KEY)
      if (text) this.setIndex(JSON.parse(text) as SymbolIndex)
    }
    if (this.index && !refresh && Date.now() - this.index.updated < INDEX_MAX_AGE) return this.index
    this.building ??= this.buildIndex()
      .then(async (index) => {
        this.setIndex(index)
        await this.cache?.set(INDEX_KEY, JSON.stringify(index))
        return index
      })
      .finally(() => (this.building = undefined))
    if (this.index && !refresh) {
      this.building.catch(() => {})
      return this.index
    }
    try {
      return await this.building
    } catch (e) {
      if (this.index) return this.index
      throw new Error(`Indexing the KiCad symbol libraries failed: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  /** "Lib:Name" symbols across all libraries (or one), matching every word in `query`; exact and prefix name matches first, then shorter names. */
  async searchSymbols(query: string, lib?: string, limit = 50): Promise<string[]> {
    await this.symbolIndex()
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    const prefix = lib && `${lib.toLowerCase()}:`
    const q = words.join(" ")
    const rank = (ref: string) => {
      const name = ref.slice(ref.indexOf(":") + 1).toLowerCase()
      return name === q ? 0 : words[0] && name.startsWith(words[0]) ? 1 : 2
    }
    return this.refs!
      .filter((ref) => { const r = ref.toLowerCase(); return (!prefix || r.startsWith(prefix)) && words.every((w) => r.includes(w)) })
      .map((ref) => ({ ref, rank: rank(ref), length: ref.length - ref.indexOf(":") }))
      .sort((a, b) => a.rank - b.rank || a.length - b.length || a.ref.localeCompare(b.ref))
      .slice(0, limit)
      .map((m) => m.ref)
  }

  private setIndex(index: SymbolIndex) {
    this.index = index
    this.refs = Object.entries(index.libs).flatMap(([lib, names]) => names.map((name) => `${lib}:${name}`))
  }

  /** Reads the whole symbol repository tree, a few pages at a time. */
  private async buildIndex(): Promise<SymbolIndex> {
    const libs: Record<string, string[]> = {}
    let next = 1
    let last = Infinity
    const worker = async () => {
      while (next <= last) {
        const page = next++
        const res = await this.fetchRetrying(`${API("symbols")}&recursive=true&per_page=100&page=${page}`)
        const entries = (await res.json()) as { path: string; type: string }[]
        if (!res.headers.get("x-next-page")) last = Math.min(last, page)
        for (const { path, type } of entries) {
          const m = type === "blob" && /^([^/]+)\.kicad_symdir\/([^/]+)\.kicad_sym$/.exec(path)
          if (m) (libs[m[1]!] ??= []).push(m[2]!)
        }
      }
    }
    await Promise.all(Array.from({ length: 5 }, () => worker().catch((e) => { last = 0; throw e })))
    if (!Object.keys(libs).length) throw new Error("no symbols found")
    for (const names of Object.values(libs)) names.sort()
    return { updated: Date.now(), libs }
  }

  /** GitLab allows 500 unauthenticated requests a minute: back off on 429 and server errors. */
  private async fetchRetrying(url: string, attempts = 5): Promise<Response> {
    for (let i = 1; ; i++) {
      const res = await this.fetchText(url)
      if (res.ok) return res
      if ((res.status !== 429 && res.status < 500) || i >= attempts) throw new Error(`HTTP ${res.status}`)
      const after = res.headers.get("retry-after")
      await new Promise((r) => setTimeout(r, after ? Number(after) * 1000 : 500 * 2 ** i))
    }
  }

  /** Import a part from the KiCad libraries or from file contents. */
  async importPart(req: ImportRequest) {
    const isFile = (s: string) => s.trimStart().startsWith("(")
    const sym = isFile(req.symbol) ? importSymbol(req.symbol, req.name) : await this.symbol(req.symbol)
    const fpRef = req.footprint === undefined ? sym.properties.Footprint || undefined : (req.footprint ?? undefined)
    const fp = fpRef === undefined ? undefined : isFile(fpRef) ? importFootprint(fpRef) : await this.footprint(fpRef)
    return kicadPart(sym, fp, {
      id: req.id,
      overrides: req.overrides,
      ...(!isFile(req.symbol) && { symbolSource: `KiCad ${req.symbol}` }),
      ...(fpRef && !isFile(fpRef) && { footprintSource: `KiCad ${fpRef}` }),
      ...(fp?.model && { model3d: modelUrl(fp.model) }),
    })
  }
}
