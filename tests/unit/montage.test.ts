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
  readyState = 0
  srcSets = 0
  readonly classList = { toggle: (): void => {} }
  private innerSrc = ""
  private readonly listeners = new Map<string, Array<() => void>>()
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
  remove(): void {
    this.isConnected = false
  }
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

const setup = (): { player: ReturnType<typeof montage>; srcSets: () => number; failShown: () => void } => {
  const videos: Array<FakeVideo> = []
  const createElement = (tag: string): FakeVideo => {
    const made = new FakeVideo()
    if (tag === "video") videos.push(made)
    return made
  }
  Object.assign(globalThis, { document: { createElement } })
  Object.assign(globalThis, { requestAnimationFrame: () => 0 })
  const player = montage("project", () => {})
  return {
    player,
    srcSets: () => videos.reduce((sum, video) => sum + video.srcSets, 0),
    failShown: () => { videos.at(-1)?.fire("error") }
  }
}

const clip = (video: string, start: number): Clip => ({ video, start, end: start + 5, block: "a" })

test("a preview that fails mid-montage loads from the server again on the next play", () => {
  const { player, srcSets, failShown } = setup()
  const first = clip("a", 2)
  player.play([first])
  expect(srcSets()).toBe(1)
  failShown()
  player.play([first])
  expect(srcSets()).toBe(2)
})

test("a preview that fails while shown loads again on the next show", () => {
  const { player, srcSets, failShown } = setup()
  const first = clip("a", 2)
  player.show(first)
  expect(srcSets()).toBe(1)
  failShown()
  player.show(first)
  expect(srcSets()).toBe(2)
})
