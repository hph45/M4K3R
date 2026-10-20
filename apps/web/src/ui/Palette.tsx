import { useEffect, useRef, useState, type KeyboardEvent } from "react"
import { closePalette, useApp, type PaletteItem } from "../store"

export function Palette() {
  const step = useApp((s) => s.palette)
  const [query, setQuery] = useState("")
  const [items, setItems] = useState<PaletteItem[] | null>(null)
  const [active, setActive] = useState(0)
  const list = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setQuery(step?.initial ?? "")
    setItems(null)
  }, [step])

  useEffect(() => {
    if (!step?.items) return
    let current = true
    Promise.resolve(step.items(query)).then((found) => {
      if (!current) return
      setItems(found)
      setActive(0)
    })
    return () => {
      current = false
    }
  }, [step, query])

  useEffect(() => { list.current?.children[active]?.scrollIntoView({ block: "nearest" }) }, [active])

  if (!step) return null

  const choose = (item?: PaletteItem) => {
    closePalette()
    if (item) item.run()
    else if (!step.items) step.submit?.(query)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault()
      const n = items?.length ?? 0
      if (n) setActive((active + (e.key === "ArrowDown" ? 1 : n - 1)) % n)
    } else if (e.key === "Enter") {
      e.preventDefault()
      if (!step.items || items?.[active]) choose(items?.[active])
    } else if (e.key === "Escape") {
      e.stopPropagation()
      closePalette()
    }
  }

  return (
    <div className="overlay" onMouseDown={closePalette}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={query}
          placeholder={step.placeholder}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
        />
        {step.items && (
          <div className="palette-list" ref={list}>
            {items?.map((item, i) => (
              <div
                key={item.id}
                className="palette-item"
                data-active={i === active || undefined}
                onMouseMove={() => setActive(i)}
                onClick={() => choose(item)}
              >
                <span>{item.title}</span>
                {item.hint && <span className="hint">{item.hint}</span>}
              </div>
            ))}
            {items?.length === 0 && <div className="palette-empty">No matches</div>}
          </div>
        )}
      </div>
    </div>
  )
}
