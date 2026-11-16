import { expect, test } from "bun:test"
import { parseRange } from "../../src/server/range.ts"

test("no header, another unit or several ranges mean the whole file, not an error", () => {
  expect(parseRange(undefined, 100)).toEqual({ kind: "whole" })
  expect(parseRange("items=0-5", 100)).toEqual({ kind: "whole" })
  expect(parseRange("bytes=0-5,10-15", 100)).toEqual({ kind: "whole" })
  expect(parseRange("bytes=-", 100)).toEqual({ kind: "whole" })
})

test("both ends of a range are inclusive, as in bytes=0-0 for the first byte", () => {
  expect(parseRange("bytes=0-0", 100)).toEqual({ kind: "part", start: 0, end: 0 })
  expect(parseRange("bytes=10-19", 100)).toEqual({ kind: "part", start: 10, end: 19 })
})

test("an open range runs to the last byte, and an end past the file is cut to it", () => {
  expect(parseRange("bytes=90-", 100)).toEqual({ kind: "part", start: 90, end: 99 })
  expect(parseRange("bytes=90-500", 100)).toEqual({ kind: "part", start: 90, end: 99 })
})

test("a suffix range counts from the end, and one longer than the file gives the whole of it", () => {
  expect(parseRange("bytes=-10", 100)).toEqual({ kind: "part", start: 90, end: 99 })
  expect(parseRange("bytes=-500", 100)).toEqual({ kind: "part", start: 0, end: 99 })
})

test("a start at or past the end of the file, or an empty suffix, is outside the file", () => {
  expect(parseRange("bytes=100-", 100)).toEqual({ kind: "outside" })
  expect(parseRange("bytes=-0", 100)).toEqual({ kind: "outside" })
})

test("a range whose end comes before its start is ignored, and the whole file is sent", () => {
  expect(parseRange("bytes=50-40", 100)).toEqual({ kind: "whole" })
})
