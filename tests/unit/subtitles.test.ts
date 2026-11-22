import { expect, test } from "bun:test"
import { bareWord, subtitleWords } from "../../src/shared/subtitles.ts"

const transcript = {
  duration: 10,
  words: [
    { start: 1.0, end: 1.3, text: "А" },
    { start: 1.4, end: 1.9, text: "вас" },
    { start: 2.0, end: 2.5, text: "тоже" },
    { start: 3.0, end: 3.6, text: "бесит," },
    { start: 5.0, end: 5.5, text: "когда" }
  ]
}
const transcripts = new Map([["a.mov", transcript]])

test("a word the cut removed never shows, and the words after the cut move earlier by the removed stretch", () => {
  const clips = [{ video: "a.mov", start: 1.0, end: 1.95 }, { video: "a.mov", start: 2.9, end: 3.8 }]
  expect(subtitleWords(clips, transcripts).map((word) => word.text)).toEqual(["А", "вас", "бесит"])
  const moved = subtitleWords(clips, transcripts)[2]
  expect(moved?.start).toBeCloseTo(0.95 + 0.1)
  expect(moved?.end).toBeCloseTo(0.95 + 0.9)
})

test("a word stays until the next word starts rather than vanishing in the short gap between them", () => {
  const words = subtitleWords([{ video: "a.mov", start: 0.9, end: 2.6 }], transcripts)
  expect(words[0]?.end).toBeCloseTo(words[1]?.start ?? 0)
  expect(words[1]?.end).toBeCloseTo(words[2]?.start ?? 0)
})

test("a word before a long silence leaves the screen 0.4 s after it is said, not when the next word starts", () => {
  const words = subtitleWords([{ video: "a.mov", start: 2.9, end: 5.6 }], transcripts)
  expect(words[0]?.text).toBe("бесит")
  expect(words[0]?.end).toBeCloseTo(3.6 + 0.4 - 2.9)
})

test("no two words stand on the screen at once", () => {
  const words = subtitleWords([{ video: "a.mov", start: 0, end: 10 }, { video: "a.mov", start: 0, end: 10 }], transcripts)
  words.slice(1).forEach((word, index) => { expect(word.start).toBeGreaterThanOrEqual(words[index]?.end ?? 0) })
})

test("the comma, the quotes and the dash around a word are dropped, not the hyphen inside it", () => {
  expect(bareWord("бесит,")).toBe("бесит")
  expect(bareWord("«нет»")).toBe("нет")
  expect(bareWord("—")).toBe("")
  expect(bareWord("кто-то.")).toBe("кто-то")
})
