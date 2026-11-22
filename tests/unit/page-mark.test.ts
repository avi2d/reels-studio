import { expect, test } from "bun:test"
import { markOf, pageTextOf, quoteFound, type Mark, type PageChars } from "../../src/server/page-mark.ts"

const CHAR = 10
const LINE = 24

const pageOf = (lines: ReadonlyArray<string>): PageChars => ({
  width: 1000,
  height: 1400,
  chars: lines.flatMap((line, row) => {
    const top = 100 + row * 2 * LINE
    const letters = Array.from(line, (text) => text).map((text, at) => ({ text, left: 100 + at * CHAR, top, right: 100 + (at + 1) * CHAR, bottom: top + LINE }))
    const breaks = row === lines.length - 1 ? [] : ["\r", "\n"].map((text) => ({ text, left: 0, top: 0, right: 0, bottom: 0 }))
    return [...letters, ...breaks]
  })
})

const PAGE = pageOf([
  "1.1. Срок аренды одиннадцать месяцев.",
  "2.2. Арендодатель вправе повысить плату",
  "не чаще раза в год, предупредив за месяц."
])

type Box = Mark["window"]

const charsOf = (row: number, from: number, to: number): ReadonlyArray<Box> => {
  const top = 100 + row * 2 * LINE
  return Array.from({ length: to - from }, (_, at) => ({ left: 100 + (from + at) * CHAR, top, right: 100 + (from + at + 1) * CHAR, bottom: top + LINE }))
}

const holds = (outer: Box, inner: Box): boolean => outer.left <= inner.left && outer.top <= inner.top && outer.right >= inner.right && outer.bottom >= inner.bottom

test("the mark covers the quoted words across two lines and not the clause number before them or the words after them", () => {
  const lines = markOf(PAGE, "Арендодатель вправе повысить плату не чаще раза в год")?.lines ?? []
  expect(lines.length).toBe(2)
  const [second, third] = lines.toSorted((upper, lower) => upper.top - lower.top)
  if (second === undefined || third === undefined) throw new Error("two marked lines expected")
  expect(charsOf(1, 5, 39).every((char) => holds(second, char))).toBe(true)
  expect(charsOf(2, 0, 18).every((char) => holds(third, char))).toBe(true)
  const clauseNumber = charsOf(1, 0, 4)
  expect(clauseNumber.every((char) => second.left >= char.right)).toBe(true)
  expect(charsOf(2, 18, 19).some((comma) => holds(third, comma))).toBe(false)
  const nextWord = charsOf(2, 20, 31)
  expect(nextWord.every((char) => third.right <= char.left)).toBe(true)
})

test("a quote that is not on the page gives no mark rather than marking the nearest line", () => {
  expect(markOf(PAGE, "Арендатор вправе расторгнуть договор")).toBeUndefined()
  expect(markOf(PAGE, "   ")).toBeUndefined()
})

test("a quote matches the page whatever its case, its ё and its line breaks, not only letter for letter", () => {
  expect(markOf(PAGE, "АРЕНДОДАТЕЛЬ  вправе\nповысить плату не чаще")).toBeDefined()
  expect(quoteFound("Срок аренды — одиннадцать\r\nмесяцев", "срок аренды — одиннадцать месяцев")).toBe(true)
  expect(quoteFound("Платёж возвращается", "платеж возвращается")).toBe(true)
})

test("a word the page breaks with a hyphen at a line end matches the whole word in the quote, not the two halves", () => {
  const page = pageOf(["Арендо-", "датель вправе"])
  expect(markOf(page, "Арендодатель вправе")?.lines.length).toBe(2)
  expect(quoteFound("Арендо-\nдатель вправе", "Арендодатель вправе")).toBe(true)
  expect(quoteFound("акта приёма-\nпередачи", "акта приёма-передачи")).toBe(true)
})

test("the window around the mark stays inside the page, so a quote near the edge is not cut off by a crop outside it", () => {
  const window = markOf(PAGE, "1.1. Срок")?.window ?? { left: -1, top: -1, right: 0, bottom: 0 }
  expect(window.left).toBeGreaterThanOrEqual(0)
  expect(window.top).toBeGreaterThanOrEqual(0)
  expect(window.right).toBeLessThanOrEqual(PAGE.width)
  expect(window.bottom).toBeLessThanOrEqual(PAGE.height)
  expect(window.bottom - window.top).toBeLessThanOrEqual(window.right - window.left)
})

test("the window of an odd-sized page whose text reaches every edge stays inside the page, not 1 px past it where the crop fails", () => {
  const width = 1801
  const height = 1273
  const corners = [
    { text: "А", left: 0, top: 0, right: 20, bottom: 24 },
    { text: "Я", left: width - 20, top: height - 24, right: width, bottom: height }
  ]
  const window = markOf({ width, height, chars: corners }, "А")?.window ?? { left: -1, top: -1, right: width + 1, bottom: height + 1 }
  expect(window.left).toBeGreaterThanOrEqual(0)
  expect(window.top).toBeGreaterThanOrEqual(0)
  expect(window.right).toBeLessThanOrEqual(width)
  expect(window.bottom).toBeLessThanOrEqual(height)
})

test("the window of a page with little text holds all of that text and is no taller than it, not a square of empty paper", () => {
  const window = markOf(PAGE, "Арендодатель вправе")?.window ?? { left: 0, top: 0, right: 0, bottom: PAGE.height }
  const letters = PAGE.chars.filter((char) => char.text.trim() !== "")
  const textTop = Math.min(...letters.map((char) => char.top))
  const textBottom = Math.max(...letters.map((char) => char.bottom))
  expect(window.top).toBeLessThanOrEqual(textTop)
  expect(window.bottom).toBeGreaterThanOrEqual(textBottom)
  expect(window.bottom - window.top).toBeLessThan(window.right - window.left)
  expect(window.bottom - window.top).toBeLessThan((window.right - window.left) / 2)
})

test("the window holds every word of the page text, not only the quoted words, so no line is cut mid-word at its edge", () => {
  const page = { ...pageOf(["3.2. Предоплата не возвращается при отказе.", "3.3. Остаток стоимости вносится не позднее дня процедуры."]), width: 700 }
  const line = page.chars.filter((char) => char.text.trim() !== "")
  const window = markOf(page, "Предоплата")?.window ?? { left: 0, top: 0, right: 0, bottom: 0 }
  expect(window.left).toBeLessThanOrEqual(Math.min(...line.map((char) => char.left)))
  expect(window.right).toBeGreaterThanOrEqual(Math.max(...line.map((char) => char.right)))
})

test("the text of page 2 is read from page 2, not from page 12 or from the start of the document", () => {
  const pages = Array.from({ length: 12 }, (_, at) => `Page ${at + 1}:\nтекст страницы ${at + 1}`).join("\n\n") + "\n"
  expect(pageTextOf(pages, 2)).toBe("текст страницы 2")
  expect(pageTextOf(pages, 1)).toBe("текст страницы 1")
  expect(pageTextOf(pages, 12)).toBe("текст страницы 12\n")
  expect(pageTextOf(pages, 13)).toBeUndefined()
})
