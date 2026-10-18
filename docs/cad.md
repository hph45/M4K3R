# Mechanical CAD

Onshape-style parametric modeling, plus a live link to the electronics.

## Documents

| Doc | Purpose |
|---|---|
| **Part Studio** | Sketches and features that produce one or more bodies |
| **Assembly** | Instances of parts (including PCBs) positioned with mates |

## Sketches

- Can sit on a plane or on a planar face
- Entities: line, arc, circle, rectangle, spline, point, construction geometry
- Constraints: coincident, horizontal, vertical, parallel, perpendicular, tangent, equal, midpoint, symmetric, fix
- Dimensions: distance, angle, radius/diameter, which can be expressions (`pcb_w + 2*wall`)
- Solved live by planegcs. Sketch state is shown by color: under-defined, fully defined, over-defined.

## Features (v1)

Extrude, revolve, fillet, chamfer, shell, hole (with M2/M3/M4 presets), linear and circular pattern, mirror, boolean.
Later: sweep, loft, draft, threads.

The feature list is ordered and has a rollback bar. Editing any feature re-evaluates everything after it.

## Variables

Project variables (`pcb_w`, `wall`, `m2_clearance`) are shared with the PCB editor. Change the board width and the chassis pocket updates with it.

## Assemblies

- Instances can come from Part Studios, boards, or imported STEP files
- Mates: fastened, revolute, slider, cylindrical, planar
- Drag a part to see its degrees of freedom
- Interference check, measure, section view
- Mass properties come from material density. They feed the physics simulation.

## ECAD ↔ MCAD link

| Direction | What flows |
|---|---|
| CAD → PCB | The board outline and mounting holes can reference a sketch |
| PCB → CAD | The board appears as a 3D part (substrate, copper outline, component STEP models) and updates live |

So "does the board fit, do the connectors line up with the cutouts, does the battery clear the standoffs" all get checked in the assembly.

## Export

- STL and 3MF for 3D printing
- STEP for everything else

## Known hard problem

**Topological naming.** When a fillet references "this edge", that edge can change after an upstream edit. v1 handles it this way:
- References prefer sketch entities and datum planes, which are stable.
- Face and edge picks store geometric hints (normal, centroid) and are re-matched after regeneration.
- A failed match shows a clear error on the feature. It never silently picks the wrong edge.

## Done when

A real enclosure with its boards inside can be modeled, driven by shared variables, checked for fit, and exported for printing.
