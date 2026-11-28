import { framedHead, VIEW_WIDTH, zoomLimit } from "./framing.ts"
import { seenAt } from "./joins.ts"
import type { Transcript } from "./plan.ts"
import type { Clip, Edits, Push, VideoFaces } from "./timeline.ts"
import type { PlannedZoom, ZoomLevel } from "./zoom-plan.ts"

export const ZOOM_SCALES = { off: 1, soft: 1.07, full: 1.15 } satisfies Record<ZoomLevel, number>

// The push grows over the key words, at least this long, so a short word still gets a slow zoom.
const LEAST_PUSH_SECONDS = 0.6
const ZOOM_OUT_SECONDS = 0.3

const SEEN_SCALE = 1.005

type ZoomState = "zoomed" | "off" | "limited"

export interface ZoomPlace {
  readonly planned: PlannedZoom
  readonly level: ZoomLevel
  readonly given: boolean
  readonly block: string
  readonly at: number
  readonly state: ZoomState
}

const smooth = (share: number): number => {
  const clamped = Math.min(1, Math.max(0, share))
  return clamped * clamped * (3 - 2 * clamped)
}

// The share of the push shown at a moment of the source: none before and after it, all of it at its peak.
export const pushShare = (push: Push, time: number): number => {
  if (time <= push.start || time >= push.end) return 0
  return time < push.peak ? smooth((time - push.start) / (push.peak - push.start)) : 1 - smooth((time - push.peak) / (push.end - push.peak))
}

export interface Zoom {
  readonly scale: number
  readonly x: number
  readonly y: number
}

export const zoomAt = (pushes: ReadonlyArray<Push>, time: number): Zoom | undefined => {
  for (const push of pushes) {
    const share = pushShare(push, time)
    if (share > 0) return { scale: 1 + (push.scale - 1) * share, x: push.x, y: push.y }
  }
  return undefined
}

const spanOf = (zoom: PlannedZoom, transcripts: ReadonlyMap<string, Transcript>): { readonly start: number; readonly end: number } | undefined => {
  const words = transcripts.get(zoom.video)?.words ?? []
  const first = words[zoom.from]
  const last = words[zoom.to]
  return first === undefined || last === undefined ? undefined : { start: first.start, end: last.end }
}

// Zooms whose words overlap an earlier zoom of the same video are left out, so two pushes never share a moment.
export const apartZooms = (zooms: ReadonlyArray<PlannedZoom>): ReadonlyArray<PlannedZoom> => {
  const kept: Array<PlannedZoom> = []
  for (const zoom of zooms) {
    if (kept.some((other) => other.video === zoom.video && zoom.from <= other.to && zoom.to >= other.from)) continue
    kept.push(zoom)
  }
  return kept
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

const overlaps = (clip: Clip, video: string, start: number, end: number): boolean => clip.video === video && clip.start < end && clip.end > start

// The eyes are the centre, so they stay where they are while the picture grows around them.
const centreOf = (faces: VideoFaces | undefined, clip: Clip, time: number): { readonly x: number; readonly y: number } => {
  const seen = seenAt(faces, time, "after")
  if (seen === undefined || !seen.measured) return { x: VIEW_WIDTH / 2, y: 0.5 }
  const head = framedHead(seen.head, clip.frame)
  return { x: clamp(head.x, 0, VIEW_WIDTH), y: clamp(head.y, 0, 1) }
}

interface Pushed {
  readonly push: Push
  readonly video: string
}

export const zoomedOf = (
  clips: ReadonlyArray<Clip>,
  planned: ReadonlyArray<PlannedZoom>,
  faces: ReadonlyMap<string, VideoFaces>,
  transcripts: ReadonlyMap<string, Transcript>,
  edits: Edits,
  rule: ZoomLevel
): { readonly clips: ReadonlyArray<Clip>; readonly places: ReadonlyArray<ZoomPlace> } => {
  const places: Array<ZoomPlace> = []
  const pushed: Array<Pushed> = []
  for (const zoom of apartZooms(planned)) {
    const span = spanOf(zoom, transcripts)
    if (span === undefined) continue
    const index = clips.findIndex((clip) => overlaps(clip, zoom.video, span.start, span.end))
    const clip = clips[index]
    if (clip === undefined) continue
    const given = edits.zooms.find((answer) => answer.id === zoom.id)?.level
    const level = given ?? rule
    const at = clips.slice(0, index).reduce((total, one) => total + one.end - one.start, 0) + Math.max(0, span.start - clip.start)
    const place = { planned: zoom, level, given: given !== undefined, block: clip.block, at }
    const video = faces.get(zoom.video)
    const scale = Math.min(ZOOM_SCALES[level], zoomLimit(video?.aspect, video?.height) / (clip.frame?.scale ?? 1))
    if (level === "off" || scale < SEEN_SCALE) {
      places.push({ ...place, state: level === "off" ? "off" : "limited" })
      continue
    }
    const peak = Math.max(span.end, span.start + LEAST_PUSH_SECONDS)
    pushed.push({ video: zoom.video, push: { start: span.start, peak, end: peak + ZOOM_OUT_SECONDS, scale, ...centreOf(video, clip, span.start) } })
    places.push({ ...place, state: "zoomed" })
  }
  const apart = pushed.map((one): Pushed => {
    const next = pushed.filter((other) => other.video === one.video && other.push.start > one.push.start).reduce((soonest, other) => Math.min(soonest, other.push.start), Number.POSITIVE_INFINITY)
    return { ...one, push: { ...one.push, peak: Math.min(one.push.peak, next), end: Math.min(one.push.end, next) } }
  })
  const zoomed = clips.map((clip): Clip => {
    const pushes = apart.filter((one) => overlaps(clip, one.video, one.push.start, one.push.end)).map((one) => one.push)
    return pushes.length === 0 ? clip : { ...clip, pushes }
  })
  return { clips: zoomed, places }
}

export const withZoom = (edits: Edits, id: string, level: ZoomLevel): Edits => ({
  ...edits,
  zooms: [...edits.zooms.filter((answer) => answer.id !== id), { id, level }]
})
