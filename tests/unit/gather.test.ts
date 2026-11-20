import { expect, test } from "bun:test"
import { gatherStep } from "../../src/shared/gather.ts"

test("a folder whose every video is heard is gathered at once, not left waiting for the plan or the yes", () => {
  expect(gatherStep(["a.mov", "b.mov"], false, undefined, false)).toEqual({ kind: "gather", videos: ["a.mov", "b.mov"] })
})

test("gathering waits while the studio still listens to a video, instead of gathering a part of the reel", () => {
  expect(gatherStep(["a.mov"], true, undefined, false)).toEqual({ kind: "wait" })
})

test("a folder with no heard video asks the model nothing", () => {
  expect(gatherStep([], false, undefined, false)).toEqual({ kind: "wait" })
})

test("the same heard videos in another order are not gathered twice", () => {
  expect(gatherStep(["b.mov", "a.mov"], false, { videos: ["a.mov", "b.mov"] }, true)).toEqual({ kind: "wait" })
})

test("a newly heard video gathers the blocks again instead of keeping the old ones", () => {
  expect(gatherStep(["a.mov", "b.mov"], false, { videos: ["a.mov"] }, true)).toEqual({ kind: "gather", videos: ["a.mov", "b.mov"] })
})

test("blocks the chat model already wrote are remembered, not gathered again", () => {
  expect(gatherStep(["a.mov"], false, undefined, true)).toEqual({ kind: "seed", videos: ["a.mov"] })
})
