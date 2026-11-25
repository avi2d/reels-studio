import { expect, test } from "bun:test"
import { percentOf, recordCount } from "../../src/web/studio/takes.ts"

test("eleven and twenty-one take their own Russian forms, not the form of their last digit alone", () => {
  expect(recordCount(1)).toBe("1 запись")
  expect(recordCount(2)).toBe("2 записи")
  expect(recordCount(5)).toBe("5 записей")
  expect(recordCount(11)).toBe("11 записей")
  expect(recordCount(21)).toBe("21 запись")
  expect(recordCount(22)).toBe("22 записи")
})

test("an upload one byte short reads 99%, not a rounded-up 100% before it ends", () => {
  expect(percentOf(999, 1000)).toBe(99)
  expect(percentOf(1000, 1000)).toBe(100)
  expect(percentOf(0, 0)).toBe(0)
})
