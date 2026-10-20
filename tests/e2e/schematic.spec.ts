import { expect, test } from "@playwright/test"

test("schematic gates, editable wire bends, labels and no-connect flags persist and share canonical nets", async ({ page, request }, testInfo) => {
  const created = await request.post("/api/projects", { data: { name: "Schematic editing verification" } }), project = await created.json()
  const part = { id: "qa-dual-gate", name: "QA two-unit device", refPrefix: "U", pins: [{ num: "1", name: "A", type: "passive" }, { num: "2", name: "B", type: "passive" }], symbol: { units: [1, 2].map((num) => ({ graphics: [{ type: "rect", start: [-2, -2], end: [2, 2], width: .2 }], pins: [{ num: String(num), at: [-5, 0], rot: 0, length: 3 }] })) } }
  const seeded = await request.post(`/api/projects/${project.id}/commands`, { data: { commands: [{ type: "part.vendor", args: { part } }, { type: "component.add", args: { part: part.id } }, { type: "doc.create", args: { kind: "schematic", name: "Gates" } }, { type: "schematic.autoplace", args: { doc: "Gates" } }, { type: "schematic.wire.add", args: { doc: "Gates", pins: ["U1.1", "U1.2"], bends: [[45, 30], [45, 50], [65, 50]], name: "SIGNAL" } }] } })
  expect(seeded.ok()).toBe(true)
  const read = async () => (await (await request.get(`/api/projects/${project.id}`)).json())
  const current = await read(), sheet = current.docs.find((d: { kind: string }) => d.kind === "schematic")
  await page.goto(`/#/p/${project.id}/${sheet.id}`)
  await expect(page.locator(".schematic-symbol")).toHaveCount(2)
  await expect(page.locator('[data-symbol-unit="1"] .schematic-ref')).toContainText("U1.B")
  await page.getByText("Editable wire paths (1)", { exact: true }).click()
  await page.getByRole("button", { name: /^Edit U1/ }).click()
  await expect(page.locator(".schematic-wire-bend")).toHaveCount(3)
  const bend = await page.locator(".schematic-wire-bend").first().boundingBox()
  await page.mouse.move(bend!.x + bend!.width / 2, bend!.y + bend!.height / 2)
  await page.mouse.down(); await page.mouse.move(bend!.x + bend!.width / 2 + 25, bend!.y + bend!.height / 2 + 18, { steps: 8 }); await page.mouse.up()
  await expect.poll(async () => (await read()).docs.find((d: { id: string }) => d.id === sheet.id).data.wires[0].bends[0]).not.toEqual([45, 30])
  await page.locator('[data-pin-address="U1.1"]').click()
  await page.getByRole("button", { name: "Mark pins no-connect", exact: true }).click()
  await expect(page.locator(".schematic-no-connect")).toHaveCount(1)
  const checks = await (await request.get(`/api/projects/${project.id}/erc`)).json()
  expect(checks.some((c: { code: string }) => c.code === "no-connect-wired")).toBe(true)
  const row = page.locator(".electronics-net-row").filter({ hasText: "SIGNAL" })
  const labelAction = page.getByRole("button", { name: "Place SIGNAL label", exact: true })
  if (!await labelAction.isVisible()) await row.click({ position: { x: 180, y: 7 } })
  await labelAction.click()
  const canvas = await page.getByTestId("circuit-canvas").boundingBox()
  await page.mouse.click(canvas!.x + canvas!.width * .35, canvas!.y + canvas!.height * .25)
  await expect(page.locator(".schematic-net-label")).toHaveCount(1)
  await page.reload()
  await expect(page.locator(".schematic-symbol")).toHaveCount(2)
  await expect(page.locator(".schematic-net-label")).toHaveCount(1)
  await expect(page.locator(".schematic-no-connect")).toHaveCount(1)
  expect((await read()).nets).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath("schematic-gates-and-label.png") })
})

test("the reference drone schematic opens legible: rails as power symbols, short local wires, whole sheet readable", async ({ page, request }, testInfo) => {
  const drone = await (await request.post("/api/demo/drone")).json()
  const sheet = drone.docs.find((d: { kind: string }) => d.kind === "schematic")
  await page.goto(`/#/p/${drone.id}/${sheet.id}`)
  await expect(page.locator(".schematic-symbol")).toHaveCount(19)
  // Rails carry a symbol or label on their pins instead of wires across the sheet.
  for (const rail of ["GND", "VBAT", "3V3"]) {
    await expect(page.locator(`.schematic-net[data-net-name="${rail}"] > path`)).toHaveCount(0)
    expect(await page.locator(`.schematic-net[data-net-name="${rail}"] .schematic-port`).count()).toBeGreaterThan(3)
  }
  const wires = await page.locator(".schematic-net > path").evaluateAll((paths) => paths.map((p) => { const n = p.getAttribute("d")!.match(/-?[\d.]+/g)!.map(Number); return Math.hypot(n[0]! - n.at(-1)!, n[1]! - n[n.length - 2]!) }))
  expect(wires.length).toBeGreaterThan(0)
  for (const length of wires) expect(length).toBeLessThan(50)
  // Each ESC sits beside the motor it drives.
  const box = async (ref: string) => (await page.locator(`[data-component-ref="${ref}"] .schematic-symbol-hit`).boundingBox())!
  for (const n of [1, 2, 3, 4]) {
    const [esc, motor] = [await box(`ESC${n}`), await box(`M${n}`)]
    expect(Math.abs(esc.y - motor.y)).toBeLessThan(20)
    expect(motor.x).toBeGreaterThan(esc.x)
    expect(motor.x - esc.x).toBeLessThan(250)
  }
  // The whole sheet is on screen at first open, with references large enough to read.
  const canvas = (await page.getByTestId("circuit-canvas").boundingBox())!
  for (const symbol of await page.locator(".schematic-symbol-hit").all()) {
    const b = (await symbol.boundingBox())!
    expect(b.x).toBeGreaterThanOrEqual(canvas.x)
    expect(b.x + b.width).toBeLessThanOrEqual(canvas.x + canvas.width)
    expect(b.y + b.height).toBeLessThanOrEqual(canvas.y + canvas.height)
  }
  const reference = await page.locator('[data-component-ref="U1"] .schematic-ref').evaluate((t) => parseFloat(getComputedStyle(t).fontSize) * (t as SVGTextElement).ownerSVGElement!.getScreenCTM()!.a)
  expect(reference).toBeGreaterThanOrEqual(7.5)
  // Simulation notes are grouped by kind and stay collapsed.
  await expect(page.locator(".circuit-simulation-warnings summary")).toHaveText("2 simulation notes")
  await expect(page.locator(".circuit-simulation-warnings")).not.toHaveAttribute("open")
  await page.screenshot({ path: testInfo.outputPath("drone-schematic.png") })
})

// A one-pin symbol in KiCad's file format; the import request is rewritten to it so the test needs no network.
const symbol = (name: string) => `(kicad_symbol_lib (version 20251024) (generator "kicad_symbol_editor")
  (symbol "${name}"
    (property "Reference" "U" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (property "Value" "${name}" (at 0 0 0) (effects (font (size 1.27 1.27))))
    (symbol "${name}_1_1"
      (rectangle (start -5.08 -2.54) (end 5.08 2.54) (stroke (width 0.25) (type default)) (fill (type background)))
      (pin input line (at -7.62 0 0) (length 2.54) (name "IN" (effects (font (size 1.27 1.27)))) (number "1" (effects (font (size 1.27 1.27)))))
      (pin output line (at 7.62 0 180) (length 2.54) (name "OUT" (effects (font (size 1.27 1.27)))) (number "2" (effects (font (size 1.27 1.27))))))))`

test("the parts tray searches all KiCad libraries when the catalog has no match and adds the imported part", async ({ page, request }, testInfo) => {
  const project = await (await request.post("/api/projects", { data: { name: "KiCad tray" } })).json()
  const id = `esp32-s3-wroom-1-${Date.now().toString(36)}`
  const searched: string[] = []
  await page.route("**/api/kicad/symbols**", async (route) => {
    const params = new URL(route.request().url()).searchParams
    searched.push(`${params.get("lib") ?? ""}|${params.get("q")}`)
    await new Promise((r) => setTimeout(r, 800))
    return route.fulfill({ json: ["MCU_Espressif:ESP32-S3", "RF_Module:ESP32-S3-MINI-1", "RF_Module:ESP32-S3-WROOM-1"] })
  })
  const requested: string[] = []
  await page.route("**/api/parts/import", (route) => {
    requested.push(route.request().postDataJSON().symbol)
    return route.continue({ postData: JSON.stringify({ symbol: symbol("ESP32-S3-WROOM-1"), footprint: null, id }) })
  })
  await page.goto(`/#/p/${project.id}/wiring`)
  await expect(page.locator(".schematic-empty")).toContainText("Drag a part from the tray")
  await expect(page.locator(".schematic-interaction-status")).toHaveCount(0)
  const tray = page.getByTestId("parts-tray")
  await tray.getByLabel("Search circuit parts").fill("ESP32-S3")
  await expect(tray).toContainText("No matching parts")
  await tray.getByRole("button", { name: "Search KiCad libraries" }).click()
  await expect(tray.getByText("Indexing KiCad libraries… (first time only)")).toBeVisible()
  await expect(tray.locator("[data-kicad-symbol]")).toHaveCount(3)
  await tray.getByRole("button", { name: "RF_Module:ESP32-S3-WROOM-1", exact: true }).click()
  await expect(page.locator('[data-component-ref="U1"]')).toBeVisible()
  expect(searched).toEqual(["|ESP32-S3"])
  expect(requested).toEqual(["RF_Module:ESP32-S3-WROOM-1"])
  const saved = await (await request.get(`/api/projects/${project.id}`)).json()
  expect(saved.components.map((c: { part: string }) => c.part)).toEqual([id])
  expect(saved.docs.find((d: { kind: string }) => d.kind === "schematic").data.symbols).toHaveLength(1)
  await page.screenshot({ path: testInfo.outputPath("kicad-tray.png") })
})
