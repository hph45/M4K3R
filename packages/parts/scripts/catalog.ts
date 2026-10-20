/** Reproducible starter mechanical catalog. Generic geometry and masses are estimates, not vendor data. */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { resolve, join } from "node:path"
import { Part, type PartInput, type PhysicalPart } from "@m4k3r/core"
import { importSymbol, importFootprint, kicadPart, partJson } from "../src/index"

const root = resolve(import.meta.dirname, "../../..")
const dir = join(root, "library/parts")
const estimate = "M4K3R generic planning envelope and estimated mass; replace with measurements or the selected vendor's data before fabrication."
const physical = (size: [number,number,number], mass: number, type: PhysicalPart['geometry']['type'] = 'box', color = '#7296a6', holes: {id:string;at:[number,number,number];diameter:number}[] = []) => ({size,mass,geometry:{type,color},mountingHoles:holes,source:estimate,massSource:'estimated' as const})
function save(input: PartInput) { const part = Part.parse(input); const target = join(dir,part.id); mkdirSync(target,{recursive:true}); writeFileSync(join(target,'part.json'),partJson(part)) }
const mechanical: [string,string,string,[number,number,number],number,PhysicalPart['geometry']['type'],string?][] = [
 ['screw-m3x8','M3 × 8 socket screw','fasteners',[5.5,5.5,11],1.2,'fastener'],
 ['nut-m3','M3 hex nut','fasteners',[5.5,5.5,2.4],0.45,'fastener'],
 ['washer-m3','M3 washer','fasteners',[7,7,0.5],0.12,'bearing'],
 ['standoff-m3x10','M3 × 10 standoff','fasteners',[5,5,10],1.1,'cylinder'],
 ['heat-set-m3','M3 heat-set insert','fasteners',[4.6,4.6,5.7],0.6,'cylinder'],
 ['bearing-608','608 bearing (8 × 22 × 7)','bearings',[22,22,7],12,'bearing'],
 ['shaft-8x100','8 mm × 100 shaft','shafts',[8,8,100],39.5,'cylinder'],
 ['spacer-m3x5','M3 × 5 spacer','fasteners',[6,6,5],0.8,'bearing'],
 ['bracket-l','L bracket planning envelope','brackets',[30,30,30],8,'box'],
 ['plate-100x100','100 × 100 × 3 plate','stock',[100,100,3],81,'box'],
 ['extrusion-2020','2020 extrusion, 100 mm','stock',[20,20,100],50,'extrusion'],
 ['rod-6x100','6 mm × 100 rod','stock',[6,6,100],22.2,'cylinder'],
 ['tube-10x100','10 mm tube, 100 mm','stock',[10,10,100],7.6,'cylinder'],
 ['gear-20t','20 tooth gear planning envelope','power transmission',[22,22,6],5,'gear'],
 ['pulley-20t','GT2 20 tooth pulley','power transmission',[16,16,16],7,'gear'],
 ['belt-gt2','GT2 belt planning segment','power transmission',[100,6,1.4],1,'box'],
 ['spring','Compression spring envelope','mechanisms',[8,8,20],1.5,'cylinder'],
 ['wheel-65','65 mm wheel','wheels',[65,65,26],40,'cylinder'],
 ['servo-horn','Micro servo horn envelope','mechanisms',[25,6,2],0.7,'box'],
 ['battery-strap','Battery strap envelope','hardware',[100,15,2],3,'box'],
 ['propeller-5inch','5 inch propeller (planning)','propulsion',[127,18,6],4.5,'propeller'],
 ['drone-frame','Generic 210 mm frame envelope','frames',[210,210,4],70,'box'],
]
const bores:Record<string,number>={'bearing-608':8,'nut-m3':3.2,'washer-m3':3.2,'spacer-m3x5':3.2,'standoff-m3x10':3.2,'heat-set-m3':3.2,'tube-10x100':8,'wheel-65':5,'pulley-20t':5,'gear-20t':5}
/** Rotor performance props read by flight estimates; per-component props can override them. */
const performance:Record<string,Record<string,string>>={'propeller-5inch':{diameter:'127',ct:'0.1',cp:'0.05',dataSource:'Illustrative generic coefficients, not measured. Replace with measured or vendor data before assessing a real build.'}}
for (const [id,name,category,size,mass,type] of mechanical) save({id,name,description:estimate,kind:'mechanical',category,refPrefix:'MP',pins:[],props:performance[id],physical:{...physical(size,mass,type),geometry:{type,color:"#7296a6",...(bores[id]?{innerDiameter:bores[id]}:{})},...(['standoff-m3x10','heat-set-m3','spacer-m3x5'].includes(id)?{mountingHoles:[{id:'bore',at:[0,0,0],diameter:3.2}]}:{})}})

/** Generic abstract module with numbered header pads. It is not a named vendor footprint. */
function modulePart(id:string,name:string,names:string[],size:[number,number,number],mass:number,sim?:PartInput['sim'],props:Record<string,string>={},oneSide=false) {
 const rows = oneSide ? names.length : Math.ceil(names.length/2), h = Math.max(10,rows*2.54+2.54)
 const pins = names.map((name,i)=>({num:String(i+1),name,type:(name==='GND'||name==='VBAT'||name==='VM'||name==='IN'||name==='VCC')?'power_in' as const:'passive' as const}))
 const positions = pins.map((_,i)=>[i<rows?-10:10,((i%rows)-(rows-1)/2)*2.54] as [number,number])
 save({id,name,kind:'module',description:estimate,category:'modules',refPrefix:'U',pins,props,sim,physical:physical(size,mass,id==='brushless-motor'?'cylinder':'box'),
 symbol:{source:'M4K3R abstract module',units:[{graphics:[{type:'rect',start:[-7.5,-h/2],end:[7.5,h/2],width:.25}],pins:pins.map((p,i)=>({num:p.num,at:positions[i]!,rot:i<rows?0:180,length:2.5}))}]},
 footprint:{source:'M4K3R generic 2.54 mm header interface — verify vendor pinout and geometry',pads:pins.map((p,i)=>({num:p.num,type:'thru_hole',shape:'circle',at:[i<rows?-size[0]/2+1.27:size[0]/2-1.27,positions[i]![1]],size:[1.7,1.7],drill:[1,1],layers:['*.Cu','*.Mask']})),graphics:[],courtyard:{min:[-size[0]/2-1,-size[1]/2-1],max:[size[0]/2+1,size[1]/2+1]}}})
}
modulePart('brushless-motor','Generic 2205 brushless motor',['A','B','C'],[27,27,25],30,undefined,{kv:'2300',maxRpm:'20000',referenceVoltage:'11.1',efficiency:'0.8',dataSource:'Illustrative loaded RPM with a 5 inch propeller at 11.1 V, not measured. Replace with measured or vendor data before assessing a real build.',sizeX:'27',sizeY:'27',sizeZ:'25'},true)
modulePart('esc-20a','Generic ESC + propeller load',['VBAT','GND','SIGNAL','A','B','C'],[30,15,6],6,{model:'esc-propeller',params:{diameter:127,ct:0.1,cp:0.05,fullRpm:20000,efficiency:0.8,signalLow:0,signalHigh:3.3}})
modulePart('flight-battery','Generic 3S 850 mAh LiPo',['+','-'],[60,30,24],75,{model:'battery',params:{}},{voltage:'11.1V',capacity:'0.85Ah',resistance:'0.08'})
modulePart('regulator-3v3','Generic 3.3 V regulator',['IN','OUT','GND'],[20,15,4],3,{model:'regulator',params:{voltage:3.3,dropout:0.2,maxCurrent:1,efficiency:0.85}},{voltage:'3.3',dropout:'0.2',maxCurrent:'1',efficiency:'0.85'})
modulePart('motor-driver','Generic H bridge',['VM','GND','IN1','IN2','OUT1','OUT2'],[21,16,4],3,{model:'h-bridge',params:{ron:0.4,threshold:1.5,maxCurrent:2}},{ron:'0.4',threshold:'1.5',maxCurrent:'2'})
modulePart('imu-module','Generic I²C IMU interface',['VCC','GND','SDA','SCL','INT'],[20,15,3],2)
modulePart('servo','Generic micro servo',['VCC','GND','SIGNAL'],[23,12,28],9)
modulePart('connector-xt30','Generic XT30 battery connection',['+','-'],[15,8,8],2)

// Envelopes for the original electrical examples. These are deliberately generic estimates.
const additions: Record<string,[number,number,number,number]> = {battery:[40,20,20,25],'dc-motor':[24,24,30,30],resistor:[1.6,.8,.5,.003],capacitor:[1.6,.8,.8,.005],led:[1.6,.8,.8,.004],diode:[2.7,1.6,1,.01],nmos:[3,1.4,1.1,.01],inductor:[2,1.2,1,.01],'push-button':[6,6,5,.5],'switch-spdt':[8,4,5,.5],'header-1x2':[2.54,5.08,8,.2],'header-1x4':[2.54,10.16,8,.4]}
for(const [id,[x,y,z,mass]] of Object.entries(additions)) {
 const file=join(dir,id,'part.json'); const part=JSON.parse(readFileSync(file,'utf8')); save({...part,physical:physical([x,y,z],mass,id==='dc-motor'?'cylinder':'box')})
}

// KiCad symbol + Espressif's actual DevKitM-1 header footprint (sources downloaded separately).
const symFile=join(root,'.tools/esp32/ESP32-C3-DevKitM-1.kicad_sym'), fpFile=join(root,'.tools/esp32/ESP32-C3-DevKitM-1.kicad_mod')
async function sourceFile(file:string,url:string) {
 try { return readFileSync(file,'utf8') } catch { const response=await fetch(url); if(!response.ok)throw new Error(`Catalog source ${url}: HTTP ${response.status}`); return response.text() }
}
const sym=importSymbol(await sourceFile(symFile,'https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/master/RF_Module.kicad_symdir/ESP32-C3-DevKitM-1.kicad_sym'),'ESP32-C3-DevKitM-1'),fp=importFootprint(await sourceFile(fpFile,'https://raw.githubusercontent.com/espressif/kicad-libraries/main/footprints/Espressif.pretty/ESP32-C3-DevKitM-1.kicad_mod'))
// Recommended 3V3 supply range: ESP32-C3 datasheet v2.4, table 5-2.
// The DevKit guide permits supplying the board through either 3V3 header.
sym.pins=sym.pins.map(p=>({...p,
 ...(/^IO\d+$/.test(p.name)?{functions:[`GPIO${p.name.slice(2)}`]}:{}),
 ...(['TX','RX'].includes(p.name)?{functions:[...(p.functions??[]),p.name==='TX'?'GPIO21':'GPIO20']}:{}),
 ...(['2','3'].includes(p.num)?{voltage:[3,3.6] as [number,number]}:{}),
}))
const {part,warnings}=kicadPart(sym,fp,{id:'esp32-c3',symbolSource:'KiCad RF_Module:ESP32-C3-DevKitM-1',footprintSource:'Espressif kicad-libraries ESP32-C3-DevKitM-1',overrides:{kind:'module',category:'microcontrollers',manufacturer:'Espressif',mpn:'ESP32-C3-DevKitM-1',physical:{...physical([25.4,38.91,9],7),source:'Espressif board drawing: 25.40 × 38.91 mm (https://dl.espressif.com/dl/schematics/DIMENSION_ESP32-C3-DEVKITM-1_V1_20200915AA.pdf); height and mass estimated',keepouts:[{name:'Antenna clearance (planning)',at:[0,14,5],size:[25.4,12,10]}]}}})
part.datasheet='https://documentation.espressif.com/ESP32-C3_Datasheet_en.pdf'
if(warnings.length) throw new Error(warnings.join('\n'));save(part)
console.log(`Wrote ${mechanical.length+9+Object.keys(additions).length} catalog parts`)
