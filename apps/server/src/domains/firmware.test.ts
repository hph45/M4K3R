import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { emptyProject } from '@m4k3r/core'
import { FirmwareData, build, runEspFirmware, runFirmware } from '@m4k3r/firmware'
import { expect, it, vi } from 'vitest'
import { firmware } from './firmware'

vi.mock('@m4k3r/firmware', async (original) => ({
  ...await original<typeof import('@m4k3r/firmware')>(),
  build: vi.fn(), runEspFirmware: vi.fn(), runFirmware: vi.fn(),
}))

it('executes the captured firmware target when the project changes during compilation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'm4k3r-target-race-'))
  let project = emptyProject('target-race', 'Target race')
  project.docs.push({ id: 'fw', name: 'Firmware', kind: 'firmware', data: FirmwareData.parse({ platform: 'esp32' }) })
  const hash = '0123456789abcdef', artifactDir = join(home, '.cache', 'builds', hash)
  mkdirSync(artifactDir, { recursive: true })
  writeFileSync(join(artifactDir, 'firmware.merged.bin'), new Uint8Array([1, 2, 3]))
  let finish!: () => void
  vi.mocked(build).mockImplementation(async () => {
    await new Promise<void>((resolve) => { finish = resolve })
    return { ok: true, hash, artifacts: ['firmware.merged.bin'], diagnostics: [] }
  })
  vi.mocked(runEspFirmware).mockResolvedValue({ complete: true, serial: { Serial: 'captured ESP target' }, gpio: {}, simulatedMs: 1, wallMs: 1, warnings: [] })
  const context = { home, store: { get: () => project }, library: {} } as any
  await firmware.setup?.(context)
  const handlers = new Map<string, (args: any) => Promise<any>>()
  firmware.tools?.({ registerTool(name: string, _config: unknown, handler: any) { handlers.set(name, handler) } } as any, context)
  const running = handlers.get('firmware_run')!({ project: project.id, doc: 'fw', ms: 1 })
  project = { ...project, docs: [{ ...project.docs[0]!, data: FirmwareData.parse({ platform: 'rp2040' }) }] }
  finish()
  const result = await running
  expect(result.isError).toBeUndefined()
  expect(vi.mocked(build).mock.calls[0]?.[2]).toMatchObject({ platform: 'esp32', board: 'esp32c3' })
  expect(runEspFirmware).toHaveBeenCalledOnce()
  expect(runEspFirmware).toHaveBeenCalledWith(home, expect.any(Buffer), 1, 30_000, 'esp32c3')
  expect(runFirmware).not.toHaveBeenCalled()
  expect(result.content[0].text).toContain('captured ESP target')
})
