import { expect, test } from "bun:test"
import { shownHeight } from "../../src/server/media-jobs.ts"

test("a phone video stored on its side counts its long side as the height when it plays upright, not the stored height", () => {
  expect(shownHeight({ width: 3840, height: 2160 }, 9 / 16)).toBe(3840)
  expect(shownHeight({ width: 2160, height: 3840 }, 9 / 16)).toBe(3840)
})

test("a wide video counts its short side as the height", () => {
  expect(shownHeight({ width: 3840, height: 2160 }, 16 / 9)).toBe(2160)
})

test("a video whose sides or aspect are unknown has no height, rather than a guessed one", () => {
  expect(shownHeight({ width: 1080 }, 9 / 16)).toBeUndefined()
  expect(shownHeight({ width: 1080, height: 1920 }, undefined)).toBeUndefined()
})
