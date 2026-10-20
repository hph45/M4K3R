# Parametric mechanical CAD

Part studios contain ordered sketches and solid features. OpenCascade/replicad evaluates their exact B-rep geometry on the local server; the browser receives a mesh for orbitable, selectable preview. Model changes, undo and MCP edits use the same project command system.

## Sketches and features

Create rectangle, circle or interpolating cubic-spline sketches in the browser. Choose XY/XZ/YZ with an offset, or click **Sketch on face** and pick inside a planar face. A face sketch uses a stable local frame at the face center. A geometric normal query can follow an upstream dimension edit; a picked `near` point that no longer matches reports a reselection error instead of choosing another face silently.

The command API additionally supports points, lines and arcs, construction geometry and constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, midpoint, symmetric, fix, distance, angle, radius and diameter. Splines interpolate their points with cubic Bezier segments; individual points are referenced as `splineId.p0`, `splineId.p1`, etc. Their control points can participate in point constraints. Closed splines form a real curved profile; an open spline can be joined to other profile curves or marked construction.

Extrude and shell have browser editing forms. The feature list supports selecting, suppressing, removing and rolling back. More advanced feature operations are available through commands: revolve, fillet, chamfer, hole with M2–M6 presets, linear/circular pattern, mirror and boolean. A failing feature stops later evaluation and retains the complete solid from before that feature, including failures partway through a pattern or boolean.

## Dimensions and variables

Lengths are millimeters and angles are degrees. Every dimension accepts a number or an expression, such as `3 mm`, `3/8 in`, `board_width + 2*wall`, or `max(12, spacing)`.

```jsonc
{ "material": "PLA", "features": [
  { "id": "outline", "type": "sketch", "plane": "XY",
    "entities": [{ "type": "rectangle", "id": "r", "width": "board_width + 2*wall", "height": 45 }] },
  { "id": "body", "type": "extrude", "sketch": "outline", "depth": 22 },
  { "id": "round", "type": "fillet", "edges": { "direction": "z" }, "radius": 4 },
  { "id": "walls", "type": "shell", "faces": { "normal": "+z" }, "thickness": "wall" },
  { "id": "top_sketch", "type": "sketch",
    "face": { "body": "body", "query": { "normal": "+z" } },
    "entities": [{ "id": "mount", "type": "circle", "center": [0, 0], "radius": 3 }] }
] }
```

Project variables are shared with other document domains. References must point to earlier features. Bodies are identified by the feature that created them. Solid features default to a new body for the first feature and addition after it; explicit operations are `new`, `add`, `subtract` and `intersect`.

## Parametric families and assemblies

**Parametric part** creates mounting plates, L brackets, raised mounts and quadcopter frames with real through holes and an editable feature tree. The same form is available as **Printed part** in an assembly. Parameters include width/length/height, thickness, hole diameter and X/Y spacing; frames add motor diagonal and arm width. Frame templates include four motor pads with 16 × 19 mm hole patterns and a center mounting pattern. These are editable planning dimensions rather than certification of a particular motor or frame.

```jsonc
{ "type": "cad.template.create", "args": {
  "name": "Controller bracket", "family": "bracket",
  "width": "board_width + 8", "length": 50, "height": 25,
  "thickness": "wall", "holeSpacingX": 30.5, "holeSpacingY": 30.5, "holeDiameter": 3.4
} }
```

Place studio solids together with catalog components and PCBs in an [assembly](assembly.md). A studio can supply its entire solid set or an individual body. Assembly mounting anchors follow hole features and parametric dimensions. Components remain one shared BOM identity across electrical and mechanical workspaces.

## Commands, queries and export

The ordinary project command endpoint and MCP `apply_commands` expose `cad.sketch.add`, `cad.feature.add/update/remove/move`, `cad.material.set` and `cad.template.create`. `GET /api/commands` describes their exact schemas.

| Endpoint | Result |
|---|---|
| `GET /api/projects/:id/cad/:doc/mesh` | Triangle/edge meshes, solved sketches, feature status and first error |
| `GET /api/projects/:id/cad/:doc/properties` | Volume, area, material density, mass, CG, bounds and per-body properties |
| `GET /api/projects/:id/cad/:doc/export.stl` | Binary STL |
| `GET /api/projects/:id/cad/:doc/export.step` | Analytic STEP with named solids |
| `GET /api/projects/:id/cad/:doc/export.3mf` | Millimeter 3MF package with one object per body |

Mesh/properties accept `?until=<feature>` for rollback. Properties accept an optional material override. MCP `cad_properties` returns properties and feature diagnostics; `cad_export` writes STL/STEP/3MF to the requested path or the project's exports directory. Failed or empty studios cannot be exported.

The viewport uses resolved theme colors, backface culling, coherent B-rep face fills and depth-tested visible outlines. Drag to orbit, scroll to zoom, or use arrow keys, +/- and Home. Standard Top/Front/Right/Fit buttons and an orientation triad remain available. This is a modeling preview; the STEP solid is the authoritative geometry for manufacturing and interference.

The manufacturing helper also builds exact PCB solids from polygon outlines with circular drills and capsule slots for board STEP and assembly fit checks. 3MF packages contain Open Packaging relationships, core model resources and build items, with declared millimeter units.

## Current boundaries

This version supports planar face sketches, interpolating splines, constrained analytic sketch entities, ordered solid modeling, print exports and fastened mechanical assemblies. It does not implement sweep/loft, sculpting, nonplanar face sketch mapping, automatic topological face healing or a browser-local CAD kernel. Tangency/curvature constraints on spline curves themselves are not exposed; point constraints and the interpolation geometry are supported. Geometric edge/face picks report a clear error when upstream edits invalidate them.
