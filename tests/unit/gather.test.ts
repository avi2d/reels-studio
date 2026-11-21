import { expect, test } from "bun:test"
import { blocksHash, failedShows, gatherStep, gazePending } from "../../src/shared/gather.ts"

test("a folder whose every video is heard is gathered at once, not left waiting for the plan or the yes", () => {
  expect(gatherStep(["a.mov", "b.mov"], [], false, undefined)).toEqual({ kind: "gather", videos: ["a.mov", "b.mov"], settled: [] })
})

test("gathering waits while the studio still listens to a video, instead of gathering a part of the reel", () => {
  expect(gatherStep(["a.mov"], [], true, undefined)).toEqual({ kind: "wait" })
})

test("a folder with no heard video asks the model nothing", () => {
  expect(gatherStep([], [], false, undefined)).toEqual({ kind: "wait" })
})

test("the same heard videos with unchanged gaze are not gathered twice", () => {
  expect(gatherStep(["b.mov", "a.mov"], ["a.mov", "b.mov"], false, { videos: ["a.mov", "b.mov"], gazed: ["a.mov", "b.mov"] })).toEqual({ kind: "wait" })
})

test("a newly heard video gathers the blocks again instead of keeping the old ones", () => {
  expect(gatherStep(["a.mov", "b.mov"], ["a.mov"], false, { videos: ["a.mov"], gazed: ["a.mov"] })).toEqual({ kind: "gather", videos: ["a.mov", "b.mov"], settled: ["a.mov"] })
})

test("a gaze that settles after the early gathering gathers once more instead of leaving speech-only takes", () => {
  expect(gatherStep(["a.mov"], ["a.mov"], false, { videos: ["a.mov"], gazed: [] })).toEqual({ kind: "gather", videos: ["a.mov"], settled: ["a.mov"] })
})

test("a partly settled gaze waits for the rest instead of gathering every video twice", () => {
  expect(gatherStep(["a.mov", "b.mov"], ["a.mov"], false, { videos: ["a.mov", "b.mov"], gazed: [] })).toEqual({ kind: "wait" })
})

test("a missing record always gathers instead of trusting blocks the model wrote alone", () => {
  expect(gatherStep(["a.mov"], ["a.mov"], false, undefined)).toEqual({ kind: "gather", videos: ["a.mov"], settled: ["a.mov"] })
})

test("a failed gathering without a new video or a new gaze asks the model nothing", () => {
  expect(gatherStep(["a.mov"], ["a.mov"], false, { videos: ["a.mov"], gazed: ["a.mov"], failed: true })).toEqual({ kind: "wait" })
})

test("a failed gathering after a new video tries again instead of leaving the reel empty", () => {
  expect(gatherStep(["a.mov", "b.mov"], ["a.mov"], false, { videos: ["a.mov"], gazed: ["a.mov"], failed: true })).toEqual({ kind: "gather", videos: ["a.mov", "b.mov"], settled: ["a.mov"] })
})

test("a failed mark still shows over ready blocks until different blocks replace them", () => {
  const marked = { videos: ["a.mov"], gazed: ["a.mov"], failed: true, hash: blocksHash("blocks-one") }
  expect(failedShows(marked, "blocks-one")).toBe(true)
  expect(failedShows(marked, "blocks-two")).toBe(false)
  expect(failedShows({ videos: ["a.mov"], failed: false }, "blocks-one")).toBe(false)
  expect(failedShows(undefined, "blocks-one")).toBe(false)
})

test("a heard video without a settled gaze still owes a regather instead of counting as done", () => {
  expect(gazePending(["a.mov", "b.mov"], ["a.mov"])).toBe(true)
  expect(gazePending(["a.mov"], ["a.mov"])).toBe(false)
})

test("a failure that saw no blocks shows until blocks appear instead of hiding at once", () => {
  const marked = { videos: ["a.mov"], failed: true }
  expect(failedShows(marked, undefined)).toBe(true)
  expect(failedShows(marked, "blocks-one")).toBe(false)
})
