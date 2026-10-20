export type Point2 = [number,number]
export interface CubicCurve { start:Point2; control1:Point2; control2:Point2; end:Point2 }
/** Interpolating Catmull–Rom spline represented by exact cubic Bezier segments. */
export function splineCurves(points:Point2[],closed=false):CubicCurve[] {
  if(points.length<2)return []
  const get=(i:number)=>points[closed?(i+points.length)%points.length:Math.max(0,Math.min(points.length-1,i))]!
  return Array.from({length:closed?points.length:points.length-1},(_,i)=>{
    const [p0,p1,p2,p3]=[get(i-1),get(i),get(i+1),get(i+2)]
    return {start:p1!,control1:p1!.map((n,j)=>n+(p2![j]!-p0![j]!)/6) as Point2,control2:p2!.map((n,j)=>n-(p3![j]!-p1![j]!)/6) as Point2,end:p2!}
  })
}
export function cubicPoint(curve:CubicCurve,t:number):Point2 {
  const u=1-t
  return [0,1].map(i=>u*u*u*curve.start[i]!+3*u*u*t*curve.control1[i]!+3*u*t*t*curve.control2[i]!+t*t*t*curve.end[i]!) as Point2
}
