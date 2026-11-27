import { afterAll, beforeAll, expect, test } from "bun:test"
import type { Clip, VideoFaces } from "../../src/shared/timeline.ts"

const montageModulePath = "../../src/web/montage.ts?audio-tests"
const { montage }: typeof import("../../src/web/montage.ts") = await import(montageModulePath)

class FakeAudioNode {
  next: FakeAudioNode | undefined
  connect(target: FakeAudioNode): FakeAudioNode {
    this.next = target
    return target
  }
  disconnect(): void {
    this.next = undefined
  }
}

class FakeAudioContext {
  static readonly instances: Array<FakeAudioContext> = []
  static readonly sources: Array<FakeAudioNode> = []
  state = "running"
  currentTime = 0
  resumes = 0
  readonly destination = new FakeAudioNode()
  constructor() { FakeAudioContext.instances.push(this) }
  createMediaElementSource(): FakeAudioNode {
    const source = new FakeAudioNode()
    FakeAudioContext.sources.push(source)
    return source
  }
  resume(): Promise<void> {
    this.resumes += 1
    this.state = "running"
    return Promise.resolve()
  }
}

class FakeGain extends FakeAudioNode {
  static readonly instances: Array<FakeGain> = []
  readonly gain = { value: 1, setTargetAtTime: (value: number): void => { this.gain.value = value } }
  constructor(_context: FakeAudioContext, options?: { readonly gain: number }) {
    super()
    this.gain.value = options?.gain ?? 1
    FakeGain.instances.push(this)
  }
}

const originalAudio = { AudioContext: globalThis.AudioContext, GainNode: globalThis.GainNode, DynamicsCompressorNode: globalThis.DynamicsCompressorNode }
beforeAll(() => {
  Object.assign(globalThis, { AudioContext: FakeAudioContext, GainNode: FakeGain, DynamicsCompressorNode: FakeAudioNode })
})
afterAll(() => { Object.assign(globalThis, originalAudio) })

class FakeVideo {
  dataset: Record<string, string | undefined> = {}
  currentTime = 0
  volume = 1
  ended = false
  seeking = false
  plays = 0
  paused = true
  isConnected = true
  readyState = 0
  style = { transform: "", objectPosition: "" }
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
    this.plays += 1
    this.paused = false
    return Promise.resolve()
  }
  pause(): void {
    this.paused = true
  }
  fire(name: string): void {
    for (const fn of this.listeners.get(name) ?? []) fn()
  }
}

const setup = (facesFor: (video: string) => VideoFaces | undefined = () => undefined): { player: ReturnType<typeof montage>; srcSets: () => number; failShown: () => void; videos: () => ReadonlyArray<FakeVideo>; tick: () => void } => {
  const videos: Array<FakeVideo> = []
  const createElement = (tag: string): FakeVideo => {
    const made = new FakeVideo()
    if (tag === "video") videos.push(made)
    return made
  }
  Object.assign(globalThis, { document: { createElement } })
  const frames: Array<() => void> = []
  Object.assign(globalThis, { requestAnimationFrame: (next: () => void) => frames.push(next) })
  const player = montage("project", () => {}, () => 0, facesFor)
  return {
    player,
    srcSets: () => videos.reduce((sum, video) => sum + video.srcSets, 0),
    failShown: () => { videos.at(-1)?.fire("error") },
    videos: () => videos,
    tick: () => { frames.shift()?.() }
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

test("every source is authorized in the initiating call while the unshown one stays paused", () => {
  const { player, videos } = setup()
  player.play([clip("a", 2), clip("b", 3)])
  expect(videos().map((video) => video.plays)).toEqual([1, 1])
  expect(videos().every((video) => video.paused)).toBe(true)
})

test("playing another project reuses the audio context instead of accumulating one per montage", () => {
  const first = setup()
  first.player.play([clip("a", 0)])
  const count = FakeAudioContext.instances.length
  const second = setup()
  second.player.play([clip("b", 0)])
  expect(FakeAudioContext.instances.length).toBe(count)
})

test("the graph output offsets compressor makeup and finite ratio instead of raising the full-scale ceiling", () => {
  const { player } = setup()
  player.play([clip("a", 0)])
  const context = FakeAudioContext.instances.at(-1)
  if (context === undefined) throw new Error("No audio context was created")
  const output = FakeGain.instances.find((gain) => gain.next === context.destination)
  if (output === undefined) throw new Error("No output compensation gain was connected")
  expect(20 * Math.log10(output.gain.value)).toBeCloseTo(-1.55, 10)
})

test("replaying a cached source resumes suspended and interrupted audio instead of playing silently", () => {
  const { player } = setup()
  player.play([clip("a", 0)])
  const context = FakeAudioContext.instances.at(-1)
  expect(context).toBeDefined()
  if (context === undefined) throw new Error("No audio context was created")
  for (const state of ["suspended", "interrupted"]) {
    player.stop()
    context.state = state
    const before = context.resumes
    player.play([clip("a", 0)])
    expect(context.resumes).toBe(before + 1)
  }
})

test("removing a playing montage pauses its videos instead of retaining active detached sources", () => {
  const { player, videos, tick } = setup()
  player.play([clip("a", 0)])
  const source = FakeAudioContext.sources.at(-1)
  const video = videos()[0]
  if (video === undefined || source === undefined) throw new Error("No routed video was created")
  expect(source.next).toBeDefined()
  video.readyState = 2
  tick()
  expect(video.paused).toBe(false)
  player.node.remove()
  tick()
  expect(video.paused).toBe(true)
  expect(source.next).toBeUndefined()
})

test("a preview that fails mid-montage unplugs its source instead of leaving it on the shared graph", () => {
  const { player, failShown } = setup()
  player.play([clip("a", 0)])
  const source = FakeAudioContext.sources.at(-1)
  if (source === undefined) throw new Error("No source was routed")
  expect(source.next).toBeDefined()
  failShown()
  expect(source.next).toBeUndefined()
})

const horizontalFaces = (x: number, aspect = 16 / 9): VideoFaces => ({
  video: "a", step: 0.2, gaze: ["camera"], heads: [{ x, y: 0.4, size: 0.2 }], aspect
})

test("show and play centre the off-axis face rather than the horizontal source", () => {
  const { player, videos } = setup(() => horizontalFaces(1.4))
  player.show(clip("a", 0))
  const video = videos()[0]
  if (video === undefined) throw new Error("No preview was created")
  video.readyState = 2
  video.fire("loadedmetadata")
  const percentage = Number.parseFloat(video.style.objectPosition)
  const left = (16 / 9 - 9 / 16) * percentage / 100
  expect(left).toBeCloseTo(1.11875, 9)
  expect((1.4 - left) / (9 / 16)).toBeCloseTo(0.5, 9)
  player.play([clip("a", 0)])
  expect(Number.parseFloat(video.style.objectPosition)).toBeCloseTo(percentage, 9)
})

test("zoom and unaligned previews share the face window instead of zooming the source centre", () => {
  const { player, videos } = setup(() => horizontalFaces(1.4))
  const frame = { scale: 1.1, left: 0.02, top: 0.03 }
  player.show({ ...clip("a", 0), frame })
  const video = videos()[0]
  if (video === undefined) throw new Error("No preview was created")
  video.readyState = 2
  video.fire("loadedmetadata")
  const position = video.style.objectPosition
  expect((16 / 9 - 9 / 16) * Number.parseFloat(position) / 100).toBeCloseTo(1.11875, 9)
  expect(video.style.transform).toBe(`scale(1.1) translate(${-0.02 / (9 / 16) * 100}%, -3%)`)
  player.show(clip("a", 0))
  expect(video.style.objectPosition).toBe(position)
  expect(video.style.transform).toBe("")
})

test("cached and preloaded videos update their crop instead of retaining an earlier measurement", () => {
  let faces = horizontalFaces(1.4)
  const { player, videos } = setup(() => faces)
  player.play([clip("a", 0), clip("b", 0)])
  for (const video of videos()) {
    video.readyState = 2
    video.fire("loadedmetadata")
    expect((16 / 9 - 9 / 16) * Number.parseFloat(video.style.objectPosition) / 100).toBeCloseTo(1.11875, 9)
  }
  player.stop()
  faces = horizontalFaces(0.1)
  player.show(clip("a", 0))
  expect(videos()[0]?.style.objectPosition).toBe("0% 50%")
  faces = horizontalFaces(1.77)
  player.show(clip("a", 0))
  expect(videos()[0]?.style.objectPosition).toBe("100% 50%")
  faces = { ...faces, heads: [] }
  player.show(clip("a", 0))
  expect(videos()[0]?.style.objectPosition).toBe("50% 50%")
  faces = horizontalFaces(0.3, 9 / 16)
  player.show(clip("a", 0))
  expect(videos()[0]?.style.objectPosition).toBe("50% 50%")
  faces = { video: "a", step: 0.2, gaze: ["camera"], heads: [{ x: 1.4, y: 0.4, size: 0.2 }] }
  player.show(clip("a", 0))
  expect(videos()[0]?.style.objectPosition).toBe("50% 50%")
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
