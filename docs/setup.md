# Setup and local release candidates

M4K3R serves its browser UI, JSON API, WebSocket updates and MCP endpoint from one process bound to `127.0.0.1`. The default URL is `http://localhost:4400`. This release is an unpublished local v1 candidate; [acceptance evidence and fidelity boundaries](v1-acceptance.md) are separate from public licensing approval.

## Source checkout

Install Node.js 24 or later and pnpm **12.14.0**. Then run:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

For the built UI:

```sh
pnpm build
pnpm start
```

Use a current Chrome/Chromium desktop browser for the tested workflow. Browser E2E uses installed Chrome on macOS; on other supported hosts install the test browser with `pnpm exec playwright install chromium`. Browser binaries are not included in release archives. Physical Web Serial flashing is a Chromium feature requiring the user's own device selection and permission; the basic UI and simulation do not need a serial device.

The application itself does not require Python, Docker or a C++ compiler for the bundled CAD WASM kernels. Rebuilding the retained upstream kernel sources is a separate developer workflow and uses their documented Docker/Emscripten/CMake toolchains.

## Local host bundle

From an installed, validated checkout:

```sh
pnpm release:package
pnpm release:check
```

The packager builds the production UI, then creates a versioned folder and `.tar.gz` under `dist/release/`. Pass `--zip` to additionally create a symlink-preserving ZIP when the system `zip` utility is installed:

```sh
pnpm release:package --zip
```

The packager needs `tar`, Node, pnpm, installed dependencies and access to the pinned third-party source archive URLs when their local packaging cache is empty. `--skip-build` deliberately reuses an existing UI build; normal packaging always builds first. `dist/release/latest.json` identifies the latest folder/archive and SHA-256 hashes; a `.sha256` file accompanies each archive.

Each artifact contains:

- App/package source, catalog, documentation, lockfile, installed npm dependencies and prebuilt UI.
- `RELEASE_MANIFEST.json` with the local RC version, OS/architecture, file hashes, relative symlink records and retained-source checksums.
- Third-party license evidence, a generated inventory of installed npm package notices, KiCad source-field attribution and the identified kernel/ROM source/build archives.
- `start.sh` and Node start/setup/check scripts.

The packager uses an explicit source allowlist. It excludes VCS/worktrees, `.local-data`, user project homes/imported parts, credentials/environment files, toolchains, firmware build caches, ESP emulator downloads, test results and browser binaries. The only files copied out of its local packaging cache are the source archives explicitly pinned in `scripts/release/sources.json`.

Extract the artifact on the **same OS and architecture** and run:

```sh
tar -xzf m4k3r-1.0.0-rc.1-<host>-<timestamp>.tar.gz
cd m4k3r-1.0.0-rc.1-<host>-<timestamp>
./start.sh
```

Node 24+ is required; pnpm and network access are not needed for matching-host startup. The archive does not contain Node itself. macOS/Linux x64 and arm64 are the implemented firmware-toolchain host targets; only a host actually checked by the release verifier is claimed as tested. The current manifest records the tested host precisely. Windows is not a supported target of these release/toolchain scripts.

If starting from source without installed dependencies, `node scripts/release/setup.mjs` installs using the pinned pnpm version. To regenerate dependencies for another supported host, `node scripts/release/setup.mjs --reinstall` runs the lockfile install with `--force`, records the new host and refreshes the manifest. This creates a modified local bundle, so rerun its checks and do not reuse the original archive hash as evidence for the modified files.

## Projects and ports

```sh
PORT=4410 M4K3R_HOME=/absolute/path/to/my-project-home ./start.sh
```

Default application data lives in `~/M4K3R`. Projects, imported parts, KiCad caches, firmware build outputs and on-demand toolchains live under that chosen home. Changing `M4K3R_HOME` selects a different data set; it does not move or delete the previous one. The shipped artifact contains none of those user data folders.

The health endpoint is `GET /api/health`. `GET /api/projects` and `GET /api/parts` provide simple API checks. The server also accepts `localhost` host headers, but always binds to the IPv4 loopback address; public hosting and remote authentication are not configured by these local scripts.

## Downloads on demand

Basic startup, CAD, assemblies and the built-in catalog use bundled dependencies. They do not download compiler toolchains.

| Requested capability | Download/cache behavior |
|---|---|
| KiCad import/search | Fetches official KiCad library data and caches it under the chosen home; the built-in catalog works without this network access. |
| First Pico firmware build | Downloads checksum-verified Arduino CLI 1.5.1, Arduino-Pico core 6.2.0 and its compiler/SDK packages. |
| First ESP32 firmware build | Uses the same CLI, downloads Arduino-ESP32 core 3.3.12 and its compiler/SDK packages. |
| Selected Arduino libraries | Downloads the pinned library specifications requested by the firmware document. |
| First ESP emulation | Downloads official Espressif ESP emulator 0.49.0 WASM archive and verifies its pinned SHA-256. Pico's identified B1 ROM is already retained with separate license/source notices. |

Allow several GB of free disk space for firmware cores and compiler caches. Firmware installation/extraction needs the system `tar` utility; selected Arduino build recipes may require a working host Python 3 or other tools named in their diagnostics. Compiler/package installation requires Internet access to the official Arduino/GitHub/Espressif sources. These external distributions retain their own licenses.

On Apple Silicon, Arduino's bundled x86 ctags may require Rosetta. The current fallback skips automatic prototype generation if ctags cannot run: write function declarations before use in sketches. This fallback is logged when selected. Installing Rosetta is a host decision, not performed by M4K3R.

ESP32 builds and machine-code emulation are distinct capabilities. The adapter currently exposes UART and sampled digital GPIO for the supported emulator chip targets; it does not imply complete peripheral, radio or board-level fidelity. See [firmware documentation](firmware.md), [simulation documentation](simulation.md) and the acceptance matrix before relying on a model.

## Verification and licensing boundary

`pnpm release:check` extracts the latest tarball into a temporary directory, verifies its inventory, starts its production server with a fresh isolated home, checks the health/version and UI asset, confirms an empty project list, creates disposable projects, evaluates exact CAD/assembly properties and downloads 3MF. It also creates the reference drone, checks fit/mass, runs static and rigid-body analysis, verifies its PCB DRC and downloads the fabrication ZIP. It confirms that these workflows did not install a toolchain and removes the disposable home afterward. The machine's actual project home is never opened. The report is written to `dist/release/check-report.json`.

Pass an explicit archive/folder to check another artifact, for example `node scripts/release/check.mjs dist/release/<archive>.tar.gz`. Unit, browser, compiler and coupled-hardware-model suites remain separate from this basic release smoke check.

[THIRD_PARTY_NOTICES](../THIRD_PARTY_NOTICES.md) records ROM license alternatives, LGPL kernel source/build evidence, KiCad library terms and the on-demand distributions. The repository's first-party license has not been selected. The local artifact and successful technical checks do not constitute a legal decision or approval to publish it.
