import { shapeOf, visualKey, type InsertLook, type Visual } from "../shared/inserts.ts"
import type { InsertUrls } from "./api.ts"
import { h } from "./dom.ts"

export interface InsertView {
  readonly node: HTMLElement
  readonly paint: (look: InsertLook | undefined) => void
}


// The clip is moved only when it drifts this far from the reel, since a seek on every frame stalls it.
const CLIP_DRIFT = 0.25

export const insertView = (urls: Pick<InsertUrls, "visualUrl" | "clipUrl">): InsertView => {
  const image = h("img", { alt: "" })
  const clip = h("video", { muted: true, playsinline: true, preload: "auto", hidden: true })
  const node = h("div", { class: "insert-view", hidden: true, "aria-hidden": "true" }, h("div", { class: "insert-box" }, h("div", { class: "insert-card" }, image, clip)))
  const state: { key: string | undefined } = { key: undefined }
  const sized = (width: number, height: number): void => {
    if (width === 0 || height === 0) return
    node.dataset.shape = shapeOf(width, height)
    node.style.setProperty("--ar", String(width / height))
  }
  image.addEventListener("load", () => { sized(image.naturalWidth, image.naturalHeight) })
  clip.addEventListener("loadedmetadata", () => { sized(clip.videoWidth, clip.videoHeight) })
  const show = (visual: Visual): void => {
    state.key = visualKey(visual)
    delete node.dataset.shape
    image.hidden = visual.kind === "clip"
    clip.hidden = visual.kind !== "clip"
    if (visual.kind === "clip") {
      image.removeAttribute("src")
      clip.src = urls.clipUrl(visual.file)
      return
    }
    clip.pause()
    clip.removeAttribute("src")
    image.src = urls.visualUrl(visual)
  }
  const follow = (visual: Visual & { readonly kind: "clip" }, since: number): void => {
    clip.muted = !visual.sound
    const end = Number.isFinite(clip.duration) ? clip.duration : Number.POSITIVE_INFINITY
    const at = Math.min(visual.start + since, end)
    if (Math.abs(clip.currentTime - at) > CLIP_DRIFT) clip.currentTime = at
    if (clip.paused && !clip.ended && at < end) clip.play().catch(() => undefined)
  }
  const paint = (look: InsertLook | undefined): void => {
    node.hidden = look === undefined
    if (look === undefined) {
      clip.pause()
      return
    }
    if (visualKey(look.visual) !== state.key) show(look.visual)
    node.style.opacity = look.opacity.toFixed(3)
    if (look.visual.kind === "clip") follow(look.visual, look.since)
    else image.style.transform = `scale(${look.scale.toFixed(4)})`
  }
  return { node, paint }
}
