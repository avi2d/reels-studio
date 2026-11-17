import { expect, test } from "bun:test"
import { crossingOf } from "../../src/web/timeline-row.ts"

test("a block dragged to the right lets the crossed blocks step before it, and is not itself taken out of the row", () => {
  const crossing = crossingOf(["hook", "advance", "not_auto", "intro"], "hook", "not_auto")
  expect(crossing).toEqual({ movers: ["advance", "not_auto"], side: "before" })
  expect(crossing.movers).not.toContain("hook")
})

test("a block dragged to the left lets the crossed blocks step after it, keeping their own order", () => {
  expect(crossingOf(["hook", "advance", "not_auto", "intro"], "intro", "advance")).toEqual({ movers: ["advance", "not_auto"], side: "after" })
})
