import { expect, test } from "bun:test"
import { markOf, pageTextOf, quoteFound, type PageChars } from "../../src/server/page-mark.ts"

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

test("the mark covers the quoted words across two lines and not the clause number before them or the words after them", () => {
  const mark = markOf(PAGE, "Арендодатель вправе повысить плату не чаще раза в год")
  const pad = LINE / 4
  const second = 100 + 2 * LINE
  const third = 100 + 4 * LINE
  expect(mark?.lines).toEqual([
    { left: 100 + 5 * CHAR - pad, top: second - pad, right: 100 + 39 * CHAR + pad, bottom: second + LINE + pad },
    { left: 100 - pad, top: third - pad, right: 100 + 18 * CHAR + pad, bottom: third + LINE + pad }
  ])
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
