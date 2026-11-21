import { expect, test } from "bun:test"
import { isHdr, prepareArgs, recognizerArgs, refreshArgs, transcriptText } from "../../src/server/media-commands.ts"

test("the recognizer on a Mac runs on the CPU provider and not on CoreML, and on Linux keeps the default", () => {
  const files = { wav: "a.wav", words: "a.json" }
  expect(recognizerArgs("t", files, "darwin")).toEqual(["run", "--project", "t", "python", "t/transcribe.py", "--providers", "CPUExecutionProvider", "a.wav", "a.json"])
  expect(recognizerArgs("t", files, "linux")).toEqual(["run", "--project", "t", "python", "t/transcribe.py", "a.wav", "a.json"])
})

test("an iPhone HLG video and a PQ video count as HDR, and a plain or unknown one does not", () => {
  expect(isHdr("arib-std-b67")).toBe(true)
  expect(isHdr("smpte2084")).toBe(true)
  expect(isHdr("bt709")).toBe(false)
  expect(isHdr(undefined)).toBe(false)
})

test("the sound for the recognizer is 16 kHz mono, not the stereo 48 kHz of the original", () => {
  const args = prepareArgs({ source: "a.mov", wav: "a.wav", preview: "a.mp4" }, false, "libx264")
  const wav = args.slice(0, args.indexOf("a.wav"))
  expect(wav.slice(wav.lastIndexOf("-ac"), wav.lastIndexOf("-ac") + 4)).toEqual(["-ac", "1", "-ar", "16000"])
})

test("only an HDR original is tone-mapped for the preview, not a plain one", () => {
  const filter = (hdr: boolean): string => {
    const args = prepareArgs({ source: "a.mov", wav: "a.wav", preview: "a.mp4" }, hdr, "libx264")
    return args[args.indexOf("-vf") + 1] ?? ""
  }
  expect(filter(true)).toContain("tonemap")
  expect(filter(false)).not.toContain("tonemap")
})

test("the text for the chat model numbers every word, breaks lines at pauses and names a long pause", () => {
  const text = transcriptText("a.mov", {
    duration: 9,
    words: [
      { start: 1.5, end: 2, text: "Аванс" },
      { start: 2, end: 2.5, text: "вернут." },
      { start: 2.7, end: 3, text: "Да." },
      { start: 5, end: 5.5, text: "Нет." }
    ]
  })
  expect(text.split("\n").slice(3)).toEqual([
    "(pause 1.5 s)",
    "[1.50-2.50] 0:Аванс 1:вернут.",
    "[2.70-3.00] 2:Да.",
    "(pause 2.0 s)",
    "[5.00-5.50] 3:Нет.",
    "(pause 3.5 s)",
    ""
  ])
})

test("a pause under a tenth of a second keeps the line, and a pause under a second is not named", () => {
  const text = transcriptText("a.mov", {
    duration: 2,
    words: [{ start: 0.5, end: 1, text: "да" }, { start: 1.09, end: 1.5, text: "нет" }]
  })
  expect(text.split("\n").slice(3)).toEqual(["[0.50-1.50] 0:да 1:нет", ""])
})

test("a refreshed preview encodes only the preview, with the same short key frame distance and encoder", () => {
  expect(refreshArgs("a.mov", "a.mp4", false, "libx264")).toEqual([
    "-hide_banner", "-loglevel", "error", "-y", "-i", "a.mov",
    "-map", "0:v:0", "-map", "0:a:0", "-vf", "fps=30,scale=540:-2,format=yuv420p",
    "-c:v", "libx264", "-b:v", "1500k", "-g", "15", "-c:a", "aac", "-b:a", "96k", "-ac", "1",
    "-movflags", "+faststart", "-f", "mp4", "a.mp4"
  ])
  expect(refreshArgs("a.mov", "a.mp4", false, "libx264")).not.toContain("a.wav")
  const hdrFilter = refreshArgs("a.mov", "a.mp4", true, "h264_nvenc")
  expect(hdrFilter[hdrFilter.indexOf("-vf") + 1] ?? "").toContain("tonemap")
})

test("a seek in the preview decodes at most half a second, not the 250 frames of ffmpeg's default key frame distance", () => {
  const args = prepareArgs({ source: "a.mov", wav: "a.wav", preview: "a.mp4" }, false, "libx264")
  const preview = args.slice(args.indexOf("a.wav"))
  const frames = Number(preview[preview.indexOf("-g") + 1])
  const rate = Number(/fps=(\d+)/.exec(preview[preview.indexOf("-vf") + 1] ?? "")?.[1])
  expect(frames / rate).toBeGreaterThan(0)
  expect(frames / rate).toBeLessThanOrEqual(0.5)
})
