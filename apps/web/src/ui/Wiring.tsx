import type { Component, Project } from "@m4k3r/core"
import { useMemo, useState } from "react"
import { addComponent, connect, disconnect, pinLabel, renameNet } from "../actions"
import { formatKeys } from "../registry"
import { clearPins, clearSelection, run, selectComponent, togglePin, useApp } from "../store"
import { Editable } from "./Editable"

const byRef = (a: Component, b: Component) => a.ref.localeCompare(b.ref, undefined, { numeric: true })

function wiring(project: Project) {
  const components = [...project.components].sort(byRef)
  const wired = new Set(project.nets.flatMap((n) => n.pins.map((r) => `${r.component}/${r.pin}`)))
  const nets = [...project.nets]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    .map((net) => ({
      net,
      pins: net.pins.map((r) => {
        const key = `${r.component}/${r.pin}`
        return { id: key, component: r.component, label: pinLabel(project, key) ?? key }
      }),
    }))
  const unconnected = components
    .map((c) => ({
      c,
      pins: (project.parts[c.part]?.pins ?? [])
        .filter((pin) => pin.type !== "nc" && !wired.has(`${c.id}/${pin.num}`))
        .map((pin) => ({ id: `${c.id}/${pin.num}`, component: c.id, label: pin.name })),
    }))
    .filter((u) => u.pins.length)
  return { components, nets, unconnected, wired }
}

export function Wiring({ project }: { project: Project }) {
  const { components, nets, unconnected, wired } = useMemo(() => wiring(project), [project])
  const selected = useApp((s) => s.selection.component)

  if (!components.length) {
    return (
      <div className="empty">
        <p className="empty-title">No components yet</p>
        <p>Add parts, then connect their pins.</p>
        <button className="primary" onClick={addComponent}>
          Add component
        </button>
        <p className="muted small">or press {formatKeys("mod+k")}</p>
      </div>
    )
  }

  return (
    <div className="wiring" onClick={(e) => e.target === e.currentTarget && clearSelection()}>
      <section>
        <header className="section-head">
          <h2>Components</h2>
          <span className="count">{components.length}</span>
          <button className="ghost small" onClick={addComponent}>
            Add
          </button>
        </header>
        {components.map((c) => (
          <ComponentRow key={c.id} project={project} c={c} selected={c.id === selected} />
        ))}
      </section>

      <section>
        <header className="section-head">
          <h2>Nets</h2>
          <span className="count">{nets.length}</span>
        </header>
        {nets.map(({ net, pins }) => (
          <div key={net.id} className="row net" data-hl={pins.some((p) => p.component === selected) || undefined}>
            <Editable className="name mono" value={net.name} onCommit={(name) => renameNet(net, name)} />
            <div className="pins">
              {pins.map((p) => (
                <Pin key={p.id} {...p} />
              ))}
            </div>
          </div>
        ))}
        {!nets.length && <p className="muted hint-row">Select pins below, then Connect.</p>}

        <header className="section-head">
          <h2>Unconnected</h2>
          <span className="count">{unconnected.reduce((n, u) => n + u.pins.length, 0)}</span>
        </header>
        {unconnected.map(({ c, pins }) => (
          <div key={c.id} className="row net" data-hl={c.id === selected || undefined}>
            <span className="name mono">{c.ref}</span>
            <div className="pins">
              {pins.map((p) => (
                <Pin key={p.id} {...p} />
              ))}
            </div>
          </div>
        ))}
        {!unconnected.length && <p className="muted hint-row">Every pin is connected.</p>}
      </section>

      <SelectionBar project={project} wired={wired} />
    </div>
  )
}

function ComponentRow({ project, c, selected }: { project: Project; c: Component; selected: boolean }) {
  const update = (args: object, label: string) => run([{ type: "component.update", args: { component: c.id, ...args } }], label)
  const addProp = (text: string) => {
    const [, key, value] = text.match(/^([^=\s]+)\s*[=\s]\s*(.+)$/) ?? []
    if (key && value) update({ props: { [key]: value } }, `Set ${c.ref} ${key}`)
  }

  return (
    <div className="row component" data-selected={selected || undefined} onClick={() => selectComponent(c.id)}>
      <Editable className="ref mono" value={c.ref} onCommit={(ref) => ref && update({ ref }, `Rename ${c.ref} to ${ref}`)} />
      <span className="part">{project.parts[c.part]?.name ?? c.part}</span>
      <div className="props">
        {Object.entries(c.props).map(([key, value]) => (
          <span key={key} className="prop">
            <span className="muted">{key}</span>
            <Editable value={value} onCommit={(v) => update({ props: { [key]: v || null } }, `Set ${c.ref} ${key}`)} />
          </span>
        ))}
        <Editable className="add-prop" value="" placeholder="+ prop" onCommit={addProp} />
      </div>
      <button
        className="ghost icon remove"
        title={`Remove ${c.ref}`}
        onClick={(e) => {
          e.stopPropagation()
          run([{ type: "component.remove", args: { component: c.id } }], `Remove ${c.ref}`)
        }}
      >
        ×
      </button>
    </div>
  )
}

function Pin({ id, component, label }: { id: string; component: string; label: string }) {
  const picked = useApp((s) => s.selection.pins.includes(id))
  const hl = useApp((s) => s.selection.component === component)
  return (
    <button
      className="pin mono"
      data-picked={picked || undefined}
      data-hl={hl || undefined}
      onClick={(e) => {
        e.stopPropagation()
        togglePin(id)
      }}
    >
      {label}
    </button>
  )
}

function SelectionBar({ project, wired }: { project: Project; wired: Set<string> }) {
  const keys = useApp((s) => s.selection.pins)
  const [name, setName] = useState("")
  const pins = keys.flatMap((k) => pinLabel(project, k) ?? [])
  if (!pins.length) return null
  const canConnect = pins.length > 1 || !!name.trim()
  const done = () => setName("")

  return (
    <div className="selection-bar">
      <span className="mono">{pins.join("  ")}</span>
      <input
        value={name}
        placeholder="Net name (optional)"
        spellCheck={false}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && canConnect && connect(pins, name.trim()).then(done)}
      />
      <button className="primary" disabled={!canConnect} onClick={() => connect(pins, name.trim()).then(done)}>
        Connect
      </button>
      {keys.some((k) => wired.has(k)) && <button onClick={() => disconnect(pins)}>Disconnect</button>}
      <button className="ghost icon" title="Clear" onClick={clearPins}>
        ×
      </button>
    </div>
  )
}
