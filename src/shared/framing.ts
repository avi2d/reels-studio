import type { Frame, Head } from "./timeline.ts"

export const VIEW_WIDTH = 9 / 16
export const REEL_WIDTH = 1080
const LEAST_ZOOM_LIMIT = 1.15

// The least limit holds for every source, so a source with fewer pixels than the reel still gets the zoom the owner approved.
export const zoomLimit = (aspect: number | undefined, height: number | undefined): number =>
  aspect === undefined || height === undefined ? LEAST_ZOOM_LIMIT : Math.max(LEAST_ZOOM_LIMIT, Math.min(aspect, VIEW_WIDTH) * height / REEL_WIDTH)

const centredLeft = (aspect: number): number => Math.max(0, aspect - VIEW_WIDTH) / 2

// Head and left are both in units of the source height.
export const inView = (head: Head, aspect: number, left: number | undefined): Head => {
  const grow = Math.max(1, VIEW_WIDTH / aspect)
  return {
    x: head.x * grow - (left ?? centredLeft(aspect)),
    y: head.y * grow - (grow - 1) / 2,
    size: head.size * grow
  }
}

// The median, not the mean, so one detection far from the face does not move the window.
const median = (values: ReadonlyArray<number>): number => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = (sorted.length - 1) / 2
  return ((sorted[Math.floor(middle)] ?? 0) + (sorted[Math.ceil(middle)] ?? 0)) / 2
}

// Undefined when no face was found or the source is no wider than the window, so the caller keeps the middle.
export const faceLeft = (heads: ReadonlyArray<Head | null> | undefined, aspect: number): number | undefined => {
  const found = (heads ?? []).flatMap((head) => head === null ? [] : [head.x])
  const room = aspect - VIEW_WIDTH
  if (found.length === 0 || room <= 0) return undefined
  return clamp(median(found) - VIEW_WIDTH / 2, 0, room)
}

export const framedHead = (head: Head, frame: Frame | undefined): Head =>
  frame === undefined ? head : { x: (head.x - frame.left) * frame.scale, y: (head.y - frame.top) * frame.scale, size: head.size * frame.scale }

const atLeast = (wanted: number, have: number): number => wanted <= have ? 1 : have <= 0 ? Number.POSITIVE_INFINITY : wanted / have

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

// A frame only enlarges, since a smaller picture or a window past its edge would show black around it.
export const frameToward = (target: Head, moved: Head, limit: number): Frame | undefined => {
  const scale = Math.max(
    atLeast(target.y, moved.y), atLeast(1 - target.y, 1 - moved.y),
    atLeast(target.x, moved.x), atLeast(VIEW_WIDTH - target.x, VIEW_WIDTH - moved.x)
  )
  if (scale > limit) return undefined
  return {
    scale,
    left: clamp(moved.x - target.x / scale, 0, VIEW_WIDTH * (1 - 1 / scale)),
    top: clamp(moved.y - target.y / scale, 0, 1 - 1 / scale)
  }
}
