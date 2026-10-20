export * from "./schema"
export * from "./lookup"
export * from "./commands"
export * from "./netlist"
export * from "./units"
export * from "./expr"

/** Short random id with a type prefix, e.g. c_k3j9x2mq. */
export function newId(prefix: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8))
  return `${prefix}_${Array.from(bytes, (b) => (b % 36).toString(36)).join("")}`
}
