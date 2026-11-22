import { Data, Effect } from "effect"
import { VIEW_WIDTH } from "../shared/framing.ts"
import { fadeGain, type Clip, type Frame } from "../shared/timeline.ts"
import * as Api from "./api.ts"
import { h } from "./dom.ts"

export interface Playing {
  readonly clip: Clip
  readonly elapsed: number
}

export interface Montage {
  readonly node: HTMLElement
  readonly play: (clips: ReadonlyArray<Clip>) => void
  readonly show: (clip: Clip) => void
  readonly stop: () => void
}

class Refused extends Data.TaggedError("Refused")<{ readonly byBrowser: boolean }> {}

export type LevelAt = (video: string, time: number) => number

// The limiter of the build holds samples under 0.75, that is −2.5 dBFS.
const LIMIT_DB = -2.5
const GAIN_SMOOTHING = 0.02

interface Levelling {
  readonly follow: (node: HTMLVideoElement) => void
}

// An element's own volume stops at 1, and a quiet part needs tens of dB more, so the gain runs through Web Audio.
const levellingOf = (levelAt: LevelAt): Levelling => {
  const graph: { context: AudioContext | undefined; limiter: DynamicsCompressorNode | undefined } = { context: undefined, limiter: undefined }
  const gains = new WeakMap<HTMLVideoElement, GainNode>()
  const gainOf = (node: HTMLVideoElement): GainNode | undefined => {
    const known = gains.get(node)
    if (known !== undefined) return known
    if (typeof AudioContext === "undefined") return undefined
    const context = graph.context ?? new AudioContext()
    graph.context = context
    if (context.state === "suspended") void context.resume()
    const limiter = graph.limiter ?? new DynamicsCompressorNode(context, { threshold: LIMIT_DB, knee: 0, ratio: 20, attack: 0.003, release: 0.05 })
    if (graph.limiter === undefined) limiter.connect(context.destination)
    graph.limiter = limiter
    const gain = new GainNode(context)
    context.createMediaElementSource(node).connect(gain).connect(limiter)
    gains.set(node, gain)
    return gain
  }
  return {
    follow: (node) => {
      const video = node.dataset.video
      const gain = gainOf(node)
      if (video === undefined || gain === undefined || graph.context === undefined) return
      gain.gain.setTargetAtTime(10 ** (levelAt(video, node.currentTime) / 20), graph.context.currentTime, GAIN_SMOOTHING)
    }
  }
}

const startOn = (node: HTMLVideoElement, levelling: Levelling, stop: () => void): void => {
  levelling.follow(node)
  Effect.runFork(Effect.tryPromise({
    try: () => node.play(),
    catch: (cause) => new Refused({ byBrowser: cause instanceof DOMException && cause.name === "NotAllowedError" })
  }).pipe(Effect.catchTag("Refused", (refused) => Effect.sync(() => { if (refused.byBrowser) stop() }))))
}


const SEEK_SLACK = 0.05
const HAVE_METADATA = 1
const HAVE_CURRENT_DATA = 2

const hasFrame = (node: HTMLVideoElement): boolean => node.readyState >= HAVE_CURRENT_DATA && !node.seeking

const transformOf = (frame: Frame | undefined): string =>
  frame === undefined ? "" : `scale(${frame.scale}) translate(${-frame.left / VIEW_WIDTH * 100}%, ${-frame.top * 100}%)`

interface Screen {
  readonly node: HTMLElement
  readonly nodes: Map<string, HTMLVideoElement>
  readonly seek: (node: HTMLVideoElement, at: number, frame: Frame | undefined) => void
  readonly reveal: (node: HTMLVideoElement) => void
  readonly nodeOf: (video: string) => HTMLVideoElement
  shown: HTMLVideoElement | undefined
}

interface ScreenEvents {
  readonly ready: (node: HTMLVideoElement) => void
  readonly failed: (video: string) => void
}

// One element per source video: swapping the src of a single element blanks it to black until the new file loads.
const screenOf = (projectId: string, events: ScreenEvents): Screen => {
  const node = h("div", { class: "screen" })
  const nodes = new Map<string, HTMLVideoElement>()
  const wanted = new WeakMap<HTMLVideoElement, number>()
  const framing = new WeakMap<HTMLVideoElement, Frame | undefined>()
  const applyFrame = (video: HTMLVideoElement): void => { video.style.transform = transformOf(framing.get(video)) }
  // The new frame waits for the seek, or the last picture of the old place shows enlarged for a moment.
  const seek = (video: HTMLVideoElement, at: number, frame: Frame | undefined): void => {
    wanted.set(video, at)
    framing.set(video, frame)
    if (video.readyState < HAVE_METADATA) return
    if (Math.abs(video.currentTime - at) > SEEK_SLACK) video.currentTime = at
    else applyFrame(video)
  }
  const screen: Screen = {
    node,
    nodes,
    seek,
    shown: undefined,
    reveal: (shown) => {
      for (const other of nodes.values()) other.classList.toggle("shown", other === shown)
      screen.shown = shown
    },
    nodeOf: (name) => {
      const known = nodes.get(name)
      if (known !== undefined) return known
      const video = h("video", { class: "player", playsinline: true, preload: "auto" })
      video.dataset.video = name
      video.addEventListener("loadedmetadata", () => {
        const at = wanted.get(video)
        if (at !== undefined) seek(video, at, framing.get(video))
      })
      video.addEventListener("seeked", () => {
        applyFrame(video)
        events.ready(video)
      })
      video.addEventListener("loadeddata", () => { events.ready(video) })
      video.addEventListener("error", () => {
        nodes.delete(name)
        video.remove()
        if (screen.shown === video) screen.shown = undefined
        events.failed(name)
      })
      video.src = Api.previewUrl(projectId, name)
      nodes.set(name, video)
      node.append(video)
      return video
    }
  }
  return screen
}

export const montage = (projectId: string, onChange: (playing: Playing | undefined) => void, levelAt: LevelAt): Montage => {
  const levelling = levellingOf(levelAt)
  const state: { clips: ReadonlyArray<Clip>; index: number; before: number; awaited: HTMLVideoElement | undefined; watching: boolean } =
    { clips: [], index: 0, before: 0, awaited: undefined, watching: false }
  const reveal = (node: HTMLVideoElement): void => {
    screen.reveal(node)
    state.awaited = undefined
  }
  const stop = (): void => {
    state.clips = []
    state.awaited = undefined
    for (const node of screen.nodes.values()) {
      node.pause()
      node.volume = 1
    }
    onChange(undefined)
  }
  const screen = screenOf(projectId, {
    ready: (node) => { if (state.awaited === node && state.clips.length === 0) reveal(node) },
    failed: (video) => { if (state.clips.some((clip) => clip.video === video)) stop() }
  })
  const { nodeOf, seek } = screen
  const start = (node: HTMLVideoElement): void => { startOn(node, levelling, stop) }
  const cue = (index: number): void => {
    const clip = state.clips[index]
    const last = state.clips[state.index]
    if (clip === undefined) {
      stop()
      return
    }
    if (index > state.index && last !== undefined) state.before += last.end - last.start
    state.index = index
    const node = nodeOf(clip.video)
    seek(node, clip.start, clip.frame)
    if (node === screen.shown) start(node)
    else {
      screen.shown?.pause()
      state.awaited = node
    }
    const next = state.clips[index + 1]
    if (next !== undefined && next.video !== clip.video) {
      const upcoming = nodeOf(next.video)
      if (upcoming !== screen.shown) seek(upcoming, next.start, next.frame)
    }
  }
  const watch = (): void => {
    const clip = state.clips[state.index]
    if (clip === undefined || !screen.node.isConnected) {
      state.watching = false
      return
    }
    const node = nodeOf(clip.video)
    if (state.awaited === node) {
      if (hasFrame(node)) {
        reveal(node)
        start(node)
      }
    } else if (!node.seeking && node.readyState >= HAVE_METADATA) {
      if (node.ended || node.currentTime >= clip.end) cue(state.index + 1)
      else {
        node.volume = fadeGain(clip, node.currentTime)
        levelling.follow(node)
        onChange({ clip, elapsed: state.before + Math.max(0, node.currentTime - clip.start) })
      }
    }
    requestAnimationFrame(watch)
  }
  const play = (clips: ReadonlyArray<Clip>): void => {
    if (clips.length === 0) return
    for (const node of screen.nodes.values()) node.pause()
    state.clips = clips
    state.index = 0
    state.before = 0
    const seen = new Set<string>()
    for (const clip of clips) {
      if (seen.has(clip.video)) continue
      seen.add(clip.video)
      const node = nodeOf(clip.video)
      start(node)
      node.pause()
    }
    cue(0)
    if (state.watching) return
    state.watching = true
    requestAnimationFrame(watch)
  }
  const show = (clip: Clip): void => {
    if (state.clips.length > 0) return
    const node = nodeOf(clip.video)
    seek(node, clip.start, clip.frame)
    if (screen.shown === undefined || node === screen.shown || hasFrame(node)) reveal(node)
    else state.awaited = node
  }
  return { node: screen.node, play, show, stop }
}
