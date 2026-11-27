import { expect, test } from "bun:test"
import { numbered, parseMetadata } from "../../src/server/tus.ts"
import { safeFileName } from "../../src/shared/file-name.ts"

test("Upload-Metadata values are base64-decoded, not kept encoded", () => {
  const parsed = parseMetadata("filename d29ybGRfZG9taW5hdGlvbl9wbGFuLnBkZg==,is_confidential")
  expect(parsed.get("filename")).toBe("world_domination_plan.pdf")
  expect(parsed.get("is_confidential")).toBe("")
})

test("a Cyrillic file name survives as UTF-8, not as Latin-1 bytes", () => {
  const header = `filename ${Buffer.from("Осмотр сайта.mp4", "utf8").toString("base64")}`
  expect(parseMetadata(header).get("filename")).toBe("Осмотр сайта.mp4")
})

test("a missing header gives no keys, not a key named by the empty string", () => {
  expect(parseMetadata(undefined).size).toBe(0)
})

test("a file name with folders keeps only its last part, so it cannot leave source/", () => {
  expect(safeFileName("../../etc/passwd")).toBe("passwd")
  expect(safeFileName("C:\\Users\\a\\video.mov")).toBe("video.mov")
})

test("a name of dots or nothing becomes video, not a hidden or empty file", () => {
  expect(safeFileName("..")).toBe("video")
  expect(safeFileName(undefined)).toBe("video")
  expect(safeFileName(".env")).toBe("env")
})

test("control characters are dropped from a file name", () => {
  expect(safeFileName("a\u0000b\nc.mp4")).toBe("abc.mp4")
})

test("a second file of the same name gets a number before the extension, not after it", () => {
  expect(numbered("video.mp4", 0)).toBe("video.mp4")
  expect(numbered("video.mp4", 1)).toBe("video (2).mp4")
  expect(numbered("video", 2)).toBe("video (3)")
})
