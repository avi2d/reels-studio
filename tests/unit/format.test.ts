import { expect, test } from "bun:test"
import { encodeMetadata, formatDay, formatLength, formatSize, modelName, parseEventBlock } from "../../src/web/format.ts"

test("a length is minutes and two-digit seconds, rounded to the nearest second", () => {
  expect(formatLength(235.128)).toBe("3:55")
  expect(formatLength(59.6)).toBe("1:00")
  expect(formatLength(5)).toBe("0:05")
})

test("sizes use 1024 steps and a decimal comma, not a point", () => {
  expect(formatSize(0)).toBe("0 Б")
  expect(formatSize(1023)).toBe("1023 Б")
  expect(formatSize(1536)).toBe("1,5 КБ")
  expect(formatSize(20 * 1024 * 1024)).toBe("20,0 МБ")
  expect(formatSize(3 * 1024 ** 3)).toBe("3,0 ГБ")
})

test("a Moscow evening date keeps the local day, not the UTC date", () => {
  process.env.TZ = "Europe/Moscow"
  expect(formatDay("2026-11-14T22:30:00Z")).toBe("15 ноября 2026 г.")
})

test("a model shows its readable name, not the provider id", () => {
  expect(modelName("claude-bridge/claude-opus-5-5")).toBe("Claude Opus 5.5")
  expect(modelName("claude-bridge/claude-sonnet-5-5")).toBe("Claude Sonnet 5.5")
  expect(modelName("openai/gpt-6.1-sol")).toBe("GPT 6.1 Sol")
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
