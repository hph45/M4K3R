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
      const project = encodeURIComponent(`kicad/libraries/${REPOS[kind]}`)
      const path = encodeURIComponent(lib ? `${lib}${EXT[kind][0]}` : "")
      const names: string[] = []
      for (let page = 1; page; ) {
        const url = `https://gitlab.com/api/v4/projects/${project}/repository/tree?ref=${BRANCH}&path=${path}&per_page=100&page=${page}`
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
