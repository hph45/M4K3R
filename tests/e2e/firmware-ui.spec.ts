import { expect, test, type APIRequestContext } from "@playwright/test"

async function target(request: APIRequestContext) {
  const response = await request.post("/api/projects", { data: { name: "Firmware editor verification" } })
  const project = await response.json()
  const seeded = await request.post(`/api/projects/${project.id}/commands`, { data: { commands: [{ type: "doc.create", args: { kind: "firmware", name: "Editor target", data: { files: { "main.ino": "void setup() {}\nvoid loop() {}\n" } } } }] } })
  expect(seeded.ok()).toBe(true)
  const fresh = await (await request.get(`/api/projects/${project.id}`)).json()
  const doc = fresh.docs.find((d: { kind: string }) => d.kind === "firmware")
  return { project: fresh, doc, url: `/#/p/${project.id}/${doc.id}` }
}

test("Monaco edits survive tab changes and reload, save with undo and show compiler markers", async ({ page, request }, testInfo) => {
  const errors: string[] = []
  page.on("pageerror", (e) => errors.push(e.message))
  const { project, doc, url } = await target(request)
  await page.goto(url)
  await expect(page.locator(".monaco-editor")).toBeVisible()
  const code = "int missing = unknown;"
  const editor = page.getByRole("textbox", { name: "main.ino C++ editor", exact: true })
  await editor.focus()
  await page.keyboard.press("ControlOrMeta+A")
  await page.keyboard.insertText(code)
  await expect(page.locator(".firmware-workspace .electronics-toolbar")).toContainText("local draft kept")
  await page.getByRole("button", { name: "Wiring", exact: true }).click()
  await page.getByRole("button", { name: "Editor target", exact: true }).click()
  await page.getByRole("button", { name: "Plain text", exact: true }).click()
  const plain = page.getByRole("textbox", { name: "main.ino source code", exact: true })
  await expect(plain).toHaveValue(code)
  await page.reload()
  await expect(plain).toHaveValue(code)
  await page.getByRole("button", { name: "Save", exact: true }).click()
  await expect(page.locator(".firmware-workspace .electronics-toolbar")).toContainText("All changes saved")
  expect((await (await request.get(`/api/projects/${project.id}`)).json()).docs.find((d: { id: string }) => d.id === doc.id).data.files["main.ino"]).toBe(code)
  await page.getByTitle(/^Undo Save Editor target sources/).click()
  await expect(plain).toHaveValue("void setup() {}\nvoid loop() {}\n")
  await page.getByTitle(/^Redo Save Editor target sources/).click()
  await expect(plain).toHaveValue(code)
  // Structured compiler output is projected onto the actual Monaco model, without invoking a toolchain here.
  await page.route(`**/firmware/${doc.id}/build`, (route) => route.fulfill({ json: { ok: false, hash: "editor-test", diagnostics: [{ file: "main.ino", line: 1, col: 15, severity: "error", message: "unknown was not declared in this scope" }], artifacts: [] } }))
  await page.getByRole("button", { name: "C++ editor", exact: true }).click()
  await expect(page.locator(".monaco-editor")).toBeVisible()
  await page.getByRole("button", { name: "Build", exact: true }).click()
  await expect(page.locator(".firmware-diagnostic")).toContainText("unknown was not declared")
  await expect(page.locator(".monaco-editor .squiggly-error").first()).toBeVisible()
  await page.locator(".firmware-diagnostic").click()
  await expect(editor).toBeFocused()
  await page.screenshot({ path: testInfo.outputPath("monaco-compiler-diagnostic.png") })
  expect(errors).toEqual([])
})

test("hardware panel handles browsers without Web Serial and retains downloads", async ({ page, request }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, "serial", { configurable: true, value: undefined }))
  const { url } = await target(request)
  await page.goto(url)
  await page.getByText("Physical hardware", { exact: false }).click()
  await expect(page.locator(".firmware-serial-unavailable")).toContainText("Web Serial is unavailable")
  await expect(page.getByRole("button", { name: "Connect serial", exact: true })).toBeDisabled()
  await expect(page.locator(".firmware-hardware")).toContainText("RPI-RP2")
})

test("serial chooser is explicit, monitor sends and receives bytes, navigation releases device locks", async ({ page, request }) => {
  await page.addInitScript(() => {
    const probe = { requested: 0, opened: 0, closed: 0, sent: [] as string[], lockedAtClose: false }
    Object.assign(window, { serialProbe: probe })
    const serial = new EventTarget()
    const port = Object.assign(new EventTarget(), {
      readable: null as ReadableStream<Uint8Array> | null,
      writable: null as WritableStream<Uint8Array> | null,
      getInfo: () => ({ usbVendorId: 0x1234, usbProductId: 0x5678 }),
      async open() {
        probe.opened++
        this.readable = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("hardware ready ✓\n")) } })
        this.writable = new WritableStream<Uint8Array>({ write(bytes) { probe.sent.push(new TextDecoder().decode(bytes)) } })
      },
      async close() { probe.lockedAtClose = !!(this.readable?.locked || this.writable?.locked); probe.closed++; this.readable = null; this.writable = null },
    })
    Object.assign(serial, { requestPort: async () => { probe.requested++; return port } })
    Object.defineProperty(navigator, "serial", { configurable: true, value: serial })
  })
  const { url } = await target(request)
  await page.goto(url)
  await page.getByText("Physical hardware", { exact: false }).click()
  const probe = () => page.evaluate(() => (window as Window & { serialProbe?: { requested: number; opened: number; closed: number; sent: string[]; lockedAtClose: boolean } }).serialProbe!)
  expect((await probe()).requested).toBe(0)
  await page.getByRole("button", { name: "Connect serial", exact: true }).click()
  await expect(page.getByLabel("Hardware serial log", { exact: true })).toContainText("hardware ready ✓")
  await page.getByRole("textbox", { name: "Serial message", exact: true }).fill("ping")
  await page.getByRole("button", { name: "Send serial", exact: true }).click()
  await expect.poll(async () => (await probe()).sent).toEqual(["ping\n"])
  await page.getByRole("button", { name: "Wiring", exact: true }).click()
  await expect.poll(async () => (await probe()).closed).toBe(1)
  expect((await probe()).lockedAtClose).toBe(false)
  expect((await probe()).requested).toBe(1)
})

test("ESP flashing requires a current C3 build and an explicit chooser gesture", async ({ page, request }) => {
  await page.addInitScript(() => {
    Object.assign(window, { flashChooserCalls: 0 })
    Object.defineProperty(navigator, "serial", { configurable: true, value: Object.assign(new EventTarget(), { requestPort: async () => { (window as Window & { flashChooserCalls: number }).flashChooserCalls++; throw new DOMException("No port selected", "NotFoundError") } }) })
  })
  const { project, doc, url } = await target(request)
  await request.post(`/api/projects/${project.id}/commands`, { data: { commands: [{ type: "firmware.set", args: { doc: doc.id, platform: "esp32", board: "esp32c3" } }] } })
  await page.route(`**/firmware/${doc.id}/build`, (route) => route.fulfill({ json: { ok: true, hash: "flash-test", diagnostics: [], artifacts: ["/not-fetched/firmware.merged.bin"] } }))
  await page.goto(url)
  await page.getByText("Physical hardware", { exact: false }).click()
  const flash = page.getByRole("button", { name: "Choose ESP device & flash", exact: true })
  await expect(flash).toBeDisabled()
  await page.getByRole("button", { name: "Build", exact: true }).click()
  await expect(flash).toBeEnabled()
  expect(await page.evaluate(() => (window as Window & { flashChooserCalls: number }).flashChooserCalls)).toBe(0)
  await flash.click()
  await expect(page.locator(".firmware-hardware").getByRole("alert")).toContainText("No ESP device selected")
  expect(await page.evaluate(() => (window as Window & { flashChooserCalls: number }).flashChooserCalls)).toBe(1)
  await page.getByRole("button", { name: "Plain text", exact: true }).click()
  await page.getByRole("textbox", { name: "main.ino source code", exact: true }).fill("// changed since build")
  await expect(flash).toBeDisabled()
})

test("editing sources while the ESP chooser is pending prevents opening or flashing the selected device", async ({ page, request }) => {
  await page.addInitScript(() => {
    const probe = { chosen: 0, opened: 0 }
    const port = Object.assign(new EventTarget(), { readable: null, writable: null, open: async () => { probe.opened++ }, close: async () => {}, getInfo: () => ({}) })
    Object.assign(window, { staleFlashProbe: probe })
    const serial = Object.assign(new EventTarget(), { requestPort: () => new Promise((resolve) => { probe.chosen++; Object.assign(window, { resolveFlashChooser: () => resolve(port) }) }) })
    Object.defineProperty(navigator, "serial", { configurable: true, value: serial })
  })
  const { project, doc, url } = await target(request)
  await request.post(`/api/projects/${project.id}/commands`, { data: { commands: [{ type: "firmware.set", args: { doc: doc.id, platform: "esp32", board: "esp32c3" } }] } })
  await page.route(`**/firmware/${doc.id}/build`, (route) => route.fulfill({ json: { ok: true, hash: "flash-test", diagnostics: [], artifacts: ["/not-fetched/firmware.merged.bin"] } }))
  const downloads: string[] = []
  page.on("request", (request) => { if (request.url().endsWith("/not-fetched/firmware.merged.bin")) downloads.push(request.url()) })
  await page.goto(url)
  await page.getByText("Physical hardware", { exact: false }).click()
  const flash = page.getByRole("button", { name: "Choose ESP device & flash", exact: true })
  await page.getByRole("button", { name: "Build", exact: true }).click()
  await expect(flash).toBeEnabled()
  await flash.click()
  await page.getByRole("button", { name: "Plain text", exact: true }).click()
  await page.getByRole("textbox", { name: "main.ino source code", exact: true }).fill("// edited while selecting hardware")
  await page.evaluate(() => (window as Window & { resolveFlashChooser(): void }).resolveFlashChooser())
  await expect(page.locator(".firmware-hardware").getByRole("alert")).toContainText("Sources or target changed")
  expect(await page.evaluate(() => (window as Window & { staleFlashProbe: { chosen: number; opened: number } }).staleFlashProbe)).toEqual({ chosen: 1, opened: 0 })
  expect(downloads).toEqual([])
})
