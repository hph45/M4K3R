# M4K3R

Design a whole device in the browser: the enclosure, the circuit, the PCB and the firmware. Then simulate it all together before you build anything.

```bash
pnpm install
pnpm dev          # → http://localhost:4400
```

Requires Node 24+ and pnpm. Projects are saved in `~/M4K3R` (override with `M4K3R_HOME`).

**AI agents:** `claude mcp add --transport http m4k3r http://localhost:4400/mcp`. See [docs/api.md](docs/api.md).

Start with **[docs/](docs/README.md)**.
