import { SimError, type ModelFactory } from "../model"

/** Deterministic PRNG (mulberry32), so runs are repeatable. */
function random(key: string) {
  let a = [...key].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261)
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A mechanical contact. On a change it chatters a few times, then settles within `bounce` seconds. */
export class Contact {
  private edges: [t: number, closed: boolean][] = []
  private rand: () => number

  constructor(
    public closed: boolean,
    private bounce: number,
    key: string,
  ) {
    this.rand = random(key)
  }

  set(target: boolean, t: number) {
    const last = this.edges.at(-1)?.[1] ?? this.closed
    if (target === last) return
    const chatter = this.bounce > 0 ? [this.rand(), this.rand(), this.rand(), this.rand()].sort((a, b) => a - b) : []
    this.edges = [
      [t, target],
      ...chatter.map((f, i): [number, boolean] => [t + f * this.bounce, i % 2 === 0 ? !target : target]),
      [t + this.bounce, target],
    ]
  }

  at(t: number): boolean {
    while (this.edges.length && this.edges[0]![0] <= t) this.closed = this.edges.shift()![1]
    return this.closed
  }
}

/** Momentary, normally open. Inputs: press, release. */
export const button: ModelFactory = (ctx) => {
  const a = ctx.pin("1")
  const b = ctx.pin("2")
  const ron = ctx.num("ron", 0.05)
  const contact = new Contact(false, ctx.num("bounceMs", 5) / 1000, ctx.ref)
  let pressed = false
  let g = 0
  return {
    stamp(s) {
      g = contact.at(s.t) ? 1 / ron : 0
      s.conductance(a, b, g)
    },
    current: () => (ctx.v(a) - ctx.v(b)) * g,
    view: () => ({ pressed, closed: g > 0 }),
    input(e) {
      if (e.action !== "press" && e.action !== "release") throw new SimError(`${ctx.ref}: actions are press, release`)
      pressed = e.action === "press"
      contact.set(pressed, e.t)
    },
  }
}
