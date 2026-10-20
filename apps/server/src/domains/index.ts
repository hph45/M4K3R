import type { Domain } from "../domain"
import { cad } from "./cad"
import { firmware } from "./firmware"
import { parts } from "./parts"
import { schematic } from "./schematic"
import { sim } from "./sim"
import { device } from "./device"
import { pcb } from "./pcb"
import { coupled } from "./coupled"
import { assembly } from "./assembly"

/** Every workstream adds one line here. */
export const domains: Domain[] = [parts, schematic, cad, sim, firmware, device, pcb, coupled, assembly]
