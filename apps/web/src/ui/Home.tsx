import { useState } from "react"
import { commandsStep } from "../actions"
import { formatKeys } from "../registry"
import { createDemo, createDrone, createProject, deleteProject, navigate, openPalette, useApp } from "../store"

export function Home() {
  const projects = useApp((s) => s.projects)
  const [name, setName] = useState("")
  const [confirming, setConfirming] = useState<string | null>(null)
  const [creatingDemo, setCreatingDemo] = useState(false)
  const [creatingDrone, setCreatingDrone] = useState(false)

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

      <div className="starter">
        <div><strong>Make something.</strong><p className="muted">Start with a button, an LED, a motor and an enclosure. Explore the circuit, run it, and change the design.</p></div>
        <button disabled={creatingDemo} onClick={async () => {
          setCreatingDemo(true)
          try { await createDemo() } finally { setCreatingDemo(false) }
        }}>{creatingDemo ? "Creating…" : "Try a demo"}</button>
      </div>

      <div className="starter">
        <div><strong>Plan a complete device.</strong><p className="muted">Explore an ESP32 drone with an editable frame and holder, motors, wiring, a power PCB, firmware, and estimated weight and thrust.</p></div>
        <button disabled={creatingDrone} onClick={async () => {
          setCreatingDrone(true)
          try { await createDrone() } finally { setCreatingDrone(false) }
        }}>{creatingDrone ? "Creating…" : "Plan a drone"}</button>
      </div>

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
