import type { BodyMesh, SolvedSketch, V3 } from "@m4k3r/cad"
import { useEffect, useMemo, useRef, useState } from "react"
import { isoCamera, modelBounds, rotate, sketchSegments, triangleDepthAt, visibleEdgeSpans, type Camera, type ProjectedTriangle } from "./cad-geometry"

export interface FacePick { body:string;near:V3;normal:V3 }
export function CadViewport({ bodies, sketches,selectedBody,onBodyPick,onFacePick,markers=[] }: { bodies: BodyMesh[]; sketches: SolvedSketch[];selectedBody?:string;onBodyPick?(id:string):void;onFacePick?(face:FacePick):void;markers?:{at:V3;label:string;color?:string}[] }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const drag = useRef<{ x: number; y: number; camera: Camera } | null>(null)
  const [camera, setCamera] = useState(isoCamera)
  const [size, setSize] = useState({ width: 600, height: 500 })
  const pick=useRef<(x:number,y:number)=>FacePick|undefined>(()=>undefined)
  const segments = useMemo(() => sketches.map(sketchSegments), [sketches])
  const bounds = useMemo(() => modelBounds(bodies, segments), [bodies, segments])

  useEffect(() => {
    const el = canvas.current!
    const resize = new ResizeObserver(([entry]) => entry && setSize({ width: entry.contentRect.width, height: entry.contentRect.height }))
    resize.observe(el)
    const wheel = (e: WheelEvent) => {
      e.preventDefault()
      setCamera((c) => ({ ...c, zoom: Math.max(0.15, Math.min(12, c.zoom * Math.exp(-e.deltaY * 0.0015))) }))
    }
    el.addEventListener("wheel", wheel, { passive: false })
    const theme = new MutationObserver(() => setSize((s) => ({ ...s })))
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
    return () => { resize.disconnect(); theme.disconnect(); el.removeEventListener("wheel", wheel) }
  }, [])

  useEffect(() => {
    const el = canvas.current!
    const ctx = el.getContext("2d")!
    const ratio = devicePixelRatio || 1
    el.width = Math.max(1, Math.round(size.width * ratio))
    el.height = Math.max(1, Math.round(size.height * ratio))
    ctx.scale(ratio, ratio)
    const colors = getComputedStyle(el)
    const scale = Math.min(size.width, size.height) * 0.39 / bounds.radius * camera.zoom
    const project = (p: V3) => {
      const r = rotate(p.map((n, i) => n - bounds.center[i]!) as V3, camera)
      return [size.width / 2 + r[0] * scale, size.height / 2 + r[1] * scale, r[2]] as V3
    }
    const line = (a: V3, b: V3) => { const p = project(a); const q = project(b); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]) }

    // A datum grid establishes scale and orientation without joining the part geometry.
    const spacing = 10 ** Math.floor(Math.log10(bounds.radius / 2))
    const extent = Math.max(spacing * 5, Math.ceil(bounds.radius * 1.3 / spacing) * spacing)
    // CSS properties resolve light-dark() to a concrete color; custom properties don't.
    ctx.strokeStyle = colors.borderTopColor
    ctx.globalAlpha = 0.7
    ctx.lineWidth = 0.7
    ctx.beginPath()
    for (let n = -extent; n <= extent + 0.01; n += spacing) {
      line([n, -extent, 0], [n, extent, 0]); line([-extent, n, 0], [extent, n, 0])
    }
    ctx.stroke()
    ctx.globalAlpha = 1

    type Triangle = { points: ProjectedTriangle; depth: number; fill: string;body:string;normal:V3 }
    const faces: { triangles: Triangle[]; depth: number }[] = []
    const surfaces: ProjectedTriangle[] = []
    bodies.forEach((body, bodyIndex) => {
      const points: V3[] = []
      for (let n = 0; n < body.positions.length; n += 3) points.push(project(body.positions.slice(n, n + 3) as V3))
      for (const face of body.faces.length ? body.faces : [{ start: 0, count: body.indices.length }]) {
        const triangles: Triangle[] = []
        for (let n = face.start; n < face.start + face.count; n += 3) {
          const ids = body.indices.slice(n, n + 3)
          const p = ids.map((id) => points[id]!) as ProjectedTriangle
          const normalIndex = ids[0]! * 3
          const normal = rotate(body.normals.slice(normalIndex, normalIndex + 3) as V3, camera)
          if (normal[2] <= 1e-7) continue
          const light = Math.max(0, normal[0] * -0.25 + normal[1] * -0.45 + normal[2] * 0.85)
          triangles.push({ points: p, depth: p.reduce((sum, v) => sum + v[2], 0) / 3, fill: `hsl(${body.id===selectedBody?208:212 + bodyIndex * 27} ${body.id===selectedBody?58:38}% ${49 + light * 26}%)`,body:body.id,normal:body.normals.slice(normalIndex,normalIndex+3) as V3 })
          surfaces.push(p)
        }
        // Keep each B-rep face together: a large floor triangle must not paint over
        // half of the nearer wall merely because their triangle centroids overlap.
        if (triangles.length) faces.push({ triangles, depth: triangles.reduce((sum, t) => sum + t.depth, 0) / triangles.length })
      }
    })
    faces.sort((a, b) => a.depth - b.depth)
    pick.current=(x,y)=>{
      let depth=-Infinity;let found:Triangle|undefined
      for(const face of faces)for(const triangle of face.triangles){const z=triangleDepthAt(x,y,triangle.points);if(z!==undefined&&z>depth){depth=z;found=triangle}}
      if(!found)return
      const a=(x-size.width/2)/scale;const screenY=(y-size.height/2)/scale
      const b=screenY*Math.cos(camera.pitch)+depth*Math.sin(camera.pitch);const z=-screenY*Math.sin(camera.pitch)+depth*Math.cos(camera.pitch)
      const near:V3=[a*Math.cos(camera.yaw)+b*Math.sin(camera.yaw)+bounds.center[0],-a*Math.sin(camera.yaw)+b*Math.cos(camera.yaw)+bounds.center[1],z+bounds.center[2]]
      return {body:found.body,near,normal:found.normal}
    }
    for (const face of faces) for (const triangle of face.triangles.sort((a, b) => a.depth - b.depth)) {
      ctx.beginPath()
      triangle.points.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))
      ctx.closePath(); ctx.fillStyle = triangle.fill; ctx.fill()
    }
    ctx.strokeStyle = "rgba(20, 36, 61, 0.52)"
    ctx.lineWidth = 1
    ctx.beginPath()
    for (const body of bodies) for (let n = 0; n < body.edges.length; n += 6) {
      const a = project(body.edges.slice(n, n + 3) as V3)
      const b = project(body.edges.slice(n + 3, n + 6) as V3)
      for (const [p, q] of visibleEdgeSpans([a, b], surfaces, bounds.radius * 1e-5)) { ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]) }
    }
    ctx.stroke()
    ctx.strokeStyle = colors.color
    ctx.lineWidth = 2
    ctx.beginPath()
    for (const sketch of segments) for (const [a, b] of sketch) line(a, b)
    ctx.stroke()
    ctx.font="11px system-ui"
    for(const marker of markers){const [x,y]=project(marker.at);ctx.fillStyle=marker.color??"#e9aa3d";ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fill();ctx.fillText(marker.label,x+9,y+4)}

    // An orientation triad remains in a fixed screen position while the part orbits.
    ctx.font = "11px system-ui"
    const origin = [44, size.height - 44]
    ;([[1, 0, 0], [0, 1, 0], [0, 0, 1]] as V3[]).forEach((axis, i) => {
      const r = rotate(axis, camera)
      const x = origin[0]! + r[0] * 28; const y = origin[1]! + r[1] * 28
      ctx.strokeStyle = ["#d96a67", "#55a474", "#648de2"][i]!
      ctx.fillStyle = ctx.strokeStyle
      ctx.beginPath(); ctx.moveTo(origin[0]!, origin[1]!); ctx.lineTo(x, y); ctx.stroke()
      ctx.fillText(["X", "Y", "Z"][i]!, x + 4, y + 4)
    })
  }, [bodies, segments, camera, bounds, size,selectedBody,markers])

  return <div className="cad-viewport">
    <canvas ref={canvas} aria-label="3D part viewport. Drag to orbit, scroll to zoom. Arrow keys orbit, plus and minus zoom, Home fits the part." tabIndex={0}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, camera }; e.currentTarget.focus() }}
      onPointerMove={(e) => {
        const d = drag.current
        if (d) setCamera({ ...d.camera, yaw: d.camera.yaw + (e.clientX - d.x) * 0.008, pitch: Math.max(0, Math.min(Math.PI, d.camera.pitch + (e.clientY - d.y) * 0.008)) })
      }}
      onPointerUp={(e) => { const d=drag.current;drag.current=null;if(d&&Math.hypot(e.clientX-d.x,e.clientY-d.y)<4){const rect=e.currentTarget.getBoundingClientRect();const hit=pick.current(e.clientX-rect.left,e.clientY-rect.top);if(hit){onBodyPick?.(hit.body);onFacePick?.(hit)}} }} onPointerCancel={() => { drag.current = null }}
      onKeyDown={(e) => {
        const changes: Record<string, Partial<Camera>> = {
          ArrowLeft: { yaw: camera.yaw - 0.12 }, ArrowRight: { yaw: camera.yaw + 0.12 },
          ArrowUp: { pitch: Math.max(0, camera.pitch - 0.12) }, ArrowDown: { pitch: Math.min(Math.PI, camera.pitch + 0.12) },
          "+": { zoom: Math.min(12, camera.zoom * 1.15) }, "=": { zoom: Math.min(12, camera.zoom * 1.15) }, "-": { zoom: Math.max(0.15, camera.zoom / 1.15) },
        }
        if (e.key === "Home") { e.preventDefault(); setCamera(isoCamera) }
        else if (changes[e.key]) { e.preventDefault(); setCamera({ ...camera, ...changes[e.key] }) }
      }} />
    <div className="cad-view-controls">
      <button onClick={() => setCamera(isoCamera)} title="Isometric view and fit">Fit</button>
      <button onClick={() => setCamera({ yaw: 0, pitch: 0, zoom: 1 })}>Top</button>
      <button onClick={() => setCamera({ yaw: 0, pitch: Math.PI / 2, zoom: 1 })}>Front</button>
      <button onClick={() => setCamera({ yaw: -Math.PI / 2, pitch: Math.PI / 2, zoom: 1 })}>Right</button>
    </div>
    <span className="cad-orbit-hint">Drag to orbit · Scroll to zoom · mm</span>
  </div>
}
