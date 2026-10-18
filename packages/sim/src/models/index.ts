import type { ModelFactory } from "../model"
import { battery } from "./battery"
import { button } from "./button"
import { capacitor } from "./capacitor"
import { dcMotor } from "./dc-motor"
import { diode } from "./diode"
import { inductor } from "./inductor"
import { led } from "./led"
import { nmos } from "./nmos"
import { resistor } from "./resistor"
import { toggleSwitch } from "./switch"
import { vsource } from "./vsource"

/** Keyed by part.sim.model */
export const models: Record<string, ModelFactory> = {
  resistor, capacitor, inductor, diode, led, battery, button, switch: toggleSwitch, "dc-motor": dcMotor, nmos, vsource,
}
