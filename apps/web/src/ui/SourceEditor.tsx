import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import type * as Monaco from "monaco-editor/editor/editor.api"

export interface SourceDiagnostic { file: string; line: number; col: number; severity: "error" | "warning"; message: string }
export interface SourceEditorHandle { reveal(path: string, line: number, col: number): void }
interface Props {
  scope: string
  path: string
  value: string
  readOnly?: boolean
  diagnostics: SourceDiagnostic[]
  onChange(value: string): void
  onSave(): void
}

let loader: Promise<typeof Monaco> | undefined
function loadEditor() {
  return loader ??= Promise.all([
    import("monaco-editor/editor/editor.api"),
    import("monaco-editor/languages/definitions/cpp/register"),
    import("monaco-editor/editor/editor.worker?worker"),
    import("monaco-editor/features/register.all"),
  ]).then(([monaco, , worker]) => {
    self.MonacoEnvironment = { getWorker: () => new worker.default() }
    return monaco
  })
}

const modeKey = "m4k3r.firmware.editor"
const readMode = () => { try { return localStorage.getItem(modeKey) === "plain" } catch { return false } }
const matchesFile = (diagnostic: string, path: string) => diagnostic.replaceAll("\\", "/").replace(/^\.\//, "") === path || diagnostic.replaceAll("\\", "/").endsWith(`/${path}`)

/** Models live for the document lifetime, retaining per-file undo and cursor positions. */
export const SourceEditor = forwardRef<SourceEditorHandle, Props>(function SourceEditor(props, ref) {
  const current = useRef(props)
  current.current = props
  const [plain, setPlain] = useState(readMode)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState("")
  const host = useRef<HTMLDivElement>(null)
  const textarea = useRef<HTMLTextAreaElement>(null)
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const api = useRef<typeof Monaco | null>(null)
  const models = useRef(new Map<string, Monaco.editor.ITextModel>())
  const views = useRef(new Map<string, Monaco.editor.ICodeEditorViewState>())
  const active = useRef("")
  const updating = useRef(false)
  const jump = useRef<{ path: string; line: number; col: number } | null>(null)

  function revealPending() {
    const target = jump.current
    if (!target || target.path !== current.current.path) return
    if (plain && textarea.current) {
      const rows = current.current.value.split("\n")
      const line = Math.max(1, Math.min(target.line, rows.length))
      const col = Math.max(1, Math.min(target.col, (rows[line - 1]?.length ?? 0) + 1))
      const offset = rows.slice(0, line - 1).reduce((sum, row) => sum + row.length + 1, 0) + col - 1
      textarea.current.focus()
      textarea.current.setSelectionRange(offset, offset)
      textarea.current.scrollTop = Math.max(0, line - 5) * 21
      jump.current = null
    } else if (!plain && editor.current?.getModel() && active.current === target.path) {
      const position = editor.current.getModel()!.validatePosition({ lineNumber: Math.max(1, target.line), column: Math.max(1, target.col) })
      editor.current.setPosition(position)
      editor.current.revealPositionInCenter(position)
      editor.current.focus()
      jump.current = null
    }
  }
  useImperativeHandle(ref, () => ({ reveal(path, line, col) { jump.current = { path, line, col }; revealPending() } }))

  function sync() {
    if (!api.current || !editor.current) return
    const monaco = api.current, p = current.current
    if (active.current && active.current !== p.path) {
      const state = editor.current.saveViewState()
      if (state) views.current.set(active.current, state)
    }
    let model = models.current.get(p.path)
    if (!model) {
      model = monaco.editor.createModel(p.value, "cpp", monaco.Uri.parse(`inmemory://m4k3r/${encodeURIComponent(p.scope)}/${p.path.split("/").map(encodeURIComponent).join("/")}`))
      models.current.set(p.path, model)
    }
    updating.current = true
    if (model.getValue() !== p.value) model.setValue(p.value)
    if (editor.current.getModel() !== model) {
      editor.current.setModel(model)
      const state = views.current.get(p.path)
      if (state) editor.current.restoreViewState(state)
    }
    active.current = p.path
    editor.current.updateOptions({ readOnly: p.readOnly, ariaLabel: `${p.path} C++ editor` })
    updating.current = false
    for (const [path, source] of models.current) {
      const markers = p.diagnostics.filter((d) => d.line > 0 && matchesFile(d.file, path)).map((d) => {
        const line = Math.max(1, Math.min(d.line, source.getLineCount()))
        const col = Math.max(1, Math.min(d.col || 1, source.getLineMaxColumn(line)))
        return { severity: d.severity === "error" ? monaco.MarkerSeverity.Error : monaco.MarkerSeverity.Warning, message: d.message, startLineNumber: line, endLineNumber: line, startColumn: col, endColumn: Math.min(source.getLineMaxColumn(line), col + 1) }
      })
      monaco.editor.setModelMarkers(source, "m4k3r-compiler", markers)
    }
    revealPending()
  }

  useEffect(() => {
    if (plain) return
    let alive = true
    let subscriptions: Monaco.IDisposable[] = []
    const media = matchMedia("(prefers-color-scheme: dark)")
    const theme = () => api.current?.editor.setTheme(media.matches ? "vs-dark" : "vs")
    setReady(false)
    loadEditor().then((monaco) => {
      if (!alive || !host.current) return
      api.current = monaco
      const instance = monaco.editor.create(host.current, { model: null, theme: media.matches ? "vs-dark" : "vs", automaticLayout: true, fontSize: 13, lineHeight: 21, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 2, insertSpaces: true, fixedOverflowWidgets: true, accessibilitySupport: "auto", renderValidationDecorations: "on", padding: { top: 14, bottom: 14 } })
      editor.current = instance
      subscriptions = [instance.onDidChangeModelContent(() => { if (!updating.current && !current.current.readOnly) current.current.onChange(instance.getValue()) }), instance.addAction({ id: "m4k3r.save", label: "Save project sources", keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS], run: () => current.current.onSave() })]
      media.addEventListener("change", theme)
      sync()
      setReady(true)
    }).catch((e) => { if (alive) { setError(`C++ editor could not load: ${e instanceof Error ? e.message : String(e)}`); setPlain(true) } })
    return () => {
      alive = false
      media.removeEventListener("change", theme)
      const state = editor.current?.saveViewState()
      if (state && active.current) views.current.set(active.current, state)
      subscriptions.forEach((s) => s.dispose())
      editor.current?.dispose()
      editor.current = null
    }
  }, [plain])

  useEffect(() => { sync(); revealPending() }, [props.path, props.value, props.readOnly, props.diagnostics, ready, plain])
  useEffect(() => () => { for (const model of models.current.values()) model.dispose(); models.current.clear() }, [])

  function changeMode(next: boolean) { setPlain(next); try { localStorage.setItem(modeKey, next ? "plain" : "monaco") } catch { /* Editing remains available without preferences storage. */ } }
  return <div className="firmware-editor-shell" data-editor-mode={plain ? "plain" : "monaco"}>
    <div className="firmware-editor-mode"><span className="muted small">{plain ? "Plain text" : "C++ · compiler diagnostics"}{props.readOnly ? " · read only" : ""}</span><button className="ghost small" onClick={() => changeMode(!plain)}>{plain ? "C++ editor" : "Plain text"}</button></div>
    {error && <p className="electronics-error small">{error}</p>}
    {plain ? <textarea ref={textarea} className="firmware-source mono" aria-label={`${props.path} source code`} value={props.value} spellCheck={false} autoCapitalize="off" autoCorrect="off" readOnly={props.readOnly} onChange={(e) => props.onChange(e.target.value)} onKeyDown={(e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "s") { e.preventDefault(); props.onSave() }
      if (e.key === "Tab" && !props.readOnly) {
        e.preventDefault()
        const start = e.currentTarget.selectionStart, end = e.currentTarget.selectionEnd
        props.onChange(`${props.value.slice(0, start)}  ${props.value.slice(end)}`)
        requestAnimationFrame(() => textarea.current?.setSelectionRange(start + 2, start + 2))
      }
    }} /> : <div className="firmware-monaco" ref={host} data-testid="firmware-code-editor">{!ready && <span className="muted">Loading C++ editor…</span>}</div>}
  </div>
})
