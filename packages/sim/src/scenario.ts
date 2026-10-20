import { CommandError, type Project } from "@m4k3r/core"
import { z } from "zod"
import { createSession } from "./session"
import type { SimInput } from "./model"

export const ScenarioCheck = z.object({
  t: z.number().nonnegative(), probe: z.string().min(1),
  min: z.number().optional(), max: z.number().optional(), equals: z.number().optional(), tolerance: z.number().nonnegative().default(1e-6),
}).refine((check) => check.min !== undefined || check.max !== undefined || check.equals !== undefined, "Provide min, max or equals")
export type ScenarioCheck = z.infer<typeof ScenarioCheck>
export interface ScenarioResult { passed: boolean; t: number; checks: { t: number; actualTime: number; probe: string; value: number; passed: boolean; expected: string }[]; warnings: string[] }

/** Deterministic headless assertions over the same analog session used by the UI. */
export function runScenario(project: Project, options: { duration: number; step?: number; inputs?: SimInput[]; checks: ScenarioCheck[] }): ScenarioResult {
  const session = createSession(project, { step: options.step })
  if (!Number.isFinite(options.duration) || options.duration <= 0 || options.duration / session.step > 1e7) throw new CommandError("Scenario needs a positive duration of at most 10 million steps")
  for (const event of options.inputs ?? []) session.input(event)
  const results: ScenarioResult["checks"] = []
  for (const check of [...options.checks].sort((a, b) => a.t - b.t)) {
    if (check.t > options.duration) throw new CommandError(`Check at ${check.t}s is after the scenario duration`)
    const probe = session.probe(check.probe)
    const target = Math.ceil(check.t / session.step - 1e-9) * session.step
    session.advance(Math.max(0, target - session.t))
    const value = probe.read(), tolerance = check.tolerance
    const passed = Number.isFinite(value) && (check.min === undefined || value >= check.min - tolerance) && (check.max === undefined || value <= check.max + tolerance) && (check.equals === undefined || Math.abs(value - check.equals) <= tolerance)
    const expected = [check.min === undefined ? "" : `≥ ${check.min}`, check.max === undefined ? "" : `≤ ${check.max}`, check.equals === undefined ? "" : `= ${check.equals} ± ${tolerance}`].filter(Boolean).join(" and ")
    results.push({ t: check.t, actualTime: session.t, probe: probe.name, value, passed, expected })
  }
  session.advance(Math.max(0, options.duration - session.t))
  return { passed: results.every((check) => check.passed), t: session.t, checks: results, warnings: [...session.warnings, ...(!results.length ? ["No scenario assertions are configured"] : [])] }
}
