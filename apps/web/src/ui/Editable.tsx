import { useState } from "react"

/** Text that turns into an input on click. Enter or blur commits, Esc cancels. */
export function Editable(props: { value: string; onCommit(value: string): void; placeholder?: string; className?: string }) {
  const { value, placeholder, className = "" } = props
  const [editing, setEditing] = useState(false)

  if (!editing) {
    return (
      <span
        className={`editable ${className}`}
        data-empty={!value || undefined}
        tabIndex={0}
        onClick={() => setEditing(true)}
        onKeyDown={(e) => e.key === "Enter" && setEditing(true)}
      >
        {value || placeholder}
      </span>
    )
  }

  return (
    <input
      autoFocus
      className={`editable ${className}`}
      defaultValue={value}
      placeholder={placeholder}
      spellCheck={false}
      onFocus={(e) => e.target.select()}
      onClick={(e) => e.stopPropagation()}
      onBlur={(e) => {
        setEditing(false)
        const next = e.target.value.trim()
        if (next !== value) props.onCommit(next)
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur()
        if (e.key === "Escape") {
          e.stopPropagation()
          e.currentTarget.value = value
          e.currentTarget.blur()
        }
      }}
    />
  )
}
