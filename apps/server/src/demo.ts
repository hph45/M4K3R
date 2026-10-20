import type { Command } from "@m4k3r/core"
import type { ProjectStore } from "./store"

/** A small, editable project exercising each implemented workspace, using only local built-ins. */
export const demoCommands: Command[] = [
  { type: "variable.set", args: { name: "width", value: "65 mm" } },
  { type: "variable.set", args: { name: "length", value: "45 mm" } },
  { type: "variable.set", args: { name: "wall", value: "2 mm" } },
  { type: "component.add", args: { part: "battery", ref: "BT1" } },
  { type: "component.add", args: { part: "push-button", ref: "SW1", props: { bounceMs: "5" } } },
  { type: "component.add", args: { part: "resistor", ref: "R1", props: { value: "150" } } },
  { type: "component.add", args: { part: "led", ref: "D1", props: { color: "red" } } },
  { type: "component.add", args: { part: "dc-motor", ref: "M1", props: { voltage: "3.7V" } } },
  { type: "net.connect", args: { name: "VBAT", pins: ["BT1.+", "SW1.1"] } },
  { type: "net.connect", args: { name: "SW", pins: ["SW1.2", "R1.1", "M1.1"] } },
  { type: "net.connect", args: { name: "LED", pins: ["R1.2", "D1.A"] } },
  { type: "net.connect", args: { name: "GND", pins: ["BT1.-", "D1.K", "M1.2"] } },
  { type: "doc.create", args: { kind: "schematic", name: "Circuit" } },
  { type: "schematic.autoplace", args: { doc: "Circuit" } },
  { type: "schematic.place", args: { doc: "Circuit", component: "BT1", x: 20, y: 70 } },
  { type: "schematic.place", args: { doc: "Circuit", component: "SW1", x: 55, y: 35 } },
  { type: "schematic.place", args: { doc: "Circuit", component: "R1", x: 80, y: 35, rotation: 90 } },
  { type: "schematic.place", args: { doc: "Circuit", component: "D1", x: 105, y: 65, rotation: 90 } },
  { type: "schematic.place", args: { doc: "Circuit", component: "M1", x: 140, y: 65 } },
  { type: "doc.create", args: { kind: "simulation", name: "Button lab", data: {
    duration: 1, step: 0.00005, speed: 1, probes: ["V(SW)", "V(LED)", "I(D1)"],
  } } },
  { type: "doc.create", args: { kind: "part-studio", name: "Enclosure", data: {
    material: "PLA",
    features: [
      { type: "sketch", id: "outline", entities: [
        { type: "rectangle", id: "base", width: "width", height: "length" },
      ] },
      { type: "extrude", id: "case", sketch: "outline", depth: 20 },
      { type: "shell", id: "walls", thickness: "wall", faces: { normal: "+z" } },
    ],
  } } },
  { type: "doc.create", args: { kind: "firmware", name: "Pico blink", data: {
    files: { "main.ino": `#include "m4k3r_pins.h"

// A standalone Pico blink example. Build & run shows serial and GPIO output.
// The analog circuit in Button lab runs separately.
void setup() {
  Serial.begin(115200);
  pinMode(LED_BUILTIN, OUTPUT);
}

void loop() {
  digitalWrite(LED_BUILTIN, HIGH);
  Serial.println("LED on");
  delay(100);
  digitalWrite(LED_BUILTIN, LOW);
  Serial.println("LED off");
  delay(100);
}
` },
  } } },
]

export function createDemo(store: ProjectStore) {
  const project = store.create("Button lab")
  store.apply(project.id, demoCommands, "Create starter circuit, enclosure and firmware")
  return store.get(project.id)
}
