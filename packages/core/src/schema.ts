import { z } from "zod"

export const PinType = z.enum(["power_in", "power_out", "input", "output", "bidir", "passive", "open_drain", "nc"])

export const Pin = z.object({
  num: z.string().min(1).describe("Physical pin/pad number, unique within the part"),
  name: z.string().min(1).describe("Logical name, e.g. GP10 or VCC"),
  type: PinType.default("passive"),
  functions: z.array(z.string()).optional().describe("MCU pin functions, e.g. PWM5A, SPI0_TX, ADC0"),
  voltage: z.tuple([z.number(), z.number()]).optional().describe("Allowed voltage range [min, max] in V"),
})

export const PartId = z.string().regex(/^[a-z0-9][a-z0-9._-]*$/, "lowercase letters, digits, . _ -")

export const Part = z
  .object({
    id: PartId,
    name: z.string().min(1),
    description: z.string().default(""),
    category: z.string().default("misc"),
    refPrefix: z.string().regex(/^[A-Z]+$/).describe("Reference designator prefix, e.g. R, U, SW"),
    manufacturer: z.string().optional(),
    mpn: z.string().optional(),
    datasheet: z.string().optional(),
    pins: z.array(Pin).min(1),
    props: z.record(z.string(), z.string()).default({}).describe("Default component properties, e.g. { value: '10k' }"),
    symbol: z.string().optional().describe("KiCad symbol file, relative to the part folder"),
    footprint: z.string().optional().describe("KiCad footprint file, relative to the part folder"),
    model3d: z.string().optional().describe("STEP model, relative to the part folder"),
    sim: z.object({ model: z.string(), params: z.record(z.string(), z.unknown()).default({}) }).optional(),
    spice: z.object({ lib: z.string(), subckt: z.string().optional() }).optional(),
  })
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
