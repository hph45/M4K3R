# Firmware

Write Arduino C++, build it, run it in the simulator, then flash the exact same binary to real hardware.

## Targets

A project can have several firmware targets, one per MCU, e.g. a robot and its remote.

```jsonc
// a firmware target
{
  "mcu": "U1",                       // component id in the schematic
  "board": "rpipico",                // arduino-pico board id
  "libs": ["RF24@1.4.11"],           // pinned versions
  "main": "main.ino"
}
```

## Pin header (generated)

M4K3R generates `m4k3r_pins.h` from the schematic. Net names become pin constants.

```cpp
// Generated from schematic. Do not edit.
#define PIN_L_IN1   10   // net L_IN1 → U1.GP10 (PWM5A)
#define PIN_RF_CE   20   // net RF_CE → U1.GP20
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
POST /api/projects/:id/firmware/:target/build  →  { uf2, elf, diagnostics[] }
```

- On the first build, the server downloads arduino-cli, the arduino-pico core and the curated libraries into `~/M4K3R/.toolchains`. All versions are pinned.
- Builds are cached by a content hash of the inputs. Rebuilding unchanged code is instant.

## Run

| Where | How |
|---|---|
| Simulator | The `.elf` loads into rp2040js. Breakpoints come in a later milestone via rp2040js's GDB stub. |
| Real board | Download the `.uf2` and drag it onto the RPI-RP2 drive |
| Serial | One serial monitor works for both the simulator and real hardware (Web Serial) |

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
