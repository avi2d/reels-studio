import { expect, test } from "bun:test"
import type { Clip, JoinAnswer } from "../../src/shared/timeline.ts"
import { placeList, type PlaceCoverage } from "../../src/web/timeline-places.ts"

class FakeEl {
  readonly tag: string
  readonly dataset: Record<string, string> = {}
  readonly children: Array<FakeEl> = []
  textContent = ""
  scrollTop = 0
  constructor(tag: string) {
    this.tag = tag
  }
  setAttribute(name: string, value: string): void {
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, one: string) => one.toUpperCase())] = value
  }
  addEventListener(): void {}
  append(...kids: Array<FakeEl | string>): void {
    for (const kid of kids) {
      if (typeof kid === "string") {
        this.textContent += kid
        continue
      }
      this.children.push(kid)
    }
  }
  querySelector(selector: string): FakeEl | null {
    const walk = (node: FakeEl): FakeEl | null => {
      for (const kid of node.children) {
        if (selector.startsWith(".") ? kid.tag === "ol" : kid.tag === selector) return kid
        const found = walk(kid)
        if (found !== null) return found
      }
      return null
    }
    return walk(this)
  }
}

Object.assign(globalThis, { document: { createElement: (tag: string) => new FakeEl(tag) } })

const actions = { hearJoin: (): void => {}, answer: (): void => {} }

const edge = (video: string, block: string, at: number): Clip => ({ video, block, start: at, end: at })

const place = (answer: JoinAnswer | undefined, cut: number) => ({
  join: { after: 1, end: edge("a", "x", 2), start: edge("b", "y", 0.5) },
  shift: 0.5,
  trim: { end: 1.9, start: 0.5, cut, spoken: undefined },
  answer
})

const statusOf = (root: FakeEl): string =>
  root.children.filter((kid) => kid.tag === "p").map((kid) => kid.textContent).join("\n")

const listOf = (root: FakeEl): FakeEl | null => root.querySelector(".place-list")

const complete: PlaceCoverage = { waiting: false, failed: [] }

test("an empty list while heads are still measured promises places instead of claiming a clean reel", () => {
  const root = placeList([], [], { waiting: true, failed: [] }, actions) as unknown as FakeEl
  expect(statusOf(root)).toContain("Студия ещё измеряет")
  expect(statusOf(root)).not.toContain("не прыгает")
})

test("an empty list with a failed measurement names the videos instead of claiming a clean reel", () => {
  const root = placeList([], [], { waiting: false, failed: ["a"] }, actions) as unknown as FakeEl
  expect(statusOf(root)).toContain("не удалось измерить")
  expect(statusOf(root)).toContain("a")
  expect(statusOf(root)).not.toContain("не прыгает")
})

test("an empty list with complete measurement still claims a clean reel", () => {
  const root = placeList([], [], complete, actions) as unknown as FakeEl
  expect(statusOf(root)).toContain("Голова нигде не прыгает на склейках.")
})

test("a failed measurement is attached to the counts instead of replacing them", () => {
  const root = placeList([place(undefined, 0.4)], [], { waiting: false, failed: ["b"] }, actions) as unknown as FakeEl
  expect(statusOf(root)).toContain("Осталось проверить 1 из 1.")
  expect(statusOf(root)).toContain("неполная")
})

test("the places list carries a stable scroll key across redraws", () => {
  const first = listOf(placeList([place(undefined, 0.4)], [], complete, actions) as unknown as FakeEl)
  const second = listOf(placeList([place(undefined, 0.4)], [], complete, actions) as unknown as FakeEl)
  expect(first?.dataset["scrollKey"]).toBe("places")
  expect(second?.dataset["scrollKey"]).toBe(first?.dataset["scrollKey"])
})
