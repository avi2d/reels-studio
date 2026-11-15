import { expect, test } from "bun:test"
import { encodeMetadata, formatDay, formatSize, parseEventBlock } from "../../src/web/format.ts"

test("sizes use 1024 steps and a decimal comma, not a point", () => {
  expect(formatSize(0)).toBe("0 Б")
  expect(formatSize(1023)).toBe("1023 Б")
  expect(formatSize(1536)).toBe("1,5 КБ")
  expect(formatSize(20 * 1024 * 1024)).toBe("20,0 МБ")
  expect(formatSize(3 * 1024 ** 3)).toBe("3,0 ГБ")
})

test("a date keeps the browser day instead of forcing the UTC date", () => {
  const iso = "2026-11-15T12:00:00"
  const expected = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", year: "numeric" }).format(new Date(iso))
  expect(formatDay(iso)).toBe(expected)
})

test("a Cyrillic file name is base64 of its UTF-8 bytes, which btoa alone would refuse", () => {
  expect(encodeMetadata("Осмотр.mp4")).toBe(`filename ${Buffer.from("Осмотр.mp4", "utf8").toString("base64")}`)
  expect(encodeMetadata("world_domination_plan.pdf")).toBe("filename d29ybGRfZG9taW5hdGlvbl9wbGFuLnBkZg==")
})

test("a keep-alive comment block carries no event, and a broken block is skipped", () => {
  expect(parseEventBlock(": ")).toBeUndefined()
  expect(parseEventBlock("data: {broken")).toBeUndefined()
  expect(parseEventBlock('data: {"type":"done"}')).toEqual({ type: "done" })
})
