# Firmware

Write Arduino C++, compile it locally, execute the resulting machine code, and download artifacts for a physical board. Each firmware document has its own source files, MCU, platform, board and pinned libraries. A project can contain several targets, such as a vehicle and its remote.

## Editor and source recovery

The default editor is Monaco with C++ highlighting, line numbers, find/replace, per-file undo/cursor state and inline compiler error/warning markers. Click a diagnostic to reveal its source location. Markers come from the compiler after Build; this is not a clangd language server or live C++ type checker. Monaco and its worker are bundled locally, without an editor CDN.

**Plain text** switches to an accessible textarea; **C++ editor** switches back. The browser remembers that preference. Generated `m4k3r_pins.h` is read only in both modes. New source files, remove-file controls and the main sketch choice are available in the workspace.

Edits are retained as local drafts immediately, including across document navigation and reloads. Save writes them to the project with undo history and live sync. Build and Run save first. Drafts edited while a save is in flight remain unsaved. If the project source changes elsewhere, the local draft is retained and the conflict is visible; Save replaces the project file. A visible warning reports unavailable browser storage. Local drafts are specific to this browser and are not a substitute for saving the project.

## Targets and generated pins

```jsonc
{
  "platform": "rp2040",           // rp2040 or esp32
  "mcu": "c_k3j9x2mq",            // component id; commands also accept U1
  "board": "rpipico",             // id within the selected core; ESP example: esp32c3
  "libs": ["RF24@1.4.11"],        // exact library versions
  "main": "main.ino",
  "files": { "main.ino": "…", "src/radio.cpp": "…" }
}
```

Commands are `firmware.file.write`, `firmware.file.remove` and `firmware.set` (`mcu`, `platform`, `board`, `libs`, `main`). Changing platform selects its default board unless a board is supplied. The Board field takes the board id, not the full core-qualified FQBN: the builder prefixes `rp2040:rp2040:` or `esp32:esp32:`.

The main sketch must be a root-level `.ino` file, such as `main.ino`; supporting C++/header files may live under `src/`.

M4K3R generates `m4k3r_pins.h` from the selected MCU and shared electrical nets. For example, a net named `MOTOR_PWM` on `U1.GP10` produces `#define PIN_MOTOR_PWM 10`. Include this header in the sketch and use those constants; rewiring updates it. A target without an MCU can compile ordinary source but cannot map firmware GPIO back to a project circuit.

## Builds and downloads

`POST /api/projects/:id/firmware/:doc/build` returns `{ok, hash, diagnostics, size, artifacts}`. The same operation is exposed by the `firmware_build` MCP tool.

The local server installs pinned Arduino CLI **1.5.1**, Arduino Pico **6.2.0**, Espressif Arduino **3.3.12** and requested version-pinned libraries under `<M4K3R_HOME>/.toolchains`. The default home is `~/M4K3R`. The first build can take several minutes; the ESP toolchain requires multiple gigabytes. Subsequent builds reuse installed tools and cache identical source/settings/header inputs under `.cache/builds/<hash>`.

RP2040 builds expose `firmware.uf2` and `firmware.elf`. ESP builds expose the compiler's actual ELF, application BIN, bootloader BIN, partition BIN and merged BIN when produced. Artifact links download those build files. A changed source, pin header or target setting is visibly marked as newer than the displayed build. Hardware upload is enabled only for a successful build matching the current saved source/settings.

Arduino's macOS `ctags` binary is Intel-only. On Apple Silicon without Rosetta, prototype generation is skipped; declare functions before use. The compiler still executes real compilation and reports errors.

## Execute compiled firmware

**Run on Pico** or **Run on ESP32** builds and executes machine code for the requested duration, up to 60,000 ms, with a wall-clock cap. The HTTP endpoint is `POST /api/projects/:id/firmware/:doc/run {ms}` and the MCP tool is `firmware_run`. Output includes simulated/wall time, captured serial, GPIO states and warnings. An incomplete run is explicitly marked and retains captured output.

| Platform | Execution and limits |
|---|---|
| RP2040 | The actual UF2 executes in rp2040js with the RP2040 B1 boot ROM. USB CDC `Serial` and UART `Serial1`/`Serial2` are captured. Wait for USB enumeration before early `Serial` output, as on a Pico. |
| ESP32 | The merged image executes in Espressif **ESP-EMU 0.49.0**, downloaded with a pinned checksum. The adapter reports UART and sampled digital GPIO; edge counts are lower bounds. C3 acceptance executes compiled code and verifies UART/GPIO. Other supported emulator chip families depend on the selected board; classic ESP32 emulation is not provided by this adapter. |

Standalone runs do not connect to the analog circuit. For that, use **Firmware + circuit** in Wiring/Schematic or Simulate, select the firmware document with an assigned MCU, and execute a coupled batch. The diagram shows the returned real circuit snapshot and captured serial. RP2040 bridges digital GPIO, averaged hardware PWM and ADC feedback; Pico I²C/SPI device models support the documented sensor/radio workflows. ESP coupling currently supports sampled digital GPIO only: external ADC, PWM waveform, I²C/SPI devices and radio/Wi-Fi are not exposed by this adapter. See [simulation.md](simulation.md) for solver and device limits. These finite batches are explicitly separate from the live analog worker.

## Physical hardware

Open **Physical hardware** in the firmware output area. **Connect serial** invokes the browser device chooser only when clicked. Choose a baud rate before connecting, read received UTF-8 text, send a message with an optional LF/CRLF/CR ending, clear the log, or disconnect. The log retains its latest 128,000 characters. Disconnecting, leaving the firmware document, page unload and unplugging release the reader/writer locks and close the port. The monitor does not automatically reconnect or claim previously authorized devices.

Web Serial requires a supporting desktop browser such as Chrome or Edge and a secure context (HTTPS or localhost). When unavailable, the panel explains this and keeps the firmware download workflow available. See the [Chrome Web Serial API guide](https://developer.chrome.com/docs/capabilities/serial).

For **RP2040**, hold BOOTSEL while connecting USB and copy the exact downloaded `firmware.uf2` to the `RPI-RP2` drive. No browser flasher is needed.

For the verified **esp32c3** board target, **Choose ESP device & flash** selects a device explicitly, uses the official [esptool-js API](https://espressif.github.io/esptool-js/docs/index.html), checks that the detected chip is ESP32-C3, writes the current merged image at address **0**, and resets it. Disconnect the serial monitor first. Some boards require holding BOOT to enter the ROM loader. The build's C3 bootloader/partition/application offsets were checked against actual compiler output. Flashing other ESP layouts remains disabled; download their artifacts and follow their board's upload procedure. No physical device was flashed during automated acceptance, so USB driver, reset wiring and individual-board compatibility remain hardware validation tasks.

Changing source or target while the chooser, artifact download or bootloader connection is pending cancels the prepared upload before writing. Once writing begins, later editor changes do not interrupt that flash.

## Verification and remaining scope

Unit tests cover source/draft conflicts, saves during edits, empty-source presence, real UF2 parsing, and serial UTF-8/lock cleanup. Browser tests exercise Monaco editing/recovery/project undo, actual inline diagnostic markers, plain-text accessibility, unsupported Web Serial, explicit chooser behavior, monitor read/write/navigation cleanup and stale-build flash blocking. Compiler/emulator acceptance separately executes real Pico and ESP32-C3 builds, serial/GPIO and coupled MCU/circuit feedback.

Clangd completion, step debugging, physical debugger support, MicroPython and arbitrary-board browser flashing are not implemented. Libraries accept pinned `name@version` specifications; a curated library-picker UI is not present. A successful compile does not imply every external peripheral has a simulator model.
