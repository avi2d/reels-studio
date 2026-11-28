import { expect, test } from "bun:test"
import { lengthOf } from "../../src/shared/plan.ts"

test("the length of several spans is their sum, not the distance from first to last", () => {
  expect(lengthOf([{ start: 0, end: 2 }, { start: 6, end: 10 }])).toBe(6)
  expect(lengthOf([])).toBe(0)
})
