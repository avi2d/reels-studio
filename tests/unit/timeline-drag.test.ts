import { expect, test } from "bun:test"
import { timelineCard } from "../../src/web/timeline.ts"

interface FakeEvent {
  readonly button?: number
  readonly pointerId?: number
  readonly clientX?: number
  readonly clientY?: number
  readonly key?: string
  readonly code?: string
  target?: FakeEl
  preventDefault: () => void
}

type Handler = (event: FakeEvent) => void

const fakeEvent = (init: { readonly button?: number; readonly pointerId?: number; readonly clientX?: number; readonly clientY?: number; readonly key?: string; readonly code?: string; readonly target?: FakeEl }): FakeEvent => ({
  ...init,
  preventDefault: () => {}
})

class FakeEl {
  readonly tag: string
  readonly dataset: Record<string, string> = {}
  readonly children: Array<FakeEl> = []
  rect = { left: 0, top: 0, right: 0, bottom: 0 }
  parent: FakeEl | undefined = undefined
  hidden = false
  disabled = false
  textContent = ""
  title = ""
  scrollLeft = 0
  currentTime = 0
  volume = 1
  ended = false
  seeking = false
  readyState = 0
  style = { transform: "" }
  src = ""
  private attrs: Record<string, string> = {}
  private classes = new Set<string>()
  private readonly listeners = new Map<string, Array<Handler>>()
  constructor(tag: string) {
    this.tag = tag
  }
  get isConnected(): boolean {
    return true
  }
  get firstElementChild(): FakeEl | null {
    return this.children[0] ?? null
  }
  setAttribute(name: string, value: string): void {
    this.attrs[name] = value
    if (name === "class") this.classes = new Set(value.split(" ").filter((one) => one !== ""))
    if (name.startsWith("data-")) this.dataset[name.slice(5)] = value
  }
  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }
  removeAttribute(name: string): void {
    delete this.attrs[name]
    if (name === "class") this.classes = new Set()
    if (name.startsWith("data-")) delete this.dataset[name.slice(5)]
  }
  append(...kids: Array<FakeEl | string>): void {
    for (const kid of kids) {
      if (typeof kid === "string") continue
      kid.parent = this
      this.children.push(kid)
    }
  }
  prepend(...kids: Array<FakeEl | string>): void {
    const kept: Array<FakeEl> = []
    for (const kid of kids) {
      if (typeof kid === "string") continue
      kid.parent = this
      kept.push(kid)
    }
    this.children.unshift(...kept)
  }
  replaceChildren(...kids: Array<FakeEl | string>): void {
    for (const kid of this.children) kid.parent = undefined
    this.children.length = 0
    this.append(...kids)
  }
  before(...nodes: Array<FakeEl>): void {
    moveNodes(this, nodes, "before")
  }
  after(...nodes: Array<FakeEl>): void {
    moveNodes(this, nodes, "after")
  }
  addEventListener(name: string, fn: Handler): void {
    const known = this.listeners.get(name) ?? []
    known.push(fn)
    this.listeners.set(name, known)
  }
  removeEventListener(name: string, fn: Handler): void {
    this.listeners.set(name, (this.listeners.get(name) ?? []).filter((one) => one !== fn))
  }
  focus(): void {}
  scrollIntoView(): void {}
  setPointerCapture(): void {}
  play(): Promise<void> {
    return Promise.resolve()
  }
  pause(): void {}
  getBoundingClientRect(): { readonly left: number; readonly top: number; readonly right: number; readonly bottom: number; readonly width: number; readonly height: number } {
    return { ...this.rect, width: this.rect.right - this.rect.left, height: this.rect.bottom - this.rect.top }
  }
  matches(selector: string): boolean {
    if (selector === "[data-key]") return this.dataset["key"] !== undefined
    if (!selector.startsWith(".")) return this.tag === selector
    return selector.slice(1).split(".").every((one) => this.classes.has(one))
  }
  closest(selector: string): FakeEl | null {
    return closestAbove(this, selector)
  }
  querySelectorAll(selector: string): Array<FakeEl> {
    const found: Array<FakeEl> = []
    const walk = (node: FakeEl): void => {
      for (const kid of node.children) {
        if (kid.matches(selector)) found.push(kid)
        walk(kid)
      }
    }
    walk(this)
    return found
  }
  querySelector(selector: string): FakeEl | null {
    return this.querySelectorAll(selector)[0] ?? null
  }
  fire(name: string, event: FakeEvent): void {
    for (const fn of this.listeners.get(name) ?? []) fn(event)
  }
  dispatch(name: string, event: FakeEvent): void {
    if (event.target === undefined) event.target = this
    bubble(this, name, event)
  }
  readonly classList = {
    add: (name: string): void => {
      this.classes.add(name)
    },
    remove: (name: string): void => {
      this.classes.delete(name)
    },
    toggle: (name: string, force?: boolean): void => {
      if (force === undefined) {
        if (this.classes.has(name)) this.classes.delete(name)
        else this.classes.add(name)
      } else if (force) this.classes.add(name)
      else this.classes.delete(name)
    },
    contains: (name: string): boolean => this.classes.has(name)
  }
}

const moveNodes = (slot: FakeEl, nodes: ReadonlyArray<FakeEl>, side: "before" | "after"): void => {
  const siblings = slot.parent?.children
  if (siblings === undefined) return
  for (const node of nodes) {
    const at = siblings.indexOf(node)
    if (at !== -1) siblings.splice(at, 1)
    siblings.splice(siblings.indexOf(slot) + (side === "after" ? 1 : 0), 0, node)
    node.parent = slot.parent
  }
}

const docListeners = new Map<string, Array<Handler>>()

const closestAbove = (node: FakeEl | undefined, selector: string): FakeEl | null => {
  if (node === undefined) return null
  const hit = selector.split(",").some((part) => node.matches(part.trim()))
  return hit ? node : closestAbove(node.parent, selector)
}

const bubble = (node: FakeEl | undefined, name: string, event: FakeEvent): void => {
  if (node === undefined) {
    for (const fn of docListeners.get(name) ?? []) fn(event)
    return
  }
  node.fire(name, event)
  bubble(node.parent, name, event)
}

interface Put {
  readonly url: string
  readonly body: unknown
}

const orderOf = (put: Put | undefined): ReadonlyArray<string> => {
  if (put === undefined) throw new Error("no saved order")
  if (typeof put.body !== "object" || put.body === null) throw new Error("bad saved body")
  const sent: unknown = Object.getOwnPropertyDescriptor(put.body, "edits")?.value ?? put.body
  if (typeof sent !== "object" || sent === null) throw new Error("bad saved order")
  const order: unknown = Object.getOwnPropertyDescriptor(sent, "order")?.value
  if (!Array.isArray(order) || !order.every((one: unknown): one is string => typeof one === "string")) throw new Error("bad saved order")
  return order
}

const words = [
  { start: 0, end: 1, text: "раз" },
  { start: 3, end: 4, text: "два" },
  { start: 6, end: 7, text: "три" },
  { start: 9, end: 10, text: "четыре" },
  { start: 12, end: 13, text: "пять" },
  { start: 15, end: 16, text: "шесть" }
]

const takeOf = (from: number, to: number): { readonly video: string; readonly from: number; readonly to: number; readonly reason: string } =>
  ({ video: "a", from, to, reason: "чисто" })

const blocksOf = (count: number): Array<{ readonly id: string; readonly title: string; readonly takes: Array<ReturnType<typeof takeOf>> }> => {
  const titles = ["Первый", "Второй", "Третий", "Четвёртый"]
  const ranges: Array<readonly [number, number]> = [[0, 1], [2, 3], [4, 5], [0, 1]]
  const ids = ["a", "b", "c", "d"]
  return ids.slice(0, count).map((id, index) => ({ id, title: titles[index] ?? id, takes: [takeOf(ranges[index]?.[0] ?? 0, ranges[index]?.[1] ?? 1)] }))
}

const setup = (blocks: number): { readonly card: ReturnType<typeof timelineCard>; readonly puts: Array<Put>; readonly swapBlocks: (count: number) => void } => {
  docListeners.clear()
  const puts: Array<Put> = []
  let count = blocks
  const videos = { videos: [{ name: "a", state: "ready", transcript: { duration: 20, words } }] }
  const timeline = (): unknown => ({
    looks: [{ video: "a", state: "measured" }],
    faces: [],
    pictures: [],
    inserts: { state: "none" },
    timeline: { state: "ready", blocks: blocksOf(count), dropped: 0, edits: { order: [], deleted: [], chosen: [], pauses: [] } },
    gathering: false,
    gatherFailed: false
  })
  Object.assign(globalThis, {
    HTMLElement: FakeEl,
    Element: FakeEl,
    document: {
      createElement: (tag: string) => new FakeEl(tag),
      activeElement: undefined,
      addEventListener: (name: string, fn: Handler) => {
        const known = docListeners.get(name) ?? []
        known.push(fn)
        docListeners.set(name, known)
      },
      removeEventListener: (name: string, fn: Handler) => {
        docListeners.set(name, (docListeners.get(name) ?? []).filter((one) => one !== fn))
      }
    },
    requestAnimationFrame: () => 0,
    fetch: (url: string, init?: { readonly method?: string; readonly body?: string }) => {
      if (init?.method === "PUT") {
        const parsed: unknown = JSON.parse(init.body ?? "{}")
        puts.push({ url, body: parsed })
        const reply: unknown = typeof parsed === "object" && parsed !== null ? (Object.getOwnPropertyDescriptor(parsed, "edits")?.value ?? parsed) : parsed
        return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(reply) })
      }
      const body = url.endsWith("/videos") ? videos : timeline()
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) })
    }
  })
  const card = timelineCard("p1", { ask: () => {}, openTakes: () => {}, status: () => {} }, () => 0)
  return { card, puts, swapBlocks: (next: number) => { count = next } }
}

const rowHolderOf = (card: ReturnType<typeof timelineCard>): FakeEl => {
  const tracks: unknown = card.panels.tracks
  if (!(tracks instanceof FakeEl)) throw new Error("no tracks")
  const holder = tracks.querySelector(".blocks-holder")
  if (holder === null) throw new Error("no row holder")
  return holder
}

const rowIds = (card: ReturnType<typeof timelineCard>): Array<string> => {
  const row = rowHolderOf(card).firstElementChild
  if (row === null) return []
  return row.children.map((slot) => slot.dataset["id"] ?? "?")
}

const findKey = (card: ReturnType<typeof timelineCard>, key: string): FakeEl => {
  const tracks: unknown = card.panels.tracks
  if (!(tracks instanceof FakeEl)) throw new Error("no tracks")
  const node = tracks.querySelectorAll("[data-key]").find((one) => one.dataset["key"] === key)
  if (node === undefined) throw new Error("no key " + key)
  return node
}

const dragging = (card: ReturnType<typeof timelineCard>): boolean =>
  rowHolderOf(card).querySelector(".slot.dragging") !== null

const until = async (ready: () => boolean, what: string): Promise<void> => {
  for (let i = 0; i < 100; i++) {
    if (ready()) return
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
  throw new Error("timed out waiting for " + what)
}

test("a poll mid-drag keeps the row while the drag saves the reached order", async () => {
  const { card, puts } = setup(3)
  card.refresh()
  await until(() => rowIds(card).length === 3, "the first row")
  const rowBefore = rowHolderOf(card).firstElementChild
  const handle = findKey(card, "handle:b")
  handle.dispatch("pointerdown", fakeEvent({ button: 0, pointerId: 1 }))
  expect(dragging(card)).toBe(true)
  card.refresh()
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (rowHolderOf(card).firstElementChild !== rowBefore) throw new Error("the poll rebuilt the row mid-drag")
  expect(dragging(card)).toBe(true)
  const slots = rowHolderOf(card).firstElementChild?.children ?? []
  slots.forEach((slot, index) => {
    slot.rect = { left: index * 100, top: 0, right: index * 100 + 90, bottom: 40 }
  })
  handle.dispatch("pointermove", fakeEvent({ clientX: 250, clientY: 20 }))
  expect(rowIds(card)).toEqual(["a", "c", "b"])
  handle.dispatch("pointerup", fakeEvent({}))
  await until(() => puts.length === 1, "the saved order")
  expect(orderOf(puts[0])).toEqual(["a", "c", "b"])
  expect(rowIds(card)).toEqual(["a", "c", "b"])
  expect(dragging(card)).toBe(false)
})

test("a poll after keys rebuild the row mid-drag is processed, not deferred", async () => {
  const { card, swapBlocks } = setup(3)
  card.refresh()
  await until(() => rowIds(card).length === 3, "the first row")
  const oldRow = rowHolderOf(card).firstElementChild
  findKey(card, "handle:b").dispatch("pointerdown", fakeEvent({ button: 0, pointerId: 1 }))
  expect(dragging(card)).toBe(true)
  findKey(card, "handle:b").dispatch("keydown", fakeEvent({ key: "ArrowRight", code: "ArrowRight" }))
  await until(() => rowIds(card).join() === "a,c,b", "the keyboard move")
  if (rowHolderOf(card).firstElementChild === oldRow) throw new Error("the keys never rebuilt the row")
  expect(dragging(card)).toBe(false)
  swapBlocks(4)
  card.refresh()
  await until(() => rowIds(card).length === 4, "the new block on screen")
  expect(rowIds(card).join()).toContain("d")
})
