# Roadmap

M0 freezes the contracts. After that, three workstreams run in parallel and meet in v1.

```
        ┌─► A  CAD ──────────────┐
M0 ─────┼─► B  Electronics ──────┼─► v1
        └─► C  Sim + Firmware ───┘
```

## M0: Foundations

- pnpm monorepo, Vitest, typecheck
- `core`: project schema, commands with undo/redo, units parser, netlist
- Local server: file store, JSON API, MCP, WebSocket live updates, and the UI served on one port
- UI shell: project list, document tabs, `⌘K` palette, a components and nets view, light/dark theme
- Generic parts library (R, C, L, LED, diode, button, switch, battery, motor, header)

**Exit:**
1. `pnpm dev` and create a project.
2. An agent wires it over MCP while the UI updates live.
3. Undo works.

## Workstreams

| | A: CAD | B: Electronics | C: Sim + Firmware |
|---|---|---|---|
| Step 1 | Sketcher + planegcs, extrude | KiCad symbol/footprint import, schematic editor | Engine core, MNA, R/C/L/diode/LED, headless tests |
| Step 2 | Full v1 feature set, variables | ERC, PCB placement + routing | rp2040js + pin bridges, toolchain, button/battery/motor/H-bridge/nRF24 |
| Step 3 | Assemblies, mates, mass properties, STL/STEP | Zones, DRC, fab outputs, board 3D | Instruments, scenarios, skid-steer physics |

**Staying independent:**
- C works from the netlist in `core`, so it doesn't wait for the schematic editor.
- A doesn't need boards until integration.
- Each capability ships with its API commands and read tools, so agents can use it on day one.

## v1

A complete device can go from idea to fab-ready boards, printable parts, and firmware verified in simulation. That includes the enclosure, multiple boards and MCUs, radios, motors, sensors, and precision analog. It works the same whether a person or an agent is driving.

## Contributing

- One branch per workstream, small PRs
- Docs are living, and they stay short. If code and doc disagree, fix one of them in the same PR.
- Every model, check and command lands with a test
