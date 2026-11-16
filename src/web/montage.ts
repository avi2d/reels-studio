import { Data, Effect } from "effect"
import type { Clip } from "../shared/timeline.ts"
import * as Api from "./api.ts"
import { h } from "./dom.ts"

export interface Playing {
  readonly clip: Clip
  readonly elapsed: number
}

export interface Montage {
  readonly node: HTMLVideoElement
  readonly play: (clips: ReadonlyArray<Clip>) => void
  readonly stop: () => void
}

class Refused extends Data.TaggedError("Refused")<{ readonly byBrowser: boolean }> {}

const SEEK_SLACK = 0.05

export const montage = (projectId: string, onChange: (playing: Playing | undefined) => void): Montage => {
  const node = h("video", { class: "player", playsinline: true, preload: "metadata", hidden: true })
  const state: { clips: ReadonlyArray<Clip>; index: number; before: number; loading: boolean; watching: boolean } =
    { clips: [], index: 0, before: 0, loading: false, watching: false }
  const stop = (): void => {
    state.clips = []
    node.pause()
    onChange(undefined)
  }
  const start = (): void => {
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
    if (node.dataset.video !== clip.video) {
      state.loading = true
      node.dataset.video = clip.video
      node.src = `${Api.previewUrl(projectId, clip.video)}#t=${clip.start}`
    } else if (Math.abs(node.currentTime - clip.start) > SEEK_SLACK) {
      node.currentTime = clip.start
    }
    start()
  }
  const watch = (): void => {
    const clip = state.clips[state.index]
    if (clip === undefined || !node.isConnected) {
      state.watching = false
      return
    }
    if (!state.loading && !node.seeking) {
      if (node.ended || node.currentTime >= clip.end) cue(state.index + 1)
      else onChange({ clip, elapsed: state.before + Math.max(0, node.currentTime - clip.start) })
    }
    requestAnimationFrame(watch)
  }
  node.addEventListener("loadedmetadata", () => {
    const clip = state.clips[state.index]
    if (clip !== undefined && Math.abs(node.currentTime - clip.start) > SEEK_SLACK) node.currentTime = clip.start
    state.loading = false
  })
  node.addEventListener("error", () => { if (state.clips.length > 0) stop() })
  const play = (clips: ReadonlyArray<Clip>): void => {
    state.clips = clips
    state.index = 0
    state.before = 0
    node.hidden = false
    cue(0)
    if (state.watching) return
    state.watching = true
    requestAnimationFrame(watch)
  }
  return { node, play, stop }
}
