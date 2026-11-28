import { expect, test } from "bun:test"
import { coveredSpans, isCovered, sheetTimes } from "../../src/shared/face-cover.ts"
import { blocksBuild, checkSentence, LONGEST_REEL, markOf, opensDownload, type ReelChecks } from "../../src/shared/reel-checks.ts"
import { PASSING } from "./reel-check-fixtures.ts"

const withLength = (seconds: number): ReelChecks => ({ ...PASSING, length: { id: "length", seconds } })

test("a reel one second over three minutes fails and blocks the build, not only the download", () => {
  expect(LONGEST_REEL).toBe(180)
  expect(markOf(withLength(180).length)).toBe("pass")
  expect(markOf(withLength(181).length)).toBe("fail")
  expect(blocksBuild(withLength(181))).toBe(true)
  expect(opensDownload(withLength(181))).toBe(false)
})

test("the length sentence rounds the cut up, not to a cut that leaves the reel still too long", () => {
  expect(checkSentence(withLength(192.4).length)).toBe("Ролик идёт 3:13, а Instagram берёт до 3:00. Уберите из монтажа 0:13.")
})

test("loudness before the build waits for the file instead of blocking the build or opening the download", () => {
  const unbuilt = { ...PASSING, loudness: { id: "loudness", state: "unbuilt" } } satisfies ReelChecks
  expect(markOf(unbuilt.loudness)).toBe("after-build")
  expect(blocksBuild(unbuilt)).toBe(false)
  expect(opensDownload(unbuilt)).toBe(false)
})

test("bad loudness on the built file closes the download but does not stop a rebuild", () => {
  const loud = { ...PASSING, loudness: { id: "loudness", state: "heard", level: "bad" } } satisfies ReelChecks
  expect(blocksBuild(loud)).toBe(false)
  expect(opensDownload(loud)).toBe(false)
})

test("an open question in the montage blocks the build and names how many are left", () => {
  const open = { ...PASSING, places: { id: "places", open: 2, part: "b" } } satisfies ReelChecks
  expect(blocksBuild(open)).toBe(true)
  expect(checkSentence(open.places)).toBe("В монтаже остались вопросы: 2. Ответьте на них на шаге «Монтаж».")
})

const middle = { x: 0.28, y: 0.3, size: 0.15 }
const lowRight = { x: 0.48, y: 0.6, size: 0.15 }

test("a face low on the right is under the Instagram buttons and a face high in the middle is not", () => {
  const gaze = { step: 0.5, samples: [], heads: [middle, lowRight, lowRight, middle, null] }
  expect(coveredSpans(gaze, 2.5)).toEqual([{ from: 0.5, to: 1.5 }])
})

test("every covered stretch gets a frame on the sheet, not only the evenly spaced ones", () => {
  const covered = [{ from: 4.1, to: 4.6 }]
  const times = sheetTimes(12, covered)
  expect(times.some((time) => isCovered(covered, time))).toBe(true)
  expect(times.length).toBeLessThanOrEqual(9)
})
