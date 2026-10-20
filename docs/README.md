# M4K3R

**Design a whole device in the browser:** the enclosure, the circuit, the PCB and the firmware. Then run all of it together before you build anything.

Runs locally. Clone the repo, run `pnpm dev`, and open http://localhost:4400.

The local v1 release candidate connects graphical circuits, two-layer PCB design and fabrication output, parametric CAD/assemblies, real Pico/ESP32 firmware, supported device co-simulation and weight/thrust planning. Click **Try a demo** for a small circuit or **Plan a drone** for the complete integration example. See [v1 acceptance](v1-acceptance.md) for tested workflows and fidelity limits.

## Principles

1. **Simple is better.** Every screen, feature and doc should be as small as it can be and still do the job.
2. **One project, many views.** A component like `U1` exists once. The schematic, PCB, 3D assembly, simulation and firmware are all views of the same thing.
3. **Calm UI.** Keep chrome sparse, show tools in context, and put every command behind `⌘K`. Defaults should just work, and advanced options stay hidden until they're needed.
4. **Instant feedback.** Every edit re-runs the relevant checks (ERC, DRC, fit, power budget) right away.
5. **Plain files.** A project is a folder of JSON and source files, so it can be diffed and kept in git.
6. **Agents are users too.** Anything you can do in the UI, an AI agent can do through the [API](api.md), and you'll see its edits appear live.
7. **General purpose.** Nothing in the product is specific to one project.

## Docs

| Doc | Covers |
|---|---|
| [architecture.md](architecture.md) | Stack, packages, project format, key decisions |
| [api.md](api.md) | HTTP API and MCP tools for agents |
| [cad.md](cad.md) | Parametric sketches and printable solids |
| [assembly.md](assembly.md) | Catalog parts, mounting, mass/CG/inertia and fit |
| [pcb.md](pcb.md) | Board design, DRC and fabrication |
| [electronics.md](electronics.md) | Parts library, schematic, PCB, fab outputs |
| [firmware.md](firmware.md) | Editor, toolchain, pin header generation, flashing |
| [simulation.md](simulation.md) | Co-simulation engine and component models |
| [roadmap.md](roadmap.md) | Milestones, parallel workstreams, open questions |

## Non-goals for v1

Real-time multi-user editing, RF field or EM simulation, FEA, six-axis flight certification, particle physics, global autorouting, 2D manufacturing drawings, mobile, and public hosting. ESP32-C3 machine-code emulation is supported; its external peripheral coupling limits are described in the acceptance document.
