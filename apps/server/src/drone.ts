import type { Command } from '@m4k3r/core'
import type { ProjectStore } from './store'

const component = (part:string,ref:string,props?:Record<string,string>):Command => ({type:'component.add',args:{part,ref,props}})
const connect = (name:string,pins:string[]):Command => ({type:'net.connect',args:{name,pins}})
const instance = (id:string,ref:string,position:number[]):Command => ({type:'assembly.instance.add',args:{doc:'Drone assembly',id,source:{type:'component',component:ref},position}})
const mount = (id:string,target:string,sourceAnchor:string|number[]='origin',targetAnchor:string|number[]='origin',distance=0):Command => ({type:'assembly.mount',args:{doc:'Drone assembly',instance:id,target,sourceAnchor,targetAnchor,distance}})
const mounted = (id:string,ref:string,position:number[],target:string,sourceAnchor:string|number[]='origin',targetAnchor:string|number[]='origin',distance=0):Command[] => [instance(id,ref,position),mount(id,target,sourceAnchor,targetAnchor,distance)]
const onFrame = (id:string,ref:string,[x,y,z]:number[]):Command[] => mounted(id,ref,[x!,y!,z!],'frame',[-x!,-y!,0],'top',z!-4)
const arm=210/(2*Math.sqrt(2))
const centers=[[-arm,-arm],[arm,-arm],[arm,arm],[-arm,arm]]
const motorAnchor=[0,2,3,1] // Frame template enumerates (-,-), (-,+), (+,-), (+,+).
const frameHole=[1,3,4,2]

/** Editable integration example. Generic rotor data (on the motor/propeller parts) and masses are planning inputs, not measured flight evidence. */
export const droneCommands:Command[] = [
 {type:'variable.set',args:{name:'wheelbase',value:'210 mm'}},
 {type:'variable.set',args:{name:'frame_thickness',value:'4 mm'}},
 component('esp32-c3','U1'),component('regulator-3v3','U2'),component('imu-module','U3'),component('flight-battery','BT1'),
 component('capacitor','C1',{value:'100uF'}),component('capacitor','C2',{value:'100nF'}),
 ...centers.flatMap((_,i)=>[component('brushless-motor',`M${i+1}`,{direction:i%2?'ccw':'cw'}),component('propeller-5inch',`P${i+1}`),component('esc-20a',`ESC${i+1}`,{signalMode:'servo',voltage:'11.1'}),component('header-1x4',`J${i+1}`)]),
 component('header-1x2','J5'),
 ...centers.map((_,i)=>component('standoff-m3x10',`MP${i+1}`,{'physical.size.z':'14','physical.mass':'1.5'})),
 component('battery-strap','MP5'),
 ...centers.map((_,i)=>component('screw-m3x8',`F${i+1}`)),
 connect('VBAT',['BT1.+','U2.IN','C1.1','J5.1',...centers.flatMap((_,i)=>[`ESC${i+1}.VBAT`,`J${i+1}.1`])]),
 connect('3V3',['U2.OUT','U1.2','U1.3','U3.VCC','C2.1']),
 connect('GND',['BT1.-','U2.GND','U3.GND','C1.2','C2.2','J5.2',...['1','6','8','12','15','16','19','24','27','30'].map(p=>`U1.${p}`),...centers.flatMap((_,i)=>[`ESC${i+1}.GND`,`J${i+1}.2`])]),
 ...centers.map((_,i)=>connect(`MOTOR_${i+1}`,[`U1.IO${[2,3,4,5][i]}`,`ESC${i+1}.SIGNAL`,`J${i+1}.3`])),
 ...centers.flatMap((_,i)=>['A','B','C'].map(phase=>connect(`PHASE_${i+1}_${phase}`,[`ESC${i+1}.${phase}`,`M${i+1}.${phase}`]))),
 connect('SDA',['U1.IO6','U3.SDA']),connect('SCL',['U1.IO7','U3.SCL']),
 {type:'doc.create',args:{kind:'schematic',name:'Drone wiring'}},
 {type:'schematic.autoplace',args:{doc:'Drone wiring'}},
 {type:'schematic.no-connect',args:{doc:'Drone wiring',pins:['U1.RST','U1.RX']}},
 {type:'cad.template.create',args:{name:'Printable frame',family:'frame',width:'wheelbase',length:64,thickness:'frame_thickness',armWidth:16,holeSpacingX:44,holeSpacingY:34,holeDiameter:3.4}},
 {type:'cad.template.create',args:{name:'ESP32 holder',family:'plate',width:52,length:44,thickness:2,holeSpacingX:44,holeSpacingY:34,holeDiameter:3.4}},
 ...[-14.7,14.7].flatMap((x,i)=>[
  {type:'cad.feature.add',args:{doc:'ESP32 holder',feature:{type:'sketch',id:`rail_profile${i}`,offset:2,entities:[{type:'rectangle',id:'rail',width:2,height:44,center:[x,0]}]}}},
  {type:'cad.feature.add',args:{doc:'ESP32 holder',feature:{type:'extrude',id:`rail${i}`,sketch:`rail_profile${i}`,depth:7,op:'add'}}},
 ]),
 ...[-21,21].flatMap((y,i)=>[
  {type:'cad.feature.add',args:{doc:'ESP32 holder',feature:{type:'sketch',id:`stop_profile${i}`,offset:2,entities:[{type:'rectangle',id:'stop',width:28,height:2,center:[0,y]}]}}},
  {type:'cad.feature.add',args:{doc:'ESP32 holder',feature:{type:'extrude',id:`stop${i}`,sketch:`stop_profile${i}`,depth:4,op:'add'}}},
 ]),
 {type:'doc.create',args:{kind:'part-studio',name:'Battery tray',data:{material:'PLA',features:[
  {type:'sketch',id:'tray_profile',entities:[{type:'rectangle',id:'outline',width:64,height:34}]},
  {type:'extrude',id:'tray',sketch:'tray_profile',depth:14},
  {type:'shell',id:'tray_walls',thickness:1.5,faces:{normal:'+z'}},
 ]}}},
 {type:'doc.create',args:{kind:'pcb',name:'Power distribution',data:{outline:[[0,0],[50,0],[50,25],[0,25]]}}},
 {type:'pcb.exclude',args:{doc:'Power distribution',components:['U1','U2','U3','BT1','C1','C2',...centers.flatMap((_,i)=>[`M${i+1}`,`ESC${i+1}`])]}},
 ...[1,2,3,4,5].map(i=>({type:'pcb.place',args:{doc:'Power distribution',component:`J${i}`,at:[i===5?5:i*10,10]}})),
 {type:'pcb.track.add',args:{doc:'Power distribution',net:'VBAT',layer:'F.Cu',width:1,points:[[5,10],[40,10]]}},
 {type:'pcb.track.add',args:{doc:'Power distribution',net:'GND',layer:'B.Cu',width:1,points:[[5,12.54],[40,12.54]]}},
 {type:'pcb.hole.add',args:{doc:'Power distribution',at:[3,3],diameter:2.4}},
 {type:'pcb.hole.add',args:{doc:'Power distribution',at:[47,22],diameter:2.4}},
 {type:'doc.create',args:{kind:'assembly',name:'Drone assembly'}},
 {type:'assembly.instance.add',args:{doc:'Drone assembly',id:'frame',source:{type:'cad',doc:'Printable frame'},fixed:true}},
 {type:'assembly.instance.add',args:{doc:'Drone assembly',id:'holder',source:{type:'cad',doc:'ESP32 holder'},position:[0,0,18]}},
 mount('holder','frame','mounting_holes.h1','mounting_holes.h1',16),
 {type:'assembly.instance.add',args:{doc:'Drone assembly',id:'board',source:{type:'pcb',doc:'Power distribution'},position:[-25,-12.5,5]}},
 mount('board','frame',[25,12.5,0],'top',1),
 {type:'assembly.instance.add',args:{doc:'Drone assembly',id:'batteryTray',source:{type:'cad',doc:'Battery tray'},position:[0,0,-28.5]}},
 mount('batteryTray','frame','origin','bottom',-28.5),
 ...mounted('controller','U1',[0,0,24.5],'holder','bottom','origin',2),...onFrame('regulator','U2',[0,-35,7]),...onFrame('imu','U3',[0,37,7]),
 ...mounted('battery','BT1',[0,0,-15],'batteryTray','bottom','origin',1.5),...mounted('strap','MP5',[0,0,-1.5],'frame','top','bottom',-.5),...onFrame('bulkCap','C1',[15,-33,7]),...onFrame('decoupler','C2',[-14,-35,7]),
 ...centers.flatMap(([x,y],i)=>[
  ...mounted(`motor${i+1}`,`M${i+1}`,[x!,y!,16.5],'frame','bottom',`motor_holes.center${motorAnchor[i]}`),
  ...mounted(`prop${i+1}`,`P${i+1}`,[x!,y!,33],`motor${i+1}`,'bottom','top',1),
  ...mounted(`esc${i+1}`,`ESC${i+1}`,[x!*0.67,y!*0.67,7],`motor${i+1}`,[x!*.33,y!*.33,0],'origin',-9.5),
  ...mounted(`spacer${i+1}`,`MP${i+1}`,[Math.sign(x!)*22,Math.sign(y!)*17,11],'frame','bottom',`mounting_holes.h${frameHole[i]}`),
 ]),
 ...centers.flatMap((_,i)=>[instance(`screw${i+1}`,`F${i+1}`,[0,0,0]),{type:'assembly.mount',args:{doc:'Drone assembly',instance:`screw${i+1}`,target:'holder',sourceAnchor:'shoulder',targetAnchor:`mounting_holes.h${i+1}`}}]),
 ...[1,2,3,4,5].flatMap(i=>mounted(`connector${i}`,`J${i}`,[(i===5?5:i*10)-25,i===5?0:1.31,10.6],'board',[-(i===5?5:i*10),-(i===5?12.5:13.81),0],'origin',5.6)),
 {type:'doc.create',args:{kind:'device-analysis',name:'Flight estimates',data:{
  // Rotors are the placed motors; thrust data comes from the motor and propeller parts.
  assembly:'Drone assembly',battery:{voltage:11.1,capacityAh:.85,resistance:.08,usableFraction:.8,voltageMin:9.9,maxCurrent:40},electronicsCurrent:.2,addedMass:15,
 }}},
 {type:'doc.create',args:{kind:'simulation',name:'Motor circuit',data:{duration:.1,step:.00005,probes:['V(VBAT)','V(3V3)','ESC1.thrust','I(BT1)']}}},
 {type:'doc.create',args:{kind:'firmware',name:'ESP32 bench pulses',data:{platform:'esp32',board:'esp32c3',mcu:'U1',files:{'main.ino':`#include "m4k3r_pins.h"

// Bench signal generator, not a flight controller.
// The IMU, stabilization, arming and failsafe control must be implemented and tested
// for a real aircraft. Minimum pulses keep motors stopped by default.
const int motors[] = {PIN_MOTOR_1, PIN_MOTOR_2, PIN_MOTOR_3, PIN_MOTOR_4};
const int pulseUs = 1000; // 1000 = stopped; 1000–2000 us is the servo ESC input range.

void setup() {
  Serial.begin(115200);
  for (int pin : motors) pinMode(pin, OUTPUT);
  Serial.println("ESP32 bench ready: minimum ESC pulses, motors stopped");
}
void loop() {
  for (int pin : motors) digitalWrite(pin, HIGH);
  delayMicroseconds(pulseUs);
  for (int pin : motors) digitalWrite(pin, LOW);
  delayMicroseconds(20000 - pulseUs);
}
`}}}},
]

export function createDrone(store:ProjectStore) {
 const project=store.create('ESP32 drone planner')
 try {store.apply(project.id,droneCommands,'Create editable ESP32 drone planning project')}
 catch(error) {store.delete(project.id);throw error}
 return store.get(project.id)
}
