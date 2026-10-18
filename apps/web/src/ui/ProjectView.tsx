import type { Project } from "@m4k3r/core"
import { commandsStep } from "../actions"
import { docView, formatKeys } from "../registry"
import { openPalette, openTab, redo, run, undo, useApp } from "../store"
import { Editable } from "./Editable"
import { Wiring } from "./Wiring"

export function ProjectView({ tab }: { tab: string }) {
  const project = useApp((s) => s.project)
  const live = useApp((s) => s.live)
  if (!project) return <div className="loading" />

  const doc = project.docs.find((d) => d.id === tab)
  const current = doc ? doc.id : "wiring"

  return (
    <div className="project">
      <header className="topbar">
        <a className="brand" href="#/" title="All projects">
          M4K3R
        </a>
        <span className="slash">/</span>
        <Editable
          className="title"
          value={project.name}
          onCommit={(name) => name && run([{ type: "project.rename", args: { name } }], `Rename project to ${name}`)}
        />
        <span className="spacer" />
        {!live && <span className="offline">Reconnecting…</span>}
        <button className="ghost icon" title={`Undo (${formatKeys("mod+z")})`} onClick={undo}>
          <svg viewBox="0 0 16 16"><path d="M6 4 3 7l3 3M3.5 7H10a3 3 0 0 1 0 6H8" /></svg>
        </button>
        <button className="ghost icon" title={`Redo (${formatKeys("mod+shift+z")})`} onClick={redo}>
          <svg viewBox="0 0 16 16"><path d="m10 4 3 3-3 3M12.5 7H6a3 3 0 0 0 0 6h2" /></svg>
        </button>
        <button className="kbd" onClick={() => openPalette(commandsStep())}>
          {formatKeys("mod+k")}
        </button>
      </header>

      <main className="doc">{doc ? <DocView project={project} docId={doc.id} /> : <Wiring project={project} />}</main>

      <nav className="tabs">
        {[{ id: "wiring", name: "Wiring" }, ...project.docs].map((d) => (
          <button key={d.id} className="tab" data-active={d.id === current || undefined} onClick={() => openTab(d.id)}>
            {d.name}
          </button>
        ))}
      </nav>
    </div>
  )
}

function DocView({ project, docId }: { project: Project; docId: string }) {
  const doc = project.docs.find((d) => d.id === docId)!
  const View = docView(doc.kind)
  if (View) return <View project={project} doc={doc} />
  return (
    <div className="empty">
      <p className="empty-title">{doc.name}</p>
      <p>There's no view for {doc.kind} docs yet.</p>
    </div>
  )
}
