# Two-layer PCB workspace

Create **New PCB…** from **＋ New document** or the command palette. Physical layout lives in the PCB document; component definitions and electrical nets remain shared with Wiring, firmware and simulation.

## Placement and board shape

**Sync footprints** places missing electrical components with real vendored footprints. Drag a footprint in **Place** mode, edit rotation, or flip it to the bottom. Pad polygons include footprint rotation and bottom-side mirroring. Through-hole pads and vias connect both layers; SMD pads belong to their actual side. A missing footprint is an error, never an invented land pattern.

The **On-board / off-board components** checklist excludes external devices from a carrier board while keeping them in the project and assembly BOM. `pcb.exclude {doc, components:["M1","BT1"], excluded:true}` accepts refs or IDs. Include a component again and Sync to place it. PCB fabrication BOM includes board-mounted parts only.

The board is a closed polygon with configurable thickness. Draw corners using **Board outline**, then Enter, or enter precise x,y pairs in the inspector. Self-crossing and zero-area outlines are rejected. **Mounting hole** adds circular non-plated holes. Imported pads can also contain real plated/non-plated holes and oblong drill slots.

Coordinates are millimetres, x right and y down. Board-local z is up: bottom z=0 and top z=thickness. Assemblies link the board without duplicating its components.

## Routing and pours

Select **Route**, a layer, net and width. Click a pad to start, add waypoints, and click a compatible pad to finish. Enter finishes an open trace, Backspace removes a waypoint, and Escape cancels. **V** routes to the cursor, adds a plated through via and continues on the other layer. PCB routing never merges different shared nets.

The walkaround router tries direct/right-angle paths, then a bounded 45°/90° grid search around foreign copper, non-plated holes and board edges. It respects width and clearances and leaves existing copper in place. Dense routing can require waypoints, another layer or moving parts. A failure is reported instead of inserting a short.

**Copper zone** draws a net-linked polygon. Fill is clipped to the board inset and clears foreign copper/non-plated holes. Thermal mode creates four spokes at same-net pads. The editor, checks, connectivity graph and Gerber writer use the same filled polygons.

Presets are Default 0.25 mm, Power 0.5 mm, Motor 1 mm and HV 0.3 mm/0.5 mm clearance. Assign classes per net. Manufacturing limits are editable generic prototype defaults; confirm them against the selected fabricator and stackup.

Moving a footprint leaves committed copper explicit. Ratsnest/DRC reveal disconnected pads; reconnect exposed ends or replace the track. Tracks can be selected to edit width, layer and net. Tracks, vias, zones, holes and placements can be removed and undone.

## Checks

The ratsnest derives connectivity from overlapping same-net copper, vias and plated pads across both layers. Isolated zone islands remain separate conductors. It draws a minimum connecting set between disconnected pad groups.

DRC reports missing/unplaced footprints, stale net IDs, shorts, clearances, trace width, drill sizes, annular rings, board-edge clearance, courtyard overlaps, unsupported pad contours and unrouted connections. Clicking an issue selects its item/component and centers its location. Off-board parts do not produce placement/footprint errors.

Courtyard overlap is a warning; electrical/manufacturing failures are errors. Fabrication download blocks errors. API/MCP `allowErrors` is explicit and marks experimental packages; unsupported custom/trapezoid pad contours always block export. Checks do not certify thermal performance, impedance, hazardous-voltage creepage or a fabricator's complete process rules.

## 3D, assembly and export

**3D board** shows the bare board with actual circular/slot voids. Mesh and estimated FR-4 mass/center of mass share the same material geometry. Assembly source `{type:"pcb",doc:<id>}` uses the bare board; add physical component instances independently to avoid double-counting mass. **Board STEP** is an actual OCCT boundary solid including drill cuts and slots.

**Fabrication ZIP** contains front/back copper, solder masks, SMD paste and silkscreen Gerber X2; closed Edge.Cuts; separate PTH/NPTH Excellon with G85 slots; BOM and SMT pick-and-place CSVs; exact `Board.step`; DRC report, source snapshot and instructions.

Gerber uses metric 4.6 absolute coordinates and regions, following the [Ucamco format specification](https://www.ucamco.com/en/guest/downloads/gerber-format). Drill files use explicit metric decimal coordinates. All layers are viewed from top. Origin is the lower-left board bounding corner, shared with pick-and-place; positive rotation is counterclockwise. Through-hole parts are omitted from the SMT placement list. Masks expand pads by 0.05 mm; paste uses SMD copper lands.

Silkscreen exports line/circle/rectangle footprint artwork and reference designators. Imported free text and arc artwork are omitted and recorded in the package instructions. STEP is the bare board rather than a vendor-model assembly. Review the generated package in a CAM viewer and confirm stackup, tolerances, orientation and assembly conventions before ordering.

## API and verification

Commands use normal atomic history: `pcb.sync`, `pcb.exclude`, `pcb.place`, `pcb.outline.set`, `pcb.track.add/update`, `pcb.via.add`, `pcb.hole.add`, `pcb.zone.add`, `pcb.remove`, `pcb.rules.set`, `pcb.netclass.set`.

Read APIs under `/api/projects/:project/pcb/:doc/`: `geometry`, `drc`, `mesh`, `export.step`, `fabrication.zip`. MCP tools `pcb_check`, `pcb_geometry` and `pcb_export` provide the same checks/geometry and real file export.

`packages/ecad/src/pcb.test.ts` verifies transformed pads, undo, via connectivity, walkaround, zone isolation/thermals, shorts/manufacturing limits, exclusions, drilled volume/mass, exact Gerber/Excellon coordinates and ZIP contents. `tests/e2e/pcb.spec.ts` creates a board through the UI, moves/undoes a footprint, routes pads, verifies DRC, reloads, downloads fabrication and opens 3D. Its 2D/3D screenshots are visually inspected during development.
