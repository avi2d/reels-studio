import type { Frame, Head } from "./timeline.ts"

export const VIEW_WIDTH = 9 / 16
const MAX_ZOOM = 1.15

// The reel scales a source to cover 9 by 16 and crops the middle, and the head comes in units of the source height.
export const inView = (head: Head, aspect: number): Head => {
  const grow = Math.max(1, VIEW_WIDTH / aspect)
  return {
    x: head.x * grow - (aspect * grow - VIEW_WIDTH) / 2,
    y: head.y * grow - (grow - 1) / 2,
    size: head.size * grow
  }
}

export const framedHead = (head: Head, frame: Frame | undefined): Head =>
  frame === undefined ? head : { x: (head.x - frame.left) * frame.scale, y: (head.y - frame.top) * frame.scale, size: head.size * frame.scale }

const atLeast = (wanted: number, have: number): number => wanted <= have ? 1 : have <= 0 ? Number.POSITIVE_INFINITY : wanted / have

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value))

// A frame only enlarges, since a smaller picture or a window past its edge would show black around it.
export const frameToward = (target: Head, moved: Head): Frame | undefined => {
  const scale = Math.max(
    atLeast(target.y, moved.y), atLeast(1 - target.y, 1 - moved.y),
    atLeast(target.x, moved.x), atLeast(VIEW_WIDTH - target.x, VIEW_WIDTH - moved.x)
  )
  if (scale > MAX_ZOOM) return undefined
  return {
    scale,
    left: clamp(moved.x - target.x / scale, 0, VIEW_WIDTH * (1 - 1 / scale)),
    top: clamp(moved.y - target.y / scale, 0, 1 - 1 / scale)
  }
}
