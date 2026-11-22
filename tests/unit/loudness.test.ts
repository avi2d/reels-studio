import { expect, test } from "bun:test"
import { curveOf, gainsOf } from "../../src/server/level-curve.ts"
import { measureArgs, momentsOf, readingOf, repeatsFor, sampledAt } from "../../src/server/loudness-meter.ts"
import { passagesOf } from "../../src/server/media-commands.ts"
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

test("each short-term value stands at the middle of the 3 s it covers, not at the end of it or at the stamp before it", () => {
  const metadata = [
    "frame:0    pts:144000  pts_time:3",
    "lavfi.r128.S=-120.691",
    "frame:1    pts:148800  pts_time:3.1",
    "lavfi.r128.S=-43.739"
  ].join("\n")
  expect(momentsOf(metadata)).toEqual([
    { time: 1.5, lufs: -120.691 },
    { time: 1.6, lufs: -43.739 }
  ])
})

test("a momentary reading is not taken for the short-term level the chart draws", () => {
  expect(momentsOf("frame:0    pts:144000  pts_time:3\nlavfi.r128.M=-20")).toEqual([])
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

test("a part 37.8 dB under the -14 LUFS target is lifted by 37.8 dB, not clamped at 20 dB", () => {
  const curve = curveOf(gainsOf([{ from: 0, to: 2, lufs: -51.8 }], 0))
  expect(Number(curve.split(" ").at(-1))).toBeCloseTo(10 ** (37.8 / 20), 4)
})

test("a part at the silence floor is left at unity gain, not boosted", () => {
  const curve = curveOf(gainsOf([{ from: 0, to: 2, lufs: -70 }], 0))
  expect(Number(curve.split(" ").at(-1))).toBe(1)
})

test("a silent part stays at unity gain when the whole reel is shifted toward the target, not shifted with it", () => {
  const curve = curveOf(gainsOf([{ from: 0, to: 2, lufs: -70 }], 3))
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
  expect(jumpsOf(after, 3.6)).toEqual([
    { from: 1, to: 2 },
    { from: 3, to: 3.5 }
  ])
})

test("a jump that runs to the end of a 1.2 s reel ends at 1.2 s, not a sample step past the reel", () => {
  expect(jumpsOf([-14, -20, -20], 1.2)).toEqual([{ from: 0.5, to: 1.2 }])
})

const FADE = 0.06

// The volume filter keeps each value from its time until the next one, as asendcmd sends it.
const gainAt = (gains: ReadonlyArray<{ readonly time: number; readonly db: number }>, time: number): number =>
  gains.findLast((gain) => gain.time <= time + 1e-9)?.db ?? 0

const levelOut = (parts: ReadonlyArray<{ readonly from: number; readonly to: number; readonly lufs: number }>, time: number): number => {
  const gains = gainsOf(parts, 0)
  return (parts.find((one) => time < one.to)?.lufs ?? 0) + gainAt(gains, time)
}

test("a join between a -20 and a -30 LUFS part leaves no step in the levelled sound outside the fades, not a level that jumps or swells at the join", () => {
  const parts = [{ from: 0, to: 3, lufs: -20 }, { from: 3, to: 6, lufs: -30 }]
  const times = Array.from({ length: 600 }, (_, index) => index / 100).filter((time) => Math.abs(time - 3) > FADE)
  for (const time of times) expect(levelOut(parts, time)).toBeCloseTo(-14, 6)
})

test("the gain between a -20 and a -30 LUFS part moves only inside the two fades and never past either part's gain, not in one jump outside them", () => {
  const gains = gainsOf([{ from: 0, to: 3, lufs: -20 }, { from: 3, to: 6, lufs: -30 }], 0)
  const moving = gains.slice(1)
  expect(moving.length).toBeGreaterThan(10)
  for (const gain of moving) {
    expect(gain.time).toBeGreaterThan(3 - FADE)
    expect(gain.time).toBeLessThanOrEqual(3 + FADE + 1e-9)
    expect(gain.db).toBeGreaterThanOrEqual(6)
    expect(gain.db).toBeLessThanOrEqual(16)
  }
  for (const [index, gain] of moving.entries()) expect(gain.db - (gains[index]?.db ?? 0)).toBeLessThan(1)
})

test("a 0.3 s word between two removed pauses lands within 2 LU of -14 from its own level, not at a level taken from its neighbours", () => {
  const parts = [{ from: 0, to: 3, lufs: -30 }, { from: 3, to: 3.3, lufs: -24 }, { from: 3.3, to: 6.3, lufs: -36 }]
  expect(Math.abs(levelOut(parts, 3.15) + 14)).toBeLessThan(2)
})

test("a 0.3 s part is measured on its own, played over to 1.2 s, not read as silence for falling under one 0.4 s block", () => {
  const repeats = repeatsFor(0.3)
  expect((repeats + 1) * 0.3).toBeGreaterThanOrEqual(1.2 - 1e-9)
  const args = measureArgs("part-002.mov", undefined, repeats)
  expect(args.slice(args.indexOf("-stream_loop"), args.indexOf("-stream_loop") + 2)).toEqual(["-stream_loop", String(repeats)])
  expect(args.indexOf("-stream_loop")).toBeLessThan(args.indexOf("-i"))
})

test("a part longer than 1.2 s is measured once, not played over", () => {
  expect(repeatsFor(2)).toBe(0)
  expect(measureArgs("part-001.mov", undefined, repeatsFor(2))).not.toContain("-stream_loop")
})
