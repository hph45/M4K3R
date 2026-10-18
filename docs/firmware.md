# Firmware

Write Arduino C++, build it, run it in the simulator, then flash the exact same binary to real hardware.

## Targets

A project can have several firmware targets, one per MCU, e.g. a robot and its remote. Each target is a `firmware` doc, and its sources live in the doc, so edits get undo and live sync like everything else.

```jsonc
{
  "mcu": "c_k3j9x2mq",               // component id (commands also accept a ref like U1)
  "board": "rpipico",                // arduino-pico board id
  "libs": ["RF24@1.4.11"],           // pinned versions
  "main": "main.ino",
  "files": { "main.ino": "…", "src/radio.cpp": "…" }
}
```

Commands: `firmware.file.write`, `firmware.file.remove`, `firmware.set` (mcu, board, libs, main).

## Pin header (generated)

M4K3R generates `m4k3r_pins.h` from the schematic. Net names become pin constants.

```cpp
// Generated from schematic. Do not edit.
#define PIN_MOTOR_PWM  10   // net MOTOR_PWM → U1.GP10 (PWM5A)
#define PIN_STATUS_LED 15   // net STATUS_LED → U1.GP15
```

Rewire the schematic and the header updates. Firmware never hard-codes pin numbers.

**Pin check:** after a build, the simulator watches which pin functions the firmware actually configures. It flags mismatches, like a PWM on a pin whose net goes to a button.

## Editor

- Monaco with C++ highlighting, plus compiler diagnostics shown inline
- File tree per target
- Library picker, limited to a curated, version-pinned list for v1

## Builds

The local server compiles:

```
POST /api/projects/:id/firmware/:doc/build  →  { ok, hash, diagnostics[], size, artifacts: [elf url, uf2 url] }
```

- On the first build, the server downloads arduino-cli 1.5.1 and the arduino-pico 6.2.0 core into `~/M4K3R/.toolchains` (a few minutes, about 1.8 GB). Each pinned library version gets its own folder there.
- Builds are cached by a content hash of the inputs in `~/M4K3R/.cache/builds/<hash>/`. Rebuilding unchanged code is instant.
- Arduino's `ctags` (which adds function prototypes to `.ino` files) only exists for Intel on macOS. On Apple Silicon without Rosetta, prototypes are skipped, so declare functions before use (or run `softwareupdate --install-rosetta`).

## Run

| Where | How |
|---|---|
| Simulator | The `.uf2` loads into rp2040js with the RP2040 B1 bootrom. Breakpoints come in a later milestone via rp2040js's GDB stub. |
| Headless | `POST /api/projects/:id/firmware/:doc/run { ms }` runs it for `ms` of simulated time and returns serial output and the final GPIO states |
| Real board | Download the `.uf2` and drag it onto the RPI-RP2 drive |
| Serial | One serial monitor works for both the simulator and real hardware (Web Serial) |

In the simulator, `Serial` is USB CDC, as on a real Pico, and `Serial1`/`Serial2` are UART0/UART1. Like real hardware, anything printed before USB enumerates (the first ~100 ms) is lost unless the sketch waits with `while (!Serial)`.

## Curated libraries (v1)

| Library | For |
|---|---|
| RF24 | nRF24L01+ radios |
| Adafruit SSD1306 + GFX | OLED displays |
| SD (arduino-pico) | microSD logging |
| Adafruit BMP280 | Temperature/pressure sensor |

Every library on this list needs a matching device model in the simulator (see [simulation.md](simulation.md)).

## Later

MicroPython, which runs fully in-browser with no build server. Also a step debugger, and clangd for autocomplete.
