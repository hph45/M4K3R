import { strToU8, zipSync } from "fflate"
import { draw, exportSTEP, makeCylinder, type Shape3D } from "replicad"
import { loadKernel } from "./kernel"
import type { BodyMesh } from "./outputs"
import type { V2, V3 } from "./sketch"

const xml = (s: string) => s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!)
/** Standards-based 3MF package, millimeters, one printable mesh object per body. */
export function export3mfMeshes(meshes: BodyMesh[]): Uint8Array {
  if (!meshes.length) throw new Error("There are no bodies to export")
  const objects = meshes.map((mesh, i) => {
    // OCCT repeats vertices across B-rep faces for distinct surface normals.
    // 3MF needs shared vertex identities at seams to retain manifold topology.
    const vertexIds=new Map<string,number>();const positions:V3[]=[];const remap:number[]=[]
    for(let j=0;j<mesh.positions.length;j+=3){const point=mesh.positions.slice(j,j+3) as V3;const key=point.map(n=>Math.round(n*1e7)).join(",");let id=vertexIds.get(key);if(id===undefined){id=positions.length;vertexIds.set(key,id);positions.push(point)}remap.push(id)}
    const vertices=positions.map(p=>`<vertex x="${p[0]}" y="${p[1]}" z="${p[2]}"/>`).join("")
    const triangles = Array.from({ length: mesh.indices.length / 3 }, (_, j) => `<triangle v1="${remap[mesh.indices[j*3]!]!}" v2="${remap[mesh.indices[j*3+1]!]!}" v3="${remap[mesh.indices[j*3+2]!]!}"/>`).join("")
    return `<object id="${i+1}" type="model" name="${xml(mesh.id)}"><mesh><vertices>${vertices}</vertices><triangles>${triangles}</triangles></mesh></object>`
  }).join("")
  const model = `<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><metadata name="Application">M4K3R</metadata><resources>${objects}</resources><build>${meshes.map((_, i) => `<item objectid="${i+1}"/>`).join("")}</build></model>`
  return zipSync({
    "[Content_Types].xml": strToU8('<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>'),
    "_rels/.rels": strToU8('<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>'),
    "3D/3dmodel.model": strToU8(model),
  }, { level: 6 })
}

export interface PcbDrill { at: V2; diameter: number; end?: V2 }
/** A real analytic B-rep board with through holes and capsule slots, for STEP and fit checks. */
export async function pcbSolid(outline: V2[], thickness: number, holes: PcbDrill[] = []): Promise<Shape3D> {
  await loadKernel()
  if (outline.length < 3 || !(thickness > 0)) throw new Error("A board needs a closed outline and positive thickness")
  const pen = draw(outline[0]!)
  for (const point of outline.slice(1)) pen.lineTo(point)
  let board = pen.close().sketchOnPlane("XY").extrude(thickness) as Shape3D
  for (const hole of holes) {
    if (!(hole.diameter > 0)) throw new Error("Drill diameter must be positive")
    const radius = hole.diameter / 2
    let tool: Shape3D = makeCylinder(radius, thickness + 2, [...hole.at, -1] as V3)
    if (hole.end && Math.hypot(hole.end[0] - hole.at[0], hole.end[1] - hole.at[1]) > 1e-8) {
      const [a, b] = [hole.at, hole.end]; const dx = b[0]-a[0]; const dy = b[1]-a[1]; const length = Math.hypot(dx, dy)
      const [nx, ny] = [-dy/length*radius, dx/length*radius]
      const bar = draw([a[0]+nx, a[1]+ny]).lineTo([b[0]+nx, b[1]+ny]).lineTo([b[0]-nx, b[1]-ny]).lineTo([a[0]-nx, a[1]-ny]).close().sketchOnPlane("XY", -1).extrude(thickness+2) as Shape3D
      tool = tool.fuse(makeCylinder(radius, thickness + 2, [...b, -1] as V3)).fuse(bar)
    }
    board = board.cut(tool)
  }
  return board
}
export async function exportPcbStep(outline: V2[], thickness: number, holes: PcbDrill[] = []) {
  const shape = await pcbSolid(outline, thickness, holes)
  return new Uint8Array(await exportSTEP([{ shape, name: "PCB" }]).arrayBuffer())
}
