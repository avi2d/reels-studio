import { expect, test } from "bun:test"
import { looksOf } from "../../src/server/looks.ts"
import { cleanPreviewArgs, noiseFilters, partArgs, partSoundFilter } from "../../src/server/media-commands.ts"
import { soundKeyOf } from "../../src/server/sound-check.ts"
import { soundPartArgs } from "../../src/server/sound-commands.ts"
import { noiseFacts, noiseStatus, sourceOf } from "../../src/web/studio/look-noise.ts"
import { windowLevelsOf } from "../../src/server/loudness-meter.ts"
import { pauseNoise, type Windows } from "../../src/shared/noise.ts"

const windowsOf = (off: ReadonlyArray<number>, strong: ReadonlyArray<number>): Windows => ({ off, light: off, strong })

const part = { video: "a.mov", start: 0, frames: 60 }
const filterOf = (args: ReadonlyArray<string>): string => args[args.indexOf("-af") + 1] ?? ""

test("«Оставить» leaves the sound with its fades only, not a cleaning filter", () => {
  expect(partSoundFilter(2, "off")).toBe("afade=t=in:d=0.06,afade=t=out:st=1.9400:d=0.06")
})

test("FFT cleaning does not leave the voice two filter hops behind the picture", () => {
  for (const strength of ["light", "strong"] as const) {
    const filters = noiseFilters(strength)
    expect(filters[0]).toBe("aresample=48000")
    expect(filters.slice(2)).toEqual([
      "apad=pad_len=1200",
      expect.stringMatching(/^afftdn=/),
      "atrim=start_sample=1200",
      "asetpts=PTS-1200/SR/TB"
    ])
  }
})

test("the build and the sound check clean the voice with the same filter, so the check hears the built sound", () => {
  const built = filterOf(partArgs("a.mov", part, { hdr: false, gain: undefined }, "strong", "libx264", "p.mov"))
  expect(filterOf(soundPartArgs("a.mov", part, "strong", "p.wav"))).toBe(built)
})

test("a project with no noise choice is cleaned at the strong setting, not left with its room noise", () => {
  expect(looksOf(undefined).noise).toBe("strong")
  expect(looksOf("not json").noise).toBe("strong")
  expect(looksOf(JSON.stringify({ face: "light" })).noise).toBe("strong")
  expect(looksOf(JSON.stringify({ face: "off", noise: "light" })).noise).toBe("light")
})

test("the noise choice and the face choice share one file without one resetting the other", () => {
  const both = JSON.stringify({ face: "light", noise: "off" })
  expect(looksOf(both).face).toBe("light")
  expect(looksOf(both).noise).toBe("off")
})

test("the player plays the cleaned file of the chosen strength, not the plain preview, once the cleaning is made", () => {
  const view = { job: { state: "idle" }, cut: 30, noise: "strong", cleaned: { made: "m" } } as const
  expect(sourceOf("p", view)("a.mov")).toBe("/api/projects/p/noise/strong/a.mov?made=m")
  expect(sourceOf("p", { ...view, noise: "off" })("a.mov")).toBe("/api/projects/p/videos/a.mov/preview")
  expect(sourceOf("p", { job: { state: "idle" }, cut: 30, noise: "light" })("a.mov")).toBe("/api/projects/p/videos/a.mov/preview")
})

test("cleaning in progress shows its share instead of an empty status", () => {
  expect(noiseStatus({ job: { state: "running", done: 0.5 }, cut: 30, noise: "strong" })).toBe("Студия чистит звук: 50%")
  expect(noiseStatus({ job: { state: "idle" }, cut: 30, noise: "strong" })).toBe("")
})

test("the cleaned preview copies the picture and cleans the voice from the source, not from the already compressed preview sound", () => {
  const args = cleanPreviewArgs({ preview: "p.mp4", source: "s.mov" }, "strong", "o.mp4")
  expect(args.slice(args.indexOf("-map"), args.indexOf("-map") + 6)).toEqual(["-map", "0:v:0", "-map", "1:a:0", "-c:v", "copy"])
  const previewFilter = filterOf(args)
  expect(previewFilter).toBe(noiseFilters("strong").join(","))
  expect(partSoundFilter(2, "strong")).toStartWith(`${previewFilter},afade=`)
  expect(filterOf(cleanPreviewArgs({ preview: "p.mp4", source: "s.mov" }, "light", "o.mp4"))).not.toBe(previewFilter)
})

test("pause noise is read in the windows that are quiet before cleaning, not in the windows quiet after it", () => {
  const windows = windowsOf([-30, -30, -30, -60, -62, -30, -64], [-31, -30, -30, -75, -77, -50, -79])
  expect(pauseNoise(windows)).toEqual({ off: -62, light: -62, strong: -77 })
})

test("a silent window reads as the floor of the scale instead of being dropped", () => {
  const metadata = "frame:0\nlavfi.astats.Overall.RMS_level=-36.45\nframe:1\nlavfi.astats.Overall.RMS_level=-inf\nframe:2\nlavfi.astats.Overall.RMS_level=-120.3\n"
  expect(windowLevelsOf(metadata, -100)).toEqual([-36.5, -100, -100])
})

test("each choice names its own pause noise, so «Оставить» and «Убрать сильно» do not read alike", () => {
  const pauses = { off: -57, light: -62, strong: -69 }
  expect(noiseFacts(pauses, "off")).toEqual(["Шум в паузах: \u221257\u00a0дБ, как в записи."])
  expect(noiseFacts(pauses, "strong")).toEqual(["Шум в паузах: \u221257\u00a0дБ в записи, \u221269\u00a0дБ после очистки."])
})

test("pauses already near silence say the difference is hard to hear instead of promising one", () => {
  expect(noiseFacts({ off: -84, light: -88, strong: -93 }, "strong").at(-1)).toBe("В паузах и в записи почти тихо, поэтому на слух разница едва заметна.")
})

test("a new noise choice stales the sound check instead of keeping the verdict of the old sound", () => {
  expect(soundKeyOf([part], [], "strong")).not.toBe(soundKeyOf([part], [], "light"))
  expect(soundKeyOf([part], [], "off")).not.toBe(soundKeyOf([part], [], "strong"))
})
