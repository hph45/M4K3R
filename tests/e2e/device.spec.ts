import { expect, test } from "@playwright/test"

test("drone assembly mass, sourced thrust estimates and payload edits stay linked", async ({ page }, testInfo) => {
  test.setTimeout(120000)
  const errors: string[] = []; page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  const created = page.waitForResponse((response) => response.url().endsWith("/api/demo/drone") && response.request().method() === "POST")
  await page.getByRole("button", { name: "Plan a drone", exact: true }).click()
  const project = await (await created).json()
  await expect(page.locator(".assembly-mass")).toContainText("Mass")
  await expect(page.locator(".assembly-mass dd").first()).toContainText(/\d+.*g/, { timeout: 30000 })
  await expect(page.locator(".cad-viewport canvas")).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath("drone-assembly.png") })
  await page.getByRole("button", { name: "Flight estimates", exact: true }).click()
  await expect(page.getByRole("combobox", { name: "Analysis assembly" }).locator("option:checked")).toHaveText("Drone assembly")
  // Analysis runs on open; no button press needed.
  const mass = page.locator(".device-analysis-stats > div").filter({ hasText: "Total mass" }).locator("strong")
  await expect(mass).toContainText(/\d+.*g/, { timeout: 30000 })
  const initialMass = parseFloat(await mass.innerText())
  expect(initialMass).toBeGreaterThan(200)
  await expect(page.locator(".device-analysis-stats > div").filter({ hasText: "Total mass" })).toContainText("g assembly + 15 g payload")
  await expect(page.locator(".device-analysis-stats > div").filter({ hasText: "Maximum usable thrust" })).toContainText(/\d+ g.*N at \d+ %/s)
  await expect(page.locator(".device-analysis-results")).toContainText("Illustrative generic coefficients")
  await expect(page.locator(".device-analysis-results")).toContainText(/\d+ parts use estimated mass/)
  await expect(page.locator(".device-analysis-results table").first().locator("tbody tr")).toHaveCount(4)
  await expect(page.locator(".device-rotor-form summary").first()).toContainText("M1 · P1 · 127 mm · CW · From parts")
  // A finished edit saves as an undoable command and the analysis refreshes.
  const payload = page.getByRole("spinbutton", { name: "Additional payload and wiring (g)", exact: true })
  const initialPayload = Number(await payload.inputValue())
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${project.id}/commands`) && response.request().method() === "POST")
  await payload.fill(String(initialPayload + 50)); await payload.press("Enter"); await saved
  await expect.poll(async () => parseFloat(await mass.innerText())).toBeGreaterThan(initialMass + 49)
  await page.getByTitle(/^Undo Set payload mass/).click()
  await expect.poll(async () => parseFloat(await mass.innerText())).toBeCloseTo(initialMass, 1)
  await expect(page.locator(".device-analysis-results")).toContainText("Residual moment")
  await expect(page.locator(".flight-preview")).toContainText("firmware is not executed")
  await page.getByRole("spinbutton", { name: "Preview duration (s)", exact: true }).fill("0.2")
  await page.getByRole("slider", { name: "Preview collective throttle", exact: true }).focus()
  await page.getByRole("slider", { name: "Preview collective throttle", exact: true }).press("Home")
  await page.getByRole("button", { name: "Run rigid-body preview", exact: true }).click()
  await expect(page.locator("[data-flight-status]")).toContainText("Preview complete")
  await expect(page.locator("[data-flight-rotor]")).toHaveCount(4)
  await page.getByRole("button", { name: "Full path", exact: true }).click()
  await expect(page.getByRole("button", { name: "Full path", exact: true })).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "Follow aircraft", exact: true }).click()
  await expect(page.getByLabel("Attitude over time")).toBeVisible()
  const altitude = parseFloat(await page.locator("[data-flight-altitude]").innerText())
  expect(altitude).toBeGreaterThan(0.7); expect(altitude).toBeLessThan(0.9)
  await page.locator(".flight-scene").scrollIntoViewIfNeeded()
  await page.screenshot({ path: testInfo.outputPath("drone-feasibility.png") })
  expect(errors).toEqual([])
})

test("scenario UI saves timed probe bounds and reports real pass/fail", async ({ page, request }) => {
  const project = await (await request.post("/api/demo")).json()
  const simulation = project.docs.find((doc: { kind: string }) => doc.kind === "simulation")
  const setup = await request.post(`/api/projects/${project.id}/commands`, { data: { commands: [{ type: "sim.update", args: { doc: simulation.id, duration: 0.03, inputs: [{ t: 0.005, ref: "SW1", action: "press" }] } }] } })
  expect(setup.ok(), await setup.text()).toBe(true)
  await page.goto(`/#/p/${project.id}/${simulation.id}`)
  await page.locator(".sim-scenario summary").click()
  const assertions = page.getByRole("textbox", { name: "Scenario assertions JSON" })
  await assertions.fill(JSON.stringify([{ t: 0.025, probe: "D1.brightness", min: 0.3 }]))
  await page.getByRole("button", { name: "Save assertions", exact: true }).click()
  await expect(page.locator(".sim-scenario summary")).toContainText("1 checks")
  if (!(await assertions.isVisible())) await page.locator(".sim-scenario summary").click()
  await page.getByRole("button", { name: "Run saved scenario", exact: true }).click()
  await expect(page.locator("[data-scenario-passed]")).toHaveText("Scenario passed")
  await assertions.fill(JSON.stringify([{ t: 0.025, probe: "D1.brightness", max: 0.001 }]))
  await page.getByRole("button", { name: "Save assertions", exact: true }).click()
  await expect(page.locator(".sim-scenario summary")).toContainText("1 checks")
  await expect.poll(async () => JSON.parse(await assertions.inputValue())[0].max).toBe(0.001)
  if (!(await assertions.isVisible())) await page.locator(".sim-scenario summary").click()
  await page.getByRole("button", { name: "Run saved scenario", exact: true }).click()
  await expect(page.locator("[data-scenario-passed]")).toHaveText("Scenario failed")
})

test("real compiled Pico output lights the LED on the circuit diagram", async ({ page, request }) => {
  test.skip(process.env.M4K3R_FIRMWARE_E2E !== "1", "Requires the installed Arduino toolchain in the test server home")
  test.setTimeout(600000)
  const project = await (await request.post("/api/projects", { data: { name: "Real coupled LED" } })).json()
  const setup = await request.post(`/api/projects/${project.id}/commands`, { data: { commands: [
    { type: "component.add", args: { part: "raspberry-pi-pico", ref: "U1" } },
    { type: "component.add", args: { part: "resistor", ref: "R1", props: { value: "150" } } },
    { type: "component.add", args: { part: "led", ref: "D1" } },
    { type: "net.connect", args: { pins: ["U1.GPIO15", "R1.1"], name: "OUT" } },
    { type: "net.connect", args: { pins: ["R1.2", "D1.A"], name: "LED" } },
    { type: "net.connect", args: { pins: ["D1.K", "U1.3"], name: "GND" } },
    { type: "doc.create", args: { kind: "schematic", name: "Coupled circuit" } },
    { type: "schematic.autoplace", args: { doc: "Coupled circuit" } },
    { type: "doc.create", args: { kind: "firmware", name: "Actual LED firmware", data: { mcu: "U1", files: { "main.ino": "void setup(){pinMode(15,OUTPUT);digitalWrite(15,HIGH);}\nvoid loop(){delay(1);}" } } } },
  ] } })
  expect(setup.ok(), await setup.text()).toBe(true)
  const current = await (await request.get(`/api/projects/${project.id}`)).json()
  const firmware = current.docs.find((doc: { kind: string }) => doc.kind === "firmware")
  await page.goto(`/#/p/${project.id}/wiring`)
  await page.locator(".schematic-coupled summary").click()
  await page.getByRole("combobox", { name: "Circuit firmware target" }).selectOption(firmware.id)
  await page.getByRole("button", { name: "Run firmware + circuit", exact: true }).click()
  await expect.poll(async () => Number(await page.locator('[data-led-state-ref="D1"]').getAttribute("data-brightness")), { timeout: 600000 }).toBeGreaterThan(0.2)
  await expect(page.locator(".schematic-coupled")).toContainText("Coupled 100 ms snapshot")
})
