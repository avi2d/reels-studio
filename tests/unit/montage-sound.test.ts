import { expect, test } from "bun:test"
import { partGainsOf } from "../../src/server/level-curve.ts"
import { gainAt, previewDb, type Levelling, type SoundCheck } from "../../src/shared/reel.ts"
import { soundLineOf } from "../../src/web/montage-sound.ts"
import { verdictWords } from "../../src/web/sound-verdict.ts"

const levelling = (after: Levelling["after"]): Levelling => ({
  before: -32.5,
  after,
  series: { before: [-30, -30], after: [after.lufs, after.lufs] },
  passages: []
})

test("each part takes the gain in force at its own reel time, placed at its source time, not at the reel time", () => {
  const gains = [{ time: 0, db: 10 }, { time: 1, db: 20 }, { time: 2, db: 30 }]
  const parts = [
    { video: "a.mov", start: 5, frames: 45, from: 0, to: 1.5, lufs: -24 },
    { video: "b.mov", start: 100, frames: 45, from: 1.5, to: 3, lufs: -44 }
  ]
  expect(partGainsOf(gains, parts)).toEqual([
    { video: "a.mov", from: 5, to: 6.5, gains: [{ time: 5, db: 10 }, { time: 6, db: 20 }] },
    { video: "b.mov", from: 100, to: 101.5, gains: [{ time: 100, db: 20 }, { time: 100.5, db: 30 }] }
  ])
})

test("a gain holds until the next one, as asendcmd applies it, not blended toward the next", () => {
  const gains = [{ time: 5, db: 10 }, { time: 6, db: 20 }]
  expect(gainAt(gains, 5.9)).toBe(10)
  expect(gainAt(gains, 6)).toBe(20)
  expect(gainAt(gains, 4)).toBe(10)
})

test("sound outside every part takes the nearest part of the same video, never a part of another video", () => {
  const parts = [
    { video: "a.mov", from: 5, to: 6, gains: [{ time: 5, db: 10 }] },
    { video: "a.mov", from: 20, to: 21, gains: [{ time: 20, db: 30 }] },
    { video: "b.mov", from: 8, to: 9, gains: [{ time: 8, db: -6 }] }
  ]
  expect(previewDb(parts, "a.mov", 8)).toBe(10)
  expect(previewDb(parts, "a.mov", 18)).toBe(30)
  expect(previewDb(parts, "c.mov", 8)).toBe(0)
})

test("the levelled reel the owner accepted, at -14.0 LUFS with a 1.2 LU range and -2.6 dBTP, reads as good sound, not as a warning", () => {
  const check: SoundCheck = { job: { state: "idle" }, heard: { fresh: true, seconds: 1, levelling: levelling({ lufs: -14, lra: 1.2, truePeak: -2.6 }), parts: [] } }
  expect(soundLineOf(check)).toMatchObject({ kind: "heard", level: "good", label: "Звук хороший", stale: false })
})

test("an unlevelled cut at -32.5 LUFS with a 22.2 LU range reads as bad sound, not as one to publish", () => {
  const check: SoundCheck = { job: { state: "idle" }, heard: { fresh: true, seconds: 1, levelling: levelling({ lufs: -32.5, lra: 22.2, truePeak: -8 }), parts: [] } }
  expect(soundLineOf(check)).toMatchObject({ kind: "heard", level: "bad", label: "Звук плохой" })
})

test("a jump inside one second names that second once, not as the range 0:04–0:04", () => {
  const words = verdictWords({ lufs: -14, lra: 1.2, truePeak: -2.6 }, [{ from: 4.1, to: 4.4 }, { from: 5.2, to: 6.4 }])
  expect(words.notes[0]).toBe("Скачки громкости: 0:04, 0:05–0:06.")
})

test("undo to a checked cut shows its fresh verdict, not another cut's failed or busy job", () => {
  const heard = { fresh: true, seconds: 1, levelling: levelling({ lufs: -14, lra: 1.2, truePeak: -2.6 }), parts: [] }
  for (const job of [{ state: "failed" }, { state: "waiting" }, { state: "running", done: 0.4 }, { state: "idle" }] as const) {
    expect(soundLineOf({ job, heard })).toMatchObject({ kind: "heard", level: "good", stale: false })
  }
})

test("a failed check without a fresh verdict remains failed, not good sound", () => {
  expect(soundLineOf({ job: { state: "failed" } })).toEqual({ kind: "failed" })
  expect(soundLineOf({ job: { state: "failed" }, heard: { fresh: false, seconds: 1, levelling: levelling({ lufs: -14, lra: 1.2, truePeak: -2.6 }), parts: [] } })).toEqual({ kind: "failed" })
})

test("a montage whose check is running shows the check, not the verdict of the cut before the change", () => {
  const check: SoundCheck = { job: { state: "running", done: 0.4 }, heard: { fresh: false, seconds: 1, levelling: levelling({ lufs: -14, lra: 1.2, truePeak: -2.6 }), parts: [] } }
  expect(soundLineOf(check)).toEqual({ kind: "checking", done: 0.4 })
})
