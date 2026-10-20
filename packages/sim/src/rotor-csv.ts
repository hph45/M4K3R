/** Numeric CSV interchange. Units are SI; throttle is a fraction, never an implicit percent. */
export function parseRotorCsv(text: string) {
  const rows = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter((line) => line.trim() && !line.trim().startsWith("#"))
  if (rows.length < 3) throw new Error("CSV needs a header and at least two performance points")
  const cells = (line: string) => line.split(",").map((cell) => cell.trim().replace(/^"|"$/g, ""))
  const header = cells(rows.shift()!).map((cell) => cell.toLowerCase().replace(/[^a-z]/g, ""))
  const find = (...names: string[]) => header.findIndex((column) => names.includes(column))
  const indices = { throttle: find("throttle"), thrust: find("thrust", "thrustn"), current: find("current", "currenta"), rpm: find("rpm"), torque: find("torque", "torquenm") }
  if (indices.throttle < 0 || indices.thrust < 0 || indices.current < 0) throw new Error("CSV columns must include throttle, thrust_N and current_A; optional rpm and torque_Nm")
  return rows.map((row, index) => {
    const values = cells(row)
    const number = (column: number, name: string) => {
      const text = values[column]
      if (text === undefined || text === "" || !Number.isFinite(Number(text))) throw new Error(`CSV row ${index + 2}: ${name} must be numeric`)
      return Number(text)
    }
    const throttle = number(indices.throttle, "throttle"), thrust = number(indices.thrust, "thrust_N"), current = number(indices.current, "current_A")
    if (throttle < 0 || throttle > 1 || thrust < 0 || current < 0) throw new Error(`CSV row ${index + 2}: throttle must be 0…1 and thrust/current nonnegative`)
    return { throttle, thrust, current, ...(indices.rpm >= 0 ? { rpm: number(indices.rpm, "rpm") } : {}), ...(indices.torque >= 0 ? { torque: number(indices.torque, "torque_Nm") } : {}) }
  })
}
