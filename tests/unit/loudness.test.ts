import { expect, test } from "bun:test"
import { curveOf, momentsOf, passagesOf, readingOf, sampledAt } from "../../src/server/media-commands.ts"
import { judgeSound, jumpsOf } from "../../src/shared/reel.ts"

const part = (frames: number) => ({ video: "a.mov", start: 0, frames })

// The summary block is what ffmpeg 6 prints for ebur128=peak=true on a file measured at -14.2 LUFS.
const summary = `[Parsed_ebur128_0 @ 0x7ec134004300] Summary:

  Integrated loudness:
    I:         -14.2 LUFS
    Threshold: -24.2 LUFS

  Loudness range:
    LRA:         1.3 LU
    Threshold: -34.1 LUFS
    LRA low:   -14.7 LUFS
    LRA high:  -13.5 LUFS

  True peak:
    Peak:       -1.7 dBFS
`

test("the ffmpeg summary is read as its integrated, range and true peak values", () => {
  expect(readingOf(summary)).toEqual({ lufs: -14.2, lra: 1.3, truePeak: -1.7 })
})

test("output with no summary block is not read as silence", () => {
  expect(readingOf("size=N/A time=00:00:18.01")).toBeUndefined()
})

test("a silent measurement reads as the -70 LUFS gate floor, not as a loud value", () => {
  const silent = summary.replace("-14.2 LUFS", "-inf LUFS").replace("1.3 LU", "0.0 LU").replace("-1.7 dBFS", "-inf dBFS")
  expect(readingOf(silent)).toEqual({ lufs: -70, lra: 0, truePeak: -70 })
})

test("each momentary value is read at its own timestamp, not the one before it", () => {
  const metadata = [
    "frame:0    pts:0       pts_time:0",
    "lavfi.r128.M=-120.691",
    "frame:1    pts:4800    pts_time:0.1",
    "lavfi.r128.M=-43.739"
  ].join("\n")
  expect(momentsOf(metadata)).toEqual([
    { time: 0, lufs: -120.691 },
    { time: 0.1, lufs: -43.739 }
  ])
})

test("a part under one second is never a passage, even when it is the quietest", () => {
  const spans = passagesOf([part(20), part(30), part(60)], [-60, -30, -10])
  expect(spans[0]?.name).toBe("quiet")
  expect(spans[0]?.from).toBeCloseTo(20 / 30)
  expect(spans[0]?.to).toBeCloseTo(50 / 30)
})

test("the quiet and the loud passage are the quietest and the loudest parts, each at its own seconds", () => {
  const spans = passagesOf([part(30), part(60), part(45)], [-30, -10, -50])
  expect(spans).toEqual([
    { name: "quiet", from: 3, to: 4.5 },
    { name: "loud", from: 1, to: 3 }
  ])
})

test("a silent part is never the quiet passage", () => {
  const spans = passagesOf([part(60), part(60), part(60)], [-70, -30, -10])
  expect(spans).toEqual([
    { name: "quiet", from: 2, to: 4 },
    { name: "loud", from: 4, to: 6 }
  ])
})

test("a moment 37.8 dB under the -14 LUFS target is lifted by 37.8 dB, not clamped at 20 dB", () => {
  const curve = curveOf([{ time: 1, lufs: -51.8 }], 0)
  expect(Number(curve.split(" ").at(-1))).toBeCloseTo(10 ** (37.8 / 20), 4)
})

test("a moment at the silence floor is left at unity gain, not boosted", () => {
  const curve = curveOf([{ time: 1, lufs: -70 }], 0)
  expect(Number(curve.split(" ").at(-1))).toBe(1)
})

test("the defect reel at -12 LUFS with a 22.7 LU range is never judged good", () => {
  const verdict = judgeSound({ lufs: -12, lra: 22.7, truePeak: -2 })
  expect(verdict.level).not.toBe("good")
  expect(verdict.issues).toContain("uneven")
})

test("a reel above 0 dBTP is judged bad, because its peaks clip", () => {
  expect(judgeSound({ lufs: -14, lra: 5, truePeak: 0.2 }).level).toBe("bad")
})

test("a sample takes the last moment at or before its time, never a later one, and silence reads as the -70 floor", () => {
  const moments = [
    { time: 0, lufs: -120 },
    { time: 0.4, lufs: -30 },
    { time: 0.9, lufs: -20 },
    { time: 1.5, lufs: -14 }
  ]
  expect(sampledAt(moments, 0.5, 1.5)).toEqual([-70, -30, -20, -14])
})

test("a run more than 3 LU from the target is one jump, and a silent sample is never part of one", () => {
  const after = [-14, -14, -20, -20, -14, -70, -20, -14]
  expect(jumpsOf(after)).toEqual([
    { from: 1, to: 2 },
    { from: 3, to: 3.5 }
  ])
})

test("a jump that runs to the end of the reel ends at the reel's length, not one sample short", () => {
  expect(jumpsOf([-14, -20])).toEqual([{ from: 0.5, to: 1 }])
})
