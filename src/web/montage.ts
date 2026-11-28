import { Data, Effect } from "effect"
import { faceLeft, VIEW_WIDTH } from "../shared/framing.ts"
import { fadeGain, type Clip, type Frame, type VideoFaces } from "../shared/timeline.ts"
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
  readonly source: (urlOf: UrlOf) => void
}

export type UrlOf = (video: string) => string

class Refused extends Data.TaggedError("Refused")<{ readonly byBrowser: boolean }> {}

export type LevelAt = (video: string, time: number) => number

const LIMIT_DB = -2.5
const LIMIT_RATIO = 20
const GAIN_SMOOTHING = 0.02
const COMPRESSED_FULL_SCALE_DB = LIMIT_DB * (1 - 1 / LIMIT_RATIO)
const MAKEUP_DB = -COMPRESSED_FULL_SCALE_DB * 0.6
const OUTPUT_GAIN_DB = LIMIT_DB - COMPRESSED_FULL_SCALE_DB - MAKEUP_DB

interface AudioGraph {
  readonly context: AudioContext
  readonly limiter: DynamicsCompressorNode
}

let audioGraph: AudioGraph | undefined

const graphOf = (): AudioGraph | undefined => {
  if (audioGraph !== undefined) return audioGraph
  if (typeof AudioContext === "undefined") return undefined
  const context = new AudioContext()
  const limiter = new DynamicsCompressorNode(context, { threshold: LIMIT_DB, knee: 0, ratio: LIMIT_RATIO, attack: 0.003, release: 0.05 })
  const output = new GainNode(context, { gain: 10 ** (OUTPUT_GAIN_DB / 20) })
  limiter.connect(output).connect(context.destination)
  audioGraph = { context, limiter }
  return audioGraph
}

interface Levelling {
  readonly follow: (node: HTMLVideoElement) => void
  readonly rest: (node: HTMLVideoElement) => void
}

interface Route {
  readonly source: MediaElementAudioSourceNode
  readonly gain: GainNode
  connected: boolean
}

// An element's own volume stops at 1, and a quiet part needs tens of dB more, so the gain runs through Web Audio.
const levellingOf = (levelAt: LevelAt): Levelling => {
  const routes = new WeakMap<HTMLVideoElement, Route>()
  // An element gets one source node for life, so a stopped element is unplugged rather than given a new one.
  const routeOf = (node: HTMLVideoElement, graph: AudioGraph): Route => {
    const known = routes.get(node)
    if (known !== undefined) return known
    const route: Route = { source: graph.context.createMediaElementSource(node), gain: new GainNode(graph.context), connected: false }
    route.gain.connect(graph.limiter)
    routes.set(node, route)
    return route
  }
  return {
    follow: (node) => {
      const video = node.dataset.video
      const graph = graphOf()
      if (video === undefined || graph === undefined) return
      if (graph.context.state !== "running") void graph.context.resume()
      const route = routeOf(node, graph)
      if (!route.connected) route.source.connect(route.gain)
      route.connected = true
      route.gain.gain.setTargetAtTime(10 ** (levelAt(video, node.currentTime) / 20), graph.context.currentTime, GAIN_SMOOTHING)
    },
    // A source node still connected to the shared, always running graph keeps its element alive after its view is gone.
    rest: (node) => {
      const route = routes.get(node)
      if (route === undefined || !route.connected) return
      route.source.disconnect()
      route.connected = false
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

const LOADED = ["seeked", "loadeddata", "canplay"] as const

const hasFrame = (node: HTMLVideoElement): boolean => node.readyState >= HAVE_CURRENT_DATA && !node.seeking

const transformOf = (frame: Frame | undefined): string =>
  frame === undefined ? "" : `scale(${frame.scale}) translate(${-frame.left / VIEW_WIDTH * 100}%, ${-frame.top * 100}%)`

interface Screen {
  readonly node: HTMLElement
  readonly nodes: Map<string, HTMLVideoElement>
  readonly seek: (node: HTMLVideoElement, at: number, frame: Frame | undefined) => void
  readonly reveal: (node: HTMLVideoElement) => void
  readonly nodeOf: (video: string) => HTMLVideoElement
  readonly source: (urlOf: UrlOf, onLoaded: (node: HTMLVideoElement) => void) => void
  shown: HTMLVideoElement | undefined
}

interface ScreenEvents {
  readonly ready: (node: HTMLVideoElement) => void
  readonly failed: (node: HTMLVideoElement) => void
}

// One element per source video: swapping the src of a single element blanks it to black until the new file loads.
const screenOf = (projectId: string, events: ScreenEvents, facesFor: (video: string) => VideoFaces | undefined): Screen => {
  const node = h("div", { class: "screen" })
  const nodes = new Map<string, HTMLVideoElement>()
  const files: { urlOf: UrlOf } = { urlOf: (video) => Api.previewUrl(projectId, video) }
  const wanted = new WeakMap<HTMLVideoElement, number>()
  const framing = new WeakMap<HTMLVideoElement, Frame | undefined>()
  const applyFrame = (video: HTMLVideoElement): void => {
    const faces = facesFor(video.dataset.video ?? "")
    const left = faces?.aspect === undefined ? undefined : faceLeft(faces.heads, faces.aspect)
    const across = left === undefined || faces?.aspect === undefined ? 50 : left / (faces.aspect - VIEW_WIDTH) * 100
    video.style.objectPosition = `${across}% 50%`
    video.style.transform = transformOf(framing.get(video))
  }
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
    // A new file loads from its start, so each element is sent back to where it stood once the file has loaded.
    source: (urlOf, onLoaded) => {
      files.urlOf = urlOf
      for (const [name, video] of nodes) {
        const url = urlOf(name)
        if (video.getAttribute("src") === url) continue
        if (video.readyState >= HAVE_METADATA) wanted.set(video, video.currentTime)
        const loaded = (): void => {
          if (!hasFrame(video)) return
          for (const event of LOADED) video.removeEventListener(event, loaded)
          onLoaded(video)
        }
        for (const event of LOADED) video.addEventListener(event, loaded)
        video.src = url
      }
    },
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
        events.failed(video)
      })
      video.src = files.urlOf(name)
      nodes.set(name, video)
      node.append(video)
      return video
    }
  }
  return screen
}

const sourceFor = (screen: Screen, isWatching: () => boolean, start: (node: HTMLVideoElement) => void) => (urlOf: UrlOf): void => {
  const playing = isWatching() ? screen.shown : undefined
  screen.source(urlOf, (node) => { if (node === playing && isWatching() && screen.shown === node) start(node) })
}

export const montage = (projectId: string, onChange: (playing: Playing | undefined) => void, levelAt: LevelAt, facesFor: (video: string) => VideoFaces | undefined): Montage => {
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
      levelling.rest(node)
    }
    onChange(undefined)
  }
  const screen = screenOf(projectId, {
    ready: (node) => { if (state.awaited === node && state.clips.length === 0) reveal(node) },
    failed: (node) => {
      levelling.rest(node)
      if (state.clips.some((clip) => clip.video === node.dataset.video)) stop()
    }
  }, facesFor)
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
    if (!screen.node.isConnected) stop()
    const clip = state.clips[state.index]
    if (clip === undefined) {
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
  return { node: screen.node, play, show, stop, source: sourceFor(screen, () => state.clips.length > 0, start) }
}
