# M4K3R

Design a device in the browser: mechanical parts and assemblies, circuits, PCBs and firmware. Check the design using shared geometry, electrical models and supported MCU/circuit coupling before you build it.

The **local v1 release candidate** includes visual wiring and schematics, two-layer PCB routing/DRC and fabrication exports, live analog simulation, parametric CAD with STL/STEP/3MF, mechanical assemblies with fit and mass/CG checks, Arduino/Pico and ESP32 builds/emulation, and supported firmware/device coupling. See [v1 acceptance and fidelity](docs/v1-acceptance.md) for the tested workflows and model boundaries. This is an unpublished local RC; public distribution licensing remains a separate decision.

```bash
pnpm install
pnpm dev          # → http://localhost:4400
```

Requires Node 24+ and pinned pnpm 12.14.0 for source setup. macOS/Linux x64 and arm64 are the firmware-toolchain host targets. Projects are saved in `~/M4K3R` (override with `M4K3R_HOME`). See [setup and local release instructions](docs/setup.md) for prerequisites, downloads and packaged startup.

Click **Try a demo** for the starter circuit, scope, enclosure and firmware. On the circuit canvas, click **Run** and hold **SW1**: the LED glows and the motor shows an animated rotor, RPM and its running state. **Button lab** adds scope traces; **Enclosure** exports a printable case. Click **Plan a drone** for editable frame/holder CAD, a mounted assembly, PCB, ESP32 bench firmware and rotor/battery inputs. **Flight estimates** shows weight, thrust and runtime plus a bounded rigid-body preview with manual throttle controls and replay. Its coefficients and generic masses are planning inputs, not measured flight evidence. Firmware toolchains install on the first relevant build; several GB of free disk space are needed.

Use **＋ New document** or **⌘/Ctrl+K** to create a schematic, PCB, simulation, part studio, assembly, device analysis or firmware target. Edits save through the server and support undo/redo. Firmware source drafts stay in the browser until **Save**, **Build** or **Run**.

**Wiring is a visual circuit canvas.** Drag a resistor or another part from the tray onto the canvas, move parts by their bodies, and drag from one pin dot to another to attach a wire. **Details** shows the component/net list when you need it.

```bash
pnpm build && pnpm start   # production UI on the same local server
pnpm test                 # unit + local HTTP integration tests
pnpm typecheck
pnpm test:e2e             # isolated browser smoke, temporary project data
M4K3R_E2E_PRODUCTION=1 pnpm test:e2e  # verify the built production UI
pnpm release:package      # host-specific local RC tar.gz, notices and sources
pnpm release:check        # extract and verify it with an isolated fresh home
```

Browser tests use installed Chrome on macOS; elsewhere, install Chromium once with `pnpm exec playwright install chromium`. To verify compilation and emulation with the full toolchain, run `M4K3R_FIRMWARE_E2E=1 pnpm exec vitest run packages/firmware/src/e2e.test.ts`.

**AI agents:** `claude mcp add --transport http m4k3r http://localhost:4400/mcp`. See [docs/api.md](docs/api.md).

Packaged releases include their installed host dependencies and prebuilt UI: extract the tarball and run `./start.sh` with Node 24+, without pnpm or a first-start network download. Arduino toolchains, ESP emulator downloads, private projects and imported-part caches are excluded. See [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES.md) for retained licenses, source archives and unresolved public-distribution decisions.

Start with **[docs/](docs/README.md)**.
