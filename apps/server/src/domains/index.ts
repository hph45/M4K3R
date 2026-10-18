import type { Domain } from "../domain"
import { firmware } from "./firmware"
import { parts } from "./parts"
import { sim } from "./sim"

/** Every workstream adds one line here. */
export const domains: Domain[] = [parts, sim, firmware]
