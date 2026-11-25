import { expect, test } from "bun:test"
import { pageOf } from "../../src/web/studio/paging.ts"

const twelve = Array.from({ length: 12 }, (_, index) => index + 1)

test("twelve items make three pages of five, five and two, not a fourth empty page or a short first page", () => {
  expect(pageOf(twelve, 0)).toEqual({ items: [1, 2, 3, 4, 5], page: 0, pages: 3, first: 1, last: 5, total: 12 })
  expect(pageOf(twelve, 1).items).toEqual([6, 7, 8, 9, 10])
  expect(pageOf(twelve, 2)).toEqual({ items: [11, 12], page: 2, pages: 3, first: 11, last: 12, total: 12 })
})

test("a page past the end after items leave shows the last page instead of an empty one", () => {
  expect(pageOf(twelve.slice(0, 6), 2)).toEqual({ items: [6], page: 1, pages: 2, first: 6, last: 6, total: 6 })
  expect(pageOf(twelve, -1).page).toBe(0)
})

test("exactly five items stay on one page instead of opening a second", () => {
  expect(pageOf(twelve.slice(0, 5), 0).pages).toBe(1)
  expect(pageOf([], 0)).toEqual({ items: [], page: 0, pages: 1, first: 1, last: 0, total: 0 })
})
