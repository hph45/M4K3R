import { z } from "zod"

export const PinType = z.enum(["power_in", "power_out", "input", "output", "bidir", "passive", "open_drain", "nc"])

export const Pin = z.object({
  num: z.string().min(1).describe("Physical pin/pad number, unique within the part"),
  name: z.string().min(1).describe("Logical name, e.g. GP10 or VCC"),
  type: PinType.default("passive"),
  functions: z.array(z.string()).optional().describe("MCU pin functions, e.g. PWM5A, SPI0_TX, ADC0"),
  voltage: z.tuple([z.number(), z.number()]).optional().describe("Allowed voltage range [min, max] in V"),
})

const XY = z.tuple([z.number(), z.number()])
const stroke = {
  width: z.number().describe("Line width in mm, 0 = default"),
  fill: z.enum(["outline", "background"]).optional().describe("Filled with the line color, or the body color"),
  layer: z.string().optional().describe("Footprints only: KiCad layer, e.g. F.SilkS, F.Fab, F.CrtYd"),
}

/** Drawing primitive. Lengths in mm, y pointing down, angles in degrees counter-clockwise. */
export const Graphic = z.discriminatedUnion("type", [
  z.object({ type: z.literal("poly"), pts: z.array(XY).min(2), ...stroke }),
  z.object({ type: z.literal("rect"), start: XY, end: XY, ...stroke }),
  z.object({ type: z.literal("circle"), center: XY, radius: z.number(), ...stroke }),
  z.object({ type: z.literal("arc"), start: XY, mid: XY, end: XY, ...stroke }),
  z.object({
    type: z.literal("text"),
    text: z.string().describe("${REFERENCE} and ${VALUE} are replaced by the component's"),
    at: XY,
    size: z.number(),
    rot: z.number().optional(),
    layer: z.string().optional(),
  }),
])

export const SymbolPin = z.object({
  num: z.string().describe("Pin number; name and type come from the part's pins"),
  at: XY.describe("Connection point"),
  rot: z.number().describe("Direction from the connection point toward the body: 0 right, 90 up, 180 left, 270 down"),
  length: z.number(),
  hidden: z.boolean().optional(),
})

export const PartSymbol = z.object({
  source: z.string().optional().describe("Where it came from, e.g. KiCad Device:R"),
  units: z
    .array(z.object({ name: z.string().optional(), graphics: z.array(Graphic), pins: z.array(SymbolPin) }))
    .min(1)
    .describe("One per unit (gate) of the part; most parts have one"),
  pinNameOffset: z.number().optional().describe("Pin names sit inside the body at this offset; 0 = beside the pin"),
  hidePinNames: z.boolean().optional(),
  hidePinNumbers: z.boolean().optional(),
})

export const Pad = z.object({
  num: z.string().describe("Matches a pin num; empty for mechanical or paste-only pads"),
  type: z.enum(["smd", "thru_hole", "np_thru_hole", "connect"]),
  shape: z.enum(["rect", "roundrect", "circle", "oval", "trapezoid", "custom"]),
  at: XY,
  rot: z.number().optional(),
  size: XY,
  drill: XY.optional().describe("Hole size [w, h]; equal for round holes"),
  layers: z.array(z.string()).describe("KiCad layers, e.g. F.Cu F.Mask F.Paste, or *.Cu"),
  roundness: z.number().optional().describe("roundrect corner radius as a fraction of the shorter side"),
  poly: z.array(XY).optional().describe("custom pad outline, relative to the pad"),
})

export const PartFootprint = z.object({
  source: z.string().optional().describe("Where it came from, e.g. KiCad Resistor_SMD:R_0603_1608Metric"),
  pads: z.array(Pad),
  graphics: z.array(Graphic).describe("Silkscreen, fab and courtyard drawings, each with its layer"),
  courtyard: z.object({ min: XY, max: XY }).describe("Bounding box of the courtyard"),
})

export const PartId = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "lowercase letters, digits, . _ -")

const XYZ = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()])
export const PhysicalPart = z.object({
  size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]).describe("Overall bounds in mm"),
  mass: z.number().nonnegative().optional().describe("Mass in grams; missing means unknown"),
  centerOfMass: XYZ.default([0, 0, 0]).describe("Local center of mass in mm"),
  inertia: z.tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()]).optional().describe("Local principal Ixx/Iyy/Izz in g mm²"),
  geometry: z.object({
    type: z.enum(["box", "cylinder", "sphere", "propeller", "fastener", "bearing", "gear", "extrusion"]),
    color: z.string().optional(),
    innerDiameter: z.number().positive().optional().describe("Bore diameter in mm for a bearing, spacer, tube or pulley"),
  }),
  mountingHoles: z.array(z.object({ id: z.string(), at: XYZ, diameter: z.number().positive(), axis: XYZ.refine((axis) => Math.hypot(...axis) > 0, "Mounting axis must be nonzero").default([0, 0, 1]) })).default([]),
  keepouts: z.array(z.object({ name: z.string(), at: XYZ, size: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]) })).default([]),
  source: z.string().optional(),
  massSource: z.enum(["measured", "manufacturer", "estimated"]).default("estimated"),
})
export type PhysicalPart = z.infer<typeof PhysicalPart>

export const Part = z
  .object({
    id: PartId,
    name: z.string().min(1),
    description: z.string().default(""),
    category: z.string().default("misc"),
    kind: z.enum(["electronic", "mechanical", "module"]).default("electronic"),
    refPrefix: z.string().regex(/^[A-Z]+$/).describe("Reference designator prefix, e.g. R, U, SW"),
    manufacturer: z.string().optional(),
    mpn: z.string().optional(),
    datasheet: z.string().optional(),
    pins: z.array(Pin).default([]),
    props: z.record(z.string(), z.string()).default({}).describe("Default component properties, e.g. { value: '10k' }"),
    symbol: PartSymbol.optional(),
    footprint: PartFootprint.optional().describe("Default footprint"),
    model3d: z.string().optional().describe("STEP model: a URL, or a path relative to the part folder"),
    physical: PhysicalPart.optional().describe("Physical geometry, mounting interfaces and sourced mass for assemblies"),
    sim: z.object({ model: z.string(), params: z.record(z.string(), z.unknown()).default({}) }).optional(),
    spice: z.object({ lib: z.string(), subckt: z.string().optional() }).optional(),
  })
  .refine((p) => p.kind === "mechanical" || p.pins.length > 0, { message: "Electronic parts and modules need pins" })
  .refine((p) => new Set(p.pins.map((pin) => pin.num)).size === p.pins.length, { message: "pin numbers must be unique" })

export const Component = z.object({
  id: z.string(),
  ref: z.string().regex(/^[A-Z]+[0-9]+$/, "e.g. R1, U2"),
  part: PartId,
  props: z.record(z.string(), z.string()).default({}),
})

export const PinRef = z.object({ component: z.string(), pin: z.string().describe("pin num") })

export const Net = z.object({
  id: z.string(),
  name: z.string().min(1),
  pins: z.array(PinRef),
})

export const Variable = z.object({
  name: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  value: z.string().describe("Quantity or expression, e.g. '65 mm' or 'pcb_w + 4'"),
})

export const Doc = z.object({
  id: z.string(),
  kind: z.string().describe("Registered doc kind, e.g. part-studio, schematic"),
  name: z.string().min(1),
  data: z.unknown().describe("Kind-specific content, validated by the kind's schema"),
})

export const Project = z.object({
  schema: z.literal(1).default(1),
  id: z.string(),
  name: z.string().min(1),
  version: z.number().int().nonnegative().default(0),
  variables: z.array(Variable).default([]),
  parts: z.record(z.string(), Part).default({}),
  components: z.array(Component).default([]),
  nets: z.array(Net).default([]),
  docs: z.array(Doc).default([]),
})

export type PinType = z.infer<typeof PinType>
export type Pin = z.infer<typeof Pin>
export type Graphic = z.infer<typeof Graphic>
export type SymbolPin = z.infer<typeof SymbolPin>
export type PartSymbol = z.infer<typeof PartSymbol>
export type Pad = z.infer<typeof Pad>
export type PartFootprint = z.infer<typeof PartFootprint>
export type Part = z.infer<typeof Part>
export type PartInput = z.input<typeof Part>
export type Component = z.infer<typeof Component>
export type PinRef = z.infer<typeof PinRef>
export type Net = z.infer<typeof Net>
export type Variable = z.infer<typeof Variable>
export type Doc = z.infer<typeof Doc>
export type Project = z.infer<typeof Project>

export function emptyProject(id: string, name: string): Project {
  return Project.parse({ id, name })
}
