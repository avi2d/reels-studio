import { expect, test } from "bun:test"
import { shownTexts, textPlaces, withText } from "../../src/shared/captions.ts"
import { linesProblem } from "../../src/shared/texts.ts"
import { mergeEdits, NO_EDITS } from "../../src/shared/timeline.ts"

const upright = (text: string) => ({ text, accent: false })
const accent = (text: string) => ({ text, accent: true })

const heard = new Map([["a.mov", { duration: 4, words: [
  { text: "Аванс", start: 0, end: 1 },
  { text: "тридцать", start: 1, end: 2 },
  { text: "процентов", start: 2, end: 3 },
  { text: "сразу", start: 3, end: 4 }
] }]])
const reel = [{ block: "a", video: "a.mov", start: 0, end: 4 }]
const proposed = { id: "advance", video: "a.mov", from: 0, to: 1, lines: [upright("Аванс тридцать"), accent("сразу")] }

test("an upright line of 21 letters and an accent line of 9 are refused instead of passing as the template's 20 and 8", () => {
  expect(linesProblem([upright("а".repeat(20)), accent("б".repeat(8))])).toBeUndefined()
  expect(linesProblem([upright("а".repeat(21))])).toBe("too-long")
  expect(linesProblem([upright("Сохраните"), accent("б".repeat(9))])).toBe("too-long")
})

test("a fourth line and an all-blank text are refused instead of reaching the built file", () => {
  expect(linesProblem([upright("раз"), upright("два"), upright("три"), upright("четыре")])).toBe("too-many")
  expect(linesProblem([upright("  "), accent("")])).toBe("empty")
})

test("a retyped title goes into the built file with the owner's words instead of the proposed ones", () => {
  const answers = [{ id: "advance", answer: "retyped" as const, lines: [upright("Аванс не больше"), accent("30%")] }]
  expect(shownTexts([proposed], reel, heard, answers).map((one) => one.lines)).toEqual([[upright("Аванс не больше"), accent("30%")]])
  expect(shownTexts([proposed], reel, heard, []).map((one) => one.lines)).toEqual([proposed.lines])
})

test("a removed key thought is marked removed and left out of the built file instead of shown", () => {
  const answers = [{ id: "advance", answer: "remove" as const }]
  expect(textPlaces([proposed], reel, heard, answers).map((place) => place.state === "dropped" ? place.reason : place.state)).toEqual(["removed"])
  expect(shownTexts([proposed], reel, heard, answers)).toEqual([])
})

test("a text answer made on the page survives a save that crosses a studio change instead of being dropped", () => {
  const local = withText(NO_EDITS, { id: "advance", answer: "keep" })
  const current = { ...NO_EDITS, pauses: [{ video: "a.mov", after: 1 }] }
  expect(mergeEdits(NO_EDITS, local, current).texts).toEqual([{ id: "advance", answer: "keep" }])
  expect(withText(local, { id: "advance", answer: "remove" }).texts).toEqual([{ id: "advance", answer: "remove" }])
})
