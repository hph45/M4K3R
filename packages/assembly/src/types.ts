import type { BodyMesh } from "@m4k3r/cad"
import type { Instance, Source, V3 } from "./schema"
import type { Matrix } from "./math"
export interface Bounds { min: V3; max: V3; size: V3 }
export interface MountingHole { id: string; at: V3; axis: V3; diameter: number }
export interface EvaluatedInstance {
  id: string; name: string; source: Source; position: V3; rotation: V3; axis: V3
  mass: number; centerOfMass: V3; inertia: Matrix; bbox: Bounds; mesh: BodyMesh
  mountingHoles: MountingHole[]; localMountingHoles: MountingHole[]; localBounds: Bounds
  localAnchors:{id:string;at:V3;axis:V3}[]
  nominalSize:V3
  massSource: string; geometrySource: string; color?: string; mount?: Instance["mount"]
}
export interface Interference { a: string; b: string; volume: number; method: "solid" | "bounds"; severity: "collision" | "keepout"; message?: string }
export interface AssemblyResult { instances: EvaluatedInstance[]; mass: number; centerOfMass: V3; inertia: Matrix; bbox: Bounds | null; warnings: string[]; interferences: Interference[] }
