import { expect, test } from "bun:test"
import { blockRow, rowDragging, type RowActions } from "../../src/web/timeline-row.ts"
import type { Placed } from "../../src/shared/timeline.ts"

type Handler = (event: { readonly button?: number; readonly pointerId?: number }) => void

class FakeEl {
  readonly tag: string
  readonly dataset: Record<string, string> = {}
  readonly children: Array<FakeEl> = []
  readonly listeners = new Map<string, Array<Handler>>()
  private readonly classes = new Set<string>()
  parent: FakeEl | undefined = undefined
  constructor(tag: string) {
    this.tag = tag
  }
  setAttribute(name: string, value: string): void {
    if (name.startsWith("data-")) this.dataset[name.slice("data-".length)] = value
  }
  append(...kids: Array<FakeEl | string>): void {
    for (const kid of kids) {
      if (typeof kid === "string") continue
      kid.parent = this
      this.children.push(kid)
    }
  }
  before(...nodes: Array<FakeEl>): void {
    const siblings = this.parent?.children
    if (siblings === undefined) return
    for (const node of nodes) {
      const at = siblings.indexOf(node)
      if (at !== -1) siblings.splice(at, 1)
      siblings.splice(siblings.indexOf(this), 0, node)
      node.parent = this.parent
    }
  }
  after(...nodes: Array<FakeEl>): void {
    const siblings = this.parent?.children
    if (siblings === undefined) return
    for (const node of nodes) {
      const at = siblings.indexOf(node)
      if (at !== -1) siblings.splice(at, 1)
      siblings.splice(siblings.indexOf(this) + 1, 0, node)
      node.parent = this.parent
    }
  }
  addEventListener(name: string, fn: Handler): void {
    const known = this.listeners.get(name) ?? []
    known.push(fn)
    this.listeners.set(name, known)
  }
  removeEventListener(): void {}
  setPointerCapture(): void {}
  readonly classList = {
    add: (name: string): void => {
      this.classes.add(name)
    },
    remove: (name: string): void => {
      this.classes.delete(name)
    }
  }
  dispatch(name: string, event: { readonly button?: number; readonly pointerId?: number }): void {
    for (const fn of this.listeners.get(name) ?? []) fn(event)
  }
}

const placed = (id: string): Placed => ({
  block: { id, title: id, takes: [{ video: "a", from: 0, to: 0, reason: "clean" }] },
  take: { video: "a", from: 0, to: 0, reason: "clean" },
  pauses: [],
  spans: [{ start: 0, end: 1 }]
})

interface Calls {
  reorder: Array<ReadonlyArray<string>>
  select: Array<string>
}

const setup = (): { row: FakeEl; handle: (id: string) => FakeEl; calls: Calls } => {
  Object.assign(globalThis, {
    HTMLElement: FakeEl,
    document: { createElement: (tag: string) => new FakeEl(tag) }
  })
  const calls: Calls = { reorder: [], select: [] }
  const actions: RowActions = {
    select: (block: string) => {
      calls.select.push(block)
    },
    textOf: () => "words",
    reorder: (blocks: ReadonlyArray<string>) => {
      calls.reorder.push(blocks)
    },
    setPause: () => {}
  }
  const made: unknown = blockRow([placed("a"), placed("b"), placed("c")], undefined, actions)
  if (!(made instanceof FakeEl)) throw new Error("no row")
  const row = made
  const handle = (id: string): FakeEl => {
    const want = "handle:" + id
    const found = (node: FakeEl): FakeEl | undefined =>
      node.dataset["key"] === want ? node : node.children.flatMap((kid) => found(kid) ?? []).at(0)
    const node = found(row)
    if (node === undefined) throw new Error("no handle " + id)
    return node
  }
  return { row, handle, calls }
}

const ids = (row: FakeEl): ReadonlyArray<string> => row.children.map((slot) => slot.dataset["id"] ?? "")

test("a drag that crosses a poll keeps the pointer and saves the reached order", () => {
  const { row, handle, calls } = setup()
  expect(rowDragging()).toBe(false)
  handle("b").dispatch("pointerdown", { button: 0, pointerId: 1 })
  expect(rowDragging()).toBe(true)
  const third = row.children[2]
  const second = row.children[1]
  if (third === undefined || second === undefined) throw new Error("no slots")
  third.after(second)
  expect(ids(row)).toEqual(["a", "c", "b"])
  handle("b").dispatch("pointerup", {})
  expect(calls.reorder).toEqual([["a", "c", "b"]])
  expect(calls.select).toEqual(["b"])
  expect(rowDragging()).toBe(false)
})

test("pressing a handle without moving selects its block and saves nothing", () => {
  const { handle, calls } = setup()
  handle("a").dispatch("pointerdown", { button: 0, pointerId: 2 })
  expect(rowDragging()).toBe(true)
  handle("a").dispatch("pointerup", {})
  expect(calls.reorder).toEqual([])
  expect(calls.select).toEqual(["a"])
  expect(rowDragging()).toBe(false)
})

test("a press with another button starts no drag", () => {
  const { handle } = setup()
  handle("a").dispatch("pointerdown", { button: 2, pointerId: 3 })
  expect(rowDragging()).toBe(false)
})
