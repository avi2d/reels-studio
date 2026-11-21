import { Data, Effect } from "effect"
import { fadeGain, type Clip } from "../shared/timeline.ts"
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

const SEEK_SLACK = 0.05
const HAVE_METADATA = 1
const HAVE_CURRENT_DATA = 2

const hasFrame = (node: HTMLVideoElement): boolean => node.readyState >= HAVE_CURRENT_DATA && !node.seeking

interface Screen {
  readonly node: HTMLElement
  readonly nodes: Map<string, HTMLVideoElement>
  readonly seek: (node: HTMLVideoElement, at: number) => void
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
  const seek = (video: HTMLVideoElement, at: number): void => {
    wanted.set(video, at)
    if (video.readyState >= HAVE_METADATA && Math.abs(video.currentTime - at) > SEEK_SLACK) video.currentTime = at
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
        if (at !== undefined) seek(video, at)
      })
      video.addEventListener("seeked", () => { events.ready(video) })
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

export const montage = (projectId: string, onChange: (playing: Playing | undefined) => void): Montage => {
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
  const start = (node: HTMLVideoElement): void => {
    Effect.runFork(Effect.tryPromise({
      try: () => node.play(),
      catch: (cause) => new Refused({ byBrowser: cause instanceof DOMException && cause.name === "NotAllowedError" })
    }).pipe(Effect.catchTag("Refused", (refused) => Effect.sync(() => { if (refused.byBrowser) stop() }))))
  }
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
    seek(node, clip.start)
    if (node === screen.shown) start(node)
    else {
      screen.shown?.pause()
      state.awaited = node
    }
    const next = state.clips[index + 1]
    if (next !== undefined && next.video !== clip.video) {
      const upcoming = nodeOf(next.video)
      if (upcoming !== screen.shown) seek(upcoming, next.start)
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
    seek(node, clip.start)
    if (screen.shown === undefined || node === screen.shown || hasFrame(node)) reveal(node)
    else state.awaited = node
  }
  return { node: screen.node, play, show, stop }
}
