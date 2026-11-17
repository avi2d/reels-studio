import { expect, test } from "bun:test"
import { stripWords } from "../../src/web/timeline-draw.ts"

test("the hint of the button that returns all pauses says it returns them, not that it removes them", () => {
  expect(stripWords(true)).toEqual({ label: "Вернуть все паузы", hint: "Возвращает все паузы в выбранные дубли" })
  expect(stripWords(true).hint).not.toContain("Убирает")
  expect(stripWords(false)).toEqual({ label: "Убрать все паузы", hint: "Убирает все паузы в выбранных дублях" })
})
