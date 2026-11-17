import { expect, test } from "bun:test"
import { onKeys } from "../../src/web/timeline-keys.ts"
import type { Block, Placed } from "../../src/shared/timeline.ts"

class FakeElement {
  readonly selectors: ReadonlyArray<string>
  constructor(selectors: ReadonlyArray<string> = []) {
    this.selectors = selectors
  }
  closest(selector: string): object | null {
    return this.selectors.includes(selector) ? this : null
  }
}

interface Captured {
  readonly name: string
  readonly fn: (event: Record<string, unknown>) => void
}

interface Calls {
  toggle: number
  step: Array<string>
  choose: Array<string>
  deleted: Array<string>
  undo: number
  prevented: number
}

const setup = (): { calls: Calls; press: (target: FakeElement, code: string, eventKey: string) => void } => {
  const captured: Array<Captured> = []
  const calls: Calls = { toggle: 0, step: [], choose: [], deleted: [], undo: 0, prevented: 0 }
  Object.assign(globalThis, { Element: FakeElement })
  Object.assign(globalThis, {
    document: {
      addEventListener: (name: string, fn: (event: Record<string, unknown>) => void) => {
        captured.push({ name, fn })
      },
      removeEventListener: () => {}
    }
  })
  const anchor = { isConnected: true }
  const first: Block = {
    id: "advance",
    title: "Advance",
    takes: [
      { video: "b", from: 0, to: 1, reason: "clean" },
      { video: "a", from: 0, to: 4, reason: "clean" }
    ]
  }
  const second: Block = { id: "deposit", title: "Deposit", takes: [{ video: "a", from: 5, to: 6, reason: "clean" }] }
  const openA: Placed = { block: first, take: first.takes[0], pauses: [], spans: [{ start: 1, end: 2 }] }
  const openB: Placed = { block: second, take: second.takes[0], pauses: [], spans: [{ start: 6, end: 12 }] }
  const now = (): { readonly placed: ReadonlyArray<Placed>; readonly open: Placed | undefined } => ({ placed: [openA, openB], open: openA })
  onKeys(anchor, now, {
    toggle: () => {
      calls.toggle += 1
    },
    step: (id: string) => {
      calls.step.push(id)
    },
    choose: (id: string) => {
      calls.choose.push(id)
    },
    setDeleted: (id: string) => {
      calls.deleted.push(id)
    },
    undo: () => {
      calls.undo += 1
    }
  })
  const key = captured.find((one) => one.name === "keydown")?.fn ?? (() => {})
  const press = (target: FakeElement, code: string, eventKey: string): void => {
    const flag = { stopped: false }
    key({ code, key: eventKey, target, ctrlKey: false, metaKey: false, altKey: false, preventDefault: () => { flag.stopped = true } })
    if (flag.stopped) calls.prevented += 1
  }
  return { calls, press }
}

test("arrows on a block handle move the block itself, and Delete and take numbers still delete and choose", () => {
  const { calls, press } = setup()
  const handle = new FakeElement([".handle"])
  press(handle, "ArrowRight", "ArrowRight")
  expect(calls.step).toEqual([])
  press(handle, "Delete", "Delete")
  expect(calls.deleted).toEqual(["advance"])
  press(handle, "Digit1", "1")
  expect(calls.choose).toEqual(["advance"])
})

test("arrows away from a handle open the next block", () => {
  const { calls, press } = setup()
  press(new FakeElement([]), "ArrowRight", "ArrowRight")
  expect(calls.step).toEqual(["deposit"])
})
