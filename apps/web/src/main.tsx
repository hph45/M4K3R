import { createRoot } from "react-dom/client"
import "./styles.css"
import "./theme"
import "./actions"
import { App } from "./ui/App"

createRoot(document.getElementById("root")!).render(<App />)
