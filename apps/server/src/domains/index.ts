import type { Domain } from "../domain"
import { firmware } from "./firmware"
import { sim } from "./sim"

/** Every workstream adds one line here. */
export const domains: Domain[] = [sim, firmware]
