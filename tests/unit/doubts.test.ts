import { expect, test } from "bun:test"
import { doubtAnswer, doubtsOf, isValidDoubt, unsureIndexes } from "../../src/shared/doubts.ts"

const word = (text: string, sure: number | undefined) => sure === undefined ? { start: 0, end: 1, text } : { start: 0, end: 1, text, sure }

const transcript = {
  duration: 10,
  words: [
    word("Это", 0.3),
    word("неправда.", 0.52),
    word("Статья", 0.99),
    word("25", 0.42),
    word("обращайтесь", 0.9),
    word("в", 0.15),
    word("Роспотребнадзор", 0.24),
    word("или", 0.9),
    word("Ивану", 0.57),
    word("в", 0.9),
    word("арбитражный", 0.59),
    word("суд", 0.9)
  ]
}

test("a low score marks a number, a mid-sentence name or a lost word, not an ordinary word or a sentence opener", () => {
  expect(unsureIndexes(transcript)).toEqual([3, 5, 6])
})

test("a word without a score is never marked, so a video heard before scores existed raises no question", () => {
  expect(unsureIndexes({ duration: 1, words: [word("25", undefined), word("Роспотребнацере", undefined)] })).toEqual([])
})

test("a fix for a word the recognizer heard surely is dropped, not turned into a question that rewrites the speaker", () => {
  const lawCorrection = { video: "a.mov", index: 10, fix: "районный", reason: "" }
  expect(isValidDoubt(transcript.words, lawCorrection)).toBe(false)
  expect(doubtsOf(transcript, "a.mov", [lawCorrection]).map((one) => one.index)).toEqual([3, 5, 6])
})

test("a fix equal to the heard word up to case and punctuation is dropped, not offered as a change", () => {
  expect(isValidDoubt(transcript.words, { video: "a.mov", index: 6, fix: "роспотребнадзор,", reason: "" })).toBe(false)
  expect(isValidDoubt(transcript.words, { video: "a.mov", index: 99, fix: "x", reason: "" })).toBe(false)
})

test("a fix for a marked word is offered on that word only, not on the same word number of another video", () => {
  const fix = { video: "a.mov", index: 3, fix: "18", reason: "Статья 18" }
  expect(doubtsOf(transcript, "a.mov", [fix])).toEqual([
    { index: 3, fix: "18", reason: "Статья 18" },
    { index: 5, fix: undefined, reason: "" },
    { index: 6, fix: undefined, reason: "" }
  ])
  expect(doubtsOf(transcript, "b.mov", [fix]).every((one) => one.fix === undefined)).toBe(true)
})

test("an answer is read as taken, kept or typed by its text, not left open once the word is corrected", () => {
  expect(doubtAnswer("25", "18", undefined)).toBeUndefined()
  expect(doubtAnswer("25", "18", "18")).toBe("fix")
  expect(doubtAnswer("25", "18", "25")).toBe("heard")
  expect(doubtAnswer("25", "18", "28")).toBe("typed")
  expect(doubtAnswer("25", undefined, "25")).toBe("heard")
})
