import { CommandError } from "@m4k3r/core"

/** Circular catalog families use one outside diameter, rather than an ellipse. */
export function validateCircularDimensions(kind:string,size:readonly number[],ref:string) {
  if (["cylinder","bearing","gear","fastener"].includes(kind) && Math.abs(size[0]!-size[1]!) > 1e-8*Math.max(1,size[0]!,size[1]!)) {
    throw new CommandError(`${ref}: ${kind} geometry requires equal X and Y outside diameters; set both dimensions together`)
  }
}
