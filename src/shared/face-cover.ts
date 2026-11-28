import { Schema } from "effect"
import type { Gaze, Head } from "./timeline.ts"
import { FRAME, overlaps, textAreaOf, type Rect } from "./zones.ts"

// The gaze head is the middle of the eyes, and its size runs from the brow to the chin, with the eyes a quarter of the way down,
// the forehead about a fifth of the size above the brow, and the face about four fifths as wide as that size.
const ABOVE_EYES = 0.45
const BELOW_EYES = 0.75
const HALF_WIDTH = 0.4

const faceBox = (head: Head): Rect => {
  const unit = FRAME.height
  return {
    left: (head.x - HALF_WIDTH * head.size) * unit,
    right: (head.x + HALF_WIDTH * head.size) * unit,
    top: (head.y - ABOVE_EYES * head.size) * unit,
    bottom: (head.y + BELOW_EYES * head.size) * unit
  }
}

export const Covered = Schema.Struct({ from: Schema.Finite, to: Schema.Finite })
export type Covered = typeof Covered.Type

// The heads must come from the built 1080 by 1920 file, whose height is the unit of every head.
export const coveredSpans = (gaze: Gaze, seconds: number): ReadonlyArray<Covered> => {
  const buttons = textAreaOf("Instagram").buttons
  if (buttons === undefined) return []
  const spans: Array<Covered> = []
  let start: number | undefined
  const heads = gaze.heads ?? []
  heads.forEach((head, index) => {
    const covered = head !== null && overlaps(faceBox(head), buttons)
    if (covered && start === undefined) start = index * gaze.step
    if (!covered && start !== undefined) {
      spans.push({ from: start, to: index * gaze.step })
      start = undefined
    }
  })
  if (start !== undefined) spans.push({ from: start, to: Math.max(start, Math.min(seconds, heads.length * gaze.step)) })
  return spans
}

const SHEET_FRAMES = 6
const MOST_FRAMES = 9
const APART = 0.5

// Evenly spaced frames, and one in the middle of each stretch the buttons cover, so every warning has a frame to look at.
export const sheetTimes = (seconds: number, covered: ReadonlyArray<Covered>): ReadonlyArray<number> => {
  const even = Array.from({ length: SHEET_FRAMES }, (_, index) => (index + 0.5) * seconds / SHEET_FRAMES)
  const middles = covered.map((span) => (span.from + span.to) / 2)
  const kept = middles.slice(0, MOST_FRAMES)
  for (const time of even) {
    if (kept.length >= MOST_FRAMES) break
    if (kept.every((other) => Math.abs(other - time) >= APART)) kept.push(time)
  }
  return kept.map((time) => Number(time.toFixed(2))).toSorted((left, right) => left - right)
}

export const isCovered = (covered: ReadonlyArray<Covered>, time: number): boolean =>
  covered.some((span) => time >= span.from && time <= span.to)
