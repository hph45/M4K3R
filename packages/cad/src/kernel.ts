import { DebugMode, make_gcs_wrapper, type GcsWrapper } from "@salusoft89/planegcs"
import { setOC } from "replicad"
import opencascade from "replicad-opencascadejs"

export interface KernelOptions {
  /** WASM URLs, needed in the browser (e.g. Vite `?url` imports). Node finds them on its own. */
  occtWasm?: string
  planegcsWasm?: string
}

let options: KernelOptions = {}
let ready: Promise<GcsWrapper> | undefined

/** Call before the first evaluation to point at the WASM files. */
export function configureKernel(o: KernelOptions) {
  options = o
}

/** Loads OpenCascade and planegcs once, on first use. Resolves to the shared sketch solver. */
export function loadKernel(): Promise<GcsWrapper> {
  ready ??= (async () => {
    const quiet = () => {}
    const oc = await opencascade({
      print: quiet,
      printErr: quiet,
      ...(options.occtWasm ? { locateFile: () => options.occtWasm } : {}),
    })
    setOC(oc as never)
    const gcs = await make_gcs_wrapper(options.planegcsWasm)
    gcs.debug_mode = DebugMode.NoDebug
    return gcs
  })()
  return ready
}
