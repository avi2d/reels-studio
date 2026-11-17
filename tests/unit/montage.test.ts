import { expect, test } from "bun:test"
import { montage } from "../../src/web/montage.ts"
import type { Clip } from "../../src/shared/timeline.ts"

class FakeVideo {
  dataset: Record<string, string | undefined> = {}
  currentTime = 0
  volume = 1
  ended = false
  seeking = false
  isConnected = true
  srcSets = 0
  private innerSrc = ""
  private listeners = new Map<string, Array<() => void>>()
  get src(): string {
    return this.innerSrc
  }
  set src(value: string) {
    this.innerSrc = value
    this.srcSets += 1
  }
  setAttribute(): void {}
  removeAttribute(name: string): void {
    if (name === "data-video") delete this.dataset["video"]
  }
  append(): void {}
  addEventListener(name: string, fn: () => void): void {
    const known = this.listeners.get(name) ?? []
    known.push(fn)
    this.listeners.set(name, known)
  }
  removeEventListener(): void {}
  play(): Promise<void> {
    return Promise.resolve()
  }
  pause(): void {}
  fire(name: string): void {
    for (const fn of this.listeners.get(name) ?? []) fn()
  }
}

const setup = (): { player: ReturnType<typeof montage>; node: FakeVideo } => {
  const node = new FakeVideo()
  Object.assign(globalThis, { document: { createElement: () => node } })
  Object.assign(globalThis, { requestAnimationFrame: () => 0 })
  const player = montage("project", () => {})
  return { player, node }
}

const clip = (video: string, start: number): Clip => ({ video, start, end: start + 5 })

test("a preview that fails mid-montage loads from the server again on the next play", () => {
  const { player, node } = setup()
  const first = clip("a", 2)
  player.play([first])
  expect(node.srcSets).toBe(1)
  node.fire("error")
  player.play([first])
  expect(node.srcSets).toBe(2)
})

test("a preview that fails while shown loads again on the next show", () => {
  const { player, node } = setup()
  const first = clip("a", 2)
  player.show(first)
  expect(node.srcSets).toBe(1)
  node.fire("error")
  player.show(first)
  expect(node.srcSets).toBe(2)
})
