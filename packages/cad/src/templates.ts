import { z } from "zod"
import { Expr, PartStudio, type FeatureInput } from "./schema"
export const Template = z.object({
  family:z.enum(["plate","bracket","mount","frame"]),width:Expr.default(80),length:Expr.default(60),height:Expr.default(35),thickness:Expr.default(3),
  holeSpacingX:Expr.default(30.5),holeSpacingY:Expr.default(30.5),holeDiameter:Expr.default(3.4),armWidth:Expr.default(16),
})
export type TemplateInput = z.input<typeof Template>
/** Dimensions remain expressions in the feature tree, so shared variable edits regenerate the part. */
export function templateStudio(input:TemplateInput):PartStudio {
  const p=Template.parse(input);const features:FeatureInput[]=[]
  const sketch=(id:string,entities:unknown[],extra:object={})=>features.push({type:"sketch",id,entities,...extra} as FeatureInput)
  const extrude=(id:string,sketch:string,depth:unknown,op?:"new"|"add")=>features.push({type:"extrude",id,sketch,depth,op} as FeatureInput)
  if(p.family==="frame") {
    for(const [i,degrees] of [45,-45].entries()) {
      const c=Math.cos(degrees*Math.PI/180);const s=Math.sin(degrees*Math.PI/180)
      const pts=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([u,v])=>[`(${p.width})/2*${u!*c}-(${p.armWidth})/2*${v!*s}`,`(${p.width})/2*${u!*s}+(${p.armWidth})/2*${v!*c}`])
      sketch(`arm_profile${i}`,pts.map((start,j)=>({type:"line",id:`l${j}`,start,end:pts[(j+1)%4]})))
      extrude(`arm${i}`,`arm_profile${i}`,p.thickness,i?"add":"new")
    }
    sketch("center_profile",[{type:"rectangle",id:"r",width:p.length,height:p.length}]);extrude("center_plate","center_profile",p.thickness,"add")
    const centers=[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y])=>[`(${p.width})/2/sqrt(2)*${x}`,`(${p.width})/2/sqrt(2)*${y}`])
    centers.forEach((center,i)=>{sketch(`motor_profile${i}`,[{type:"circle",id:"pad",center,radius:14}]);extrude(`motor_pad${i}`,`motor_profile${i}`,p.thickness,"add")})
    sketch("motor_holes",centers.flatMap(([cx,cy],i)=>[{type:"point",id:`center${i}`,at:[cx,cy],construction:true},...[[-8,-9.5],[-8,9.5],[8,-9.5],[8,9.5]].map(([x,y],j)=>({type:"point",id:`m${i}p${j}`,at:[`(${cx})+${x}`,`(${cy})+${y}`]}))]),{offset:p.thickness})
    features.push({type:"hole",id:"motor_drills",sketch:"motor_holes",diameter:p.holeDiameter,through:true})
  } else {
    sketch("base_profile",[{type:"rectangle",id:"base",width:p.width,height:p.length}]);extrude("base","base_profile",p.thickness,"new")
    if(p.family==="bracket") {
      sketch("upright_profile",[{type:"rectangle",id:"wall",corner:[`-(${p.width})/2`,0],width:p.width,height:p.height}],{plane:"XZ",offset:`-(${p.length})/2`})
      extrude("upright","upright_profile",p.thickness,"add")
    }
    if(p.family==="mount") {
      sketch("mount_ring",[{type:"circle",id:"ring",center:[0,0],radius:`min((${p.width}),(${p.length}))/3`}],{offset:p.thickness})
      extrude("mount_boss","mount_ring",p.height,"add")
    }
  }
  sketch("mounting_points",[[-1,-1],[-1,1],[1,-1],[1,1]].map(([x,y],i)=>({type:"point",id:`h${i+1}`,at:[`(${p.holeSpacingX})/2*${x}`,`(${p.holeSpacingY})/2*${y}`]})),{offset:p.family==="mount"?`(${p.thickness})+(${p.height})`:p.thickness})
  features.push({type:"hole",id:"mounting_holes",sketch:"mounting_points",diameter:p.holeDiameter,through:true})
  return PartStudio.parse({features})
}
