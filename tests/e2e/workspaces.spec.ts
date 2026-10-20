import { expect, test } from "@playwright/test"

test("starter project works across schematic, live simulation, CAD and firmware", async ({ page }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (error) => errors.push(error.message))
  await page.goto("/")
  const created = page.waitForResponse((response) => response.url().endsWith("/api/demo") && response.request().method() === "POST")
  await page.getByRole("button", { name: "Try a demo" }).click()
  const project = await (await created).json()
  await expect(page.locator(".schematic-symbol")).toHaveCount(5)
  await page.screenshot({ path: testInfo.outputPath("schematic.png") })

  // Document creation exercises both palette navigation and cleanup between prompts.
  await page.getByRole("button", { name: "＋ New document" }).click()
  await page.getByText("New schematic…", { exact: true }).click()
  await page.getByPlaceholder("Schematic name").fill("Second sheet")
  await page.getByPlaceholder("Schematic name").press("Enter")
  await expect(page.getByRole("button", { name: "Second sheet", exact: true })).toBeVisible()
  await expect(page.locator(".schematic-symbol")).toHaveCount(5)
  await page.reload()
  await expect(page.locator(".schematic-symbol")).toHaveCount(5)

  await page.getByRole("button", { name: "Button lab", exact: true }).click()
  await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Run", exact: true }).click()
  await page.getByRole("button", { name: "Hold SW1", exact: true }).hover()
  await page.mouse.down()
  const led = page.locator(".sim-device").filter({ hasText: "D1" }).locator(".sim-led-state button")
  await expect.poll(async () => Number((await led.innerText()).replace("%", ""))).toBeGreaterThan(40)
  await expect(page.locator(".sim-trace polyline").first()).toHaveAttribute("points", /[\d.]+,[\d.]+ /)
  await page.screenshot({ path: testInfo.outputPath("simulation.png") })
  await page.mouse.up()
  await page.getByRole("button", { name: "Pause", exact: true }).click()
  await page.getByRole("button", { name: "Reset", exact: true }).click()
  await expect(page.locator(".sim-clock")).toHaveText("0s")
  await page.getByRole("button", { name: "Step", exact: true }).click()
  await expect(page.locator(".sim-clock")).not.toHaveText("0s")

  await page.getByRole("button", { name: "Enclosure", exact: true }).click()
  await expect(page.getByRole("button", { name: "Export STL", exact: true })).toBeEnabled()
  await expect(page.locator(".cad-material")).toContainText("65 × 45 × 20 mm")
  await page.screenshot({ path: testInfo.outputPath("cad.png") })
  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "Export STL", exact: true }).click()
  expect((await download).suggestedFilename()).toBe("Enclosure.stl")
  await page.locator(".cad-feature").filter({ hasText: "case" }).click()
  await page.getByLabel("Depth (mm)", { exact: true }).fill("25")
  await page.getByRole("button", { name: "Apply changes", exact: true }).click()
  await expect(page.locator(".cad-material")).toContainText("65 × 45 × 25 mm")
  await page.getByTitle(/^Undo Edit case/).click()
  await expect(page.locator(".cad-material")).toContainText("65 × 45 × 20 mm")

  await page.getByRole("button", { name: "Pico blink", exact: true }).click()
  await page.getByRole("button", { name: "Plain text", exact: true }).click()
  const source = page.getByRole("textbox", { name: "main.ino source code" })
  await expect(source).toContainText("Serial.println")
  const updated = (await source.inputValue()).replace("LED on", "Blink on")
  await source.fill(updated)
  await page.getByRole("button", { name: "Circuit", exact: true }).click()
  await page.getByRole("button", { name: "Pico blink", exact: true }).click()
  await expect(source).toHaveValue(updated)
  await page.reload()
  await expect(source).toHaveValue(updated)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.locator(".firmware-workspace .electronics-toolbar")).toContainText("All changes saved")
  await page.reload()
  await expect(source).toHaveValue(updated)
  await page.getByRole("button", { name: "m4k3r_pins.h", exact: false }).click()
  await expect(page.getByRole("textbox", { name: "m4k3r_pins.h source code" })).toHaveAttribute("readonly", "")
  await page.screenshot({ path: testInfo.outputPath("firmware.png") })

  // Server-side validation must agree with the interactive worker's circuit behavior.
  const result = await page.request.post(`/api/projects/${project.id}/simulate`, { data: {
    analysis: "tran", duration: 0.2, step: 0.00005, probes: ["I(D1)"],
    inputs: [{ t: 0, ref: "SW1", action: "press" }],
  } })
  expect(result.ok()).toBe(true)
  expect((await result.json()).views.D1.brightness).toBeGreaterThan(0.4)
  expect(errors).toEqual([])
})

test("agent edits sync to two browsers and keyboard undo/redo keeps them consistent", async ({ page, context, request }) => {
  const response = await request.post("/api/demo")
  expect(response.ok()).toBe(true)
  const project = await response.json()
  const url = `/#/p/${project.id}/wiring`
  const observer = await context.newPage()
  await Promise.all([page.goto(url), observer.goto(url)])
  await page.getByRole("button", { name: "Details", exact: true }).click()
  await observer.getByRole("button", { name: "Details", exact: true }).click()
  const resistor = (target: typeof page) => target.locator(".component").filter({ hasText: /^R1/ })
  await expect(resistor(page)).toContainText("150")
  await expect(resistor(observer)).toContainText("150")
  const changed = await request.post(`/api/projects/${project.id}/commands`, { data: {
    label: "Change resistance", commands: [{ type: "component.update", args: { component: "R1", props: { value: "330" } } }],
  } })
  expect(changed.ok()).toBe(true)
  await expect(resistor(page)).toContainText("330")
  await expect(resistor(observer)).toContainText("330")
  const mod = await page.evaluate(() => /Mac|iPhone|iPad/.test(navigator.userAgent) ? "Meta" : "Control")
  await page.keyboard.press(`${mod}+z`)
  await expect(resistor(page)).toContainText("150")
  await expect(resistor(observer)).toContainText("150")
  await page.keyboard.press("Control+y")
  await expect(resistor(page)).toContainText("330")
  await expect(resistor(observer)).toContainText("330")
  await resistor(page).locator(".part").click()
  await page.getByRole("button", { name: "Circuit", exact: true }).click()
  await expect(page.locator(".schematic-symbol[data-selected] .schematic-ref")).toContainText("R1")
  await observer.close()
})

test("MCP exposes the integrated domains and runs saved simulation documents", async ({ request }) => {
  const rpc = async (method: string, params: object = {}) => {
    const response = await request.post("/mcp", {
      headers: { Accept: "application/json, text/event-stream" },
      data: { jsonrpc: "2.0", id: 1, method, params },
    })
    expect(response.ok()).toBe(true)
    const message = await response.json()
    expect(message.error).toBeUndefined()
    return message.result
  }
  const initialized = await rpc("initialize", {
    protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "preview-smoke", version: "1" },
  })
  expect(initialized.serverInfo.name).toBe("m4k3r")
  const list = await rpc("tools/list")
  expect(list.tools.map((tool: { name: string }) => tool.name)).toEqual(expect.arrayContaining([
    "apply_commands", "cad_properties", "cad_export", "simulation_run", "firmware_build", "firmware_run", "import_kicad_part",
  ]))
  const created = await request.post("/api/demo")
  const project = await created.json()
  const result = await rpc("tools/call", {
    name: "simulation_run", arguments: { project: project.id, doc: "Button lab", maxPoints: 3 },
  })
  expect(result.isError).not.toBe(true)
  expect(result.content[0].text).toContain("Transient")
})

test("wiring is a circuit canvas with draggable parts and direct pin-to-pin wires", async ({ page, request }, testInfo) => {
  const response = await request.post("/api/projects", { data: { name: "Drag wiring" } })
  const project = await response.json()
  const read = async () => (await request.get(`/api/projects/${project.id}`)).json()
  await page.goto(`/#/p/${project.id}/wiring`)
  const canvas = page.getByTestId("circuit-canvas")
  await expect(canvas).toBeVisible()
  expect((await read()).docs).toHaveLength(0)
  await page.locator('[data-part-id="resistor"]').dragTo(canvas, { targetPosition: { x: 240, y: 200 } })
  await expect(page.locator('[data-component-ref="R1"]')).toBeVisible()
  await page.locator('[data-part-id="battery"]').dragTo(canvas, { targetPosition: { x: 500, y: 350 } })
  await expect(page.locator('[data-component-ref="BT1"]')).toBeVisible()
  await expect(page.locator(".schematic-symbol")).toHaveCount(2)

  const source = page.locator('[data-pin-address="R1.1"]')
  const target = page.locator('[data-pin-address="BT1.1"]')
  const a = await source.boundingBox(), b = await target.boundingBox()
  if (!a || !b) throw new Error("Missing pin hit areas")
  await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
  await page.mouse.down()
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 })
  await expect(page.locator(".schematic-wire-draft[data-snapped]")).toBeVisible()
  await page.mouse.up()
  await expect(page.locator(".schematic-net path")).toHaveCount(1)
  await expect.poll(async () => (await read()).nets.length).toBe(1)
  const before = await read()
  const schematic = before.docs.find((doc: { kind: string }) => doc.kind === "schematic")
  const resistorId = before.components.find((component: { ref: string }) => component.ref === "R1").id
  const original = schematic.data.symbols.find((symbol: { component: string }) => symbol.component === resistorId)
  const wirePath = await page.locator(".schematic-net path").getAttribute("d")
  const body = await page.locator('[data-component-ref="R1"] .schematic-ref').boundingBox()
  if (!body) throw new Error("Missing resistor body")
  await page.mouse.move(body.x + body.width / 2, body.y + body.height / 2)
  await page.mouse.down()
  await page.mouse.move(body.x + body.width / 2 + 65, body.y + body.height / 2 + 45, { steps: 10 })
  await page.mouse.up()
  await expect.poll(async () => {
    const current = await read()
    return current.docs.find((doc: { id: string }) => doc.id === schematic.id).data.symbols.find((symbol: { component: string }) => symbol.component === resistorId).x
  }).not.toBe(original.x)
  await expect(page.locator(".schematic-net path")).not.toHaveAttribute("d", wirePath!)
  const end = await page.locator('[data-pin-address="R1.2"]').boundingBox()
  if (!end) throw new Error("Missing second resistor pin")
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + 80, end.y + 80)
  await page.keyboard.press("Escape")
  await page.mouse.up()
  await expect(page.locator(".schematic-wire-draft")).toHaveCount(0)
  expect((await read()).nets).toHaveLength(1)
  await page.reload()
  await expect(page.locator(".schematic-symbol")).toHaveCount(2)
  await expect(page.locator(".schematic-net path")).toHaveCount(1)
  await page.screenshot({ path: testInfo.outputPath("visual-wiring.png") })
  await page.getByRole("button", { name: "Details", exact: true }).click()
  await expect(page.locator(".component")).toHaveCount(2)
})

test("the circuit itself shows the motor spinning and LED lighting when powered", async ({ page }, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await page.goto("/")
  await page.getByRole("button", { name: "Try a demo" }).click()
  await page.getByRole("button", { name: "Circuit", exact: true }).click()
  const motor = page.locator('[data-motor-ref="M1"]')
  await expect(motor).toHaveAttribute("data-spinning", "false")
  await expect(page.getByRole("button", { name: "Run circuit", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Run circuit", exact: true }).click()
  await page.getByRole("button", { name: "Hold SW1", exact: true }).hover()
  await page.mouse.down()
  await expect(motor).toHaveAttribute("data-spinning", "true")
  await expect.poll(async () => Number(await motor.getAttribute("data-rpm"))).toBeGreaterThan(100)
  const rotor = motor.locator(".circuit-motor-rotor")
  const initial = await rotor.evaluate((element) => getComputedStyle(element).transform)
  await expect.poll(() => rotor.evaluate((element) => getComputedStyle(element).transform)).not.toBe(initial)
  await page.screenshot({ path: testInfo.outputPath("circuit-running.png") })
  await page.mouse.up()
  await page.getByRole("button", { name: "Pause circuit", exact: true }).click()
  await expect(motor).toHaveAttribute("data-spinning", "false")
  await page.getByRole("button", { name: "Reset circuit", exact: true }).click()
  await expect(motor).toHaveAttribute("data-rpm", "0")
})

test("a battery and motor circuit can set its return net as ground and run", async ({ page, request }) => {
  const created = await request.post("/api/projects", { data: { name: "Motor feedback" } })
  const project = await created.json()
  const wired = await request.post(`/api/projects/${project.id}/commands`, { data: { commands: [
    { type: "component.add", args: { part: "battery" } },
    { type: "component.add", args: { part: "dc-motor" } },
    { type: "net.connect", args: { pins: ["BT1.+", "M1.1"], name: "VBAT" } },
    { type: "net.connect", args: { pins: ["BT1.-", "M1.2"], name: "RETURN" } },
    { type: "doc.create", args: { kind: "schematic", name: "Circuit" } },
    { type: "schematic.autoplace", args: { doc: "Circuit" } },
  ] } })
  expect(wired.ok()).toBe(true)
  const saved = await (await request.get(`/api/projects/${project.id}`)).json()
  await page.goto(`/#/p/${project.id}/wiring`)
  await expect(page.getByRole("button", { name: "Run circuit", exact: true })).toBeDisabled()
  await page.getByLabel("Ground net", { exact: true }).selectOption(saved.nets.find((net: { name: string }) => net.name === "RETURN").id)
  await page.getByRole("button", { name: "Set ground", exact: true }).click()
  await expect(page.getByRole("button", { name: "Run circuit", exact: true })).toBeEnabled()
  await page.getByRole("button", { name: "Run circuit", exact: true }).click()
  await expect(page.locator('[data-motor-ref="M1"]')).toHaveAttribute("data-spinning", "true")
  await expect.poll(async () => Number(await page.locator('[data-motor-ref="M1"]').getAttribute("data-rpm"))).toBeGreaterThan(100)
})

test("firmware UI compiles, downloads and runs the Pico blink example", async ({ page }) => {
  test.skip(process.env.M4K3R_FIRMWARE_E2E !== "1", "Requires the installed Pico compiler toolchain")
  test.setTimeout(600_000)
  await page.goto("/")
  await page.getByRole("button", { name: "Try a demo" }).click()
  await page.getByRole("button", { name: "Pico blink", exact: true }).click()
  await page.getByRole("button", { name: "Run on Pico", exact: true }).click()
  await expect(page.locator(".firmware-success")).toContainText("Build succeeded", { timeout: 600_000 })
  await expect(page.locator(".firmware-output > div pre").filter({ hasText: "LED on" })).toContainText("LED on", { timeout: 60_000 })
  await expect(page.getByRole("link", { name: "firmware.uf2", exact: true })).toBeVisible()
  await expect(page.locator(".firmware-gpio")).toContainText("GP25")
})

test("ESP32 drone firmware UI compiles a merged image and executes actual C3 serial/GPIO",async({page,request})=>{
 test.skip(process.env.M4K3R_ESP_E2E!=="1","Requires the installed ESP32 compiler and emulator in the test server home")
 test.setTimeout(600000)
 const response=await request.post('/api/demo/drone')
 expect(response.ok()).toBe(true)
 const project=await response.json(),doc=project.docs.find((d:{kind:string})=>d.kind==='firmware')
 await page.goto(`/#/p/${project.id}/${doc.id}`)
 await expect(page.getByRole('combobox',{name:'Firmware platform'})).toHaveValue('esp32')
 await page.getByLabel('Simulation duration in milliseconds').fill('500')
 await page.getByRole('button',{name:'Run on ESP32',exact:true}).click()
 await expect(page.locator('.firmware-success')).toContainText('Build succeeded',{timeout:600000})
 await expect(page.locator('.firmware-output pre').filter({hasText:'ESP32 bench ready'})).toBeVisible({timeout:60000})
 await expect(page.getByRole('link',{name:'firmware.merged.bin',exact:true})).toBeVisible()
 await expect(page.locator('.firmware-gpio')).toContainText('GP2')
 await expect(page.locator('.firmware-output')).toContainText('real machine code')
})
