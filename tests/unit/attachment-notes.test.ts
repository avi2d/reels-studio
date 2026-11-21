import { expect, test } from "bun:test"
import { about, deliveryNote, frameTimes, promptText } from "../../src/server/attachment-notes.ts"
import { kindOfName } from "../../src/shared/chat.ts"

test("an iPhone screenshot, photo, voice memo and PDF are told apart by name, upper case included, not taken as other", () => {
  expect(kindOfName("IMG_8123.PNG")).toBe("picture")
  expect(kindOfName("IMG_8124.HEIC")).toBe("picture")
  expect(kindOfName("IMG_8200.MOV")).toBe("video")
  expect(kindOfName("Новая запись.m4a")).toBe("sound")
  expect(kindOfName("Договор дарения.pdf")).toBe("document")
})

test("a name with no extension or an archive is other, not guessed from a part before the last dot", () => {
  expect(kindOfName("README")).toBe("other")
  expect(kindOfName("photos.png.zip")).toBe("other")
})

test("video frames fall inside the video, and an unknown length gives one first frame, not a frame past the end", () => {
  const times = frameTimes(12)
  expect(times.length).toBe(3)
  for (const time of times) {
    expect(time).toBeGreaterThanOrEqual(0)
    expect(time).toBeLessThan(12)
  }
  expect(frameTimes(undefined)).toEqual([0])
  expect(frameTimes(0)).toEqual([0])
  expect(frameTimes(Number.NaN)).toEqual([0])
})

test("a length is told as minutes and seconds, and 59.6 seconds rounds to 1:00, not 0:60", () => {
  expect(about.sound(75, { heard: "silent" })).toContain("1:15")
  expect(about.sound(59.6, { heard: "silent" })).toContain("1:00")
  expect(about.sound(59.6, { heard: "silent" })).not.toContain("0:60")
})

test("a PDF without a text layer is described as a scan to read from its pictures, not as an empty document", () => {
  expect(about.document(2, undefined)).toContain("scan")
  expect(about.document(1, "attached-views/a.pdf/text.txt")).toContain("attached-views/a.pdf/text.txt")
  expect(about.document(1, "t.txt")).toContain("1 page.")
})

test("the fourth of four fully rendered PDFs reports 0 of 4 with readable paths, not a shown claim", () => {
  const pages = ["page-1.jpg", "page-2.jpg", "page-3.jpg", "page-4.jpg"]
  const note = deliveryNote("document", "attached-views/d.pdf", pages, 0, [])
  expect(note).toContain("0 of 4")
  for (const page of pages) expect(note).toContain(`attached-views/d.pdf/${page}`)
  expect(note).not.toContain("shown to you")
})

test("a partly limited video names only the omitted frame paths, not the attached ones", () => {
  const note = deliveryNote("video", "attached-views/v.mp4", ["frame-1.jpg", "frame-2.jpg", "frame-3.jpg"], 1, [])
  expect(note).toContain("1 of 3")
  expect(note).toContain("attached-views/v.mp4/frame-3.jpg")
  expect(note).not.toContain("attached-views/v.mp4/frame-1.jpg")
})

test("an unreadable frame is reported as unreadable, not as a readable path", () => {
  const note = deliveryNote("video", "attached-views/v.mp4", ["frame-1.jpg", "frame-2.jpg"], 1, ["frame-2.jpg"])
  expect(note).toContain("could not be read")
  expect(note).toContain("attached-views/v.mp4/frame-2.jpg")
  expect(note).not.toContain("Read the rest")
})

test("a message without files reaches the model as typed, and files alone are named, not sent as an empty message", () => {
  expect(promptText("Привет", [])).toBe("Привет")
  const alone = promptText("", [{ name: "IMG_8123.PNG", about: "A picture." }])
  expect(alone).toContain("without words")
  expect(alone).toContain("attached/IMG_8123.PNG: A picture.")
})
