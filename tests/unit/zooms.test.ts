import { expect, test } from "bun:test"
import type { Transcript } from "../../src/shared/plan.ts"
import { NO_EDITS, type Clip, type Head, type VideoFaces } from "../../src/shared/timeline.ts"
import type { PlannedZoom } from "../../src/shared/zoom-plan.ts"
import { apartZooms, pushShare, withZoom, ZOOM_SCALES, zoomAt, zoomedOf } from "../../src/shared/zooms.ts"

const words = (count: number): Transcript => ({ duration: count, words: Array.from({ length: count }, (_, index) => ({ start: index, end: index + 0.8, text: `w${index}` })) })
const transcripts = new Map([["a", words(20)]])
const zoom = (id: string, from: number, to: number): PlannedZoom => ({ id, video: "a", from, to })
const clip = (block: string, start: number, end: number): Clip => ({ video: "a", block, start, end })
const centred: Head = { x: 0.5, y: 0.4, size: 0.25 }
const vertical = (height: number): VideoFaces => ({ video: "a", step: 0.5, gaze: [], heads: Array.from({ length: 40 }, () => centred), aspect: 9 / 16, height })
const faces = new Map([["a", vertical(1920)]])
const reel = [clip("one", 0, 5), clip("two", 5, 12)]

test("the push rises along the smoothstep, so it is at half way half through the rise and not a straight line from a sudden start", () => {
  const push = { start: 2, peak: 4, end: 5, scale: 1.15, x: 0.28, y: 0.4 }
  expect(pushShare(push, 1.9)).toBe(0)
  expect(pushShare(push, 2.5)).toBeCloseTo(0.15625)
  expect(pushShare(push, 3)).toBeCloseTo(0.5)
  expect(pushShare(push, 4)).toBe(1)
  expect(pushShare(push, 5)).toBe(0)
})

test("the reel is zoomed during the key words and not elsewhere, rather than over the whole clip that holds them", () => {
  const { clips } = zoomedOf(reel, [zoom("sum", 7, 8)], faces, transcripts, NO_EDITS, "full")
  expect(clips[0]?.pushes).toBeUndefined()
  const pushes = clips[1]?.pushes ?? []
  expect(zoomAt(pushes, 6.5)).toBeUndefined()
  expect(zoomAt(pushes, 8.8)?.scale).toBeCloseTo(ZOOM_SCALES.full)
  expect(zoomAt(pushes, 10)).toBeUndefined()
})

test("a zoom the person set to none on the page is left out even when the rule says strong", () => {
  const edits = withZoom(NO_EDITS, "sum", "off")
  const { clips, places } = zoomedOf(reel, [zoom("sum", 7, 8)], faces, transcripts, edits, "full")
  expect(clips[1]?.pushes).toBeUndefined()
  expect(places.map((place) => [place.level, place.given, place.state])).toEqual([["off", true, "off"]])
})

test("a soft rule makes every zoom the person has not set soft, and leaves the one the person set strong", () => {
  const edits = withZoom(NO_EDITS, "two", "full")
  const { places } = zoomedOf(reel, [zoom("one", 1, 1), zoom("two", 8, 8)], faces, transcripts, edits, "soft")
  expect(places.map((place) => place.level)).toEqual(["soft", "full"])
})

test("on a 1080 source a clip already enlarged by 1.15 at a join gets no further push, rather than one past the source's pixels", () => {
  const framed = [clip("one", 0, 5), { ...clip("two", 5, 12), frame: { scale: 1.15, left: 0, top: 0 } }]
  const { clips, places } = zoomedOf(framed, [zoom("sum", 7, 8)], new Map([["a", vertical(1920)]]), transcripts, NO_EDITS, "full")
  expect(clips[1]?.pushes).toBeUndefined()
  expect(places[0]?.state).toBe("limited")
  const tall = zoomedOf(framed, [zoom("sum", 7, 8)], new Map([["a", vertical(3840)]]), transcripts, NO_EDITS, "full")
  expect(tall.clips[1]?.pushes?.[0]?.scale).toBeCloseTo(ZOOM_SCALES.full)
})

test("the push centres on the head, so the eyes stay where they are rather than drifting to the middle of the frame", () => {
  const { clips } = zoomedOf(reel, [zoom("sum", 7, 8)], faces, transcripts, NO_EDITS, "full")
  const push = clips[1]?.pushes?.[0]
  expect(push?.x).toBeCloseTo(0.5)
  expect(push?.y).toBeCloseTo(0.4)
})

test("a second zoom on words the first already holds is dropped instead of making two pushes at once", () => {
  expect(apartZooms([zoom("a", 3, 5), zoom("b", 5, 6), zoom("c", 7, 7)]).map((one) => one.id)).toEqual(["a", "c"])
})

test("a zoom that starts before the last one has eased out cuts the last one short, so two pushes never add up", () => {
  const { clips } = zoomedOf(reel, [zoom("one", 6, 6), zoom("two", 7, 7)], faces, transcripts, NO_EDITS, "full")
  const [first, second] = clips[1]?.pushes ?? []
  expect(first?.end).toBeLessThanOrEqual(second?.start ?? 0)
})
