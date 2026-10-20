import { createRoot } from "react-dom/client"
import "./styles.css"
import "./theme"
import "./actions"
import "./cad-registration"
import "./simulationRegistration"
import "./electronics"
import "./deviceRegistration"
import "./pcb-registration"
import "./assembly-registration"
import { App } from "./ui/App"

createRoot(document.getElementById("root")!).render(<App />)
