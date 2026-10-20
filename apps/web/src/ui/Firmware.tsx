import type { Command } from "@m4k3r/core"
import { espChip } from "@m4k3r/firmware/chips"
import { useEffect, useRef, useState } from "react"
import { api } from "../api"
import { acknowledgeFirmwareSave, firmwareDraftKey, parseFirmwareDrafts, reconcileFirmwareDrafts, serializeFirmwareDrafts, unsavedFirmwareDrafts, type FirmwareDrafts } from "../firmwareDrafts"
import type { DocViewProps } from "../registry"
import { openPalette, run, toast, useApp } from "../store"
import { Editable } from "./Editable"
import { SerialPanel } from "./SerialPanel"
import { SourceEditor, type SourceDiagnostic, type SourceEditorHandle } from "./SourceEditor"
import "./firmware-tools.css"

// Browser-only data interfaces: importing the firmware runtime would pull Node/toolchain code into Vite.
interface FirmwareData { mcu?: string; platform?: "rp2040" | "esp32"; board: string; libs: string[]; main: string; files: Record<string, string> }
type Diagnostic = SourceDiagnostic
interface BuildResult { ok: boolean; hash: string; diagnostics: Diagnostic[]; artifacts: string[]; cached?: boolean; size?: { flash: number; ram: number } }
interface RunResult { ok: boolean; complete?: boolean; warnings?: string[]; diagnostics?: Diagnostic[]; serial?: Record<string, string>; gpio?: Record<string, { net?: string; state: string; function: string; edges: number }>; simulatedMs?: number; wallMs?: number }

const draftMemory = new Map<string, { files: FirmwareDrafts; failed: boolean }>()
const inputSignature = (data: FirmwareData, files: Record<string, string>, header: string) => JSON.stringify({
  platform: data.platform, board: data.board, libs: data.libs, main: data.main, mcu: data.mcu,
  files: Object.entries(files).sort(([a], [b]) => a.localeCompare(b)), header,
})

async function firmwareRequest<T>(path: string, signal: AbortSignal, body?: object): Promise<T> {
  const res = await fetch(path, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) })
  const result = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(result.error || `${res.status} ${res.statusText}`)
  return result as T
}

export function Firmware(props: DocViewProps) { return <FirmwareEditor key={`${props.project.id}/${props.doc.id}`} {...props} /> }

function FirmwareEditor({ project, doc }: DocViewProps) {
  const data = doc.data as FirmwareData
  const emulated = data.platform !== "esp32" || !!espChip(data.board)
  const storageKey = firmwareDraftKey(project.id, doc.id)
  const [recovery] = useState(() => {
    const memory = draftMemory.get(storageKey)
    if (memory) return memory
    try { return { files: parseFirmwareDrafts(localStorage.getItem(storageKey)), failed: false } }
    catch { return { files: {}, failed: true } }
  })
  const [path, setPath] = useState(data.main)
  const [drafts, setDrafts] = useState<FirmwareDrafts>(recovery.files)
  const draftRef = useRef(drafts)
  const [storageError, setStorageError] = useState(recovery.failed)
  const [restored, setRestored] = useState(Object.keys(recovery.files).length > 0)
  const [busy, setBusy] = useState<"save" | "build" | "run" | null>(null)
  const [build, setBuild] = useState<BuildResult | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [error, setError] = useState("")
  const [duration, setDuration] = useState("1000")
  const [header, setHeader] = useState("// Loading generated pin header…")
  const [builtSignature, setBuiltSignature] = useState<string | null>(null)
  const source = useRef<SourceEditorHandle>(null)
  const mounted = useRef(true)
  const operation = useRef<AbortController | null>(null)
  const saving = useRef(new Set<string>())
  const latest = useRef({ data, version: project.version, header })
  latest.current = { data, version: project.version, header }
  const base = `/api/projects/${encodeURIComponent(project.id)}/firmware/${encodeURIComponent(doc.id)}`
  const generated = path === "m4k3r_pins.h"
  const activePath = generated || Object.hasOwn(data.files, path) || Object.hasOwn(drafts, path) ? path : data.main
  const content = generated ? header : drafts[activePath]?.text ?? data.files[activePath] ?? ""
  const dirty = unsavedFirmwareDrafts(drafts, data.files, project.version)
  const sourceFiles = { ...data.files, ...Object.fromEntries(Object.entries(drafts).map(([file, draft]) => [file, draft.text])) }
  const changedSinceBuild = builtSignature && builtSignature !== inputSignature(data, sourceFiles, header)
  const conflicting = dirty.filter(([file, draft]) => Object.hasOwn(data.files, file) && data.files[file] !== draft.base && !(draft.saved && project.version < draft.saved.version))
  const diagnostics = build?.diagnostics ?? result?.diagnostics ?? []

  /** Write during the edit event, so an immediate tab switch/reload cannot outrun an effect. */
  function keepDrafts(next: FirmwareDrafts) {
    draftRef.current = next
    let failed = false
    try {
      if (Object.keys(next).length) localStorage.setItem(storageKey, serializeFirmwareDrafts(next))
      else localStorage.removeItem(storageKey)
    } catch { failed = true }
    draftMemory.set(storageKey, { files: next, failed })
    if (mounted.current) { setDrafts(next); setStorageError(failed) }
  }
  function edit(text: string) {
    const previous = draftRef.current[activePath]
    keepDrafts({ ...draftRef.current, [activePath]: { text, base: previous ? previous.base : latest.current.data.files[activePath] ?? null, ...(previous?.saved ? { saved: previous.saved } : {}) } })
  }

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; operation.current?.abort() }
  }, [])

  useEffect(() => {
    const abort = new AbortController()
    fetch(`${base}/pins.h`, { signal: abort.signal }).then(async (res) => {
      if (!res.ok) throw new Error("Pin header could not be generated. Check the target MCU.")
      setHeader(await res.text())
    }).catch((e) => { if (!abort.signal.aborted) setHeader(`// ${e.message}`) })
    return () => abort.abort()
  }, [base, project.version])

  useEffect(() => {
    const next = reconcileFirmwareDrafts(draftRef.current, data.files, project.version, saving.current)
    if (next !== draftRef.current) keepDrafts(next)
  }, [data.files, project.version, drafts])

  async function save() {
    const current = latest.current
    const submitted = Object.fromEntries(unsavedFirmwareDrafts(draftRef.current, current.data.files, current.version).map(([file, draft]) => [file, draft.text]))
    if (!Object.keys(submitted).length) return
    saving.current = new Set(Object.keys(submitted))
    const commands: Command[] = Object.entries(submitted).map(([path, content]) => ({ type: "firmware.file.write", args: { doc: doc.id, path, content } }))
    try {
      // Capture the target project; navigation must never redirect a pending save to another project.
      const response = await api.apply(project.id, commands, `Save ${doc.name} sources`)
      if (mounted.current) {
        saving.current = new Set()
        const acknowledged = acknowledgeFirmwareSave(draftRef.current, submitted, response.version)
        keepDrafts(reconcileFirmwareDrafts(acknowledged, latest.current.data.files, latest.current.version))
      }
      if (!useApp.getState().live) {
        const { history, ...fresh } = await api.project(project.id)
        useApp.setState((state) => state.project?.id === fresh.id && state.project.version <= fresh.version ? { project: fresh, history } : {})
      }
    } finally {
      saving.current = new Set()
      if (mounted.current) {
        const next = reconcileFirmwareDrafts(draftRef.current, latest.current.data.files, latest.current.version)
        if (next !== draftRef.current) keepDrafts(next)
      }
    }
  }
  async function perform(action: "save" | "build" | "run") {
    if (operation.current) return
    const controller = new AbortController()
    operation.current = controller
    const requestedSignature = inputSignature(data, sourceFiles, header)
    setBusy(action)
    setError("")
    try {
      await save()
      if (!mounted.current || controller.signal.aborted) return
      if (action === "save") toast("Firmware sources saved")
      if (action === "build") {
        setBuild(null)
        setResult(null)
        const built = await firmwareRequest<BuildResult>(`${base}/build`, controller.signal)
        if (!mounted.current || controller.signal.aborted) return
        setBuild(built)
        setBuiltSignature(requestedSignature)
      }
      if (action === "run") {
        const ms = Number(duration)
        if (!Number.isFinite(ms) || ms <= 0 || ms > 60_000) throw new Error("Run duration must be between 1 and 60,000 ms.")
        setBuild(null)
        // Build explicitly so both diagnostics and artifact links remain available after a run.
        const built = await firmwareRequest<BuildResult>(`${base}/build`, controller.signal)
        if (!mounted.current || controller.signal.aborted) return
        setBuild(built)
        setBuiltSignature(requestedSignature)
        setResult(null)
        if (built.ok) {
          const ran = await firmwareRequest<RunResult>(`${base}/run`, controller.signal, { ms })
          if (mounted.current && !controller.signal.aborted) setResult(ran)
        }
      }
    } catch (e) { if (mounted.current && !controller.signal.aborted) setError(e instanceof Error ? e.message : String(e)) }
    finally { if (operation.current === controller) operation.current = null; if (mounted.current) setBusy(null) }
  }

  function addFile() {
    openPalette({
      placeholder: "New source file, e.g. src/radio.cpp",
      submit: async (text) => {
        if (!mounted.current) return
        const path = text.trim()
        if (!path) return
        if (Object.hasOwn(sourceFiles, path) || path === "m4k3r_pins.h") return toast("That file already exists")
        if (await run([{ type: "firmware.file.write", args: { doc: doc.id, path, content: "" } }], `Add ${path}`) && mounted.current) setPath(path)
      },
    })
  }

  function jump(d: Diagnostic) {
    if (!Object.hasOwn(sourceFiles, d.file)) return
    setPath(d.file)
    source.current?.reveal(d.file, d.line, d.col)
  }
  const setTarget = (args: object, label: string) => run([{ type: "firmware.set", args: { doc: doc.id, ...args } }], label)
  const mcus = project.components.filter((c) => project.parts[c.part]?.pins.some((p) => [p.name, ...(p.functions ?? [])].some((name) => /^GP(?:IO)?\d+$/i.test(name))))
  const targetExists = !data.mcu || project.components.some((c) => c.id === data.mcu || c.ref === data.mcu)

  return <div className="electronics-workspace firmware-workspace">
    <header className="electronics-toolbar">
      <Editable className="electronics-doc-title" value={doc.name} onCommit={(name) => name && run([{ type: "doc.rename", args: { doc: doc.id, name } }], "Rename firmware target")} />
      <span className="muted small">Arduino C++ · {dirty.length ? `${dirty.length} unsaved file${dirty.length === 1 ? "" : "s"} · local draft kept` : "All changes saved"}</span>
      <span className="spacer" />
      <button disabled={!!busy || !dirty.length} onClick={() => perform("save")}>{busy === "save" ? "Saving…" : "Save"}</button>
      <button className="ghost" disabled={!!busy || !dirty.length} onClick={() => { keepDrafts({}); setRestored(false) }}>Discard drafts</button>
      <button disabled={!!busy} onClick={() => perform("build")}>{busy === "build" ? "Building…" : "Build"}</button>
      <label className="firmware-duration"><input aria-label="Simulation duration in milliseconds" type="number" min="1" max="60000" value={duration} onChange={(e) => setDuration(e.target.value)} />ms</label>
      <button className="primary" disabled={!!busy || !emulated} title={emulated ? undefined : "This board can be built but not emulated"} onClick={() => perform("run")}>{busy === "run" ? "Running…" : data.platform === "esp32" ? "Run on ESP32" : "Run on Pico"}</button>
    </header>
    <div className="electronics-body firmware-body">
      <aside className="firmware-files">
        <div className="firmware-files-head"><h2>Sources</h2><button className="ghost small" onClick={addFile}>+ File</button></div>
        {Object.keys(sourceFiles).sort().map((file) => <button key={file} className="firmware-file mono" data-active={file === activePath || undefined} onClick={() => setPath(file)} title={file}>{file}{dirty.some(([p]) => p === file) ? " ●" : ""}{file === data.main ? " · main" : ""}</button>)}
        <button className="firmware-file mono" data-active={generated || undefined} onClick={() => setPath("m4k3r_pins.h")}>m4k3r_pins.h <span className="muted">↻</span></button>
        <div className="firmware-target">
          <h2>Target</h2>
          <label>MCU<select aria-label="Target MCU" value={data.mcu ?? ""} onChange={(e) => setTarget({ mcu: e.target.value || null }, "Set firmware MCU")}><option value="">No MCU selected</option>{mcus.map((c) => <option key={c.id} value={c.id}>{c.ref} · {project.parts[c.part]?.name}</option>)}{data.mcu && !mcus.some((c) => c.id === data.mcu) && <option value={data.mcu}>{targetExists ? data.mcu : "Missing MCU"}</option>}</select></label>
          {!targetExists && <p className="electronics-error small">The target MCU was removed. Select another MCU.</p>}
          <label>Platform<select aria-label="Firmware platform" value={data.platform ?? "rp2040"} onChange={(e) => setTarget({ platform: e.target.value }, "Set firmware platform")}><option value="rp2040">RP2040 · Arduino Pico</option><option value="esp32">ESP32 · Espressif Arduino</option></select></label>
          <label>Board<Editable value={data.board} onCommit={(board) => board && setTarget({ board }, "Set firmware board")} /></label>
          {!emulated && <p className="muted small">Build only. Espressif's emulator doesn't support {data.board}; Run works on C3, C5, C6, H2, P4 and S3 boards.</p>}
          <label>Pinned libraries<Editable value={data.libs.join(", ")} placeholder="e.g. RF24@1.4.11" onCommit={(text) => setTarget({ libs: text.split(",").map((s) => s.trim()).filter(Boolean) }, "Set firmware libraries")} /></label>
          <p className="muted small">Local drafts survive document switches and reloads in this browser. Save writes them to the project with undo history. Builds and runs save all edited files first.</p>
          {storageError && <p className="electronics-error small">Browser draft storage is unavailable. Save to the project before closing or reloading this page.</p>}
        </div>
      </aside>
      <section className="firmware-main">
        <div className="firmware-source-head"><span className="mono">{activePath}</span><span className="spacer" />{generated ? <span className="muted small">Generated from the shared netlist</span> : <>{activePath !== data.main && activePath.endsWith(".ino") && !activePath.includes("/") && <button className="ghost small" disabled={!!busy} onClick={() => setTarget({ main: activePath }, "Set main sketch")}>Set as main</button>}<button className="ghost small" disabled={!!busy || activePath === data.main} onClick={async () => { if (!Object.hasOwn(data.files, activePath) || await run([{ type: "firmware.file.remove", args: { doc: doc.id, path: activePath } }], `Remove ${activePath}`)) { if (!mounted.current) return; const next = { ...draftRef.current }; delete next[activePath]; keepDrafts(next); setPath(data.main) } }}>Remove file</button></>}</div>
        <SourceEditor ref={source} scope={storageKey} path={activePath} value={content} readOnly={generated} diagnostics={changedSinceBuild ? [] : diagnostics} onChange={edit} onSave={() => { void perform("save") }} />
        <section className="firmware-output" aria-live="polite">
          <div className="firmware-output-head"><h2>Build & serial</h2>{build && <span className={build.ok ? "firmware-success" : "electronics-error"}>{build.ok ? `Build succeeded${build.cached ? " · cached" : ""}` : "Build failed"}</span>}{build?.size && <span className="muted small">Flash {build.size.flash.toLocaleString()} B · RAM {build.size.ram.toLocaleString()} B</span>}{build?.artifacts.map((url) => <a className="firmware-artifact" key={url} href={url} download>{url.split("/").pop()}</a>)}</div>
          {restored && !!dirty.length && <p className="muted">Restored local source drafts from this browser.</p>}
          {dirty.some(([file]) => !Object.hasOwn(data.files, file)) && <p className="muted">A local draft's file was removed from the project. Save recreates it with your recovered source.</p>}
          {!!conflicting.length && <p className="electronics-error">The project source also changed. Your local draft is kept; Save replaces the project file.</p>}
          {changedSinceBuild && <p className="muted">Sources or target settings changed since this build. Build again to compile the current editor contents.</p>}
          {busy && <p className="muted">{busy === "save" ? "Saving project sources…" : "Preparing the pinned toolchain and compiling. The first build downloads Arduino and the selected pinned core and can take several minutes."}</p>}
          {error && <p className="electronics-error">{error}</p>}
          {diagnostics.map((d, i) => <button key={i} className={`firmware-diagnostic ${d.severity === "error" ? "electronics-error" : ""}`} onClick={() => jump(d)}><span className="mono">{d.file || "build"}:{d.line}:{d.col}</span> {d.severity}: {d.message}</button>)}
          {build && !build.ok && !diagnostics.length && <p className="electronics-error">Compilation failed without structured diagnostics. Check the server output for toolchain details.</p>}
          {result?.warnings?.map((warning) => <p className="muted small" key={warning}>{warning}</p>)}
          {result?.complete === false && <p className="electronics-error">Execution stopped before the requested duration. Serial output and GPIO below are the captured partial result.</p>}
          {result?.ok && <><p className="muted small">Ran {result.simulatedMs} ms simulated in {result.wallMs} ms</p>{Object.entries(result.serial ?? {}).map(([port, text]) => <div key={port}><p className="muted small">{port}</p><pre>{text}</pre></div>)}{!Object.values(result.serial ?? {}).some(Boolean) && <p className="muted">No serial output. For USB serial, call Serial.begin and wait for Serial before printing.</p>}{!!Object.keys(result.gpio ?? {}).length && <div className="firmware-gpio">{Object.entries(result.gpio ?? {}).map(([pin, s]) => <span className="mono" key={pin}>{pin}{s.net ? ` (${s.net})` : ""}: {s.state} · {s.function} · {s.edges} edges</span>)}</div>}</>}
          {!build && !busy && !error && <p className="muted">Build the sketch to see compiler diagnostics and download firmware artifacts. Run it to inspect serial output and GPIO states.</p>}
          <SerialPanel platform={data.platform ?? "rp2040"} board={data.board} image={build?.artifacts.find((url) => url.endsWith("/firmware.merged.bin"))} uf2={build?.artifacts.find((url) => url.endsWith("/firmware.uf2"))} currentBuild={!!build?.ok && !!builtSignature && !changedSinceBuild && !dirty.length} />
        </section>
      </section>
    </div>
  </div>
}
