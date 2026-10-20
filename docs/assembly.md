# Mechanical assemblies

An `assembly` document places existing project components, parametric CAD bodies and PCBs in one mechanical workspace. A catalog insertion creates a normal project component and an assembly placement in one undoable command batch. Placing an existing component only creates the placement: the component and its BOM identity remain shared with Wiring, the PCB editor and device analysis.

## Browser workflow

Create an assembly with **New document → New mechanical assembly**, or the command palette. Then:

1. **Catalog part** finds screws, nuts, bearings, shafts, gears, brackets, modules and other parts. **Existing component / CAD / PCB** places something already in the project.
2. **Printed part** creates an editable mounting plate, L bracket, raised mount or quadcopter frame. Dimensions and hole patterns accept project-variable expressions. The generated CAD studio also appears in the document tabs.
3. Select an instance in the tree or click its solid. Edit XYZ position and Euler rotation, use axis nudge buttons, or snap its position to a chosen grid. **Fix** protects a placement from manual movement.
4. **Mount / fasten** joins a mounting-hole ID or origin/center/top/bottom anchor to an anchor on another instance. Spacing and twist remain editable. The mounted item follows target movement and parametric geometry changes. **Detach at current pose** preserves the world placement.
5. **Part family dimensions** configures the existing component's physical XYZ size and mass. This supports changing screw length, shaft length, plate dimensions and similar dimensional families without creating a second BOM part. Mount-hole positions scale with the family dimensions. For detailed printable geometry, use a CAD template and edit its features instead.
6. **Check interference** reports positive-volume solid intersections and keepout overlaps. STEP exports the assembled model. **Print CAD 3MF** exports only placed CAD studios, with millimeter units and a separate object per instance. An individual selected placement can also be exported to STL.

Mass, world center of gravity and the full inertia tensor appear in the left panel. The gold CG marker follows edits. Hiding a placement only affects its visibility; the part still contributes mass and fit checks.

## Data and transforms

```jsonc
{
  "instances": [
    { "id": "frame", "source": { "type": "cad", "doc": "frame-studio-id" },
      "position": [0, 0, 0], "rotation": [0, 0, 0], "fixed": true },
    { "id": "motor1", "source": { "type": "component", "component": "component-id" },
      "position": [60, 60, 8], "rotation": [0, 0, 45] },
    { "id": "board", "source": { "type": "pcb", "doc": "pcb-doc-id" },
      "mount": { "target": "frame", "sourceAnchor": "bottom", "targetAnchor": "top",
        "distance": 12, "twist": 0, "flip": false } }
  ]
}
```

Positions are millimeters. Rotation is degrees about local X, then Y, then Z (`Rz × Ry × Rx`). Unmounted poses are world poses. A mount computes its pose from the target and anchors on every evaluation; stored free-pose fields do not override an active mount. Mount cycles, dangling targets and duplicate placements of the same project component within one assembly are rejected. Multiple instances of a CAD studio are allowed.

Catalog geometry is centered at its local origin. Catalog mounting holes include an explicit axis. A CAD studio retains its modeling coordinate system. Its hole features expose stable anchors named `holeFeature.pointEntity`, for example `mounting_holes.h1`. Construction points in CAD sketches also expose anchors named `sketchFeature.pointEntity`; these points do not drill material. The frame template uses `motor_holes.center0` through `center3` to keep mounted motors aligned when wheelbase or frame thickness changes. A PCB uses its editor's X-right/Y-down coordinates, bottom Z=0 and top Z=thickness; rotate the instance when another board orientation is needed.

## Commands

Use the ordinary `POST /api/projects/:id/commands` endpoint or MCP `apply_commands`.

| Command | Arguments |
|---|---|
| `assembly.instance.add` | `doc`, `source`, optional `id`, `position`, `rotation`, `name`, `fixed` |
| `assembly.instance.update` | `doc`, `instance`, optional pose/name/visible/fixed fields; `mount: null` detaches |
| `assembly.mount` | `doc`, `instance`, `target`, `sourceAnchor`, `targetAnchor`, `distance`, `twist`, `flip` |
| `assembly.instance.remove` | `doc`, `instance`; mounted children must be detached first |
| `assembly.component.configure` | `component`, optional `size: [x,y,z]`, `mass`, `holeDiameter`, `reset` |
| `cad.template.create` | `name`, `family: plate/bracket/mount/frame`, dimensions and hole-pattern parameters |

Component and document names/refs accepted by add commands are normalized to stable project IDs. Physical-family overrides are stored in `component.props` under `physical.size.x/y/z`, `physical.mass` and `physical.holeDiameter`. Values accept shared project-variable expressions. The catalog definition remains unchanged. If size is changed without supplying mass, mass scales by volume ratio and is marked estimated.

Circular cylinder, bearing, gear and fastener families require equal X and Y outside diameters. Set both together when changing diameter; an unequal pair is rejected by configuration and evaluation, including direct property overrides. Z independently controls length or thickness. These remain planning proxies; gear teeth and threads are not modeled.

## API and MCP

| Endpoint | Result |
|---|---|
| `GET /api/projects/:id/assembly/:doc/mesh` | Evaluated instances and transformed meshes, mass/CG/inertia, anchors and model notes; add `?interference=1` for fit checks |
| `GET /api/projects/:id/assembly/:doc/properties` | Properties without mesh arrays, including fit checks |
| `GET /api/projects/:id/assembly/:doc/interference` | Solid intersections and keepout violations |
| `GET /api/projects/:id/assembly/:doc/export.step` | Assembled analytic STEP geometry |
| `GET /api/projects/:id/assembly/:doc/export.stl` | Assembled binary STL |
| `GET /api/projects/:id/assembly/:doc/export.3mf` | Multi-object 3MF |

Export query `?instance=<id>` selects one placement. `?printable=1` selects only CAD-studio placements. MCP tools `assembly_properties`, `assembly_interference` and `assembly_export` expose equivalent behavior; `assembly_export` also accepts an output path and `printableOnly`.

For server-side analysis, `evaluateAssembly(project, docOrData, { interference: false })` is exported from `@m4k3r/assembly/node`. Browser-safe schemas, result types and transform helpers are exported from `@m4k3r/assembly`. Each evaluated instance includes its original source component ID, world center, local +Z axis in world coordinates, bounds, mass and tensor, so drone analysis consumes the same placed components.

## Accuracy and fit checks

- CAD mass, CG and uniform-density inertia come from the exact OpenCascade solid. Material density is in g/cm³. STL/3MF tessellation affects export surfaces, not these properties.
- Catalog models use dimensional proxy solids, with mass provenance retained. Manufacturer or measured mass can be recorded in the catalog definition; the included generic catalog uses estimates. Configured mass remains explicitly estimated. Unknown mass is excluded and reported rather than guessed.
- Tensor units are g·mm² about the assembled CG in world axes. Multiply by `1e-9` for kg·m². The parallel-axis theorem combines each instance's rotated tensor.
- PCB mass is bare-board FR4 from its actual outline and drilled/slotted voids. It excludes separately placed components, avoiding duplicate mass.
- Solid interference uses actual positive intersection volume. Touching faces with no volume are allowed. CAD/PCB geometry is analytic; catalog checks are as accurate as their proxy shape. Keepout regions use oriented boxes intersected with the actual placed solids. If an exact check fails, conservative bounding-box fallback is explicitly marked `bounds` and reported in model notes.
- Fastened mounts and free XYZ/rotation are supported. Articulated joint dynamics, contact simulation, flexible belts, manufacturer STEP import and production fastener/thread standards are separate capabilities; geometric proxies must not be treated as vendor manufacturing drawings.
