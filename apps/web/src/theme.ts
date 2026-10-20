// Follows the system theme until the user picks one; the pick is remembered.

const KEY = "m4k3r.theme"
const media = matchMedia("(prefers-color-scheme: dark)")

function saved() {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

function apply(theme: string | null) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme
  else delete document.documentElement.dataset.theme
}

export function toggleTheme() {
  const current = document.documentElement.dataset.theme ?? (media.matches ? "dark" : "light")
  const next = current === "dark" ? "light" : "dark"
  apply(next)
  try {
    localStorage.setItem(KEY, next)
  } catch {}
}

apply(saved())
