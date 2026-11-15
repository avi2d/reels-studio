import { expect, test } from "bun:test"
import { encodeMetadata, formatDay, formatSize, parseEventBlock, strongRuns } from "../../src/web/format.ts"

test("sizes use 1024 steps and a decimal comma, not a point", () => {
  expect(formatSize(0)).toBe("0 Б")
  expect(formatSize(1023)).toBe("1023 Б")
  expect(formatSize(1536)).toBe("1,5 КБ")
  expect(formatSize(20 * 1024 * 1024)).toBe("20,0 МБ")
  expect(formatSize(3 * 1024 ** 3)).toBe("3,0 ГБ")
})

test("a date is written in Russian with the month in the genitive, not as digits", () => {
  expect(formatDay("2026-11-15T17:27:58.799Z")).toBe("15 ноября 2026 г.")
})

test("a Cyrillic file name is base64 of its UTF-8 bytes, which btoa alone would refuse", () => {
  expect(encodeMetadata("Осмотр.mp4")).toBe(`filename ${Buffer.from("Осмотр.mp4", "utf8").toString("base64")}`)
  expect(encodeMetadata("world_domination_plan.pdf")).toBe("filename d29ybGRfZG9taW5hdGlvbl9wbGFuLnBkZg==")
})

test("a run between double asterisks is strong and loses the asterisks, not shown with them", () => {
  expect(strongRuns("**Что важно?** Например, суд.")).toEqual([
    { text: "Что важно?", strong: true },
    { text: " Например, суд.", strong: false }
  ])
})

test("an unclosed pair and a spaced multiplication stay as typed", () => {
  expect(strongRuns("2 ** 3 ** 4")).toEqual([{ text: "2 ** 3 ** 4", strong: false }])
  expect(strongRuns("**начало без конца")).toEqual([{ text: "**начало без конца", strong: false }])
})

test("a keep-alive comment block carries no event, and a broken block is skipped", () => {
  expect(parseEventBlock(": ")).toBeUndefined()
  expect(parseEventBlock("data: {broken")).toBeUndefined()
  expect(parseEventBlock('data: {"type":"done"}')).toEqual({ type: "done" })
})
