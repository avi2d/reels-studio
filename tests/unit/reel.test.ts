import { expect, test } from "bun:test"
import { attachment } from "../../src/server/api.ts"
import { videoChain, videoOf } from "../../src/server/reel.ts"
import { joinList, partArgs, partsOf, progressSeconds, sameParts, secondsOf } from "../../src/server/media-commands.ts"
import { faceFact, faceSetting, staleText, statusOf } from "../../src/web/reel.ts"

const clip = (video: string, start: number, end: number) => ({ block: "a", video, start, end })

test("a clip becomes whole frames at 30 per second, not a fraction of a frame", () => {
  expect(partsOf([clip("a.mov", 1.01, 2.02)])).toEqual([{ video: "a.mov", start: 1, frames: 31 }])
})

test("a clip shorter than half a frame leaves no part instead of an empty file", () => {
  expect(partsOf([clip("a.mov", 5, 5.01), clip("b.mov", 0, 1)])).toEqual([{ video: "b.mov", start: 0, frames: 30 }])
})

test("the reel length is the sum of the frames of all parts, not of the first one", () => {
  expect(secondsOf([{ video: "a", start: 0, frames: 45 }, { video: "b", start: 3, frames: 15 }])).toBe(2)
})

test("a cut that moves one part by a frame no longer matches the built file", () => {
  const built = [{ video: "a", start: 1, frames: 30 }]
  expect(sameParts(built, [{ video: "a", start: 1, frames: 30 }])).toBe(true)
  expect(sameParts(built, [{ video: "a", start: 1, frames: 31 }])).toBe(false)
  expect(sameParts(built, [])).toBe(false)
})

const filterOf = (args: ReadonlyArray<string>, flag: string): string => args[args.indexOf(flag) + 1] ?? ""

test("a part of an HDR original is tone-mapped to BT.709 and cropped to 1080 by 1920, a plain one is not tone-mapped", () => {
  const part = { video: "a.mov", start: 2, frames: 60 }
  const hdr = partArgs("a.mov", part, { hdr: true, gain: undefined }, "libx264", "p.mov")
  expect(filterOf(hdr, "-vf")).toContain("tonemap")
  expect(filterOf(hdr, "-vf")).toContain("crop=1080:1920")
  expect(filterOf(hdr, "-color_trc")).toBe("bt709")
  expect(filterOf(partArgs("a.mov", part, { hdr: false, gain: undefined }, "libx264", "p.mov"), "-vf")).not.toContain("tonemap")
})

test("the sound of a two-second part fades in and fades out 0.06 s before its end, not at the end", () => {
  const args = partArgs("a.mov", { video: "a.mov", start: 0, frames: 60 }, { hdr: false, gain: undefined }, "libx264", "p.mov")
  expect(filterOf(args, "-af")).toBe("afade=t=in:d=0.06,afade=t=out:st=1.9400:d=0.06")
})

test("the join list names every part in order in the ffconcat format", () => {
  expect(joinList(["part-001.mov", "part-002.mov"])).toBe("ffconcat version 1.0\nfile 'part-001.mov'\nfile 'part-002.mov'\n")
})

test("only the out_time_us line of ffmpeg progress counts, read in microseconds", () => {
  expect(progressSeconds("out_time_us=1500000")).toBe(1.5)
  expect(progressSeconds("out_time_ms=1500000")).toBeUndefined()
  expect(progressSeconds("out_time_us=N/A")).toBeUndefined()
})

test("a build video file name carries its build time without colons", () => {
  expect(videoOf("2026-11-21T14:01:52.123Z")).toBe("reel-2026-11-21T14-01-52.123Z.mp4")
})

test("the download carries the Russian title encoded for filename* and a plain ASCII fallback", () => {
  expect(attachment("Аванс")).toBe("attachment; filename=\"reel.mp4\"; filename*=UTF-8''%D0%90%D0%B2%D0%B0%D0%BD%D1%81.mp4")
  expect(attachment("  ")).toBe("attachment; filename=\"reel.mp4\"; filename*=UTF-8''reel.mp4")
})

test("the status shows whole percent while building, not a fraction", () => {
  expect(statusOf({ job: { state: "running", done: 0.426 }, cut: 30, face: "off" })).toBe("Студия собирает ролик: 42%")
  expect(statusOf({ job: { state: "idle" }, cut: 0, face: "off" })).toBe("В монтаже нет ни одного блока. Соберите блоки, и ролик можно будет собрать.")
})

test("with her face off and no inserts the levelled reel is the file itself, with no step that re-encodes her frames", () => {
  expect(videoChain("/w", "off", false)).toEqual({ levelled: "/w/reel.mp4", steps: [] })
})

test("with her face off the inserts go on the levelled reel and no retouch step runs", () => {
  expect(videoChain("/w", "off", true)).toEqual({ levelled: "/w/levelled.mp4", steps: [{ kind: "inserts", from: "/w/levelled.mp4", to: "/w/reel.mp4" }] })
})

test("with her face light the retouch writes the file itself, not a side file the build forgets", () => {
  expect(videoChain("/w", "light", false)).toEqual({ levelled: "/w/levelled.mp4", steps: [{ kind: "face", from: "/w/levelled.mp4", to: "/w/reel.mp4" }] })
})

test("with her face light and inserts the face is retouched before the pictures go on, so no picture is retouched", () => {
  expect(videoChain("/w", "light", true)).toEqual({
    levelled: "/w/levelled.mp4",
    steps: [{ kind: "face", from: "/w/levelled.mp4", to: "/w/retouched.mp4" }, { kind: "inserts", from: "/w/retouched.mp4", to: "/w/reel.mp4" }]
  })
})

test("the reel facts say which face setting the file was built with, not the one chosen since", () => {
  expect(faceFact("off")).toBe("лицо не тронуто")
  expect(faceFact("light")).toBe("лицо слегка выровнено")
})

test("a file built with another face setting says the face differs, not that the cut changed", () => {
  const file = { made: "m", seconds: 30, size: 1, fresh: false, face: "off" as const }
  expect(staleText({ job: { state: "idle" }, cut: 30, face: "light", file }, false)).toBe("На вкладке «Внешность» выбрано другое лицо, чем в файле. Соберите ролик заново, чтобы файл совпал с выбором.")
  expect(staleText({ job: { state: "idle" }, cut: 30, face: "off", file }, false)).toBe("Монтаж изменился после сборки. Соберите ролик заново, чтобы файл совпал с монтажом.")
  expect(staleText({ job: { state: "idle" }, cut: 30, face: "light", file }, true)).toBe("Монтаж изменился после сборки. Соберите ролик заново, чтобы файл совпал с монтажом.")
})

test("the reel tab names the face choice, not a face the file may not have yet, and where to change it", () => {
  expect(faceSetting("light")).toBe("Лицо в ролике: выровнять кожу и белки глаз. Выключить можно на вкладке «Внешность».")
  expect(faceSetting("off")).toBe("Лицо в ролике: не трогать. Выровнять кожу и белки глаз можно на вкладке «Внешность».")
})
