import { expect, test } from "bun:test"
import { lengthOf, removedSpans, removedWords, skipTarget, type Transcript } from "../../src/shared/plan.ts"

const word = (start: number, end: number, text: string) => ({ start, end, text })

const speech: Transcript = {
  duration: 10,
  words: [
    word(1, 1.4, "Аванс"),
    word(1.4, 2, "вернут."),
    word(3, 3.5, "Ой,"),
    word(3.5, 4, "нет."),
    word(6, 6.5, "Аванс"),
    word(6.5, 7, "вернут.")
  ]
}

test("a plan with nothing to remove skips nothing, not the pauses between words", () => {
  expect(removedSpans(speech, { video: "a", remove: [] })).toEqual([])
})

test("two removed words in a row make one span from the first start to the last end, not two", () => {
  expect(removedSpans(speech, { video: "a", remove: [{ from: 2, to: 3 }] })).toEqual([{ start: 3, end: 4 }])
})

test("removed pieces apart from each other stay apart, not merged over the kept words between", () => {
  expect(removedSpans(speech, { video: "a", remove: [{ from: 0, to: 0 }, { from: 5, to: 5 }] })).toEqual([
    { start: 1, end: 1.4 },
    { start: 6.5, end: 7 }
  ])
})

test("two plan pieces that touch make one span, not a jump that lands inside removed words", () => {
  expect(removedSpans(speech, { video: "a", remove: [{ from: 2, to: 2 }, { from: 3, to: 4 }] })).toEqual([{ start: 3, end: 6.5 }])
})

test("overlapping pieces of a plan mark each word once, and a piece past the end marks nothing more", () => {
  expect(removedWords(4, { video: "a", remove: [{ from: 1, to: 2 }, { from: 2, to: 9 }] })).toEqual([false, true, true, true])
})

test("the length of several spans is their sum, not the distance from first to last", () => {
  expect(lengthOf([{ start: 0, end: 2 }, { start: 6, end: 10 }])).toBe(6)
  expect(lengthOf([])).toBe(0)
})

test("the player jumps to the end of a removed span only from inside it, the end itself excluded", () => {
  const spans = [{ start: 2, end: 6 }]
  expect(skipTarget(spans, 2)).toBe(6)
  expect(skipTarget(spans, 5.9)).toBe(6)
  expect(skipTarget(spans, 6)).toBeUndefined()
  expect(skipTarget(spans, 1.9)).toBeUndefined()
})
