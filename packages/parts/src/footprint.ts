import type { Graphic, Pad, PartFootprint } from "@m4k3r/core"
import { arcPoints, bounds, rectCorners, type XY } from "./geometry"
import { child, children, hidden, isList, num, nums, parseSExpr, value, type SList } from "./sexpr"

export interface KicadFootprint {
  name: string
  description: string
  footprint: PartFootprint
  /** 3D model path as written in the file, e.g. ${KICAD9_3DMODEL_DIR}/Resistor_SMD.3dshapes/R_0603_1608Metric.step */
  model?: string
}

const LAYERS = /^[FB]\.(SilkS|Fab|CrtYd)$/
const PAD_TYPES = ["smd", "thru_hole", "np_thru_hole", "connect"] as const
const PAD_SHAPES = ["rect", "roundrect", "circle", "oval", "trapezoid", "custom"] as const

/** Import a footprint from the contents of a .kicad_mod file. */
export function importFootprint(text: string): KicadFootprint {
  const root = parseSExpr(text)
  if (!isList(root) || (root[0] !== "footprint" && root[0] !== "module")) {
    throw new Error("Not a KiCad footprint (.kicad_mod)")
  }
  const pads = children(root, "pad").map(pad)
  const graphics = root.filter(isList).flatMap(graphic)
  const courtyard = graphics.filter((g) => g.layer?.endsWith("CrtYd"))
  const outline = courtyard.length ? courtyard.flatMap(points) : [...graphics.flatMap(points), ...pads.flatMap(padPoints)]
  const model = value(root, "model")
  return {
    name: String(root[1]),
    description: value(root, "descr") ?? "",
    footprint: { pads, graphics, courtyard: bounds(outline) },
    ...(model && { model }),
  }
}

const xy = (l: SList | undefined): XY => {
  const [x = 0, y = 0] = nums(l)
  return [x, y]
}

function pad(p: SList): Pad {
  const [x = 0, y = 0, rot = 0] = nums(child(p, "at"))
  const [w = 0, h = w] = nums(child(p, "size"))
  const drill = child(p, "drill")?.filter((d) => typeof d === "string").slice(1)
  const [dw, dh = dw] = (drill?.[0] === "oval" ? drill.slice(1) : drill?.slice(0, 1) ?? []).map((d) => num(d))
  const type = PAD_TYPES.find((t) => t === p[2]) ?? "smd"
  const shape = PAD_SHAPES.find((s) => s === p[3]) ?? "rect"
  const poly = child(child(child(p, "primitives") ?? [], "gr_poly") ?? [], "pts")
  return {
    num: String(p[1] ?? ""),
    type,
    shape,
    at: [x, y],
    ...(rot ? { rot } : {}),
    size: [w, h],
    ...(dw ? { drill: [dw, dh ?? dw] as XY } : {}),
    layers: (child(p, "layers") ?? []).slice(1).map(String),
    ...(shape === "roundrect" && { roundness: num(value(p, "roundrect_rratio"), 0.25) }),
    ...(shape === "custom" && poly && { poly: children(poly, "xy").map(xy) }),
  }
}

function graphic(g: SList): Graphic[] {
  const layer = value(g, "layer") ?? ""
  if (!LAYERS.test(layer)) return []
  const fill = value(g, "fill")
  const style = {
    width: num(value(child(g, "stroke") ?? [], "width") ?? value(g, "width")),
    ...((fill === "solid" || fill === "yes") && { fill: "outline" as const }),
    layer,
  }
  switch (g[0]) {
    case "fp_line":
      return [{ type: "poly", pts: [xy(child(g, "start")), xy(child(g, "end"))], ...style }]
    case "fp_rect":
      return [{ type: "rect", start: xy(child(g, "start")), end: xy(child(g, "end")), ...style }]
    case "fp_circle": {
      const [center, end] = [xy(child(g, "center")), xy(child(g, "end"))]
      return [{ type: "circle", center, radius: Math.hypot(end[0] - center[0], end[1] - center[1]), ...style }]
    }
    case "fp_arc":
      return [{ type: "arc", start: xy(child(g, "start")), mid: xy(child(g, "mid")), end: xy(child(g, "end")), ...style }]
    case "fp_poly":
      return [{ type: "poly", pts: children(child(g, "pts") ?? [], "xy").map(xy), ...style }]
    case "fp_text":
    case "property": {
      if (hidden(g)) return []
      const kind = String(g[1])
      const str = /^reference$/i.test(kind) ? "${REFERENCE}" : /^value$/i.test(kind) ? "${VALUE}" : kind === "user" ? String(g[2]) : ""
      if (!str) return []
      const [x = 0, y = 0, rot = 0] = nums(child(g, "at"))
      const size = nums(child(child(child(g, "effects") ?? [], "font") ?? [], "size"))[0] ?? 1
      return [{ type: "text", text: str, at: [x, y], size, ...(rot ? { rot } : {}), layer }]
    }
    default:
      return []
  }
}

function points(g: Graphic): XY[] {
  switch (g.type) {
    case "poly":
      return g.pts
    case "rect":
      return [g.start, g.end]
    case "circle":
      return [[g.center[0] - g.radius, g.center[1] - g.radius], [g.center[0] + g.radius, g.center[1] + g.radius]]
    case "arc":
      return arcPoints(g.start, g.mid, g.end)
    case "text":
      return []
  }
}

const padPoints = (p: Pad): XY[] => rectCorners(p.at, p.size, p.rot)
