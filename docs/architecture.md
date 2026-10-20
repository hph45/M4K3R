# Architecture

## Shape of the system

```
 Browser UI ──────┐                      ┌────── AI agent (Claude Code, …)
 (React, workers) │ HTTP + WebSocket     │ MCP or HTTP
                  ▼                      ▼
        ┌──────────────── Local server :4400 ─────────────────┐
        │  UI assets · JSON API · MCP · live updates (WS)     │
        │  applies commands → saves files → broadcasts patches│
        │  firmware builds (arduino-cli, auto-installed)      │
        └────────────────────────┬────────────────────────────┘
                                 ▼
                     ~/M4K3R/projects/*   ~/M4K3R/parts/*
```

**Start it:** `git clone … && pnpm install && pnpm dev`. Everything is on one port.

**The server is the single writer.** The UI and agents both send the same **commands**. The server applies them, saves to disk, and broadcasts the patch to every connected client. That's why an agent's edit shows up in your browser immediately.

**Execution placement:** CAD/assembly evaluate on the local server using the real OCCT kernel. Analog simulation runs in a browser worker for interactive feedback. Coupled MCU/device execution and firmware compilation run on the server. `core`, `ecad` and `sim` use the same TypeScript contracts in the browser and Node. Browser-safe assembly types/math are separate from its Node evaluator.

## Stack

| Concern | Choice |
|---|---|
| Language | TypeScript everywhere |
| Server | Node 24, Express, `ws`, MCP SDK (Streamable HTTP) |
| UI | React + Vite (served through the server in dev), Zustand |
| 3D | Opaque Canvas mesh viewport with orbit, picking, anchors and CG markers |
| CAD kernel | OpenCascade (OCCT) WASM, through [replicad](https://replicad.xyz) |
| Sketch solver | planegcs (FreeCAD's solver, WASM) |
| 2D canvas (schematic, PCB) | SVG with shared transformed geometry and interactive editing |
| Polygon ops (copper pours) | polygon-clipping; earcut for board triangulation |
| MCU emulation | [rp2040js](https://github.com/wokwi/rp2040js) and checksum-pinned Espressif ESP-EMU WASM |
| Circuit analysis | MNA behavioral solver now; ngspice WASM planned |
| Code editor | Locally bundled Monaco C++, inline compiler markers and plain-text fallback; recoverable drafts |
| Schemas | zod, so one definition gives types, validation and API docs |
| Edits | immer patches, so undo/redo and live sync come free |
| Tests | Vitest |
| Repo | pnpm workspace. Internal packages are consumed as TS source, with no build step. |

## Packages

```
apps/server       local server: API, MCP, WS, file store, firmware builds
apps/web          UI shell and registered domain workspaces
packages/core     project model, schemas, commands, units, netlist
packages/parts    KiCad importers, part utilities
packages/cad      feature evaluation (OCCT)
packages/ecad     schematic/PCB geometry, ERC/DRC, copper routing and fabrication
packages/sim      MNA models, MCU bridges, protocols, scenarios, vehicles and device analysis
packages/firmware pinned compilers, real MCU runtimes and peripheral adapters
packages/assembly catalog/CAD/PCB placement, mounting, mass/inertia and interference
library/parts     built-in generic parts (R, C, LED, button, …)
```

**Contracts are the only coupling.** Workspaces talk to each other only through `core` types and commands.

**Each workstream plugs in as a domain:**

```ts
// apps/server/src/domains/<name>.ts, then one line in domains/index.ts
{ name, commands, setup(ctx), routes(router, ctx), tools(mcpServer, ctx) }
```

A domain registers its doc kinds (`registerDocKind("part-studio", schema)`), its commands (`cad.extrude`…), its API routes and its MCP tools. Shared files never need editing.

## Project model

The **component** is the hub. Every domain points at it by id.

```ts
interface Project {
  id: string; name: string; version: number
  variables: Variable[]                 // shared by CAD and PCB, e.g. pcb_w = 65 mm
  parts: Record<string, Part>           // vendored copies of every part used
  components: Component[]               // { id, ref: "U1", part, props }
  nets: Net[]                           // { id, name, pins: [{ component, pin }] }
  docs: Doc[]                           // { id, kind, name, data }: part studios, schematics, boards…
}
```

**Connectivity lives in `nets`.** A schematic only places symbols and draws what the nets say. So an agent can wire a circuit with `net.connect` and never touch layout.

| View | References component by |
|---|---|
| Schematic | symbol instance |
| PCB | footprint instance |
| Assembly | 3D instance |
| Simulation | model instance |
| Firmware | generated pin names (`PIN_L_FWD`) |

## Files on disk

`M4K3R_HOME` defaults to `~/M4K3R`:

```
~/M4K3R/
  parts/<id>/part.json             your own parts library (added by you or an agent)
  projects/<id>/
    project.json                   name, variables, components, nets, doc order
    parts/<id>/part.json           vendored parts
    docs/<id>.json                 one file per doc
```

Geometry, netlists and check results are derived and never saved.

## Conventions

- **Units:** lengths are stored in mm (CAD, PCB) and simulation values in SI. Inputs accept `2k2`, `100n`, `3/8 in`.
- **Pins** are addressed as `REF.PIN`, e.g. `U1.GP10`.
- **Every change is a command:** `{ type: "net.connect", args: {…} }`. Commands are pure functions of the project, validated by zod. They're listed at `GET /api/commands`.

## Key decisions

| Decision | Choice | Why | Revisit if |
|---|---|---|---|
| Delivery | Local server + browser UI | Clone and run. Real files on disk. Agents get an API. | We want a hosted version |
| Writes | Server applies all commands | One source of truth. Live sync for UI and agents. | Multi-user editing (likely Yjs) |
| MCU for v1 | RP2040 and supported ESP32 targets | Actual machine-code execution; Pico offers richer peripheral coupling. | More verified adapters are needed |
| Firmware | Arduino C++ (pinned arduino-pico / Espressif cores) | Huge library ecosystem. Code runs unmodified on hardware. | Users want MicroPython |
| Compile | Server runs arduino-cli, which is fetched on first build | No in-browser ARM GCC. No Docker required. | A clang-wasm toolchain matures |
| CAD kernel | OCCT via replicad | Real B-rep, fillets, STEP I/O | Size or performance blocks us |
| Footprints and symbols | Import KiCad libraries | Thousands of vetted parts | — |
| Live sim | Behavioral models + small MNA solver | Fast enough to run interactively with firmware | Accuracy gaps that SPICE can't cover |
| Detailed analog | MNA behavioral solver; ngspice remains future scope | Current component models publish their assumptions. | Precision models require SPICE |
