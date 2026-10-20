import { expect, it } from "vitest"
import { parseRotorCsv } from "./rotor-csv"
it("imports source-unit CSV and rejects silent percentages or missing measurements", () => {
  expect(parseRotorCsv("throttle,thrust_N,current_A,rpm,torque_Nm\n0,0,0,0,0\n1,3.2,4,18000,.02")[1]).toEqual({ throttle: 1, thrust: 3.2, current: 4, rpm: 18000, torque: 0.02 })
  expect(() => parseRotorCsv("throttle,thrust,current\n0,0,0\n100,3,4")).toThrow(/0…1/)
  expect(() => parseRotorCsv("throttle,thrust,current\n0,0,0\n1,,4")).toThrow(/numeric/)
})
