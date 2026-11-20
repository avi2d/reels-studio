import { expect, test } from "bun:test"
import { Schema } from "effect"
import { aroundJoin, headAt, headShift, joinsOf, JUMP_STEP, openPlaces, placesOf, withAnswer } from "../../src/shared/joins.ts"
import { Edits, NO_EDITS, type Clip, type Head, type VideoHeads } from "../../src/shared/timeline.ts"

const clip = (video: string, block: string, start: number, end: number): Clip => ({ video, block, start, end })
const head = (x: number, y: number, size: number): Head => ({ x, y, size })

const clips = [clip("a", "one", 1, 2.1), clip("a", "one", 2.9, 6), clip("a", "two", 6, 7), clip("b", "three", 0.4, 1.5)]

test("two clips of one video that meet at the same moment make no join, while a removed pause and a change of video each make one", () => {
  expect(joinsOf(clips).map((join) => [join.after, join.end.end, join.start.start])).toEqual([[1, 2.1, 2.9], [3, 7, 0.4]])
})

test("a head that drops by an eighth of its height moves past the step, and one that drops by a twenty-fifth does not", () => {
  expect(headShift(head(0.3, 0.4, 0.25), head(0.3, 0.43, 0.25))).toBeCloseTo(0.12)
  expect(headShift(head(0.3, 0.4, 0.25), head(0.3, 0.41, 0.25))).toBeCloseTo(0.04)
  expect(JUMP_STEP).toBeGreaterThan(0.04)
  expect(JUMP_STEP).toBeLessThan(0.12)
})

test("a head grown from a quarter to three tenths of the frame counts as a move even when the eyes stay put", () => {
  expect(headShift(head(0.3, 0.4, 0.25), head(0.3, 0.4, 0.3))).toBeCloseTo(0.05 / 0.275)
})

const measured: VideoHeads = { video: "a", step: 0.2, heads: [head(0, 0, 0.2), head(1, 0, 0.2), null, head(3, 0, 0.2), null, null, null, head(7, 0, 0.2)] }

test("the head before a join comes from the last face at or before it and the head after from the first face at or after it, not the nearest face on either side", () => {
  expect(headAt(measured, 0.5, "before")?.x).toBe(1)
  expect(headAt(measured, 0.3, "after")?.x).toBe(3)
  expect(headAt(measured, 0.6, "before")?.x).toBe(3)
  expect(headAt(measured, 1.39, "before")?.x).toBe(undefined)
})

test("a face more than 0.4 s from the join does not stand for the head at the join", () => {
  expect(headAt(measured, 0.8, "after")?.x).toBe(undefined)
  expect(headAt(measured, 1.4, "before")?.x).toBe(7)
})

const still = (video: string, y: number, seconds: number): VideoHeads =>
  ({ video, step: 0.1, heads: Array.from({ length: seconds * 10 }, () => head(0.3, y, 0.25)) })

const jumpy = (): ReadonlyArray<Clip> => [clip("a", "one", 0, 2), clip("b", "two", 1, 3), clip("c", "three", 1, 3)]
const heads = new Map([["a", still("a", 0.4, 5)], ["b", still("b", 0.43, 5)], ["c", still("c", 0.435, 5)]])

test("only the join where the head jumps becomes a place to check, and a join with an unmeasured side is left out", () => {
  const places = placesOf(jumpy(), heads, NO_EDITS)
  expect(places.map((place) => [place.join.end.video, place.join.start.video])).toEqual([["a", "b"]])
  expect(placesOf(jumpy(), new Map([["a", still("a", 0.4, 5)]]), NO_EDITS)).toEqual([])
})

test("an answer closes its place, and a second answer replaces the first instead of adding another", () => {
  const [place] = placesOf(jumpy(), heads, NO_EDITS)
  if (place === undefined) throw new Error("no place")
  const left = withAnswer(NO_EDITS, place.join, "leave")
  expect(openPlaces(placesOf(jumpy(), heads, left))).toBe(0)
  const plain = withAnswer(left, place.join, "plain")
  expect(plain.joins).toEqual([{ end: { video: "a", at: 2 }, start: { video: "b", at: 1 }, answer: "plain" }])
  expect(placesOf(jumpy(), heads, plain).map((one) => one.answer)).toEqual(["plain"])
})

test("the seconds around a join reach back across an earlier cut instead of stopping at it", () => {
  const row = [clip("x", "one", 0, 1), clip("x", "one", 3, 4), clip("y", "two", 0, 5)]
  const [join] = joinsOf(row).filter((one) => one.after === 2)
  if (join === undefined) throw new Error("no join")
  expect(aroundJoin(row, join, 1.5)).toEqual([clip("x", "one", 0.5, 1), clip("x", "one", 3, 4), clip("y", "two", 0, 1.5)])
})

test("a timeline saved before joins took answers keeps its removed pauses instead of reading as no edits", () => {
  const old = JSON.stringify({ order: [], deleted: [], chosen: [], pauses: [{ video: "a", after: 3 }] })
  expect(Schema.decodeSync(Schema.fromJsonString(Edits))(old)).toEqual({ order: [], deleted: [], chosen: [], pauses: [{ video: "a", after: 3 }], joins: [] })
})
