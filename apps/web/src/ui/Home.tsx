import { useState } from "react"
import { commandsStep } from "../actions"
import { formatKeys } from "../registry"
import { createProject, deleteProject, navigate, openPalette, useApp } from "../store"

export function Home() {
  const projects = useApp((s) => s.projects)
  const [name, setName] = useState("")
  const [confirming, setConfirming] = useState<string | null>(null)

  return (
    <div className="home">
      <header className="home-head">
        <span className="brand">M4K3R</span>
        <span className="spacer" />
        <button className="kbd" onClick={() => openPalette(commandsStep())}>
          {formatKeys("mod+k")}
        </button>
      </header>

      <form
        className="new-project"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) createProject(name.trim())
        }}
      >
        <input value={name} placeholder="Name a new project…" onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={!name.trim()}>
          Create
        </button>
      </form>

      <div className="project-list">
        {projects?.map((p) => (
          <div
            key={p.id}
            className="row project-row"
            onClick={() => navigate({ page: "project", id: p.id, tab: "wiring" })}
          >
            <span className="name">{p.name}</span>
            <span className="muted small">
              {p.components} components · {p.nets} nets
            </span>
            <span className="spacer" />
            <span onClick={(e) => e.stopPropagation()}>
              {confirming === p.id ? (
                <span className="confirm">
                  <span className="muted small">Delete for good?</span>
                  <button className="danger small" onClick={() => deleteProject(p.id)}>
                    Delete
                  </button>
                  <button className="ghost small" onClick={() => setConfirming(null)}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button className="ghost small reveal" onClick={() => setConfirming(p.id)}>
                  Delete
                </button>
              )}
            </span>
          </div>
        ))}
        {projects?.length === 0 && <p className="muted hint-row">No projects yet. Name one above to start.</p>}
      </div>
    </div>
  )
}
